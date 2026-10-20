# Map／Symmetry 源相机验证

2026-10-21，2.0 的 M3 实现阶段。Map 和 Symmetry 的相机现已进入实际密度生成流程。原版 JVM／JOGL 整图一致性仍为 **0/11**；这次没有打包或替换现有 1.0 Apple Silicon 应用。

## 使用方式

新导入的原版 Map／Symmetry JSON 自动启用源相机。可在右侧“原版相机”面板编辑初始角度、中心、缩放、焦距，也可通过时间线旋转和缩放。预览、PNG 和视频使用对应计算帧携带的相机与逻辑画布尺寸，渲染器不会再次给已投影图像施加轨道相机。

此前保存的本地作品保持原有数学视口。开发接口 `parseLegacyScene(text, {iteratedCamera:'legacy-v1'})` 也能明确选择旧导入方式。源相机作品使用顺序队列：Map 提供等待、组合动画、对齐；Symmetry 提供等待、组合动画。参数仍可通过组合动画的参数动作变化；旧本地数值／振荡轨道继续由旧作品模型支持，不把这些本地片段宣称为原版队列。

新导入 Symmetry 在源文件省略尺度时使用 `(100,100,0)`；Map 的原缺省尺度是 `(1,1,1)`。显式输入优先。原始 JSON、已登记数值词法和未消费字段仍保留在项目来源记录里。

## 实际补上的行为

| 行为 | Map | Symmetry |
|---|---|---|
| 采样位置 | 数学坐标变换后，分别乘捕获的 modelview、projection | 相同 |
| 角度变化 | 超过源阈值时更新捕获矩阵并清空密度 | 保留捕获矩阵与密度，旋转显示 |
| 缩放／中心变化 | 超过源阈值时更新矩阵并清空密度 | 相同 |
| 仅焦距变化 | 不单独触发重新捕获 | 相同 |
| 显示取样 | 最近邻 | 线性插值 |

阈值是源 Float32 的 `0.0001`，比较对象是上一次观察值，而非第一次捕获值。小于阈值的连续变化不会被错误累加为一次清空。清空墨迹保留数学粒子状态，也不自行重置相机锚点。

显示旋转先在浮点密度上取样，再调色；不是旋转已经完成的 RGB 图像。CPU 和 GPU 的投影均保留 `P × (M × point)` 顺序、透视除法与近远裁剪；点中心刚在侧边外时，仍允许点的覆盖范围进入图像。GPU 粒子和累积仍在 GPU 上，当前捕获相机的最终取样与调色明确使用 CPU。

## 验证

- CPU 公共生成入口：原版文件导入、保存重开、两种清空策略、热请求与冷重放一致、倒退、取消恢复、相机与逻辑尺寸失效、焦距单独变化、侧边覆盖及后方裁剪通过。
- 源配置边界：两参数 ambient、数值先转 Double 再转 Float、坏时长的源默认值、缺省 type／method、无参数容器跳过、源 Symmetry 尺度默认值及自定义参数组合动画通过。
- 真实 Chrome GPU：9 组投影情形、108 项断言通过；覆盖非交换矩阵、透视 W、近远面、后方、侧边覆盖和斜相机。浮点墨迹与 CPU 参照最大误差约 `7.08e-6`；同一墨迹经过两种取样后的完整 RGBA 一致，释放后资源计数为零。这不是原版应用 framebuffer 对照。
- 公开 App：两场景均完成源文件导入、相机编辑、播放／暂停、实际画布显示与 PNG 下载；192×128 PNG 完整 RGBA 与对应 Worker 输出一致。Map 还完成 3 帧、3 fps MP4，FFprobe 确认帧数／尺寸，3 张上传 PNG 均与对应 Worker 输出一致。Symmetry MP4 未在本批单独测试。
- 公开验证使用原包 JSON，明确记录较小工作量与短时间线覆盖；为比较完整 RGBA，测试夹具关闭公式文字叠加。没有降低用户作品的配置，也没有将小夹具外推到高质量负载。

本地详细报告在 `.cache/captured-density-gpu-verified/report.md` 与 `.cache/captured-density-public-final/report.md`。验证脚本已纳入仓库；本地证据、截图和原包不进入 Git。

全套回归 **308 个测试文件／5,711 项测试通过**（96.25 秒）；TypeScript 与 Web 构建通过，仍有既有的大 bundle 提示。未执行桌面重新打包。

## 成本与限制

同一 320×240 浮点墨迹的 CPU 调色测量：不旋转首次约 6.9 ms、暖调用 6.7–7.3 ms；Map 取样首次 14.4 ms、暖调用 13–14 ms；Symmetry 首次 17.1 ms、暖调用约 16.9 ms。此项只测同墨迹的取样／调色，不含 GPU 回读、浏览器启动和粒子计算，不是端到端加速结论。CPU 时间、进程族峰值内存、GPU 内存和本轮 token 成本未单独计量。

仍有以下独立边界：

- 本地编辑、尺寸变化和导出重新确定性重放；原版热调整尺寸会保留既存矩阵，原版 Replay 分支也有不同观察时机。这次没有宣称复刻这些原生对象生命周期。
- 数学状态、随机数、部分设置的表达式解析、点覆盖核、颜色和归一调色仍有此前记录的本地实现差异；物体 rotateZ 仍是本地扩展，不等同于相机 theta。
- 原版 Map 越界／空密度输出背景，Symmetry 输出透明，再由宿主合成。本地已有背景／透明策略继续适用，未完成原版最终 alpha 合成对照。
- 本地固定时钟与原版实时线程、窗口 DPI、JOGL 栅格化和整图一致性仍未验证。

## 可追溯的原包事实

固定 `MathArt-1.7.8-b07191b3e97da6fe465555ef6e61a0be.jar`，SHA-256：
`a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018`。

静态依据是 `MapAttractorMobject`、`SymmetryChaosMobject` 的 `updateAccumulationCameraMatrices`、`shouldClearForCameraProjectionDelta`、`displayPanelRotationRadians` 和 `ensureAccumulationBuffers`，加 `Scene`／`CameraController` 的矩阵顺序。相机观察更新位于对应方法 PC194–235，重拍矩阵 PC273／282；两种 texture filter 分别为 GL_NEAREST／GL_LINEAR（调用 PC201／216）。源配置初值与动作来自 `JsonMapAttractorConfig`／`JsonSymmetryChaosConfig`；Symmetry 尺度默认来自 `BaseSymmetryChaosConfig.<init>` PC171–184。

原包着色器 `map_attractor_accumulate_quad.vert`、`density_map_accumulate_quad.vert` 明确分别乘两个矩阵；两个 present shader 明确以物理宽高比做反向旋转后才调色。完整方法偏移、成员哈希与原始提取保留在 `.cache/v2-iterated-camera-audit.md` 和 `.cache/v2-iterated-camera-source/manifest.json`。这些是静态证据，不能替代原版运行画面。
