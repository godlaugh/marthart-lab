# 原生暂停截图接入与曲面网格修复

2026-10-23。源曲面的实际暂停截图流程现在可以使用原生渲染，覆盖界面按钮、生成队列、Worker、图形帧、本机服务和 PNG 下载。通过构建配置明确启用；默认构建和已安装应用尚未切换。原生服务失败会报错，不用 WebGL 图像替代成功结果。

## 效果验证

| 检查 | Cornucopia | Sphere | MöbiusStrip |
| --- | ---: | ---: | ---: |
| 原生暂停截图，500×600 完整艺术画面 | 0 个不同像素 | 0 | 0 |
| 原生 4 倍采样绘制，完整艺术画面 | 0 | 0 | **0** |
| 默认 WebGL 暂停截图，500×600 | 0 | 0 | 仍有 1 个像素不同 |
| 真实界面重复下载 PNG | 通过 | 通过 | 通过 |

原版参考来自固定 MathArt 1.7.8 原始配置和初始暂停帧，JAR SHA-256 为 `a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018`。完整艺术画面包括启用的主方程；不包含原版品牌叠加层。原版增强 PNG 的品牌差异仍单独保留，不能把艺术画面一致说成与原版最终文件逐字节相同。

4 倍采样参考为诊断宿主显式 `smooth(4)`、实际读回 `GL_SAMPLES=4` 的原版场景绘制，仍不证明原版主窗口默认采样设置。实际应用预览和录像还没有切换原生通道。

## 网格残差根因

上一次 4 倍采样下，Möbius 填充阶段有 121 个不同像素，加入线段后还剩 45 个。原版 Processing 为每个三角形提交独立顶点；本地 CPU 填充复用了采样网格顶点。按索引展开的坐标和颜色相同，仍不足以证明真实驱动的插值结果相同。

独立实验仅将绘图缓冲展开为连续三角形顶点，两个阶段的残差都变为零。生产修复因此放在 `createSourceSurfaceMeshFill`：保留 Worker 的数学采样网格与拓扑，在绘图边界生成自有的位置、颜色和连续索引。CPU 视图变换仍遵守原来的逐步 Float32 舍入；没有更改公式、颜色或比较容差。GPU 网格原本已有相同的顶点展开规则。

Möbius 填充的上传顶点从 636 个变为 3,240 个，位置、颜色和索引缓冲合计从 33,312 增至 116,640 字节。这是精确匹配带来的明确开销；原有最大索引数约束也限制了扩展后的分配。

## 截图与取消的所有权

- `Generator.captureSurfacePaused` 实际调用原生帧客户端，保留返回的后端身份、代次、序号和采样数。源图像仍处于“公式合成之前”的阶段，由原有编码器随后完成公式、增强和放大。
- 导出按钮的 AbortSignal 经过 App、GenerationQueue 到 Generator，再到原生请求。取消不再只阻止最后下载；已经发出的网络请求也会被中断。取消或无效化后的结果不能交付，重复的 Worker 准备响应会使该请求失效。
- 原生截图将调用者仍持有的预览、几何及后处理缓冲纳入编码器容量检查。没有把每层各自的预算当成整个操作的总预算。
- 截图和录像复用 `SourceDrawingResources` 管理离屏画布及 GL 上下文。材质释放与上下文释放分别记录完成状态，失败对象留在清理集合中，之后只重试未完成步骤。渲染和清理同时失败时，两项错误都保留。
- 删除截图调用端的一次重复绘制，使用 `setOutput` 已完成的绘制和原生帧所有者自己的渲染列表刷新。

## 实际界面检查

后台 Chrome 运行真实 App，每个原始 CPU 配置执行导入、选择当前暂停图、设置 500×600、导出 PNG、再次导出。下载图像解码后与实际交付的基础帧经公式和增强编码后的像素一致，重复文件摘要相同，数值场景时钟未推进。

Möbius 另将一次帧请求暂时拦住，点击界面“取消导出”，确认没有交付迟到截图；解除拦截后再次导出，文件与取消前相同。这是明确的传输故障注入，不是原版 UI 事件速率的证明。原生 HTTP/进程取消由已有真实 CGL 会话测试另行覆盖。

首次 UI 脚本误用按钮名 `Cancel`，在取消步骤超时；修正为实际标签 `Cancel export` 后，三个场景全部通过。失败记录保留，没有将超时算作通过。检查均未创建前台测试窗口。

## 验证范围与启用

10 个相关测试文件、142 项全部通过；`VITE_SOURCE_RENDERER=native npm run build:v2` 通过，仍有已有的大 chunk 提示。测试覆盖本机故障无 WebGL 替代、取消请求后恢复、失败清理保留、原始渲染错误保留、调用者缓冲预算、共享顶点展开及现有录像资源生命周期。模拟网络/GL 的测试仅证明边界语义；像素结论来自真实浏览器、真实原生进程与固定原版参考。

