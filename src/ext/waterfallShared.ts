import type { EventDescriptor, EventListener } from '@/types'

export type SplitWaterfall<D extends EventDescriptor> = D extends (
	...args: [...infer P, infer N]
) => infer R
	? N extends (...args: any[]) => any
		? { args: P; next: N; ret: R }
		: never
	: never

export type WFResult<R> = { ok: true; value: R } | { ok: false; value: R }

export function runWaterfall<D extends EventDescriptor>(
	listeners: EventListener<D>[],
	args: any[],
) {
	const last = args[args.length - 1]
	const hasInner = typeof last === 'function'
	// biome-ignore lint/complexity/noBannedTypes: <explanation>
	const inner: Function = hasInner ? args.pop()! : () => {}
	const callArgs = args

	let idx = 0
	let interrupted = false

	const dispatch = (...dispatchArgs: any[]): any => {
		if (idx < listeners.length) {
			const listener = listeners[idx++]!
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

	const result = dispatch(...callArgs)
	return { ok: !interrupted, value: result }
}
