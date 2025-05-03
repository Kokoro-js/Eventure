// tests/waitFor.test.ts
import { describe, it, expect } from 'bun:test'
import { Eventure } from '@/index'
import type { IEventMap } from '@/types'

interface MyEvents extends IEventMap {
	ready: []
	data: [number]
}

describe('Eventure.waitFor', () => {
	it('should resolve when the event is emitted', async () => {
		const emitter = new Eventure<MyEvents>()

		const p = emitter.waitFor('data', { timeout: 1000 })
		// emit after a tick
		setTimeout(() => {
			emitter.emit('data', 42)
		}, 0)

		const args = await p
		expect(args).toEqual([42])
	})

	it('should reject on timeout when no event is emitted', async () => {
		const emitter = new Eventure<MyEvents>()
		const timeoutMs = 50

		const p = emitter.waitFor('ready', { timeout: timeoutMs })
		await expect(p).rejects.toThrow(
			`waitFor 'ready' timeout after ${timeoutMs}ms`,
		)
	})

	it('should reject on timeout when filter never matches', async () => {
		const emitter = new Eventure<MyEvents>()
		const timeoutMs = 50

		const p = emitter.waitFor('data', {
			timeout: timeoutMs,
			filter: (value) => value > 100, // never true
		})

		// emit a value that doesn't match
		emitter.emit('data', 10)

		await expect(p).rejects.toThrow(
			`waitFor 'data' timeout after ${timeoutMs}ms`,
		)
	})

	it('should skip non-matching events and resolve on the first matching one', async () => {
		const emitter = new Eventure<MyEvents>()

		const p = emitter.waitFor('data', {
			timeout: 1000,
			filter: (value) => value > 10,
		})

		// emit a non-matching value
		emitter.emit('data', 5)

		// then emit a matching value
		setTimeout(() => {
			emitter.emit('data', 20)
		}, 0)

		const args = await p
		expect(args).toEqual([20])
	})

	it('should not resolve after cancel is called', async () => {
		const emitter = new Eventure<MyEvents>()
		const p = emitter.waitFor('data', { timeout: 1000 })

		// cancel immediately
		p.cancel()

		// try to emit right away
		emitter.emit('data', 99)

		// race between p settling and a short timer

		const result = await Promise.race<'resolved' | 'rejected' | 'no-resolve'>(
			// @ts-ignore
			[
				p.then(() => 'resolved').catch(() => 'rejected'),
				new Promise<'no-resolve'>((r) => setTimeout(() => r('no-resolve'), 50)),
			],
		)

		expect(result).toBe('no-resolve')
	})

	it('cancel after resolve should be a no-op', async () => {
		const emitter = new Eventure<MyEvents>()
		const p = emitter.waitFor('data', { timeout: 1000 })

		setTimeout(() => emitter.emit('data', 2), 0)
		const args = await p
		expect(args).toEqual([2])

		// calling cancel post-resolution should not throw
		expect(() => p.cancel()).not.toThrow()
	})

	it('should not resolve if event emitted before waitFor is called', async () => {
		const emitter = new Eventure<MyEvents>()

		// emit before waiting
		emitter.emit('data', 1)

		const timeoutMs = 50
		const p = emitter.waitFor('data', { timeout: timeoutMs })
		await expect(p).rejects.toThrow(
			`waitFor 'data' timeout after ${timeoutMs}ms`,
		)
	})
})
