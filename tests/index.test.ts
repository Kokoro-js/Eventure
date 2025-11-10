// eventified.test.ts
import { beforeEach, describe, expect, it } from 'bun:test'
import { Eventure } from '../src'

describe('Eventified 核心功能', () => {
	let emitter: Eventure<{
		syncEvt: [number, string]
		asyncEvt: [string]
	}>

	beforeEach(() => {
		emitter = new Eventure()
	})

	it('注册并触发同步监听器', () => {
		const calls: Array<[number, string]> = []
		emitter.on('syncEvt', (n, s) => {
			calls.push([n, s])
		})
		emitter.emit('syncEvt', 42, 'hello')
		expect(calls.length).toBe(1)
		expect(calls[0]).toEqual([42, 'hello'])
	})

	it('多监听器按添加顺序执行', () => {
		const order: string[] = []
		emitter.on('syncEvt', () => order.push('first'))
		emitter.on('syncEvt', () => order.push('second'))
		emitter.emit('syncEvt', 0, '')
		expect(order).toEqual(['first', 'second'])
	})

	it('prependListener 能改变执行顺序', () => {
		const order: string[] = []
		emitter.on('syncEvt', () => order.push('second'))
		emitter.onFront('syncEvt', () => order.push('first'))
		emitter.emit('syncEvt', 0, '')
		expect(order).toEqual(['first', 'second'])
	})

	it('removeListener / off 能移除指定监听器', () => {
		const calls: number[] = []
		const listener = (n: number, s: string) => calls.push(n)
		emitter.on('syncEvt', listener)
		emitter.emit('syncEvt', 1, '')
		emitter.off('syncEvt', listener)
		emitter.emit('syncEvt', 2, '')
		expect(calls).toEqual([1])
	})

	it('addListener(returnUnsub=true) 返回的 unsubscribe 可取消监听', () => {
		const calls: number[] = []
		const unsub = emitter.on('syncEvt', (n, s) => calls.push(n))
		emitter.emit('syncEvt', 5, '')
		unsub()
		emitter.emit('syncEvt', 6, '')
		expect(calls).toEqual([5])
	})

	it('异步监听器能够被触发且执行完成', async () => {
		let called = false
		emitter.on('asyncEvt', async (msg) => {
			if (msg === 'test') called = true
		})
		emitter.emit('asyncEvt', 'test')
		// 等待下一个微任务
		await Promise.resolve()
		expect(called).toBe(true)
	})

	it('异步监听器能不将 emit 拖入微任务', async () => {
		let called = false
		emitter.on('asyncEvt', async (msg) => {
			if (msg === 'test') called = true
		})
		emitter.on('asyncEvt', (msg) => {
			expect(called).toBe(false)
		})
		emitter.emit('asyncEvt', 'test')
		// 等待下一个微任务
		await Promise.resolve()
		expect(called).toBe(true)
	})

	it('异步监听器抛错时不向外抛出（已被内部 catch）', async () => {
		let called = false
		// 不应该抛出异常
		expect(() => {
			emitter.on('asyncEvt', async () => {
				called = true
				throw new Error('failure')
			})
			emitter.emit('asyncEvt', 'oops')
		}).not.toThrow()
		// 等待内部 promise 完成
		await Promise.resolve()
		expect(called).toBe(true)
	})

	it('count、listeners 以及 removeAllListeners', () => {
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
