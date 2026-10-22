# 隐式曲面的原版保留线条与导出密度验证

后续已修复静态 PNG 漏接增强步骤，固定中心误差进一步降到 0.025299；见[静态 PNG 增强验证](source-implicit-static-png-validation.zh-CN.md)。以下保留该修复之前的线条与密度证据。

2026-10-22。原版 `implicit_sphere.json` 的曲面网格和两轴切片坐标此前已经完整匹配，本次修复了线条的绘制方式，以及导出时丢失预览像素密度的问题。实际 500 × 600 PNG 的固定中心区域 RGB 平均绝对误差从 **1.933991 降至 0.846823**。这仍不是整图像素一致；全家族整图验收保持 **0/11**。

## 原因与修复

原版 `ImplicitSurface.buildWireframeShape` 创建 `PShape(LINES)`。实际运行确认其 `TessGeometry.renderMode=1`、形状自身矩阵为空，保留世界坐标和 Float32 端点差，半线宽为 `±0.34`；显示相机矩阵由 GPU 着色器应用。先前产品复用了 immediate 线条路径，在 CPU 预先变换端点、方向，并将线宽乘显示矩阵缩放。这两种路径的运算和资源归属不同。

新增 `sourceProcessingRetainedLine.ts` 负责原版保留线条的数据。`sourceProcessingLineRenderer.ts` 显式区分 retained 与 immediate，原有立即绘制消费者继续使用原路径。隐式曲面选择 retained，保留每段四顶点、六索引和原顺序；没有连接、过滤或合并相邻线段。容量检查覆盖位置、索引、RGB、alpha 的实际 backing store，去重共享存储并在分配输出前计费；校验、展开和颜色写入分批检查取消。

实际导出还发现第二个独立问题：预览已交付密度为 2，但 `App` 传给导出对话框的密度只读取曲面点外观，遗漏隐式曲面外观。导出请求因此没有密度字段，生成端回落为 1。现在从同一已呈现文档的 `sourceImplicitPresentation.referencePixelDensity` 传递事实；缺少该事实时，源隐式 CPU 网格导出明确等待预览完成，不猜测当前屏幕密度。

## 原版与生产边界证据

原版只进行了一次受控离屏运行，使用正常 FREE 许可和原水印。7.935 秒结束，退出码 0，进程已回收且进程组不存在；窗口检查和 GL 错误检查均为 0。运行前备份了已有策略缓存；正常启动刷新了该缓存，用户设置摘要未变，许可证文件前后均不存在。

完整原始数组在本地 `.cache/implicit-retained-lines-20261022/native-implicit/`；受控仓库只保存 [摘要 fixture](../tests/fixtures/source-implicit-presentation/retained-lines.json)，包含应用/core JAR 摘要、完整数组哈希及实际 GL uniforms。原版输出包含 81,024 个展开顶点、121,536 个索引，三个索引缓存的顶点数为 32,764、32,764、15,496。

[生产边界回归](../tests/sourceProcessingRetainedLine.test.ts) 从实际 renderer 的实例属性展开数据，与原版全部位置、方向、RGBA 和按缓存偏移还原的索引比较，四项完整 SHA-256 均一致。该组件测试使用捕获的相机矩阵，因此不把它单独当作公共导出相机验证。

公共导出另行读取了真实 WebGL 状态：原版逻辑 viewport 为 250 × 300、buffer 密度为 2，半宽为 0.34；产品物理 viewport 为 500 × 600，半宽为 0.68，相关模型矩阵和投影距离项准确扩大两倍，`scale=0.999`、`perspective=0`。独立完整几何绘制原型分别使用这两种计划，输出 PNG 摘要同为 `7220a72bb87d77f3f2364271a4055a23936e4fc6b39711f28109a5915df1e885`，RGBA 不同像素为 0。该原型不含公式、原版水印或整图后处理，不构成全图一致声明。

## 实际导出结果

通过真实页面导入、匹配 Worker 完成消息、等待就绪和两帧动画回调，再使用导出对话框下载 500 × 600 PNG。最终预览及导出请求和交付外观的密度均为 2，无页面错误。原版参考图 SHA-256 为 `56f1833df3d77c0f4ba523c75424f4a211f906777e814ca593c14191cea301cb`。

| 阶段 | 整图 RGB MAE | 固定中心 RGB MAE | 中心 RGBA 不同像素 |
| --- | ---: | ---: | ---: |
| 修复前 | 3.357611 | 1.933991 | 64,753 |
| 仅切换 retained，导出仍缺密度 | 3.572446 | 2.295593 | 65,672 |
| retained 与交付密度均修正 | 2.710368 | 0.846823 | 61,900 |

中心区域始终为 `[55,55,445,510]`，没有为最终结果调整。原版水印保留在整图比较中；公式、叠加内容和剩余栅格化差异尚未全部一致。不能把所有剩余误差归因于单个已知因素。

最终 PNG SHA-256：`27f60935f0ce3ba7b23b479bea02b4000202f83c20891670af09a8c95291fadd`。本地 `comparison-final.json`、`comparison-final.png` 和 `product-final/report.json` 保存数值、并排图及实际 GL 读数。

可重复运行不依赖私有缓存输入的公共回归：

```sh
node scripts/verify-source-implicit-export.mjs .cache/source-implicit-public-export http://127.0.0.1:5179
```

该脚本使用仓库中的原始输入 fixture，检查预览和导出密度、匹配 Worker 响应、实际下载尺寸与页面错误；它不声称原版像素一致。本次脚本实际通过，输出摘要与上述最终 PNG 相同。

## 检查和成本

最终相关集成回归 **125 项通过**，最终 `build:v2` 通过；容量、取消收尾后另跑的四文件 **28 项通过**，`tsc --noEmit` 通过。公共页面回归也已执行通过。

相同输入、生成完成后的 `createSourceImplicitMesh` 创建及释放工作流，基线为提交 `805e698`，最终测量包含颜色存储计费与取消检查。两侧均为新 Node 进程，没有子进程；生成和导入不计入计时，RSS 是包含这些准备工作在内的进程累计高水位。

| 工作流 | 基线 elapsed / CPU | 最终 elapsed / CPU | 基线 / 最终峰值 RSS |
| --- | ---: | ---: | ---: |
| 新进程第一次 renderer | 31.26 / 51.06 ms | 24.08 / 36.09 ms | 200.16 / 198.51 MB |
| 热进程连续完成 20 次 | 382.06 / 413.17 ms | 260.27 / 336.39 ms | 210.98 / 210.19 MB |

这是单次受控测量，不保证普遍性能提升。没有测量 GL 上传/绘制、GPU 内存、清空 OS 缓存后的冷启动或 agent token 成本。完整脚本和记录位于本地 `performance-before.json`、`performance-final.json`；初版 `performance-current.json` 不代表最终容量/取消代码的成本。
