/**
 * Copyright (c) 2025 favewa
 * SPDX-License-Identifier: BSD-3-Clause
 */

import { createDataStream } from "./http.ts";
import { compose, createContext, Handler, Middleware } from "./middleware.ts";

// why is Request["method"] a bare `string` oh my lord kill me
type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

type ExtractParameterNames<S extends string> = S extends
	`${string}:${infer Param}/${infer Rest}`
	? Param | ExtractParameterNames<`/${Rest}`>
	: S extends `${string}:${infer Param}` ? Param
	: never;

type Skippable<S extends string, T> = S extends `${string}?` ? T | undefined
	: T;

type StripOptional<S extends string> = S extends `${infer P}?` ? P : S;

export type ParametersOf<S extends string> = {
	[K in ExtractParameterNames<S> as StripOptional<K>]: Skippable<
		K,
		string
	>;
};

export interface TypedURLPattern<S extends string> extends URLPattern {
	readonly raw: S;
}

export function url<const S extends string>(
	init: URLPatternInit & { pathname: S },
): TypedURLPattern<S> {
	const pattern = new URLPattern(init) as TypedURLPattern<S>;
	return (((pattern as any).raw = init.pathname), pattern);
}

export interface Route {
	readonly pattern: URLPattern;
	handler: Handler;
	method: Method;
}

type HandlerParams<P> = P extends TypedURLPattern<any> ? ParametersOf<P["raw"]>
	: P extends string ? ParametersOf<P>
	: P extends URLPattern ? Record<string, string>
	: never;

interface BaseRouter {
	routes: Route[];
	middlewares: Middleware[];
	namespace?: string;

	use: (...middlewares: Middleware[]) => this;

	on<P extends string | TypedURLPattern<any> | URLPattern>(
		method: Method,
		path: P,
		handler: Handler<HandlerParams<P>>,
	): P;

	fetch: (request: Request) => Promise<Response>;
}

type Router =
	& BaseRouter
	& {
		[M in Method as Lowercase<M>]: <
			P extends string | TypedURLPattern<any> | URLPattern,
		>(
			path: P,
			handler: Handler<HandlerParams<P>>,
		) => Router;
	};

export function createRouter(namespace?: string): Router {
	const routes: Route[] = [];
	const middlewares: Middleware[] = [];

	const router: BaseRouter = {
		routes,
		middlewares,
		namespace,

		use(...mw: Middleware[]) {
			middlewares.push(...mw);
			return router;
		},

		on<P extends string | TypedURLPattern<any> | URLPattern>(
			method: Method,
			path: P,
			handler: Handler<HandlerParams<P>>,
		): P {
			const pattern: URLPattern = typeof path === "string"
				? url({ pathname: path })
				: (path as URLPattern);

			routes.push({
				method,
				pattern,
				handler: handler as Handler,
			});

			return path;
		},

		async fetch(request: Request): Promise<Response> {
			const method = request.method.toUpperCase() as Method;

			for (const route of routes) {
				if (route.method !== method) continue;

				const match = route.pattern.exec(request.url);
				if (!match) continue;

				const stream = await createDataStream();
				const ctx = await createContext(request, match, stream);

				return (
					(await compose(middlewares, route.handler)(ctx)) ||
					new Response("", { status: 200 })
				);
			}

			return new Response("Not Found", {
				status: 404,
				headers: new Headers({ "Content-Type": "text/plain" }),
			});
		},
	};

	["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].forEach(
		(method) => {
			const lower = method.toLowerCase() as Lowercase<Method>;
			(router as any)[lower] = <
				P extends string | TypedURLPattern<any> | URLPattern,
			>(
				path: P,
				handler: Handler<HandlerParams<P>>,
			) => router.on(method as Method, path, handler);
		},
	);

	return router as Router;
}

export * from "./middleware.ts";
