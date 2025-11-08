/**
 * Copyright (c) 2025 favewa
 * SPDX-License-Identifier: BSD-3-Clause
 */

import { Attrs, escape, html, VOID_TAGS } from "./html.ts";
import { ChunkedStream } from "./stream.ts";

export const Fragment = Symbol("Fragment");

type Props = Attrs & { children?: any };
type Component = (props: Props) => JsxElement | AsyncGenerator<JsxElement>;

export type JsxElement =
  | ((chunks: ChunkedStream<string>) => Promise<void>)
  | AsyncGenerator<JsxElement, void, unknown>;

async function render(
  child: any,
  chunks: ChunkedStream<string>,
  context: ReturnType<typeof html>,
): Promise<void> {
  if (child == null || child === false || child === true) return;

  if (typeof child === "string") return chunks.write(escape(child));
  if (typeof child === "number") return chunks.write(String(child));

  if (typeof child === "function") return await child(chunks);
  if (child instanceof Promise) {
    return await render(await child, chunks, context);
  }

  if (typeof child === "object" && Symbol.asyncIterator in child) {
    (async () => {
      for await (const item of child) {
        await render(item, chunks, context);
      }
    })();
    return;
  }

  if (Array.isArray(child)) {
    for (const item of child) await render(item, chunks, context);
    return;
  }

  chunks.write(escape(String(child)));
}

export function jsx(
  tag: string | Component | typeof Fragment,
  props: Props | null = {},
): JsxElement {
  props ||= {};

  return async (chunks: ChunkedStream<string>) => {
    const context = html(chunks);
    const { children, ...attrs } = props;

    if (tag === Fragment) {
      if (!Array.isArray(children)) {
        return await render([children], chunks, context);
      }
      for (const child of children) {
        await render(child, chunks, context);
      }
      return;
    }

    if (typeof tag === "function") {
      return await render(tag(props), chunks, context);
    }

    const childr = children == null ? [] : [].concat(children);
    const attributes = Object.keys(attrs).length ? attrs : {};

    if (!childr.length || VOID_TAGS.has(tag)) {
      await context[tag](childr);
    } else {
      await context[tag](attributes, async () => {
        for (const child of childr) {
          await render(child, chunks, context);
        }
      });
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
  (html: string): JsxElement =>
  async (chunks: ChunkedStream<string>) =>
    void (!chunks.closed && chunks.write(html));

export const open = <K extends keyof HTMLElementTagNameMap>(tag: K) =>
  raw(`<${tag}>`);

export const close = <K extends keyof HTMLElementTagNameMap>(tag: K) =>
  raw(`</${tag}>`);

export { renderJsx as render };
