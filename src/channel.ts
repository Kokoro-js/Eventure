import {
	type FireAsyncRecord,
	type FireSyncRecord,
	fireAsyncFromListeners,
	fireFromListeners,
} from './ext/fireShared'
import {
	createWhenGuard,
	type GuardPredicate,
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
	type SplitWaterfall as CoreSplitWaterfall,
	runWaterfall,
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

export type ChannelOptions<D extends EventDescriptor> = Omit<
	EventEmitterOptions<Record<string, D>>,
	'events'
>

export type ChannelFireSyncResult<D extends EventDescriptor> = FireSyncRecord<D>
export type ChannelFireAsyncResult<D extends EventDescriptor> =
	FireAsyncRecord<D>
export type ChannelSplit<D extends EventDescriptor> = CoreSplitWaterfall<D>
export type ChannelWFResult<D extends EventDescriptor> =
	ChannelSplit<D> extends never
		? WFResult<never>
		: WFResult<ChannelSplit<D>['ret']>
export type ChannelWaitForOptions<D extends EventDescriptor> =
	WaitForSingleOptions<D>
export type ChannelWaitForPromise<D extends EventDescriptor> =
	CancellablePromise<EventArgs<D>>

export type ChannelWhenReturn<D extends EventDescriptor> = WhenGuard<D>

export class EvtChannel<D extends EventDescriptor = EventDescriptor> {
	protected _listeners: EventListener<D>[] = []

	protected _maxListeners = 10
	get maxListeners(): number {
		return this._maxListeners
	}
	set maxListeners(count: number) {
		this._maxListeners = count
	}

	protected _logger: Logger
	protected _catchPromiseError: boolean
	protected _checkSyncFuncReturnPromise: boolean
	protected _errorPolicy: ErrorPolicy

	protected _wrap: <T extends (...args: any[]) => any>(listener: T) => T

	protected readonly _singleRegister: RegisterSingle<D>

	constructor(options?: ChannelOptions<D>) {
		this._logger = options?.logger ?? defaultLogger
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

		this._singleRegister = (listener, prepend) =>
			this._register(listener, undefined, prepend ?? false)
	}

	protected _onSyncError(err: unknown): void {
		onSyncError(err, this._errorPolicy, this._logger)
	}

	protected _register(
		listener: EventListener<D>,
		opts?: OnOptions,
		prepend?: boolean,
	): Unsubscribe {
		const signal = opts?.signal
		if (signal?.aborted) return noopSubscription

		const fn = this._wrap(listener)
		const prev = this._listeners
		const next = prepend
			? prependListenerCopy(prev, fn)
			: appendListenerCopy(prev, fn)
		this._listeners = next

		if (next.length > this._maxListeners) {
			this._logger.warn(
				`MaxListenersExceededWarning(remind memory leak): channel has ${next.length} listeners that exceed ${this._maxListeners}`,
			)
		}

		const sub = this._makeSubscription(listener)

		return withAbortSignal(signal, sub)
	}

	protected _makeSubscription(orig: EventListener<D>): Unsubscribe {
		const unsub: Unsubscribe = (() => {
			this.off(orig)
		}) as Unsubscribe
		return attachDispose(unsub)
	}

	public on(listener: EventListener<D>, opts?: OnOptions): Unsubscribe {
		return this._register(listener, opts, false)
	}

	public onFront(
		listener: EventListener<D>,
		opts?: Omit<OnOptions, 'prepend'>,
	): Unsubscribe {
		return this.onAt({ at: 0, signal: opts?.signal }, listener)
	}

	public onAt(
		options: {
			at: number | ((ctx: { count: number }) => number)
			signal?: AbortSignal
		},
		listener: EventListener<D>,
	): Unsubscribe {
		const signal = options.signal
		if (signal?.aborted) return noopSubscription

		const fn = this._wrap(listener)
		const prev = this._listeners
		const count = prev.length
		const at = options.at
		const index =
			typeof at === 'function'
				? resolveInsertIndex(count, at, { count })
				: resolveInsertIndex(count, at)

		const next = insertListenerCopy(prev, index, fn)
		this._listeners = next

		if (next.length > this._maxListeners) {
			this._logger.warn(
				`MaxListenersExceededWarning(remind memory leak): channel has ${next.length} listeners that exceed ${this._maxListeners}`,
			)
		}

		const sub = this._makeSubscription(listener)
		return withAbortSignal(signal, sub)
	}

	public off(listener: EventListener<D>): boolean {
		const prev = this._listeners
		if (prev.length === 0) return false
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
			this._listeners = []
		} else {
			this._listeners = copyWithoutIndex(prev, idx)
		}
		return true
	}

	public clear(): void {
		this._listeners = []
	}

	public emit(...args: EventArgs<D>): number {
		const fns = this._listeners
		if (fns.length === 0) return 0
		const len = fns.length

		if (this._errorPolicy === 'throw') {
			switch (args.length) {
				case 0:
					for (let i = 0; i < len; i++) (fns[i] as any)()
					break
				case 1: {
					const arg0 = args[0]!
					for (let i = 0; i < len; i++) (fns[i] as any)(arg0)
					break
				}
				case 2: {
					const arg0 = args[0]!
					const arg1 = args[1]!
					for (let i = 0; i < len; i++) (fns[i] as any)(arg0, arg1)
					break
				}
				case 3: {
					const arg0 = args[0]!
					const arg1 = args[1]!
					const arg2 = args[2]!
					for (let i = 0; i < len; i++) (fns[i] as any)(arg0, arg1, arg2)
					break
				}
				case 4: {
					const arg0 = args[0]!
					const arg1 = args[1]!
					const arg2 = args[2]!
					const arg3 = args[3]!
					for (let i = 0; i < len; i++)
						(fns[i] as any)(arg0, arg1, arg2, arg3)
					break
				}
				default:
					for (let i = 0; i < len; i++) (fns[i] as any)(...args)
			}
			return len
		}

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

	public async emitAll(
		...args: EventArgs<D>
	): Promise<Awaited<EventResult<D>>[]> {
		const fns = this._listeners
		if (fns.length === 0) return []

		const len = fns.length
		const results = new Array<Awaited<EventResult<D>>>(len)
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

	public async emitSettled(
		...args: EventArgs<D>
	): Promise<EmitSettledRecord<EventListener<D>, Awaited<EventResult<D>>>[]> {
		const fns = this._listeners
		if (fns.length === 0) return []

		const len = fns.length
		const results = new Array<
			EmitSettledRecord<EventListener<D>, Awaited<EventResult<D>>>
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

	public count(): number {
		return this._listeners.length
	}

	public listeners(): EventListener<D>[] {
		return this._listeners.slice()
	}

	public once(
		listener: EventListener<D>,
		predicate?: GuardPredicate<D>,
	): Unsubscribe {
		return onceWithOps(
			this._wrap,
			this._singleRegister,
			listener,
			predicate,
			false,
		)
	}

	public onceFront(
		listener: EventListener<D>,
		predicate?: GuardPredicate<D>,
	): Unsubscribe {
		return onceWithOps(
			this._wrap,
			this._singleRegister,
			listener,
			predicate,
			true,
		)
	}

	public many(
		times: number,
		listener: EventListener<D>,
		predicate?: GuardPredicate<D>,
	): Unsubscribe {
		return manyWithOps(
			this._wrap,
			this._singleRegister,
			times,
			listener,
			predicate,
			false,
		)
	}

	public manyFront(
		times: number,
		listener: EventListener<D>,
		predicate?: GuardPredicate<D>,
	): Unsubscribe {
		return manyWithOps(
			this._wrap,
			this._singleRegister,
			times,
			listener,
			predicate,
			true,
		)
	}

	public when(predicate?: GuardPredicate<D>): ChannelWhenReturn<D> {
		return createWhenGuard(this._wrap, this._singleRegister, predicate)
	}

	public waitFor(options?: ChannelWaitForOptions<D>): ChannelWaitForPromise<D> {
		return waitForSingle(this._wrap, this._singleRegister, options, 'channel')
	}

	public fire(...args: EventArgs<D>): Generator<ChannelFireSyncResult<D>>
	public fire(
		listeners: EventListener<D>[],
		...args: EventArgs<D>
	): Generator<ChannelFireSyncResult<D>>
	public fire(...args: any[]): Generator<ChannelFireSyncResult<D>> {
		if (Array.isArray(args[0])) {
			const [listeners, ...rest] = args as [
				EventListener<D>[],
				...EventArgs<D>[],
			]
			return fireFromListeners(listeners, rest as EventArgs<D>)
		}
		return fireFromListeners(this._listeners, args as EventArgs<D>)
	}

	public fireAsync(
		...args: EventArgs<D>
	): AsyncGenerator<ChannelFireAsyncResult<D>>
	public fireAsync(
		listeners: EventListener<D>[],
		...args: EventArgs<D>
	): AsyncGenerator<ChannelFireAsyncResult<D>>
	public fireAsync(...args: any[]): AsyncGenerator<ChannelFireAsyncResult<D>> {
		if (Array.isArray(args[0])) {
			const [listeners, ...rest] = args as [
				EventListener<D>[],
				...EventArgs<D>[],
			]
			return fireAsyncFromListeners(listeners, rest as EventArgs<D>)
		}
		return fireAsyncFromListeners(this._listeners, args as EventArgs<D>)
	}

	public waterfall(
		...args: ChannelSplit<D> extends never
			? never[]
			: [...ChannelSplit<D>['args'], ChannelSplit<D>['next']]
	): ChannelWFResult<D>
	public waterfall(
		...args: ChannelSplit<D> extends never ? never[] : ChannelSplit<D>['args']
	): ChannelWFResult<D>
	public waterfall(
		listeners: EventListener<D>[],
		...args: ChannelSplit<D> extends never ? never[] : ChannelSplit<D>['args']
	): ChannelWFResult<D>
	public waterfall(
		listeners: EventListener<D>[],
		...args: ChannelSplit<D> extends never
			? never[]
			: [...ChannelSplit<D>['args'], ChannelSplit<D>['next']]
	): ChannelWFResult<D>
	public waterfall(...args: any[]): ChannelWFResult<D> {
		if (Array.isArray(args[0])) {
			const [listeners, ...rest] = args as [EventListener<D>[], ...any[]]
			return runWaterfall(listeners, rest) as any
		}
		return runWaterfall(this._listeners, args) as any
	}
}
