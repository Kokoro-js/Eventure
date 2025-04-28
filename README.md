<h1 align="center">Eventure</h1>

<a align="center">
<b>Eventure</b>：一个现代的事件库，提供丰富的监听器添加方式与触发机制，优化微任务调度性能。你可以在 <a href="./tests/">tests</a> 中查看详细用法示例。
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