# Samila 源视口验证

2026-10-21，2.0 的 M3 实现阶段。本批修正 Samila 的构图尺度：新导入作品的缩放和平移直接影响画面，不再被自动适配抵消。原版 JVM／JOGL 整图一致性仍为 **0/11**；没有打包或替换现有 1.0 Apple Silicon 应用。

## 使用与兼容

重新导入原版 Samila JSON 会启用 `source-ndc-v1`，同时启用限幅密度历史和锚定 theta。暂停后可拖拽平移、滚轮缩放，预览和导出复用临时视图；项目保存仍保留作者配置，重开恢复配置视图。自动适配和不参与 Samila 绘制的通用三维变换不显示为可用控制。

已有本地作品不会自动迁移。开发接口 `parseLegacyScene(text, {samilaProjection:'legacy-v1'})` 明确保留之前的导入行为；之前的 `samilaCamera:'legacy-v1'` 退出选项仍有效。

## 修正的行为

| 项目 | 新导入的行为 |
|---|---|
| 坐标顺序 | 数学投影 → 旋转 → XY 缩放 → Y 乘物理宽高比 → XY 平移 → 固定 NDC 边界 |
| 缺省缩放 | X、Y 为 float32 的 `.33`；省略字段与提供坏值的默认规则分开处理 |
| 平移单位 | 屏幕标准化坐标；Y 偏移不再被宽高比额外放大 |
| 拖拽 | 每个事件按逻辑画布尺寸计算偏移，以 float32 累加 |
| 滚轮 | 乘 XY 采样尺度，不修改通用相机 zoom |
| 相机起点 | 标准加载路径从 theta=0 开始，JSON 中的 camera 原值保留但不应用 |
| 历史 | 几何变化清空并重新捕获 theta；仅 theta 显示变化保留已有密度 |

源视口数值读取是 Java Double 解析后转 Float，不支持 `PI`、`1/2` 这样的表达式。省略 scale_x／scale_y 保留 `.33f`，存在但读取失败时使用 getter 的 `1f`；offset／rotation 的失败默认值为 0。NaN／Infinity 在源 getter 中不是失败默认值，本地明确拒绝这些不可持久化的结果。已消费的数值词法、原始 JSON 和未使用字段保留在项目来源记录中。

## 验证范围

全套回归 **310 个测试文件／5,732 项测试通过**（98.12 秒），TypeScript 与 Web 构建通过；仍有既有的大 bundle 提示。新测试覆盖源字段读取、数值词法往返、重复键拒绝、大旋转角、CPU 固定 NDC、历史失效、CPU／GPU 适配合同和旧文档兼容。原版窗口仍被系统锁定阻断，没有取得新的原版截图。

真实 Chrome WebGL2 验证通过：6 组坐标情形加 CPU／GPU 溢出分类，共 48 项断言；包括横竖画布、非等比尺度、旋转顺序、边缘覆盖、冷热重放与倒退。按独立坐标公式计算的浮点墨迹最大误差约 `2.86e-5`，释放后已知资源计数为零。这不是原版 GPU 画面参照。

公开 App 在 DPR 1 和 2 均通过逐事件拖拽、连续滚轮、撤销重做、保存重开和重置。两种 DPR 的 192×128 PNG 完整 RGBA 均与导出 Worker 一致；重置后的 Worker 与实际渲染画布像素分别与初始状态完全一致。DPR 1 另完成 192×128、3 帧、3 fps 的 MP4，FFprobe 确认尺寸和帧数，3 张上传 PNG 均与对应 Worker 完整 RGBA 一致。DPR 2 视频未单独测试。

首轮公共验证的拖拽期望误用了完整元素高度，已修正为实际图像呈现矩形；第二轮发现高 DPR 截图含 8 个像素、最大 1 级的浏览器合成差异。因此验收直接比较 Worker 与实际画布的原始 RGBA，截图合成另列。失败尝试保留，未把截图差异写成原始图像相等。

公开夹具取自固定原包 `data/samila/Samila.json`，明确改为每批 256 点、GPU、点尺寸 2、alpha .8、关闭拖尾和 1 秒等待片段，便于验证交互与传输。没有更改用户作品负载，也不以此推断原版高批次性能。公开验收约 32.03 秒，GPU 专项约 1.87 秒；代码哈希始终稳定，浏览器、开发服务和导出服务均已正常关闭。CPU 时间、进程族峰值内存、GPU 驱动内存及本轮 token 成本未单独计量；没有性能提升结论，也没有等价原版端到端基线。

本地详细报告为 `.cache/samila-source-navigation-public-final/report.md`、`.cache/samila-source-ndc-gpu-verified/report.md`；截图差异在前者目录的 `screenshot-diff.json`。两个验证脚本已纳入 Git，本地证据、媒体与原包不进入仓库。

## 仍未完成的边界

这次实现的是视口坐标规则，不是完整原版 Samila。本记录验收时，数学组合、球面投影及根 `samila` 配置读取尚未移植；其后续进展见 [Samila 数学验证](samila-source-math-validation.zh-CN.md)。随机序列、噪声配色、点覆盖核与透明合成仍有本地差异。

本地时间线继续使用固定采样时钟及已有动作解释；原版的未知片段等待、相机与参数动作队列仍需独立移植。尤其本地 align／数值片段不能据此称为原版行为。尺寸变化和导出按本地确定性重放，未复刻原版热调整尺寸的采样游标和对象生命周期。CPU 与 WebGL2 的公式精度、三角函数和浮点运算也不保证逐位一致。

## 原包证据

固定 `MathArt-1.7.8-b07191b3e97da6fe465555ef6e61a0be.jar`，SHA-256：`a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018`。

`samila_splat.vert` 355–386 行规定旋转、尺度、宽高比、偏移及直接 gl_Position。`SamilaMobject.drawSplatBatch` PC453／479／499／504–540 上传尺度、偏移、旋转和物理宽高比。`BaseSamilaConfig.<init>` PC191／197 定义 `.33f`；`JsonSamilaConfig.<init>` PC380／441／461／481／501 读取五个视口值。

`SamilaMobject.addViewportScreenDelta` PC0–49 和 `MathArt.mouseWheel` PC161–199 定义拖拽与滚轮。标准加载链 `MathArtSession.loadProject` → `ProcessingBridge.updateConfig` → `MathArt.reloadConfig/initScene` 创建 Samila 后仅读回相机角度，不将 JSON 的角度写入新引擎；相机面板后续编辑另有桥接调用。

getter 的证据来自随应用携带的 Processing core 4.5.0：`JSONObject.getFloat(String,F)` 调用 `getFloat` → `getDouble` → `Number.doubleValue`／`Double.parseDouble`，最后转 float；异常才使用默认值。静态提取和文件哈希在本地 `.cache/v2-samila-viewport-audit.md` 与 `.cache/v2-samila-viewport-source/manifest.json`。这些证据是包内代码事实，不是原版运行截图。
