/**
 * Copyright (c) 2025 favewa
 * SPDX-License-Identifier: BSD-3-Clause
 */

import { ChunkedStream } from "./stream.ts";

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
export const Defer = Symbol("jsx.defer") as any as Component;

export type Component<P = Props> = (props: P) => JsxElement;

export type JsxElement = (chunks: ChunkedStream<string>) => Promise<void>;

type Props = {
	children?: JsxElement;
	key?: string | number;
	[key: string]: unknown;
};

interface DeferProps {
	fallback?: JsxElement;
	children: JsxElement;
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

async function render(
	node: any,
	chunks: ChunkedStream<string>,
): Promise<void> {
	if (node == null || typeof node === "boolean") return;

	if (typeof node === "string") return emit(chunks, node);
	if (typeof node === "function") return node(chunks);
	if (node instanceof Promise) return render(await node, chunks);

	if (Array.isArray(node)) {
		for (const item of node) await render(item, chunks);
		return;
	}
	if (typeof node === "object" && Symbol.asyncIterator in node) {
		for await (const item of node) await render(item, chunks);
		return;
	}

	emit(chunks, escape(String(node)));
}

export function jsxTemplate(
	template: string[],
	...values: unknown[]
): JsxElement {
	return async (chunks: ChunkedStream<string>) => {
		for (let i = 0; i < template.length; i++) {
			emit(chunks, template[i]);
			i < values.length && await render(values[i], chunks);
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

	return async (chunks: ChunkedStream<string>) => {
		const { children, key: _, ...attrs } = props;

		if (tag === Fragment) {
			for (const child of Array.isArray(children) ? children : [children]) {
				await render(child, chunks);
				return;
			}
		}

		if (tag === Defer) {
			return defer(chunks, props as DeferProps);
		}

		if (typeof tag === "function") {
			const result = await (tag as any)(props);
			return render(result, chunks);
		}

		const isVoid = voidTags.has(tag);

		emit(chunks, `<${tag}`);
		for (const name in attrs) {
			const value = (attrs as any)[name];
			emit(chunks, jsxAttr(name, value));
		}
		emit(chunks, isVoid ? "/>" : ">");

		if (!isVoid) {
			await render(children, chunks);
			emit(chunks, `</${tag}>`);
		}
	};
}

async function defer(
	chunks: ChunkedStream<string>,
	{ fallback, children }: DeferProps,
) {
	const id = `deferred-${Math.random().toString(36).slice(2, 10)}`;

	emit(chunks, `<div id="${id}">`);
	await render(fallback, chunks);
	emit(chunks, `</div>`);

	Promise.resolve(children).then(async (resolved) => {
		const buffer = new ChunkedStream<string>();
		await render(resolved, buffer);
		buffer.close();

		const content: string[] = [];
		for await (const chunk of buffer) content.push(chunk);

		emit(
			chunks,
			`<div id="${id}"><template shadowrootmode="open">${
				content.join("")
			}</template></div>`,
		);
	}).catch((err) => {
		console.error("defer error:", err);
		emit(chunks, `<div>⚠️ something went wrong</div>`);
	});
}
