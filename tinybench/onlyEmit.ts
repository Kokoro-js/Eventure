import EventEmitter2 from 'eventemitter2'
import EventEmitter3 from 'eventemitter3'
import mitt from 'mitt'
import { Bench, hrtimeNow } from 'tinybench'
// 记得 build 了再来测试噢
import { Eventure as MyEmitter } from '../dist/index.mjs'
import pkg from './package.json' assert { type: 'json' }

const NAME = 'Eventure'
const EVENT = 'ping'
const PAYLOAD = { msg: 'hello' }
const RUNS = 1e5

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
	time: 200,
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
	time: 200,
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
