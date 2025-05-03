// tests/once.test.ts
import { describe, it, expect } from 'bun:test'
import { Eventure } from '@/index'
import type { IEventMap, Unsubscribe } from '@/types'

interface MyEvents extends IEventMap {
	foo: [string]
	bar: [number, number]
}

describe('Eventified.once / prependOnce', () => {
	it('should fire listener exactly once with default .once', () => {
		const emitter = new Eventure<MyEvents>()
		const calls: string[] = []

		emitter.once('foo', (msg) => {
			calls.push(msg)
		})

		emitter.emit('foo', 'first')
		emitter.emit('foo', 'second')

		expect(calls).toEqual(['first'])
		expect(emitter.listenerCount('foo')).toBe(0)
	})

	it('should return unsubscribe function when manual=true and not fire after unsub', () => {
		const emitter = new Eventure<MyEvents>()
		const calls: string[] = []

		const unsub = emitter.once(
			'foo',
			(msg) => {
				calls.push(msg)
			},
			{ manual: true },
		) as Unsubscribe

		// unsubscribe before any emit
		unsub()

		emitter.emit('foo', 'will-not-fire')
		expect(calls).toEqual([])
		expect(emitter.listenerCount('foo')).toBe(0)
	})

	it('should prepend listener with .prependOnce and respect order', () => {
		const emitter = new Eventure<MyEvents>()
		const calls: string[] = []

		emitter.on('bar', (a, b) => {
			calls.push(`on:${a + b}`)
		})

		emitter.prependOnce('bar', (a, b) => {
			calls.push(`first:${a * b}`)
		})

		emitter.emit('bar', 2, 3)

		// prependOnce runs first, then the regular on listener
		expect(calls).toEqual(['first:6', 'on:5'])
		// after first emit, prependOnce is removed, but on remains
		expect(emitter.listenerCount('bar')).toBe(1)

		// second emit only fires the regular listener
		emitter.emit('bar', 4, 1)
		expect(calls).toEqual(['first:6', 'on:5', 'on:5'])
	})

	it('should allow multiple .once calls independently', () => {
		const emitter = new Eventure<MyEvents>()
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
