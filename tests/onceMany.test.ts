import { beforeEach, describe, expect, it } from 'bun:test'
import { Eventure } from 'eventure'
import { silentLogger } from './testUtils'

type Events = {
	foo: [string]
	bar: [number, number]
}

describe('Eventure once/many', () => {
	let emitter: Eventure<Events>

	beforeEach(() => {
		emitter = new Eventure({ logger: silentLogger })
	})

	describe('once / onceFront', () => {
		it.each([
			{
				name: 'once',
				register: (fn: (m: string) => void) => emitter.once('foo', fn),
			},
			{
				name: 'onceFront',
				register: (fn: (m: string) => void) => emitter.onceFront('foo', fn),
			},
		] as const)('$name only fires once', ({ register }) => {
			const calls: string[] = []
			register((m) => calls.push(m))

			emitter.emit('foo', 'first')
			emitter.emit('foo', 'second')

			expect(calls).toEqual(['first'])
			expect(emitter.count('foo')).toBe(0)
		})

		it('returns an unsubscribe function (manual unsubscribe wins)', () => {
			const calls: string[] = []
			const unsub = emitter.once('foo', (m) => calls.push(m))
			unsub()

			emitter.emit('foo', 'will-not-fire')
			expect(calls).toEqual([])
			expect(emitter.count('foo')).toBe(0)
		})

		it('onceFront prepends relative to existing listeners', () => {
			const calls: string[] = []
			emitter.on('bar', (a, b) => calls.push(`on:${a + b}`))
			emitter.onceFront('bar', (a, b) => calls.push(`first:${a * b}`))

			emitter.emit('bar', 2, 3)
			expect(calls).toEqual(['first:6', 'on:5'])

			emitter.emit('bar', 4, 1)
			expect(calls).toEqual(['first:6', 'on:5', 'on:5'])
		})
	})

	describe('many / manyFront', () => {
		it.each([
			{
				name: 'many',
				register: (times: number, fn: (m: string) => void) =>
					emitter.many('foo', times, fn),
			},
			{
				name: 'manyFront',
				register: (times: number, fn: (m: string) => void) =>
					emitter.manyFront('foo', times, fn),
			},
		] as const)('$name only fires N times', ({ register }) => {
			const calls: string[] = []
			register(3, (m) => calls.push(m))

			emitter.emit('foo', 'a')
			emitter.emit('foo', 'b')
			emitter.emit('foo', 'c')
			emitter.emit('foo', 'd') // 超出次数不应再触发

			expect(calls).toEqual(['a', 'b', 'c'])
			expect(emitter.count('foo')).toBe(0)
		})

		it('manyFront prepends relative to existing listeners', () => {
			const calls: string[] = []
			emitter.on('bar', (a, b) => calls.push(`on:${a + b}`))
			emitter.manyFront('bar', 2, (a, b) => calls.push(`first:${a * b}`))

			emitter.emit('bar', 2, 3)
			emitter.emit('bar', 4, 1)
			emitter.emit('bar', 1, 2)

			expect(calls).toEqual(['first:6', 'on:5', 'first:4', 'on:5', 'on:3'])
		})

		it('throws when times < 1', () => {
			expect(() => emitter.many('foo', 0, () => {})).toThrow()
			expect(() => emitter.many('foo', -1, () => {})).toThrow()
		})
	})
})
