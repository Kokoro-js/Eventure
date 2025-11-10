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

export class Eventure<
	E extends IEventMap<E> = Record<string | symbol, EventDescriptor>,
> {
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

	/** 预绑定的包装器，避免热路径重建配置对象 */
	protected _wrap: <T extends Function>(listener: T) => T

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

	protected _add<K extends keyof E>(
		event: K,
		listener: EventListener<E[K]>,
		prepend: boolean,
	): void {
		const fn = this._wrap(listener) as EventListener<E[K]>
		const prev = this._listeners[event]
		const next = prepend ? [fn, ...(prev ?? [])] : prev ? [...prev, fn] : [fn]
		this._listeners[event] = next

		if (next.length > 0) this._activeEvents.add(event)

		if (next.length > this._maxListeners) {
			this._logger.warn(
				`MaxListenersExceededWarning(remind memory leak): '${String(event)}' has ${next.length} listeners that exceed ${this._maxListeners}`,
			)
		}
	}

	public on<K extends keyof E>(event: K, listener: EventListener<E[K]>): this {
		this._add(event, listener, false)
		return this
	}
	public prependOn<K extends keyof E>(
		event: K,
		listener: EventListener<E[K]>,
	): this {
		this._add(event, listener, true)
		return this
	}

	public off<K extends keyof E>(event: K, listener: EventListener<E[K]>): this {
		const prev = this._listeners[event]
		if (!prev) return this
		const next = prev.filter(
			(fn) => fn !== listener && (fn as any)[ORIGFUNC] !== listener,
		)

		if (next.length === 0) {
			this._listeners[event] = undefined
			this._activeEvents.delete(event)
		} else {
			this._listeners[event] = next
		}
		return this
	}
	public removeListener = this.off

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
		this._add(event, listener, false)
		if (!returnUnsub) return this
		return () => this.off(event, listener)
	}

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
		this._add(event, listener, true)
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
		return this
	}

	public async emitCollect<K extends keyof E>(
		event: K,
		...args: EventArgs<E[K]>
	): Promise<EventResult<E[K]>[]> {
		const fns = this._listeners[event]
		if (!fns || fns.length === 0) return [] as EventResult<E[K]>[]

		const calls = new Array(fns.length)
		for (let i = 0; i < fns.length; i++) calls[i] = (fns[i] as any)(...args)
		const results = await Promise.all(calls) // 'throw' 策略将直接在此处 reject
		return results as EventResult<E[K]>[]
	}

	public listenerCount<K extends keyof E>(event: K): number {
		return this._listeners[event]?.length ?? 0
	}
	public eventNames(): Array<keyof E> {
		return Array.from(this._activeEvents)
	}
	public listeners<K extends keyof E>(event: K): EventListener<E[K]>[] {
		return this._listeners[event]?.slice() ?? []
	}
	protected queryListeners<K extends keyof E>(event: K): EventListener<E[K]>[] {
		return this._listeners[event] ?? []
	}
	public removeAllListeners<K extends keyof E>(event?: K): this {
		if (event === undefined) {
			this._listeners = Object.create(null)
			this._activeEvents.clear()
			return this
		}
		this._listeners[event] = undefined
		this._activeEvents.delete(event)
		return this
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
