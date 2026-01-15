// tests/waitFor.test.ts
import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test'
import { Eventure } from 'eventure'
import { silentLogger } from './testUtils'

interface Events {
	ready: []
	data: [number]
}

describe('Eventure.waitFor', () => {
	let emitter: Eventure<Events>
	beforeEach(() => {
		emitter = new Eventure({ logger: silentLogger })
		jest.useFakeTimers()
	})

	afterEach(() => {
		jest.useRealTimers()
	})

	it('resolves with the emitted args', async () => {
		const p = emitter.waitFor('data', { timeout: 1000 })
		setTimeout(() => emitter.emit('data', 42), 0)
		jest.runAllTimers()
		const args = await p
		expect(args).toEqual([42])
		// resolve 后应自动移除监听器
		expect(emitter.count('data')).toBe(0)
	})

	it('rejects on timeout and removes the listener', async () => {
		const timeoutMs = 10
		const p = emitter.waitFor('ready', { timeout: timeoutMs })
		jest.advanceTimersByTime(timeoutMs)
		await expect(p).rejects.toThrow(
			`waitFor 'ready' timeout after ${timeoutMs}ms`,
		)
		expect(emitter.count('ready')).toBe(0)
	})

	it('supports filter (rejects when no matching emission occurs)', async () => {
		const timeoutMs = 10
		const p = emitter.waitFor('data', {
			timeout: timeoutMs,
			filter: (v) => v > 100, // 永不满足
		})
		emitter.emit('data', 10)
		jest.advanceTimersByTime(timeoutMs)
		await expect(p).rejects.toThrow(
			`waitFor 'data' timeout after ${timeoutMs}ms`,
		)
		expect(emitter.count('data')).toBe(0)
	})

	it('supports filter (resolves on the first match)', async () => {
		const p = emitter.waitFor('data', {
			timeout: 1000,
			filter: (v) => v > 10,
		})
		emitter.emit('data', 5) // 不匹配，不会 resolve
		setTimeout(() => emitter.emit('data', 20), 0) // 第一次匹配
		jest.runAllTimers()
		const args = await p
		expect(args).toEqual([20])
		expect(emitter.count('data')).toBe(0)
	})

	it('supports cancel()', async () => {
		const p = emitter.waitFor('data', { timeout: 1000 })
		// 立即取消
		p.cancel()
		emitter.emit('data', 99)
		await expect(p).rejects.toThrow(`waitFor 'data' cancelled`)
		expect(emitter.count('data')).toBe(0)
	})

	it('cancel() after resolve is a no-op', async () => {
		const p = emitter.waitFor('data', { timeout: 1000 })
		setTimeout(() => emitter.emit('data', 2), 0)
		jest.runAllTimers()
		const args = await p
		expect(args).toEqual([2])
		expect(() => p.cancel()).not.toThrow()
	})

	it('does not capture past emissions (only future emits)', async () => {
		// 先触发
		emitter.emit('data', 1)
		const timeoutMs = 10
		const p = emitter.waitFor('data', { timeout: timeoutMs })
		jest.advanceTimersByTime(timeoutMs)
		await expect(p).rejects.toThrow(
			`waitFor 'data' timeout after ${timeoutMs}ms`,
		)
	})
})
