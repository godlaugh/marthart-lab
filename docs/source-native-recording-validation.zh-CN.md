# 曲面原生录像接入验证

2026-10-24。曲面录像现在可通过原生渲染服务逐帧产生像素，覆盖 CPU/GPU 点阵、网格、公式合成和 FFmpeg 导出。仍需显式启用 `VITE_SOURCE_RENDERER=native`；默认构建保持 WebGL，实际预览和已安装应用尚未切换。

## 帧确认与资源所有权

原先绘制同步返回后就推进录像帧号。现在 `SourceSurfaceRecordingLease` 等待异步像素交付，并再次确认请求未取消、会话未停止、待交付几何未被替换，才确认该帧。失败时保留同一份几何与实际帧率，重试不会再次推进 Worker 的数值场景；未交付的 warmup 不能跳过。

录像队列持有取消控制器。界面取消、队列取消和页面卸载会中断当前原生请求；退出操作仍等待 Worker 的停止响应和资源清理，不丢弃恢复预览所需的会话。绘图对象释放也会中断自身正在等待的请求。重复起始／帧响应在会话所有者处被拒绝。

截图与录像共用 `sourceDrawingPixels`：后端选择、无采样离屏约束、原生请求、上下翻转、回读错误及返回的渲染器身份统一由一个边界处理。没有在原生失败时返回 WebGL 图像。录像仍复用一个离屏上下文，并保留失败清理的原有重试机制。去掉录像 `setOutput` 后多余的一次绘制；公式和视频编码不由绘图后端重复处理。

## 执行过的验证

| 验证 | 结果 |
| --- | --- |
| 录像、截图、客户端及队列相关测试 | 78 项通过 |
| Perlin 共用录像队列回归 | 30 项通过 |
| 原生选项的 2.0 类型检查与构建 | 通过，仍有已有大 chunk 提示 |
| 真实客户端／Worker／原生进程 | 32 组、136 帧通过 |
| 同一最终代码的 WebGL 对照 | 32 组、136 帧通过 |
| 各后端首轮／重复运行像素摘要 | 各 16 组全部相同 |
| 原生上下文丢失后的停止、重建和恢复 | 通过，所有自有上下文释放 |
| 实际 UI、公式 PNG、FFmpeg 视频解码 | CPU/GPU × 点阵/网格四组通过 |
| 共用像素读取后的原生暂停截图回归 | Cornucopia、Sphere、Möbius 三例完整艺术画面仍与原版零差异 |

32 组客户端验证包括不同密度、动画、转换及完成队列，核对时钟、对象生命周期、无额外推进的停止恢复、单个上下文复用和像素重复性。原版数值参考来自已有 CPU 场景运行记录；GPU 配置共用相关数值检查。这不是原版 GPU 连续动画整图的证明。

真实 UI 每组覆盖完整录制、停止并保存部分视频、取消、零帧停止、上传／完成回复丢失后的恢复、空队列，以及原生 warmup 尚未返回时取消。检查取消请求在网络拦截解除前即可完成停止；没有交付迟到帧，没有创建编码器任务，恢复帧号保持 0。后续再次录制通过。实际下载的视频经过 ffprobe 和 FFmpeg 解码，检查帧数、尺寸、帧率、时长和画面变化。

所有界面验证均在后台 Chrome 运行，服务清理后受管进程为 0。

## 后端开销对照

下表是同一最终代码、同一完整 32 组验证任务，分别选择 WebGL 和原生后端；不是旧提交与新提交的性能基准。每组包含首轮和重复运行，无系统／驱动缓存清空。

| 后端 | 完整脚本墙钟 | 观测到的任务家族 CPU | 采样峰值 RSS |
| --- | ---: | ---: | ---: |
| WebGL | 12.82 秒 | 37.09 秒 | 1790.0 MiB |
| 原生 | 13.42 秒 | 38.45 秒 | 1844.0 MiB |

墙钟包含浏览器启动、模块加载、导入、录制、验证及清理；CPU/RSS 采样窗口覆盖主验证任务及可观察的 Node 子进程家族。250ms 采样可能漏掉短命进程和瞬时峰值，也可能重复计入共享页面。上下文故障检查在主采样窗口后执行。不能将这些数值换算为产品帧率。显存、GPU 时间、agent token 及严格冷／暖启动成本未测；未声称性能提升。

## 范围与剩余工作

这次完成原生录像的产品入口、异步交付和恢复流程。连续录像的原版逐帧整图对照还没有完成；先前静态截图零差异不能代替动画验收。实际主预览仍需原生呈现与迟到帧保护。其余场景及 Apple Silicon 辅助程序打包、安装包验收仍在 Goal 范围内。

## 本地证据与复跑

证据根目录：`.cache/source-native-recording-20261024/`。

- `tests-teardown-final.log`、`queue-regression.log`、`build-native-final.log`：最终测试和原生构建。
- `client-native-final/report.json`、`client-webgl/report.json`：两种后端的实际客户端录制、时钟及清理结果。
- `backend-cost-comparison.json`：成本摘要、报告摘要及重复像素检查。
- `ui-final/report.json`：实际导出控件、原生帧身份、取消、恢复、PNG 和视频解码。
- `capture-regression/report.json`：共用像素读取边界后的真实暂停截图与固定原版参考对照。
- `ui/report.json`：补充页面卸载取消控制器之前的独立 UI 验证，保留历史记录。

```sh
VITE_SOURCE_RENDERER=native MATHART_SOURCE_RENDERER_BACKEND="$PWD/.cache/source-native-capture-20261023/backend.json" node scripts/verify-source-surface-recording.mjs .cache/source-native-recording-20261024/client-recheck --client
VITE_SOURCE_RENDERER=native MATHART_SOURCE_RENDERER_BACKEND="$PWD/.cache/source-native-capture-20261023/backend.json" node scripts/verify-source-surface-recording-ui.mjs .cache/source-native-recording-20261024/ui-recheck
```

Goal 保持进行中。
