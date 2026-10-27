# Implicit 同实例原始网格复用

本轮为源 Implicit 网格增加同一数值实例内的有界复用。固定回放、录制、录制后续播、暂停截图和结束录制的主预览交接使用同一生成入口。没有新增全局网格缓存或独立时钟，也没有调整原版参数、网格数量、MC 算法或 dirty 显示语义。

当前已完成实现、生产边界定向测试、类型检查、17 帧原版对照、三组相同输入成本比较、CPU/GPU 材质各四组实际 App 流程，以及最终 Apple Silicon preview.18 包的隐藏桌面验证。这份说明不代表 Implicit 整族、PREVIEW、其它场景族、M3 或整体 Goal 已完成。公共证据保存在 `.cache/source-implicit-mesh-reuse-20261027/`；原始程序、二进制和大量本地证据不随文档提交。

## 重复工作的根因与实现位置

此前 `generateImplicitFrame` 和 `SourceImplicitRecordingSession.display` 每次显示都会进入 `generateImplicitSurface`，重新执行源 CPU Marching Cubes；需要切片线时还会重新采样切片。即使同一实例的参数未写入、相机或目标尺寸仅发生变化，已有 `SourceImplicitDisplayOwner` 也只持有 dirty 与显示序号，没有保留可供复用的原始几何。

新增 [`SourceImplicitMeshOwner`](../src/engine/sourceImplicitMeshOwner.ts) 由 [`SourceImplicitDisplayOwner`](../src/engine/sourceImplicitDisplay.ts) 私有数值生命周期持有。它保留一个当前版本的 positions、normals、原始数学生成事实，以及需要时的切片 positions。它不保存完整 `SceneOutput`，也不把源配置解释交给 renderer。

[`createSourceImplicitTimeline`](../src/engine/sourceImplicitTimeline.ts) 仍拥有唯一队列、参数表和显示实例。固定回放通过 [`temporal.ts`](../src/engine/temporal.ts) 的共享源生成入口使用该网格 owner；录像、续播、capture 和 finish 通过 [`sourceImplicitRecording.ts`](../src/engine/sourceImplicitRecording.ts) 使用同一个入口。CPU 和 GPU 材质路径均可复用源 MC 数学；GPU 材质不意味着原版 Compute Shader 已在本机实现。

每次交付仍重新绑定当前颜色、材质、像素密度、相机、公式、目标视口、控制回执和录制事实。热色板不会冻结成首次显示的颜色；暂存但尚未 Apply 的作者修改也不会混入当前有效实例。

## 命中条件与原版脏写入

命中条件同时包括数值实例、`meshRevision` 和完整解析后的几何输入：

- 源方程文本、排序后的参数名称及其精确数值；数值比较保留 `-0`。
- 三轴网格数量，解析并窄化后的坐标下限与上限。
- 三轴缩放、位移、isoLevel 和源 isoThreshold。

范围表达式当前可以读取 `t/time`，因此不能仅比较未变化的设置字符串。新 owner 比较实际解析结果，避免在时间改变范围后错误复用。

源成功参数写入即使数值不变，仍按现有规则递增网格 revision，下一次显示重新物化。Apply、restart、录像 reset 和反向 seek 的数值重建产生新的实例生命周期。相机、显示目标、颜色和材质不被当作原始 MC 几何缓存键；新增可见切片的需求会独立物化切片，而不是因此重算已有 MC。

`materializedRevision` 与原版 `dirty/rebuilt` 是不同事实。固定回放可能通过 `consumeHistoricalDisplay` 消费了历史显示，但没有实际生成每个历史网格。因此首次直接 seek 到较晚帧时，`rebuilt=false` 仍可能需要本地首次物化最终几何。反过来，因容量淘汰后重新生成本地几何，也不会伪造一次原版 dirty 或改变既有 viewport 事实。

## 传输、预算和淘汰

[`outputBuffers`](../src/engine/outputBuffers.ts) 会把实际输出的数组转移给消费者。owner 保留的原始数组与每次交付的数组独立；Worker transfer 分离输出 backing 后，后续显示仍可读取完整缓存。capture 与 paired preview 也各自交付独立数组。