CPU 网格绘制另复验 13 组边界，包括透明度、零填充、旋转、正交投影、反向定义域和未使用的非有限顶点；与保留的 Processing 着色器及独立 Python Float32 视图变换相比，全部通道零差异。这项检查限定于绘制边界，不作为原版应用整图一致性的额外证明。

构建选择使用 `VITE_SOURCE_RENDERER=native`。本机服务仍需明确的 `MATHART_SOURCE_RENDERER_BACKEND` JSON 配置，包含辅助程序绝对路径和 SHA-256；公式服务使用 `MATHART_GLYPH_BACKEND`。配置缺失或辅助程序身份变化时，原生截图报错。

本地复跑实际截图及 UI：

```sh
VITE_SOURCE_RENDERER=native MATHART_SOURCE_RENDERER_BACKEND="$PWD/.cache/source-native-capture-20261023/backend.json" node scripts/verify-surface-native-reference.mjs .cache/surface-native-reference-20261023 .cache/source-native-capture-20261023/recheck
MATHART_SOURCE_RENDERER_BACKEND="$PWD/.cache/source-native-capture-20261023/backend.json" node scripts/verify-source-native-capture-ui.mjs .cache/source-native-capture-20261023/ui-recheck
```

当前集成只选择源曲面的“当前暂停截图”。预览、重播截图和录像选择仍待统一；GPU 网格等尚未纳入有类型绘制快照的材质会明确失败。不会将这次三个 CPU 配置的通过扩大为整个 2.0 或全部曲面模式验收。原生辅助程序也尚未打入正式安装包。

## 完成任务的开销

固定三个原始配置，对比提交 `1678695` 的截图和网格绘制实现与当前原生截图。每组均完成导入、真实 Worker 生成/截图、公式、PNG 编码及逐像素检查；表中不只是原生绘制调用。先首轮，再在同一验证进程和浏览器内重复三例。

| 输入 | 墙钟 ms，前→后 | 观察到的 CPU ms，前→后 | 家族采样峰值 MiB，前→后 |
| --- | ---: | ---: | ---: |
| cornucopia，首轮 | 9945.7→10059.4 | 16020→15870 | 2966.7→2400.3 |
| sphere，首轮 | 8009.9→8021.7 | 9830→9910 | 3400.6→2531.0 |
| mobius，首轮 | 7739.3→7938.0 | 9160→9360 | 3602.9→3290.4 |
| cornucopia，重复 | 7953.5→7947.8 | 9570→9740 | 3623.6→3310.2 |
| sphere，重复 | 7951.8→8078.3 | 9450→9490 | 3550.5→3417.0 |
| mobius，重复 | 7741.9→7821.1 | 9530→9580 | 3509.5→3328.1 |

前版两轮均保留 Möbius 的 1 像素残差；当前版六次完整艺术画面全为零差异。两组源码/参考稳定，清理后受管进程均为 0。没有清空系统/驱动缓存，首轮不等于严格冷启动；一组测量不足以主张普遍加速。

Node 根进程家族包含浏览器及可观察的字形/原生进程。250ms 加边界采样可能漏掉瞬时进程/峰值、重复计入共享页；CPU 有采样粒度限制。验证中的大像素数组传输和逐像素检查也计入，不能当作实际导出按钮延迟或产品帧率。GPU 时间、显存和 agent token 未测。完整数据及源摘要保存在 `.cache/source-native-capture-20261023/cost-comparison.json`。

## 本地证据

- `.cache/source-native-capture-20261023/cost-after-final/report.json`：最终代码实际 Generator 暂停截图与原版完整艺术画面对照，首轮/重复共六例。
- `.cache/source-native-capture-20261023/real-capture-final/report.json`：先前独立实际截图整图检查；随后去掉了调用端一次重复绘制，由上述最终六例复验。
- `.cache/source-native-capture-20261023/webgl-expanded/report.json`：默认 WebGL 路径仍有 1 像素残差的复核。
- `.cache/surface-cgl-2rbX6M/report.json`：三角形展开修复后的 4 倍采样零差异。
- `.cache/source-native-capture-20261023/ui-final/report.json`：真实界面、PNG 下载、取消和恢复。
- `.cache/v2-source-surface-mesh-fill.json`：13 组 CPU 网格绘制边界回归，历史记录已另存备份。
- `.cache/source-native-capture-20261023/expanded-mesh/`：仅改变提交顶点布局的独立定位实验。
- `.cache/source-native-capture-20261023/`：测试、构建、成本对比与历史失败日志。

下一步接通录像和实际预览，补齐其余材质，再完成其他场景、连续动画及 Apple Silicon 发行验收。Goal 继续保持进行中。
