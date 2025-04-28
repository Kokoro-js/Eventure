import type { EventArgs, EventListener, IEventMap, Unsubscribe } from '@/types'
import type { Eventure } from '..'

/**
 * 可取消的 Promise 类型
 */
interface CancellablePromise<T> extends Promise<T> {
	cancel: () => void
}

/**
 * 等待一次事件触发或超时，返回可取消的 Promise。
 * 可通过 promise.cancel() 手动取消。
 * @param event   — 事件名
 * @param timeout — 超时毫秒数
 * @param prepend — 是否使用 prependListener（默认 false）
 */
function waitFor<E extends IEventMap, K extends keyof E>(
	this: Eventure<E>,
	event: K,
	timeout: number,
	prepend = false,
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

		// 超时处理
		timer = setTimeout(() => {
			cleanup()
			reject(new Error(`waitFor '${String(event)}' timeout after ${timeout}ms`))
		}, timeout)

		// 事件回调
		const listener = ((...args: EventArgs<E[K]>) => {
			cleanup()
			resolve(args)
		}) as EventListener<E[K]>

		// 注册监听（normal 或 prepend）
		off = prepend
			? this.prependListener(event, listener, true)
			: this.on(event, listener, true)
	}) as CancellablePromise<EventArgs<E[K]>>

	// 手动取消
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
