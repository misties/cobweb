/**
 * Copyright (c) 2025 favewa
 * SPDX-License-Identifier: BSD-3-Clause
 */

export type Promisable<T> = T | Promise<T>;

export type Streamable<T> = T | AsyncIterable<T>;
