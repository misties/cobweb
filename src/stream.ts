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
