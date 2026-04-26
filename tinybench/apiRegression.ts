import { appendFile, mkdir } from 'node:fs/promises'
import { arch, cpus, platform } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
	Bench,
	type Task,
	type TaskResultWithStatistics,
	formatNumber,
} from 'tinybench'

const NAME = 'Eventure'
const PAYLOAD = { msg: 'hello' }
const TIME_MS = Number(process.env.BENCH_TIME_API_MS ?? 1000)
const EVENTURE_IMPORT = process.env.BENCH_EVENTURE_IMPORT ?? '../dist/index.mjs'
const EVENTURE_BASELINE_IMPORT = process.env.BENCH_EVENTURE_BASELINE_IMPORT
const EVENTURE_TARGET_IMPORT = process.env.BENCH_EVENTURE_TARGET_IMPORT
const MARKDOWN_PATH = process.env.BENCH_MARKDOWN_PATH
const GITHUB_OUTPUT_NAME = process.env.BENCH_GITHUB_OUTPUT_NAME
const FAIL_ON_REGRESSION = process.env.BENCH_FAIL_ON_REGRESSION === '1'
const REGRESSION_THRESHOLD_PCT = Number(
	process.env.BENCH_REGRESSION_THRESHOLD_PCT ?? 8,
)
const __dirname = dirname(fileURLToPath(import.meta.url))

type EventureInstance = {
	on(event: string, listener: (...args: any[]) => unknown): () => void
	once(event: string, listener: (...args: any[]) => unknown): () => void
	waitFor(event: string): Promise<any[]>
	emit(event: string, ...args: any[]): number
	emitAll(event: string, ...args: any[]): Promise<unknown[]>
	emitSettled(event: string, ...args: any[]): Promise<unknown[]>
	fire(event: string, ...args: any[]): Generator<unknown>
	waterfall(event: string, ...args: any[]): { ok: boolean; value: unknown }
	count(event: string): number
	maxListeners: number
}

type ChannelInstance = {
	on(listener: (...args: any[]) => unknown): () => void
	emit(...args: any[]): number
	count(): number
	maxListeners: number
}

type EventureConstructor = new (options?: {
	catchPromiseError?: boolean
}) => EventureInstance
type ChannelConstructor = new (options?: {
	catchPromiseError?: boolean
}) => ChannelInstance
type EventureModule = {
	Eventure: EventureConstructor
	EvtChannel: ChannelConstructor
}
type CompletedResult = TaskResultWithStatistics & {
	state: 'completed' | 'aborted-with-statistics'
}
type Candidate = {
	label: string
	createEventure: () => EventureInstance
	createChannel: () => ChannelInstance
}
type Harness = {
	run: () => void | Promise<void>
	value: () => number
}
type ApiCase = {
	name: string
	runs: number
	expected: number
	async?: boolean
	setup: (candidate: Candidate) => Harness
}

if (
	(EVENTURE_BASELINE_IMPORT === undefined) !==
	(EVENTURE_TARGET_IMPORT === undefined)
) {
	throw new Error(
		'BENCH_EVENTURE_BASELINE_IMPORT and BENCH_EVENTURE_TARGET_IMPORT must be set together',
	)
}

const resolveImport = (specifier: string) =>
	pathToFileURL(resolve(__dirname, specifier)).href

const importEventure = async (specifier: string) =>
	(await import(resolveImport(specifier))) as EventureModule

