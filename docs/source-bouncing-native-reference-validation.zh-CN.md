# 弹跳场景原生参考路径核对

2026-10-22。首次执行了原版 `Bouncing/bouncing1.json` 的完整暂停场景，保持作者请求的 **200 万粒子**。原生初态纹理前 16 个粒子的全部 64 个 Float32 分量与生产采样器逐位一致；但离屏图只显示边界和正常水印，没有显示粒子。该原生输出尚不能作为弹跳整图验收基准，未据此修改产品绘制或初始化规则。

## 实际运行与范围

复用已在 Cornucopia 与原版真实窗口逐字节校准的正常 macOS Toolkit / 原版随包 JVM 宿主，调用原版 `reloadConfig`、`initScene`、`Scene.runFrame(buffer,true)`、增强与 PNG 方法。主视口为逻辑 405 × 486、密度 2，输出缓冲为逻辑 250 × 300，实际 500 × 600。Cornucopia 的校准不自动适用于弹跳专用 GPU 绘制。

原输入未改写；原版 FREE 许可、正常策略检查与水印保留。共执行三个有界诊断，每次均在正常策略缓存刷新前备份。设置文件 SHA 未变，许可证文件始终不存在。所有运行 exit 0、stderr 空，GL 错误及 AWT Window 对象均为 0，进程组均已回收；未激活应用或操作主屏。

| 运行 | 目的 | 耗时 | 结果 |
| --- | --- | ---: | --- |
| 初始暂停场景 | 原方法连续暂停绘制三次 | 7.116 秒 | 边界和水印可见，粒子不可见 |
| 提前初始化控制 | 进入输出缓冲前调用原 GPU 对象 `ensureInitialized` | 8.027 秒 | 仍无粒子；排除该单独顺序改变即可修复的假设 |
| 状态读取 | 原绘制后读取程序 uniforms 与初态纹理前 16 点 | 8.312 秒 | 初态非零、参数有效；完整 raw PNG 摘要未改变 |

状态读取仅临时绑定已有 read framebuffer 并恢复原绑定，没有修改粒子、shader、uniform 或输入。观察到粒子数 2,000,000、状态纹理边长 1,415、点半径 uniform 约 0.771605（shader 自身下限为 1）、速度倍率 5、六色调色板及有效投影/模型矩阵。不能仅凭这些事后读数推断实际 draw 的全部 GL 状态正确。

原版初始与诊断 raw PNG SHA-256 为 `b0129102ec7d4be9d29cef2efe216720265a2068568f7a6bd68a280f5e998d00`；增强图为 `a3315f2f1799fa481ed4f149dd0fc5bdf908d83c7c282b814a7027a336711f65`。

## 本地公开流程与初态核对

实际构建页面导入同一原文件，暂停初态导出 500 × 600 PNG，无页面错误，图中可见螺旋粒子及边界。浏览器使用 ANGLE 程序缓存禁用设置。下载图 SHA-256 为 `12d3ff555fd9aab9bf632afe4456b6edca4eafdc55bc7e6e2cd91acc1c909943`；它证明实际本地流程能够输出图像，不证明原版一致。

生产 `createSourceBouncingSeedStream` 消费原文件解析出的完整 200 万配置，只抽取头 16 点进行诊断。与原生纹理前 16 点比较，64 个分量逐位相同。没有降低原运行粒子数，也没有将此小样本外推为完整数组一致。

精简原生证据见 [初态与 uniforms](../tests/fixtures/source-bouncing-native/initial-prefix.json)。完整本地记录在 `.cache/bouncing-native-reference-20261022/`：`native-bouncing/`、`preinitialized/`、`draw-state/` 保存原生运行，`product-baseline/` 保存实际页面导出，`seed-prefix-comparison.json` 保存逐位比较。原版二进制与图片未入库。

## 尚待验证

下一步需在原粒子 draw 调用处捕获 framebuffer、viewport、VAO、纹理和 raster 状态，并核对正常窗口生命周期。当前无法确定不可见粒子来自宿主未建立的绘图状态、原版行为还是驱动差异；不应把空粒子参考误作产品期望输出。动画及整类验收仍未完成。未测量这些运行的 CPU、进程族峰值内存或 GPU 时间，不作性能声明。
