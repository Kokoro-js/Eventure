import { beforeEach, describe, expect, it } from 'bun:test'
import { Eventure } from '../src'

interface NumberPipelineEvents {
	numEvent: (value: number, next: (value: number) => number) => number
}
interface VoidPipelineEvents {
	voidEvent: (text: string, next: (text: string) => void) => void
}

describe('waterfall - 数字流水线', () => {
	let emitter: Eventure<NumberPipelineEvents>
	beforeEach(() => {
		emitter = new Eventure()
	})

	it('应按注册顺序依次调用所有 listener，并返回正确计算结果', () => {
		const calls: string[] = []
		emitter.on('numEvent', (v, next) => {
			calls.push('first')
			return next(v + 1)
		})
		emitter.on('numEvent', (v, next) => {
			calls.push('second')
			return next(v * 2)
		})

		const res = emitter.waterfall('numEvent', 5, (v: number) => {
			calls.push('inner')
			return v - 3
		})

		expect(calls).toEqual(['first', 'second', 'inner'])
		expect(res).toEqual({ ok: true, value: 9 }) // (5+1)*2-3 = 9
	})

	it('当没有 listeners 时，仅执行 inner 并返回其结果', () => {
		const calls: string[] = []
		const res = emitter.waterfall('numEvent', 7, (v: number) => {
			calls.push('inner-only')
			return v * 10
		})

		expect(calls).toEqual(['inner-only'])
		expect(res).toEqual({ ok: true, value: 70 })
	})

	it('listener 不调用 next 时，中断流水线，ok 为 false', () => {
		const calls: string[] = []
		emitter.on('numEvent', (v, next) => {
			calls.push('interrupt')
			return v * 3 // 不调用 next
		})

		const res = emitter.waterfall('numEvent', 2, (v: number) => v - 1)
		expect(calls).toEqual(['interrupt'])
		expect(res).toEqual({ ok: false, value: 6 }) // 2*3 = 6
	})
})

describe('waterfall - 空返回流水线', () => {
	let emitter: Eventure<VoidPipelineEvents>
	beforeEach(() => {
		emitter = new Eventure()
	})

	it('应按注册顺序依次调用所有 listener，并完成', () => {
		const calls: string[] = []
		emitter.on('voidEvent', (text, next) => {
			calls.push(`L1:${text}`)
			next(text + ':step1')
		})
		emitter.on('voidEvent', (text, next) => {
			calls.push(`L2:${text}`)
			next(text + ':step2')
		})

		const res = emitter.waterfall('voidEvent', 'start')
		expect(calls).toEqual(['L1:start', 'L2:start:step1'])
		expect(res).toEqual({ ok: true, value: undefined })
	})

	it('listener 中断时，不执行后续，ok 为 false', () => {
		const calls: string[] = []
		emitter.on('voidEvent', (text, next) => {
			calls.push(text)
			// 不调用 next
		})
		emitter.on('voidEvent', (_text, next) => {
			calls.push('should-not')
			next(_text)
		})

		const res = emitter.waterfall('voidEvent', 'X')
		expect(calls).toEqual(['X'])
		expect(res).toEqual({ ok: false, value: undefined })
	})

	it('当没有 listeners 时，应直接返回 ok=true, value=undefined', () => {
		const res = emitter.waterfall('voidEvent', 'nothing')
		expect(res).toEqual({ ok: true, value: undefined })
	})
})