const eventureCandidates = await (async () => {
	if (
		EVENTURE_BASELINE_IMPORT !== undefined &&
		EVENTURE_TARGET_IMPORT !== undefined
	) {
		const [base, target] = await Promise.all([
			importEventure(EVENTURE_BASELINE_IMPORT),
			importEventure(EVENTURE_TARGET_IMPORT),
		])
		return [
			{
				label: `${NAME} base`,
				createEventure: () => new base.Eventure({ catchPromiseError: false }),
				createChannel: () => new base.EvtChannel({ catchPromiseError: false }),
			},
			{
				label: `${NAME} PR`,
				createEventure: () => new target.Eventure({ catchPromiseError: false }),
				createChannel: () =>
					new target.EvtChannel({ catchPromiseError: false }),
			},
		] satisfies Candidate[]
	}

	const mod = await importEventure(EVENTURE_IMPORT)
	return [
		{
			label: NAME,
			createEventure: () => new mod.Eventure({ catchPromiseError: false }),
			createChannel: () => new mod.EvtChannel({ catchPromiseError: false }),
		},
	] satisfies Candidate[]
})()

const pairedCandidates =
	eventureCandidates.length === 2
		? [
				eventureCandidates[0]!,
				eventureCandidates[1]!,
				{
					...eventureCandidates[1]!,
					label: `${eventureCandidates[1]!.label} mirror`,
				},
				{
					...eventureCandidates[0]!,
					label: `${eventureCandidates[0]!.label} mirror`,
				},
			]
		: eventureCandidates

