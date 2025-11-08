/**
 * Copyright (c) 2025 favewa
 * SPDX-License-Identifier: BSD-3-Clause
 */

import { type Chunk } from "./http.ts";
import { ChunkedStream } from "./stream.ts";

export type Attrs = Record<
  string,
  string | number | boolean | null | undefined
>;

export const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#039;",
};

export function escape(input: string): string {
  let result = "";
  let lastIndex = 0;

  for (let i = 0; i < input.length; i++) {
    const replacement = ESCAPE_MAP[input[i]];
    if (replacement) {
      result += input.slice(lastIndex, i) + replacement;
      lastIndex = i + 1;
    }
  }

  return lastIndex ? result + input.slice(lastIndex) : input;
}

function serialize(attrs: Attrs | undefined): string {
  if (!attrs) return "";
  let output = "";

  for (const key in attrs) {
    const val = attrs[key];
    if (val == null || val === false) continue;
    output += " ";
    output += val === true ? key : `${key}="${escape(String(val))}"`;
  }

  return output;
}

type TagRes = void | Promise<void>;

type TagFn = {
  (attrs: Attrs, ...children: Chunk[]): TagRes;
  (attrs: Attrs, fn: () => any): TagRes;
  (...children: Chunk[]): TagRes;
  (template: TemplateStringsArray, ...values: Chunk[]): TagRes;
  (fn: () => any): TagRes;
};

export type HtmlProxy = { [K in keyof HTMLElementTagNameMap]: TagFn } & {
  [key: string]: TagFn;
};

const isTemplateLiteral = (arg: any): arg is TemplateStringsArray =>
  Array.isArray(arg) && "raw" in arg;

const isAttributes = (arg: any): arg is Record<string, any> =>
  arg &&
  typeof arg === "object" &&
  !isTemplateLiteral(arg) &&
  !Array.isArray(arg) &&
  !(arg instanceof Promise);

async function render(child: unknown): Promise<string> {
  if (child == null) return "";

  if (typeof child === "string") return escape(child);
  if (typeof child === "number") return String(child);
  if (typeof child === "boolean") return String(Number(child));

  if (child instanceof Promise) return render(await child);

  if (Array.isArray(child)) {
    return (await Promise.all(child.map(render))).join("");
  }

  if (typeof child === "function") return render(await child());
  return escape(String(child));
}

export function html(chunks: ChunkedStream<string>): HtmlProxy {
  const cache = new Map<string, TagFn>();
  const write = (buf: string) => !chunks.closed && chunks.write(buf);

  const handler: ProxyHandler<Record<string, TagFn>> = {
    get(_, tag: string) {
      let fn = cache.get(tag);
      if (fn) return fn;

      fn = async (...args: unknown[]) => {
        const attrs = isAttributes(args[0]) ? args.shift() : undefined;

        const isVoid = VOID_TAGS.has(tag.toLowerCase());
        const attributes = serialize(attrs as Attrs);

        write(`<${tag}${attributes}${isVoid ? "/" : ""}>`);
        if (isVoid) return;

        for (const child of args) {
          write(await render(child));
        }

        write(`</${tag}>`);
      };

      return (cache.set(tag, fn), fn);
    },
  };

  const proxy = new Proxy({}, handler) as HtmlProxy;
  return proxy;
}
