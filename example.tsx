/**
 * Copyright (c) 2025 favewa
 * SPDX-License-Identifier: BSD-3-Clause
 */

import { createRouter } from "cobweb/routing";
import { Defer } from "cobweb/jsx-runtime";
import { setupDeferredRoutes } from "cobweb/isolation.ts";

interface Todo {
	id: string;
	text: string;
	done: boolean;
	createdAt: Date;
}

const todos: Todo[] = [
	{ id: "1", text: "meow", done: true, createdAt: new Date() },
	{ id: "2", text: "mrrp", done: false, createdAt: new Date() },
	{ id: "3", text: "mrrp", done: false, createdAt: new Date() },
	{ id: "4", text: "mrrp", done: false, createdAt: new Date() },
];

async function* fetchTodos(): AsyncGenerator<Todo> {
	for (const todo of todos) {
		await new Promise((r) => setTimeout(r, 300));
		yield todo;
	}
}

const TodoList = async function* (): AsyncGenerator<any> {
	yield <div class="loading">Loading todos...</div>;

	for await (const todo of fetchTodos()) {
		yield (
			<div class={`todo ${todo.done ? "done" : ""}`}>
				<span class="text">{todo.text}</span>
			</div>
		);
	}
};

const app = createRouter();

setupDeferredRoutes(app);

app.get("/", async (ctx) => {
	await (
		<>
			<h1>My Todos</h1>
			<Defer>
				<TodoList />
			</Defer>
			<Defer>
				<TodoList />
			</Defer>
		</>
	)(ctx);

	ctx.stream.close();
	return ctx.stream.response;
});

app.get("/meow/:test?", async (ctx) => {
	console.log(ctx.params.test);
});

Deno.serve({ port: 8000 }, app.fetch);
