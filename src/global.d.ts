/**
 * Copyright (c) 2025 favewa
 * SPDX-License-Identifier: BSD-3-Clause
 */

/// <reference types="cobweb/jsx-runtime" />

import type { JsxElement } from "cobweb/jsx-runtime";

type HTMLAttributeMap<T = HTMLElement> = Partial<
	Omit<T, keyof Element | "children" | "style"> & {
		style?: string;
		class?: string;
		children?: any;
		charset?: string;
		[key: `data-${string}`]: string | number | boolean | null | undefined;
		[key: `aria-${string}`]: string | number | boolean | null | undefined;
	}
>;

declare global {
	namespace JSX {
		type Element = JsxElement;

		export interface ElementChildrenAttribute {
			// deno-lint-ignore ban-types
			children: {};
		}

		export type IntrinsicElements =
			& {
				[K in keyof HTMLElementTagNameMap]: HTMLAttributeMap<
					HTMLElementTagNameMap[K]
				>;
			}
			& {
				[K in keyof SVGElementTagNameMap]: HTMLAttributeMap<
					SVGElementTagNameMap[K]
				>;
			};
	}
}
