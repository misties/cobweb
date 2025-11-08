/**
 * Copyright (c) 2025 favewa
 * SPDX-License-Identifier: BSD-3-Clause
 */

import { Context, Router } from "cobweb/routing";
import { DeferProps, render } from "cobweb/jsx-runtime";
import { getOrCreateSecretKey, SignedTokenManager } from "./token.ts";

export const authority = async (hostname: string): Promise<string> => {
	if (!hostname) {
		throw new Error("Hostname required for authority calculation");
	}

	const hash = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(hostname),
	);

	return Array.from(new Uint8Array(hash))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
};

interface DeferConfig {
	tokenManager: SignedTokenManager;
	registry: DeferredRegistry;
}

interface DeferredComponent {
	resource: string;
	render: (ctx: Context) => Promise<void>;
}

class DeferredRegistry {
	private readonly components = new Map<string, DeferredComponent>();

	register(
		resource: string,
		render: (ctx: Context) => Promise<void>,
	): void {
		if (this.components.has(resource)) {
			throw new Error(`Component ${resource} already registered`);
		}
		this.components.set(resource, { resource: resource, render });
	}

	consume(resource: string): DeferredComponent | undefined {
		const component = this.components.get(resource);
		if (component) this.components.delete(resource);
		return component;
	}
}

const deferConfig: DeferConfig = {
	tokenManager: new SignedTokenManager(getOrCreateSecretKey()),
	registry: new DeferredRegistry(),
};

export function setupDeferredRoutes(router: Router): void {
	router.get("/_defer/:token", async (ctx) => {
		const token = ctx.params.token;

		const payload = await deferConfig.tokenManager.validate(token);
		if (!payload) {
			return new Response("Invalid or expired token", {
				status: 403,
				headers: { "Content-Type": "text/plain" },
			});
		}

		const author = ctx.info.remoteAddr.hostname;
		if (payload.authority !== await authority(author)) {
			console.warn(
				`Authority mismatch: expected ${payload.authority}, got ${await authority(
					author,
				)}`,
			);
			return new Response("Unauthorized", {
				status: 401,
				headers: { "Content-Type": "text/html" },
			});
		}

		const component = deferConfig.registry.consume(payload.resource);
		if (!component) {
			return new Response("Not Found", {
				status: 404,
				headers: { "Content-Type": "text/html" },
			});
		}

		try {
			await component.render(ctx);
			return ctx.stream.response;
		} catch (error) {
			console.error("defer:setupDeferredRoutes error:", error);
			return new Response(
				"<div>⚠️ something went wrong</div>",
				{
					status: 500,
					headers: { "Content-Type": "text/html" },
				},
			);
		}
	});
}

const renderIsolated = ({ children }: DeferProps) => (ctx: Context) =>
	Promise.resolve(children).then(async (resolved) => {
		render(resolved, ctx).then(ctx.stream.close);
	}).catch((err) => {
		console.error("defer:renderIsolated error:", err);
		if (!ctx.stream.chunks.closed) {
			ctx.stream.chunks.write(`<div>⚠️ something went wrong</div>`);
			ctx.stream.chunks.close();
		}
	});

export async function $defer(
	{ info, stream }: Context,
	props: DeferProps,
) {
	props.authority ??= await authority(
		info.remoteAddr.hostname,
	);
	props.ttl ??= 300000;

	const resource = crypto.randomUUID();
	const token = await deferConfig.tokenManager.generate(
		props.authority,
		resource,
		props.ttl,
	);
	const path = `/_defer/${token}`;
	deferConfig.registry.register(resource, renderIsolated(props));

	!stream.chunks.closed && stream.chunks.write(
		`<iframe src="${path}" loading="lazy" frameborder="0" sandbox="allow-same-origin allow-scripts" referrerpolicy="no-referrer">
		<noscript><a href="${path}">Load deferred content</a></noscript></iframe>`,
	);
}
