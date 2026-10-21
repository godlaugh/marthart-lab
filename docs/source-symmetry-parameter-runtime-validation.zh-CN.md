# Symmetry 参数动画内核：原版运行对照

后续进展：[参数动画接入与界面验收](source-symmetry-parameter-integration-validation.zh-CN.md)已完成项目、共享队列、GPU 及公开导出接线。以下保留本阶段当时的验证范围。

2026-10-21。**已取得 45 组、312 帧原版 JVM 参数状态，并完成本地参数动画内核对照。尚未接入 MathArt Lab 的导入与共享时间线，不代表参数动画的画面效果已经验收。** 完整原版窗口一致性仍为 0/11。

后续进展见[参数动作解析验证](source-symmetry-parameter-config-validation.zh-CN.md)：原始动作解析到内核的对照已扩展至 63 组、366 帧；公开项目与 GPU 接入仍待完成。以下保留本轮原始验证范围。

## 这次解决了什么

此前 Symmetry 的 `paramStart / paramStop` 可能沿用本地通用振荡逻辑。这轮查明了它与原版的区别，并实现了可供共享时间线消费的独立参数运行时：

| 规则 | 原版实际结果与本地内核处理 |
|---|---|
| min 大于 max | 先交换上下界；不会直接视为退化范围 |
| 初始值越界 | 正向步进从下界开始，负向步进从上界开始；不是夹到最近端点 |
| 范围不大于 1e-6 | 对象更新直接写下界，即使 dt 或步进倍率为零 |
| 开始子动画 | Float32 时间累加前将负 dt 取零；非正时长按进度 1 更新 |
| 停止子动画 | 使用通用 Animation 时钟；零时长可产生瞬时 0/0，但完成回调恢复倍率 |
| 停止单个参数 | 倍率降到零，注册项及全局 running 保留 |
| 停止全部 | 倍率归零并停止注册表；再次启动会按当时值重新求相位 |
| 同组多个动作 | 所有开始回调先执行，然后按子动画顺序更新；重复注册、启动与停止不能合并成一个最终配置 |
| 大步进相位 | 按原版反复加减 2π，保留舍入顺序；本地工作预算不足时明确失败 |
| 帧率参数不大于 1 | 原版回退到 60；本地按同一规则处理 |

原版 `Easings.getByName` 区分大小写。实验中的 `edgeEasing.easing: "linear"` 保留继承的缓动，而 `"LINEAR"` 选择线性。这也是先读取原版构造结果再验证运行时的原因。

曲面和 Symmetry 共用的 `OscillationEdgeEasing` 数学已集中到一个实现。两者的注册表和子动画仍分别拥有状态：曲面的存储相位仅做一次减法，Symmetry 则完整约简；不能因为名称类似就合并为同一个振荡器。

## 实际执行了哪些原版代码

使用已下载 MathArt 1.7.8 应用自带 JVM，不安装 Java，不启动应用窗口。C/JNI 探针实际执行：

1. `JsonSymmetryChaosConfig` 构造和私有 `buildParamActionAnimations`，记录真正生成的参数名、范围、步进、边界缓动、时长及曲线。
2. `StartSymmetryChaosParamAnimation`、`StopSymmetryChaosParamAnimation` 的真实 `start/update` 调用。
3. `SymmetryChaosParameterAnimator.update(dt, frameRate)`。
4. 原版 Mobject 的标量 getter/setter，读取值、相位、倍率、子动画计时与完成状态。

脚本显式提供每步 dt，并按“开始所有子动画 → 更新各子动画 → 参数注册表更新”的次序调用。**没有执行 ProjectState 导入、SceneManager 队列、Mobject.update/display、GL 或编辑重建。** 比如 builder 单独接到 null 会产生“全部”操作，但外层场景分派可能先跳过这类输入；不能把 builder 结果直接当成完整导入行为。

同时记录了 target 的 degree、shaderDirty、replayPending。观察到普通 scalar 写入不请求重建，新名称会标记 shaderDirty，空白名称不写入。本地内核测试只比较参数值、相位、倍率及子动画状态，**没有用测试替代对渲染标志和真实 GPU 消费者的验收**。

## 验证结果

- 45 组涵盖正负步进、反向/相等/窄范围、上下越界、零步进、多次绕圈、负 dt、零/负时长、不同帧率、零时长停止、停全部后重启、重复启动、多参数与 HashMap 碰撞名称、不同目标域、空和禁用参数配置，以及边界缓动覆写。
- 初次采集后独立重跑，312 帧完整原版输出（包含构造出的配置）与固定记录完全相等。
- 本地内核逐帧检查值、相位和倍率，绝对误差阈值为 5e-13；子动画 Float32 计时、完成和 running 状态直接比较相等。此阈值不等同于跨 JVM/JS 的所有 double 位模式一致。
- 取消/预算失败使运行时失效，必须重建；测试覆盖配置所有权、快照不可变、无进展相位约简及无效输入。
- 相关曲面与新增参数内核测试共 **31 个文件、665 项通过**；TypeScript 和网页构建通过。未重新打包安装应用。

原版复跑外层耗时约 1.17 秒，探针内部约 0.76 秒；250 ms 采样的进程族 CPU 约 0.73 秒，峰值 RSS 约 177 MiB。采样可能漏掉短进程或峰值，RSS 可能重复计算共享页，CPU 是下界，未区分短时间内的 PID 复用；未测 token 或 GPU 内存。没有受控冷/热或等价前后性能比较，不作性能提升结论。

## 可重复证据

- `tests/fixtures/symmetry/parameter-runtime.json`：全部输入、原版构造配置和输出；固定 108 个 classpath JAR、JVM、8 个相关类及探针源文件的 SHA-256。
- `scripts/oracles/source-symmetry-parameters.c`：实际原版执行探针，`-Wall -Wextra -Werror` 编译。
- `scripts/verify-source-symmetry-parameters.py`：校验身份后复跑，完整比较输出；运行超时 20 秒。
- `tests/source-symmetry-parameter-runtime.test.ts`：本轮以内核的标准配置为输入；后续已将逐帧案例迁移到 `tests/source-symmetry-parameter-config.test.ts`，从原始动作解析开始，原文件保留所有权与预算检查。

在 Studio 目录使用已有工具链复验：

```sh
python3 scripts/verify-source-symmetry-parameters.py \
  ../.cache/mathart-investigation/MathArt.app \
  .cache/v2-bouncing-jvm .cache/source-symmetry-parameters/new-run
npm test -- --run tests/source-surface*.test.ts tests/source-symmetry-parameter-runtime.test.ts
npm run build
```

输出目录必须不存在。本轮实际原版复跑结果为 `.cache/source-symmetry-parameters/reproduced-final/report.json`，机器记录、运行二进制均不进入 Git。

## 下一步

先完成原版参数动作的导入与保存合同，保留源参数名、原始数值和成员顺序，验证外层分派及全局/动作/参数级边界缓动继承。然后将本内核接入相机、渐变共用的队列，按原版“参数 → 渐变 → 粒子”的对象更新顺序写入同一帧 GPU 参数，验证参数变化后的累积清除、回退定位与导出。编辑触发重建和原版完整窗口对照仍是独立待办。
