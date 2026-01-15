# Performance Notes

这份文档解释 Eventure 在保证语义正确性的前提下，主要依靠哪些设计来降低开销与 GC 压力；也说明 `tinybench/onlyEmit.ts` 的测量口径与取舍，方便你和读者判断 benchmark 是否可信、是否适用于自己的场景。

## 1) 核心原则：Emit 热路径零分配

Eventure 把性能优化的重心放在 “高频 emit / 低频注册与移除” 的典型使用形态上：

- `emit()` 不会为了做 “触发时的快照” 去 `slice()` 复制监听器数组。
- 代价被前移到 `on()` / `off()`：注册/移除时复制数组（Copy-on-Write）。

这让触发频率很高时，GC 压力明显更低，也能避免 `slice()` 带来的线性拷贝。

对应实现：

- 监听器数组的 Copy-on-Write：`src/utils.ts`（`appendListenerCopy` / `prependListenerCopy` / `insertListenerCopy` / `copyWithoutIndex`）
- 触发读取不可变快照：`src/eventified.ts` 的 `emit()` / `src/channel.ts` 的 `emit()`

## 2) 正确性来源：不可变快照语义

JS 事件库里常见的坑是：在 listener 执行过程中如果新增/移除 listener，当前这次 emit 应该怎么遍历？

Eventure 的选择是：

- 每次 `on/off/onAt/...` 都产生新的数组实例；
- `emit()` 始终遍历当次读取到的数组引用（快照）。

这样可以保证 “当前 emit 的遍历集合” 不会因为内部代码动态修改而发生漂移；同时也避免在每次 emit 里为了快照再 `slice()`。

## 3) 降低开销的小但实用点

这些不是 “魔法”，而是偏工程化的低成本收益点：

- **0~4 参数的专门分支**：`emit()` 用 `switch(args.length)` 走手写调用路径，避免热路径频繁走 `(...args)` 的慢路径。
- **避免 `splice/spread` 的多态开销**：listener 数组写入用手写 copy，尽量保持引擎更容易优化的形态。
- **包装器复用**：构造时通过 `createWrapHelper` 预绑定策略对象，注册时避免重复创建配置对象。

## 4) Benchmark 的口径与公平性（tinybench）

`tinybench/onlyEmit.ts` 里做了几件事情来让结果更接近 “库本身的 emit 能力”，而不是测试框架/Promise 收集的能力：

- 每个 sample 内部做 `RUNS(=1e5)` 次 `emit`，尽量摊薄 tinybench 本身的调度开销。
- sync 场景注册 **2 个 listener**，避免某些库在 “单 listener” 上的特殊快路径造成误导。
- async 场景用 “微任务 + barrier” 等待所有异步完成，而不是把 10^5 个 Promise 全部存到数组里再 `Promise.all`（后者会把大量内存分配/数组扩容/GC 噪声混进来）。
- 为了对齐“其他库默认不会帮你兜底捕获异步 rejection”，benchmark 里对 Eventure 使用 `catchPromiseError: false`；这更像在测 “最接近其他库默认行为时的纯 emit 性能”。

你可以通过环境变量调整测量时间（更长更稳，但 CI 会更慢）：

- `BENCH_TIME_SYNC_MS`
- `BENCH_TIME_ASYNC_MS`

## 5) 适用/不适用场景

更适合：

- 高频 `emit`（热路径）且 listener 数量适中；
- 注册/移除相对低频；
- 关注触发时的稳定性（快照语义）。

不那么适合：

- 极高频的 `on/off`（每次都会产生新数组，写入成本更高）；
- 强依赖 “边遍历边修改当前遍历集合” 的非快照语义（Eventure 不是这种语义）。