准入沿用源路径已有的 128 MiB 输出和 256 MiB 工作区上限，统计的是受代码拥有的 typed-buffer 表示，不是 JavaScript 堆、驱动内存或整个进程 RSS。新增留存不会被作为免费内存：

- 原始 MC positions 和 normals 为每顶点 24 字节；若保留切片，另计其 positions。
- 一份交付还包含 fill RGBA、切片 positions/colors/alphas 和 GPU palette。
- 构建时计入场值、梯度、坐标及候选几何工作区；复制交付和缓存时按对应阶段计入同时存活的表示，避免把已经结束的采样工作区再与后续复制峰值盲目相加。
- 事务中仍持有的旧缓存、借用中的缓存及候选缓存按 backing 去重计费。
- capture 的第一份完整输出在生成第二份 primary 输出期间仍计入工作区。
- 新 Apply 或录像 warmup 构建前，先淘汰其它旧数值实例的可选原始缓存，保留其数值和控制状态，避免跨 owner 漏算留存。

缓存是可淘汰的优化。若缓存与本次工作共同超限，而原无缓存路径可在原预算内完成，则显式释放缓存后重新生成，不因新增缓存收窄单次生成原有的合法容量。借用中的缓存仍必须计费；冷重试之前清空该候选的所有已知强引用，不能只把账本归零。若两份实际交付或无缓存工作本身超限，仍明确拒绝。

本次采样统计与几何规模分开：缓存命中时 MC 的 `stats.samples`、`latticeSamples`、`examinedCells` 为零；切片复用时 `wire.samples` 为零。`generated` 和实际几何缓冲仍代表完整交付规模。输出 `estimatedPeakWorkingBytes` 使用本次准入峰值；owner 诊断另有留存字节、物化 revision、MC 构建次数、命中次数、切片构建次数、累计工作峰值及淘汰次数。构建计数可包含失败尝试，不能将其解释为成功显示次数。

## 失败、重试与清理

几何生成或显示绑定失败时不提交半成品。缓存事务与显示事务组合，capture 第二幅生成失败会回滚显示序号和可恢复的缓存状态。为了满足预算而明确淘汰的缓存不会偷偷保留在 rollback 快照里；这种失败后可能需要重新物化，但不改变原版参数、队列或 dirty 事实。

录像 finish 重试重新产生独立交付缓冲，不重复推进数值时钟或消费显示序号。reset、实例替换和离开源 Implicit 路径释放对应缓存。`TemporalGenerationSession.diagnostics()` 已纳入 Implicit 留存，不再将这部分内存遗漏在会话诊断之外。

## 已执行的 CPU 检查

最终定向命令使用仓库已固定的本地 Node 工具链：

```sh
PATH="$PWD/../.cache/local-toolchain/node_modules/.bin:$PATH" npx vitest run \
  tests/source-implicit-mesh-owner.test.ts \
  tests/source-implicit-display.test.ts \
  tests/implicit-palette-session.test.ts \
  tests/implicit-recording-owner.test.ts \
  tests/implicit-recording-worker.test.ts \
  tests/implicit-recording-client.test.ts \
  tests/implicit-palette-recording-lease.test.ts \
  tests/implicit-palette-generator.test.ts \
  tests/source-implicit-gpu-lifecycle.test.ts
```

主实现定向结果：**9 个文件、128 项测试通过**；Vitest 报告 elapsed 12.65 秒。随后补充源网格、显示、视口与 retained lines 边界，最终去重合计 **13 个文件、147 项通过**。这不是同一条全套测试命令的结果。测试时长不是重复显示的性能基准；未由这组检查测量 CPU 时间或进程族峰值内存。

| 文件 | 通过数 |
| --- | ---: |
| `source-implicit-mesh-owner.test.ts` | 11 |
| `source-implicit-display.test.ts` | 11 |
| `implicit-palette-session.test.ts` | 8 |
| `implicit-recording-owner.test.ts` | 7 |
| `implicit-recording-worker.test.ts` | 25 |
| `implicit-recording-client.test.ts` | 32 |
| `implicit-palette-recording-lease.test.ts` | 10 |
| `implicit-palette-generator.test.ts` | 9 |
| `source-implicit-gpu-lifecycle.test.ts` | 15 |
| `sourceImplicitPresentation.test.ts`（补充） | 8 |
| `sourceImplicitMesh.test.ts`（补充） | 4 |
| `source-implicit-viewport.test.ts`（补充） | 5 |
| `sourceProcessingRetainedLine.test.ts`（修正后） | 2 |

