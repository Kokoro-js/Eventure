// eventified.ts
import { defaultLogger, type Logger } from './logger'
import { IS_ASYNC, ORIGFUNC } from './symbol'
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

export * as Symbol from './symbol'
export * from './types'
export class Eventure<
	E extends IEventMap<E> = Record<string | symbol, EventDescriptor>,
> {
	// ✓ 针对每个 K 保持正确的 listener 类型
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

	constructor(options?: EventEmitterOptions<E>) {
		this._logger = options?.logger ?? defaultLogger
		if (options?.events) {
			for (const ev of options.events) {
				this._listeners[ev] = []
			}
		}
		this._catchPromiseError = options?.catchPromiseError ?? true
		this._checkSyncFuncReturnPromise =
			options?.checkSyncFuncReturnPromise ?? false
		this._errorPolicy = options?.errorPolicy ?? 'log'
	}

	// —— 统一的同步错误处理（emit 路径 & 包裹内同步异常）——
	private _onSyncError(err: unknown): void {
		switch (this._errorPolicy) {
			case 'log':
				this._logger.error(err)
				return
			case 'throw':
				throw err
			// 'silent'：忽略
		}
	}

	public wrapHelper(
		// biome-ignore lint/complexity/noBannedTypes: <低层通用函数签名>
		listener: Function,
	): EventListener<any> {
		// 已包裹过（来自 once/waterfall 等），直接复用，避免重复包裹
		if ((listener as any)[ORIGFUNC]) return listener as EventListener<any>

		const isNativeAsync = listener.constructor.name === 'AsyncFunction'
		// 是否需要包裹：必须开启 catchPromiseError，且 (函数原生 async 或者 开启了 checkSyncFuncReturnPromise)
		const shouldWrap =
			this._catchPromiseError &&
			(isNativeAsync || this._checkSyncFuncReturnPromise)

		if (!shouldWrap) return listener as EventListener<any>

		const wrapped: EventListener<any> = (...args) => {
			try {
				const result = listener(...args)
				// 可能返回 Promise：拦截 rejection
				if (result && typeof (result as any).then === 'function') {
					return (result as Promise<any>).catch((err) => {
						if (this._errorPolicy === 'log') {
							this._logger.error(err)
							return err
						}
						if (this._errorPolicy === 'throw') {
							// 继续向上以 rejected promise 形式冒泡
							return Promise.reject(err)
						}
						// silent
						return err
					})
				}
				return result
			} catch (err) {
				// 同步异常
				if (this._errorPolicy === 'log') {
					this._logger.error(err)
					return err as any
				}
				if (this._errorPolicy === 'throw') {
					throw err
				}
				// silent：返回错误对象（与 async 分支保持一致返回值形态）
				return err as any
			}
		}

		Object.defineProperty(wrapped, ORIGFUNC, {
			value: listener,
			writable: false,
		})
		Object.defineProperty(wrapped, IS_ASYNC, {
			value: isNativeAsync,
			writable: false,
		})

		return wrapped
	}

	protected _add<K extends keyof E>(
		event: K,
		listener: EventListener<E[K]>,
		prepend: boolean,
	): void {
		const fn = this.wrapHelper(listener)
		const prev = this._listeners[event]
		// 避免在 emit 期间被 on/off 影响当前批次
		const next = prepend ? [fn, ...(prev ?? [])] : prev ? [...prev, fn] : [fn]
		this._listeners[event] = next

		// 维护活跃事件集合
		if (next.length > 0) this._activeEvents.add(event)

		if (next.length > this._maxListeners) {
			this._logger.warn(
				`MaxListenersExceededWarning(remind memory leak): '${String(event)}' has ${
					next.length
				} listeners that exceed ${this._maxListeners}`,
			)
		}
	}

	// —— on / prependOn ——
	public on<K extends keyof E>(event: K, listener: EventListener<E[K]>): this {
		this._add(event, listener, /*prepend=*/ false)
		return this
	}

	public prependOn<K extends keyof E>(
		event: K,
		listener: EventListener<E[K]>,
	): this {
		this._add(event, listener, /*prepend=*/ true)
		return this
	}

	// —— off / removeListener ——（保持与 ORIGFUNC 一致的去重语义）
	public off<K extends keyof E>(event: K, listener: EventListener<E[K]>): this {
		const prev = this._listeners[event]
		if (!prev) return this

		// 复制一份新数组，滤除掉被移除的 listener
		const next = prev.filter(
			(fn) => fn !== listener && (fn as any)[ORIGFUNC] !== listener,
		)

		if (next.length === 0) {
			// 不 delete，避免 shape 抖动；留个 empty slot（undefined）
			this._listeners[event] = undefined
			this._activeEvents.delete(event)
		} else {
			this._listeners[event] = next
		}
		return this
	}

	public removeListener = this.off

	// ───────── addListener ─────────
	public addListener<K extends keyof E>(
		event: K,
		listener: EventListener<E[K]>,
	): this
	public addListener<K extends keyof E>(
		event: K,
		listener: EventListener<E[K]>,
		returnUnsub: true,
	): Unsubscribe
	public addListener<K extends keyof E>(
		event: K,
		listener: EventListener<E[K]>,
		returnUnsub = false,
	): this | Unsubscribe {
		this._add(event, listener, /*prepend=*/ false)
		if (!returnUnsub) return this
		return () => this.off(event, listener)
	}

	// ───────── prependListener ─────────
	public prependListener<K extends keyof E>(
		event: K,
		listener: EventListener<E[K]>,
	): this
	public prependListener<K extends keyof E>(
		event: K,
		listener: EventListener<E[K]>,
		returnUnsub: true,
	): Unsubscribe
	public prependListener<K extends keyof E>(
		event: K,
		listener: EventListener<E[K]>,
		returnUnsub = false,
	): this | Unsubscribe {
		this._add(event, listener, /*prepend=*/ true)
		if (!returnUnsub) return this
		return () => this.off(event, listener)
	}

	// —— emit ——（在对监听器数组做更改时已经是不可变更改，不需要任何 slice）
	public emit<K extends keyof E>(event: K, ...args: EventArgs<E[K]>): this {
		const fns = this._listeners[event]
		if (!fns || fns.length === 0) return this

		// 预取长度避免循环中属性访问开销
		const len = fns.length

		switch (args.length) {
			case 0: {
				for (let i = 0; i < len; i++) {
					try {
						;(fns[i] as any)()
					} catch (err) {
						this._onSyncError(err)
					}
				}
				break
			}
			case 1: {
				for (let i = 0; i < len; i++) {
					try {
						;(fns[i] as any)(args[0])
					} catch (err) {
						this._onSyncError(err)
					}
				}
				break
			}
			case 2: {
				for (let i = 0; i < len; i++) {
					try {
						;(fns[i] as any)(args[0], args[1])
					} catch (err) {
						this._onSyncError(err)
					}
				}
				break
			}
			case 3: {
				for (let i = 0; i < len; i++) {
					try {
						;(fns[i] as any)(args[0], args[1], args[2])
					} catch (err) {
						this._onSyncError(err)
					}
				}
				break
			}
			case 4: {
				for (let i = 0; i < len; i++) {
					try {
						;(fns[i] as any)(args[0], args[1], args[2], args[3])
					} catch (err) {
						this._onSyncError(err)
					}
				}
				break
			}
			default: {
				for (let i = 0; i < len; i++) {
					try {
						;(fns[i] as any)(...args)
					} catch (err) {
						this._onSyncError(err)
					}
				}
			}
		}

		return this
	}

	public async emitCollect<K extends keyof E>(
		event: K,
		...args: EventArgs<E[K]>
	): Promise<EventResult<E[K]>[]> {
		const fns = this._listeners[event]
		if (!fns || fns.length === 0) return [] as EventResult<E[K]>[]

		// wrapHelper 已按策略处理 async rejection：
		// - log：吞并记录，结果位置放错误对象
		// - throw：保持 rejected 使 Promise.all 直接 reject
		// - silent：吞并不报
		const calls = new Array(fns.length)
		for (let i = 0; i < fns.length; i++) {
			calls[i] = (fns[i] as any)(...args)
		}
		const results = await Promise.all(calls)
		return results as EventResult<E[K]>[]
	}

	// —— 其他方法 ——
	public listenerCount<K extends keyof E>(event: K): number {
		return this._listeners[event]?.length ?? 0
	}

	public eventNames(): Array<keyof E> {
		return Array.from(this._activeEvents)
	}

	public listeners<K extends keyof E>(event: K): EventListener<E[K]>[] {
		// 对外暴露副本，防止外部篡改内部数组
		return this._listeners[event]?.slice() ?? []
	}

	protected queryListeners<K extends keyof E>(event: K): EventListener<E[K]>[] {
		// 内部查询（无需 slice）
		return this._listeners[event] ?? []
	}

	public removeAllListeners<K extends keyof E>(event?: K): this {
		if (event === undefined) {
			this._listeners = Object.create(null)
			this._activeEvents.clear()
			return this
		}

		// 不 delete，避免 shape 抖动；留个 empty slot（undefined）
		this._listeners[event] = undefined
		this._activeEvents.delete(event)

		return this
	}
}

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
