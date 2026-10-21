# Symmetry 编辑路径与共享会话验收

2026-10-21。共享时间线现已提供独立会话，固定时间预览继续使用同一套参数、渐变和相机状态。新增实时步进及暂停接口，并允许重播显示跳过参数快照确认。**这一步完成了状态所有权整理，尚未把色板/变换编辑后的 GPU 分帧重播接入界面。** 1.0 安装应用未重新打包。

## 原版编辑路径

以下结论来自固定 MathArt 1.7.8 JAR 的字节码和 BootstrapMethods 绑定解析，不是本轮原生窗口操作记录。

| 编辑入口 | 原版路径 | 对接要求 |
|---|---|---|
| 对称参数 Inspector | `applyChanges` → `updateConfig` → 场景重建 | 与沿用现有对象的热更新区分，沿用既有构造与种子规则 |
| 渐变区的色板修改 | `settings.palette` 提交回调 → `updatePaletteOnly` | 保留队列，向现有对象请求重播 |
| 缩放、位移控件 | `settings.scale_x` 等提交回调 → `updateTransform` | 六个运行时值更新，请求重播 |
| 时间线渐变帧 | `applyGradientFrame` | 只按阈值更新色板；不是 Inspector 的重播事件 |

色板回调的 bootstrap 80 绑定 `FractalGradientSection$notifyGradientChanged$lambda$23`，调用 `MathArtSession.updatePaletteOnly`。Symmetry 进入普通 `settings.palette` 分支，该属性使用 `LIVE_VISUAL`。Session 先调用 `updatePalette`，随后对 Symmetry 调用余弦色板 setter。Bridge、MathArt、GenericSymmetryChaosScene 将调用转交给现有 Mobject。

变换控件 bootstrap 24–29 和 Symmetry 专用控件 45–47 均绑定 `updateTransform` 回调。Mobject 的 setter 即使收到相同值也设置 pending，不能只用最终 JSON 差异代替编辑事件。

`display` 在 PC 115–166 处理 pending/active 重播后直接返回；参数比较与快照位于 PC 176–188，因而重播显示不确认参数快照。`update` PC 49–96 另行检查预热并执行迭代；`advanceReplaySession` PC 222–235 在重播未结束时将 `warmupApplied` 设为 false。后续 GPU 接入必须保持这些调用的顺序，不能把重播循环当成普通 update 的替代品。该交错尚未通过原版 GL 运行验证。

## 实现与验证

`SourceSymmetryTimelineSession` 现在唯一拥有队列及参数/渐变运行态。原先匿名 owner 的初始化与缓存路径已删除，固定预览缓存持有该会话；实时步进直接使用现有普通源队列，而非另写一套时间计算。

新增 5 项测试覆盖：固定步与实时步连续 70 帧一致；初始快照不更新对象；暂停不推进参数/渐变；跳过确认后仍与最后一次普通显示比较；小于 Float32 分辨率的增量跨暂停累积；输入隔离、定位重建、模式混用和失败后的重置。定位重建是本地功能，不声称原版提供 seek。

实际执行结果：

- 全量 **337 个测试文件、6,194 项测试通过**，43.66 秒。
- `npm run build` 通过；保留现有大分块提示。只构建 Web 产物。
- 真实 Chrome headless WebGL 参数集成通过，约 2.74 秒：自定义 uniform 的独立 Float32 递推、公共生成的参数清屏、倒退定位与重开复验均通过。
- 公共页面验收通过，约 12.66 秒：Map/Symmetry 导入、预览、Symmetry 参数动画编辑、保存重开、PNG 与 MP4 导出。PNG/视频上传帧与 Worker 输出比较通过，视频另经 ffprobe 检查；这仍不是原版窗口像素对照。

测试与构建并行运行，耗时不构成受控性能比较。CPU、峰值进程族内存、GPU 内存、冷/热差异及 token 成本本轮未测。此改动不声称性能改善。

## 尚未完成

需要继续接入编辑事件、GPU 重播预算、暂停/恢复的宿主时钟、显示计数和实际界面操作验证。新会话接口并不代表这些功能已完成。原版整窗口效果验收仍为 **0/11**；最近只读窗口检查仍报告 Mac 锁定，本轮未移动窗口或注入原生输入。

本地证据：`.cache/source-symmetry-parameters/session-edit-boundary/manifest.json` 与 `bootstrap-links.json`；测试日志 `session-tests.log`、构建日志 `session-build.log`、GPU 结果 `session-gpu/report.json`、公共页面结果 `session-public/report.json` 均位于 `.cache/source-symmetry-parameters/`。固定 JAR SHA-256：`a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018`。

后续进展：[GPU 重播执行层验收](source-symmetry-replay-gpu-validation.zh-CN.md)。执行层已通过真实 GPU 检查；界面、Worker 和宿主时钟接入仍未完成。
