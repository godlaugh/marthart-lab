# Symmetry 调度结论更正：原版每帧会调用几次 update

2026-10-21。接入实时生成前发现并验证了此前遗漏的场景覆写：`GenericSymmetryChaosScene.update(boolean)` 在通用 `Scene.update` 返回后，还会直接调用一次 Mobject.update。**当前 MathArt Lab 的对称时间线及 GPU 帧计划仍只覆盖通用路径，需要修正后才能接入界面。** 此前“空队列不更新、队列结束后粒子冻结”的原版行为判断不成立。

## 本轮实际执行

在应用随附 JVM 中执行原版 `GenericSymmetryChaosScene`、`Scene`、配置导入、队列和相机更新。将同一个计数子类同时装入场景的 `mobject` 字段和通用 `mobjects` 列表；该子类覆盖 `update(float,float)`，只记录调用时间及 dt，**不执行原版 Mobject 的参数动画或 OpenGL**。

使用原版 `setRenderMode(10)`，固定每帧原始 dt 为 Float32 的 0.1。原版 setup 仍执行，并检查其 initializationError。覆盖空队列、零时长 wait、0.15 秒 wait；各自验证正常、pending、replayActive 三种状态。每例依次执行“运行、运行、暂停、运行、运行”。共 **9 例、45 帧**，完整记录独立重跑相等。

| 队列 | 五帧的 Mobject.update 调用次数 |
|---|---|
| 空队列 | 1、1、0、1、1 |
| 零时长 wait | 2、1、0、1、1 |
| 0.15 秒 wait | 2、2、0、1、1 |

pending 或 replayActive 不改变这些次数。原版 `shouldDeferParamAnimatorUpdate(ZZ)` 直接返回 false，`shouldPauseSceneForReplay(ZZ)` 只返回传入的用户暂停标志。

短 wait 的第二帧显示了不能简单“乘二”的原因：第一次调用的 dt 是 `0.05000000447034836`，第二次是 `0.10000000149011612`。两次 time 都为 `0.15000000596046448`。队列结束后，第四帧 time 为 0.25，仍有一次 dt 为 Float32 0.1 的调用。暂停帧没有 update 调用。

## 根因与修正要求

此前直接把 `Scene.update` 的通用行为作为 Symmetry 的完整场景行为，遗漏了实际类的覆写。既有单次调用 helper 证据、数学公式和 GPU 覆盖结果并未因此自动失效，但以“每帧只更新一次或结束后不更新”为前提的端到端时序结论已经被本轮证据否定。

修正必须从产生更新事件的边界开始：

1. 在通用 Scene 更新与 camera 更新之后，执行 Symmetry 的额外更新钩子；暂停时不执行。
2. 由同一个时间线所有者输出**有序更新记录**，保留每次的 time、dt 和更新后的参数；参数/渐变运行态要依序推进。
3. GPU 依次使用各次更新对应的参数执行粒子迭代，再显示一次。不能用最终参数一次执行双倍迭代；动画参数可能在两次调用间变化。
4. 空队列和结束队列的未暂停帧仍执行一次更新。重播期间也遵循该调度，再执行已有的显示重播阶段。
5. 更新固定预览、定位、导出、实时会话与测试，删除旧的布尔更新事件假设；以本轮原版调用记录校验新事件顺序。

这次优先纠正证据，尚未改动生产调度代码，也未完成 Worker/编辑器接入。不能把此前全量测试通过当成该缺陷已解决的证明。

## 复验与边界

```sh
python3 scripts/oracles/source-symmetry-scene-dispatch.py \
  ../.cache/mathart-investigation/MathArt.app \
  .cache/source-symmetry-replay/dispatch-new-run
```

必须使用不存在的输出目录。脚本核对原 JVM 和全部 JAR 的 SHA-256；动态生成一个最小计数子类，不修改应用 JAR，不安装 Java。固定证据在 `tests/fixtures/symmetry/scene-dispatch.json`；再次运行会与完整证据比较。本轮初次运行曾因遗漏原版构造函数的第三个 boolean 参数失败，修正为实际签名后成功，最终独立重跑一致。

本轮没有运行原版图形初始化、原版 Mobject.update、display、JOGL 或窗口，因此不证明 GPU 轨迹、整图或可见 UI。原版整窗口验收仍为 **0/11**。没有移动窗口、修改系统权限或重新打包安装应用。
