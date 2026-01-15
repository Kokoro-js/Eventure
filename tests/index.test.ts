// tests/index.test.ts
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { Eventure } from 'eventure'
import { silentLogger } from './testUtils'

type Events = {
	syncEvt: [number, string]
	asyncEvt: [string]
}

describe('Eventure core', () => {
	let emitter: Eventure<Events>

	beforeEach(() => {
		emitter = new Eventure({ logger: silentLogger })
	})

	it('emits to listeners in registration order', () => {
		const calls: string[] = []
		emitter.on('syncEvt', (n, s) => calls.push(`A:${n}:${s}`))
		emitter.on('syncEvt', (n, s) => calls.push(`B:${n}:${s}`))

		expect(emitter.emit('syncEvt', 42, 'hello')).toBe(2)
		expect(calls).toEqual(['A:42:hello', 'B:42:hello'])
	})

	it('supports off() by original function reference', () => {
		const calls: number[] = []
		const direct = (n: number, _s: string) => calls.push(n + 1000)
		emitter.on('syncEvt', direct)

		expect(emitter.emit('syncEvt', 1, 'x')).toBe(1)
		expect(emitter.off('syncEvt', direct)).toBe(true)
		expect(emitter.off('syncEvt', direct)).toBe(false)

		expect(emitter.emit('syncEvt', 2, 'x')).toBe(0)
		expect(calls).toEqual([1001])
	})

	it('off() can remove wrapped listeners (via ORIGFUNC mapping)', () => {
		const asyncFn = async (_msg: string) => {
			await Promise.resolve()
			return
		}
		emitter.on('asyncEvt', asyncFn)
		expect(emitter.count('asyncEvt')).toBe(1)

		// async listeners are wrapped, so off() can match by ORIGFUNC.
		expect(emitter.off('asyncEvt', asyncFn)).toBe(true)
		expect(emitter.count('asyncEvt')).toBe(0)
	})

	it('returns an unsubscribe function from on()', () => {
		const calls: number[] = []
		const unsub = emitter.on('syncEvt', (n) => calls.push(n))

		emitter.emit('syncEvt', 5, '')
		unsub()
		emitter.emit('syncEvt', 6, '')

		expect(calls).toEqual([5])
	})

	it('does not block sync listeners when an async listener awaits', async () => {
		let asyncSettled = false
		emitter.on('asyncEvt', async () => {
			await Promise.resolve()
			asyncSettled = true
		})

		const syncObserver = mock(() => {
			expect(asyncSettled).toBe(false)
		})
		emitter.on('asyncEvt', syncObserver)

		emitter.emit('asyncEvt', 'test')
		await Promise.resolve()

		expect(syncObserver.mock.calls.length).toBe(1)
		expect(asyncSettled).toBe(true)
	})

	it('warns when maxListeners is exceeded', () => {
		const warn = mock((..._args: unknown[]) => {})
		const local = new Eventure<Pick<Events, 'syncEvt'>>({
			logger: { ...silentLogger, warn },
		})
		local.maxListeners = 1

		local.on('syncEvt', () => {})
		local.on('syncEvt', () => {})

		expect(warn.mock.calls.length).toBe(1)
		expect(String(warn.mock.calls[0]?.[0])).toContain('syncEvt')
	})

	it('captures async errors and forwards them to logger.error', async () => {
		const errorSpy = mock(() => {})
		emitter = new Eventure({ logger: { ...silentLogger, error: errorSpy } })

		expect(() => {
			emitter.on('asyncEvt', async () => {
				await Promise.resolve()
				throw new Error('failure')
			})
			emitter.emit('asyncEvt', 'oops')
		}).not.toThrow()

		// 等待内部 promise 完成（两次微任务以覆盖 async 返回值和 catch）
		await Promise.resolve()
		await Promise.resolve()
		expect(errorSpy.mock.calls.length).toBe(1)
	})

	it('exposes count(), listeners() and clear()', () => {
		const a = () => {}
		const b = () => {}
		emitter.on('syncEvt', a)
		emitter.on('syncEvt', b)

		expect(emitter.count('syncEvt')).toBe(2)
		expect(emitter.listeners('syncEvt')).toEqual([a, b])

		emitter.clear('syncEvt')
		expect(emitter.count('syncEvt')).toBe(0)
		expect(emitter.listeners('syncEvt')).toEqual([])
	})
})
