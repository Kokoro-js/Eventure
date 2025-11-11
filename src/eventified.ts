// eventified.ts
import { defaultLogger, type Logger } from './logger'
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
import { createWrapHelper, ORIGFUNC, onSyncError } from './utils'

/** 统一的注册选项：保持入参稳定，有利于内联与JIT */
export interface OnOptions {
	/** 是否前插（默认尾插） */
	prepend?: boolean
	/** 绑定 AbortSignal，触发后自动退订 */
	signal?: AbortSignal
}

/** 订阅句柄：函数即对象，兼容 using/RAII */
type Subscription = Unsubscribe & { [Symbol.dispose]?: () => void }

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

	/** 统一注册：返回 Subscription（函数），避免重载与布尔位 */
	public on<K extends keyof E>(
		event: K,
		listener: EventListener<E[K]>,
		opts?: OnOptions,
	): Subscription {
		// 若 signal 已经 aborted，直接返回空操作句柄，避免注册后又立刻退订的抖动
		if (opts?.signal?.aborted) return (() => {}) as Subscription

		const fn = this._wrap(listener) as EventListener<E[K]>
		const prev = this._listeners[event]
		const next = opts?.prepend
			? [fn, ...(prev ?? [])]
			: prev
				? [...prev, fn]
				: [fn]
		this._listeners[event] = next

		if (next.length > 0) this._activeEvents.add(event)
		if (next.length > this._maxListeners) {
			this._logger.warn(
				`MaxListenersExceededWarning(remind memory leak): '${String(event)}' has ${next.length} listeners that exceed ${this._maxListeners}`,
			)
		}

		const sub = this._makeSubscription(event, listener)

		// 绑定 AbortSignal：触发后自动退订（不捕获，保持同步语义）
		if (opts?.signal) {
			const abortUnsub = () => {
				sub()
				opts.signal!.removeEventListener('abort', abortUnsub)
			}
			opts.signal.addEventListener('abort', abortUnsub, { once: true })
		}
		return sub
	}

	/** 前插语义的快捷方式，等价于 on(event, listener, { prepend: true }) */
	public onFront<K extends keyof E>(
		event: K,
		listener: EventListener<E[K]>,
		opts?: Omit<OnOptions, 'prepend'>,
	): Subscription {
		return this.on(event, listener, { ...opts, prepend: true })
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
			const next = prev.slice(0, idx).concat(prev.slice(idx + 1))
			this._listeners[event] = next
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
			case 1:
				for (let i = 0; i < len; i++) {
					try {
						;(fns[i] as any)(args[0])
					} catch (err) {
						this._onSyncError(err)
					}
				}
				break
			case 2:
				for (let i = 0; i < len; i++) {
					try {
						;(fns[i] as any)(args[0], args[1])
					} catch (err) {
						this._onSyncError(err)
					}
				}
				break
			case 3:
				for (let i = 0; i < len; i++) {
					try {
						;(fns[i] as any)(args[0], args[1], args[2])
					} catch (err) {
						this._onSyncError(err)
					}
				}
				break
			case 4:
				for (let i = 0; i < len; i++) {
					try {
						;(fns[i] as any)(args[0], args[1], args[2], args[3])
					} catch (err) {
						this._onSyncError(err)
					}
				}
				break
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
	protected queryListeners<K extends keyof E>(event: K): EventListener<E[K]>[] {
		return this._listeners[event] ?? []
	}
}

/** —— 扩展模块混入（保持不变） —— */
import * as fire from './ext/fire'
import * as ext_remover from './ext/once'
import * as waitFor from './ext/waitFor'
import * as waterfall from './ext/waterfall'

Object.assign(Eventure.prototype, {
	...ext_remover,
	...waitFor,
	...fire,
	...waterfall,
})
type extra = typeof ext_remover &
	typeof waitFor &
	typeof fire &
	typeof waterfall
export interface Eventure extends extra {}
