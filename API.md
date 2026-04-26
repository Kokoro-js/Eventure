# API

这份文档记录 Eventure 的公开接口。README 只保留快速上手和能力索引，具体签名和行为以这里为准。

## 事件类型

事件描述可以写成 tuple，也可以写成函数签名：

```ts
interface Events {
	message: [text: string]
	sum: (a: number, b: number) => number
}
```

tuple 适合无返回值事件；函数签名适合需要收集 listener 返回值的事件。

## Eventure

`Eventure<E>` 管理一组命名事件，所有方法都需要传事件名。

```ts
import { Eventure } from 'eventure'

const events = new Eventure<Events>()
```

### 构造参数

```ts
new Eventure<Events>({
	events: ['message'],
	catchPromiseError: true,
	checkSyncFuncReturnPromise: false,
	errorPolicy: 'log',
})
```

- `events`：预初始化事件名。
- `catchPromiseError`：是否捕获异步 listener 的 rejection，默认 `true`。
- `checkSyncFuncReturnPromise`：是否处理同步函数返回 Promise 的情况，默认 `false`。
- `errorPolicy`：同步错误策略，取值为 `'silent'`、`'log'`、`'throw'`，默认 `'log'`。
- `logger`：自定义日志对象，需要符合导出的 `Logger` 类型。

### 注册和移除

```ts
const off = events.on('message', listener, { signal })
events.onFront('message', listener)
events.onAt('message', { at: 0 }, listener)

events.off('message', listener)
events.clear('message')
events.clear()
```

- `on(event, listener, options?)`：尾部注册 listener，返回退订函数。
- `onFront(event, listener, options?)`：注册到队列头部。
- `onAt(event, { at, signal? }, listener)`：按位置注册，`at` 可以是数字，也可以是 `(ctx) => number`。
- `off(event, listener)`：移除一个 listener，返回是否真的移除。
- `clear(event?)`：清空指定事件；不传事件名时清空全部。
- 退订函数同时支持 `[Symbol.dispose]`，可配合 `using` 使用。

### 限次和条件监听

```ts
events.once('message', listener)
events.onceFront('message', listener)
events.many('message', 3, listener)
events.manyFront('message', 3, listener)

events.when('message', (text) => text.startsWith('ok:')).once(listener)
events.waitFor('message', { timeout: 1000, filter: Boolean })
```

- `once` / `onceFront`：命中一次后自动退订。
- `many` / `manyFront`：命中指定次数后自动退订，`times` 必须大于等于 `1`。
- `when(event, predicate?)`：返回条件注册器，支持 `once`、`onceFront`、`many`、`manyFront`。
- `waitFor(event, options?)`：返回带 `cancel()` 方法的 Promise，resolve 值是事件参数 tuple。
- `waitFor` 支持 `timeout`、`signal`、`filter` 和 `prepend`。

### 触发

```ts
events.emit('message', 'hello')

const values = await events.emitAll('sum', 1, 2)
const settled = await events.emitSettled('sum', 1, 2)
```

- `emit(event, ...args)`：同步触发所有 listener，返回触发数量。
- `emitAll(event, ...args)`：等待所有 listener 结果；listener throw、reject 或返回 `Error` 时 reject。
- `emitSettled(event, ...args)`：始终 resolve，返回 `{ fn, status, value | reason }[]`。

`emit()` 读取触发开始时的监听器快照。listener 在触发过程中新增或移除，不会影响当前这次触发。

### 监听器上限

```ts
events.maxListeners = 20
events.maxListeners = 0 // 不限制
```

`maxListeners` 默认是 `10`。注册后超过上限时会通过 `logger.warn` 提示；设置为 `0` 或 `Infinity` 表示不限制。其他值必须是非负整数，否则会抛出 `RangeError`。

### 逐个消费

```ts
for (const record of events.fire('sum', 1, 2)) {
	if (record.type === 'error') break
}

for await (const record of events.fireAsync('sum', 1, 2)) {
	if (record.type === 'success') console.log(record.result)
}
```

- `fire(event, ...args)`：返回同步 generator，每次 yield 一个 listener 的执行结果。
- `fireAsync(event, ...args)`：返回 async generator，逐个等待 listener。
- 两者也支持直接传 listener 数组：`fire(listeners, ...args)`。

`fire()` 的记录类型包括：

- `{ type: 'success', fn, result }`
- `{ type: 'error', fn, error }`
- `{ type: 'async', fn, promise }`

`fireAsync()` 的记录类型包括：

- `{ type: 'success', fn, result }`
- `{ type: 'error', fn, error }`

### Waterfall

```ts
interface Pipeline {
	num: (value: number, next: (value: number) => number) => number
}

const pipeline = new Eventure<Pipeline>()
const result = pipeline.waterfall('num', 1)
```

`waterfall(event, ...args)` 让 listener 通过最后一个参数 `next` 串联执行。返回值形如 `{ ok, value }`：

- `ok: true`：所有 listener 都调用了 `next`。
- `ok: false`：某个 listener 没有调用 `next`，流水线被中断。

也可以在最后传入一个 inner callback，作为所有 listener 之后的收尾函数。

### 查询

```ts
events.count('message')
events.events()
events.listeners('message')
events.listenersUnsafe('message')
```

- `count(event)`：返回 listener 数量。
- `events()`：返回当前有 listener 的事件名。
- `listeners(event)`：返回 listener 数组副本。
- `listenersUnsafe(event)`：返回内部数组引用，零拷贝；不要 mutate。
- `queryListeners(event)`：`listenersUnsafe` 的兼容别名。

## EvtChannel

`EvtChannel<D>` 只管理一个事件，方法语义与 `Eventure` 基本相同，只是省略事件名。

```ts
import { EvtChannel } from 'eventure'

const channel = new EvtChannel<[text: string]>()

channel.on((text) => console.log(text))
channel.emit('hello')
```

常用方法：

- `on(listener, options?)`
- `onFront(listener, options?)`
- `onAt({ at, signal? }, listener)`
- `off(listener)`
- `clear()`
- `emit(...args)`
- `emitAll(...args)`
- `emitSettled(...args)`
- `count()`
- `listeners()`
- `once(listener, predicate?)`
- `onceFront(listener, predicate?)`
- `many(times, listener, predicate?)`
- `manyFront(times, listener, predicate?)`
- `when(predicate?)`
- `waitFor(options?)`
- `fire(...args)`
- `fireAsync(...args)`
- `waterfall(...args)`

`EvtChannel` 使用与 `Eventure` 相同的构造策略参数，但没有 `events` 预初始化选项。
`maxListeners` 语义也相同：默认 `10`，`0` 或 `Infinity` 表示不限制。
