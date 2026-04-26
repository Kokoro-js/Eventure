import type {
	EventArgs,
	EventDescriptor,
	EventListener,
	EventResult,
	EmitSettledRecord,
} from '../types'
import { isPromiseLike } from '../utils'

export async function emitAllFromListeners<D extends EventDescriptor>(
	listeners: EventListener<D>[] | undefined,
	args: EventArgs<D>,
): Promise<Awaited<EventResult<D>>[]> {
	if (!listeners || listeners.length === 0) return []

	const len = listeners.length
	const results = new Array<Awaited<EventResult<D>>>(len)
	let pending: Promise<unknown>[] | null = null

	for (let i = 0; i < len; i++) {
		const fn = listeners[i] as any
		try {
			const r = fn(...args)
			if (r instanceof Error) {
				if (pending !== null) void Promise.allSettled(pending)
				throw r
			}
			if (isPromiseLike(r)) {
				pending ??= []
				pending.push(
					Promise.resolve(r).then((v: any) => {
						if (v instanceof Error) throw v
						results[i] = v
						return v
					}),
				)
				continue
			}
			results[i] = r
		} catch (err) {
			if (pending !== null) void Promise.allSettled(pending)
			throw err
		}
	}

	if (pending !== null) await Promise.all(pending)
	return results
}

export async function emitSettledFromListeners<D extends EventDescriptor>(
	listeners: EventListener<D>[] | undefined,
	args: EventArgs<D>,
): Promise<EmitSettledRecord<EventListener<D>, Awaited<EventResult<D>>>[]> {
	if (!listeners || listeners.length === 0) return []

	const len = listeners.length
	const results = new Array<
		EmitSettledRecord<EventListener<D>, Awaited<EventResult<D>>>
	>(len)
	let pending: Promise<unknown>[] | null = null

	for (let i = 0; i < len; i++) {
		const fn = listeners[i]!
		try {
			const r = (fn as any)(...args)
			if (r instanceof Error) {
				results[i] = { fn, status: 'rejected', reason: r }
				continue
			}
			if (isPromiseLike(r)) {
				pending ??= []
				pending.push(
					Promise.resolve(r).then(
						(v: any) => {
							if (v instanceof Error) {
								const record = {
									fn,
									status: 'rejected',
									reason: v,
								} as const
								results[i] = record
								return record
							}
							const record = { fn, status: 'fulfilled', value: v } as const
							results[i] = record
							return record
						},
						(reason: unknown) => {
							const record = { fn, status: 'rejected', reason } as const
							results[i] = record
							return record
						},
					),
				)
				continue
			}
			results[i] = { fn, status: 'fulfilled', value: r }
		} catch (reason) {
			results[i] = { fn, status: 'rejected', reason }
		}
	}

	if (pending !== null) await Promise.all(pending)
	return results
}
