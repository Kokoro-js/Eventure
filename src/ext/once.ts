import type { EventArgs, EventListener, IEventMap, Unsubscribe } from '@/types'
import type { Eventure } from '../eventified'

// biome-ignore lint/suspicious/noConfusingVoidType: intentional
type BooleanAble = boolean | undefined | void

/**
 * 内核：限制触发次数（times >= 1）
 * 参数顺序：event, listener, times=1, prepend=false, predicate?
 * - 无 predicate 路径无条件判断（更易被内联）
 * - 退订幂等
 * - 在 finally 中计数并退订：无论回调抛错均会消耗配额并在归零时退订
 */
function limit<E extends IEventMap<E>, K extends keyof E>(
	this: Eventure<E>,
	event: K,
	listener: EventListener<E[K]>,
	times = 1,
	prepend = false,
	predicate?: (...args: EventArgs<E[K]>) => BooleanAble,
): Unsubscribe {
	if (times < 1) throw new Error('times must be >= 1')

	const wrapped = this._wrap(listener) // 启动即一次 wrap
	let left = times

	// 幂等退订：保存真实 off；置空即视为已退
	let offRef: Unsubscribe | null = null
	const unsubscribe: Unsubscribe = () => {
		const off = offRef
		if (off) {
			offRef = null
			off()
		}
	}

	if (!predicate) {
		const handler = ((...args: EventArgs<E[K]>) => {
			try {
				wrapped(...args)
			} finally {
				if (--left === 0) unsubscribe()
			}
		}) as EventListener<E[K]>
		offRef = prepend ? this.onFront(event, handler) : this.on(event, handler)
		return unsubscribe
	}

	const handler = ((...args: EventArgs<E[K]>) => {
		if (!predicate(...args)) return
		try {
			wrapped(...args)
		} finally {
			if (--left === 0) unsubscribe()
		}
	}) as EventListener<E[K]>
	offRef = prepend ? this.onFront(event, handler) : this.on(event, handler)
	return unsubscribe
}

/* ----------------------------- 友好导出 ------------------------------ */

function once<E extends IEventMap<E>, K extends keyof E>(
	this: Eventure<E>,
	event: K,
	listener: EventListener<E[K]>,
	predicate?: (...args: EventArgs<E[K]>) => BooleanAble,
): Unsubscribe {
	return limit.call(this, event, listener, 1, false, predicate)
}

function onceFront<E extends IEventMap<E>, K extends keyof E>(
	this: Eventure<E>,
	event: K,
	listener: EventListener<E[K]>,
	predicate?: (...args: EventArgs<E[K]>) => BooleanAble,
): Unsubscribe {
	return limit.call(this, event, listener, 1, true, predicate)
}

function many<E extends IEventMap<E>, K extends keyof E>(
	this: Eventure<E>,
	event: K,
	times: number,
	listener: EventListener<E[K]>,
	predicate?: (...args: EventArgs<E[K]>) => BooleanAble,
): Unsubscribe {
	return limit.call(this, event, listener, times, false, predicate)
}

function manyFront<E extends IEventMap<E>, K extends keyof E>(
	this: Eventure<E>,
	event: K,
	times: number,
	listener: EventListener<E[K]>,
	predicate?: (...args: EventArgs<E[K]>) => BooleanAble,
): Unsubscribe {
	return limit.call(this, event, listener, times, true, predicate)
}

/**
 * 条件构建器：固定 event + predicate，避免重复传参
 * - 四个方法统一返回 Unsubscribe
 */
function when<E extends IEventMap<E>, K extends keyof E>(
	this: Eventure<E>,
	event: K,
	predicate?: (...args: EventArgs<E[K]>) => BooleanAble,
) {
	return {
		once: (listener: EventListener<E[K]>) =>
			limit.call(this, event, listener, 1, false, predicate),
		onceFront: (listener: EventListener<E[K]>) =>
			limit.call(this, event, listener, 1, true, predicate),
		many: (times: number, listener: EventListener<E[K]>) =>
			limit.call(this, event, listener, times, false, predicate),
		manyFront: (times: number, listener: EventListener<E[K]>) =>
			limit.call(this, event, listener, times, true, predicate),
	}
}

export { limit, once, onceFront, many, manyFront, when }
