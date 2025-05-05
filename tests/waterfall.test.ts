// tests/waterfall.test.ts
import { beforeEach, describe, expect, it } from 'bun:test'
import { Eventure } from '@/index'

/**
 * 数字流水线 (number pipeline) 事件定义
 */
interface NumberPipelineEvents {
	// 接收一个数字 value，和 next 回调，返回最终数字
	numEvent: (value: number, next: (value: number) => number) => number
}

/**
 * 空返回流水线 (void pipeline) 事件定义
 */
interface VoidPipelineEvents {
	// 接收一个字符串 text，和 next 回调，无返回值
	voidEvent: (text: string, next: (text: string) => void) => void
}

describe('waterfall - 数字流水线', () => {
	let emitter: Eventure<NumberPipelineEvents>
	beforeEach(() => {
		emitter = new Eventure()
	})

	it('应按注册顺序依次调用所有 listener，并返回正确计算结果', () => {
		const calls: string[] = []

		// 第1个 listener：加 1
		emitter.on('numEvent', (value, next) => {
			calls.push('first')
			return next(value + 1)
		})
		// 第2个 listener：乘 2
		emitter.on('numEvent', (value, next) => {
			calls.push('second')
			return next(value * 2)
		})

		// 提供自定义 inner：减 3
		const result = emitter.waterfall('numEvent', 5, (final) => {
			calls.push('inner')
			return final - 3
		})

		// 调用顺序：first -> second -> inner
		expect(calls).toEqual(['first', 'second', 'inner'])
		// 计算：(5 + 1) * 2 - 3 = 9
		expect(result).toBe(9)
	})

	it('当没有 listeners 时，应只执行 inner 并返回其结果', () => {
		const calls: string[] = []

		// 不注册任何 listener，只调用 inner：直接乘 10
		const result = emitter.waterfall('numEvent', 7, (v) => {
			calls.push('inner-only')
			return v * 10
		})

		expect(calls).toEqual(['inner-only'])
		expect(result).toBe(70)
	})
})

describe('waterfall - 空返回流水线', () => {
	let emitter: Eventure<VoidPipelineEvents>
	beforeEach(() => {
		emitter = new Eventure()
	})
	it('应按注册顺序依次调用所有 listener，并在末尾完成', () => {
		const calls: string[] = []

		// Listener 1：记录并继续
		emitter.on('voidEvent', (text, next) => {
			calls.push(`L1:${text}`)
			next(text + ':step1')
		})
		// Listener 2：记录并继续
		emitter.on('voidEvent', (text, next) => {
			calls.push(`L2:${text}`)
			next(text + ':step2')
		})

		// 未传 inner，使用默认空 inner
		const returnValue = emitter.waterfall('voidEvent', 'start')

		// 调用顺序：L1 -> L2
		expect(calls).toEqual(['L1:start', 'L2:start:step1'])
		// void pipeline 应返回 undefined
		expect(returnValue).toBeUndefined()
	})

	it('当没有 listeners 时，应直接返回 undefined，且不报错', () => {
		const calls: string[] = []

		const returnValue = emitter.waterfall('voidEvent', 'nothing')

		expect(calls).toEqual([])
		expect(returnValue).toBeUndefined()
	})
})
