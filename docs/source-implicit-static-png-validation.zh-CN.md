# 隐式曲面静态 PNG 增强处理验证

日期：2026-10-22。本轮修复的是原版隐式 CPU 曲面静态 PNG 的导出处理顺序，不改变本地曲面、源 JPEG 或视频。全家族整图验收仍为 **0/11**。

## 差异来自哪里

复用上一轮原版正常许可环境中的完整 `raw-frame-0.png`、`enhanced-frame-0.png` 与本地实际导出，不再启动原版。全部图像为 500×600；中心区域沿用 `[55,55,445,510]`，没有调整验收区域或容差。

| 比较层 | 中心 RGB MAE | RGB 不同像素 |
| --- | ---: | ---: |
| 原版 raw 与上一轮产品 PNG | 0.019829 | 110 |
| 原版 raw 与不含公式的本地几何原型 | 0.001646 | 28 |
| 原版 raw 与原版 enhanced | 0.827565 | 61,864 |

上一轮剩余的 0.846823 主要来自缺失的整图增强。把原版完整 raw RGBA 交给既有 `enhanceSourcePausedImage` 后，与原版 enhanced **全图逐字节相等**：不同字节/像素均为 0，最大差值为 0。两者 RGBA SHA-256 均为 `560f808fc8d3539cb1893e05b2e38c8dd045688dbac9a01cbe2fe014a005ae64`。这是已存在共享算法的验证，不是新造隐式增强算法。

## 修复与边界

静态 PNG 导出为源隐式 CPU mesh 显式选择 `sourceImageProcessing: 'paused-png'`。renderer 读取未合成的源 framebuffer，交给共同 owner，按 **源公式合成 → 既有增强 Worker → PNG** 顺序处理，倍率为 1。

新生成的几何帧不具有 retained numerical snapshot 身份，因此没有伪造 `sourceCurrentImage`。既有暂停捕获仍使用自身的 scale 1/3/5 和身份校验；current 存在但 scale 缺失或为 null 时明确拒绝，不能退回 raw 或 fresh scale1。保留原有 Worker 复制/转移、容量预检、取消及终止清理边界。源 JPEG、视频和其他家族没有新增隐式选择。

## 真实公开导出

执行 `scripts/verify-source-implicit-export.mjs`，从受控 fixture 经页面导入、完成预览、公开导出对话框下载 PNG；匹配真实 Worker 请求/响应，确认预览与导出的 density 都为 2，并实际完成 500×600、scale1 的增强 Worker。没有页面错误。

| 与原版 enhanced 比较 | 修复前 | 修复后 |
| --- | ---: | ---: |
| 中心 RGB MAE | 0.846823 | 0.025299 |
| 中心不同 RGBA 像素 | 61,900 | 416 |
| 全图 RGB MAE | 2.710368 | 2.221990 |
| 全图不同 RGBA 像素 | 69,431 | 7,795 |

原版 PNG SHA-256：`56f1833df3d77c0f4ba523c75424f4a211f906777e814ca593c14191cea301cb`。本轮实际产品 PNG SHA-256：`8a91b451e2d1b1625ce3732133a9b4f1fa789696ee4540135e9e88ddad64433c`。PNG 已目视核对；原版许可水印与 logo 保持原状。当前产品公式约在 y=465，而原版公式位于底部水印附近，**公式布局/位置仍待查**，不能把全部余差归为字形栅格。几何 raw 层亦仍有 28 个不同像素。本轮没有继续扩修这些差异，也没有声称整图一致。

合法输入的实际 PNG 验证先完成，之后仅补 malformed current scale 拒绝回归并重建；该收尾不改变此合法输入的处理。

## 检查与成本

- `tests/source-static-png.test.ts`：5 例，覆盖 fresh 顺序、保留输入、无操作 raw 路径、JPEG 拒绝、取消与 malformed retained scale。
- `tests/source-paused-png.test.ts`：11 例，覆盖既有 Worker 身份、容量、取消、失败与清理。
- `tests/source-surface-capture-formulas.test.ts`：4 例，覆盖 retained 捕获与录制公式 owner。
- 以上 3 文件合计 20 例通过；类型检查与最终 `build:v2` 通过。公开导出脚本通过。
- 根代理额外执行 6 文件 129 例，通过：`formula-raster-export`、`source-domain-current-capture`、`generation-worker-capture`、`fractal-live-transport`、`export-session-cleanup`、`rgba-png`。与上述文件不重叠，共 149 例；报告为 `integration-tests.json/log`。

新增计算确有成本。使用同一完整 500×600 RGBA，分别在独立 Node 进程测旧 raw encoder 与新路径的 owned copy、容量检查、共享增强、同一 encoder；两侧都完成 PNG Blob 读取与 hash。first 是新进程首轮，不代表操作系统冷缓存；warm 为后续 10 次总计。进程无子进程，峰值 RSS 为进程累计值，包含初始化。

| 完成任务 | 旧 raw：elapsed / CPU / peak RSS | 新增强：elapsed / CPU / peak RSS |
| --- | --- | --- |
| first ×1 | 35.28 ms / 50.03 ms / 65.14 MiB | 49.56 ms / 73.56 ms / 67.45 MiB |
| warm ×10 | 232.74 ms / 264.24 ms / 71.59 MiB | 278.59 ms / 314.46 ms / 88.56 MiB |

这属于完整 PNG 组件任务比较，不是整个 UI 导出耗时。浏览器 Worker 启动/转移调度、公式、GL、GPU 内存及 agent token 未测量。采样期间其他已知重任务已停止。输入没有被修改。

本地完整证据位于 `.cache/implicit-static-png-20261022/`：`native-enhancement-comparison.json`、`comparison.json`、`comparison.png`、`public-final/report.json`、`performance-{before,after}.json`、`tests-final.log`、`build-final.log`。缓存包含本地原版材料，不进入版本库；受控公开回归脚本仅依赖仓库 fixture，不依赖这些缓存。

后续进展：公式帧与位置已在同日修复并实际导出验证，中心差异进一步降为 135 个像素；旧保存布局保持兼容。见[公式帧验证](source-implicit-formula-frame-validation.zh-CN.md)。
