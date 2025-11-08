/**
 * Copyright (c) 2025 favewa
 * SPDX-License-Identifier: BSD-3-Clause
 */

import { Context } from "cobweb/routing";
import { ChunkedStream } from "./stream.ts";
import { $defer } from "./isolation.ts";

// deno-fmt-ignore
export const voidTags = new Set([
	"area", "base", "br", "col", "embed", "hr", "img", "input",
	"link", "meta", "param", "source", "track", "wbr",
]);

// deno-fmt-ignore
const ESC_LUT: Record<string, string> = {
	"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
};
const ESC_RE = /[&<>"']/g;

export const Fragment = Symbol("jsx.fragment") as any as JsxElement;
export const Defer = Symbol("jsx.defer") as any as Component<DeferProps>;

export type Component<P = Props> = (props: P) => JsxElement;

export type JsxElement = (ctx: Context) => Promise<void>;

type Props = {
	children?: JsxElement;
	key?: string | number;
	[key: string]: unknown;
};

export interface DeferProps {
	children: JsxElement;
	authority?: string;
	ttl?: number;
}

export const jsxEscape = (input: string): string =>
	typeof input !== "string" ? input : input.replace(ESC_RE, (c) => ESC_LUT[c]);

export const jsxAttr = (k: string, v: unknown) =>
	v == null || v === false
		? ""
		: v === true
		? ` ${k}`
		: ` ${k}="${jsxEscape(String(v))}"`;

const emit = (chunks: ChunkedStream<string>, data: string) =>
	void (chunks && !chunks.closed && chunks.write(data));

export async function render(node: any, ctx: Context): Promise<void> {
	if (node == null || typeof node === "boolean") return;

	if (typeof node === "string") return emit(ctx.stream.chunks, node);
	if (typeof node === "function") {
		return node(ctx);
	}
	if (node instanceof Promise) return render(await node, ctx);

	if (Array.isArray(node)) {
		for (const item of node) await render(item, ctx);
		return;
	}
	if (typeof node === "object" && Symbol.asyncIterator in node) {
		for await (const item of node) await render(item, ctx);
		return;
	}

	emit(ctx.stream.chunks, jsxEscape(String(node)));
}

export function jsxTemplate(
	template: string[],
	...values: unknown[]
): JsxElement {
	return async (ctx: Context) => {
		for (let i = 0; i < template.length; i++) {
			emit(ctx.stream.chunks, template[i]);
			i < values.length && await render(values[i], ctx);
		}
	};
}

export function jsx<P extends Props = Props>(
	tag: string | Component<P> | typeof Fragment | typeof Defer,
	props: P | null = {} as P,
	key?: string | number,
): JsxElement {
	props ??= {} as P;
	if (key !== undefined) props.key = key;

	return async (data: Context) => {
		const { children, key: _, ...attrs } = props;

		if (tag === Fragment) {
			for (const child of Array.isArray(children) ? children : [children]) {
				await render(child, data);
				return;
			}
		}

		if (tag === Defer) {
			return $defer(data, props as DeferProps);
		}

		if (typeof tag === "function") {
			const result = await (tag as any)(props);
			return render(result, data);
		}

		const isVoid = voidTags.has(tag);

		emit(data.stream.chunks, `<${tag}`);
		for (const name in attrs) {
			const value = (attrs as any)[name];
			emit(data.stream.chunks, jsxAttr(name, value));
		}
		emit(data.stream.chunks, isVoid ? "/>" : ">");

		if (!isVoid) {
			await render(children, data);
			emit(data.stream.chunks, `</${tag}>`);
		}
	};
}
