# Symmetry 冷点径与热 setter 的实际 App 验收

> 最终兼容复核：保留旧 live Symmetry 的点径 intent，同时将新配置 owner 扩展至 fixed 模式。该单行路由调整后，`run-4` 再次通过相同 83 项实际检查（13.485 秒），591 个 pin 稳定；独立留存复核 28 项、2.0 构建再次通过。新索引 `post-review-index.json`，旧 run-3/index 不覆盖；没有把重复检查累加为 166 项。无 construction 的旧 profile 只做 CPU 路由／准备审查，不声称其完整 GPU 行为已验证。

2026-10-25，真实 App / production Worker / WebGL2 小矩阵 **83 项通过**，16 个有序动作快照，耗时 13.131 秒。运行基线是 `6a6bb3c73360433b8011c88d4b53585bb0c6e12b` **加未提交产品改动**；不能只用提交号代表运行源码。[精简 fixture](../tests/fixtures/source-symmetry-controls/point-size-ui-20261025.json) 绑定实际源码 pin 和差异快照。

本次验证产品的冷/热状态归属，不执行原版，不声称原版整图或数值轨迹一致。此前 [色板联合 App 矩阵](source-symmetry-recording-replacement-validation.zh-CN.md) 的 144 项仍绑定旧 `9f5ae66`，没有将其追认为本次源码上的重跑结果。

## 实际公共路径

使用原包 Emperors_Cloak 的小型输入：512 粒子、burn-in 16、iteration 1、作者 dot_size 1.5、Wait 1 秒。固定分支另外使用有明确公式的兼容文件，`recordTrails=false`；无 raw palette 的兼容分支保留源配置身份。均经公共文件输入导入。

| 动作 | 真实 Worker / UI 结果 |
|---|---|
| 初始 cold → 输入 `1.50` | 作者仍为 1.5；初始运行值 `Math.fround(1.8)` = 1.7999999523162842，显式相等数值输入后变为 1.5。 |
| 输入 `.5` → 再输入 `0.50` | 两次运行值均为 1。三次热事件各恰好多一次暂停显示；无 replay/clear，session、replayRevision、时间保留，objectUpdates=0。 |
| Save → 当前 PNG | Save 可以不重绘。其后实际 retained capture 仍为热点径 1，证明保存没有把运行状态重置。目标基础尺寸为主画布的 3 倍，PNG 增强倍率选 1；capture 为 dotSize=1 / displayScale=3 / radius=3，恢复主预览 radius=1。下载 PNG 全部 RGBA 与实际 Worker 一致，真实 renderer 收到恢复输出。 |
| 导出 JSON → 同文件重开 | JSON 保留作者 .5、删除内部 transient；重开运行值回到冷 1.8，作者仍 .5。 |
| 热 5 → Apply / 热 5 → 录制 | 完整 Apply 清 transient 并新建运行会话。正常录制 warmup、3 张编码帧、finish 预览全部为冷 1.8，保留原 Worker；下载 MP4 经 ffprobe 确认为 96×64 / 4 fps / 3 帧。 |
| 旧源文件，无 raw palette | 实际热 5 → toolbar restart 回冷；再热 5 → 公共源录制也全部为冷。第二个实际 MP4 同样有 3 帧。 |
| 固定预览 | 不携带 `symmetryLive` 的实际 fixed producer 消费热值 4；点击公共 `Use template formula` 进入 Apply，清 transient 并回冷 1.8。 |

observer 只读生产请求、回执、像素摘要和 renderer 接收，不替换时钟、随机数或输出。本次 PNG 的 displayScale=3 与 PNG 增强放大是两个不同环节，没有用后者代替源点径的倍率验证。

## 审查发现与修复验证

执行前 CPU 审查指出两处直接漏接，由主线程修复后冻结再验：固定预览没有 live family，旧 setter 入口会漏消费；无 raw palette 的合法旧文件，record/restart 备用分支会遗留热点径。最终矩阵分别经公共 UI 走过这些路径，验证脚本没有修改产品。

标准源文档的 Save 保热、文件 parser 丢弃 transient、cold snapshot/Apply/reset 清除、render/capture identity 包含热值、Apply identity 排除热值，另由 CPU 测试和源码审查覆盖。**本轮没有实际执行新增点径与 library/undo 的组合**，不把源码推导写成运行证明。

## 证据与边界

完整记录位于 `.cache/symmetry-point-size-ui-20261025/`：

- `run-3/report.json`：83 项通过；591 个 src/server、输入、本 harness/package pin 前后一致；page/Worker error 为 0。
- `cpu-prepare.json`：5 项真实 parser/owner 检查；`cpu-tests.json`：`source-symmetry-cold-runtime` 和 `source-symmetry-palette-lifecycle` 共 14/14。
- `audit.json`：28 项 CPU 留存证据复核，包括 PNG 全量重新解码、两个 MP4 的 ffprobe、实际 hot display 顺序、源 pin 与清理。
- `verified-product.diff`：在确认运行 pin 仍一致后保存的产品差异；不是提交本身。

保留两次验证器失败：`run-1` 错在 Geometry 寻找实际位于 Appearance 的控件；`run-2` 在 20 项通过后错误等待 Save 必须产生 generate。两次均未放宽产品断言，均完成清理；最终用 Save 后真实 retained capture 验证状态。原始 stdout 的 `steps:0` 是复用模板按不存在的逐动作 status 统计所致，报告保留 16 个动作快照，成功依据是 83 个断言与独立复核，不追改历史日志。

Node 24.18.0、Chrome 155.0.8059.85、单台 Mac / DPR1 / 隐藏 Chrome。context、browser、Vite、export server 全部 fulfilled，服务 owned process=0，完成后立即归还 GPU。没有第二设备、全 batch 性能、显存、原版完整帧或全场景完成结论。

索引 `index.json` 绑定 29 个文件，SHA-256 为 `3ce1e4ebd20752e382bd3b004464483a69c3b316c822f3eef966645e7bcc0256`。重跑须取得独占 GPU 时段并使用新目录：

```sh
../.cache/local-toolchain/node_modules/.bin/node .cache/symmetry-point-size-ui-20261025/verify-app.mjs --run-ui .cache/symmetry-point-size-ui-20261025/run-NEW
```
