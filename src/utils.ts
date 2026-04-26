// utils.ts
import type { Logger } from './logger'
import type { ErrorPolicy, ListenerWrapPolicy, Unsubscribe } from './types'

/** —— 常量符号（原 symbol.ts 并入） —— */
export const IS_ASYNC = Symbol.for('eventure:is_async')
export const ORIGFUNC = Symbol.for('eventure:orig')

const SYMBOL_DISPOSE: symbol | undefined = (Symbol as any).dispose

/** —— 工具类型 —— */
export type WrapOptions = Required<ListenerWrapPolicy> & { logger: Logger }

/** 原生 async 函数判定（比 instanceof AsyncFunction 更稳） */
export function isNativeAsync(fn: { constructor: { name: string } }): boolean {
	return fn.constructor.name === 'AsyncFunction'
}

/** Promise-like 判定（最小成本） */
export function isPromiseLike(x: unknown): x is Promise<unknown> {
	return x !== null && x !== undefined && typeof (x as any).then === 'function'
}

export function attachDispose<T extends Unsubscribe>(unsub: T): T {
	if (SYMBOL_DISPOSE) (unsub as any)[SYMBOL_DISPOSE] = unsub
	return unsub
}

export const noopSubscription: Unsubscribe = attachDispose(
	(() => {}) as Unsubscribe,
)

/** 同步异常处理（emit 热路径使用） */
export function onSyncError(
	err: unknown,
	policy: ErrorPolicy,
	logger: Logger,
): void {
	switch (policy) {
		case 'log':
			logger.error(err)
			return
		case 'throw':
			throw err
		case 'silent':
			break
	}
}

/** 对监听器进行按策略包裹（附带 ORIGFUNC / IS_ASYNC 元数据） */
export function wrapListener<T extends (...args: any[]) => any>(
	listener: T,
	opts: WrapOptions,
): T {
	// 已包裹过（如来自 once / waterfall），直接复用
	if ((listener as any)[ORIGFUNC] !== undefined) return listener as any

	if (!opts.catchPromiseError) return listener as any

	const nativeAsync = isNativeAsync(listener)
	if (!opts.checkSyncFuncReturnPromise && !nativeAsync) return listener as any

	const wrapped = ((...args: Parameters<T>) => {
		try {
			const r = listener(...args)
			if (isPromiseLike(r)) {
				const promise =
					typeof (r as any).catch === 'function'
						? (r as any)
						: Promise.resolve(r)
				return promise.catch((err: unknown) => {
					if (opts.errorPolicy === 'log') {
						opts.logger.error(err)
						return err
					}
					if (opts.errorPolicy === 'throw') throw err
					// silent
					return err
				})
			}
			return r
		} catch (err) {
			if (opts.errorPolicy === 'log') {
				opts.logger.error(err)
				return err as any
			}
			if (opts.errorPolicy === 'throw') throw err
			// silent：返回错误对象以保持返回形态一致
			return err as any
		}
	}) as T

	Object.defineProperty(wrapped, ORIGFUNC, { value: listener, writable: false })
	Object.defineProperty(wrapped, IS_ASYNC, {
		value: nativeAsync,
		writable: false,
	})

	return wrapped
}

/** 预绑定策略，避免热路径反复构造 opts 对象 */
export function createWrapHelper(opts: WrapOptions) {
	return function wrap<T extends (...args: any[]) => any>(listener: T): T {
		return wrapListener(listener, opts)
	}
}

/** Listener array helpers to avoid spread/splice polymorphism on hot paths */
export function appendListenerCopy<T>(prev: T[] | undefined, listener: T): T[] {
	if (!prev || prev.length === 0) return [listener]
	const len = prev.length
	const next = new Array<T>(len + 1)
	for (let i = 0; i < len; i++) next[i] = prev[i]!
	next[len] = listener
	return next
}

export function prependListenerCopy<T>(
	prev: T[] | undefined,
	listener: T,
): T[] {
	if (!prev || prev.length === 0) return [listener]
	const len = prev.length
	const next = new Array<T>(len + 1)
	next[0] = listener
	for (let i = 0; i < len; i++) next[i + 1] = prev[i]!
	return next
}

export function copyWithoutIndex<T>(prev: T[], removeIndex: number): T[] {
	const len = prev.length
	const next = new Array<T>(len - 1)
	for (let i = 0, j = 0; i < len; i++) {
		if (i === removeIndex) continue
		next[j++] = prev[i]!
	}
	return next
}

export function insertListenerCopy<T>(
	prev: T[] | undefined,
	insertIndex: number,
	listener: T,
): T[] {
	if (!prev || prev.length === 0) return [listener]
	if (insertIndex <= 0) return prependListenerCopy(prev, listener)
	const len = prev.length
	if (insertIndex >= len) return appendListenerCopy(prev, listener)

	const next = new Array<T>(len + 1)
	for (let i = 0; i < insertIndex; i++) next[i] = prev[i]!
	next[insertIndex] = listener
	for (let i = insertIndex; i < len; i++) next[i + 1] = prev[i]!
	return next
}

export function resolveInsertIndex<Ctx>(
	count: number,
	at: number | ((ctx: Ctx) => number),
	ctx?: Ctx,
): number {
	const raw = typeof at === 'function' ? at(ctx as Ctx) : at
	if (typeof raw !== 'number' || !Number.isFinite(raw)) return count
	return Math.min(count, Math.max(0, Math.trunc(raw)))
}

export function withAbortSignal(
	signal: AbortSignal | undefined,
	sub: Unsubscribe,
): Unsubscribe {
	if (!signal) return sub

	let settled = false
	const abortUnsub = () => {
		if (settled) return
		settled = true
		signal.removeEventListener('abort', abortUnsub)
		sub()
	}
	signal.addEventListener('abort', abortUnsub, { once: true })

	const wrappedSub: Unsubscribe = (() => {
		if (settled) return
		settled = true
		signal.removeEventListener('abort', abortUnsub)
		sub()
	}) as Unsubscribe
	return attachDispose(wrappedSub)
}
