/**
 * Copyright (c) 2025 favewa
 * SPDX-License-Identifier: BSD-3-Clause
 */

export interface TokenPayload {
	authority: string;
	resource: string;
	exp: number;
}

export class SignedTokenManager {
	private readonly secretKey: string;
	private readonly consumed = new Set<string>();

	constructor(secretKey: string = getOrCreateSecretKey()) {
		this.secretKey = secretKey;
	}

	async generate(
		authority: string,
		resource: string,
		ttlMs: number,
	): Promise<string> {
		const payload: TokenPayload = {
			authority,
			resource,
			exp: Date.now() + ttlMs,
		};

		const data = JSON.stringify(payload);
		const sig = await this.sign(data);
		const b64 = btoa(data);

		return `${b64}.${sig}`;
	}

	private add(token: string, payload: TokenPayload) {
		const expiry = Math.max(0, payload.exp - Date.now());
		expiry && setTimeout(() => this.consumed.delete(token), expiry);
		this.consumed.add(token);
		return payload;
	}

	async validate(token: string): Promise<TokenPayload | undefined> {
		if (this.consumed.has(token)) return;

		try {
			const [b64, signature] = token.split(".");

			const data = atob(b64);
			if (signature !== await this.sign(data)) {
				return;
			}

			const payload: TokenPayload = JSON.parse(data);
			return Date.now() > payload.exp ? undefined : this.add(token, payload);
		} catch {
			// no-op
		}
	}

	private async sign(data: string): Promise<string> {
		const encoder = new TextEncoder();
		const keyData = encoder.encode(this.secretKey);
		const messageData = encoder.encode(data);

		const key = await crypto.subtle.importKey(
			"raw",
			keyData,
			{ name: "HMAC", hash: "SHA-256" },
			false,
			["sign"],
		);

		const signature = await crypto.subtle.sign("HMAC", key, messageData);
		return Array.from(new Uint8Array(signature))
			.map((b) => b.toString(16).padStart(2, "0"))
			.join("");
	}
}

export function getOrCreateSecretKey(): string {
	if (Deno.env.get("SECRET_KEY")) return Deno.env.get("SECRET_KEY")!;

	const generatedKey = Array.from(crypto.getRandomValues(new Uint8Array(32)))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");

	console.warn(
		"⚠️  No ,,SECRET_KEY`` found in environment. A temporary key has been generatd.\n" +
			`   This key will change upon restart. Generated key: ${
				generatedKey.slice(0, 16)
			}...`,
	);

	return generatedKey;
}
