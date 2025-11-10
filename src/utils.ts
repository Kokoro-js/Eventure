// utils.ts
import type { Logger } from './logger'
import type { ErrorPolicy, ListenerWrapPolicy } from './types'

/** —— 常量符号（原 symbol.ts 并入） —— */
export const IS_ASYNC = Symbol.for('eventure:is_async')
export const ORIGFUNC = Symbol.for('eventure:orig')

/** —— 工具类型 —— */
export type WrapOptions = Required<ListenerWrapPolicy> & { logger: Logger }

/** 原生 async 函数判定（比 instanceof AsyncFunction 更稳） */
export function isNativeAsync(fn: Function): boolean {
	return fn.constructor.name === 'AsyncFunction'
}

/** Promise-like 判定（最小成本） */
export function isPromiseLike(x: unknown): x is Promise<unknown> {
	return !!x && typeof (x as any).then === 'function'
}

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
		// 'silent'：不处理
	}
}

/** 对监听器进行按策略包裹（附带 ORIGFUNC / IS_ASYNC 元数据） */
export function wrapListener<T extends Function>(
	listener: T,
	opts: WrapOptions,
): T {
	// 已包裹过（如来自 once / waterfall），直接复用
	if ((listener as any)[ORIGFUNC]) return listener as any

	const nativeAsync = isNativeAsync(listener)
	const shouldWrap =
		opts.catchPromiseError && (nativeAsync || opts.checkSyncFuncReturnPromise)

	if (!shouldWrap) return listener as any

	const wrapped = ((...args: any[]) => {
		try {
			const r = (listener as any)(...args)
			if (isPromiseLike(r)) {
				return r.catch((err: unknown) => {
					if (opts.errorPolicy === 'log') {
						opts.logger.error(err)
						return err
					}
					if (opts.errorPolicy === 'throw') {
						return Promise.reject(err)
					}
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
	}) as unknown as T

	Object.defineProperty(wrapped, ORIGFUNC, { value: listener, writable: false })
	Object.defineProperty(wrapped, IS_ASYNC, {
		value: nativeAsync,
		writable: false,
	})

	return wrapped
}

/** 预绑定策略，避免热路径反复构造 opts 对象 */
export function createWrapHelper(opts: WrapOptions) {
	return function wrap<T extends Function>(listener: T): T {
		return wrapListener(listener, opts)
	}
}