新增检查覆盖真实 `structuredClone(...,{transfer})` 分离后复用、输出修改隔离、CPU/GPU 共用、历史显示首次物化、同值写入、解析后范围与 `-0` 身份、热色板和暂存作者配置、失败回滚、录像/finish/续播/capture 共用，以及预算压力下的淘汰和冷重试。预算上限测试通过生产准入回调请求最大工作量，不分配大网格；它们验证资源合同，不能代替实际大网格成本测量。已有 Worker/client 测试覆盖生产处理器和消息合同，但不等同本轮实际桌面或 GPU 验收。

实际日志：

- `.cache/source-implicit-grid-cost-20261027/mesh-owner-tests-r2.log`：上述 128 项最终通过。
- `.cache/source-implicit-grid-cost-20261027/mesh-owner-tsc-r2.log`：全仓 `npx tsc --noEmit` exit 0；成功日志为空。
- `.cache/source-implicit-mesh-reuse-20261027/producer-tests.log`：三个补充文件的 17 项通过，同时保留旧 retained-line 测试的颜色 hash 失败。
- `.cache/source-implicit-mesh-reuse-20261027/retained-line-audit/diagnosis.json` 及 `current-test.log`：该颜色失败在修改前基线 `86c8874` 同样复现。旧测试读取编辑器默认 `scene.palette.stops`，实际源显示使用 `scene.implicitSourcePalette.colors`；测试改为消费真实 `generateImplicit` 交付的 wire positions/colors/alphas 后，基线隔离副本和当前代码均 2/2 通过，原严格 golden 未改。首个引入旧测试问题的提交未做二分定位。
- `git diff --check` 已通过。

另有独立只读审查，确认缓存候选强引用、借用计费、capture 双输出、发布缓冲独立及失败事务边界未发现新增阻断。这不是额外执行的 GPU 或性能测试。

## 已完成的公共运行验证

### 原版 17 帧：完整数学与公式层

`.cache/source-implicit-mesh-reuse-20261027/parity-r1/report.json` 状态为 passed。实际公共 Generator/Worker、原生绘制和公式合成的 17 帧，数学层与品牌之前的完整作品层分别逐像素、逐 RGBA 字节比较，全部零差异。输入是有限的 12³ 网格、500×600 目标、density 2；没有任意 ROI 或像素容差。

必须保留两种不同的证据范围：

- 前两幅只证明构造后 dirty/steady 的视觉行为。产品固定回放已执行首次更新至 0.25 秒，原版参考最初暂停在时间零；参数、几何和公式内容未变，不据此声明初始暂停时钟一致。
- 后 15 帧要求 sceneTime、队列完成、参数位模式、网格和 viewport 精确一致；重复固定时间请求代表重复显示。实际暂停、录制与 capture 生命周期另由 App 流程验证。

该次运行 elapsed 13.663 秒，源与参考 pins 稳定，page errors、cleanup errors 均为空，剩余自有进程为零。以上是有限输入和本机的观察，不覆盖所有参数范围或硬件。

### 相同输入、相同后端的成本比较

三份 `comparison-cpu-wireframe-70.json`、`comparison-gpu-wireframe-70.json`、`comparison-gpu-wireframe-135.json` 均 `comparisonComplete=true`、`matched=true`、`differences=[]`。它们绑定前后实际报告及 hash，使用相同维护脚本、输入和后端。比较的是产品修改前后的等价请求，不是新增原版吞吐量证明。

下表单位均为毫秒；“完整 PNG”包括数学生成、实际数学绘制/读回、公式合成和暂停 PNG 后处理，不含原版品牌：

| 输入 | 冷生成：前 → 后 | 重复生成 1 / 2：前 → 后 | 重复完整 PNG 1 / 2：前 → 后 |
| --- | --- | --- | --- |
| CPU 材质 70³ | 717.4 → 786.8 | 449.4 / 380.3 → 17.1 / 14.6 | 979.9 / 884.3 → 531.0 / 534.8 |
| GPU 材质 70³ | 726.0 → 739.1 | 451.0 / 385.3 → 17.3 / 25.2 | 1142.6 / 1049.8 → 704.9 / 731.5 |
| GPU 材质 135³ | 2246.9 → 2261.0 | 2061.6 / 2035.9 → 48.8 / 68.1 | 4435.5 / 4438.9 → 2540.1 / 2462.7 |

