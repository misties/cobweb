/**
 * Copyright (c) 2025 favewa
 * SPDX-License-Identifier: BSD-3-Clause
 */

export function json(data: unknown, init?: ResponseInit): Response {
	const headers = new Headers({
		"Content-Type": "application/json",
		...init?.headers,
	});
	return new Response(JSON.stringify(data), { ...init, headers });
}

export function text(body: string, init?: ResponseInit): Response {
	const headers = new Headers({
		"Content-Type": "text/plain",
		...init?.headers,
	});
	return new Response(body, { ...init, headers });
}

export function html(body: string, init?: ResponseInit): Response {
	const headers = new Headers({
		"Content-Type": "text/html; charset=utf-8",
		...init?.headers,
	});
	return new Response(body, { ...init, headers });
}

export function redirect(url: string | URL, status = 302): Response {
	const headers = new Headers({ Location: url.toString() });
	return new Response(null, { status, headers });
}

export function stream(
	body: ReadableStream<Uint8Array>,
	init?: ResponseInit,
): Response {
	const headers = new Headers({
		"Content-Type": "text/html; charset=utf-8",
		"Transfer-Encoding": "chunked",
		"Cache-Control": "no-cache",
		...init?.headers,
	});
	return new Response(body, { ...init, headers });
}
