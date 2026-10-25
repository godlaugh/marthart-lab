# Domain 录制后编辑状态与同 ID 文件替换验收

本批补齐[Domain 色板生成器验收](source-domain-gradient-generators.zh-CN.md)明确留下的两个实际 App 流程：录制停止后保留打开项目的生成器状态，以及同 ID 文件替换建立新的编辑会话。CPU、GPU 两组共 **363 项检查通过**，没有修改产品代码。这只关闭上述两个有限界面子项，不代表 Domain 原版整图、任意输入或整体 2.0 Goal 已完成。

运行基线为 `941821e397a7c591cbbc35f7539e53c39a1a2d11`，精确来源与产物摘要见[机器证据索引](../tests/fixtures/source-domain-controls/recording-replacement-20261025.json)。验收使用这台 Mac 上独立隐藏 Chrome、公共 App 控件、生产 GenerationQueue、真实生成 Worker、WebGL 和本地导出服务／FFmpeg；没有执行原版 JVM、操作原版窗口或新增原版图像对照，也没有验证第二台设备。

## 两个有限流程

两组采用相同 `z^3-1`、1 秒旋转队列和包含 ARGB 的 32 色输入，分别通过公共下拉框选定 CPU 完整链与 GPU 路径。先在实际界面生成 9 色 Cosine 色板、修改 A R 为 0.3，并保留自定义第三个 Curve 节点与原始 Manual 快照。源字段按原有 Float32 规则解释，报告保留其实际数值。

| 操作 | 已观察到的结果 |
| --- | --- |
| 公共 Record → Domain recording → 64×48、4 FPS → Start recording | 真实 warmup ordinal 0 不上传；三个编码帧 ordinal 1、2、3 对应上传 index 0、1、2。实际 Worker 与上传 PNG 为源规则要求的 192×144；六张 PNG 的解码完整 RGBA 摘要均等于对应 Worker 原帧。 |
| 正常录制结束并继续预览 | finish 返回 primary snapshot、ordinal 3、paused false、rawDt 0，没有多做一次数值更新。后续正常预览可继续推进；暂停后，App 中完整 editor、离散色板、Cosine 参数、Curve 节点和 Manual 快照保留，主面板与 CPU 回退面板继续共享状态。 |
| 相同页面导出 canonical JSON，再用公共文件输入打开相同 ID、不同名称和三色列表的文件 | 文件不带临时 editor，仍保留来源原文中的双生成器标志。实际文档 ID 不变，但 live session 改变，旧 generation Worker 记录到 terminate，新 Worker 交付 revision 1 的暂停快照与新色板；没有刷新页面。 |
| 在新对象中切换 Cosine、Curve，再返回 Manual | Cosine 从默认 A R 0.5 与新色数 3 开始；Curve 使用默认两节点，没有旧自定义节点。两个面板共享新的编辑状态，Manual 恢复新文件三色，不能恢复旧 32 色快照。 |

warmup、三个录制帧、finish 和同 ID 替换后的关键输出均检查实际 `domainRender` backend 与 route。GPU 组始终为 WebGL2，CPU 组始终为完整 CPU 路径；没有把成功的 CPU fallback 算作 GPU 通过，也没有 sticky 或 failure trigger。

两个实际 MP4 均重新用 FFprobe／FFmpeg 验证：64×48、4 FPS、3 帧，解码首尾不同。视频经过缩放和有损编码，不与原始 RGBA 强求像素一致。无公式标注／最终遮罩的原帧到上传 PNG 才是本次精确字节链；不把它说成原版图像一致。

## 所有权与实际证据

`domainSourcePalette.colors` 仍是唯一已应用和保存的颜色列表；`domainPaletteEditor` 属于当前打开项目。Worker 的运行投影本来就剔除临时 editor，不能把它的返回 scene 当作完整作者文档。[GenerationQueue](../src/engine/generationQueue.ts) 在录制停止时采用当前 UI 作者对象，本次通过真实 App 确认了这条交接。

