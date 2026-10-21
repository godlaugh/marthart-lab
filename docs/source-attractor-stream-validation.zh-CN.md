# 吸引子连续播放验证记录

更新时间：2026-10-19。当前仍处于 **M3：场景补全与一致性验证**。本文记录源 CPU 吸引子的连续会话修复，不代表原版 JVM／JOGL 整图验收通过。

## 改变了什么

此前后台每次生成都从头预热并回放，预览和导出拿到画面后又单独重算跟踪相机。现在每个预览／导出会话共同保留粒子、拖尾、渐变、动画队列和相机状态，向前播放只推进新增帧，显示直接使用随画面交付的相机。倒退或修改公式、参数、相机、时间线、源配置时重建；只改变输出尺寸和质量时保留运动状态。

输出数组仍是独立快照，交给 Worker 转移后不会破坏内部粒子或跟踪目标。取消、预算失败、非法输入和重建失败会清除会话；下一次有效请求重新开始。退出吸引子场景会释放该会话持有的数组引用。

另一个独立问题是工作预算的归属：旧实现把整个实例一生的所有快照成本累计到 2000 万上限，合法的小帧请求也会最终耗尽。现在 **每个操作及每个完整生成请求仍受 2000 万工作单位限制**，实例累计工作量只用于统计。一次请求包含必要的预热、所有跳过帧和最终快照，不能在内部拆成多次请求绕过限制；调用方另设的预算继续生效。颜色回调计入同一请求，失败后不能继续使用部分更新状态。该轮保留了 100 万条拖尾记录上限；后续高质量视频修复已为吸引子采用 32 MiB 记录池预算，详见[高质量视频验收](attractor-high-quality-video-validation.zh-CN.md)。

## 已完成的验证

- 165 项相关测试通过，类型检查及 Web 构建通过（仍有既有的大分块提示），覆盖 CPU 运动与颜色、渐变、拖尾、相机队列、连续与重复帧、倒退、编辑失效、取消恢复、Worker 缓冲转移，以及共用模块的曲面和 GPU 路径。
- 1000 粒子、200 步预热、每帧 5 子步、3 秒拖尾、每帧完整快照的生产者任务：旧版完成 18/31 次后拒绝，新版完成 31/31 次；累计工作量仍为 **42,087,034**，没有通过少算工作或丢弃轨迹实现通过。最终有 155,000 条记录，累计发布 100,812,000 字节快照。
- 前后共同完成的 18 帧前缀，以及数值、100 粒子显示、32 粒子渐变、曲面共用拖尾任务，完整快照哈希一致。
- 128 和 1000 粒子各 31 次公开生成及显示相机任务，前后所有输出事实保持一致，只排除耗时统计。每种配置三次独立 Node 进程，每次包含首次和暖运行。
- 真实 Chrome 界面通过原版 JSON 导入、编辑、保存重开、正向与反向定位，以及播放／暂停／续播。暂停在第 14 帧保持不动，续播至第 26 帧的完整输出与独立重算一致；两张实际 PNG 与独立生成和原始 framebuffer 完全一致。实际 MP4 为 256×192、6 FPS、12 帧，逐帧解码对比上传 PNG，沿用有损编码平均 RGB 误差小于 6 的阈值。页面、Worker 和控制台错误均为 0，浏览器和导出服务清理完成。

- 追加真实界面回归：GPU 入口的两张 PNG 和短 MP4 通过；零时长片段、`+0`／`-0` 编辑及保存重开／项目重新导入、有限负时长通过，六张 PNG 和短 MP4 通过。刻意输入的零时长非有限缩放按预期拒绝，未产生伪造的有效帧；没有其它意外错误。此 GPU 回归不代表已实现 GPU 连续状态复用。

## 成本与范围

同等 31 帧公开任务（含每帧显示相机、完整输出哈希，3 秒拖尾）：

| 配置／版本 | 首次／暖运行耗时 | 首次／暖运行 CPU | 首次／暖累计峰值 RSS |
|---|---:|---:|---:|
| 128 粒子／旧版 | 449.6 / 397.1 ms | 614.7 / 441.3 ms | 243.7 / 265.4 MiB |
| 128 粒子／新版 | 72.2 / 50.4 ms | 153.9 / 84.9 ms | 195.4 / 207.4 MiB |
| 1000 粒子／旧版 | 2851.0 / 2928.1 ms | 3083.5 / 2939.3 ms | 286.3 / 287.1 MiB |
| 1000 粒子／新版 | 318.8 / 274.8 ms | 489.5 / 357.2 ms | 303.1 / 331.2 MiB |

