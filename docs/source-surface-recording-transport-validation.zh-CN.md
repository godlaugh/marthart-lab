# 曲面录制后台传输验收

2026-10-22，开发分支 `codex/v2-scenes-parity`。本轮将曲面录制接入真实 Worker，传输 CPU 几何、GPU 绘制描述及停止后的主预览。**生产客户端、录制按钮和 FFmpeg 尚未接入，2.0 Goal 仍在进行；原版整窗效果一致性仍为 0/11。**

## 修复了什么

此前录制传输假设每帧都是像素。现在后台协议允许几何输出，继续复用同一套开始、连续帧和停止操作，以及会话身份、独占使用和失败保留规则。现有像素录制客户端在入口明确校验输出类型，曲面尚不能从生产客户端启动这条录制路径。

实际传输发现了上一轮数值验证没有覆盖的问题：网格显示缓冲区在发给浏览器后已经失效，停止操作只读取旧显示快照，导致“ArrayBuffer is detached”。停止现在请求曲面从同一数值状态重新生成显示数据，保持动画时间、队列和更新序号不变；停止重试也不重复重置墙钟。检查了正常生成、暂停导航、当前帧、截图等消费者，它们已经使用对应的显示步骤，不需要再添加下游复制补丁。

传输有效性由唯一的输出缓冲区清单负责。发布前保存各缓冲区长度，并验证缓冲区仍可创建视图，能区分合法空数组和已经失效的空数组。CPU/GPU 几何与既有像素录制共用这个规则。若发布明确失败且缓冲区仍有效，可以重试原帧；若缓冲区已经转移且交付结果不确定，只允许停止恢复，不能再次推进或伪造一帧。停止发布失败仍保留会话，重试从原会话重新获得显示数据。

## 证据

| 验证范围 | 结果与边界 |
| --- | --- |
| 自动化测试 | 13 个文件、312/312 通过，其中新增后台传输测试 15 项 |
| 真实 Worker 与浏览器绘制 | 16 组组合重复两遍，32/32 通过；CPU 点/网格/模式切换，GPU 点/网格，密度 1/2 |
| 原有直接会话验证回归 | 32/32 通过，覆盖停止重试、恢复时钟与离屏绘制 |
| 构建 | TypeScript 和 Vite 通过，保留既有资源包大小提示 |

新测试直接使用生产导入、Worker 处理器及曲面对象，通过 structuredClone 真正转移缓冲区，仅对传输失败做故障注入。覆盖预热丢失、帧交付前后失败、停止交付前后失败、错误句柄、外部会话、超出尺寸、实际帧率重试不一致、合法空缓冲区及 GPU 描述传输。既有 Perlin、Domain、Fractal 录制和暂停截图也通过回归。

真实浏览器验证直接启动 generate.worker.ts，把返回的几何交给生产 ArtRenderer。录制更新与保留的原版 CPU 轨迹比较时间、步长、队列、相机和完成状态；检查实际像素回读、尺寸、全遮罩过渡及停止后的主预览。这个验证器直接操作 Worker，**没有经过生产 Generator、GenerationQueue、App 或编码服务**。Worker 保留的是它已接收的作者文档，不证明界面未提交草稿的处理；后者仍需客户端与队列接入后验证。GPU 渲染为本地检查，没有原版 GPU 像素对照。

最初实际传输失败留下了原始报告，修复后测试通过。另一次浏览器复验在与构建同时运行时出现 generate 响应超时；单独重跑通过，没有增加超时或删除断言。并行负载可能有关，但没有独立证明它就是原因。

## 成本和剩余工作

串行 Worker 验证约 11.38 秒，37 次进程族采样记录累计 CPU 约 34.81 秒、峰值 RSS 约 1,670 MiB。数值是 Vite、浏览器、辅助进程及测试驱动的采样估计，可能遗漏短命进程和采样间峰值，不能当作产品单帧开销。第一遍为模块初始化后的首次任务，第二遍复用浏览器和模块、重新创建 Worker 和场景，不是完整 App 冷暖启动基准。原版本没有同等曲面后台录制路径；本轮未作等价的前后性能改善声明，完整 token 成本与 VRAM 未测量。

下一步实现客户端连续绘图资源的持有、像素回读及失败清理，之后连接界面、公式叠加、视频编码和实际输出验收。没有在原版窗口执行输入、移动用户窗口或重新打包已安装的 1.0 应用。

本机证据：

- `.cache/surface-recording-worker-tests-final.json` 与 `.cache/surface-recording-worker-live-regression.json`：312 项测试。
- `.cache/surface-recording-worker-build-final.log`：构建。
- `.cache/surface-recording-worker-browser-acceptance/report.json`：32 组真实 Worker 渲染、源码摘要和进程族采样。
- `.cache/surface-recording-owner-browser-regression/report.json`：直接会话回归。
- `.cache/surface-recording-worker-tests.json`、`.cache/surface-recording-worker-browser/report.json`：修复前传输失败。
- `.cache/surface-recording-worker-browser-final/report.json`：并行负载期间的超时记录。

使用 `node scripts/verify-source-surface-recording.mjs <新证据目录> --worker` 复现真实 Worker 验证；省略 `--worker` 验证直接会话。上述 `.cache` 证据不进入 Git。

后续进展：生产客户端与队列已接通，见[曲面录制客户端与队列验收](source-surface-recording-client-validation.zh-CN.md)。录制界面和 FFmpeg 输出仍待连接。
