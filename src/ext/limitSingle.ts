import type {
	EventArgs,
	EventDescriptor,
	EventListener,
	Unsubscribe,
} from '@/types'

export type GuardResult = boolean | undefined | void
export type GuardPredicate<D extends EventDescriptor> = (
	...args: EventArgs<D>
) => GuardResult

export type WrapFn = <T extends Function>(listener: T) => T
export type RegisterSingle<D extends EventDescriptor> = (
	listener: EventListener<D>,
	prepend?: boolean,
) => Unsubscribe

export interface WhenGuard<D extends EventDescriptor> {
	once(listener: EventListener<D>): Unsubscribe
	onceFront(listener: EventListener<D>): Unsubscribe
	many(times: number, listener: EventListener<D>): Unsubscribe
	manyFront(times: number, listener: EventListener<D>): Unsubscribe
}

export function limitSingle<D extends EventDescriptor>(
	wrap: WrapFn,
	register: RegisterSingle<D>,
	listener: EventListener<D>,
	times = 1,
	prepend = false,
	predicate?: GuardPredicate<D>,
): Unsubscribe {
	if (times < 1) throw new Error('times must be >= 1')

	const wrapped = wrap(listener)
	let left = times

	let offRef: Unsubscribe | null = null
	const unsubscribe: Unsubscribe = () => {
		const off = offRef
		if (off) {
			offRef = null
			off()
		}
	}

	const attach = (handler: EventListener<D>) => register(handler, prepend)

	if (!predicate) {
		const handler = ((...args: EventArgs<D>) => {
			try {
				wrapped(...args)
			} finally {
				if (--left === 0) unsubscribe()
			}
		}) as EventListener<D>
		offRef = attach(handler)
		return unsubscribe
	}

	const handler = ((...args: EventArgs<D>) => {
		if (!predicate(...args)) return
		try {
			wrapped(...args)
		} finally {
			if (--left === 0) unsubscribe()
		}
	}) as EventListener<D>
	offRef = attach(handler)
	return unsubscribe
}

export function onceWithOps<D extends EventDescriptor>(
	wrap: WrapFn,
	register: RegisterSingle<D>,
	listener: EventListener<D>,
	predicate?: GuardPredicate<D>,
	prepend = false,
): Unsubscribe {
	return limitSingle(wrap, register, listener, 1, prepend, predicate)
}

export function manyWithOps<D extends EventDescriptor>(
	wrap: WrapFn,
	register: RegisterSingle<D>,
	times: number,
	listener: EventListener<D>,
	predicate?: GuardPredicate<D>,
	prepend = false,
): Unsubscribe {
	return limitSingle(wrap, register, listener, times, prepend, predicate)
}

export function createWhenGuard<D extends EventDescriptor>(
	wrap: WrapFn,
	register: RegisterSingle<D>,
	predicate?: GuardPredicate<D>,
): WhenGuard<D> {
	return {
		once: (listener) => onceWithOps(wrap, register, listener, predicate, false),
		onceFront: (listener) =>
			onceWithOps(wrap, register, listener, predicate, true),
		many: (times, listener) =>
			manyWithOps(wrap, register, times, listener, predicate, false),
		manyFront: (times, listener) =>
			manyWithOps(wrap, register, times, listener, predicate, true),
	}
}
