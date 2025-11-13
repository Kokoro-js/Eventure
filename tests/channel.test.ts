import { beforeEach, describe, expect, it } from 'bun:test'
import { EvtChannel } from '../src'

type StringEvent = [string]

describe('EvtChannel core', () => {
	let channel: EvtChannel<StringEvent>

	beforeEach(() => {
		channel = new EvtChannel()
	})

	it('registers listeners, supports abort signals and clearing', () => {
		const calls: string[] = []
		const controller = new AbortController()

		const unsub = channel.on((value) => {
			calls.push(`first:${value}`)
		})
		channel.on(
			(value) => {
				calls.push(`second:${value}`)
			},
			{ signal: controller.signal },
		)
		expect(channel.emit('alpha')).toBe(2)
		controller.abort()
		expect(channel.emit('beta')).toBe(1)

		unsub()
		expect(channel.count()).toBe(0)
		channel.clear()
		expect(channel.count()).toBe(0)
		expect(calls).toEqual(['first:alpha', 'second:alpha', 'first:beta'])
	})

	it('supports once/many/when and waitFor', async () => {
		const seen: string[] = []

		channel.once((value) => {
			seen.push(`once:${value}`)
		})
		channel.many(2, (value) => {
			seen.push(`many:${value}`)
		})

		const guard = channel.when((value) => value.startsWith('OK'))
		guard.once((value) => {
			seen.push(`guard:${value}`)
		})

		const waiting = channel.waitFor()
		channel.emit('OK-1')
		channel.emit('skip')
		channel.emit('OK-2')

		await expect(waiting).resolves.toEqual(['OK-1'])
		expect(seen).toEqual(['once:OK-1', 'many:OK-1', 'guard:OK-1', 'many:skip'])
		expect(channel.count()).toBe(0)
	})
})

describe('EvtChannel fire & waterfall helpers', () => {
	it('emits listener snapshots through fire/fireAsync', async () => {
		const chan = new EvtChannel<StringEvent>()
		const syncFn = (value: string) => value.toUpperCase()
		const asyncFn = async (value: string) => value.repeat(2)
		const boomFn = () => {
			throw new Error('boom')
		}

		chan.on(syncFn)
		chan.on(asyncFn)
		chan.on(boomFn)

		const subset = chan.listeners().slice(0, 2)
		const subsetRecords = Array.from(chan.fire(subset, 'hi'))

		expect(subsetRecords).toHaveLength(2)
		expect(subsetRecords[0]).toMatchObject({
			type: 'success',
			result: 'HI',
		})
		expect(subsetRecords[1]?.type).toBe('async')
		await expect((subsetRecords[1] as any).promise).resolves.toBe('hihi')

		const gen = chan.fire(chan.listeners(), 'ok')
		expect(Array.from(gen)).toHaveLength(3)

		const asyncTypes: string[] = []
		for await (const record of chan.fireAsync('zz')) {
			asyncTypes.push(record.type)
			if (record.type === 'error') break
		}
		expect(asyncTypes).toEqual(['success', 'success', 'error'])
	})

	it('executes waterfall pipelines and reports interruption', () => {
		type PipelineEvent = (
			value: number,
			next: (value: number) => number,
		) => number
		const pipeline = new EvtChannel<PipelineEvent>()

		pipeline.on((value, next) => next(value + 1))
		pipeline.on((value, next) => next(value * 2))

		const ok = pipeline.waterfall(2, (value: number) => value)
		expect(ok).toEqual({ ok: true, value: 6 })

		pipeline.on((value) => value - 10)
		const interrupted = pipeline.waterfall(3)
		expect(interrupted).toEqual({ ok: false, value: -2 })

		const snapshot = pipeline.listeners().slice(0, 2)
		const withInner = pipeline.waterfall(
			snapshot,
			1,
			(final: number) => final * 10,
		)
		expect(withInner).toEqual({ ok: true, value: 40 })
	})
})
