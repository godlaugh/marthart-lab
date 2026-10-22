# Perlin 队列完成后的更新与绘制边界

2026-10-22，产品基线 `8c6bd74`。本次只核对已有原包字节码、当前生产消费者及已保存的运行结果，没有修改生产代码，没有新启动原版、GUI 或测试任务。

**结论：完成队列后，原版 Scene 时间继续增加，但 Perlin 对象的 GPU 时间、粒子及梯度停止更新。** 外层正常运行仍调用 update/render 的结论来自 `MathArt.draw` 的静态控制流；本轮实际原版运行只验证了固定步进的 Scene 路径，没有观测真实窗口自然播放跨过终点。现有对象更新保护必须保留，不能把后续 Scene 时间直接传给 Perlin shader。

## 固定来源与证据范围

原包为 `MathArt-1.7.8-b07191b3e97da6fe465555ef6e61a0be.jar`，SHA-256 为 `a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018`。以下 class 摘要已从该 JAR 成员重新计算，与缓存解析结果一致。PC 均指方法内字节码偏移，不是源码行号。

| JAR 成员 | SHA-256 |
| --- | --- |
| `mathart/MathArt.class` | `3cf332de2b196ed835006b963b2149553b5a66f17999f6b92dd75ce4cdd56cc0` |
| `mathart/scene/Scene.class` | `1237defdd1a14b13e63669cbf5dfdab517cb2e4587c47264fff4b87fb6f58e53` |
| `mathart/scene/GenericScene.class` | `aa1dc49a5375b773fee7732b77d70c3a7166c0e36ca5477f754567621c8905f0` |
| `mathart/noise/GenericPerlinScene.class` | `96757b4937f046627cc37358099295a38bb799ddc85bce0f5b7f2609f3575427` |
| `mathart/noise/PerlinNoiseField.class` | `ef1de66f25e6fed5a126cb260005d0b5d7fd161118cc83993f0648009de96d92` |

缓存证据为：

- `.cache/source-map-lifecycle/recording/MathArt.class.json`、`GenericPerlinScene.class.json` 及 `provenance.json`。
- `.cache/v2-camera-source/Scene.json`、`GenericScene.json`。
- `.cache/v2-perlin-color-field.json`、`.cache/perlin-native-reference-20261022/PerlinNoiseField.javap.txt`。

本轮另用现有 JDK 的 `javap -p` 静态核对两个中间类的声明，没有加载或执行目标类。`GenericScene` 和 `GenericPerlinScene` 均未覆盖 `update`、`render` 或 `isAutoRecordingComplete`，因此这里确实消费基类 Scene 的行为。旧缓存若只列出 GenericPerlinScene 构造器，不能据此称该类“只有构造器”；完整 class 还有创建对象及更新视觉、变换、调色板等方法。

## 外层 draw：完成只终止录制，不终止正常调度

下表是静态控制流结论，适用条件为已初始化、没有全局错误、正常运行且未暂停。

| 方法与 PC | 数据流及含义 |
| --- | --- |
| `MathArt.draw` PC 409 | 调用 `currentScene.update(isPaused)`，之前没有队列完成判断。 |
| 同方法 PC 458–506、497 | 判断录制是否活跃；非录制分支调用主目标 `Scene.render`。 |
| 同方法 PC 506–714 | 仅活跃录制分支执行离屏 render（528）、预热处理（539–552）或交付编码帧（563），再复制到预览（649）。 |
| 同方法 PC 672–700 | 录制仍活跃时才检查 `isAutoRecordingComplete`（682），完成后调用 `stopRecording`（700）。 |
| 同方法 PC 706 | 完成日志明确写出保存后 sketch 继续运行；这与分支控制流一致，但日志本身不代替窗口实测。 |
| `MathArt.stopRecording` PC 27、45、59 | finish 编码器、清除 `saveVideo`、调用 `disableRenderMode`；没有暂停、`noLoop`、回退或重新构建场景。 |
| `Scene.disableRenderMode` PC 2、17 | 关闭固定渲染步进，重新记录当前 millis 秒数到 `lastTime`，供下一次正常 draw 使用。 |

`draw` 内的 `noLoop` 位于 PC 316 的暂停重载分支，不在队列结束分支。显式 `togglePause` 才修改暂停状态并调用 `noLoop`（PC 161）；恢复时重置 `lastTime`（244）并 `loop`（248）。所以不能把录制的 queue-complete stop 解释为正常预览的自动暂停。

