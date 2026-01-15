import { beforeEach, describe, expect, it } from 'bun:test'
import { Eventure, EvtChannel, type OnOptions } from 'eventure'
import { silentLogger } from './testUtils'

type StringEventMap = { ev: [string] }
type ChannelEvent = [string]

type Harness = {
	name: string
	create: () => {
		on: (listener: (value: string) => unknown, opts?: OnOptions) => () => void
		onFront: (
			listener: (value: string) => unknown,
			opts?: Omit<OnOptions, 'prepend'>,
		) => () => void
		onAt: (
			options: {
				at: number | ((ctx: { count: number; event?: unknown }) => number)
				signal?: AbortSignal
			},
			listener: (value: string) => unknown,
		) => () => void
		emit: (value: string) => number
		count: () => number
	}
}

const harnesses: Harness[] = [
	{
		name: 'Eventure',
		create: () => {
			const emitter = new Eventure<StringEventMap>({ logger: silentLogger })
			return {
				on: (listener, opts) => emitter.on('ev', listener, opts),
				onFront: (listener, opts) => emitter.onFront('ev', listener, opts),
				onAt: (options, listener) => emitter.onAt('ev', options, listener),
				emit: (value) => emitter.emit('ev', value),
				count: () => emitter.count('ev'),
			}
		},
	},
	{
		name: 'EvtChannel',
		create: () => {
			const channel = new EvtChannel<ChannelEvent>({ logger: silentLogger })
			return {
				on: (listener, opts) => channel.on(listener, opts),
				onFront: (listener, opts) => channel.onFront(listener, opts),
				onAt: (options, listener) => channel.onAt(options, listener),
				emit: (value) => channel.emit(value),
				count: () => channel.count(),
			}
		},
	},
]

describe.each(harnesses)('onAt ($name)', ({ create }) => {
	let h: ReturnType<Harness['create']>

	beforeEach(() => {
		h = create()
	})

	it('inserts at specific index (with clamping)', () => {
		const calls: string[] = []
		h.on((v) => calls.push(`B:${v}`))
		h.on((v) => calls.push(`C:${v}`))
		h.onAt({ at: -100 }, (v) => calls.push(`A:${v}`))
		h.onAt({ at: 999 }, (v) => calls.push(`D:${v}`))

		expect(h.emit('x')).toBe(4)
		expect(calls).toEqual(['A:x', 'B:x', 'C:x', 'D:x'])
	})

	it('supports resolver-based insertion', () => {
		const calls: string[] = []
		h.on((v) => calls.push(`B:${v}`))
		h.on((v) => calls.push(`C:${v}`))
		h.onAt(
			{ at: ({ count }: { count: number }) => Math.floor(count / 2) },
			(v) => calls.push(`A:${v}`),
		)

		expect(h.emit('x')).toBe(3)
		expect(calls).toEqual(['B:x', 'A:x', 'C:x'])
	})

	it('keeps onFront as alias of at=0', () => {
		const calls: string[] = []
		h.on((v) => calls.push(`B:${v}`))
		h.onFront((v) => calls.push(`A:${v}`))
		expect(h.emit('x')).toBe(2)
		expect(calls).toEqual(['A:x', 'B:x'])
	})

	it('supports AbortSignal (aborted before registration)', () => {
		const controller = new AbortController()
		controller.abort()

		const unsub = h.onAt({ at: 0, signal: controller.signal }, () => {})
		unsub()
		expect(h.count()).toBe(0)
	})

	it('supports AbortSignal (abort after manual unsubscribe)', () => {
		const controller = new AbortController()
		const calls: string[] = []

		const unsub = h.onAt({ at: 0, signal: controller.signal }, (v) =>
			calls.push(v),
		)
		unsub()
		controller.abort()

		expect(h.count()).toBe(0)
		expect(h.emit('x')).toBe(0)
		expect(calls).toEqual([])
	})

	it('supports AbortSignal (abort triggers auto-unsub)', () => {
		const controller = new AbortController()
		const calls: string[] = []

		h.onAt({ at: 0, signal: controller.signal }, (v) => calls.push(v))
		expect(h.count()).toBe(1)
		controller.abort()
		expect(h.count()).toBe(0)
		expect(h.emit('x')).toBe(0)
	})
})

describe('Eventure listenersUnsafe alias', () => {
	let emitter: Eventure<StringEventMap>

	beforeEach(() => {
		emitter = new Eventure<StringEventMap>({ logger: silentLogger })
	})

	it('queryListeners returns the same reference as listenersUnsafe', () => {
		emitter.on('ev', () => {})
		const a = emitter.listenersUnsafe('ev')
		const b = emitter.queryListeners('ev')
		expect(a).toBe(b)
	})

	it('mutating listenersUnsafe affects subsequent emits (unsafe by design)', () => {
		const calls: string[] = []

		emitter.on('ev', (v) => calls.push(`A:${v}`))
		const internal = emitter.listenersUnsafe('ev')
		internal.push((v) => calls.push(`B:${v}`))

		expect(emitter.emit('ev', 'x')).toBe(2)
		expect(calls).toEqual(['A:x', 'B:x'])
	})
})
