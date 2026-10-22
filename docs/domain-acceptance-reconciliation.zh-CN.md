# 域着色验收清单复核

2026-10-22。复核当前源码、原版数值轨迹、已有公开界面验证和本轮原版图像后，清单中“尚未接入域着色时间线”的描述已经过时。它不再作为未实现功能重复开发；原版整图与动画效果验收仍单独保留。

| 项目 | 当前事实 | 剩余验证 |
| --- | --- | --- |
| MAS-DOM-031：读取并执行 domainRotate、paramStart、actions、duration、easing | 导入器已经解析为源队列，运行实例共同推进旋转、参数和渐变；已接入播放、暂停、编辑、PNG 和录制 | 不能由此推定全部原版 GUI、图像和视频一致 |
| MAS-DOM-026：旋转 | 已有原版逐帧数值轨迹及实时暂停／恢复方法对照；正方向的指南文字与安装包实现存在冲突 | 匹配状态的原版动态图像、旋向与生命周期对照 |
| MAS-DOM-011：迭代累积语义 | 当前代码保留安装包执行链，未额外插入指南描述中的初始调用 | 明确区分指南描述与实际产物，不把两者的矛盾标成已完成 |
| MAS-DOM-069：CPU/GPU 数值和图像 | 已实际取得原版域着色图像，局部像素仍有差异；原版原始帧经过本地增强后与原版增强图完整一致，增强流程不是该样例残差来源 | shader 数学、运行上下文与跨后端浮点行为的残差归因，以及更多输入与动画 |

本轮重新运行 `source-domain-timeline`、`source-domain-host-live`、`source-domain-live-session`、`source-domain-live-editing` 四个测试文件，**52 项全部通过**。它们覆盖导入及队列、与原版实时方法轨迹的数值比较、生产会话暂停／恢复和编辑。会话测试中的替代渲染不用于声称原版像素一致。

已有的真实 App／Worker／FFmpeg 操作和验证范围见[域着色界面与导出验收](source-domain-ui-validation.zh-CN.md)，原版数值方法范围见[逐帧时钟验证](source-domain-clock-validation.zh-CN.md)和[宿主数值验证](source-domain-host-validation.zh-CN.md)。这些记录有明确日期；其中“尚未接入界面”等早期描述应结合后续记录阅读。

本轮重新执行的测试报告位于本机 `.cache/native-reference-progress-20261022/domain-requirement-tests.json`。清单状态保留在已备份的本机工作账本中。复核只纠正已经过时的待办描述，不放宽验收条件，也不增加家族验收通过数。
