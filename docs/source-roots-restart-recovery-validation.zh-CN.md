# Roots 工具栏重播与非法 Apply 恢复验收

2026-10-27 最新点云证据见[完整终点对照与差异定位](source-roots-point-cloud-reference.zh-CN.md)：当前 WebGL 仍有整图差异，现有 CGL 同顺序零差异诊断尚未接入产品。下文保留本批原有验收范围。

本批补齐[此前 Roots 界面验收](source-roots-control-ui.zh-CN.md)明确留出的两个实际 App 流程：工具栏从已 Apply 配置重播，以及非法数学 Apply 后保留旧预览、修复并重新应用。最终 density、point-cloud 两模式共 **121 项检查通过**。这只关闭这两个有限界面子项，整体仍在 M3；不代表 Roots 原版整图一致性或长期、多 Worker 验收完成。

运行基线为 `c9e308b30416d0e87ecc0a6e65bf189bb76d5387` 加本批工作树修复，精确来源及本地报告摘要见[证据索引](../tests/fixtures/source-roots-controls/restart-recovery-20261025.json)。原版依据沿用此前固定 MathArt 1.7.8 JAR 的静态控制流；**本批未执行原版 JVM、原版窗口或新增原版图像对照**。本地验收使用独立隐藏 Chrome、公共控件、实际 App、GenerationQueue、生产生成/计算 Worker 和 WebGL，没有操作桌面窗口。

## 首轮真实缺陷与修复

首轮 `run-1` 的 density 两流程通过；point-cloud 工具栏重播失败，共 86 项检查已通过。真实顺序是：独立 `setRootsPaused(true)` 完成，随后 restart revision 7 以 `paused:true` 成功建立新采样实例，下一帧却以 `paused:false` 发出且没有独立恢复操作。Worker 返回“场景 暂停状态变化必须通过独立 setPaused 操作”，页面显示计算失败。最后成功帧只有 0 samples，不能解释为验证器遗漏了一个已完成帧。

根因是 Timeline 把一个“返回起点”动作拆成异步暂停与 seek；Roots seek 又恢复播放并清掉 App 的 transition ticket。清 ticket 没有取消队列持有的暂停操作，其 ACK 仍按正常规则把同会话待执行的 restart 规范化成暂停状态。

修复让 [Timeline](../src/components/Timeline.tsx) 只发一个必选 `onRestart`，由 [App](../src/App.tsx) 决定场景策略。Roots 复用原有 seek/restart owner，普通场景保持原有暂停后 seek；真正未完成 pause/resume 时，Roots 工具栏和 Inspector 共用的 seek 明确提示等待，不提交重播，也不清除未完成操作的所有权。[GenerationQueue](../src/engine/generationQueue.ts) 的 ACK 规则与 HostClock 校验保持原样。

首轮报告、错误现场和原验证器全部保留。最终 `run-2` 使用同一验证器及断言，没有为通过验收调整产品像素、加入等待补偿或放宽检查。

## 实际通过范围

固定单计算 Worker、256 次采样、512 个根、480×360 目标，分别从 density 和 point-cloud 开始。

| 操作 | 已观察到的结果 |
| --- | --- |
| Apply A 后暂存模式、相机和时间线，热改色板/亮度 B，再点击工具栏重播 | 整个重播 wire 只有 generate、clock 始终为 running；一次 restart 保留控制会话并增加一个采样实例/pool；有效 presentation、LUT、tone、完整 Worker RGBA 与实际画布都恢复 A |
| 重播后检查作者 | 完整导出作者 JSON、暂存配置、未提交数学文本和 staged 提示保留；热修改没有被误记为已 Apply 配置 |
| 真实数学文本框输入 `???` 并 Apply | 形状检查允许提交，实际生产 Worker 拒绝，客户端收到 `RootsLiveGenerationError.previewRetained=true`；旧回执、采样实例、pool 和完整可见画布保持，作者中的无效文本可继续编辑 |
| 修复表达式并再次 Apply | 建立新控制会话，初始回执为 `{revision:1,applyRevision:1,resetRevision:1}`；作者中的 B 与此前暂存配置完整生效，错误消失并完成新画面 |

每模式保存 A、hot B、重播 A、非法 Apply 保留、修复 B 五份实际画布 PNG 和五份整页截图，共 **20 张 PNG**。画布通过现有 canvas 读取，未重新生成参考图；每模式 baseline、重播和被拒绝 Apply 的完整画布 RGBA 摘要相同。整页截图另确认错误卡片与保留图像同时可见、修复后错误消失。

最终运行耗时 **19.589 秒**，使用 Node 24.18.0、Chrome 155.0.8059.85；583 个来源文件运行前后摘要相同，无未处理 page error。两个 context 中观察到的 Workers 均清零，browser、Vite、export-service 关闭全部成功，所属服务进程为零。这里只记录完成工作流耗时，没有测量本批 CPU 时间、峰值 RSS、GPU 时间或 agent tokens，也不宣称性能改善。

## CPU 检查与独立失败说明

相关 14 文件 **137 项通过**，含新增 7 项公开工具栏回调检查；改到的 Attractor Timeline 静态渲染用例另为 1 通过、6 未选。`tsc --noEmit` 和 `git diff --check` 通过。单元检查不替代上述真实 App 结果。

完整 `source-attractor-controls.test.tsx` 另有一项既有失败：测试直接执行色板子组件，但仅替换 `useState`，缺少组件所需的 `useRef` 替身。将 HEAD 原测试复制到缓存、只调整 import 路径后，独立运行同样是 6 通过、1 失败；本批未修改该无关测试逻辑。它不是非法 Roots Apply 的预期错误，也没有被计入通过数。机器化 CPU 报告与基线测试副本均绑定在证据索引中；类型检查的成功来自本次工具执行结果，未另存完整日志。

## 可重跑入口与限制

在 studio 工作目录，使用固定工具链运行，输出目录须尚不存在：

```sh
PATH="$PWD/../.cache/local-toolchain/node_modules/.bin:$PATH" node .cache/roots-control-final-ui-20261025/verify-app.mjs .cache/roots-control-final-ui-20261025/run-new
```

本轮从暂停的完整画面发起 toolbar restart；没有另行延迟 ACK 注入，也未实测独立 pause/resume 正在进行时点击 Inspector restart。对此的拒绝保护是明确的源码边界，不能写成已覆盖交错输入。多 Worker 到达顺序、长动画、录制/视频、任意尺寸截图、原版匹配整图和最终集成发行仍不在这次有限矩阵内。已安装的 1.0 应用未更新。