复用消除了重复预热和独立相机回放，但不是所有指标都下降：1000 粒子任务的峰值 RSS 增加。表中成本包含快照和哈希，不代表实时画面帧率。

**10 秒连续生成已通过：**1000 和 2000 粒子、200 步预热、5 子步、作者配置 5 秒拖尾，在 30 FPS 下各生成 301 帧。每组独立进程重复三次，首次／暖运行完整输出与相机哈希一致；第 0、1、5 帧另与独立从头生成对照。每个完整任务只构造一次粒子状态，早期对照任务的成本包含在下表中。

5 秒是作者配置的过期寿命。原版另有每粒子 `lifetime×60+120` 的记录容量；本配置为 420 条，每帧 5 条，因此实际历史可能早于寿命耗尽容量。这项源规则继续保留，不冒充完整保留 5 秒轨迹。

| 10 秒后台任务 | 首次／暖运行耗时 | 首次／暖运行 CPU | 累计峰值 RSS |
|---|---:|---:|---:|
| 1000 粒子，301 帧 | 9.230 / 9.105 秒 | 11.562 / 11.322 秒 | 574.4 MiB |
| 2000 粒子，301 帧 | 21.201 / 20.805 秒 | 26.095 / 26.155 秒 | 818.6 MiB |

累计哈希处理的数组输出分别约 3.93 GB／7.86 GB，并非同时保留这些数据。结束时粒子、颜色与拖尾的已统计数组分别约 8.11／16.22 MiB；这些统计不含编译表达式、JavaScript 对象、临时输出和引擎开销。未用未完成的旧版长任务与这些完成任务计算提速比。

首次运行指模块加载后的首次任务；暖运行重新建立完整会话。RSS 是单进程累计高水位，含模块加载及同进程前一次任务，不是纯数组大小或显存。后台测量期间没有子进程，进程族即该测量进程。

独立生产者共同完成的 18 帧前缀：旧版首次／暖运行耗时 136.1／134.4 ms、CPU 227.7／175.5 ms，新版耗时 137.7／125.7 ms、CPU 233.1／166.7 ms；累计峰值 RSS 分别约 212.2–252.2／208.4–270.0 MiB。这项预算修复没有减少相同快照的数学工作，不能将它描述成显著提速。

后台基准未测浏览器绘制／上传、视频编码、GPU 显存、原版成本、构建及模块加载耗时或代理 token；真实 UI 验证没有另测进程族成本。

该轮后台基准不证明原版运行时调度、原生驱动整图、跨设备一致性、实时帧率或高质量长视频导出。后续已完成两组 1080p／30 FPS／10 秒 CPU 视频验收，见[高质量视频记录](attractor-high-quality-video-validation.zh-CN.md)。GPU 吸引子状态复用的后续验证见[GPU 连续播放记录](source-attractor-gpu-stream-validation.zh-CN.md)，原版整图验收仍为 **0/11**。已有 1.0 桌面应用未重新打包。

复验入口：

- `npm test -- tests/source-attractor-public-generation.test.ts tests/source-attractor-trails.test.ts tests/source-attractor-motion.test.ts tests/source-attractor-color-runtime.test.ts tests/ordinary-source-camera-timeline.test.ts tests/ordinary-source-camera-particles.test.ts tests/ordinary-source-camera-integration.test.ts tests/source-particle-trail-pool.test.ts tests/source-attractor-gpu-replay.test.ts tests/source-surface-trails.test.ts tests/source-surface-trail-gradient.test.ts tests/source-surface-trail-timeline.test.ts`
- `node scripts/benchmark-source-attractor-display.mjs`
- `node scripts/benchmark-source-attractor-public.mjs`
- `node scripts/benchmark-source-attractor-public.mjs --long`
- `node scripts/verify-source-attractor-public.mjs`，以及 `--zero-duration`、`--gpu` 两个变体

机器记录保留在本地 `.cache/v2-source-attractor-stream-display-cost.json`、`.cache/v2-source-attractor-stream-public-cost.json`、`.cache/v2-source-attractor-stream-long-cost.json` 、`.cache/v2-source-attractor-public.json`、`.cache/v2-source-zero-duration-public.json` 和 `.cache/v2-source-attractor-gpu-public.json`，没有纳入 Git。前后基线固定为 `c06c130228cb20e1655c9af6dccbc88b72cb0028`；这些本地脚本依赖项目工具链及本机 Chrome／导出编码环境。
