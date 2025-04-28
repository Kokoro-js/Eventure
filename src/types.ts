// types.ts
import type { Logger } from './logger'

export type EventDescriptor =
	| readonly [...any[]] // 任意参数元组
	| ((...args: any[]) => any) // 任意签名函数

/** 事件映射：事件名 -> 描述 */
export interface IEventMap {
	[event: string | symbol]: EventDescriptor
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
export interface EventEmitterOptions<E extends IEventMap = IEventMap> {
	logger?: Logger
	/** 如果提供，就会在构造时预先 `this._listeners[event] = []` */
	events?: Array<keyof E>
}
