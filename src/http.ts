/**
 * Copyright (c) 2025 favewa
 * SPDX-License-Identifier: BSD-3-Clause
 */

import { ChunkedStream } from "./stream.ts";

export interface StreamOptions {
	headContent?: string;
	bodyAttributes?: string;
	lang?: string;
}

export type Chunk =
	| string
	| AsyncIterable<string>
	| Promise<string>
	| Iterable<string>
	| null
	| undefined;

async function* normalize(
	value: Chunk | undefined | null,
): AsyncIterable<string> {
	if (value == null) return;

	if (typeof value === "string") {
		yield value;
	} else if (value instanceof Promise) {
		const resolved = await value;
		if (resolved != null) yield String(resolved);
	} else if (Symbol.asyncIterator in value || Symbol.iterator in value) {
		for await (const chunk of value as AsyncIterable<string>) {
			if (chunk != null) yield String(chunk);
		}
	} else {
		yield String(value);
	}
}

export type ChunkedWriter = (
	strings: TemplateStringsArray,
	...values: Chunk[]
) => Promise<void>;

export const makeChunkWriter =
	(stream: ChunkedStream<string>): ChunkedWriter =>
	async (strings, ...values) => {
		const emit = (chunk: string) =>
			!stream.closed &&
			(chunk === "EOF" ? stream.close() : stream.write(chunk));

		for (let i = 0; i < strings.length; i++) {
			strings[i] && emit(strings[i]);

			for await (const chunk of normalize(values[i])) {
				emit(chunk);
			}
		}
	};

export function chunkedHtml() {
	const chunks = new ChunkedStream<string>();

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const encoder = new TextEncoder();
			try {
				for await (const chunk of chunks) {
					controller.enqueue(encoder.encode(chunk));
				}
				controller.close();
			} catch (error) {
				controller.error(error);
			}
		},
		cancel: chunks.close,
	});

	return { chunks, stream };
}

const DOCUMENT_TYPE = "<!DOCTYPE html>";
const HTML_BEGIN = (lang: string) =>
	`<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">`;
const HEAD_END = "</head><body";
const BODY_END = ">";
const HTML_END = "</body></html>";

export interface HtmlStream {
	write: ChunkedWriter;
	blob: ReadableStream<Uint8Array>;
	chunks: ChunkedStream<string>;
	close(): void;
	error(err: Error): void;
	readonly response: Response;
}

export async function createHtmlStream(
	options: StreamOptions = {},
): Promise<HtmlStream> {
	const { chunks, stream } = chunkedHtml();
	const writer = makeChunkWriter(chunks);

	chunks.write(DOCUMENT_TYPE);
	chunks.write(HTML_BEGIN(options.lang || "en"));
	options.headContent && chunks.write(options.headContent);
	chunks.write(HEAD_END);
	options.bodyAttributes && chunks.write(" " + options.bodyAttributes);
	chunks.write(BODY_END);

	return {
		write: writer,
		blob: stream,
		chunks,
		close() {
			if (!chunks.closed) {
				chunks.write(HTML_END);
				chunks.close();
			}
		},
		error: chunks.error,
		response: new Response(stream, {
			headers: {
				"Content-Type": "text/html; charset=utf-8",
				"Transfer-Encoding": "chunked",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
			},
		}),
	};
}
