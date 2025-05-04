<h1 align="center">Eventure</h1>

<a align="center">
<b>Eventure</b>：一个现代的事件库，提供丰富的监听器添加方式与触发机制，优化微任务调度性能，看看 <a href="#-性能测试">性能测试</a>。你可以在 <a href="./tests/">tests</a> 中查看详细用法示例，包括不限于 <a href="./tests/waitFor.test.ts">waitFor</a> / <a href="./tests/fire.test.ts">触发端控制中断</a> / <a href="./tests/waterfall.test.ts">监听端控制中断</a> / <a href="./tests/when.test.ts">带前置条件</a>的 <a href="./tests/onceMany.test.ts">once/many</a> 移除监听器</a>。
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

Eventure vs [EventEmitter3](https://github.com/primus/eventemitter3) vs [EventEmitter2](https://github.com/EventEmitter2/EventEmitter2) vs [mitt](https://github.com/developit/mitt) (每次测轮跑 ×10⁵ 次)
<br>该测试可复现，请查看 [tinybench](./tinybench/)，考虑到小于 5% 的误差在实际应用中完全可以忽略，
我们并不想夸大性能优势，Eventure 的目的是保证功能正确的同时保持第一梯队的性能，EE3 缺乏功能，EE2 混乱且难维护，这便是 Eventure 存在的意义。

| #   | Task name                 | Throughput avg (×10⁵ ops/s) | Throughput med (×10⁵ ops/s) | Latency avg (μs)    | Latency med (μs)    | Samples |
| --- | ------------------------- | --------------------------- | --------------------------- | ------------------- | ------------------- | ------- |
| 0   | Eventure — pure sync      | 541 ± 2.47%                 | 564 ± 20                    | 1.914 ± 5.85%       | 1.773 ± 0.061      | 105     |
| 1   | EventEmitter3 — pure sync | 448 ± 2.85%                 | 466 ± 14                    | 2.312 ± 5.84%       | 2.146 ± 0.061      | 87      |
| 2   | EventEmitter2 — pure sync | 416 ± 4.68%                 | 447 ± 46                    | 2.574 ± 7.84%       | 2.239 ± 0.218      | 78      |
| 3   | mitt — pure sync          | 249 ± 3.42%                 | 244 ± 22                    | 4.083 ± 3.83%       | 4.097 ± 0.368      | 50      |

| #   | Task name                         | Throughput avg (×10⁵ ops/s) | Throughput med (×10⁵ ops/s) | Latency avg (μs)     | Latency med (μs)     | Samples |
| --- | --------------------------------- | --------------------------- | --------------------------- | -------------------- | -------------------- | ------- |
| 0   | Eventure — async end-to-end       | 35 ± 9.43%                  | 37 ± 3                      | 29.266 ± 10.05%      | 27.338 ± 2.060      | 10      |
| 1   | EventEmitter3 — async end-to-end  | 33 ± 9.84%                  | 35 ± 3                      | 30.600 ± 10.63%      | 28.248 ± 2.320      | 10      |
| 2   | EventEmitter2 — async end-to-end  | 35 ± 9.77%                  | 35 ± 4                      | 29.456 ± 10.17%      | 28.825 ± 2.905      | 10      |
| 3   | mitt — async end-to-end           | 27 ± 6.63%                  | 27 ± 2                      | 37.648 ± 7.00%       | 36.845 ± 2.496      | 10      |

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