# 迭代场景的异步执行边界验证

2026-10-25：Map／Symmetry 已有一套可供原生后端使用的会话执行接口。同步 WebGL 和异步后端共用时间线、重播、暂停截图和录制规则；原生计算尚未接入生产调度，Symmetry 原版整图一致性和 M3 仍未完成。

这是[点绘制修复与 CGL 计算对照](source-symmetry-render-boundary-validation.zh-CN.md)之后的集成准备。没有重新执行原版应用、原版导出或主屏窗口操作，1.0 安装包未替换。

## 改动与实际作用

| 边界 | 当前实现 |
| --- | --- |
| 数学与绘图程序 | `iteratedDensityGpuPrograms` 从同一正文生成 WebGL 2 / OpenGL 4.1 程序，显式选择语言头；公式仍由原来的 Map／Symmetry／custom owner 生成。没有转换或复制原版捕获的 shader。 |
| 重播 | `SourceIteratedReplaySession` 的一个 generator 决定 resize、普通更新和重播顺序。同步和异步 driver 只负责执行；warmup、逐次参数、计数没有第二份解释。 |
| 实时会话 | `SourceIteratedSession` 的一个操作序列涵盖 generate、暂停导航、截图后恢复、录制及固定重建。默认仍用原 WebGL 后端。异步后端需要显式注入工厂，每次初始化建立新的 owner。 |
| 取消与失败 | 已提交操作先等待 ACK，再在边界停止；不会因本次请求取消而直接终止共享 CGL context。失败释放保留资源和会话，允许显式重试；不会重新提交状态未知的绘制。 |
| 输出身份 | 异步呈现可以携带实际原生 renderer 身份。检查取消发生在上层交付像素之前；不会把已重置会话的旧画面成功返回。 |

实际任务含有 `ParticleTransform.point` 函数，不能直接 `structuredClone` 整个任务。异步边界现在拷贝可变参数与绘制事实，保留已有的冻结变换 owner；同步调用仍使用原输入。这个修复由真正的 `prepareIteratedFrame` 任务和实际 GPU 流程验证。

另一个被独立复现的问题是：下层呈现已确认，但上层恢复执行前收到重置。现在上层在生成输出和完成记录前再次检查取消。回归观察到旧输出拒绝返回、精确释放一次、保留内存为零。复现前后的本地记录在 `.cache/source-iterated-review-20261025/`。

## 已执行验证

- **220 项 CPU 测试／17 文件通过**，包含已有数学／custom／参数／导航测试，以及新增的同步与异步顺序、参数快照、取消、失败清理和录制测试。这些边界测试不作为原生像素证明。
- **原 WebGL 源码逐字节保持**：以提交 `5d8c9d2` 为基线，19 个静态片段和 7 个字段的 14 个完整阶段，共 33 份输出相同；字段源码、缓存键、uniform 和 stage 也相同。
- **本机 CGL 编译与链接**：Apple M2 Max，OpenGL `4.1 Metal - 90.5`，20 对实际生产生成的程序全部通过。覆盖 7 个字段例子和 13 个静态程序，包括 TF、custom、点绘制、统计与归约。所有 GL 清理与 context 销毁返回 0，进程组无残留。它只证明这些程序可编译链接，不证明每种公式或完整画面已经一致。
- **实际 WebGL 同步／异步对照**：两类场景各 256 粒子、9 个可见交付检查点，另含暂停离屏截图；像素、粒子四通道、无效计数、有效标记、墨迹与显示统计全部一致。主预览 64×48，录制 192×144。停止录制不额外绘制；两侧所有 GPU owner 清理后为零。
- **已有生产 live／Worker 回归**：Map、Symmetry 各自的真实 `SourceIteratedSession` 与 `Generator` / Worker 脚本通过，包含独立粒子递推、实时调度、热编辑、相机、重播、resize、重建及清理。
- TypeScript 与 2.0 构建通过，保留既有大 chunk 提示。

可重跑实际同步／异步 GPU 对照：

```sh
node scripts/verify-source-iterated-async.mjs <新的输出目录>
```

完整本地索引：`.cache/iterated-session-backend-20261025/index.json`。CPU 日志、实际 GPU 报告、输入摘要与源码摘要均保留；原生编译记录在 `.cache/iterated-native-profile-20261025/`，原 WebGL 源码对照在 `.cache/iterated-shader-producer-20261025/`。

## 剩余集成与验证

还需要实现有容量约束的原生 retained owner、规范种子分块、明确的上传／推进／呈现／释放协议，并接入现有浏览器请求槽和服务 lease。当前没有默认启用原生 Symmetry，也没有把实验中的粒子替换作为正常产品路径。

下一步应使用现有 CGL 精确计算证据和这里的单一会话接口，测量完整原生路径与原生计算／WebGL 绘图组合的真实成本，再决定实现路线。完整原生呈现、更多公式／尺寸、原版整窗口与其它场景的验收要求均保留。只有这一台 Mac，跨设备仍未验证，不再次请求第二台设备。

CPU 套件墙钟约 3.37 秒；实际同步／异步 GPU 工作流约 2.36 秒；CGL 编译进程墙钟约 1.08 秒、CPU 约 0.18 秒。这些包含验证开销，且没有等价冷／热性能对照。CGL 内存采样只捕获启动阶段，不能报告可靠峰值；完整进程族／GPU 内存、吞吐和 agent token 增量未测，不宣称性能提升。
