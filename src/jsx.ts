/**
 * Copyright (c) 2025 favewa
 * SPDX-License-Identifier: BSD-3-Clause
 */

import { escape, html, VOID_TAGS } from "./html.ts";
import { ChunkedStream } from "./stream.ts";
import type { Promisable, Streamable } from "./utils.ts";

export const Fragment = Symbol("jsx.fragment") as any as (
	props: any,
) => JsxElement;
export const Defer = Symbol("jsx.async") as any as (props: any) => JsxElement;

type Component<P = Props> = (props: P) => Promisable<Streamable<JsxElement>>;

interface DeferProps {
	fallback?: JsxChild;
	children: JsxChild;
}

type Props = {
	children?: JsxChild | JsxChild[];
	key?: string | number;
};

export type JsxChildBase =
	| string
	| number
	| boolean
	| null
	| undefined;

export type JsxChild =
	| JsxElement
	| JsxChildBase
	| Promisable<Streamable<JsxChildBase | JsxElement>>;

export type JsxElement =
	| ((chunks: ChunkedStream<string>) => Promise<void>)
	| AsyncGenerator<any, void, unknown>;

const write = (chunks: ChunkedStream<string>, data: string) =>
	!chunks.closed && chunks.write(data);

async function render(
	child: any,
	chunks: ChunkedStream<string>,
	context: ReturnType<typeof html>,
): Promise<void> {
	if (child == null || child === false || child === true) return;

	if (typeof child === "string") {
		return chunks.write(escape(child));
	}
	if (typeof child === "function") {
		return await child(chunks, context);
	}
	if (child instanceof Promise) {
		return await render(await child, chunks, context);
	}

	if (Array.isArray(child)) {
		for (const item of child) await render(item, chunks, context);
		return;
	}

	if (typeof child === "object" && Symbol.asyncIterator in child) {
		for await (const item of child as AsyncIterable<JsxChild>) {
			await render(item, chunks, context);
		}
		return;
	}

	chunks.write(escape(String(child)));
}

export function jsx<P extends Props = Props>(
	tag: string | Component<P> | typeof Fragment | typeof Defer,
	props: Props | null = {} as P,
): JsxElement {
	props ??= {} as P;

	return async (chunks: ChunkedStream<string>) => {
		const context = html(chunks);
		const { children, ...attrs } = props;

		if (tag === Fragment) {
			for (const child of Array.isArray(children) ? children : [children]) {
				await render(child, chunks, context);
			}
			return;
		}

		if (tag === Defer) {
			const { fallback = "", children } = props as DeferProps;
			const id = `s${Math.random().toString(36).slice(2)}`;

			write(chunks, `<div id="${id}">`);
			await render(fallback, chunks, context);
			write(chunks, `</div>`);

			Promise.resolve(children).then(async (resolved) => {
				const buffer = new ChunkedStream<string>();
				await render(resolved, buffer, html(buffer));
				buffer.close();

				const content: string[] = [];
				for await (const chunk of buffer) content.push(chunk);

				write(chunks, `<div id="${id}">`);
				write(
					chunks,
					`<template shadowrootmode="open">${content.join("")}</template>`,
				);
				write(chunks, `</div>`);
			});

			return;
		}

		if (typeof tag === "function") {
			const result = await tag(props as P);

			if (typeof result === "object" && Symbol.asyncIterator in result) {
				for await (const element of result as AsyncIterable<JsxElement>) {
					await render(element, chunks, context);
				}
			} else {
				await render(result as JsxElement, chunks, context);
			}
			return;
		}

		const kids = children == null ? [] : [children];
		const isVoid = VOID_TAGS.has(tag);

		if (!Object.keys(attrs).length && (!kids.length || isVoid)) {
			return await context[tag]();
		}
		write(chunks, `<${tag}`);

		for (const key in attrs) {
			const val = (attrs as any)[key];
			val && write(
				chunks,
				val === true ? ` ${key}` : ` ${key}="${escape(String(val))}"`,
			);
		}
		write(chunks, isVoid ? "/>" : ">");

		if (!isVoid) {
			for (const child of kids) {
				await render(child, chunks, context);
			}
			write(chunks, `</${tag}>`);
		}
	};
}

export const jsxs = jsx;

async function renderJsx(
	element: JsxElement | JsxElement[],
	chunks: ChunkedStream<string>,
): Promise<void> {
	if (Array.isArray(element)) {
		for (const el of element) {
			await renderJsx(el, chunks);
		}
		return;
	}
	if (typeof element === "object" && Symbol.asyncIterator in element) {
		for await (const item of element) {
			await renderJsx(item, chunks);
		}
		return;
	}
	if (typeof element === "function") {
		await element(chunks);
	}
}

export const raw =
	(html: string): JsxElement => async (chunks: ChunkedStream<string>) =>
		void (!chunks.closed && chunks.write(html));

export const open = <K extends keyof HTMLElementTagNameMap>(tag: K) =>
	raw(`<${tag}>`);

export const close = <K extends keyof HTMLElementTagNameMap>(tag: K) =>
	raw(`</${tag}>`);

export { renderJsx as render };
