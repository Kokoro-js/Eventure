import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

interface TaskSummary {
	label: string
	mode: 'sync' | 'async'
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
	mode: 'sync' | 'async'
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

interface DiffRow {
	benchMode: BenchSummary['mode']
	benchName: string
	task: string
	base?: TaskSummary
	target?: TaskSummary
	deltaOps?: number
	deltaPct?: number
	significant: boolean
	isRegression: boolean
	isImprovement: boolean
}

const usage = `Usage: bun scripts/compareBenchmarks.ts <baseline.json> <target.json> [output.md]`

const [, , baselinePathArg, targetPathArg, outputPathArg] = process.argv

if (!baselinePathArg || !targetPathArg) {
	console.error(usage)
	process.exit(1)
}

const baselinePath = resolve(process.cwd(), baselinePathArg)
const targetPath = resolve(process.cwd(), targetPathArg)
const outputPath = outputPathArg ? resolve(process.cwd(), outputPathArg) : null

const baselineReport = JSON.parse(
	await readFile(baselinePath, 'utf8'),
) as BenchmarkReport
const targetReport = JSON.parse(
	await readFile(targetPath, 'utf8'),
) as BenchmarkReport

const benchMap = (report: BenchmarkReport) =>
	Object.fromEntries(report.benches.map((bench) => [bench.mode, bench]))

const baselineBenches = benchMap(baselineReport)
const targetBenches = benchMap(targetReport)
const benchModes = new Set<BenchSummary['mode']>([
	...Object.keys(baselineBenches),
	...Object.keys(targetBenches),
] as BenchSummary['mode'][])

const diffs: DiffRow[] = []

for (const mode of benchModes) {
	const baselineBench = baselineBenches[mode]
	const targetBench = targetBenches[mode]
	if (!baselineBench && !targetBench) continue

	const baseTasks = new Map(
		(baselineBench?.tasks ?? []).map((task) => [task.label, task]),
	)
	const targetTasks = new Map(
		(targetBench?.tasks ?? []).map((task) => [task.label, task]),
	)
	const labels = new Set([...baseTasks.keys(), ...targetTasks.keys()])

	for (const label of labels) {
		const base = baseTasks.get(label)
		const target = targetTasks.get(label)
		const baseOps = base?.throughput.mean
		const targetOps = target?.throughput.mean
		const deltaOps =
			baseOps !== undefined && targetOps !== undefined
				? targetOps - baseOps
				: undefined
		const deltaPct =
			baseOps && targetOps ? (deltaOps / baseOps) * 100 : undefined
		const combinedRme =
			(base?.throughput.rme ?? 0) + (target?.throughput.rme ?? 0)
		const minThreshold = 5
		const significanceThreshold = Math.max(combinedRme, minThreshold)
		const significant =
			deltaPct !== undefined && Math.abs(deltaPct) > significanceThreshold
		const isRegression = Boolean(significant && deltaPct !== undefined && deltaPct < 0)
		const isImprovement = Boolean(significant && deltaPct !== undefined && deltaPct > 0)

		diffs.push({
			benchMode: mode,
			benchName: targetBench?.name ?? baselineBench?.name ?? mode,
			task: label,
			base,
			target,
			deltaOps,
			deltaPct,
			significant,
			isRegression,
			isImprovement,
		})
	}
}

const renderOps = (value: number | undefined) =>
	value === undefined ? '—' : value.toFixed(2)

const renderPercent = (value: number | undefined) =>
	value === undefined
		? '—'
		: `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`

const renderSamples = (base?: number, target?: number) => {
	if (base === undefined && target === undefined) return '—'
	return `${base ?? '—'}→${target ?? '—'}`
}

const renderRme = (base?: number, target?: number) => {
	if (base === undefined && target === undefined) return '—'
	const format = (value?: number) =>
		value === undefined ? '—' : `${value.toFixed(2)}%`
	return `${format(base)}→${format(target)}`
}

const improvements = diffs.filter((row) => row.isImprovement)
const regressions = diffs.filter((row) => row.isRegression)

const summaryLines = []

if (regressions.length) {
	const items = regressions
		.map(
			(row) =>
				`**${row.task} (${row.benchMode})** ${renderPercent(
					row.deltaPct,
				)}`,
		)
		.join(', ')
	summaryLines.push(`- ⚠️ Significant regressions: ${items}`)
} else {
	summaryLines.push('- ✅ No significant regressions detected.')
}

if (improvements.length) {
	const items = improvements
		.map(
			(row) =>
				`**${row.task} (${row.benchMode})** ${renderPercent(
					row.deltaPct,
				)}`,
		)
		.join(', ')
	summaryLines.push(`- 🚀 Notable improvements: ${items}`)
} else {
	summaryLines.push('- ℹ️ No improvements above the noise threshold.')
}

const renderTableForMode = (mode: BenchSummary['mode']) => {
	const rows = diffs.filter((row) => row.benchMode === mode)
	if (!rows.length) return ''
	const header = [
		`### ${mode === 'sync' ? 'Sync emit loop' : 'Async end-to-end'}`,
		'| Task | Baseline ops/s | PR ops/s | Δ ops/s | Δ % | RME (base→PR) | Samples (base→PR) |',
		'| --- | --- | --- | --- | --- | --- | --- |',
	]
	const body = rows
		.sort((a, b) => (a.base?.rank ?? Infinity) - (b.base?.rank ?? Infinity))
		.map((row) => {
			const note =
				row.significant && row.deltaPct !== undefined
					? row.deltaPct > 0
						? '✅'
						: '⚠️'
					: ''
			const cells = [
				note ? `${row.task} ${note}` : row.task,
				renderOps(row.base?.throughput.mean),
				renderOps(row.target?.throughput.mean),
				renderOps(row.deltaOps),
				renderPercent(row.deltaPct),
				renderRme(row.base?.throughput.rme, row.target?.throughput.rme),
				renderSamples(row.base?.samples, row.target?.samples),
			]
			return `| ${cells.join(' | ')} |`
		})
	return [...header, ...body, ''].join('\n')
}

const markdownSections = [
	'## Benchmark Performance',
	`Baseline: ${baselineReport.generatedAt} (Bun ${baselineReport.bunVersion})`,
	`PR: ${targetReport.generatedAt} (Bun ${targetReport.bunVersion})`,
	'',
	...summaryLines,
	'',
	renderTableForMode('sync'),
	renderTableForMode('async'),
].filter((line) => line !== undefined && line !== null)

const markdown = markdownSections.join('\n')

if (outputPath) {
	await writeFile(outputPath, markdown, 'utf8')
	console.log(`Benchmark comparison written to ${outputPath}`)
} else {
	console.log(markdown)
}
