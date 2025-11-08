/**
 * Copyright (c) 2025 favewa
 * SPDX-License-Identifier: BSD-3-Clause
 */

// https://github.com/stackblitz/alien-signals/blob/master/src/{index,system}.ts

export interface ReactiveNode {
	firstSource?: Subscriber;
	lastSource?: Subscriber;
	firstObserver?: Subscriber;
	lastObserver?: Subscriber;
	flags: ReactiveFlags;
}

export interface Subscriber {
	version: number;
	source: ReactiveNode;
	observer: ReactiveNode;
	previousObserver?: Subscriber;
	nextObserver?: Subscriber;
	previousSource?: Subscriber;
	nextSource?: Subscriber;
}

interface StackNode<T> {
	value: T;
	previous?: StackNode<T>;
}

export const enum ReactiveFlags {
	None = 0,
	Mutable = 1 << 0,
	Watching = 1 << 1,
	RecursionCheck = 1 << 2,
	Recursed = 1 << 3,
	Dirty = 1 << 4,
	Pending = 1 << 5,
}

interface EffectNode extends ReactiveNode {
	execute(): void;
}

interface ComputedNode<T = any> extends ReactiveNode {
	cachedValue?: T;
	compute: (previousValue?: T) => T;
}

interface SignalNode<T = any> extends ReactiveNode {
	currentValue: T;
	pendingValue: T;
}

let versionCounter = 0;
let notifyIndex = 0;
let queuedLength = 0;
let activeObserver: ReactiveNode | undefined;

const effectQueue: (EffectNode | undefined)[] = [];

function subscribe(
	source: ReactiveNode,
	observer: ReactiveNode,
	version: number,
): void {
	const lastSource = observer.lastSource;

	if (lastSource?.source === source) return;

	const nextSource = lastSource?.nextSource ?? observer.firstSource;
	if (nextSource?.source === source) {
		nextSource.version = version;
		observer.lastSource = nextSource;
		return;
	}

	const lastObserver = source.lastObserver;
	if (lastObserver?.version === version && lastObserver.observer === observer) {
		return;
	}

	const subscriber: Subscriber = {
		version,
		source,
		observer,
		previousSource: lastSource,
		nextSource,
		previousObserver: lastObserver,
		nextObserver: undefined,
	};

	observer.lastSource = source.lastObserver = subscriber;

	if (nextSource) nextSource.previousSource = subscriber;
	if (lastSource) lastSource.nextSource = subscriber;
	else observer.firstSource = subscriber;

	if (lastObserver) lastObserver.nextObserver = subscriber;
	else source.firstObserver = subscriber;
}

function unsubscribe(
	subscriber: Subscriber,
	observer = subscriber.observer,
): Subscriber | undefined {
	const {
		source,
		previousSource: prevSource,
		nextSource,
		previousObserver: prevObserver,
		nextObserver,
	} = subscriber;

	if (nextSource) nextSource.previousSource = prevSource;
	else observer.lastSource = prevSource;

	if (prevSource) prevSource.nextSource = nextSource;
	else observer.firstSource = nextSource;

	if (nextObserver) nextObserver.previousObserver = prevObserver;
	else source.lastObserver = prevObserver;

	if (prevObserver) prevObserver.nextObserver = nextObserver;
	else if (!(source.firstObserver = nextObserver)) {
		handleUnwatched(source);
	}

	return nextSource;
}

