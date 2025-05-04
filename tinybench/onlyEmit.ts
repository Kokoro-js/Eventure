import EventEmitter3 from 'eventemitter3'
import mitt from 'mitt'
import { Bench, hrtimeNow } from 'tinybench'
import { Eventure as MyEmitter } from '../dist/index.mjs'
import pkg from './package.json' assert { type: 'json' }

const NAME = 'Eventure'
const EVENT = 'ping'
const PAYLOAD = { msg: 'hello' }
const RUNS = 1e5

async function main() {
	//
	// —— Pure Sync Benchmark ——
	//

	// Prepare emitters and listeners once, outside measurement
	const emitterEventure = new MyEmitter()
	let cntEventure = 0
	emitterEventure.on(EVENT, (data) => {
		cntEventure += data.msg.length
	})
	emitterEventure.on(EVENT, (data) => {
		cntEventure += data.msg.length
	})

	const emitterEE3 = new EventEmitter3()
	let cntEE3 = 0
	emitterEE3.on(EVENT, (data) => {
		cntEE3 += data.msg.length
	})
	emitterEE3.on(EVENT, (data) => {
		cntEE3 += data.msg.length
	})

	const emitterMitt = mitt<any>()
	let cntMitt = 0
	emitterMitt.on(EVENT, (data) => {
		cntMitt += data.msg.length
	})
	emitterMitt.on(EVENT, (data) => {
		cntMitt += data.msg.length
	})

	// Create a Bench for sync, using high-precision clock
	const benchSync = new Bench({
		name: `${NAME} vs eventemitter3 vs mitt — sync`,
		time: 200,
		iterations: 10,
		now: hrtimeNow,
	})

	benchSync
		.add(`${NAME} — pure sync`, () => {
			cntEventure = 0
			for (let i = 0; i < RUNS; i++) {
				emitterEventure.emit(EVENT, PAYLOAD)
			}
		})
		.add(
			`EventEmitter3 (${pkg.dependencies.eventemitter3}) — pure sync`,
			() => {
				cntEE3 = 0
				for (let i = 0; i < RUNS; i++) {
					emitterEE3.emit(EVENT, PAYLOAD)
				}
			},
		)
		.add(`mitt (${pkg.dependencies.mitt}) — pure sync`, () => {
			cntMitt = 0
			for (let i = 0; i < RUNS; i++) {
				emitterMitt.emit(EVENT, PAYLOAD)
			}
		})

	await benchSync.run()
	console.log(`=== ${benchSync.name} ===`)
	console.table(benchSync.table())

	//
	// —— End-to-End Async Benchmark ——
	//

	// Prepare emitters and collect listener Promises
	const emitterEventureAsync = new MyEmitter({ catchPromiseError: false })
	let cntEventureAsync = 0
	let promisesEventure: any[] = []
	emitterEventureAsync.on(EVENT, (data) => {
		const p = Promise.resolve().then(() => {
			cntEventureAsync += data.msg.length
		})
		promisesEventure.push(p)
		return p
	})

	const emitterEE3Async = new EventEmitter3()
	let cntEE3Async = 0
	let promisesEE3: any[] = []
	emitterEE3Async.on(EVENT, (data) => {
		const p = Promise.resolve().then(() => {
			cntEE3Async += data.msg.length
		})
		promisesEE3.push(p)
		return p
	})

	const emitterMittAsync = mitt<any>()
	let cntMittAsync = 0
	let promisesMitt: any[] = []
	emitterMittAsync.on(EVENT, (data) => {
		const p = Promise.resolve().then(() => {
			cntMittAsync += data.msg.length
		})
		promisesMitt.push(p)
		return p
	})

	// Create a Bench for async
	const benchAsync = new Bench({
		name: `${NAME} vs eventemitter3 vs mitt — async`,
		time: 200,
		iterations: 10,
		now: hrtimeNow,
	})

	benchAsync
		.add(`${NAME} — async end-to-end`, async () => {
			cntEventureAsync = 0
			promisesEventure = []
			for (let i = 0; i < RUNS; i++) {
				emitterEventureAsync.emit(EVENT, PAYLOAD)
			}
			await Promise.all(promisesEventure)
		})
		.add(
			`EventEmitter3 (${pkg.dependencies.eventemitter3}) — async end-to-end`,
			async () => {
				cntEE3Async = 0
				promisesEE3 = []
				for (let i = 0; i < RUNS; i++) {
					emitterEE3Async.emit(EVENT, PAYLOAD)
				}
				await Promise.all(promisesEE3)
			},
		)
		.add(`mitt (${pkg.dependencies.mitt}) — async end-to-end`, async () => {
			cntMittAsync = 0
			promisesMitt = []
			for (let i = 0; i < RUNS; i++) {
				emitterMittAsync.emit(EVENT, PAYLOAD)
			}
			await Promise.all(promisesMitt)
		})

	await benchAsync.run()
	console.log(`=== ${benchAsync.name} ===`)
	console.table(benchAsync.table())
}

main().catch((err) => {
	console.error(err)
	process.exit(1)
})
