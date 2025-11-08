/**
 * Copyright (c) 2025 favewa
 * SPDX-License-Identifier: BSD-3-Clause
 */

import { createRouter } from "cobweb/routing";
import { Defer, render } from "cobweb/jsx-runtime";

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

const Layout = (props: { title: string; children: any }) => (
	<html lang="en">
		<head>
			<meta charset="utf-8" />
			<meta name="viewport" content="width=device-width, initial-scale=1.0" />
			<title>{props.title}</title>
			<style>
				{`
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
          font-family: system-ui, sans-serif;
          max-width: 600px;
          margin: 2rem auto;
          padding: 0 1rem;
        }`}
			</style>
		</head>
		<body>{props.children}</body>
	</html>
);

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

app.get("/", async (ctx) => {
	const { html } = ctx;

	await render(
		<Layout title="Todo App">
			<h1>My Todos</h1>
			<Defer>
				<TodoList />
			</Defer>
		</Layout>,
		html.chunks,
	);

	return html.response;
});

app.get("/meow/:test?", async (ctx) => {
	console.log(ctx.params.test);
});

Deno.serve({ port: 8000 }, app.fetch);
