# 复根真实原版参考：本轮验证范围与宿主限制

2026-10-22。本轮**没有取得可用于密度整图验收的原版参考**。原版进程正常退出、写出 PNG，并不能单独证明它走了目标渲染路径：第一次运行的密度纹理全零，实际画面符合原版的点绘制回退；第二次补充宿主主画布初始化，在场景创建之前遇到 GL 后缓冲恢复错误。本轮不据此修改产品算法，也不把不同提交量的两张图计算为“渲染误差”。

产品侧的独立证据是：同一个原始输入能通过真实导入器及 Worker 生成非空密度图，同一时间重复请求像素稳定；这不等于原版整图一致。

## 输入与执行边界

- 原版 MathArt 1.7.8，JAR SHA-256：`a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018`。
- 原始资源：`resources/data/ComplexRoots/Degree7_UnitCircle_T1T2_Formula30.json`，SHA-256：`747e02d2d7ba8eae5ed6c4fe44a1774b886a25ba0937c48c75cf108e1dbdf9d5`。
- 保留原输入的 `sample_count=47,550,000`、`batch_size=32,256`、`seed=0`、七次多项式、颜色、空间参数及时间线。没有降低样本量以制造完成状态。
- 主画布逻辑尺寸 405×486、density 2；目标逻辑尺寸 250×300、density 2，即物理 500×600。
- 复用已校准的 owned staged-loader 后台 JVM；JOGL 实际选择 GL4、硬件 FBO offscreen drawable。没有打开或操作主屏窗口，所有窗口检查均为 0。
- 每次都经过原版许可初始化、策略正常刷新，并检查 VIEW/RUN/EXPORT 允许。FREE 水印保留；原始 Scene、着色器及许可逻辑未修改。
- 策略缓存写入前备份；settings 的前后 SHA 相同，license.dat 前后均不存在。策略文件的变化来自原版正常远端刷新。
- 启动器拥有独立进程组，期限 55 秒；两次均已 wait/reap，收尾进程组不存在，没有触发超时。

## 为什么同一时间、同一种子不能直接定义参考图

原版 `ComplexRootsMobject` 构造函数即启动工作线程。`update` 和 `display` 会从队列接收批次，`displayDensity` 再按待绘制预算消费点。暂停场景时钟并不会冻结后台求根及批次到达。

本机原版实际创建 4 个工作线程；产品导入器明确告知源文件未指定的机器默认值无法恢复，本地采用 1 个逻辑工作器和确定性 ordinal 顺序。产品还明确暴露固定样本时钟、批次发布、待绘制队列及累计点数。这些事实不能仅用“seed 相同”消除。

因此，下一张有效参考必须同时绑定真实提交的 VBO、矩阵、点径、累计点数、密度纹理和最终画面；重放同一批真实输入，才能先隔离呈现层。不同线程到达量的图不能作为精确像素对照。

## 第一次原版运行：PNG 有内容，但密度参考无效

证据目录：`.cache/roots-native-reference-20261022/native-roots/`。

运行 8.889 秒，exit 0，stderr 空。执行三次原版 `runFrame(buffer, true)`，场景时钟保持 0；原版最终增强方法也正常写出 PNG。

| 暂停帧 | 已接收样本 | pending 点数 | densityPointsRendered | 捕获 splat draw | 密度纹理总质量 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 0 | 0 | 0 | 0 | 0 | 0 |
| 1 | 55,296 | 387,072 | 0 | 0 | 0 |
| 2 | 110,592 | 774,144 | 0 | 0 | 0 |

三张原始 PNG 的非黑 RGB 像素分别为 7,067、41,311、50,361，包含正常水印。画面中出现越来越多的彩色点，同时密度纹理始终全零，这符合原版 `displayDensity` 捕获异常后调用 `displayPointsDebug` 的回退路径。

**观测与推断边界：**“密度纹理零、无 splat 提交、画面出现点”是直接观测；回退路径由字节码及这些观测共同支持。第一次探针未记录 `densityShaderFailed`，原版又吞掉了该层异常，因此不能声称已捕获首次回退的确切异常。

最终原始 PNG SHA-256：`b6f0f49185ee0e9314c5dd1b65bb9aeb284b61d7f1e8add9ffb25c3939743304`；增强 PNG：`04683faf33030d214f240b83f0c53238431f7699bbee7a6bc7666b79ad8093cc`。这些文件保留为失败诊断，不能晋升为密度验收 golden。

