# Perlin 动画采样与队列终点原版对照

2026-10-26 更新：本轮所列 GPU 数学图层残差已由生产原生路径消除，录制与截图流程也已复验；详见 [原生绘制接入与本机验收](source-perlin-native-production-validation.zh-CN.md)。以下保留原日期的证据范围与历史结果，不能外推为全家族或原版整窗通过。

2026-10-22，产品基线 `8c6bd74`。本轮新增真实原版运行和构建页面导出比较，没有修改生产渲染代码，也没有放宽像素阈值。上轮只证明固定 filament 帧，本轮扩展到两组原版 GPU 配置、10 个动画位置。

## 实测范围与结果

原始输入为 `Noise/noise1.json`（filament）及 `Noise/noise2.json`（swirl flow 纹理，仍为 filament render style）。两份输入均未改写。原版正常 FREE 许可、策略与水印保留；使用 bundled JVM、正常场景初始化及 `Scene.runFrame(buffer,false)`，固定渲染 FPS 30，连续更新并绘制 271 次。

原版和本地 primary 均为逻辑 406 × 486、density 2；对照输出均为实际 500 × 600（逻辑 250 × 300、density 2）。原版第 1、16、61、151、241 帧分别与产品 UI 时间 0、0.5、2、5、8 的真实导出比较。第 0 个固定回放帧执行一次更新，不能把 UI 时间直接当成场景时间。

通过构建后 5179 页面导入各原始 JSON，实际拖动时间条并导出 PNG，记录 Worker 交付状态。全部 10 个点的 `sceneTime` 逐 Float32 与原版相同，更新次数分别是 1、16、61、151、241，最后一个点的 `queueComplete` 为 true。无页面错误，PNG 均为指定尺寸。

固定中心区域仍为 `[55,55,445,510]`，共 177,450 像素，没有为这次低位差异调整边界：

| UI 时间 | 实际 sceneTime | filament 不同 RGBA 像素 | swirl 不同 RGBA 像素 |
| ---: | ---: | ---: | ---: |
| 0 | 0.03333333507180214 | 0 | 4 |
| 0.5 | 0.5333333611488342 | 0 | 3 |
| 2 | 2.0333328247070312 | 0 | 13 |
| 5 | 5.033329963684082 | 0 | 16 |
| 8 | 8 | 1 | 23 |

filament 最后一例只有 `(210,332)` 蓝通道相差 1；swirl 各例增强 PNG 最大通道差为 1～2。非零案例仍然是差异，不能当作逐像素一致。完整未裁剪图还包含文字、水印等未完成的差异；全部指标、原图与公开导出的摘要见 [原生动画观察摘要](../tests/fixtures/source-perlin/native-animation-observations.json)。

## 已排除的差异来源

两个配置的原版实际 draw 捕获都包含 shader、uniform、采样纹理和 mip 层。其 512 × 512 flow、256 × 1 palette 的 level 0 与本地生成字节完全相同。另以实际 WebGL2 上传相同数据并生成、逐层回读 mip：两个配置共 **38 层全部逐字节一致**。

时间 8 的独立正式 GPU renderer 输出分别仍有 1、23 个 raw 差异像素，最大通道差都是 1；与实际 UI 的增强差异相符。这将剩余问题限定在增强前的绘制结果，不能归咎于 PNG 编码或增强算法。尚未进一步区分采样导数、计算舍入、后端 shader 优化或 RGBA8 量化；没有足够证据将某个浮点恒等式改写集成进生产。

shader 中的 hash/noise、三角函数、导数及 palette/flow 采样彼此相连。单独替换某一步使固定图更接近，不足以证明原版完整上下文一致。本轮没有加入坐标热点补丁或容差掩盖。

## 队列结束后：场景时钟与 Perlin 对象时钟不同

原版第 241 次更新完成 8 秒队列，`sceneTime=8`。继续调用正常非暂停场景帧到第 271 次后，`sceneTime=9.00001335144043`。但两组输入的第 241、271 帧，raw 和 enhanced **全 300,000 像素完全相同**；随后再暂停重绘也全图不变。

这一实际结果支持 Perlin 图像在队列结束后冻结。原版外层是否继续 draw、Scene 是否继续推进时间、Perlin 是否继续更新 GPU time 是三个不同问题。后续字节码核对见 [队列完成后的更新边界](source-perlin-post-queue-validation.zh-CN.md)：正常预览继续 draw，完成后的 Scene 不再调用 Perlin Mobject.update，所以 retained GPU time 不变。不能把 Scene 的 9 秒直接传给 shader，或因此删掉本地对象更新的完成保护。

本轮证明的是固定渲染步进和公开 UI seek/暂停 PNG；没有观测原版真实窗口播放跨过终点，没有验证 variable-FPS 播放、连续录制文件、CPU trail/累积背景在完成后的重复 display，以及所有编辑和录制状态转换。

## 执行与复验

两次原版任务分别 8.919、7.362 秒，均 exit 0、stderr 空、未超时、进程已回收且进程组不存在。原生 deadline 55 秒，policy 运行前备份并保留正常刷新；settings 摘要不变，license 文件保持原先不存在。无主屏输入或原版窗口激活。原生离屏宿主与真实窗口的像素校准目前仅有此前 Cornucopia 案例，不将它外推为本次 Perlin 窗口验证。

所有 Chrome 均为独立拥有的 headless 实例，显式禁用 ANGLE program cache，运行后关闭。CPU 时间、峰值进程族内存、GPU 时间和 agent token 成本未测量；本轮未改生产代码，没有重复上一轮已通过的构建或单元测试。

完整本地证据在 `.cache/perlin-animation-native-20261022/`：

- `NativeSceneProbe.java`、`run.py`：有界原生采集；`native-filament/`、`native-swirl/` 保存正常原生帧、clock、draw 状态、纹理、原始输入 SHA 和资源清理。
- `public.mjs`、`public-filament/`、`public-swirl/`：实际构建页面、时间条、PNG 下载及 Worker 审计。
- `comparison.json`：10 个对照点，包含场景时间等值检查和图像摘要；`post-queue-image-comparison.json`：终点后的全图比较。
- `replay.mjs`、`replay-filament/`、`replay-swirl/`、`raw-boundary-comparison.json`：时间 8 的独立生产 renderer 输出。
- `mips.mjs`、`mip-comparison.json`：38 个原生/浏览器 mip 层的逐字节比较。

大型原生图像、纹理及本地运行产物不进入版本库。本轮补齐了两组 GPU 样例的多个动画位置证据，**Perlin 整图、完整动画及 11 家族整体一致性验收仍未完成**。
