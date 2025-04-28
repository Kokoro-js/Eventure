import type { EventArgs, EventListener, IEventMap, Unsubscribe } from '@/types'
import type { Eventure } from '..'

// biome-ignore lint/suspicious/noConfusingVoidType: <explanation>
type BooleanAble = boolean | undefined | void

/**
 * 通用触发次数限制函数：在满足 predicate 时计数，达到次数后自动取消监听
 * 支持 options.prepend 决定使用 prependListener 还是 on
 */
function limited<E extends IEventMap, K extends keyof E>(
	this: Eventure<E>,
	event: K,
	listener: EventListener<E[K]>,
	times: number,
	options?: {
		predicate?: (...args: EventArgs<E[K]>) => BooleanAble
		prepend?: boolean
	},
): Unsubscribe {
	let count = 0
	const { predicate, prepend } = options || {}

	const wrapped: EventListener<E[K]> = ((...args: EventArgs<E[K]>) => {
		if (predicate && !predicate(...args)) return
		try {
			const fn = this.wrapHelper(listener)
			return fn(...args)
		} finally {
			if (++count >= times) {
				this.off(event, wrapped)
			}
		}
	}) as EventListener<E[K]>

	return prepend
		? this.prependListener(event, wrapped, true)
		: this.on(event, wrapped, true)
}

type OnceManyOptions<E extends IEventMap, K extends keyof E> = {
	/** 事件触发条件 */
	predicate?: (...args: EventArgs<E[K]>) => BooleanAble
	/** 是否手动退订，默认 false */
	manual?: boolean
}

/**
 * 只触发一次后自动移除
 * 默认返回 this 以便链式调用；若需手动退订，传入 { manual: true }
 */
function once<E extends IEventMap, K extends keyof E>(
	this: Eventure<E>,
	event: K,
	listener: EventListener<E[K]>,
	options?: OnceManyOptions<E, K>,
): Eventure<E> | Unsubscribe {
	const { manual } = options || {}
	const unsub = limited.call(this, event, listener, 1, options)
	return manual ? unsub : this
}

/**
 * 前置触发一次后自动移除
 * 同 once，但将监听器 prepend 到最前；
 * 若需手动退订，传入 { manual: true }
 */
function prependOnce<E extends IEventMap, K extends keyof E>(
	this: Eventure<E>,
	event: K,
	listener: EventListener<E[K]>,
	options?: OnceManyOptions<E, K>,
): Eventure<E> | Unsubscribe {
	const { manual } = options || {}
	const unsub = limited.call(this, event, listener, 1, {
		...options,
		prepend: true,
	})
	return manual ? unsub : this
}

/**
 * 触发指定次数后自动移除
 * 默认返回 this；若需手动退订，传入 { manual: true }
 */
function many<E extends IEventMap, K extends keyof E>(
	this: Eventure<E>,
	event: K,
	times: number,
	listener: EventListener<E[K]>,
	options?: OnceManyOptions<E, K>,
): Eventure<E> | Unsubscribe {
	const { manual } = options || {}
	const unsub = limited.call(this, event, listener, times, options)
	return manual ? unsub : this
}

/**
 * 前置触发多次后自动移除
 * 同 many，但将监听器 prepend 到最前；
 * 若需手动退订，传入 { manual: true }
 */
function prependMany<E extends IEventMap, K extends keyof E>(
	this: Eventure<E>,
	event: K,
	times: number,
	listener: EventListener<E[K]>,
	options?: OnceManyOptions<E, K>,
): Eventure<E> | Unsubscribe {
	const { manual } = options || {}
	const unsub = limited.call(this, event, listener, times, {
		...options,
		prepend: true,
	})
	return manual ? unsub : this
}

/**
 * 条件触发工具：链式调用 .once/.prependOnce/.many/.prependMany
 *
 * 示例：
 *   emitter.when('data', v => v !== null)
 *     .once(v => console.log(v))
 *     .prependOnce(v => console.log('first', v), { manual: true })
 *   emitter.when('update')
 *     .many(3, () => console.log('fired 3 times'))
 *     .prependMany(2, () => console.log('first two updates'))
 */
function when<E extends IEventMap, K extends keyof E>(
	this: Eventure<E>,
	event: K,
	predicate?: (...args: EventArgs<E[K]>) => BooleanAble,
) {
	return {
		once: (
			listener: EventListener<E[K]>,
			options?: Omit<OnceManyOptions<E, K>, 'predicate'>,
		): Unsubscribe =>
			limited.call(this, event, listener, 1, { predicate, ...options }),
		prependOnce: (
			listener: EventListener<E[K]>,
			options?: Omit<OnceManyOptions<E, K>, 'predicate'>,
		): Unsubscribe =>
			limited.call(this, event, listener, 1, {
				predicate,
				prepend: true,
				...options,
			}),
		many: (
			times: number,
			listener: EventListener<E[K]>,
			options?: Omit<OnceManyOptions<E, K>, 'predicate'>,
		): Unsubscribe =>
			limited.call(this, event, listener, times, { predicate, ...options }),
		prependMany: (
			times: number,
			listener: EventListener<E[K]>,
			options?: Omit<OnceManyOptions<E, K>, 'predicate'>,
		): Unsubscribe =>
			limited.call(this, event, listener, times, {
				predicate,
				prepend: true,
				...options,
			}),
	}
}

export { once, prependOnce, many, prependMany, when }
