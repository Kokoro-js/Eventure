import type { RegisterSingle, WrapFn } from './limitSingle'
import type {
	EventArgs,
	EventDescriptor,
	EventListener,
	Unsubscribe,
} from '@/types'

interface CancellablePromise<T> extends Promise<T> {
	cancel: () => void
}

export interface WaitForSingleOptions<D extends EventDescriptor> {
	timeout?: number
	prepend?: boolean
	signal?: AbortSignal
	filter?: (...args: EventArgs<D>) => boolean
}

export function waitForSingle<D extends EventDescriptor>(
	wrap: WrapFn,
	register: RegisterSingle<D>,
	{ timeout, signal, filter, prepend }: WaitForSingleOptions<D> = {},
	label?: string,
): CancellablePromise<EventArgs<D>> {
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

	const p = new Promise<EventArgs<D>>((resolve, reject) => {
		rejectRef = reject

		if (timeout != null) {
			timer = setTimeout(() => {
				cleanup()
				reject(
					new Error(
						label
							? `waitFor '${label}' timeout after ${timeout}ms`
							: `waitFor timeout after ${timeout}ms`,
					),
				)
			}, timeout)
		}

		if (signal) {
			if (signal.aborted) {
				cleanup()
				reject(
					new Error(
						label ? `waitFor '${label}' aborted` : 'waitFor aborted',
					),
				)
				return
			}
			abortListener = () => {
				cleanup()
				reject(
					new Error(
						label ? `waitFor '${label}' aborted` : 'waitFor aborted',
					),
				)
			}
			signal.addEventListener('abort', abortListener, { once: true })
		}

		if (!filter) {
			const handler = wrap(((...args: EventArgs<D>) => {
				cleanup()
				resolve(args)
			}) as EventListener<D>)
			offRef = register(handler, prepend)
			return
		}

		const handler = wrap(((...args: EventArgs<D>) => {
			if (!filter(...args)) return
			cleanup()
			resolve(args)
		}) as EventListener<D>)
		offRef = register(handler, prepend)
	}) as CancellablePromise<EventArgs<D>>

	p.cancel = () => {
		if (settled) return
		cleanup()
		rejectRef(
			new Error(label ? `waitFor '${label}' cancelled` : 'waitFor cancelled'),
		)
	}

	return p
}