收益集中在没有脏写入的重复生成。135³ 冷构建没有表现出加速；重复生成仍需独立交付复制，完整 PNG 还要绘制、读回、公式和编码，因此不能将 MC 阶段的缩短倍数当作整条工作流的缩短倍数。GPU 两组仍是源 CPU MC fallback 加 GPU 材质，不是 Compute Shader 加速。

独立成本审计保存在 `.cache/source-implicit-mesh-reuse-20261027/cost-summary.json` 与 `cost-summary.zh-CN.md`。**CPU/RSS 实际覆盖完整 frame，包括公式 PNG 和末尾诊断 hash**；旧报告沿用的 limits 文字称排除公式与 codec，不符合测量脚本 `measureFamily` 的实际包围范围。只有数学阶段的 wall 字段在公式前截点。原报告和原始测量保留不改，本说明纠正其解释口径。

| 输入 | 阶段 | 观测进程族 CPU ms：前 → 后 | 采样峰值 RSS GiB：前 → 后 |
| --- | --- | ---: | ---: |
| CPU 材质 70³ | cold | 8280 → 8370 | 2.035 → 2.100 |
| CPU 材质 70³ | warm-1 | 3380 → 1710 | 1.977 → 1.997 |
| CPU 材质 70³ | warm-2 | 2100 → 1890 | 2.024 → 2.079 |
| GPU 材质 70³ | cold | 8480 → 8640 | 2.082 → 2.067 |
| GPU 材质 70³ | warm-1 | 3870 → 2160 | 2.101 → 2.036 |
| GPU 材质 70³ | warm-2 | 2600 → 2540 | 2.152 → 2.082 |
| GPU 材质 135³ | cold | 15670 → 15860 | 2.662 → 2.673 |
| GPU 材质 135³ | warm-1 | 5360 → 3310 | 3.045 → 3.000 |
| GPU 材质 135³ | warm-2 | 5340 → 3240 | 3.075 → 3.029 |

每组只有一次 cold 和两次同 owner warm，没有统计置信区间或任意速度通过线。cold 是浏览器及模块 setup 后的首次生成，不代表 OS 或应用冷启动。135³ 两次 warm 的完整任务分别缩短约 42.7% 和 44.5%，生成阶段分别缩短约 97.6% 和 96.7%。

进程族包含 Node/Vite/Chrome/Worker/native/glyph 后代及观察开销；CPU 是 `ps` 累计时间的观测增量，RSS 以 250 ms 采样，可能漏掉短命进程及瞬态峰值。RSS 没有一致下降，不能据此声明内存优化，也不能将其等同于 256 MiB typed-buffer 预算。`totalTaskMs` 包含非空像素检查和 PNG hash；末尾 positions/normals/RGBA hash 在该 wall 截点之后，仍在 CPU/RSS 采样范围内。token 与 GPU VRAM 成本未测量。

### GPU 材质实际 App 流程

`.cache/source-implicit-mesh-reuse-20261027/app-gpu-r1/report.json` 的 natural、cancel、formulas、recovery 四组均通过，elapsed 72.253 秒。覆盖公开录制/导出控件、原队列 Worker、实际原生绘制、FFmpeg、停止续播、暂停、resize/resume、暂存编辑与 Apply/seek、取消及重试；PNG/JPEG 与公式交付按脚本的实际完整帧链核验。

natural 用例实际编码 4 帧；视频验收比较实际输入 RGBA 经独立相同参数 FFmpeg 编码后的每帧 decoded RGB，全部一致，不要求有损 H.264 与未压缩 RGBA 相等。该测试不声称操作过原版 GUI，也不声称原版 MP4 字节相同。

报告源 pins 稳定，各用例 errors、artifact errors、cleanup errors 均为空，剩余自有进程为零。

### CPU 材质实际 App 流程与首轮失败

