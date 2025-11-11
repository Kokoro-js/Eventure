import type { EventArgs, EventListener, IEventMap, Unsubscribe } from '@/types'
import type { Eventure } from '../eventified'

interface WaitForOptions<E extends IEventMap<E>, K extends keyof E> {
	/** 超时毫秒；不设则无超时 */
	timeout?: number
	prepend?: boolean
	/** 外部取消信号（仅用于取消，不会传给 on） */
	signal?: AbortSignal
	/** 命中过滤条件才解析 */
	filter?: (...args: EventArgs<E[K]>) => boolean
}

interface CancellablePromise<T> extends Promise<T> {
	cancel: () => void
}

/**
 * 等待一次事件（不向 on 传任何 options）
 * - 仅依赖 this.on(event, handler, { prepend })
 * - 单次 _wrap；有/无 filter 两条路径
 * - timeout / AbortSignal / cancel() 三路终止，统一 reject(Error)
 * - 所有出口幂等清理
 */
function waitFor<E extends IEventMap<E>, K extends keyof E>(
	this: Eventure<E>,
	event: K,
	{ timeout, signal, filter, prepend }: WaitForOptions<E, K> = {},
): CancellablePromise<EventArgs<E[K]>> {
	let offRef: Unsubscribe | null = null
	let timer: ReturnType<typeof setTimeout> | null = null
	let abortListener: (() => void) | null = null
	let settled = false

	const cleanup = () => {
		if (settled) return
		settled = true
		if (timer !== null) {
			clearTimeout(timer)
			timer = null
		}
		if (offRef) {
			const off = offRef
			offRef = null
			off()
		}
		if (abortListener && signal) {
			signal.removeEventListener('abort', abortListener)
			abortListener = null
		}
	}

	let rejectRef!: (e: unknown) => void

	const p = new Promise<EventArgs<E[K]>>((resolve, reject) => {
		rejectRef = reject

		// 1) 超时（可选）
		if (timeout != null) {
			timer = setTimeout(() => {
				cleanup()
				reject(
					new Error(`waitFor '${String(event)}' timeout after ${timeout}ms`),
				)
			}, timeout)
		}

		// 2) 外部 AbortSignal（可选，自己处理，不传给 on）
		if (signal) {
			if (signal.aborted) {
				cleanup()
				reject(new Error('waitFor aborted'))
				return
			}
			abortListener = () => {
				cleanup()
				reject(new Error('waitFor aborted'))
			}
			signal.addEventListener('abort', abortListener, { once: true })
		}

		// 3) 监听（一次命中即收敛）
		if (!filter) {
			const handler = this._wrap(((...args: EventArgs<E[K]>) => {
				cleanup()
				resolve(args)
			}) as EventListener<E[K]>)
			offRef = this.on(event, handler, { prepend })
			return
		}

		const handler = this._wrap(((...args: EventArgs<E[K]>) => {
			if (!filter(...args)) return
			cleanup()
			resolve(args)
		}) as EventListener<E[K]>)
		offRef = this.on(event, handler, { prepend })
	}) as CancellablePromise<EventArgs<E[K]>>

	// 4) 手动取消（与超时/abort 语义一致）
	p.cancel = () => {
		if (settled) return
		cleanup()
		rejectRef(new Error('waitFor cancelled'))
	}

	return p
}

export { waitFor }
