# Symmetry 画布尺寸变化与重播生命周期验收

2026-10-21。已补齐实时编辑重播接入前的尺寸变化边界：只重建累积图像，保留粒子、有效性和数学错误计数，取消待执行或进行中的重播。正常显示随后按新画布尺寸累积一次。相同尺寸不清空图像。

这项改动位于 GPU 与重播执行器；**Worker/编辑器实时接入仍待完成，原版整窗口对照仍为 0/11**。已安装的 1.0 Apple Silicon 应用未重新打包或替换。

## 原版证据及其限制

重新核对了原始 JAR 内 `SymmetryChaosMobject.class` 的 SHA-256：`f994fa6fc9dcf984c9ffad6e4e539e497ed038935ab701f8c7450d1f5caba54c`，与已留存字节码一致。

- `display` PC112 在进入重播分支之前调用 `ensureAccumulationBuffers`。
- `ensureAccumulationBuffers` PC9–43 检查尺寸和两个纹理；相同且有效时直接返回。
- 不同尺寸时，PC46 仅释放累积附件，PC51/56 保存新尺寸，PC71 清除 splat 路径选择标志。
- PC363 清空累积，PC367/368 和 PC372/373 分别将 pending、active 写为 false。
- `releaseAccumulationBuffers` 只删除累积纹理及 FBO，清除尺寸、读写索引和累积计数；没有释放粒子状态。
- `clearAllAccumulation` PC150 将累积样本数归零。

由这些方法可推导：成功调整尺寸会取消重播，但保留粒子、warmup 状态与剩余重播计数。原版 update 先于 display，因此未暂停且仍需预热的帧，仍应先完成普通更新所需的预热和迭代，再得到新尺寸的一次显示。

这是**原始字节码证据与源语义推导**；本轮没有执行原版这些方法或 JOGL。完整选定指令和摘要留在 `.cache/source-symmetry-replay/resize-bytecode-evidence.json`，不能当作原生 GPU 或窗口运行记录。

## 实现

`IteratedDensityGpu.resizeAccumulation` 只替换累积附件，不消耗数学帧、不重新生成种子，也不重建粒子缓冲。新旧附件短暂共存，容量检查计入峰值。所有权在第一次可能失败的分配前建立；失败时清理，如果清理也失败，则保留待释放附件及已有资源，拒绝再次调整，直到清理成功。

重播所有者负责清空显示计数和取消 pending/active，保留 warmup 及进度字段。新增 `willReplayDisplay(width,height)` 让上层在确认参数和捕获相机前，考虑本帧的目标尺寸；不能只看旧目标上的 replayActive，否则会错误地跳过尺寸变化帧的正常确认。

本地接口对零、非整数和超预算尺寸显式报错；原版非正尺寸直接返回。这里保留本地生成请求的有效尺寸约束，没有把无效请求当作一次有效显示。

## 实际执行

| 验证 | 结果 |
|---|---|
| 真实 WebGL 尺寸变化 | 内置 buffer、自定义 texture × 普通、pending、active、burn-only 尾段，共 8 例通过 |
| 粒子保留 | 位置/metric、有效性、数学错误计数逐项完全相等 |
| 暂停显示 | 新尺寸清空后仅显示一次；下一次同尺寸继续累积，不推进数学 |
| 未暂停双调用 | 活跃重播中的 resize 仍完成预热 + 两次更新，独立 Float32 计算精确相等，未重置种子 |
| 相同/无效尺寸 | 同尺寸保留图像与帧序号；无效尺寸在修改前拒绝，原粒子仍可读取 |
| 反复调整 | 8 次往返尺寸变化，最终保留字节数不增长，粒子逐项不变 |
| 取消 | 分配后的取消抛出 AbortError，修改中的资源完全释放 |
| 清理失败 | 注入真实 WebGL 分配和删除异常，保留新附件所有权，阻止复用，重试清理后归零 |
| 既有重播回归 | 6 例、219 个重播帧及不同参数双调用、代表负载和取消恢复继续通过 |
| 全量测试及构建 | 338 文件、6,223 项通过；TypeScript/Vite 构建通过，保留已有大 chunk 提示 |

运行中核对源文件前后摘要一致；浏览器和 Vite 均已正常关闭。新脚本是 `scripts/verify-source-symmetry-resize.mjs`，要求新建输出目录：

```sh
node scripts/verify-source-symmetry-resize.mjs .cache/source-symmetry-replay/resize-new-run
```

本轮输出：`resize-gpu-final/report.json`、`resize-replay-regression/report.json`、`resize-full-tests.log`、`resize-build.log`，均位于 `.cache/source-symmetry-replay/`，本地证据不提交 Git。

## 成本记录

最终尺寸变化任务总耗时 2.99 秒，采样 CPU 6.30 秒，进程族峰值 RSS 约 1.36 GiB。重播回归总耗时 4.80 秒，采样 CPU 7.47 秒，峰值 RSS 约 1.41 GiB。

每项任务新启动浏览器，内部包含持续会话；未独立拆分系统缓存冷/热运行。CPU/RSS 为 250 毫秒采样，可能漏掉短进程和峰值，CPU 是观察下界，RSS 可能重复计入共享页；未消除短任务中的 PID 复用影响。GPU 实际内存和单任务 agent token 未测量。旧执行器对尺寸变化直接报错，没有等价成功任务可作性能基线，不声称性能提升。

下一步继续接入实时生成所有者与 Worker/编辑事件。尺寸变化路径必须使用本轮的目标级重建和重播预测，保留既有相机锚点，并在原版整窗口可用时核对完整画面。
