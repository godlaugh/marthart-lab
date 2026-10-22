# 原版场景离屏参考验证

2026-10-22。已在不启动应用窗口的情况下，实际执行原版 Cornucopia 的场景初始化、暂停帧绘制、像素回读和 PNG 增强。它提供了继续验证的可行路径，但当前只在固定公式和几何区域与既有原版窗口输出完全一致，尚不证明完整参考图或所有场景都可靠。

## 已打通的路径

使用原版 MathArt 1.7.8 随包 JAR、Processing 4.5.0、JOGL 2.5.0，以及此前已有的独立 Temurin 21.0.7。GL 为 Apple M2 Max 的 OpenGL 4.1 Metal 90.5，drawable 实际为离屏 FBO。

实际调用原版 `MathArt.reloadConfig` → `initScene` → `Scene.runFrame(buffer, true)` → `buildEnhancedImage` → `writePng`。没有替换这些方法，也没有以本地重建的场景生成“原版参考”。当前主画布逻辑尺寸 405 × 486、像素密度 2；输出缓冲区逻辑尺寸 250 × 300、实际像素 500 × 600。

原版许可通过正常 `LicenseManager.init` 读取真实本机状态，结果为 FREE；场景政策通过正常 `refreshAtStartup` 获取并验证远程政策，Cornucopia 的 VIEW、RUN、EXPORT 均允许。原版水印和正常限制保持生效，受限场景的本地化提示也在宿主中初始化。当前场景非受限场景，不能用本次结果证明受限提示已经显示正确。

正常启动刷新了原版的 `scene_access_policies_cache.json`，各次运行前已备份。`settings/settings.conf` 摘要未变，`license.dat` 原本不存在，运行后仍未创建。未更改系统权限或现有应用包。

## 两个宿主问题及修复

最早简单图形探针虽然读出了正确像素，但 Processing 报 GL1282。DebugGL 逐调用检查确定：窗口主画布会以 `GL_BACK` 读取或恢复离屏 FBO，这是不合法的缓冲区组合。最终主画布只持有正常上下文和资源；实际绘制、回读使用原版非主 `PGraphics3D`，并给该缓冲区绑定实际 drawable 能力。没有吞掉 GL 错误或覆盖渲染器方法。

干净的 500 × 600 两帧探针通过，颜色与像素摘要符合预期，全部 GL 检查为 0，stderr 为空。`initScene` 的 GL 重置片段也单独验证通过。

首次完整 Scene 仍因 `sketchPath` 未初始化而加载静态 shader 失败；该次结果仅作早期诊断。随后使用原版公开 `sketchPath()` 初始化宿主路径，原版日志确认 CPU 静态 shader 加载成功，924 个点构造完成，完整场景绘制和增强各阶段 GL 均为 0。

完整场景运行仍有一条 JRSAppKitAWT daemon 初始化提示，因此不宣称 JVM 的所有 AWT 子系统都完全 headless；测试没有创建 PApplet/Compose 应用窗口，实际绘图目标是已核实的离屏 FBO。运行后场景、缓冲区、主渲染器、drawable、GLProfile 按顺序释放，JVM 已回收且进程组不存在。

## 与既有真实窗口 PNG 比较

原版窗口图片为此前实际保存的 Cornucopia，500 × 600，暂停 Apply 后时间 0。它含免费水印和调试文字。

| 对照范围 | 离屏原版与窗口原版 |
|---|---:|
| 固定公式 `[190,555,300,585]`，3,300 像素 | RGBA 零差异 |
| 固定几何 `[300,180,450,450]`，40,500 像素 | RGBA 零差异 |
| 打开原版调试叠加后的完整 300,000 像素 | 24,804 个差异像素；最大差 255，平均 RGB 差 7.9554344 |

调试关闭的原版离屏 PNG SHA-256：`92bff05b58eba69df0d6b45074fe3c098fe9b2dfc010e380217eb46eaeff813b`。

调试打开的原版离屏 PNG SHA-256：`924e03669fe2b8c59ef13911378c868d25ef6a71f03471c9a4b4f687f8602757`。

仍须定位整图差异，不能因两个区域相同就将该方法标为原版 GUI 的完整替代。此实验也未验证真实窗口时钟、交互、其他家族或原版视频输出。

后续两个实验排除了具体疑点：同一原版场景连续三次暂停绘制，三张增强 PNG 逐字节相同；改用应用随包的原版 JVM，通过 JNI 调用同一离屏类，三张结果也与 Temurin 版本逐字节相同。原 JVM 运行 stderr 为空，GL 检查全为 0，`DestroyJavaVM` 成功且进程组已回收。因此本次整图差异不能归因于首次字体缓存尚未准备好，或这两个 JVM 二进制版本不同。

原版 JVM 的独立文字度量探针发现了真实环境差异：相同 ProcessingSansPro 字体与原版 `PJOGL.getTextWidth`，HeadlessToolkit 的 24px 水印整串宽度为 258，macOS LWCToolkit 为 261；12px 调试行的逐字宽度总和也有差异。两次探针均未创建窗口，没有 GL 或许可调用，正常退出并清理。它是结果相关边界的实证，尚不足以解释全部整图差异。

最后尝试只将完整原版离屏运行改为正常 Toolkit，并设置 `apple.awt.UIElement=true`。入口及正常许可／政策初始化后，记录的窗口对象数和可见窗口数均为 0。随后停在 JOGL 初始化／离屏 drawable 创建区间，55 秒内未产生 GL 阶段输出或 PNG。TERM 后仍未退出，3 秒后对本次拥有的进程组执行 KILL；已回收且进程组不存在。该次不算通过，也未继续启动窗口重试。精确阻塞调用和正常 Toolkit 与离屏图形线程之间的协调仍待定位。

公式剩余六个像素已经通过本次原始帧独立复核，来源是原版水印阴影与后处理，详见[公式居中与采样验收](source-formula-centering-validation.zh-CN.md)。

## 证据与后续

私有缓存 `native-offscreen-reference-20261022/processing-clean/` 保留干净基础探针、失败反例、原版 class/JAR 摘要、精确编译运行参数与清理记录。`full-scene/sketchpath-initialized/` 为修复资源路径后的完整原版场景，`full-scene/debug-overlay-reference/` 为带调试叠加的参考尝试；`full-scene/run.py` 为有 55 秒上限、子进程组清理和原版政策缓存备份的执行器。原始输入和原版 JAR 未修改。

修复路径后的完整 Scene 探针约 6.60 秒，带调试叠加的另一次约 9.81 秒，均包含正常政策刷新与 JVM 冷启动。未测量 CPU 时间、进程族峰值内存和整个任务 token 成本，不作性能提升结论。

下一步先定位正常 Toolkit 下 JOGL 初始化的阻塞，再完成离屏与窗口原版整图比较，并将验证过的方法用于其他场景和匹配时钟的动画帧。MathArt Lab 的整图验收仍为 **0/11**，Goal 保持进行中。
