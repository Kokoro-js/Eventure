// eventified.ts

import {
	type FireAsyncRecord,
	type FireSyncRecord,
	fireAsyncFromListeners,
	fireFromListeners,
} from './ext/fireShared'
import {
	createWhenGuard,
	type GuardPredicate,
	limitSingle,
	manyWithOps,
	onceWithOps,
	type RegisterSingle,
	type WhenGuard,
} from './ext/limitSingle'
import {
	type CancellablePromise,
	type WaitForSingleOptions,
	waitForSingle,
} from './ext/waitForSingle'
import {
	runWaterfall,
	type SplitWaterfall,
	type WFResult,
} from './ext/waterfallShared'
import { defaultLogger, type Logger } from './logger'
import type {
	ErrorPolicy,
	EventArgs,
	EventDescriptor,
	EventEmitterOptions,
	EventListener,
	EventResult,
	EmitSettledRecord,
	IEventMap,
	OnOptions,
	Unsubscribe,
} from './types'
import {
	appendListenerCopy,
	copyWithoutIndex,
	createWrapHelper,
	insertListenerCopy,
	ORIGFUNC,
	isPromiseLike,
	noopSubscription,
	onSyncError,
	prependListenerCopy,
	resolveInsertIndex,
	withAbortSignal,
	attachDispose,
} from './utils'

export type EventureFireSyncResult<
	E extends IEventMap<E>,
	K extends keyof E,
> = FireSyncRecord<E[K]>
export type EventureFireAsyncResult<
	E extends IEventMap<E>,
	K extends keyof E,
> = FireAsyncRecord<E[K]>

export type EventureWaitForOptions<
	E extends IEventMap<E>,
	K extends keyof E,
> = WaitForSingleOptions<E[K]>
export type EventureWaitForPromise<
	E extends IEventMap<E>,
	K extends keyof E,
> = CancellablePromise<EventArgs<E[K]>>

export type WFKeys<E extends IEventMap<E>> = {
	[K in keyof E]: SplitWaterfall<E[K]> extends never ? never : K
}[keyof E]

export type EventureSplit<
	E extends IEventMap<E>,
	K extends WFKeys<E>,
> = SplitWaterfall<E[K]>
export type EventureWFResult<
	E extends IEventMap<E>,
	K extends WFKeys<E>,
> = EventureSplit<E, K> extends never
	? WFResult<never>
	: WFResult<EventureSplit<E, K>['ret']>

export class Eventure<
	E extends IEventMap<E> = Record<string | symbol, EventDescriptor>,
