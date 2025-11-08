/**
 * Copyright (c) 2025 favewa
 * SPDX-License-Identifier: BSD-3-Clause
 */

export class ChunkedStream<T> implements AsyncIterable<T> {
  private readonly chunks: T[] = [];

  private readonly resolvers: ((result: IteratorResult<T>) => void)[] = [];
  private readonly rejectors: ((error: Error) => void)[] = [];

  private _error: Error | null = null;
  private _closed = false;

  get closed(): boolean {
    return this._closed;
  }

  write(chunk: T) {
    if (this._closed) throw new Error("Cannot write to closed stream");

    const resolver = this.resolvers.shift();
    if (resolver) {
      this.rejectors.shift();
      resolver({ value: chunk, done: false });
    } else {
      this.chunks.push(chunk);
    }
  }

  close(): void {
    this._closed = true;
    while (this.resolvers.length) {
      this.rejectors.shift();
      this.resolvers.shift()!({ value: undefined! as any, done: true });
    }
  }

  error(err: Error): void {
    if (this._closed) return;

    this._error = err;
    this._closed = true;

    while (this.rejectors.length) {
      this.rejectors.shift()!(err);
      this.resolvers.shift();
    }
  }

  async next(): Promise<IteratorResult<T>> {
    if (this._error) {
      throw this._error;
    }

    if (this.chunks.length) {
      return { value: this.chunks.shift()!, done: false };
    }
    if (this._closed) return { value: undefined as any, done: true };

    return new Promise((resolve, reject) => {
      this.resolvers.push(resolve);
      this.rejectors.push(reject);
    });
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<T> {
    return this;
  }
}

export const mapStream = <T, U>(
  fn: (chunk: T, index: number) => U | Promise<U>,
) =>
  async function* (source: AsyncIterable<T>): AsyncIterable<U> {
    let index = 0;
    for await (const chunk of source) yield await fn(chunk, index++);
  };

export const filterStream = <T>(
  pred: (chunk: T, index: number) => boolean | Promise<boolean>,
) =>
  async function* (source: AsyncIterable<T>): AsyncIterable<T> {
    let index = 0;
    for await (const chunk of source) {
      if (await pred(chunk, index++)) yield chunk;
    }
  };

export const takeStream = <T>(count: number) =>
  async function* (source: AsyncIterable<T>): AsyncIterable<T> {
    let taken = 0;
    for await (const chunk of source) {
      if (taken++ >= count) return;
      yield chunk;
    }
  };

export const skipStream = <T>(count: number) =>
  async function* (source: AsyncIterable<T>): AsyncIterable<T> {
    let index = 0;
    for await (const chunk of source) {
      if (index++ >= count) yield chunk;
    }
  };

export const batchStream = <T>(size: number) =>
  async function* (source: AsyncIterable<T>): AsyncIterable<T[]> {
    let batch: T[] = [];
    for await (const chunk of source) {
      batch.push(chunk);
      if (batch.length >= size) {
        yield batch;
        batch = [];
      }
    }
    if (batch.length) yield batch;
  };

export const tapStream = <T>(
  fn: (chunk: T, index: number) => void | Promise<void>,
) =>
  async function* (source: AsyncIterable<T>): AsyncIterable<T> {
    let index = 0;
    for await (const chunk of source) {
      yield chunk;
      await fn(chunk, index++);
    }
  };

export const catchStream = <T>(
  handler: (error: Error) => void | Promise<void>,
) =>
  async function* (source: AsyncIterable<T>): AsyncIterable<T> {
    try {
      for await (const chunk of source) yield chunk;
    } catch (err) {
      await handler(err instanceof Error ? err : new Error(String(err)));
    }
  };

export const pipe =
  <T>(...fns: Array<(src: AsyncIterable<T>) => AsyncIterable<any>>) =>
  (source: AsyncIterable<T>) =>
    fns.reduce((acc, fn) => fn(acc), source);
