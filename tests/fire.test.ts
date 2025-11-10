// tests/fire.test.ts
import { beforeEach, describe, expect, it } from 'bun:test'
import { Eventure, IS_ASYNC, ORIGFUNC } from '../src'

export interface Events {
	ev: [string]
}

describe('Eventified.fire (同步 generator)', () => {
	let emitter: Eventure<Events>
	beforeEach(() => {
		emitter = new Eventure()
	})

	it('应当依次对同步 listener 产出 success 或 error', () => {
		const okFn = (s: string) => s + '!'
		const errFn = (s: string) => {
			throw new Error('fail')
		}

		emitter.on('ev', okFn)
		emitter.on('ev', errFn)

		const gen = emitter.fire('ev', 'hi')
		const results = Array.from(gen)

		expect(results).toHaveLength(2)

		// 第一个 listener 成功
		expect(results[0]).toMatchObject({
			type: 'success',
			result: 'hi!',
		})

		expect(results[0]?.fn).toBe(okFn)

		// 第二个 listener 抛错
		expect(results[1]?.type).toBe('error')
		expect(results[1]?.fn).toBe(errFn)
		// @ts-ignore
		expect(results[1].error).toBeInstanceOf(Error)
		// @ts-ignore
		expect((results[1].error as Error).message).toBe('fail')
	})

	it("对 async listener 会产出 type='async' 且带上 promise", async () => {
		const asyncFn = async (s: string) => s.toUpperCase()
		emitter.on('ev', asyncFn)

		const gen = emitter.fire('ev', 'ok')
		const rec = gen.next().value

		expect(rec.type).toBe('async')
		// wrapper 上绑定的 ORIGFUNC 正好是原始 asyncFn
		expect(rec.fn[ORIGFUNC]).toBe(asyncFn)
		expect((rec.fn as any)[IS_ASYNC]).toBe(true)
		await expect(rec.promise).resolves.toBe('OK')
	})

	it('async listener 内抛错会被 catch 并以 resolve(Error) 形式返回', async () => {
		const boomFn = async (s: string) => {
			throw new Error('boom')
		}
		emitter.on('ev', boomFn)

		const gen = emitter.fire('ev', 'x')
		const rec = gen.next().value

		expect(rec.type).toBe('async')
		const v = await rec.promise
		expect(v).toBeInstanceOf(Error)
		expect((v as Error).message).toBe('boom')
	})
})

describe('Eventified.fireAsync (异步 AsyncGenerator)', () => {
	let emitter: Eventure<Events>
	beforeEach(() => {
		emitter = new Eventure()
	})

	it('应当依次对所有 listener await 并产出 success 或 error', async () => {
		const syncFn = (s: string) => s + '?'
		const throwFn = (s: string) => {
			throw new Error('oops')
		}
		const asyncOk = async (s: string) => s.repeat(2)
		const asyncErr = async (s: string) => new Error('bad result')

		emitter.on('ev', syncFn)
		emitter.on('ev', throwFn)
		emitter.on('ev', asyncOk)
		emitter.on('ev', asyncErr)

		const results: any[] = []
		for await (const r of emitter.fireAsync('ev', 'a')) {
			results.push(r)
		}

		expect(results).toHaveLength(4)

		// sync 成功
		expect(results[0]).toEqual({
			type: 'success',
			fn: syncFn,
			result: 'a?',
		})

		// sync 抛错
		expect(results[1].type).toBe('error')
		expect(results[1].fn).toBe(throwFn)
		expect(results[1].error).toBeInstanceOf(Error)
		expect((results[1].error as Error).message).toBe('oops')

		// async 成功 —— 比较 orig func
		expect(results[2].type).toBe('success')
		expect(results[2].fn[ORIGFUNC]).toBe(asyncOk)
		expect(results[2].result).toBe('aa')

		// async 返回 Error 实例当作 error —— 比较 orig func
		expect(results[3].type).toBe('error')
		expect(results[3].fn[ORIGFUNC]).toBe(asyncErr)
		expect(results[3].error).toBeInstanceOf(Error)
		expect((results[3].error as Error).message).toBe('bad result')
	})

	it('可在外部通过 break/return 提前终止，不再调用后续 listener', async () => {
		let count = 0
		emitter.on('ev', () => {
			count++
			return 'x'
		})
		emitter.on('ev', () => {
			count++
			throw new Error('stop')
		})
		emitter.on('ev', () => {
			count++
			return 'y'
		})

		const iter = emitter.fireAsync('ev', '')
		const first = await iter.next()
		expect(first.value.type).toBe('success')
		const second = await iter.next()
		expect(second.value.type).toBe('error')

		// 提前终止
		// @ts-ignore
		await iter.return?.()
		expect(count).toBe(2)
	})
})
