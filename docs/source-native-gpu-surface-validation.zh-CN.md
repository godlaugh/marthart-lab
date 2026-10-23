# GPU 曲面的原生截图验证

2026-10-23。GPU 曲面网格已接入有类型的绘图快照，实际暂停截图可以经过原生渲染服务完成。GPU 点阵也用真实原版参考重新验证。本次仍需显式构建选项 `VITE_SOURCE_RENDERER=native`；没有切换默认预览、录像或已安装应用。

## 改动与原因

`createSourceSurfaceGpuMesh` 原先直接创建 RawShaderMaterial，缺少参数类型所有者，原生快照按契约拒绝该材质。现在与其他源材质共用 `createSourceShaderMaterial`，在生产端声明矩阵、向量、整数开关和 32 项参数数组；两个后端读取同一份值，不从着色器字符串或 JavaScript 数组外观猜类型。

原先空的 `texMap` 由 Three 隐式绑定 1×1 透明黑纹理。现在每个填充／线框材质明确拥有一个相同内容的 RGBA8 纹理，材质释放时释放纹理，创建失败也会清理。纹理未启用时仍保留显式绑定；没有删除原版的着色器分支或改变运算。纹理内容恒定，过滤差别不影响取样值。两个绘制通道合计新增 8 字节纹理像素，不包含驱动对象开销。

## 实际参考与结果

使用原版 MathArt 1.7.8，JAR SHA-256 为 `a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018`。从 Cornucopia、Sphere、MöbiusStrip 配置各复制一份，只将 `settings.render_mode` 从 CPU 改成 GPU；原始文件未改。派生关系记录在本地 `reference/input-derivation.json`。

| GPU 输入 | 实际暂停截图，500×600 完整艺术画面 | 真实界面导出 |
| --- | ---: | --- |
| Cornucopia 点阵 | 0 个不同像素 | 两次 PNG 相同 |
| Sphere 点阵 | 0 | 两次 PNG 相同 |
| MöbiusStrip 网格及线框 | 0 | 两次 PNG 相同，取消后恢复成功 |

暂停截图经过实际 Generator、Worker、原生 HTTP 服务、CGL 和公式合成。艺术画面包含启用的主方程，原版品牌叠加层仍单独比较，未将其剔除后的相同扩大为最终文件字节一致。来源、程序及参考摘要稳定，受管服务进程清理后为 0。

另外显式请求原版 `smooth(4)`，确认实际 `GL_SAMPLES=4` 后，三例各绘制阶段及完整艺术画面与本地原生绘制同样零差异。该检查证明显式 4 倍采样条件下的结果，不证明原版主窗口默认设置，也不代表产品预览已切换到原生通道。

UI 检查运行实际 App 的导入和导出控件，确认交付预览仍携带 GPU 点阵／GPU 网格数据；没有转成 CPU 几何来通过截图。Möbius 的一次帧请求被延迟，点击取消后不交付迟到结果，之后重试成功，PNG 与取消前相同。这是传输故障注入，不能据此推断原版事件速率。

## 参考采集修正

第一次 GPU 网格比较报告了 33,941 个不同像素。检查原始 GL 记录发现，旧诊断把存在 `texMap` 当作开始绘制公式／品牌纹理的标志，而 GPU 网格程序本身也声明此参数，因此旧文件取到了网格绘制前的背景。

修复在参考采集端：以保留的 Processing 叠加程序同时存在的 `texMap` 和 `transformMatrix` 确认阶段；数学网格使用 `transform`，不满足该条件。重新执行原版、重新采集后才进行最终对照。没有改比较容差或按残差挑像素。初次采集、错误比较与修正后的独立运行全部保留。

## 其他验证与范围

- 67 项相关测试通过，覆盖 GPU 场景生命周期、完整快照及二进制编码；新检查包括整数类型、32 项数组、独立快照和纹理释放。
- 28 组 GPU 网格 WebGL 绘制边界全部与保留的原版着色器零通道差异，包括透明度、参数动画、旋转、扭曲接缝、非有限公式和不同尺寸。这些共享几何的着色器检查不等同原版应用整图验证。
- 原生选项的 2.0 构建通过；保留已有大 chunk 提示。
- 所有原版采集在离屏诊断宿主运行，原版窗口检查始终为 0；界面检查使用后台 Chrome。

本轮实际三例截图整图验证耗时 26.87 秒，包含导入、生成、跨浏览器像素传输、公式和逐像素检查，不能换算成产品帧率。改动前 GPU 网格原生快照会被拒绝，缺少可完成的同路径基准。未测 agent token、完整任务 CPU、进程家族峰值、显存或严格冷／暖启动；不声称性能提升。

另用 `/usr/bin/time -l` 测量单独启动的 4 倍采样 CGL 诊断子进程：Möbius 墙钟 176ms、CPU 40ms、峰值 RSS 23.8MiB；Cornucopia 为 124ms、20ms、22.1MiB；Sphere 为 131ms、30ms、22.3MiB。包含启动及诊断文件写入，不包含完整浏览器任务，也不是持久会话帧延迟。

当前结论只覆盖这三个配置的初始暂停帧。连续动画、原生预览／录像接入、其余场景及 Apple Silicon 安装包验收仍待完成，Goal 保持进行中。

后续进展：[曲面原生录像接入验证](source-native-recording-validation.zh-CN.md) 已接通实际录像、取消和恢复流程；连续动画的原版逐帧整图对照及主预览仍待验收。

## 本地证据

证据根目录：`.cache/source-native-gpu-mesh-20261023/`。

- `reference/`、`actual-capture/`：初始采集和阶段识别错误记录。
- `reference-corrected/`：修正采集阶段后的原版运行、输入及摘要。
- `actual-capture-final/report.json`：实际暂停截图三例整图对照。
- `ui/report.json`：GPU 数据交付、下载重复性、取消和恢复。
- `reference-msaa/` 及 `.cache/surface-cgl-Rdx8Kc/report.json`：原版 4 倍采样参考、各绘制阶段及完整艺术画面对照，清理后的受管进程为 0。
- `tests.log`、`build.log`、`webgl-boundary.log`：执行过的测试、构建和 28 组绘图边界检查。

复跑实际截图：

```sh
VITE_SOURCE_RENDERER=native MATHART_SOURCE_RENDERER_BACKEND="$PWD/.cache/source-native-capture-20261023/backend.json" node scripts/verify-surface-native-reference.mjs .cache/source-native-gpu-mesh-20261023/reference-corrected .cache/source-native-gpu-mesh-20261023/recheck
MATHART_SOURCE_RENDERER_BACKEND="$PWD/.cache/source-native-capture-20261023/backend.json" node scripts/verify-source-native-capture-ui.mjs .cache/source-native-gpu-mesh-20261023/ui-recheck .cache/source-native-gpu-mesh-20261023/reference-corrected
```
