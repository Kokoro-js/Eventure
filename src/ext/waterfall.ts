import type {
	EventArgs,
	EventDescriptor,
	EventListener,
	IEventMap,
	Unsubscribe,
} from '@/types'
import type { Eventure } from '..'

/** 拆出哪些事件是“带 next”的流水线事件 */
export type SplitWaterfall<D extends EventDescriptor> = D extends (
	...args: [...infer P, infer N]
) => infer R
	? N extends (...args: any[]) => any
		? { args: P; next: N; ret: R }
		: never
	: never

export type WFKeys<EM extends IEventMap> = {
	[K in keyof EM]: SplitWaterfall<EM[K]> extends never ? never : K
}[keyof EM]

/** 工具：把 [...P, N] 拆成 [P, N] */
function splitArgsAndNext<D extends EventDescriptor>(
	tuple: [...SplitWaterfall<D>['args'], SplitWaterfall<D>['next']],
): [args: SplitWaterfall<D>['args'], next: SplitWaterfall<D>['next']] {
	// 这里断言一次就够了
	const next = tuple[tuple.length - 1] as SplitWaterfall<D>['next']
	const args = tuple.slice(0, -1) as SplitWaterfall<D>['args']
	return [args, next]
}

// a) 严格模式：完整传入 [...P, next]
export function waterfall<EM extends IEventMap, K extends WFKeys<EM>>(
	this: Eventure<EM>,
	event: K,
	...argsAndNext: [
		...SplitWaterfall<EM[K]>['args'],
		SplitWaterfall<EM[K]>['next'],
	]
): SplitWaterfall<EM[K]>['ret']

// b) 简易模式：只传 [...P]，自动用一个 no-op 做 inner callback
export function waterfall<EM extends IEventMap, K extends WFKeys<EM>>(
	this: Eventure<EM>,
	event: K,
	...args: SplitWaterfall<EM[K]>['args']
): SplitWaterfall<EM[K]>['ret']

// —— 3. 真正的实现（放最后） ——
export function waterfall(
	this: any,
	event: any,
	...argsAndMaybeNext: any[]
): any {
	// 如果最后一个是函数，就当作 inner；否则 inner = no-op
	const last = argsAndMaybeNext[argsAndMaybeNext.length - 1]
	const isNextFn = typeof last === 'function'
	const inner = isNextFn ? last : () => {}
	const args = isNextFn ? argsAndMaybeNext.slice(0, -1) : argsAndMaybeNext

	const cbs = this.queryListeners(event)
	// 包装成同一签名的 listener 队列
	const pipeline: ((...all: any[]) => any)[] = [
		...cbs,
		// 最后一个 inner 也保持同签名
		(...all: any[]) => inner(...all.slice(0, all.length - 1)),
	]

	// next 函数
	const next = (...callArgs: any[]) => {
		const cb = pipeline.shift()!
		return cb(...callArgs, next)
	}

	// 启动
	return next(...args)
}
