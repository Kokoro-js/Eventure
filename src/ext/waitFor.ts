import type { EventArgs, EventListener, IEventMap, Unsubscribe } from '@/types'
import type { Eventure } from '../eventified'

/**
 * 可取消的 Promise 类型
 */
interface CancellablePromise<T> extends Promise<T> {
	cancel: () => void
}

interface WaitForOptions<E extends IEventMap<E>, K extends keyof E> {
	timeout: number
	filter?: (...args: EventArgs<E[K]>) => boolean
	prepend?: boolean
}

function waitFor<E extends IEventMap<E>, K extends keyof E>(
	this: Eventure<E>,
	event: K,
	{ timeout, filter = () => true, prepend = false }: WaitForOptions<E, K>,
): CancellablePromise<EventArgs<E[K]>> {
	let off: Unsubscribe = () => {}
	let timer: ReturnType<typeof setTimeout>
	let cancelled = false

	const promise = new Promise<EventArgs<E[K]>>((resolve, reject) => {
		const cleanup = () => {
			if (cancelled) return
			cancelled = true
			clearTimeout(timer)
			off()
			off = () => {}
		}

		timer = setTimeout(() => {
			cleanup()
			reject(new Error(`waitFor '${String(event)}' timeout after ${timeout}ms`))
		}, timeout)

		const listener = ((...args: EventArgs<E[K]>) => {
			if (!filter(...args)) return
			cleanup()
			resolve(args)
		}) as EventListener<E[K]>

		off = prepend
			? this.prependListener(event, listener, true)
			: this.addListener(event, listener, true)
	}) as CancellablePromise<EventArgs<E[K]>>

	promise.cancel = () => {
		if (cancelled) return
		cancelled = true
		clearTimeout(timer)
		off()
		off = () => {}
	}

	return promise
}

export { waitFor }