`.cache/source-implicit-mesh-reuse-20261027/app-cpu-r1/report.json` 的 manual、warmup、export 三组分别通过；**该报告整体仍为 failed**，不能把其中三个成功子项写成整轮通过。parameters 子项的旧验证脚本只改了作者草稿，没有点击 Apply，界面实际显示尚未应用的修改。录制按当前已应用队列运行并拒绝其中尚未映射的参数动作，这与生产的暂存/Apply 合同一致。

维护脚本随后仅修正 parameters 分支：点击真实 Apply，并等待新的 Worker 应用 revision 和已解析参数动作后再录制。`.cache/source-implicit-mesh-reuse-20261027/app-cpu-parameters-r2/report.json` 的该项通过，elapsed 11.064 秒，源稳定、artifact/cleanup errors 为空、剩余自有进程为零。产品源码没有因这次脚本修正而变动。

首轮失败、输入和修正后的单项结果均保留，诊断见 `cpu-parameter-verifier-diagnosis.json`。因此已完成范围是跨报告的 **CPU 四项 + GPU 四项**，并非 CPU 首轮整体成功，也不是新增原版 GUI/MP4 等价性声明。

三份 App 报告共有六段视频、**33 个实际编码帧**接受逐帧 RGB 校验：CPU manual 1 帧、export 4 帧、parameters 10 帧，GPU natural 4 帧、formulas 10 帧、recovery 4 帧。每个解码 RGB 通道均等于实际输入 RGBA 经独立相同配置 FFmpeg 编码后的结果。GPU cancel 的重试视频另有 20 帧、128×96、4 fps、5 秒的元数据检查；该重试没有逐帧 RGB 对照，不能并入上述 33 帧。有损视频验收验证交付和编码链，不表示视频像素与原版图像或未压缩输入逐像素相同。

### 最终 Apple Silicon 包与 1.0 隔离

`build-preview18.log` 记录最终 `2.0.0-preview.18` 包构建成功，包含全仓 TypeScript 和 Vite 构建；Vite 保留体积警告，没有将它解释为构建失败。`desktop-r1/report.json` 使用实际发行包进行公开导入和 500×600 PNG 下载，确认 GPU 材质、CPU 网格计算、包内原生绘制回执，以及源公式和真实字形回执的交付链，状态为 passed。

该次实际 runtime 版本为 `2.0.0-preview.18`，包的 `app.asar` SHA-256 为 `3f52765f66b35f65a1949854eb7c7b8782a3adf072c013b1cf8a54e4b2df4d2b`，签名后的原生 helper SHA-256 为 `906ae767e12c86b2a4123a0b1e32cc8f3c92ee75c0d549d568c79ecc47619a90`。测试前后包、manifest、helper、输入和验证器 pins 均未改变。

实际下载 PNG 的 SHA-256 为 `83db63ad4b8015776dfd816dfe4c1364efa82edf645e86e614a21612e969e358`，与此前 preview.17 的对应产物相同。本输入公式的横向边界约为 `[651.836, 1072.164]`，在宽 500 的目标外，报告明确 `formulaContributes=false`。因此该包检查证明公式事实和字形处理链已交付，但不能把这一 PNG 当作可见公式放置的像素验收；可见公式与完整作品层另有上述 17 帧及 App 用例。

隐藏桌面检查 elapsed 9.676 秒，前后 `visibleWindows=0`、`showEvents=[]`，退出码为零，剩余自有进程为空，所有被测端口关闭。独立的 `.cache/desktop-smoke-QrndxN/report.json` 中 initial 与 restore 两阶段也通过，包括隔离环境、持久化与重启恢复、活动编码器退出清理；两阶段均退出零、服务及端口关闭、自有进程为零。它们不扩写为原版 GUI、原版视频或所有场景族验收。

`v1-before.json` 与 `v1-after.json` 核对已有 1.0 包的 `Contents/Info.plist`、`Contents/MacOS/MathArt Lab` 和 `Contents/Resources/app.asar`，三项 SHA-256 完全相同。本轮 preview.18 的构建与验证没有更改这三个 1.0 关键文件。

## 保留范围

参数动画持续成功写入时仍应按源规则重建，静态重用收益不能扩写为所有动画加速。PREVIEW 的原版数值与显示一致性仍是独立事项；本改造只涉及已归属源网格的 MC 路径，不将未标记本地 sampler 或 PREVIEW 自动升级为源网格。
