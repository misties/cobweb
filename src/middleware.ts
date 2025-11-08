/**
 * Copyright (c) 2025 favewa
 * SPDX-License-Identifier: BSD-3-Clause
 */

import { DataStream } from "./http.ts";

export interface Context<Params = Record<string, string>> {
	readonly request: Request;
	readonly url: URL;
	readonly method: string;
	readonly params: Params;
	readonly pattern: URLPatternResult;
	readonly stream: DataStream;
	readonly signal: AbortSignal;
	state: Map<string | symbol, unknown>;
}

export async function createContext<P = Record<string, string>>(
	request: Request,
	pattern: URLPatternResult,
	stream: DataStream,
): Promise<Context<P>> {
	return {
		request,
		url: new URL(request.url),
		method: request.method,
		params: (pattern.pathname.groups || {}) as P,
		pattern,
		stream: stream,
		signal: request.signal,
		state: new Map(),
	};
}

export interface Handler<P = Record<string, string>> {
	(ctx: Context<P>): Promise<Response | void>;
}

export interface Middleware {
	(ctx: Context, next: () => Promise<Response>): Promise<Response>;
}

export function compose(
	middlewares: readonly Middleware[],
	handler: Handler,
): Handler {
	if (!middlewares.length) return handler;

	return (ctx) => {
		let index = -1;

		async function dispatch(i: number): Promise<Response> {
			if (i <= index) throw new Error("next() called multiple times");
			index = i;

			const fn = i < middlewares.length ? middlewares[i] : handler;
			if (!fn) throw new Error("No handler found");

			const result = await fn(ctx, () => dispatch(i + 1));
			if (!result) throw new Error("Handler must return Response");
			return result;
		}

		return dispatch(0);
	};
}
