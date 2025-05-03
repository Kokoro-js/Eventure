import EventEmitter3 from 'eventemitter3'
import mitt from 'mitt'
import { Bench } from 'tinybench'
// 引入主项目的实现（假设导出 default 为类 MyEmitter）
import { Eventure as MyEmitter } from '../dist/index.mjs'
import pkg from './package.json' assert { type: 'json' }

const NAME = 'Eventure'
const EVENT = 'ping'
const PAYLOAD = { msg: 'hello' }
const RUNS = 1e5

// 同步逻辑：注册 handler 并触发 RUNS 次
function runSync(emitter: any) {
	let cnt = 0
	emitter.on(EVENT, (data: any) => {
		cnt += data.msg.length
	})
	for (let i = 0; i < RUNS; i++) {
		emitter.emit(EVENT, PAYLOAD)
	}
}

// 异步逻辑：handler 内部异步，触发后等待微任务
async function runAsync(emitter: any) {
	let cnt = 0
	emitter.on(EVENT, async (data: any) => {
		await Promise.resolve() // 模拟异步
		cnt += data.msg.length
	})
	for (let i = 0; i < RUNS; i++) {
		emitter.emit(EVENT, PAYLOAD)
		await Promise.resolve()
	}
}

async function main() {
	// 创建一个 Bench 实例，指定跑 200ms 或至少 10 次迭代
	const bench = new Bench({
		name: `${NAME} vs eventemitter3 vs mitt`,
		time: 200,
		iterations: 10,
	})

	// 添加同步任务
	bench
		.add(`${NAME} — sync`, () => runSync(new MyEmitter()))
		.add(`EventEmitter3 (${pkg.dependencies.eventemitter3}) — sync`, () =>
			runSync(new EventEmitter3()),
		)
		.add(`mitt (${pkg.dependencies.mitt}) — sync`, () => runSync(mitt()))

	// 添加异步任务
	bench
		.add(
			`${NAME} — async`,
			async () => await runAsync(new MyEmitter({ catchPromiseError: false })),
		)
		.add(
			`EventEmitter3 (${pkg.dependencies.eventemitter3}) — async`,
			async () => await runAsync(new EventEmitter3()),
		)
		.add(
			`mitt (${pkg.dependencies.mitt}) — async`,
			async () => await runAsync(mitt()),
		)

	// 执行所有 benchmark
	await bench.run()

	// 输出结果
	console.log(`=== ${bench.name} ===`)
	console.table(bench.table())
}

main().catch((err) => {
	console.error(err)
	process.exit(1)
})
