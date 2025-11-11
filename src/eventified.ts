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
import type { OnOptions } from './options'
import type {
	ErrorPolicy,
	EventArgs,
	EventDescriptor,
	EventEmitterOptions,
	EventListener,
	EventResult,
	IEventMap,
	Unsubscribe,
} from './types'
import {
	appendListenerCopy,
	copyWithoutIndex,
	createWrapHelper,
	ORIGFUNC,
	onSyncError,
	prependListenerCopy,
} from './utils'

/** 订阅句柄：函数即对象，兼容 using/RAII */
type Subscription = Unsubscribe & { [Symbol.dispose]?: () => void }

const noopSubscription: Subscription = (() => {}) as Subscription
try {
	;(noopSubscription as any)[Symbol.dispose] = noopSubscription
} catch {
	/* older runtimes may lack Symbol.dispose */
}

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
	public _wrap: <T extends Function>(listener: T) => T

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

	private _onSyncError(err: unknown): void {
		onSyncError(err, this._errorPolicy, this._logger)
	}

	/** 创建可退订句柄，并实现 [Symbol.dispose] 以支持 using */
	private _makeSubscription<K extends keyof E>(
		event: K,
		orig: EventListener<E[K]>,
	): Subscription {
		const unsub: Subscription = (() => {
			this.off(event, orig)
		}) as Subscription
		// RAII/using：退出作用域自动退订
		try {
			;(unsub as any)[Symbol.dispose] = unsub
		} catch {
			/* 旧环境可忽略 */
		}
		return unsub
	}

	private _register<K extends keyof E>(
		event: K,
		listener: EventListener<E[K]>,
		opts?: OnOptions,
		forcePrepend?: boolean,
	): Subscription {
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

		if (signal) {
			const abortUnsub = () => {
				sub()
				signal.removeEventListener('abort', abortUnsub)
			}
			signal.addEventListener('abort', abortUnsub, { once: true })
		}
		return sub
	}

	/** 统一注册：返回 Subscription（函数），避免重载与布尔位 */
	public on<K extends keyof E>(
		event: K,
		listener: EventListener<E[K]>,
		opts?: OnOptions,
	): Subscription {
		return this._register(event, listener, opts)
	}

	private _singleRegister<K extends keyof E>(event: K): RegisterSingle<E[K]> {
		return (listener, prepend) =>
			this._register(event, listener, undefined, prepend ?? false)
	}

	/** 前插语义的快捷方式，等价于 on(event, listener, { prepend: true }) */
	public onFront<K extends keyof E>(
		event: K,
		listener: EventListener<E[K]>,
		opts?: Omit<OnOptions, 'prepend'>,
	): Subscription {
		return this._register(event, listener, opts, true)
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

	/** 并发收集结果（错误策略沿用 wrap；throw 策略将透传） */
	public async emitCollect<K extends keyof E>(
		event: K,
		...args: EventArgs<E[K]>
	): Promise<EventResult<E[K]>[]> {
		const fns = this._listeners[event]
		if (!fns || fns.length === 0) return [] as EventResult<E[K]>[]
		const calls = new Array(fns.length)
		for (let i = 0; i < fns.length; i++) calls[i] = (fns[i] as any)(...args)
		const results = await Promise.all(calls)
		return results as EventResult<E[K]>[]
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
	public queryListeners<K extends keyof E>(event: K): EventListener<E[K]>[] {
		return this._listeners[event] ?? []
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
		return waitForSingle(this._wrap, register, { ...options }, String(event))
	}

	public fire<K extends keyof E>(
		event: K,
		...args: EventArgs<E[K]>
	): Generator<EventureFireSyncResult<E, K>>
	public fire<K extends keyof E>(
		listeners: EventListener<E[K]>[],
		...args: EventArgs<E[K]>
	): Generator<EventureFireSyncResult<E, K>>
	public fire(
		eventOrListeners: any,
		...args: any[]
	): Generator<FireSyncRecord<any>> {
		if (Array.isArray(eventOrListeners)) {
			return fireFromListeners(eventOrListeners, args)
		}
		return fireFromListeners(this.queryListeners(eventOrListeners), args)
	}

	public fireAsync<K extends keyof E>(
		event: K,
		...args: EventArgs<E[K]>
	): AsyncGenerator<EventureFireAsyncResult<E, K>>
	public fireAsync<K extends keyof E>(
		listeners: EventListener<E[K]>[],
		...args: EventArgs<E[K]>
	): AsyncGenerator<EventureFireAsyncResult<E, K>>
	public fireAsync(
		eventOrListeners: any,
		...args: any[]
	): AsyncGenerator<FireAsyncRecord<any>> {
		if (Array.isArray(eventOrListeners)) {
			return fireAsyncFromListeners(eventOrListeners, args)
		}
		return fireAsyncFromListeners(this.queryListeners(eventOrListeners), args)
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
			: this.queryListeners(eventOrListeners)
		return runWaterfall(callbacks, args.slice())
	}
}