## Scene 更新与 Perlin 更新是两个不同的时钟

`Scene.runFrame` 先 `update`（PC 2）再 `render`（7）。`Scene.update` 在帧开始保存 `manager.isFinished`（PC 13–16），之后有以下分支：

| 分支 | 字节码行为 |
| --- | --- |
| 暂停 | PC 25 跳至 228，不推进时间、队列、对象或相机；保存零 `frameDeltaTime`。 |
| 未暂停且帧开始尚未完成 | 得到固定 dt（36）或 millis 差（47–77）；按剩余时长裁剪 active dt（93–108），增加 Scene 时间（124），更新 manager（132），调用 Mobject.update(time, activeDt)（183）。 |
| 未暂停且帧开始已经完成 | PC 86 跳至 208，Scene 时间按 raw dt 增加（215），不再调用 Mobject.update。 |
| 两种未暂停分支之后 | 相机仍按 raw dt 更新（225），并保存 raw `frameDeltaTime`（230）。 |

因此完成队列的那一帧仍更新对象，后续帧才跳过对象。对象冻结不等于 Scene 时间、相机和 render 都冻结。

`PerlinNoiseField.update(FF)` 的 PC 2 才把传入时间写到 `gpuTimeSeconds`，PC 10 才推进梯度。GPU 模式随后在 PC 20 返回；CPU 的噪声尺度、曲线漂移和粒子推进也都位于这个 update 内。GPU 绘制方法 `drawGpuNoise` 在 PC 143–150 将保留的 `gpuTimeSeconds` 绑定到 `u_time`，没有改读 Scene 时间或 millis。Scene.render 传给 display 的另一个 float 是 `lineScale`（PC 230–257），也不是动画时间。

每次 Scene.render 仍处理背景或累积淡出（PC 158、179、204），调用 Mobject.display（356）及覆盖元素（448）。所以 CPU 累积目标即使数值对象不动，重复淡出/绘制仍可能改变图像；不能用 GPU 两个样例的静止结果证明所有 Perlin 后端、相机与目标历史都静止。

## 已执行的原版范围：Scene 固定步进，GPU 图像冻结

根任务已保存两组原始输入 `Noise/noise1.json` 和 `Noise/noise2.json` 的真实原版结果。探针显式调用 `currentScene.setRenderMode(30f)`，随后连续 271 次 `Scene.runFrame(buffer,false)`；末尾另做一次 paused redraw。它没有用自然墙钟调度的 `MathArt.draw` 代替这些调用。

- 第 241 次更新：8 秒队列完成，`sceneTime=8`。
- 第 271 次更新：`sceneTime=9.00001335144043`。
- 两组输入各自的第 241 与 271 帧，raw 和 enhanced 均为完整 500 × 600、300,000 像素 **0 差异**；随后 paused redraw 也各为全图 0 差异。

运行及资源清理范围见 [动画采样原版对照](source-perlin-animation-native-validation.zh-CN.md)，可提交摘要见 [native-animation-observations.json](../tests/fixtures/source-perlin/native-animation-observations.json)。完整本地证据在 `.cache/perlin-animation-native-20261022/`：`NativeSceneProbe.java`、`run.py`、`native-filament/clocks.json`、`native-swirl/clocks.json` 和 `post-queue-image-comparison.json`。

这里直接观察到的是 Scene 时间继续、两组 GPU 图像不变；“Perlin 对象停止更新且 GPU time 保留”的机制由上述字节码解释。没有额外宣称探针直接测量了原版真实窗口调度或所有对象内部字段。

## 当前产品的消费者与剩余边界