function propagate(subscriber: Subscriber): void {
	let current = subscriber;
	let next = subscriber.nextObserver;
	let stack: StackNode<Subscriber | undefined> | undefined;

	top: do {
		const observer = current.observer;
		let flags = observer.flags;
		const isClean = !(flags &
			(ReactiveFlags.RecursionCheck | ReactiveFlags.Recursed |
				ReactiveFlags.Dirty | ReactiveFlags.Pending));
		const noRecursionFlags =
			!(flags & (ReactiveFlags.RecursionCheck | ReactiveFlags.Recursed));
		const needsRecursionCheck = !(flags & ReactiveFlags.RecursionCheck);

		if (isClean) {
			observer.flags = flags | ReactiveFlags.Pending;
		} else if (noRecursionFlags) {
			flags = ReactiveFlags.None;
		} else if (needsRecursionCheck) {
			observer.flags = (flags & ~ReactiveFlags.Recursed) |
				ReactiveFlags.Pending;
		} else if (
			!(flags & (ReactiveFlags.Dirty | ReactiveFlags.Pending)) &&
			isValidSubscriber(current, observer)
		) {
			observer.flags = flags | ReactiveFlags.Recursed | ReactiveFlags.Pending;
			flags &= ReactiveFlags.Mutable;
		} else {
			flags = ReactiveFlags.None;
		}

		if (flags & ReactiveFlags.Watching) notify(observer as EffectNode);

		if (flags & ReactiveFlags.Mutable) {
			const observerSubs = observer.firstObserver;
			if (observerSubs) {
				const nextSub = (current = observerSubs).nextObserver;
				if (nextSub) {
					stack = { value: next, previous: stack };
					next = nextSub;
				}
				continue;
			}
		}

		if ((current = next!)) {
			next = current.nextObserver;
			continue;
		}

		while (stack) {
			current = stack.value!;
			stack = stack.previous;
			if (current) {
				next = current.nextObserver;
				continue top;
			}
		}

		break;
	} while (true);
}

function checkDirty(subscriber: Subscriber, observer: ReactiveNode): boolean {
	let current = subscriber;
	let currentObserver = observer;
	let stack: StackNode<Subscriber> | undefined;
	let checkDepth = 0;
	let isDirty = false;

	top: do {
		const source = current.source;
		const flags = source.flags;

		if (currentObserver.flags & ReactiveFlags.Dirty) {
			isDirty = true;
		} else if (
			(flags & (ReactiveFlags.Mutable | ReactiveFlags.Dirty)) ===
				(ReactiveFlags.Mutable | ReactiveFlags.Dirty)
		) {
			if (update(source as SignalNode)) {
				const subs = source.firstObserver!;
				if (subs.nextObserver) shallowPropagate(subs);
				isDirty = true;
			}
		} else if (
			(flags & (ReactiveFlags.Mutable | ReactiveFlags.Pending)) ===
				(ReactiveFlags.Mutable | ReactiveFlags.Pending)
		) {
			if (current.nextObserver || current.previousObserver) {
				stack = { value: current, previous: stack };
			}
			current = source.firstSource!;
			currentObserver = source;
			++checkDepth;
			continue;
		}

		if (!isDirty) {
			const nextSource = current.nextSource;
			if (nextSource) {
				current = nextSource;
				continue;
			}
		}

		while (checkDepth--) {
			const firstSub = currentObserver.firstObserver!;
			const hasMultipleObservers = !!firstSub.nextObserver;

			current = hasMultipleObservers ? stack!.value : firstSub;
			if (hasMultipleObservers) stack = stack!.previous;

			if (isDirty) {
				if (update(currentObserver as SignalNode)) {
					if (hasMultipleObservers) shallowPropagate(firstSub);
					currentObserver = current.observer;
					continue;
				}
				isDirty = false;
			} else {
				currentObserver.flags &= ~ReactiveFlags.Pending;
			}

			currentObserver = current.observer;
			const nextSource = current.nextSource;
			if (nextSource) {
				current = nextSource;
				continue top;
			}
		}

		return isDirty;
	} while (true);
}

function shallowPropagate(subscriber: Subscriber): void {
	let current: Subscriber | undefined = subscriber;

	do {
		const observer = current.observer;
		const flags = observer.flags;

		if (
			(flags & (ReactiveFlags.Pending | ReactiveFlags.Dirty)) ===
				ReactiveFlags.Pending
		) {
			observer.flags = flags | ReactiveFlags.Dirty;
			if (
				(flags & (ReactiveFlags.Watching | ReactiveFlags.RecursionCheck)) ===
					ReactiveFlags.Watching
			) {
				notify(observer as EffectNode);
			}
		}
	} while ((current = current.nextObserver));
}

function isValidSubscriber(
	checkSubscriber: Subscriber,
	observer: ReactiveNode,
): boolean {
	let subscriber = observer.lastSource;
	while (subscriber) {
		if (subscriber === checkSubscriber) return true;
		subscriber = subscriber.previousSource;
	}
	return false;
}