const cases: ApiCase[] = [
	{
		name: 'eventure.emit.no-listeners',
		runs: 100_000,
		expected: 0,
		setup: (candidate) => {
			const emitter = candidate.createEventure()
			let count = 0
			return {
				run() {
					count = 0
					for (let i = 0; i < 100_000; i++) count += emitter.emit('none')
				},
				value: () => count,
			}
		},
	},
	{
		name: 'eventure.emit.zero-args',
		runs: 100_000,
		expected: 200_000,
		setup: (candidate) => {
			const emitter = candidate.createEventure()
			let count = 0
			emitter.on('zero', () => {
				count++
			})
			emitter.on('zero', () => {
				count++
			})
			return {
				run() {
					count = 0
					for (let i = 0; i < 100_000; i++) emitter.emit('zero')
				},
				value: () => count,
			}
		},
	},
	{
		name: 'eventure.emit.one-arg',
		runs: 100_000,
		expected: 1_000_000,
		setup: (candidate) => {
			const emitter = candidate.createEventure()
			let count = 0
			emitter.on('one', (data) => {
				count += data.msg.length
			})
			emitter.on('one', (data) => {
				count += data.msg.length
			})
			return {
				run() {
					count = 0
					for (let i = 0; i < 100_000; i++) emitter.emit('one', PAYLOAD)
				},
				value: () => count,
			}
		},
	},
	{
		name: 'eventure.emit.five-args',
		runs: 100_000,
		expected: 3_000_000,
		setup: (candidate) => {
			const emitter = candidate.createEventure()
			let count = 0
			const listener = (
				a: number,
				b: number,
				c: number,
				d: number,
				e: number,
			) => {
				count += a + b + c + d + e
			}
			emitter.on('five', listener)
			emitter.on('five', listener)
			return {
				run() {
					count = 0
					for (let i = 0; i < 100_000; i++) emitter.emit('five', 1, 2, 3, 4, 5)
				},
				value: () => count,
			}
		},
	},
	{
		name: 'eventure.emit.ten-listeners',
		runs: 100_000,
		expected: 5_000_000,
		setup: (candidate) => {
			const emitter = candidate.createEventure()
			let count = 0
			emitter.maxListeners = 0
			for (let i = 0; i < 10; i++) {
				emitter.on('ten', (data) => {
					count += data.msg.length
				})
			}
			return {
				run() {
					count = 0
					for (let i = 0; i < 100_000; i++) emitter.emit('ten', PAYLOAD)
				},
				value: () => count,
			}
		},
	},
	{
		name: 'eventure.on-off.churn',
		runs: 50_000,
		expected: 0,
		setup: (candidate) => {
			const emitter = candidate.createEventure()
			const listener = () => {}
			let count = 0
			return {
				run() {
					for (let i = 0; i < 50_000; i++) {
						const off = emitter.on('churn', listener)
						off()
					}
					count = emitter.count('churn')
				},
				value: () => count,
			}
		},
	},
	{
		name: 'eventure.emitAll.sync',
		runs: 10_000,
		expected: 50_000,
		async: true,
		setup: (candidate) => {
			const emitter = candidate.createEventure()
			let count = 0
			emitter.on('all', (n: number) => n + 1)
			emitter.on('all', (n: number) => n + 2)
			return {
				async run() {
					count = 0
					for (let i = 0; i < 10_000; i++) {
						const values = await emitter.emitAll('all', 1)
						count += (values[0] as number) + (values[1] as number)
					}
				},
				value: () => count,
			}
		},
	},
	{
		name: 'eventure.emitSettled.mixed',
		runs: 10_000,
		expected: 20_000,
		async: true,
		setup: (candidate) => {
			const emitter = candidate.createEventure()
			let count = 0
			emitter.on('settled', () => 'ok')
			emitter.on('settled', () => new Error('expected'))
			return {
				async run() {
					count = 0
					for (let i = 0; i < 10_000; i++) {
						count += (await emitter.emitSettled('settled')).length
					}
				},
				value: () => count,
			}
		},
	},
	{
		name: 'eventure.fire.iterate',
		runs: 50_000,
		expected: 100_000,
		setup: (candidate) => {
			const emitter = candidate.createEventure()
			let count = 0
			emitter.on('fire', (n: number) => n + 1)
			emitter.on('fire', (n: number) => n + 2)
			return {
				run() {
					count = 0
					for (let i = 0; i < 50_000; i++) {
						for (const record of emitter.fire('fire', 1)) {
							if ((record as any).type === 'success') count++
						}
					}
				},
				value: () => count,
			}
		},
	},
	{
		name: 'eventure.waterfall',
		runs: 50_000,
		expected: 300_000,
		setup: (candidate) => {
			const emitter = candidate.createEventure()
			let count = 0
			emitter.on('waterfall', (n: number, next: (n: number) => number) =>
				next(n + 1),
			)
			emitter.on('waterfall', (n: number, next: (n: number) => number) =>
				next(n * 2),
			)
			return {
				run() {
					count = 0
					for (let i = 0; i < 50_000; i++) {
						count += emitter.waterfall('waterfall', 2, (n: number) => n)
							.value as number
					}
				},
				value: () => count,
			}
		},
	},
	{
		name: 'eventure.waitFor.resolve',
		runs: 5_000,
		expected: 25_000,
		async: true,
		setup: (candidate) => {
			const emitter = candidate.createEventure()
			let count = 0
			return {
				async run() {
					count = 0
					for (let i = 0; i < 5_000; i++) {
						const waiting = emitter.waitFor('wait')
						emitter.emit('wait', PAYLOAD)
						const [data] = await waiting
						count += data.msg.length
					}
				},
				value: () => count,
			}
		},
	},
	{
		name: 'channel.emit.one-arg',
		runs: 100_000,
		expected: 1_000_000,
		setup: (candidate) => {
			const channel = candidate.createChannel()
			let count = 0
			channel.on((data) => {
				count += data.msg.length
			})
			channel.on((data) => {
				count += data.msg.length
			})
			return {
				run() {
					count = 0
					for (let i = 0; i < 100_000; i++) channel.emit(PAYLOAD)
				},
				value: () => count,
			}
		},
	},
	{
		name: 'channel.on-off.churn',
		runs: 50_000,
		expected: 0,
		setup: (candidate) => {
			const channel = candidate.createChannel()
			const listener = () => {}
			let count = 0
			return {
				run() {
					for (let i = 0; i < 50_000; i++) {
						const off = channel.on(listener)
						off()
					}
					count = channel.count()
				},
				value: () => count,
			}
		},
	},
]

let checksum = 0

