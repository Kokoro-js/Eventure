import { type Logger, defaultLogger } from './logger'
// eventified.ts
import type {
	EventArgs,
	EventEmitterOptions,
	EventListener,
	EventResult,
	IEventMap,
	Unsubscribe,
} from './types'
export * from './types'

export const IS_ASYNC = Symbol('is_async')
export const ORIGFUNC = Symbol('orig')
export class Eventure<E extends IEventMap> {
	// ✓ 针对每个 K 保持正确的 listener 类型
	protected _listeners: { [K in keyof E]?: EventListener<E[K]>[] } = {}
	protected _activeEvents = new Set<keyof E>()
	protected _maxListeners = 100
	get maxListeners() {
		return this._maxListeners
	}
	set maxListeners(count: number) {
		this._maxListeners = count
	}
	protected _logger: Logger
	protected _catchPromiseError: boolean
	protected _checkSyncFuncReturnPromise: boolean

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
	}

	public wrapHelper(
		// biome-ignore lint/complexity/noBannedTypes: <explanation>
		listener: Function,
	): EventListener<any> {
		const isNativeAsync = listener.constructor.name === 'AsyncFunction'
		// 是否需要包裹：必须开启 catchPromiseError，且 (函数原生 async 或者 开启了 checkSyncFuncReturnPromise)
		const shouldWrap =
			this._catchPromiseError &&
			(isNativeAsync || this._checkSyncFuncReturnPromise)
		if (!shouldWrap) {
			return listener as EventListener<any>
		}

		const wrapped: EventListener<any> = (...args) => {
			const result = listener(...args)
			if (result && typeof (result as Promise<any>).then === 'function') {
				return (result as Promise<any>).catch((err: any) => {
					this._logger.error(err)
					return err
				})
			}
			return result
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
		const prev = this._listeners[event] ?? []

		// 复制一份新数组并替换
		const next = prepend ? [fn, ...prev] : [...prev, fn]

		this._listeners[event] = next

		if (next.length > this._maxListeners) {
			const msg = `MaxListenersExceededWarning: '${String(event)}' 已有 ${next.length} 个监听器，超过最大 ${this._maxListeners}`
			this._logger.warn(msg) ?? console.warn(msg)
		}
	}

	// ───────── on = alias(addListener) ─────────
	public on: typeof this.addListener = this.addListener

	// —— off / removeListener ——
	public off<K extends keyof E>(event: K, listener: EventListener<E[K]>): this {
		const prev = this._listeners[event]
		if (!prev) return this

		// 复制一份新数组，滤除掉被移除的 listener
		const next = prev.filter(
			(fn) => fn !== listener && (fn as any)[ORIGFUNC] !== listener,
		)

		this._listeners[event] = next
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

	// —— emit ——
	/**
	 * 通用的 listeners 查询／处理接口：
	 * - 不传 options：返回当前 listeners 的快照数组
	 * - 传 filter：先 filter 再返回快照
	 * - 传 map：在 (filter 之后) 对每个 listener 调用 map
	 */
	public queryListeners<K extends keyof E, R = EventListener<E[K]>>(
		event: K,
		options?: {
			filter?: (listener: EventListener<E[K]>) => boolean
			map?: (listener: EventListener<E[K]>) => R
		},
	): R[] {
		// 必须返回拷贝才能保证功能正确，否则 once 这些在你没执行完就已经编辑原 arr 了(比如删除)会导致触发器混乱
		const list = this._listeners[event] ?? []
		const filtered = options?.filter ? list.filter(options.filter) : list
		return options?.map
			? filtered.map(options.map)
			: // 类型断言：当 map 不存在时，R == EventListener<E[K]>
				(filtered as unknown as R[])
	}

	public emit<K extends keyof E>(event: K, ...args: EventArgs<E[K]>): this {
		for (const fn of this.queryListeners(event)) {
			try {
				fn(...args)
			} catch {}
		}
		return this
	}

	public async emitCollect<K extends keyof E>(
		event: K,
		...args: EventArgs<E[K]>
	): Promise<EventResult<E[K]>[]> {
		const results = await Promise.all(
			this.queryListeners(event, { map: (fn) => fn(...args) }),
		)
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
		return this._listeners[event]?.slice() ?? []
	}

	public removeAllListeners<K extends keyof E>(event?: K): this {
		if (event !== undefined) {
			this._listeners[event] = []
			this._activeEvents.delete(event)
		} else {
			for (const ev of this._activeEvents) {
				this._listeners[ev] = []
			}
			this._activeEvents.clear()
		}
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

export interface Eventure<E extends IEventMap> extends extra {}
