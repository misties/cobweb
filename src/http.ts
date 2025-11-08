/**
 * Copyright (c) 2025 favewa
 * SPDX-License-Identifier: BSD-3-Clause
 */

import { ChunkedStream } from "./stream.ts";

export interface StreamOptions {
	contentType: string;
}

export function chunked() {
	const chunks = new ChunkedStream<string>();
	const encoder = new TextEncoder();

	return {
		chunks,
		stream: new ReadableStream<Uint8Array>({
			async start(controller) {
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
		}),
	};
}

export interface DataStream {
	blob: ReadableStream<Uint8Array>;

	chunks: ChunkedStream<string>;

	close(): void;

	error(err: Error): void;

	readonly response: Response;
}

export async function createDataStream(
	options: StreamOptions = {
		contentType: "text/html; charset=utf-8",
	},
): Promise<DataStream> {
	const { chunks, stream } = chunked();

	return {
		blob: stream,
		chunks,
		close: chunks.close,
		error: chunks.error,
		response: new Response(stream, {
			headers: {
				"Content-Type": options.contentType,
				"Transfer-Encoding": "chunked",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
			},
		}),
	};
}
