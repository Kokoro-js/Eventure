// tests/onceMany.test.ts
import { beforeEach, describe, expect, it } from 'bun:test'
import { Eventure } from '@/index'
import type { Unsubscribe } from '@/types'

interface Events {
	foo: [string]
	bar: [number, number]
}

describe('事件一次性监听: once / prependOnce', () => {
	let emitter: Eventure<Events>
	beforeEach(() => {
		emitter = new Eventure()
	})

	it('默认 .once 应只触发一次监听', () => {
		const calls: string[] = []

		emitter.once('foo', (msg) => {
			calls.push(msg)
		})

		emitter.emit('foo', 'first')
		emitter.emit('foo', 'second')

		expect(calls).toEqual(['first'])
		expect(emitter.listenerCount('foo')).toBe(0)
	})

	it('manual=true 时应返回取消订阅函数，取消后不再触发', () => {
		const calls: string[] = []

		const unsub = emitter.once(
			'foo',
			(msg) => {
				calls.push(msg)
			},
			{ manual: true },
		) as Unsubscribe

		// 取消订阅后即便 emit 也不触发
		unsub()

		emitter.emit('foo', 'will-not-fire')
		expect(calls).toEqual([])
		expect(emitter.listenerCount('foo')).toBe(0)
	})

	it('.prependOnce 应将监听器前置并保持调用顺序', () => {
		const calls: string[] = []

		emitter.on('bar', (a, b) => {
			calls.push(`on:${a + b}`)
		})

		emitter.prependOnce('bar', (a, b) => {
			calls.push(`first:${a * b}`)
		})

		emitter.emit('bar', 2, 3)

		// prependOnce 先运行，然后普通 on
		expect(calls).toEqual(['first:6', 'on:5'])
		expect(emitter.listenerCount('bar')).toBe(1)

		// 再次 emit 只剩 on
		emitter.emit('bar', 4, 1)
		expect(calls).toEqual(['first:6', 'on:5', 'on:5'])
	})

	it('允许多个 .once 独立调用', () => {
		const callsA: string[] = []
		const callsB: string[] = []

		emitter.once('foo', (m) => callsA.push(`A:${m}`))
		emitter.once('foo', (m) => callsB.push(`B:${m}`))

		emitter.emit('foo', 'x')
		emitter.emit('foo', 'y')

		expect(callsA).toEqual(['A:x'])
		expect(callsB).toEqual(['B:x'])
		expect(emitter.listenerCount('foo')).toBe(0)
	})
})

describe('事件多次监听: many / prependMany', () => {
	let emitter: Eventure<Events>
	beforeEach(() => {
		emitter = new Eventure()
	})
	it('.many 应仅触发 N 次监听', () => {
		const calls: string[] = []

		emitter.many('foo', 3, (msg) => {
			calls.push(msg)
		})

		emitter.emit('foo', 'a')
		emitter.emit('foo', 'b')
		emitter.emit('foo', 'c')
		emitter.emit('foo', 'd') // 超出次数不应再触发

		expect(calls).toEqual(['a', 'b', 'c'])
		expect(emitter.listenerCount('foo')).toBe(0)
	})

	it('manual=true 时应返回取消订阅函数，取消后不再触发', () => {
		const calls: string[] = []

		const unsub = emitter.many(
			'foo',
			2,
			(msg) => {
				calls.push(msg)
			},
			{ manual: true },
		) as Unsubscribe

		// 手动取消订阅后无论是否达到次数，都不会触发
		unsub()

		emitter.emit('foo', 'x')
		emitter.emit('foo', 'y')
		expect(calls).toEqual([])
		expect(emitter.listenerCount('foo')).toBe(0)
	})

	it('.prependMany 应将监听器前置并保持调用顺序', () => {
		const calls: string[] = []

		emitter.on('bar', (a, b) => {
			calls.push(`on:${a + b}`)
		})

		emitter.prependMany('bar', 2, (a, b) => {
			calls.push(`first:${a * b}`)
		})

		emitter.emit('bar', 2, 3)
		expect(calls).toEqual(['first:6', 'on:5'])
		expect(emitter.listenerCount('bar')).toBe(2)

		emitter.emit('bar', 4, 1)
		expect(calls).toEqual(['first:6', 'on:5', 'first:4', 'on:5'])
		expect(emitter.listenerCount('bar')).toBe(1)

		emitter.emit('bar', 1, 2)
		expect(calls).toEqual(['first:6', 'on:5', 'first:4', 'on:5', 'on:3'])
	})

	it('允许多个 .many 独立调用', () => {
		const callsA: string[] = []
		const callsB: string[] = []

		emitter.many('foo', 2, (m) => callsA.push(`A:${m}`))
		emitter.many('foo', 3, (m) => callsB.push(`B:${m}`))

		emitter.emit('foo', '1')
		emitter.emit('foo', '2')
		emitter.emit('foo', '3')

		expect(callsA).toEqual(['A:1', 'A:2'])
		expect(callsB).toEqual(['B:1', 'B:2', 'B:3'])
		expect(emitter.listenerCount('foo')).toBe(0)
	})

	it('count 非正整数时应抛出异常', () => {
		expect(() => emitter.many('foo', 0, () => {})).toThrow()
		expect(() => emitter.many('foo', -1, () => {})).toThrow()
	})
})