function update(node: SignalNode | ComputedNode): boolean {
	return node.firstSource
		? updateComputed(node as ComputedNode)
		: updateSignal(node as SignalNode);
}

function notify(effect: EffectNode) {
	let insertIndex = queuedLength;
	const firstInsertedIndex = insertIndex;
	let currentEffect: EffectNode | undefined = effect;

	do {
		currentEffect.flags &= ~ReactiveFlags.Watching;
		effectQueue[insertIndex++] = currentEffect;
		currentEffect = currentEffect.firstObserver?.observer as EffectNode;
	} while (currentEffect?.flags & ReactiveFlags.Watching);

	queuedLength = insertIndex;

	for (let i = firstInsertedIndex, j = insertIndex - 1; i < j; i++, j--) {
		[effectQueue[i], effectQueue[j]] = [effectQueue[j], effectQueue[i]];
	}
}

function handleUnwatched(node: ReactiveNode) {
	if (!(node.flags & ReactiveFlags.Mutable)) {
		disposeEffectScope.call(node);
	} else if (node.firstSource) {
		node.lastSource = undefined;
		node.flags = ReactiveFlags.Mutable | ReactiveFlags.Dirty;
		clearSources(node);
	}
}

export function setActiveObserver(observer?: ReactiveNode) {
	const previous = activeObserver;
	activeObserver = observer;
	return previous;
}

export function signal<T>(): {
	(): T | undefined;
	(value: T | undefined): void;
};
export function signal<T>(initialValue: T): {
	(): T;
	(value: T): void;
};
export function signal<T>(initialValue?: T) {
	return signalOperation.bind({
		currentValue: initialValue,
		pendingValue: initialValue,
		firstObserver: undefined,
		lastObserver: undefined,
		flags: ReactiveFlags.Mutable,
	}) as () => T | undefined;
}

export function computed<T>(compute: (previousValue?: T) => T): () => T {
	return computedOperation.bind({
		cachedValue: undefined,
		firstObserver: undefined,
		lastObserver: undefined,
		firstSource: undefined,
		lastSource: undefined,
		flags: ReactiveFlags.None,
		compute: compute as (previousValue?: unknown) => unknown,
	}) as () => T;
}

export function effect(fn: () => void): () => void {
	const effectNode: EffectNode = {
		execute: fn,
		firstObserver: undefined,
		lastObserver: undefined,
		firstSource: undefined,
		lastSource: undefined,
		flags: ReactiveFlags.Watching | ReactiveFlags.RecursionCheck,
	};

	const prevObserver = setActiveObserver(effectNode);
	if (prevObserver) subscribe(effectNode, prevObserver, 0);

	try {
		effectNode.execute();
	} finally {
		activeObserver = prevObserver;
		effectNode.flags &= ~ReactiveFlags.RecursionCheck;
	}

	return effectOperation.bind(effectNode);
}

export function effectScope(fn: () => void): () => void {
	const scopeNode: ReactiveNode = {
		firstSource: undefined,
		lastSource: undefined,
		firstObserver: undefined,
		lastObserver: undefined,
		flags: ReactiveFlags.None,
	};

	const prevObserver = setActiveObserver(scopeNode);
	if (prevObserver) subscribe(scopeNode, prevObserver, 0);

	try {
		fn();
	} finally {
		activeObserver = prevObserver;
	}

	return disposeEffectScope.bind(scopeNode);
}

export function trigger(fn: () => void) {
	const triggerNode: ReactiveNode = {
		firstSource: undefined,
		lastSource: undefined,
		flags: ReactiveFlags.Watching,
	};

	const prevObserver = setActiveObserver(triggerNode);

	try {
		fn();
	} finally {
		activeObserver = prevObserver;

		while (triggerNode.firstSource) {
			const subscriber = triggerNode.firstSource;
			const source = subscriber.source;
			unsubscribe(subscriber, triggerNode);

			if (source.firstObserver) {
				propagate(source.firstObserver);
				shallowPropagate(source.firstObserver);
			}
		}

		flush();
	}
}

