# Symmetry 参数动作解析：原版运行对照

2026-10-21。**原始参数动作 → 本地配置解析 → 参数内核的 63 组、366 帧对照通过。项目导入器、共享时间线及 GPU 尚未接入这套参数配置，不能据此认定界面播放和导出已验收。** 完整原版窗口对照仍为 0/11。

## 本轮完成

在上一轮[参数内核验证](source-symmetry-parameter-runtime-validation.zh-CN.md)基础上，新增动作解析与严格的保存格式校验。现在对照测试从原始 `args` 开始，不再直接把原版探针生成的配置交给本地内核。

曲面与 Symmetry 的数值、边界缓动、成员顺序及保存格式共用 `sourceRegistryParameterConfig.ts`；场景差异在同一解析入口明确选择。旧曲面模块已移除，应用、测试和验证脚本的引用同步更新。两种场景的运行时仍分别拥有状态，未合并不同的数学规则。

| 输入或规则 | 本轮核对结果 |
|---|---|
| 缺省范围 | Symmetry 为 -1 到 1；曲面仍为 -100 到 100 |
| 动作数值表达式 | Symmetry 使用空绑定作用域；不能引用顶层参数作为表达式变量。仍支持内建 PI 与十六进制数值文本 |
| 作用范围 | Symmetry 对字符串执行 Java trim 后接受空值、SYMMETRY_CHAOS 或 SURFACE；FRACTAL、其他字符串及非空的数字/布尔/对象值被排除 |
| 参数身份 | 保留原始名称、空白、点号及原版 HashMap 次序；不转为本地带点号的动画目标 |
| 非对象/禁用配置 | 跳过，不替换为“启动全部”；识别出的数字来源路径仍保留 |
| 全局边界缓动 | 实际原版构造器忽略 `settings.param_edge_easing`，使用默认窗口 0.5、速度下限 0.25、SINE_OUT；曲面仍可继承其全局设置 |
| 动作和单参数边界缓动 | 按层级继承；源缓动名称大小写精确匹配，未知名称保留继承值 |
| 参数停止 | 读取 enable 和动作级 edgeEasing，但不读取该参数的数值或边界配置 |
| 范围与边界值保存 | 保留原始顺序、负步进和未钳制的边界数值；实际运行时负责交换范围和钳制边界，保存校验不提前改写 |

私有 builder 对 null 或没有有效首元素的数组会构造“全部”操作；外层 `setupTimeline` 可以先跳过非数组/对象 args。本轮验证的是 builder 入口，尚未用它替换项目导入流程。两层规则不能混为一谈。

## 实际验证

- 使用原版 MathArt 1.7.8 自带 JVM 和现有 JNI 探针，新采集 18 组、54 帧边界案例，原有 45 组、312 帧继续保留。
- 身份校验后的独立复跑：63 组、366 帧原版构造配置和状态与固定记录完全相等。记录保留全部 108 个 JAR、JVM、相关 class 和探针的 SHA-256。
- 本地解析出的配置与原版实际构造配置对照；边界缓动只在比较构造结果时按原版运行时规则钳制。再逐帧对照参数值、相位、倍率、running 和子动画计时/完成状态。
- double 状态使用绝对误差阈值 5e-13，Float32 计时与布尔状态比较相等。不是所有 JVM/JS double 位模式一致的证明。
- 相关曲面、普通源相机、Symmetry 参数测试：38 文件、804 项通过。最终作用范围辅助函数整理后又通过 2 文件、77 项重点测试。
- TypeScript 与网页生产构建通过；存在既有的大资源分块提示。没有重新打包或替换已安装的 1.0 应用。
- 原版独立复跑脚本记录约 0.87 秒（原版执行及输出校验，未含编译）；本轮未测 CPU、内存或 token 成本，不作性能提升结论。

## 文件与复验

- `src/engine/sourceRegistryParameterConfig.ts`：共享解析及场景差异。
- `tests/source-symmetry-parameter-config.test.ts`：原始输入、构造配置、运行状态的连续对照，以及保存格式和来源路径检查。
- `tests/source-symmetry-parameter-runtime.test.ts`：保留所有权、失败后失效与工作预算的独立语义测试；原有 45 组状态测试已移入上述更完整的解析链路，避免重复覆盖。
- `tests/fixtures/symmetry/parameter-runtime.json`：63 组原版输入与结果。
- `scripts/verify-source-symmetry-parameters.py`：独立原版复跑入口。此次结果位于 `.cache/source-symmetry-parameters/import-boundary-repeat/report.json`，不进入 Git。

```sh
python3 scripts/verify-source-symmetry-parameters.py \
  ../.cache/mathart-investigation/MathArt.app \
  .cache/v2-bouncing-jvm .cache/source-symmetry-parameters/new-import-check
npm test -- --run tests/source-symmetry-parameter-config.test.ts tests/source-symmetry-parameter-runtime.test.ts tests/source-surface-parameter-config.test.ts
npm run build
```

原版复跑输出目录必须不存在。

## 仍需完成

项目级导入与保存接线、共享相机/渐变队列、参数写入同帧 GPU、原版 double 参数变化阈值触发累积清除、回退定位、公开界面编辑及 PNG/MP4 导出。原版 shader/replay 标志、编辑重建和完整窗口效果仍未验收。本轮解析器未改变现有项目的参数动画行为。
