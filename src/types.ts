// types.ts
/** biome-ignore-all lint/suspicious/noConfusingVoidType: <explanation> */
import type { Logger } from './logger'

export type EventDescriptor = readonly [...any[]] | ((...args: any[]) => any)

export type IEventMap<T> = { [K in keyof T]: EventDescriptor }

/** —— 工具类型 —— */
export type EventArgs<D extends EventDescriptor> = D extends (
	...args: infer A
) => any
	? A
	: D extends readonly [...infer T]
		? T
		: never

export type Awaitable<T> = T | Promise<T>
export type EventResult<D extends EventDescriptor> = D extends (
	...args: any[]
) => infer R
	? R
	: void

export type EventListener<D extends EventDescriptor> = (
	...args: EventArgs<D>
) => EventResult<D>

export type UnsubscribeFunction = () => void
export type Unsubscribe = UnsubscribeFunction & {
	[Symbol.dispose]?: () => void
}

/** —— 注册参数 —— */
export interface OnOptions {
	/** 是否前插（默认尾插） */
	prepend?: boolean
	/** 绑定 AbortSignal，触发后自动退订 */
	signal?: AbortSignal
}

/** —— 运行时错误策略 —— */
export type ErrorPolicy = 'silent' | 'log' | 'throw'

/** —— 监听器包裹策略（供 utils 与 Options 共享） —— */
export interface ListenerWrapPolicy {
	/** 是否捕获/规避异步监听器的 rejection（默认 true） */
	catchPromiseError?: boolean
	/** 是否处理“同步函数返回 Promise”之类的行为（默认 false） */
	checkSyncFuncReturnPromise?: boolean
	/** 同步/异步错误处理策略（默认 'log'） */
	errorPolicy?: ErrorPolicy
}

/** —— 构造参数：继承策略类型，附加 logger & 事件预分配 —— */
export interface EventEmitterOptions<
	E extends { [K in keyof E]: EventDescriptor } = Record<
		string,
		EventDescriptor
	>,
> extends ListenerWrapPolicy {
	logger?: Logger
	/** 如果提供，就会在构造时预先 `this._listeners[event] = []` */
	events?: Array<keyof E>
}
