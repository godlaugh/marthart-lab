# 隐式曲面录制客户端与视频验证（2026-10-24）

公开 `Generator` 已能从完成的 CPU 隐式预览开始录制，通过真实 Worker 和原生绘图后端交付像素帧，并停止、恢复主预览和重新录制。四组共 19 帧的原版完整艺术底图对照仍为零差异；三个非空队列实际生成并解码了 MP4，分别为 4、4、7 帧，均为 128×96、1 秒。空队列只绘制预热，不创建编码任务。

**当前完成到客户端与视频交付验证，App 的 Implicit 录制按钮仍待接入。** 本轮浏览器程序直接调用公开客户端及编码服务，不代表已验收界面操作，也不是与原版 MP4 编码结果的逐字节比较。

```mermaid
flowchart LR
  A[原版时钟与整图证据：完成] --> B[Worker 录制所有权：完成]
  B --> C[公开客户端与视频验证：本轮完成]
  C --> D[停止后的连续播放与界面：待完成]
  D --> E[参数动画与更多配置：待完成]
```

## 实现变化

Surface 原有的帧交付、重试、取消与绘图资源管理现在由 `SourceGeometryRecordingLease` 和 `GeometryRecordingRenderer` 共用，旧文件及旧类名已移除。没有另造一套 Implicit 重试循环。

两类场景各自验证数值事实。Surface 保留现有构造次数、实时会话、切换遮罩等规则；Implicit 验证保存文档、主预览输入、三倍尺寸、实际观察 FPS、预热、完成状态及源相机数值帧。文档比较保留负零和显式缺失的区别。客户端不会为验证响应而重新运行一遍动画队列。

绘图尺寸也明确区分：Surface 使用逻辑尺寸和密度；Implicit 按物理尺寸建立离屏渲染器，另保留主画布参考密度。因此密度 2 时的 384×288 缓冲不会被重复放大线宽。原生后端仍需显式选择，默认 WebGL 策略没有改变。

`GenerationQueue.recordSource` 已将独立帧率观察和取消信号交给 Implicit。生产队列测试确认预热不交给编码消费者，提前停止交付正确的最终帧数，并恢复已消费的停止帧。渲染失败可以重新绘制同一几何帧；不会再向 Worker 索取一次更新。传输完成后响应丢失也能恢复停止。

## 实际验证

| 范围 | 结果 |
| --- | --- |
| 公开客户端、真实 Worker、原生绘图 | 4 组、19 帧完整艺术底图零差异；相机、速率、时钟和完成状态精确匹配 |
| MP4 交付和 FFmpeg 解码 | 4 FPS 两段各 4 帧、7 FPS 一段 7 帧；均 128×96、1 秒，首尾解码帧不同 |
| 空队列 | 一次预热，零编码帧，没有创建视频 |
| Surface 共用路径回归 | CPU/GPU 的 6 组、35 帧严格原版对照通过 |
| Surface 公式与切换回归 | 2 组、28 帧及遮罩阶段的既有严格对照通过 |
| 自动化测试 | 10 个文件、123 项通过；追加两项传输恢复检查后，客户端 10 项再次通过，共覆盖 125 个不同用例 |
| 构建 | `build:v2` 通过；最终测试修改后 `tsc --noEmit` 再次通过；仍有已有大 bundle 提示 |

客户端测试包括损坏的起始尺寸、时钟或文档响应，异步绘制取消，同一帧重试时改变观察 FPS，以及开始和取帧的缓冲区转移后响应丢失。绘图资源测试覆盖上下文丢失、容量和释放失败的后续清理。测试中的绘图替身只证明生命周期；上表的像素和视频结论来自真实浏览器及原生后端。

19 帧参考沿用[原版隐式时钟采集](source-implicit-recording-clock.zh-CN.md)。本轮没有重启原版 JVM，没有重新采集原版视频或操作原版窗口。所有浏览器均为 headless；没有移动用户窗口。

## 复验与证据

本地证据根目录为 `.cache/source-implicit-recording-client-20261024/`：

- `client-native-first/report.json`：19 帧、三个 MP4 的 FFprobe 元数据、源文件摘要、停止和重录结果；同目录保留 `.rgba` 和 `.mp4`。
- `surface-native-regression/report.json`：35 帧回归。
- `surface-formulas-regression/report.json`：28 帧及公式／遮罩回归。
- `tests-final.log`、`client-recovery-tests.log`、`build-final.log`、`types-final.log`：实际运行记录。首次构建因测试直接改写只读视口属性失败，已改为构造受损响应副本后通过。

核心复验命令如下；使用项目固定 Node 工具链以及已有 FFmpeg，输出目录必须不存在：

```sh
MATHART_SOURCE_RENDERER_BACKEND="$PWD/.cache/source-native-capture-20261023/backend.json" \
node scripts/verify-source-implicit-recording-clock.mjs \
  .cache/source-implicit-recording-clock-20261024/reference-v2 \
  .cache/source-implicit-recording-client-20261024/client-native-first \
  --client-recording
```

该模式在 Vite 中明确启用 native 绘图。未带选项仍是原来的诊断模式；`--worker-recording` 仍直接验证 Worker，两者不会冒充公开客户端或界面验证。

| 任务 | 墙钟 | 采样进程族 CPU | 采样峰值 RSS |
| --- | ---: | ---: | ---: |
| Implicit 客户端、像素及视频 | 21.986 秒 | 37.080 秒 | 2224 MiB |
| Surface 无公式回归 | 7.236 秒 | 15.110 秒 | 1857 MiB |
| Surface 公式回归 | 9.199 秒 | 14.650 秒 | 2035 MiB |

三项均无采样和清理错误，服务遗留进程为 0，记录的源文件摘要在各自运行期间稳定。CPU/RSS 是采样值，未覆盖全部启动与清理，可能漏掉短命进程；GPU 和 agent token 未单独测量，没有控制冷暖缓存或等价性能基线，不作性能提升结论。

## 后续进展

2026-10-24：后台停止后的连续播放已完成，见[继续播放验收记录](source-implicit-recording-continuation.zh-CN.md)。以下为本轮结束时的衔接缺口记录；App 入口仍待接入。

## 下一步

需让停止后的连续播放继续使用已持有的数值状态，再接入 App。现有 App 的时间变化会触发一般预览生成，而一般隐式预览按作者 FPS 重新求值；这是从当前代码确认的衔接缺口，尚未通过已接通的 Implicit 录制界面复现。不能简单开放按钮后把停止帧重算成另一套时钟。

之后验收真实录制界面的自然完成、手动停止、取消重试、空队列和下载视频。原版隐式参数动画、带公式的原版录制对照、更多显示配置及其它场景族继续属于原 Goal；最终 Apple Silicon 发行也未由本轮证明。
