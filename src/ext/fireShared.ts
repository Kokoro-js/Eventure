import { IS_ASYNC, ORIGFUNC, isPromiseLike } from '../core/listener'
import type {
	Awaitable,
	EventArgs,
	EventDescriptor,
	EventListener,
	EventResult,
} from '../types'

export type FireSyncRecord<D extends EventDescriptor> =
	| { type: 'success'; fn: EventListener<D>; result: EventResult<D> }
	| { type: 'error'; fn: EventListener<D>; error: unknown }
	| { type: 'async'; fn: EventListener<D>; promise: Awaitable<EventResult<D>> }

export type FireAsyncRecord<D extends EventDescriptor> =
	| {
			type: 'success'
			fn: EventListener<D>
			result: Awaited<EventResult<D>>
	  }
	| { type: 'error'; fn: EventListener<D>; error: unknown }

export function* fireFromListeners<D extends EventDescriptor>(
	listeners: EventListener<D>[],
	args: EventArgs<D>,
): Generator<FireSyncRecord<D>> {
	const len = listeners.length
	for (let i = 0; i < len; i++) {
		const fn = listeners[i]!
		const recordFn = ((fn as any)[ORIGFUNC] ?? fn) as EventListener<D>
		if ((fn as any)[IS_ASYNC] === true) {
			try {
				const promise = fn(...args) as Awaitable<EventResult<D>>
				yield { type: 'async', fn: recordFn, promise }
			} catch (error) {
				yield { type: 'error', fn: recordFn, error }
			}
			continue
		}
		try {
			const result = fn(...args)
			if (isPromiseLike(result)) {
				yield {
					type: 'async',
					fn: recordFn,
					promise: Promise.resolve(result) as Awaitable<EventResult<D>>,
				}
				continue
			}
			yield { type: 'success', fn: recordFn, result }
		} catch (error) {
			yield { type: 'error', fn: recordFn, error }
		}
	}
}

export async function* fireAsyncFromListeners<D extends EventDescriptor>(
	listeners: EventListener<D>[],
	args: EventArgs<D>,
): AsyncGenerator<FireAsyncRecord<D>> {
	const len = listeners.length
	for (let i = 0; i < len; i++) {
		const fn = listeners[i]!
		const recordFn = ((fn as any)[ORIGFUNC] ?? fn) as EventListener<D>
		try {
			const result = (await fn(...args)) as Awaited<EventResult<D>>
			if ((result as any) instanceof Error) {
				yield { type: 'error', fn: recordFn, error: result }
				continue
			}
			yield { type: 'success', fn: recordFn, result }
		} catch (error) {
			yield { type: 'error', fn: recordFn, error }
		}
	}
}
