// types.ts
import type { Logger } from './logger'

export type EventDescriptor =
	| readonly [...any[]] // 任意参数元组
	| ((...args: any[]) => any) // 任意签名函数

export type IEventMap<T> = {
	[K in keyof T]: EventDescriptor
}

/** ——— 原有工具类型 —— */
/** 提取参数列表 */
export type EventArgs<D extends EventDescriptor> = D extends (
	...args: infer A
) => any
	? A
	: D extends readonly [...infer T]
		? T
		: never

/** 提取返回值 */
export type Awaitable<T> = T | Promise<T>
export type EventResult<D extends EventDescriptor> = D extends (
	...args: any[]
) => infer R
	? R
	: // biome-ignore lint/suspicious/noConfusingVoidType: <explanation>
		void

/** 根据描述生成监听器类型 */
export type EventListener<D extends EventDescriptor> = (
	...args: EventArgs<D>
) => EventResult<D>

/** 取消订阅函数 */
export type Unsubscribe = () => void

/** 构造时可选项，支持 logger 和预分配事件 */
export interface EventEmitterOptions<
	E extends { [K in keyof E]: EventDescriptor } = Record<
		string,
		EventDescriptor
	>,
> {
	logger?: Logger
	/** 如果提供，就会在构造时预先 `this._listeners[event] = []` */
	events?: Array<keyof E>
	// 默认开启，用以决定库是否帮你 catch 可能的异步错误，对异步监听器性能有影响，极端情况(1e6 RUNS往上)下 -40% 性能，但推荐开启，因为大部分时候安全比性能更重要
	catchPromiseError?: boolean
	// 默认关闭，用以决定库是否帮你处理一些行为怪异的监听器，比如在同步函数返回 Promise 的行为等，开启会大幅度降低高频下同步函数的性能。
	checkSyncFuncReturnPromise?: boolean
}
