# 曲面录制状态管理与导入验收

2026-10-22，开发分支 `codex/v2-scenes-parity`。

本轮完成曲面录制的连续状态管理，以及空时间线 CPU 点曲面的导入修复。**录制尚未接入 Worker、客户端、录制按钮和 FFmpeg，不能按端到端视频导出验收。2.0 Goal 仍在进行，原版整窗效果一致性仍为 0/11。**

## 实现与使用影响

新录制会话从上次完整应用的配置重新构建曲面，忽略随后未应用的草稿、直接参数修改及暂停导航，保留草稿供停止后继续编辑。首个更新生成预热图，不计入编码帧；后续按导出帧率推进模拟，但参数动画继续使用独立传入的实际帧率。录制由动画队列完成状态决定结束，空队列和短于一步的等待因此只有预热图。

停止保留最终曲面与相机状态，只重置一次墙钟，随后可以继续播放。几何输出失败时保留已经消费的更新；重试必须使用相同帧序号和实际帧率，避免重复推进动画。停止的重试同样不重复更新或重置时间。录制取消后仍能执行停止清理；数值更新本身失败则作废该会话，需要重新应用。

原版项目导入此前只有在时间线包含某些动作时才选择源 CPU 点模型，因此空时间线、仅等待等项目落入旧的本地模型。现在完整原版项目直接选择源模型。旧的 runtime-config 兼容入口和已经保存的 MathArt Lab 本地文档继续使用原有语义，没有自动迁移。真实界面已验证新导入项目可以播放、修改参数、暂停导航、保存当前 PNG 和重新应用。

## 验证结果

| 范围 | 实际结果 |
| --- | --- |
| 新原版 CPU 录制轨迹 | 6 个案例、24 次更新，独立执行两次完全一致 |
| 原版既有轨迹复验 | 133 次场景更新、90 次参数编辑；每套执行两次，完整 actual 数据与既有样本一致 |
| 相关自动化测试 | 36 个文件，748/748 通过 |
| 实际浏览器渲染 | 16 组组合重复两遍，32/32 通过；CPU 点/网格/切换、GPU 点/网格，像素密度 1 和 2 |
| 实际 App 操作 | 原有 CPU/GPU × 点/网格 4 例，加 CPU 空时间线、仅等待 2 例，共 6/6 通过；下载并解码 12 张 PNG |
| 构建 | TypeScript 和 Vite 通过；仍有既有资源包体积提示 |

原版数值对照直接调用 bundled JVM 内的 Scene.setRenderMode、Scene.update、isAutoRecordingComplete、disableRenderMode。比较场景时间、步长、队列、相机、模式、参数和 CPU 点坐标；网格首顶点由原版函数值推导，不能视为原版网格渲染对照。有限的 0 或负实际帧率保留给原版参数动画规则处理，没有替换为模拟帧率。

浏览器检查实际 GL 绘制、像素回读、3 倍离屏尺寸及密度取整、停止后的主预览、重复停止像素稳定性与恢复时钟。最初“只有背景”的失败分别来自测试图形超出小视口，以及模式切换的全遮罩帧。前者调整测试图形比例；后者对照原版 overlayAlpha=1，要求实际输出为全覆盖图，其余帧仍要求可见内容，未删除可见性检查。

错误测试覆盖尺寸/帧率预检、错误句柄和帧序号、并发控制、预热失败保留旧预览、更新后几何失败重试、停止失败重试、取消前不更新及更新后取消仍保留最终状态。几何失败通过故障注入模拟，不代表实际 GPU 故障恢复已经验收。

## 性能与限制

32 组浏览器任务总墙钟约 2.60 秒；进程族采样累计 CPU 约 5.01 秒，采样峰值 RSS 约 1,484 MiB，7 次采样。CPU 是多进程累计时间，峰值内存包含测试用 Vite、Chromium 与辅助进程，采样可能遗漏短命进程及采样间峰值。第一遍为模块载入后的首次任务，第二遍复用浏览器与模块、重新创建会话；不是完整 App 冷启动与暖启动基准。报告保留逐组、逐帧耗时。此前没有等价的连续录制路径，因此没有声称性能改善；VRAM 与完整代理 token 成本未测量。

本轮没有在原版窗口执行输入、绘制或编码，没有移动桌面窗口。CPU 原版轨迹与本地浏览器像素都不能替代原版 GPU 或整窗效果一致性。真实 App 验证的是导入后的已有控件，不是录制按钮。已安装的 Apple Silicon 1.0 应用未重新打包。

下一步：为曲面几何录制建立 Worker／客户端传输与主线程渲染生命周期，处理失败、重试、取消和释放，然后连接视频导出并实际验证 FFmpeg 文件。全部 11 类场景的原版整窗对照仍待完成。

## 证据位置

- `tests/fixtures/source-surface-scene/recording-native.json`：原版录制数值、输入、二进制和执行程序摘要、进程退出记录。
- `.cache/surface-recording-native/`：新原版录制两次执行的原始记录。
- `.cache/surface-recording-regression-native-base/`、`.cache/surface-recording-regression-native-edits/`：既有样本复验。
- `.cache/surface-recording-acceptance-tests-final.json`、`.cache/surface-recording-build-final.log`：测试和构建。
- `.cache/surface-recording-owner-browser-measured/report.json`：32 组渲染结果、源码摘要及进程族采样。
- `.cache/surface-recording-import-ui-final/`：6 组界面操作、截图、PNG 及 Worker 审计。

`.cache` 为本机证据，不进入 Git。可使用 `scripts/source-surface-scene/run.py --cases scripts/source-surface-scene/recording-cases.json` 复现原版数值；浏览器和 App 分别由 `scripts/verify-source-surface-recording.mjs`、`scripts/verify-source-surface-ui.mjs` 复现。