const resultWithStatistics = (task: Task): CompletedResult => {
	const { result } = task
	if (
		result.state !== 'completed' &&
		result.state !== 'aborted-with-statistics'
	) {
		throw new Error(`Benchmark task "${task.name}" ended as ${result.state}`)
	}
	return result
}

const caseNameFromTask = (taskName: string) =>
	taskName
		.replace(/^Eventure (?:base|PR)(?: mirror)? /, '')
		.replace(/^Eventure /, '')

const labelFromTask = (taskName: string) =>
	taskName.startsWith(`${NAME} base`)
		? `${NAME} base`
		: taskName.startsWith(`${NAME} PR`)
			? `${NAME} PR`
			: NAME

const createBench = () => {
	const bench = new Bench({
		name: `${NAME} API regression benchmark`,
		time: TIME_MS,
		iterations: 10,
		timestampProvider: 'hrtimeNow',
		throws: true,
		warmup: true,
		warmupIterations: 8,
		warmupTime: Math.min(250, TIME_MS),
	})

	bench.addEventListener('cycle', (event) => {
		if (event.task === undefined) return
		const result = resultWithStatistics(event.task)
		const apiCase = cases.find((candidate) =>
			event.task!.name.endsWith(candidate.name),
		)
		const runs = apiCase?.runs ?? 1
		console.log(
			`${event.task.name}: ${formatNumber(result.throughput.mean * runs)} ops/s, rme ${result.throughput.rme.toFixed(2)}%`,
		)
	})

	return bench
}

const addTasks = (bench: Bench) => {
	for (const candidate of pairedCandidates) {
		for (const apiCase of cases) {
			let harness!: Harness
			bench.add(`${candidate.label} ${apiCase.name}`, () => harness.run(), {
				async: apiCase.async,
				beforeAll() {
					harness = apiCase.setup(candidate)
				},
				afterEach(mode) {
					if (mode !== 'run') return
					const value = harness.value()
					if (value !== apiCase.expected) {
						throw new Error(
							`${candidate.label} ${apiCase.name}: expected ${apiCase.expected}, got ${value}`,
						)
					}
					checksum += value
				},
			})
		}
	}
}

const benchRows = (bench: Bench) => {
	return bench.tasks.map((task) => {
		const result = resultWithStatistics(task)
		const apiCase = cases.find((candidate) =>
			task.name.endsWith(candidate.name),
		)
		const runs = apiCase?.runs ?? 1
		const hz = result.throughput.mean * runs

		return {
			caseName: caseNameFromTask(task.name),
			label: labelFromTask(task.name),
			hz,
			rme: result.throughput.rme,
			samples: result.latency.samplesCount,
		}
	})
}

const summarizeRows = (rows: ReturnType<typeof benchRows>) => {
	const groups = new Map<string, typeof rows>()
	for (const row of rows) {
		const key = `${row.label}\0${row.caseName}`
		const group = groups.get(key)
		if (group === undefined) {
			groups.set(key, [row])
		} else {
			group.push(row)
		}
	}

	return [...groups.values()].map((group) => ({
		caseName: group[0]!.caseName,
		label: group[0]!.label,
		hz: group.reduce((sum, row) => sum + row.hz, 0) / group.length,
		rme: Math.max(...group.map((row) => row.rme)),
		samples: group.reduce((sum, row) => sum + row.samples, 0),
	}))
}

const renderPercent = (value: number | null | undefined) =>
	value === null || value === undefined
		? '-'
		: `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`

const renderNumber = (value: number) => value.toFixed(2)

const renderRuntime = (bench: Bench) =>
	`${bench.runtime} ${bench.runtimeVersion}, ${platform()}/${arch()}, ${cpus()[0]?.model ?? 'unknown'}, timer ${bench.timestampProvider.name}`

