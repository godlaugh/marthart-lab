# 源 Implicit 有限网格成本验收

基线 `a75dd8e3e76dd1d7976374e08955bc10a6b59569`。五组原版、五组产品均完成；原版 10 帧、产品 15 帧（其中 12 个源 mesh 请求完成公式与增强 PNG）。最终矩阵无拒绝、所有源/input pins 稳定、owned cleanup 为零。GPU 已释放。

## 阶段墙钟（毫秒）

| 输入 | 原 initScene | 原首次完整显示 | 原同 owner 稳态显示 | 产品首次数学任务 | 产品稳态数学任务×2 | 产品首次含公式PNG任务 | 产品稳态含公式PNG任务×2 |
|---|---:|---:|---:|---:|---|---:|---|
| cpu-preview-50 | 589.10 | 159.78 | 8.46 | 792.90 | 434.10/429.00 | 未测 | 未测 |
| cpu-wireframe-70 | 688.15 | 285.88 | 24.86 | 949.10 | 671.80/590.90 | 2522.80 | 979.90/884.30 |
| gpu-wireframe-70 | 688.89 | 251.85 | 5.54 | 1033.70 | 732.10/667.20 | 2569.20 | 1142.60/1049.80 |
| gpu-wireframe-100 | 815.36 | 385.96 | 5.78 | 1840.00 | 1627.30/1487.10 | 3456.60 | 2371.10/2238.70 |
| gpu-wireframe-135 | 1079.20 | 592.71 | 6.30 | 3308.00 | 3081.80/3076.10 | 5402.60 | 4435.50/4438.90 |

两侧不是同范围整帧：原显示含公式/品牌并完成 loadPixels，产品数学与公式/增强PNG分别列出。**不据表给出整任务加速倍率。** `initScene` 包含源 constructor eager build；原首次 display 可能再次 dirty rebuild。产品首次包括新 Worker 启动，runtime setup 另见 JSON。

## 结果规模、CPU 与采样内存

| 输入 | 原/产品结果 | 原 init/首次/暖线程CPU ms | 原整task child CPU s | 原family峰MiB | 产品每请求family CPU ms | 产品每请求峰MiB |
|---|---|---|---:|---:|---|---|
| cpu-preview-50 | 2676 particles / 29598 local points | 421.54/149.03/7.71 | 8.87 | 320.36 | 3370.00/1840.00/1610.00 | 1769.86/1778.56/1780.67 |
| cpu-wireframe-70 | 双方 122256 vertices | 548.18/282.21/24.02 | 8.94 | 423.39 | 8280.00/3380.00/2100.00 | 2083.62/2023.94/2072.62 |
| gpu-wireframe-70 | 双方 122256 vertices | 550.95/245.06/3.58 | 8.80 | 374.41 | 8480.00/3870.00/2600.00 | 2131.64/2151.20/2204.09 |
| gpu-wireframe-100 | 双方 250176 vertices | 666.21/376.87/3.12 | 9.39 | 447.58 | 11760.00/4430.00/2950.00 | 2329.62/2608.81/2636.23 |
| gpu-wireframe-135 | 双方 455040 vertices | 941.17/578.17/3.73 | 10.09 | 586.36 | 15670.00/5360.00/5340.00 | 2726.36/3118.25/3148.81 |

原线程CPU不包含所有 JVM/driver 线程；整task CPU 包含 javac、监测和PNG。产品family包含Node/Vite/Chrome/Worker/native/glyph，已排除每段开始前既有累计CPU。250ms采样可能漏短峰，不能称精确瞬时峰值。两侧进程结构不同，不能用该RSS表推导buffer预算被突破。

未单独测量 GPU 执行时间、显存或 agent token；这些成本保持未知，不能从上述墙钟、CPU 或 RSS 反推。

## 下一项实际产品问题

本次 135³ 的 455040 顶点完整准入，无缩段；GPU名义模式原实际 computeProgram=0、materialProgram=1，为正常CPU回退。四个mesh输入原/产品顶点数相等，但本轮不是逐字节几何/整图对照。

135³ 产品同 owner 稳态仍有约2.04–2.06秒 generate，而原稳定显示复用形状。源代码链 `SourceImplicitRecordingSession.drawFixed→generateImplicitFrame→generateSourceImplicitMesh` 每次重新生成，`display.rebuilt=false` 未缓存实际网格。可以评估以现单一数值/dirty owner缓存不可变field/mesh/可传输副本，必须保持热palette/材质/相机、dirty重建、transfer detach和预算所有权；本次只保存before，不修改生产。

PREVIEW差距更直接：原50³产生2676粒子，产品本地MT产生29598点。该算法差距不能用产品<1秒成本代替源行为验收。

所有具体阶段、输入SHA、native身份、viewport、公式PNG SHA、旧失败与限度见 [results.json](../.cache/source-implicit-grid-cost-20261027/results.json)。可将 MAS-IMP-026 的有限成本部分据此更新；不能关闭 PREVIEW数值parity或整个Implicit/M3。

## 执行与证据边界

- [作者计划](../.cache/source-implicit-grid-cost-20261027/author-plan.json)、[生产测量入口](../.cache/source-implicit-grid-cost-20261027/measure-product.mjs)、[原版正常宿主](../.cache/source-implicit-grid-cost-20261027/original-host/run.py)、[完整索引](../.cache/source-implicit-grid-cost-20261027/index.json)。输入固定同一个原方程 `x^2+y^2-z^2-1` 与 `[-2,2]^3`，只改变三轴段数与名义模式；不把小方程结果推广到任意复杂场。
- 生产数学入口为真实 `Generator→Worker→generateScene→source MC/local PREVIEW→ArtRenderer→readSourceDrawingPixels`。源 mesh 使用真实完整 native frame 传输；完成数学后另由 `encodeFormulaRaster` 交付源公式及 paused PNG 增强。无需参考网格/矩阵/像素作为输入。原版为正常 `reloadConfig→initScene→runFrame(target,true)`，两次同 owner paused display；未调用 EXPORT。
- 三个早期记录保留：`product-cpu-preview-50-r1` 是回环 listen EPERM，未开始生成；`product-cpu-preview-50-r2` 是加入公式交付前的已完成数学测量；`product-cpu-wireframe-70-r1` 是验证器误选本场景正式导出未使用的 bounded 路径而被拒绝，不计成功吞吐。最终对应 r3/r2。
- 全部产品最终帧无 pageerror/应用 console error。Vite 本地 WebSocket 开发连接错误另行原样保留，不计产品绘制故障。原版保留 Processing getGL2 能力探测异常，GPU 名义输入另外保留原 compute/SSBO 分配失败；正常 CPU fallback 完成，未将其改写为 GPU compute 成功。`sourceGlErrorReads=[]` 仅指该观察范围，不是“原版从未出现任何 GL 错误”。
- 源 mesh 四组每次完成完整格点/cell 规模；原/产品顶点数一致，两个产品暖请求数学RGBA及PNG各自稳定。本轮没有保存/对照逐顶点数值与原版数学像素，不将成本测量冒充新整图一致性证据。
- 原版每组整task成本包括编译/启动/输出记录，产品 runtime setup 单列；冷暖各段计时不能与整process时间混用。没有将指南的预计时间当硬性通过阈值。150+的内存建议与200³规模声明未扩成通用吞吐要求。

精简可机器读取摘要见 [fixture](../tests/fixtures/source-implicit-grid-cost/20261027.json)。既有原版本机fallback能力见 [能力记录](source-implicit-gpu-capability.zh-CN.md)；本轮不关闭 PREVIEW算法parity、整个Implicit场景或全部11族M3。
