import type { EventDescriptor, EventListener, IEventMap } from '@/types'
import type { Eventure } from '..'

/** 拆出 "带 next" 的流水线事件 */
export type SplitWaterfall<D extends EventDescriptor> = D extends (
	...args: [...infer P, infer N]
) => infer R
	? N extends (...args: any[]) => any
		? { args: P; next: N; ret: R }
		: never
	: never

export type WFKeys<E extends IEventMap<E>> = {
	[K in keyof E]: SplitWaterfall<E[K]> extends never ? never : K
}[keyof E]

/** 返回值包装，支持 TS 判别 */
export type WFResult<R> = { ok: true; value: R } | { ok: false; value: R }

// a) 严格模式：完整传入 [...P, next]
export function waterfall<E extends IEventMap<E>, K extends WFKeys<E>>(
	this: Eventure<E>,
	eventOrListeners: K | EventListener<E[K]>[],
	...argsAndNext: [
		...SplitWaterfall<E[K]>['args'],
		SplitWaterfall<E[K]>['next'],
	]
): WFResult<SplitWaterfall<E[K]>['ret']>

// b) 简易模式：只传 [...P]，自动 no-op 作为 inner
export function waterfall<E extends IEventMap<E>, K extends WFKeys<E>>(
	this: Eventure<E>,
	eventOrListeners: K | EventListener<E[K]>[],
	...args: SplitWaterfall<E[K]>['args']
): WFResult<SplitWaterfall<E[K]>['ret']>

// —— 真正实现 ——
export function waterfall(
	this: any,
	eventOrListeners: any,
	...argsAndMaybeNext: any[]
): WFResult<any> {
	const cbs: EventListener<any>[] = Array.isArray(eventOrListeners)
		? eventOrListeners
		: this.queryListeners(eventOrListeners)

	const last = argsAndMaybeNext[argsAndMaybeNext.length - 1]
	const hasInner = typeof last === 'function'
	// biome-ignore lint/complexity/noBannedTypes: <explanation>
	const inner: Function = hasInner ? last : () => {}
	const args = hasInner ? argsAndMaybeNext.slice(0, -1) : argsAndMaybeNext

	let idx = 0
	let interrupted = false

	const dispatch = (...dispatchArgs: any[]): any => {
		if (idx < cbs.length) {
			const listener = cbs[idx++]!
			let nextCalled = false
			const next = (...nextArgs: any[]) => {
				nextCalled = true
				return dispatch(...nextArgs)
			}
			const ret = listener(...dispatchArgs, next)
			if (!nextCalled) interrupted = true
			return ret
		}
		return inner(...dispatchArgs)
	}

	const result = dispatch(...args)
	return { ok: !interrupted, value: result }
}