| 本地拥有者 | 当前合同及影响 |
| --- | --- |
| [ordinarySourceCameraTimeline.ts](../src/engine/ordinarySourceCameraTimeline.ts) `advanceReplay` | `!before.queueComplete` 正确保护对象更新；raw dt 仍更新相机，`displayFrame` 仍执行。固定 evaluate 不在 queueComplete 后截断采样。 |
| [sourcePerlin.ts](../src/scenes/sourcePerlin.ts) `generate` | 使用 `timeline.evaluate(context.time)`，这是固定帧重放；反向 seek 或运行身份改变会重建。不是保留实例的墙钟 live update。 |
| [sourceLivePreview.ts](../src/engine/sourceLivePreview.ts)、[App.tsx](../src/App.tsx)、[scenePlayback.ts](../src/engine/scenePlayback.ts) | Perlin 未列为 live family。App 使用墙钟累计后交给 once/loop/ping-pong 映射；once 在有效播放时长结束时暂停，loop/ping-pong 会重映射目标时间。该时长包含作者时长与队列跨度，不一定恰好是队列终点。 |
| `sourcePerlin.ts` `advanceRecording` / `nextRecordingFrame` | 录制使用连续 ordinal/FPS 固定求值，并在队列完成对应末帧停止。这一录制终点合同应保留。 |
| `sourcePerlin.ts` `finishRecording`、[generate.worker.ts](../src/engine/generate.worker.ts) | finish 不 update、不回退；随后同一固定时间生成主预览，只通过 `primaryNeedsDraw` 增加一次 display，没有额外数值步进。CPU 累积目标的 display 副作用仍需单独验证。返回 time 是 ordinal/FPS，不等同于数值 Scene time。 |
| `App.tsx` `recordingStopped` | Perlin 没有 live context，现分支明确置 `playing=false`。这与原版 stopRecording 后保留运行状态的静态合同不同。 |

应保留 `source-perlin-gpu-public`、`source-perlin-color-timeline`、`source-perlin-parameter-timeline` 及 `ordinary-source-camera-particles` 中队列完成后对象冻结的测试。通用 `timeline.test` 的 once/loop/ping-pong 仍是固定重放合同，不应全局改写。现有录制 worker 协议测试不能单独证明 App 恢复运行或 CPU 累积目标的像素行为。

后续最小结构改动应为 Perlin 增加保留实例的 live 调度与暂停/恢复拥有者，复用现有 Scene 步进和正确的对象保护，明确分开固定 seek、实时预览和固定录制终点。录制结束需要将同一实例从固定步进切回 live，并重置墙钟锚点，继续持有目标历史与已应用配置；不能调用 reconstruct 冒充恢复，也不能仅解除 App 末尾停止条件。当前 replay 的模式保护还需要明确的 fixed-to-live 转换接口。

下一轮应优先补公共预览及录制返回的生命周期缺口；固定重放和录制的有限帧范围、队列完成后的对象更新保护继续保留。最小整链范围是 Perlin session 的 fixed-to-live 转换、Worker/Generator 对同实例 live 请求及暂停的传递、App 对实际完成帧时间的采用，以及 recording finish 后恢复 running。所有权同时覆盖数值实例、目标历史、已应用配置和录制模式，不能只修改一个播放布尔值。

需要真实参考与公开产品流程共同覆盖的矩阵如下；表中尚缺原版运行的项目不得只用本地模拟测试声称一致：

| 流程 | 已有依据 | 下一步验收 |
| --- | --- | --- |
| 正常预览跨 queueComplete | 外层 draw 静态继续；固定原版 Scene/GPU 已观测完成后时间增加、图像不变 | 原版窗口自然运行跨终点；产品同实例继续交付帧，Scene/camera 时间可继续而 Mobject 更新计数不增。 |
| variable-dt、暂停、恢复首帧 | Scene millis 与 togglePause 的静态控制流 | 原版实际帧间隔和暂停恢复轨迹；产品暂停不推进，恢复无暂停期间的大 dt，显式保留 actual FPS 的含义。 |
| CPU particles/trails/累积背景 | Scene.render 每次淡出和 display 的静态证据 | 原版完成后多帧像素与数值状态；产品保留同一目标历史，验证“对象不更新但 display 可改变图像”。 |
| 自动完成及手动停止录制 | 原版 stopRecording 静态只 finish/关闭固定模式，无 pause/reset | 原版录制停止后自然 draw；公开 MP4 流程验证编码终点、finish 不额外数值步进、随后同实例 running、热应用/后端/目标状态不被旧作者配置覆盖。 |
| seek/reverse 与现有固定导出 | 当前固定回放、逐 ordinal 录制和对象冻结回归 | 原有结果不变；seek 的明确重建与 live 恢复分开，不将固定 once/loop/ping-pong 改成所有家族通用 live。 |

上述缺口不支持删除对象更新 guard、将 Scene time 强塞入 shader，或修改各家族共享时钟。本轮无生产变更，无需为文档重复构建；性能与 agent token 成本未单独测量。
