import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import EventEmitter2 from 'eventemitter2'
import EventEmitter3 from 'eventemitter3'
import mitt from 'mitt'
import { Bench, hrtimeNow } from 'tinybench'
// 记得 build 了再来测试噢
import { Eventure as MyEmitter } from '../dist/index.mjs'
import pkg from './package.json'

const NAME = 'Eventure'
const EVENT = 'ping'
const PAYLOAD = { msg: 'hello' }
const RUNS = 1e5
const OUTPUT_PATH =
	process.env.BENCH_RESULTS_PATH ??
	'../benchmarks/onlyEmit.latest.json'
const __dirname = dirname(fileURLToPath(import.meta.url))
const resolvedOutputPath = resolve(__dirname, OUTPUT_PATH)

type BenchMode = 'sync' | 'async'

interface TaskSummary {
	label: string
	mode: BenchMode
	rank: number
	throughput: {
		mean: number
		median: number
		rme: number
	}
	latencyNs: {
		mean: number
		median: number
	}
	samples: number
	relativeToEventure: number | null
	relativeToFastest: number | null
}

interface BenchSummary {
	mode: BenchMode
	name: string
	iterations: number
	time: number
	tasks: TaskSummary[]
}

interface BenchmarkReport {
	generatedAt: string
	bunVersion: string
	meta: {
		title: string
		event: string
		runsPerIteration: number
		payloadBytes: number
	}
	benches: BenchSummary[]
}

// 统一定义三种实现的配置，后续循环注册
const title = `${NAME} vs eventemitter3(${pkg.dependencies.eventemitter3}) vs eventemitter2(${pkg.dependencies.eventemitter2}) vs mitt(${pkg.dependencies.mitt})`
const implementations = [
	{
		label: `${NAME} — pure sync`,
		// 我们的库默认帮助用户 catchPromiseError，但其他库不会，关闭以平衡这部分开销
		create: () => new MyEmitter({ catchPromiseError: false }),
	},
	{
		label: `EventEmitter3 — pure sync`,
		create: () => new EventEmitter3(),
	},
	{
		label: `EventEmitter2 — pure sync`,
		create: () => new EventEmitter2(),
	},
	{
		label: `mitt — pure sync`,
		create: () => mitt<any>(),
	},
]

// —— Pure Sync Benchmark ——
const benchSync = new Bench({
	name: `${title} — sync`,
	time: 100,
	iterations: 10,
	now: hrtimeNow,
})

implementations.forEach(({ label, create }) => {
	let emitter: any
	let cnt = 0

	benchSync.add(
		label,
		() => {
			// 核心：只负责 emit 循环
			for (let i = 0; i < RUNS; i++) {
				emitter.emit(EVENT, PAYLOAD)
			}
		},
		{
			// 在该任务所有迭代前只执行一次：创建 emitter 并注册两个 listener(有些库对单体存对象来换取 bench 优势)
			beforeAll() {
				emitter = create()
				emitter.on(EVENT, (data: any) => {
					cnt += data.msg.length
				})
				emitter.on(EVENT, (data: any) => {
					cnt += data.msg.length
				})
			},
			// 在每次迭代前清零计数器
			beforeEach() {
				cnt = 0
			},
		},
	)
})

await benchSync.run()
console.log(`=== ${benchSync.name} ===`)
console.table(benchSync.table())

// —— End-to-End Async Benchmark ——
const benchAsync = new Bench({
	name: `${title} — async`,
	time: 2000,
	iterations: 10,
	now: hrtimeNow,
})

implementations.forEach(({ label, create }) => {
	let emitter: any
	let cnt = 0
	let promises: Promise<any>[] = []

	benchAsync.add(
		label.replace('pure sync', 'async end-to-end'),
		async () => {
			for (let i = 0; i < RUNS; i++) {
				emitter.emit(EVENT, PAYLOAD)
			}
			await Promise.all(promises)
		},
		{
			beforeAll() {
				emitter = create()
				// 每次 emit 都往 promises 收集返回的 Promise
				emitter.on(EVENT, (data: any) => {
					const p = Promise.resolve().then(() => {
						cnt += data.msg.length
					})
					promises.push(p)
					return p
				})
			},
			beforeEach() {
				cnt = 0
				promises = []
			},
		},
	)
})

await benchAsync.run()
console.log(`=== ${benchAsync.name} ===`)
console.table(benchAsync.table())

const payloadBytes = new TextEncoder().encode(JSON.stringify(PAYLOAD)).length

const toNs = (ms: number | undefined) => (ms ?? 0) * 1_000_000

const summarizeBench = (bench: Bench, mode: BenchMode): BenchSummary => {
	const summaries: TaskSummary[] = bench.tasks.map((task) => {
		const result = task.result
		if (!result) {
			throw new Error(`Missing benchmark result for ${task.name}`)
		}
		const throughputMedian = result.throughput.p50 ?? result.throughput.mean
		const latencyMedian = result.latency.p50 ?? result.latency.mean

		return {
			label: task.name,
			mode,
			rank: 0,
			throughput: {
				mean: result.throughput.mean,
				median: throughputMedian,
				rme: result.throughput.rme,
			},
			latencyNs: {
				mean: toNs(result.latency.mean),
				median: toNs(latencyMedian),
			},
			samples: result.throughput.samples.length,
			relativeToEventure: null,
			relativeToFastest: null,
		}
	})

	const sortedByThroughput = [...summaries].sort(
		(a, b) => b.throughput.mean - a.throughput.mean,
	)
	const fastestOps = sortedByThroughput[0]?.throughput.mean ?? null
	const eventureOps =
		summaries.find((task) => task.label.startsWith(NAME))?.throughput.mean ??
		null

	return {
		mode,
		name: bench.name ?? mode,
		iterations: bench.opts.iterations ?? 0,
		time: bench.opts.time ?? 0,
		tasks: summaries.map((task) => {
			const rank =
				sortedByThroughput.findIndex(
					(candidate) => candidate.label === task.label,
				) + 1
			return {
				...task,
				rank,
				relativeToEventure:
					eventureOps && task.throughput.mean
						? task.throughput.mean / eventureOps
						: null,
				relativeToFastest:
					fastestOps && task.throughput.mean
						? task.throughput.mean / fastestOps
						: null,
			}
		}),
	}
}

const report: BenchmarkReport = {
	generatedAt: new Date().toISOString(),
	bunVersion: Bun.version,
	meta: {
		title,
		event: EVENT,
		runsPerIteration: RUNS,
		payloadBytes,
	},
	benches: [summarizeBench(benchSync, 'sync'), summarizeBench(benchAsync, 'async')],
}

await mkdir(dirname(resolvedOutputPath), { recursive: true })
await Bun.write(resolvedOutputPath, JSON.stringify(report, null, 2))
console.log(`Benchmark report written to ${resolvedOutputPath}`)