## 第二次原版运行：主画布初始化暴露宿主契约缺口

证据目录：`.cache/roots-native-reference-20261022/initialized-primary/native-roots/`。

仅在宿主补充 `primary.beginDraw()/endDraw()`，并增加被动 GL 异常记录和回退状态检查；原版输入及渲染代码不变。运行 6.486 秒，exit 2，没有生成新的场景 PNG。

实际致命链路为：

```text
MathArt.initScene
  → PGraphicsOpenGL.endPGL
  → PGraphicsOpenGL.restoreGL
  → PJOGL.drawBuffer
  → glDrawBuffer(GL_BACK = 0x405)
  → GL_INVALID_OPERATION (1282)
```

该错误发生在 FBO offscreen 宿主恢复主画布状态时，最终 `currentScene` 为空。日志另有 PJOGL 探测 `getGL2()` 时的异常，不能将它与上述致命错误混为一谈。

本轮没有把 `GL_BACK` 热替换成 `COLOR_ATTACHMENT0`，也没有继续无界尝试。这次失败尚不能解释第一次被原版吞掉的全部异常，更不能据此认定正常原版 GUI 存在同样故障。

## 产品独立验证：真实导入、Worker、批次发布与暖重复

证据：`.cache/roots-native-reference-20261022/product.mjs`、`product-report.json`、`product-frame-0.png` 至 `product-frame-3.png`。

真实 Chrome headless，启用 `--enable-angle-features=disableProgramCaching`。调用生产 `parseLegacyScene` 的 runtime-config 入口及真实 `Generator` Worker，目标尺寸与上述宿主一致。没有替换求根器、修改样本数或伪造完成状态。共 2.126 秒，浏览器、Worker、Vite 均已释放。

| 请求时间 | 已尝试样本 | 生产出的根 | 已提交密度点 | 非黑 RGB 像素 | 同时间重复 |
| --- | ---: | ---: | ---: | ---: | --- |
| 0 秒 | 128 | 896 | 0 | 0 | RGBA 字节相同，不重求根 |
| 1.2 秒 | 4,736 | 33,152 | 32,256 | 13,884 | RGBA 字节相同，不重求根 |

0 秒尚不足一个原始批次，896 个根仍在 builder 中，因此返回黑色密度帧；这是本轮实际观察到的初始帧行为，不应把“成功返回 raster”写成“初始画面非空”。到 1.2 秒，完整批次发布后出现非空图像。产品报告仍为 `complete=false`，没有完成 47.55M 样本。

产品固定回放时间线在请求 0、1.2 秒分别报告 sceneTime 为 `0.0333333351`、`1.2333334684`，与上述原版暂停 sceneTime 0 不是相同状态。1.2 秒生产 RGBA SHA-256：`dba71f825c6b3208e29d2505952f6ea0f851daba6d15c2ab4c046c947081765d`；保存的 PNG SHA-256：`3b48dfd0109c9032f580284f33fad96df981a1180a39bedb6b8f3c4a36402c8a`。

这里验证的是运行中的生产边界，不包含 App 公开 UI、完整静态 PNG 后处理、录像、全部原始样本完成或原版密度像素一致。产品和原版的图像具有不同队列状态、时钟及渲染路径，故本轮不报告两者像素差作为算法结论。

## 后续可执行路径

1. 正常虚拟屏上的原版 onscreen 窗口，或先确认 JOGL pbuffer 与 FBO offscreen 的默认 draw-buffer 契约，再选择契约匹配的宿主。
2. 先证明没有触发 `densityShaderFailed`，捕获非空 splat 提交，并校准真实原图；保留正常许可与水印。
3. 只读捕获实际 VBO、属性、矩阵、点径、累计密度及呈现参数；用相同输入独立重放生产呈现层。
4. 呈现层校准后，再单独验证求根输出、线程分区及批次到达。继续保留“数学数值通过”“呈现重放通过”和“公开整图通过”的区别。

缓存中的 `artifact-sha256.json` 保留本轮产物摘要；这些是运行后的产物校验，不冒充执行前后的源码稳定性证明。大缓存、应用包及 PNG 不进入 Git。本轮只增加此中文记录，没有产品代码改动。