> {
	// 事件 → 监听器列表（不可变写入，emit 避免 slice）
	protected _listeners: { [K in keyof E]?: EventListener<E[K]>[] } =
		Object.create(null)
	protected _activeEvents = new Set<keyof E>()

	protected _maxListeners = 10
	get maxListeners() {
		return this._maxListeners
	}
	set maxListeners(count: number) {
		this._maxListeners = count
	}

	protected _logger: Logger
	protected _catchPromiseError: boolean
	protected _checkSyncFuncReturnPromise: boolean
	protected _errorPolicy: ErrorPolicy
	/** 预构建包装器，热路径零分配 */
	protected _wrap: <T extends (...args: any[]) => any>(listener: T) => T

	constructor(options?: EventEmitterOptions<E>) {
		this._logger = options?.logger ?? defaultLogger

		if (options?.events) {
			for (const ev of options.events) this._listeners[ev] = []
		}

		this._catchPromiseError = options?.catchPromiseError ?? true
		this._checkSyncFuncReturnPromise =
			options?.checkSyncFuncReturnPromise ?? false
		this._errorPolicy = options?.errorPolicy ?? 'log'

		this._wrap = createWrapHelper({
			logger: this._logger,
			catchPromiseError: this._catchPromiseError,
			checkSyncFuncReturnPromise: this._checkSyncFuncReturnPromise,
			errorPolicy: this._errorPolicy,
		})
	}

	protected _onSyncError(err: unknown): void {
		onSyncError(err, this._errorPolicy, this._logger)
	}

	/** 创建可退订句柄，并实现 [Symbol.dispose] 以支持 using */
	protected _makeSubscription<K extends keyof E>(
		event: K,
		orig: EventListener<E[K]>,
	): Unsubscribe {
		const unsub: Unsubscribe = (() => {
			this.off(event, orig)
		}) as Unsubscribe
		// RAII/using：退出作用域自动退订
		return attachDispose(unsub)
	}

	protected _register<K extends keyof E>(
		event: K,
		listener: EventListener<E[K]>,
		opts?: OnOptions,
		forcePrepend?: boolean,
	): Unsubscribe {
		const signal = opts?.signal
		if (signal?.aborted) return noopSubscription

		const fn = this._wrap(listener) as EventListener<E[K]>
		const prev = this._listeners[event]
		const usePrepend = forcePrepend ?? opts?.prepend ?? false
		const next = usePrepend
			? prependListenerCopy(prev, fn)
			: appendListenerCopy(prev, fn)
		this._listeners[event] = next

		if (next.length > 0) this._activeEvents.add(event)
		if (next.length > this._maxListeners) {
			this._logger.warn(
				`MaxListenersExceededWarning(remind memory leak): '${String(event)}' has ${next.length} listeners that exceed ${this._maxListeners}`,
			)
		}

		const sub = this._makeSubscription(event, listener)

		return withAbortSignal(signal, sub)
	}

	/** 统一注册：返回 Subscription（函数），避免重载与布尔位 */
	public on<K extends keyof E>(
		event: K,
		listener: EventListener<E[K]>,
		opts?: OnOptions,
	): Unsubscribe {
		return this._register(event, listener, opts)
	}

	protected _singleRegister<K extends keyof E>(event: K): RegisterSingle<E[K]> {
		return (listener, prepend) =>
			this._register(event, listener, undefined, prepend ?? false)
	}

	/** 前插语义的快捷方式，等价于 on(event, listener, { prepend: true }) */
	public onFront<K extends keyof E>(
		event: K,
		listener: EventListener<E[K]>,
		opts?: Omit<OnOptions, 'prepend'>,
	): Unsubscribe {
		return this.onAt(event, { at: 0, signal: opts?.signal }, listener)
	}

	public onAt<K extends keyof E>(
		event: K,
		options: {
			at: number | ((ctx: { count: number; event: K }) => number)
			signal?: AbortSignal
		},
		listener: EventListener<E[K]>,
	): Unsubscribe {
		const signal = options.signal
		if (signal?.aborted) return noopSubscription

		const fn = this._wrap(listener) as EventListener<E[K]>
		const prev = this._listeners[event]
		const count = prev?.length ?? 0
		const at = options.at
		const index =
			typeof at === 'function'
				? resolveInsertIndex(count, at, { count, event })
				: resolveInsertIndex(count, at)

		const next = insertListenerCopy(prev, index, fn)
		this._listeners[event] = next

		if (next.length > 0) this._activeEvents.add(event)
		if (next.length > this._maxListeners) {
			this._logger.warn(
				`MaxListenersExceededWarning(remind memory leak): '${String(event)}' has ${next.length} listeners that exceed ${this._maxListeners}`,
			)
		}

		const sub = this._makeSubscription(event, listener)
		return withAbortSignal(signal, sub)
	}

	/** 移除单个监听器；返回是否真的移除了一个条目 */
	public off<K extends keyof E>(
		event: K,
		listener: EventListener<E[K]>,
	): boolean {
		const prev = this._listeners[event]
		if (!prev || prev.length === 0) return false

		// 支持对比“原函数”与“包装后函数”的映射（ORIGFUNC）
		let idx = -1
		for (let i = 0; i < prev.length; i++) {
			const fn = prev[i] as any
			if (fn === listener || fn[ORIGFUNC] === listener) {
				idx = i
				break
			}
		}
		if (idx < 0) return false

		if (prev.length === 1) {
			this._listeners[event] = undefined
			this._activeEvents.delete(event)
		} else {
			this._listeners[event] = copyWithoutIndex(prev, idx)
		}
		return true
	}

	/** 批量清空；缺省则清空全部 */
	public clear<K extends keyof E>(event?: K): void {
		if (event === undefined) {
			this._listeners = Object.create(null)
			this._activeEvents.clear()
			return
		}
		this._listeners[event] = undefined
		this._activeEvents.delete(event)
	}

	/** —— emit ——（读取不可变快照，热路径零分配 & 无 slice） */
	public emit<K extends keyof E>(event: K, ...args: EventArgs<E[K]>): number {
		const fns = this._listeners[event]
		if (!fns || fns.length === 0) return 0

		const len = fns.length
		switch (args.length) {
			case 0:
				for (let i = 0; i < len; i++) {
					try {
						;(fns[i] as any)()
					} catch (err) {
						this._onSyncError(err)
					}
				}
				break
			case 1: {
				const arg0 = args[0]!
				for (let i = 0; i < len; i++) {
					try {
						;(fns[i] as any)(arg0)
					} catch (err) {
						this._onSyncError(err)
					}
				}
				break
			}
			case 2: {
				const arg0 = args[0]!
				const arg1 = args[1]!
				for (let i = 0; i < len; i++) {
					try {
						;(fns[i] as any)(arg0, arg1)
					} catch (err) {
						this._onSyncError(err)
					}
				}
				break
			}
			case 3: {
				const arg0 = args[0]!
				const arg1 = args[1]!
				const arg2 = args[2]!
				for (let i = 0; i < len; i++) {
					try {
						;(fns[i] as any)(arg0, arg1, arg2)
					} catch (err) {
						this._onSyncError(err)
					}
				}
				break
			}
			case 4: {
				const arg0 = args[0]!
				const arg1 = args[1]!
				const arg2 = args[2]!
				const arg3 = args[3]!
				for (let i = 0; i < len; i++) {
					try {
						;(fns[i] as any)(arg0, arg1, arg2, arg3)
					} catch (err) {
						this._onSyncError(err)
					}
				}
				break
			}
			default:
				for (let i = 0; i < len; i++) {
					try {
						;(fns[i] as any)(...args)
					} catch (err) {
						this._onSyncError(err)
					}
				}
		}
		return len
	}

	public async emitAll<K extends keyof E>(
		event: K,
		...args: EventArgs<E[K]>
	): Promise<Awaited<EventResult<E[K]>>[]> {
		const fns = this._listeners[event]
		if (!fns || fns.length === 0) return []

		const len = fns.length
		const results = new Array<Awaited<EventResult<E[K]>>>(len)
		let pending: Promise<void>[] | null = null

		for (let i = 0; i < len; i++) {
			const fn = fns[i] as any
			try {
				const r = fn(...args)
				if (r instanceof Error) {
					if (pending) void Promise.allSettled(pending)
					return Promise.reject(r)
				}
				if (isPromiseLike(r)) {
					pending ??= []
					pending.push(
						Promise.resolve(r).then((v: any) => {
							if (v instanceof Error) throw v
							results[i] = v
						}),
					)
					continue
				}
				results[i] = r
			} catch (err) {
				if (pending) void Promise.allSettled(pending)
				return Promise.reject(err)
			}
		}

		if (pending) await Promise.all(pending)
		return results
	}

	public async emitSettled<K extends keyof E>(
		event: K,
		...args: EventArgs<E[K]>
	): Promise<
		EmitSettledRecord<EventListener<E[K]>, Awaited<EventResult<E[K]>>>[]
	> {
		const fns = this._listeners[event]
		if (!fns || fns.length === 0) return []

		const len = fns.length
		const results = new Array<
			EmitSettledRecord<EventListener<E[K]>, Awaited<EventResult<E[K]>>>
		>(len)
		let pending: Promise<void>[] | null = null

		for (let i = 0; i < len; i++) {
			const fn = fns[i]!
			try {
				const r = (fn as any)(...args)
				if (r instanceof Error) {
					results[i] = { fn, status: 'rejected', reason: r }
					continue
				}
				if (isPromiseLike(r)) {
					pending ??= []
					pending.push(
						Promise.resolve(r).then(
							(v: any) => {
								if (v instanceof Error) {
									results[i] = { fn, status: 'rejected', reason: v }
								} else {
									results[i] = { fn, status: 'fulfilled', value: v }
								}
							},
							(reason: unknown) => {
								results[i] = { fn, status: 'rejected', reason }
							},
						),
					)
					continue
				}
				results[i] = { fn, status: 'fulfilled', value: r }
			} catch (reason) {
				results[i] = { fn, status: 'rejected', reason }
			}
		}

		if (pending) await Promise.all(pending)
		return results
	}

	/** 观测/诊断工具：保持只读快照 */
	public count<K extends keyof E>(event: K): number {
		return this._listeners[event]?.length ?? 0
	}
	public events(): Array<keyof E> {
		return Array.from(this._activeEvents)
	}
	public listeners<K extends keyof E>(event: K): EventListener<E[K]>[] {
		return this._listeners[event]?.slice() ?? []
	}
	/**
	 * 直接暴露内部监听器数组（零拷贝）。
	 * 仅用于高级/性能场景；对返回数组做任何 mutate 都可能破坏库的快照语义。
	 */
	public listenersUnsafe<K extends keyof E>(event: K): EventListener<E[K]>[] {
		return this._listeners[event] ?? []
	}
	public queryListeners<K extends keyof E>(event: K): EventListener<E[K]>[] {
		return this.listenersUnsafe(event)
	}

	/** 基础 limit 实现：面向自定义组合 */
	public limit<K extends keyof E>(
		event: K,
		listener: EventListener<E[K]>,
		times = 1,
		prepend = false,
		predicate?: GuardPredicate<E[K]>,
	): Unsubscribe {
		const register = this._singleRegister(event)
		return limitSingle(
			this._wrap,
			register,
			listener,
			times,
			prepend,
			predicate,
		)
	}

	public once<K extends keyof E>(
		event: K,
		listener: EventListener<E[K]>,
		predicate?: GuardPredicate<E[K]>,
	): Unsubscribe {
		const register = this._singleRegister(event)
		return onceWithOps(this._wrap, register, listener, predicate, false)
	}

	public onceFront<K extends keyof E>(
		event: K,
		listener: EventListener<E[K]>,
		predicate?: GuardPredicate<E[K]>,
	): Unsubscribe {
		const register = this._singleRegister(event)
		return onceWithOps(this._wrap, register, listener, predicate, true)
	}

	public many<K extends keyof E>(
		event: K,
		times: number,
		listener: EventListener<E[K]>,
		predicate?: GuardPredicate<E[K]>,
	): Unsubscribe {
		const register = this._singleRegister(event)
		return manyWithOps(this._wrap, register, times, listener, predicate, false)
	}

	public manyFront<K extends keyof E>(
		event: K,
		times: number,
		listener: EventListener<E[K]>,
		predicate?: GuardPredicate<E[K]>,
	): Unsubscribe {
		const register = this._singleRegister(event)
		return manyWithOps(this._wrap, register, times, listener, predicate, true)
	}

	public when<K extends keyof E>(
		event: K,
		predicate?: GuardPredicate<E[K]>,
	): WhenGuard<E[K]> {
		const register = this._singleRegister(event)
		return createWhenGuard(this._wrap, register, predicate)
	}

	public waitFor<K extends keyof E>(
		event: K,
		options: EventureWaitForOptions<E, K> = {},
	): EventureWaitForPromise<E, K> {
		const register = this._singleRegister(event)
		return waitForSingle(this._wrap, register, options, String(event))
	}

	public fire<K extends keyof E>(
		event: K,
		...args: EventArgs<E[K]>
	): Generator<EventureFireSyncResult<E, K>>
	public fire<K extends keyof E>(
		listeners: EventListener<E[K]>[],
		...args: EventArgs<E[K]>
	): Generator<EventureFireSyncResult<E, K>>
	public fire<K extends keyof E>(
		eventOrListeners: K | EventListener<E[K]>[],
		...args: EventArgs<E[K]>
	): Generator<FireSyncRecord<E[K]>> {
		const listeners = Array.isArray(eventOrListeners)
			? eventOrListeners
			: this.listenersUnsafe(eventOrListeners)
		return fireFromListeners(listeners, args)
	}

	public fireAsync<K extends keyof E>(
		event: K,
		...args: EventArgs<E[K]>
	): AsyncGenerator<EventureFireAsyncResult<E, K>>
	public fireAsync<K extends keyof E>(
		listeners: EventListener<E[K]>[],
		...args: EventArgs<E[K]>
	): AsyncGenerator<EventureFireAsyncResult<E, K>>
	public fireAsync<K extends keyof E>(
		eventOrListeners: K | EventListener<E[K]>[],
		...args: EventArgs<E[K]>
	): AsyncGenerator<FireAsyncRecord<E[K]>> {
		const listeners = Array.isArray(eventOrListeners)
			? eventOrListeners
			: this.listenersUnsafe(eventOrListeners)
		return fireAsyncFromListeners(listeners, args)
	}

	public waterfall<K extends WFKeys<E>>(
		event: K,
		...args: EventureSplit<E, K> extends never
			? never[]
			: [...EventureSplit<E, K>['args'], EventureSplit<E, K>['next']]
	): EventureWFResult<E, K>
	public waterfall<K extends WFKeys<E>>(
		event: K,
		...args: EventureSplit<E, K> extends never
			? never[]
			: EventureSplit<E, K>['args']
	): EventureWFResult<E, K>
	public waterfall<K extends WFKeys<E>>(
		listeners: EventListener<E[K]>[],
		...args: EventureSplit<E, K> extends never
			? never[]
			: EventureSplit<E, K>['args']
	): EventureWFResult<E, K>
	public waterfall<K extends WFKeys<E>>(
		listeners: EventListener<E[K]>[],
		...args: EventureSplit<E, K> extends never
			? never[]
			: [...EventureSplit<E, K>['args'], EventureSplit<E, K>['next']]
	): EventureWFResult<E, K>
	public waterfall(eventOrListeners: any, ...args: any[]): WFResult<any> {
		const callbacks: EventListener<any>[] = Array.isArray(eventOrListeners)
			? eventOrListeners
			: this.listenersUnsafe(eventOrListeners)
		return runWaterfall(callbacks, args)
	}
}
