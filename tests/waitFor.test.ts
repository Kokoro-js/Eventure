// tests/waitFor.test.ts
import { beforeEach, describe, expect, it } from 'bun:test'
import { Eventure } from '../src'

interface Events {
	ready: []
	data: [number]
}

describe('Eventure.waitFor 方法', () => {
	let emitter: Eventure<Events>
	beforeEach(() => {
		emitter = new Eventure()
	})

	it('应在事件被 emit 后 resolve，返回参数数组', async () => {
		const p = emitter.waitFor('data', { timeout: 1000 })
		// 在下一个 tick 中触发
		setTimeout(() => {
			emitter.emit('data', 42)
		}, 0)
		const args = await p
		expect(args).toEqual([42])
		// resolve 后应自动移除监听器
		expect(emitter.count('data')).toBe(0)
	})

	it('在超时未触发时应 reject，并移除监听器', async () => {
		const timeoutMs = 50
		const p = emitter.waitFor('ready', { timeout: timeoutMs })
		await expect(p).rejects.toThrow(
			`waitFor 'ready' timeout after ${timeoutMs}ms`,
		)
		expect(emitter.count('ready')).toBe(0)
	})

	it('带 filter 时若无匹配值应在超时后 reject', async () => {
		const timeoutMs = 50
		const p = emitter.waitFor('data', {
			timeout: timeoutMs,
			filter: (v) => v > 100, // 永不满足
		})
		emitter.emit('data', 10)
		await expect(p).rejects.toThrow(
			`waitFor 'data' timeout after ${timeoutMs}ms`,
		)
		expect(emitter.count('data')).toBe(0)
	})

	it('带 filter 时应跳过不匹配的事件，直到第一个匹配后 resolve', async () => {
		const p = emitter.waitFor('data', {
			timeout: 1000,
			filter: (v) => v > 10,
		})
		emitter.emit('data', 5) // 不匹配，不会 resolve
		setTimeout(() => {
			emitter.emit('data', 20) // 第一次匹配
		}, 0)
		const args = await p
		expect(args).toEqual([20])
		expect(emitter.count('data')).toBe(0)
	})

	it('调用 cancel 后无论是否满足条件都应 reject', async () => {
		const p = emitter.waitFor('data', { timeout: 1000 })
		// 立即取消
		p.cancel()
		emitter.emit('data', 99)
		// @ts-ignore
		const result = await Promise.race<'resolved' | 'rejected' | 'no-resolve'>([
			p.then(() => 'resolved').catch(() => 'rejected'),
			new Promise<'no-resolve'>((r) => setTimeout(() => r('no-resolve'), 50)),
		])
		expect(result).toBe('rejected')
		expect(emitter.count('data')).toBe(0)
	})

	it('在 resolve 之后调用 cancel 应为无操作且不抛异常', async () => {
		const p = emitter.waitFor('data', { timeout: 1000 })
		setTimeout(() => emitter.emit('data', 2), 0)
		const args = await p
		expect(args).toEqual([2])
		expect(() => p.cancel()).not.toThrow()
	})

	it('如果在 waitFor 之前已 emit，应超时 reject', async () => {
		// 先触发
		emitter.emit('data', 1)
		const timeoutMs = 50
		const p = emitter.waitFor('data', { timeout: timeoutMs })
		await expect(p).rejects.toThrow(
			`waitFor 'data' timeout after ${timeoutMs}ms`,
		)
	})
})
