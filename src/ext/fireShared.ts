import type {
	Awaitable,
	EventArgs,
	EventDescriptor,
	EventListener,
	EventResult,
} from '@/types'
import { IS_ASYNC } from '@/utils'

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
		if ((fn as any)[IS_ASYNC]) {
			try {
				const promise = fn(...args) as Promise<EventResult<D>>
				yield { type: 'async', fn, promise }
			} catch (error) {
				yield { type: 'error', fn, error }
			}
			continue
		}

		try {
			const result = fn(...args)
			yield { type: 'success', fn, result }
		} catch (error) {
			yield { type: 'error', fn, error }
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
		try {
			const result = (await fn(...args)) as Awaited<EventResult<D>>
			if ((result as any) instanceof Error) {
				yield { type: 'error', fn, error: result }
				continue
			}
			yield { type: 'success', fn, result }
		} catch (error) {
			yield { type: 'error', fn, error }
		}
	}
}