[App 的 document load](../src/App.tsx) 不恢复 library draft，并创建新 live session、取消旧队列；[文件解析器](../src/engine/document.ts) 删除临时 editor。此次文件替换未刷新页面，因此确实覆盖同 ID 对象替换，而不是复用此前重新加载整个页面的检查。初始重建快照允许按源时钟前进一个文档步长，没有将它误判为显式 Apply 的时间 0。

每模式保存录制前、录制后、同 ID 替换后、新 Manual 四个阶段的画布 PNG 和整页截图，共 **8 张画布 PNG、8 张 App 截图**；另有六张实际上传 PNG、两个下载 MP4、输入／导出／替换文件和完整观察回执。独立 CPU 复核重读实际产物、重新解码视频，并确认全部对应摘要与会话／Worker 边界，没有发现假通过。唯一未完成的早期请求来自导入前已退役的初始 Surface Worker，不是遗留 Domain 操作。

实际 GPU 新 Manual 截图近乎青色，已保留原图。真实作者公式与交付视口均为 `z^3-1`、中心 `(0,0)`、`scale=2.5`；源视口的 `halfSpan=0.4`，在 782×563 的逻辑区域约覆盖实轴 ±0.556、虚轴 ±0.4。由这些事实推导，`z^3-1` 靠近 −1、phase 靠近 π，色板坐标靠近 0.5，即新三色色板的中间青色。这与实际图像相容，但该推导不是 GPU 像素 oracle。`nonuniformPixels` 只统计与首像素 RGB 不同的像素数，不证明明显视觉变化、高质量或原版一致；本轮功能检查依据作者／会话回执、实际换色交付和文件链，没有将这一计数用于质量验收。详细事实保存在 `run-1/viewport-appearance-note.json`。

最终运行耗时 **29.470 秒**，Node 24.18.0、Chrome 155.0.8059.85、浏览器 DPR 1。CPU 使用 low 预览、实际目标 density 1；GPU 使用 high 预览、实际目标 density 2，不能把浏览器 DPR 与预览目标密度混为一项。587 个来源／脚本文件运行前后摘要一致，无未处理 page error。每个 browser context 已关闭；browser、Vite、export service 的关闭均成功，owned service 子进程为 0。替换时旧 Worker 的显式 termination 已单独验证；不将关闭 context 夸称所有 Worker 都走过显式 owner dispose。GPU 时段已释放。

## CPU 检查与验证器修正

最终准备检查 **16 项通过**：主入口及注入观察器语法、真实输入 parser、四更新／三编码帧 planner、保存与同 ID 重开 owner。相关 **2 文件、33 项测试通过**：`domain-palette-generator.test.ts` 11 项，`domain-recording-transport.test.ts` 22 项。后者替换消息传输，不替代此次真实 App 结果。

首次 CPU 准备错误地要求源 `settings.render_mode` 直接等于本地 `domainBackend`；实际该字段选择源公式、视口和着色语义。本地计算后端仍由公共控件选择。该验证器失败及脚本保留在 `cpu-prepare-1/`，修正为沿用现有成功 harness 的真实下拉框操作后通过，没有改产品或放宽运行后端断言。随后独立静态复核补上每个关键输出的 backend／route 验证，避免 fallback 假通过。实际 App 首跑 `run-1` 即通过，没有失败 App 运行或未处理产品缺陷。

## 重跑与限制

在 studio 根目录，取得独占 GPU 时段后使用新目录：

```sh
/Users/hoo/AIStudio/mathartstudio-rea/.cache/local-toolchain/node_modules/.bin/node .cache/domain-control-final-ui-20261025/verify-app.mjs --run-ui .cache/domain-control-final-ui-20261025/run-new
```

完整本地证据在 `.cache/domain-control-final-ui-20261025/run-1/`；最终索引 `final-index.json` 保留前期准备索引，不覆盖失败记录。机器 fixture 绑定索引、报告、验证器与 CPU 证据。

本轮不重跑此前已有的 Stop／Cancel／零帧矩阵，不扩展到多 Worker、长动画、任意公式、DPR 2、第二设备或原版整图。没有测量 CPU 时间、峰值 RSS、GPU 时间或 agent tokens；29.470 秒仅是本次完成流程耗时，不是性能改善结论。安装的 1.0 应用未更新，最终集成发行与其他场景要求仍由整体 Goal 追踪。
