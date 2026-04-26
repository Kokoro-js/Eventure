# 性能说明

Eventure 的性能优化集中在 `emit()`。如果一个场景里触发远多于注册和移除，copy-on-write 的监听器数组通常更划算；如果频繁 `on/off`，这套取舍未必合适。

## 基本取舍

监听器数组使用 copy-on-write：

- 注册和移除监听器时创建新数组；
- `emit()` 读取当前数组引用，不执行 `slice()`；
- 监听器在触发过程中新增或移除，不影响当前这次触发。

也就是说，写入路径多付一点成本，触发路径少做分配。

## 快照语义

触发过程中修改监听器时，当前遍历集合不会变化。可以把语义理解成这样：

```ts
const snapshot = listeners[event]
for (let i = 0; i < snapshot.length; i++) {
	snapshot[i](...args)
}
```

实际实现会针对常见参数数量做分支，并避免不必要的复制；语义仍然是“当前 emit 只遍历开始时读到的数组”。

相关实现：

- copy-on-write 工具：[src/utils.ts](./src/utils.ts)
- 命名事件触发：[src/eventified.ts](./src/eventified.ts)
- 单事件通道触发：[src/channel.ts](./src/channel.ts)

## 热路径策略

触发路径上还有几处小优化：

- `emit()` 对 0 到 4 个参数使用专门分支；
- 监听器数组写入使用手写 copy，避免 `splice()` 和 spread；
- listener 包装策略在构造时预绑定；
- async generator 顺序执行，调用方可通过迭代控制中断。

这些优化只服务于 dispatch，不改变公开 API 的语义。

## Benchmark 口径

Benchmark 源码：[tinybench/onlyEmit.ts](https://github.com/Kokoro-js/Eventure/blob/main/tinybench/onlyEmit.ts)。

- 每个 sample 内部执行 `RUNS = 100_000` 次 emit；
- sync 场景注册两个 listener；
- async 场景使用微任务 barrier，不收集 `100_000` 个 Promise 再 `Promise.all`；
- Eventure 在 benchmark 中使用 `catchPromiseError: false`，以对齐对比库的默认行为；
- 每轮执行后校验 listener 累计调用结果，避免 benchmark 只测到空转；
- console 表格展示 tinybench 原始 latency，PR markdown 展示每秒 emit 数、误差、样本数和由吞吐反推的单次 emit 延迟；
- PR CI 在同一个 tinybench 进程里同时加载 base commit 与 PR 的 `dist/index.mjs`，并把 EventEmitter3、EventEmitter2、mitt 作为同机参考线；参考库版本会写入 markdown 方便复现，但不参与回归判断；
- paired benchmark 使用 `base -> PR -> controls -> PR -> base` 的镜像任务位置，报告里聚合两次 Eventure base/PR 结果，降低固定执行顺序带来的偏差；
- paired benchmark 只比较同一轮里的 Eventure base 与 Eventure PR，外部库不参与版本或回归对比；markdown 会写入 GitHub step summary/output，不再落盘两份 JSON 后二次 compare。
- `bench:onlyEmit` / `bench:compare` 保留为 emit 参考线，对比 Eventure 与 EventEmitter3、EventEmitter2、mitt；
- `bench:api` 是 Eventure-only PR 回归 benchmark，覆盖命名事件、单事件通道、emit 参数形态、listener 数量、on/off churn、emitAll、emitSettled、fire、waterfall 和 waitFor；它不和外部库比较，专门看 base/PR 的 API 性能变化。

可通过环境变量调整测试时间：

- `BENCH_TIME_SYNC_MS`
- `BENCH_TIME_ASYNC_MS`
- `BENCH_TIME_API_MS`
- `BENCH_FAIL_ON_REGRESSION`
- `BENCH_REGRESSION_THRESHOLD_PCT`
- `BENCH_EVENTURE_IMPORT`
- `BENCH_EVENTURE_BASELINE_IMPORT`
- `BENCH_EVENTURE_TARGET_IMPORT`
- `BENCH_MARKDOWN_PATH`
- `BENCH_GITHUB_OUTPUT_NAME`

时间越长，噪声越低；CI 耗时也会增加。

## 什么时候合适

更合适：

- 高频触发；
- listener 数量小到中等；
- 注册和移除不在热路径；
- 需要稳定快照语义。

不太合适：

- `on/off` 与 `emit` 同样高频；
- 依赖“遍历过程中修改当前遍历集合”的语义；
- 需要完全模拟 Node 或浏览器内置事件系统的兼容行为。