function updateComputed(node: ComputedNode): boolean {
	++versionCounter;
	node.lastSource = undefined;
	node.flags = ReactiveFlags.Mutable | ReactiveFlags.RecursionCheck;

	const prevObserver = setActiveObserver(node);

	try {
		const oldValue = node.cachedValue;
		const newValue = node.compute(oldValue);
		node.cachedValue = newValue;
		return oldValue !== newValue;
	} finally {
		activeObserver = prevObserver;
		node.flags &= ~ReactiveFlags.RecursionCheck;
		clearSources(node);
	}
}

function updateSignal(signal: SignalNode): boolean {
	signal.flags = ReactiveFlags.Mutable;
	const hasChanged = signal.currentValue !== signal.pendingValue;
	signal.currentValue = signal.pendingValue;
	return hasChanged;
}

function runEffect(effect: EffectNode): void {
	const flags = effect.flags;
	const needsRun = (flags & ReactiveFlags.Dirty) ||
		(flags & ReactiveFlags.Pending && checkDirty(effect.firstSource!, effect));

	if (needsRun) {
		++versionCounter;
		effect.lastSource = undefined;
		effect.flags = ReactiveFlags.Watching | ReactiveFlags.RecursionCheck;

		const prevObserver = setActiveObserver(effect);

		try {
			effect.execute();
		} finally {
			activeObserver = prevObserver;
			effect.flags &= ~ReactiveFlags.RecursionCheck;
			clearSources(effect);
		}
	} else {
		effect.flags = ReactiveFlags.Watching;
	}
}

function flush(): void {
	while (notifyIndex < queuedLength) {
		const effect = effectQueue[notifyIndex]!;
		effectQueue[notifyIndex++] = undefined;
		runEffect(effect);
	}
	notifyIndex = queuedLength = 0;
}

function computedOperation<T>(this: ComputedNode<T>): T {
	const flags = this.flags;
	const isDirty = flags & ReactiveFlags.Dirty;
	const isPending = flags & ReactiveFlags.Pending;

	if (
		isDirty ||
		(isPending &&
			(checkDirty(this.firstSource!, this) ||
				(this.flags = flags & ~ReactiveFlags.Pending, false)))
	) {
		if (updateComputed(this)) {
			const subs = this.firstObserver;
			if (subs) shallowPropagate(subs);
		}
	} else if (!flags) {
		this.flags = ReactiveFlags.Mutable | ReactiveFlags.RecursionCheck;
		const prevObserver = setActiveObserver(this);

		try {
			this.cachedValue = this.compute();
		} finally {
			activeObserver = prevObserver;
			this.flags &= ~ReactiveFlags.RecursionCheck;
		}
	}

	const observer = activeObserver;
	if (observer) subscribe(this, observer, versionCounter);

	return this.cachedValue!;
}

function signalOperation<T>(this: SignalNode<T>, ...args: [T]): T | void {
	if (args.length) {
		const newValue = args[0];
		if (this.pendingValue !== newValue) {
			this.pendingValue = newValue;
			this.flags = ReactiveFlags.Mutable | ReactiveFlags.Dirty;

			const subs = this.firstObserver;
			if (subs) {
				propagate(subs);
				flush();
			}
		}
	} else {
		if (this.flags & ReactiveFlags.Dirty) {
			if (updateSignal(this)) {
				const subs = this.firstObserver;
				if (subs) shallowPropagate(subs);
			}
		}

		let observer = activeObserver;
		while (observer) {
			if (observer.flags & (ReactiveFlags.Mutable | ReactiveFlags.Watching)) {
				subscribe(this, observer, versionCounter);
				break;
			}
			observer = observer.firstObserver?.observer;
		}

		return this.currentValue;
	}
}

function effectOperation(this: EffectNode): void {
	disposeEffectScope.call(this);
}

function disposeEffectScope(this: ReactiveNode): void {
	this.lastSource = undefined;
	this.flags = ReactiveFlags.None;
	clearSources(this);

	const sub = this.firstObserver;
	if (sub) unsubscribe(sub);
}

function clearSources(observer: ReactiveNode) {
	const sourcesTail = observer.lastSource;
	let current = sourcesTail?.nextSource ?? observer.firstSource;

	while (current) {
		current = unsubscribe(current, observer);
	}
}