const renderMarkdown = (
	rows: ReturnType<typeof benchRows>,
	bench: Bench,
): { markdown: string; hasRegression: boolean } => {
	const summarized = summarizeRows(rows)
	const baseRows = new Map(
		summarized
			.filter((row) => row.label === `${NAME} base`)
			.map((row) => [row.caseName, row]),
	)
	const prRows = new Map(
		summarized
			.filter((row) => row.label === `${NAME} PR`)
			.map((row) => [row.caseName, row]),
	)
	const paired = baseRows.size > 0 && prRows.size > 0
	let hasRegression = false

	const lines = [
		'## Eventure API Performance',
		`Runtime: ${renderRuntime(bench)}`,
		`Ops/sample vary by case; checksum: \`${checksum}\``,
		paired
			? 'Rows aggregate mirrored base/PR task positions and compare Eventure only.'
			: 'Single-version smoke run.',
		'',
	]

	if (paired) {
		lines.push(
			'| Case | Base x10^5 ops/s | PR x10^5 ops/s | Delta | RME max | Samples | PR ns/op |',
			'| --- | --- | --- | --- | --- | --- | --- |',
		)
		for (const apiCase of cases) {
			const base = baseRows.get(apiCase.name)
			const pr = prRows.get(apiCase.name)
			if (!base || !pr) continue
			const delta = ((pr.hz - base.hz) / base.hz) * 100
			const rme = Math.max(base.rme, pr.rme)
			const significant =
				delta < 0 &&
				Math.abs(delta) > REGRESSION_THRESHOLD_PCT + base.rme + pr.rme
			if (significant) hasRegression = true
			lines.push(
				`| ${apiCase.name} | ${renderNumber(base.hz / 100_000)} | ${renderNumber(pr.hz / 100_000)} | ${renderPercent(delta)} | ${rme.toFixed(2)}% | ${base.samples + pr.samples} | ${(1_000_000_000 / pr.hz).toFixed(2)} |`,
			)
		}
	} else {
		lines.push(
			'| Case | x10^5 ops/s | RME | Samples | ns/op |',
			'| --- | --- | --- | --- | --- |',
		)
		for (const row of summarized) {
			lines.push(
				`| ${row.caseName} | ${renderNumber(row.hz / 100_000)} | ${row.rme.toFixed(2)}% | ${row.samples} | ${(1_000_000_000 / row.hz).toFixed(2)} |`,
			)
		}
	}

	lines.push('')
	if (hasRegression) {
		lines.push(
			`- Significant regression detected. Threshold: ${REGRESSION_THRESHOLD_PCT.toFixed(2)}% plus base/PR RME.`,
		)
	} else {
		lines.push('- No significant regressions detected.')
	}
	lines.push('')

	return { markdown: lines.join('\n'), hasRegression }
}

const bench = createBench()
addTasks(bench)

console.log(`=== ${bench.name} ===`)
await bench.run()

const rows = benchRows(bench)
const { markdown, hasRegression } = renderMarkdown(rows, bench)
console.log(markdown)

if (MARKDOWN_PATH !== undefined) {
	const resolvedMarkdownPath = resolve(__dirname, MARKDOWN_PATH)
	await mkdir(dirname(resolvedMarkdownPath), { recursive: true })
	await Bun.write(resolvedMarkdownPath, markdown)
	console.log(`Benchmark markdown written to ${resolvedMarkdownPath}`)
}

if (process.env.GITHUB_STEP_SUMMARY !== undefined) {
	await appendFile(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`, 'utf8')
}

if (
	process.env.GITHUB_OUTPUT !== undefined &&
	GITHUB_OUTPUT_NAME !== undefined
) {
	let delimiter = 'BENCHMARK_MARKDOWN'
	while (markdown.includes(delimiter)) {
		delimiter = `${delimiter}_END`
	}
	await appendFile(
		process.env.GITHUB_OUTPUT,
		`${GITHUB_OUTPUT_NAME}<<${delimiter}\n${markdown}\n${delimiter}\n`,
		'utf8',
	)
}

if (hasRegression && FAIL_ON_REGRESSION) {
	process.exitCode = 1
}
