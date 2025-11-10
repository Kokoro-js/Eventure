import type {
	Awaitable,
	EventArgs,
	EventListener,
	EventResult,
	IEventMap,
} from '@/types'
import { IS_ASYNC } from '@/utils'
import type { Eventure } from '../eventified'

// 同步生成器结果：
export type FireSyncResult<E extends IEventMap<E>, K extends keyof E> =
	| { type: 'success'; fn: EventListener<E[K]>; result: EventResult<E[K]> }
	| { type: 'error'; fn: EventListener<E[K]>; error: unknown }
	| {
			type: 'async'
			fn: EventListener<E[K]>
			promise: Awaitable<EventResult<E[K]>>
	  }

// 异步生成器结果：
export type FireAsyncResult<E extends IEventMap<E>, K extends keyof E> =
	| {
			type: 'success'
			fn: EventListener<E[K]>
			result: Awaited<EventResult<E[K]>>
	  }
	| { type: 'error'; fn: EventListener<E[K]>; error: unknown }

/**
 * 同步触发：按序调用 listener，不 await 异步，
 * 遇异步 listener (IS_ASYNC) 时 yield 出 promise 让外部处理。
 */
function* fire<E extends IEventMap<E>, K extends keyof E>(
	this: Eventure<E>,
	eventOrListeners: K | EventListener<E[K]>[],
	...args: EventArgs<E[K]>
): Generator<FireSyncResult<E, K>> {
	const listeners: EventListener<E[K]>[] = Array.isArray(eventOrListeners)
		? eventOrListeners
		: this.queryListeners(eventOrListeners)
	for (const fn of listeners) {
		if ((fn as any)[IS_ASYNC]) {
			try {
				const promise = fn(...args) as Promise<EventResult<E[K]>>
				yield { type: 'async', fn, promise }
			} catch (error) {
				yield { type: 'error', fn, error }
			}

			continue
		}

		// 同步直接跑
		try {
			const result = fn(...args)
			yield { type: 'success', fn, result }
		} catch (error) {
			yield { type: 'error', fn, error }
		}
	}
}

/**
 * 异步触发：按序调用 listener，统一 await 并处理错误，
 * 外部 can for await...of 并根据 type 中断。
 */
async function* fireAsync<E extends IEventMap<E>, K extends keyof E>(
	this: Eventure<E>,
	eventOrListeners: K | EventListener<E[K]>[],
	...args: EventArgs<E[K]>
): AsyncGenerator<FireAsyncResult<E, K>> {
	const listeners: EventListener<E[K]>[] = Array.isArray(eventOrListeners)
		? eventOrListeners
		: this.queryListeners(eventOrListeners)
	for (const fn of listeners) {
		try {
			const result = await Promise.resolve(fn(...args))
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

export { fire, fireAsync }
