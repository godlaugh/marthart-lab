# 隐式曲面三个相机示例验收

本机已完成指南列举的 front、top、isometric 三组数值配置对照。每组首次网格重建（dirty）和随后稳定显示（steady）各一帧，共 **6 张 500×600 完整数学画面，以及对应的含公式画面，均与原版逐字节相同**：差异像素、差异通道、最大通道差全部为 0。投影、modelview、transform 三个矩阵的全部 Float32 分量和完整网格摘要也匹配。

这是 MAS-IMP-012 的有限相机示例验证，接续[重建帧与参数动画验收](source-implicit-dirty-display.zh-CN.md)。验证使用同一台 Apple M2 Max，原版 MathArt 1.7.8、OpenGL 4.1 Metal。原版 Compute 在本机仍不可用；实际路径是原版 CPU Marching Cubes 回退网格，再用原生 GPU 材质绘制。

输入保持原 `implicit_sphere` 配置的 60³ 网格、方程 `x²+y²−z²−1=0`、色板、线框、公式和时间线，只改变事先声明的 camera 字段。名称不代表另行换成了球面方程。主画布为逻辑 405×486、密度 2；离屏目标为逻辑 250×300、物理 500×600。top 的输入字节与已合格的 r3 参考完全相同，因此复用其 dirty、steady 两帧；front 和 isometric 分别执行了新的正常原版采集。

| 指南示例名 | 作者数值 `(phi, theta, gamma)` | 原版实际观察者方向 | dirty 数学／含公式差异 | steady 数学／含公式差异 |
|---|---|---|---:|---:|
| front | `(0, 0, 0)` | +Z | 0／0 | 0／0 |
| top | `(PI/2, 0, 0)` | +Y | 0／0 | 0／0 |
| isometric | `(PI/4, PI/4, 0)` | 约 `(0.5, 0.5, 0.7071)` | 0／0 | 0／0 |

**指南的方向描述与原程序存在冲突。**冻结的指南文字将 front 描述为从 +Y 观察、top 描述为从 +Z 观察；实际原版 `CameraController.applyTransform(PGraphics)` 依次执行 `rotateZ(-gamma)`、`rotateX(phi)`、`rotateZ(theta)`，再平移场景中心。对应字节码 PC 为 6、14、22、50。结合原 Scene 的相机与中心变换，在本例 `gamma=0` 时，从原点指向观察者的方向为 `(sin(phi) sin(theta), sin(phi) cos(theta), cos(phi))`。表中的方向由这一变换及已匹配的实际矩阵推导；原浮点矩阵保留其 Float32 近似。

源网格仍按 XYZ 原顺序提交，捕获的原 vertex shader 直接使用 `vertex.xyz`，没有额外 Y/Z 交换。产品保留原数值语义，**没有**为了迎合指南标签而执行 `phi → PI/2−phi`。因此本页验证的是三个已列数值示例的原版效果，不证明指南所述通用球坐标解释成立；“isometric”沿用指南名称，也不表示三个世界轴与观察者夹角严格相等。静态证据、指南快照和原 shader 的路径及摘要都在[精简验收索引](../tests/fixtures/source-implicit-cameras/20261027.json)中。

产品从源 JSON 独立导入，经公开 Generator、真实 Worker、原生绘图服务、独立字形服务及公式合成器完成输出。原版矩阵、属性和像素只用于生成结束后的比较，没有送入产品作为输入。六帧均为 90,120 个源网格顶点，positions 与 normals 的完整摘要相同；每帧另核对 22 项数值材质 uniform。原版三个 fill draw 和三个线框 draw 构成完整数学层，公式后、品牌前构成完整艺术层；比较不裁 ROI，也不以 fill-only 图替代完整数学图。原品牌图保留在参考中，不属于产品艺术层的零差声明。

首次 dirty 绘制仍忠实保留原版 Compute 尝试后恢复主 viewport 的效果：目标是 500×600，当次实际 viewport 是 810×972，公式也继承此视口。第二次 steady 为 500×600。六张落盘 PNG 又经过独立离线解码，完整 RGBA 与已比较通过的艺术层及摘要完全一致；这是验证器产物检查，不是正式增强 PNG 导出界面验收。

**初始时钟不同，未混计为相等。**原版参考是 `sceneTime=0` 的两次正常暂停显示；产品固定重放的第一次 `time=0` 请求已经执行一次 1/30 秒更新，实际 `sceneTime=0.03333333507180214`。该输入先等待一秒，这次更新没有相机或参数写入，故可以严格比较相机、网格与视觉效果。重复 `time=0` 产生 steady 显示，但不能据此宣称初始暂停时钟或保留实例的 pause API 相同。

首轮 `run-1` 在验证器查找投影 uniform 时失败，报告完整保留。原 Processing LINE shader 的名称是 `projectionMatrix`，产品既有线框 shader 的名称是 `projection`；首轮错误地用原名称查询产品。只修正验证器名称映射后，`run-2` 完成六帧比较；没有为通过检查改变相机或矩阵算法。

最终产品验证墙钟为 **10.128 秒**，抽样进程族 CPU 24.860 秒、峰值 RSS 约 2.25 GiB；采样错误、清理错误、残留服务进程均为 0，源码与参考摘要前后稳定。它包含浏览器、服务、验证、编码和观察成本，不是日常吞吐基准。两个新原版采集分别为 11.263 秒和 8.906 秒，采样进程族峰值 RSS 约 427 MiB、487 MiB；均使用实际 512 MiB JVM 堆上限、正常四项权限、无可见窗口，结束后自有进程为 0。top 为既有参考复用，不计作本轮新运行。未测 VRAM、跨设备差异或本轮独立 agent token。

原版作者计划和索引分别在 `.cache/source-implicit-camera-reference-20261027/plan.json`、`capture-index.json`；产品报告在 `.cache/source-implicit-camera-product-20261027/run-2/report.json`，PNG 解码审计在 `.cache/source-implicit-camera-product-20261027/png-artifact-audit.json`。维护入口是 [verify-source-implicit-cameras.mjs](../scripts/verify-source-implicit-cameras.mjs)，依次接收绝对路径的参考目录、新输出目录、原生后端 manifest、字形后端 manifest。原计划、索引、输入、执行脚本和报告摘要均已固定于[验收 fixture](../tests/fixtures/source-implicit-cameras/20261027.json)。

没有修改原 JAR、许可、设置、保护或品牌。结论限于上述三个相机、同一拓扑与尺寸、同一台 Mac；不扩大为所有相机、其它设备或原版 Compute 成功。用户目前只有这一台 Mac，跨设备保持未验证。
