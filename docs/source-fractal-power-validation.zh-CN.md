# Mandelbrot / Julia 源规则接入与验证

2026-10-22。原版 Mandelbrot 之前进入本地独立分形通道：本地视野跨度为 4，原版 shader 为 2，导致同参数图形大小明显不同。现在原版 Mandelbrot / Julia 文件进入独立的 `mathart-1.7.8-power-v1` 通道，使用原版公式参数、场景时钟、双 float shader、深缩放参考轨道与同一片段内的着色。

**这是渲染通道接入和数值验证完成，不代表 Fractal 家族整图验收完成。** 原版 MULTIPASS / GUESSING 的逐帧推进及暂停导出生命周期仍需对齐；当前预览调度继续使用本地实现，并在运行结果中明确标记。

## 已落实的行为

- 原版文件导入后，公式和着色由各自的源配置对象持有。普通动画和目标缩放使用已有的原版逐帧队列。保存、重开保留这些对象；旧本地作品仍使用跨度 4 和原有数值规则。
- 普通 Mandelbrot / Julia 执行原版 `formula_poly.glsl` 和原版主循环。退出原因区分逃逸、收敛与达到迭代上限，不再把逃逸当成内部点。
- 深缩放沿用原版 CPU DoubleDouble 参考轨道与 GPU 扰动算法。Mandelbrot 从零开始；Julia 从中心开始、使用所选常数。非整数幂按原版准入规则使用普通双 float 路径。
- 平移、缩放和点选 Julia 使用跨度 2、向下的源坐标轴。点选 Julia 会修改源公式对象，避免只修改不参与绘制的旧本地参数。
- 原版初始视口只读取 `center`；初始 `center_hi_lo` 保留在原始文件记录中，不当成已生效参数。时间线目标和已保存本地作品的中心低位仍受支持。

## ULTRA 的证据与修复

原版随附 `mandelbrot.json` 使用 `ULTRA`。实际 JAR 的 `PerturbationPrecision` 枚举包含 LOW、MEDIUM、HIGH、ULTRA；原版 `ComplexFractalMobject.mapPerturbationThreshold` 对 LOW 返回约 0.01，对 HIGH 返回约 0.000001，其余枚举走默认约 0.0001。因此 ULTRA 在这一映射上与 MEDIUM 相同。

这项阈值结论来自已保存的原版类指令，未声称执行了原版 GL 或该私有方法。实现现在保留 ULTRA 选择并使用原阈值，而不是把这个可运行的原版输入拒绝为未知档位。真正未知的精度值仍保留来源并明确报错。

## 执行过的验证

| 验证 | 结果 | 能证明的范围 |
| --- | --- | --- |
| 原版 JVM `buildOrbit`：Mandelbrot / Julia × 幂次 2、3、7 | 六组全部一致，每组 12 个状态的全部 Float32 比特匹配 | 原版参考轨道产生器；不包含原版 GL |
| 本机 Chrome / WebGL2：普通 Mandelbrot、普通 Julia、Mandelbrot 深缩放 1e8、Julia 深缩放、非整数幂 | 五组通过，保存实际 PNG、像素摘要和数值执行记录；包含原版 ULTRA 导入 | 实际生产导入、暂停运行时和 GPU 渲染边界 |
| 全部分形测试及旧格式导入测试 | 1038 / 1038 通过 | 数值、导入、时钟、着色、导航、录制协议及错误边界 |
| TypeScript、Git diff 空白检查 | 通过 | 源码类型和修改格式 |

原版参考方法在 Temurin 21.0.7 上执行原始 MathArt 1.7.8 类；不启动应用，不访问设置、许可证或策略服务。原始 JAR SHA256 为 `a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018`。

可复现材料：

- [原版 JVM 探针及固定结果](../tests/fixtures/source-fractal-power-reference/README.md)
- [生产边界测试](../tests/source-fractal-power.test.ts)
- [真实 WebGL2 验证脚本](../scripts/verify-source-fractal-power.mjs)
- 本地完整记录：`.cache/source-fractal-power-20261022/`，最终 GPU 结果位于 `final-runtime/report.json`，测试记录位于 `passing-tests.json`。

## 实际页面操作复验

最终 `npm run build:v2` 成功后，真实页面导入原版随附 `Fractal/mandelbrot.json`，仅显式添加 500 × 600 输出尺寸，保留原数值参数和 ULTRA。页面正常呈现，PNG 下载成功，无页面异常。PNG SHA256 为 `9cd63c595850ea6d19b6299d9801e2690768711233d998f3265471d6f8c3d2da`。

另一次真实页面流程点选 Julia 种子、刷新页面、再次导出；刷新前后源公式对象完全相同，PNG 下载成功且无页面异常，SHA256 为 `649e4c92fc19af80aac23489c6186247ca737dac2936304733f2339bc3279778`。完整记录在 `.cache/native-reference-progress-20261022/fractal-after/` 和 `fractal-julia-flow/`。这验证了 UI 到源配置对象及 GPU 的实际链路；没有把本地 PNG 当作原版像素一致证据。

本批分形没有可比的修改前后完成任务时间／CPU／进程族 RSS 测量；GPU 回传的工作计数和缓冲估计不能替代这些成本。冷暖缓存及完整 agent token 成本未测量，不宣称性能提升。

## 旧测试覆盖如何保留

旧测试中有一组将独立缩放回调的任意进度值当作完整场景时间。原版完整场景会在首帧执行更新，两者不能共用预期。这组固定向量继续通过保留的 Phoenix 混合导入通道检验旧的独立缩放适配器；完整 Mandelbrot 则通过源时钟、源配置和新的生产边界测试验证。

DE 和颜色测试改为检查源着色对象及实际上传计划，仍覆盖默认值、非数值输入、错误容器、容量拒绝和保存重开。旧本地数值、中心低位及旧颜色文档测试保留。Newton / Nova 的旧 shader 基线仍通过固定摘要验证：只允许新增的幂次分派和逃逸标记，原有数值与着色主体不变。

## 尚未证明

尚未完成原版 Mandelbrot / Julia 的相同逐帧历史、相同暂停导出生命周期下的全图像素比较，也未完成 Fractal 全公式覆盖。上述五组本机图像不能代替原版应用整图证据；本报告不将任何 Fractal 家族计为验收通过。
