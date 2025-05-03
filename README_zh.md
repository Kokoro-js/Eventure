<h1 align="center">Eventure</h1>

<a align="center">
<b>Eventure</b>：一个现代的事件库，提供丰富的监听器添加方式与触发机制，优化微任务调度性能，看看 <a href="#-性能测试">性能测试</a>。你可以在 <a href="./tests/">tests</a> 中查看详细用法示例，包括不限于 <a href="./tests/waitFor.test.ts">waitFor</a> / <a href="./tests/fire.test.ts">触发端控制中断</a> / <a href="./tests/waterfall.test.ts">监听端控制中断</a> / <a href="./tests/when.test.ts">带前置条件</a>的 <a href="./tests/once.test.ts">once/many</a> 移除监听器</a>。
</a>

<p align="center">
  <a href="https://www.npmjs.com/package/eventure">
    <img src="https://img.shields.io/npm/v/eventure?style=flat-square" alt="NPM 版本">
  </a>
  <a href="https://github.com/Kokoro-js/Eventure/actions/workflows/test.yml">
    <img src="https://github.com/Kokoro-js/Eventure/actions/workflows/test.yml/badge.svg" alt="测试状态">
  </a>
</p>

## 🚀 快速开始

### 📥 安装

```bash
# 使用 bun
bun install eventure

# 或使用 npm/yarn/pnpm
npm install eventure
yarn add eventure
pnpm i eventure
```

### 🚀 性能测试

Eventure vs [EventEmitter3](https://github.com/primus/eventemitter3) vs [mitt](https://github.com/developit/mitt)，考虑到 [EventEmitter2](https://github.com/EventEmitter2/EventEmitter2) 实现不正确有很多 bug(甚至官方benchmark有漏跑)，不此处做对比。你可以在 [tinybench](./tinybench/) 文件夹复现该结果。

|   | Task name                      | Latency avg (ns) | Latency med (ns)  | Throughput avg (ops/s) | Throughput med (ops/s) | Samples |
|---|-------------------------------|------------------|-------------------|-------------------------|-------------------------|---------|
| 0 | Eventure — sync               | 1859339 ± 12.17% | 1610900 ± 107300  | 587 ± 3.43%             | 621 ± 44               | 108     |
| 1 | EventEmitter3 (^5.0.1) — sync | 1969540 ± 5.35%  | 1822100 ± 77400   | 524 ± 2.61%             | 549 ± 24               | 102     |
| 2 | mitt (^3.0.1) — sync          | 7207250 ± 6.13%  | 7098800 ± 728550  | 142 ± 5.53%             | 141 ± 16               | 28      |
| 3 | Eventure — async              | 29530910 ± 3.63% | 29238000 ± 611700 | 34 ± 3.51%              | 34 ± 1                 | 10      |
| 4 | EventEmitter3 (^5.0.1) — async| 29716630 ± 5.01% | 30448650 ± 837400 | 34 ± 5.25%              | 33 ± 1                 | 10      |
| 5 | mitt (^3.0.1) — async         | 35307460 ± 4.21% | 35418350 ± 965900 | 28 ± 4.02%              | 28 ± 1                 | 10      |

### 🧪 示例用法

```ts
import { Eventure, type IEventMap } from "eventure"

interface MyEvents extends IEventMap {
  foo: [string];                         // 等价于 (arg1: string) => void
  bar: [number, number];                // (arg1: number, arg2: number) => void
  test: (a: number, b: number) => number
  numEvent: (value: number, next: (value: number) => number) => number;
}

const emitter = new Eventure<MyEvents>()

emitter.on("foo", (message) => {
  console.log(message)
})

emitter.emit("foo", "你好，世界")
```

更多用法请查看： [tests/](./tests/)

## 🤝 贡献指南

欢迎任何形式的贡献！如果你有改进建议或发现了问题，请提交 Pull Request 🙌。