# 隐式曲面端点缓动合同与指南差异（2026-10-27）

**MathArt 1.7.8 实际读取的是 `window / floor / easing`，不是 `attackRatio / releaseRatio`。现有参数动画已接通；MAS-IMP-019 的剩余问题是指南与固定原包的合同冲突。** 本条按固定原包行为校正验收口径，不新增未经定义的两端独立模型，也不把两个名称做别名。

本轮只审查已有证据并运行本地 CPU 测试，没有启动原版 JVM、GPU、GUI，也没有修改产品代码或发行包。其他 11 个场景族、M3 和总 Goal 仍未整体完成。

## 冲突来自哪里

来源是 2026-10-14 15:33:16 UTC 已保留的[原官网隐式曲面指南](https://www.mathartstudio.art/guide/implicit-surface)，不是本轮访问的当前页面。保存的 HTML SHA-256 为 `2d792cefb81cd1ba145750fcbf3b54c86ca66cb7ce8dc6438f21d0e3c1ef9711`。

| 保留页面的位置 | 实际文字事实 |
| --- | --- |
| 文本块 205–211，边缘缓动 | 把 `attackRatio` 描述为靠近最小值的区域比例，`releaseRatio` 描述为靠近最大值的区域比例；示例和表格为 0.3 / 0.4，曲线为 `SINE_OUT` |
| 文本块 310–314，参数动画机制 | 同页又称默认值为 0.4 / 0.5 |
| 1.7.8 的 JSON 读取器 | 只查询 `window`、`floor`、`easing`，没有读取上述两个 ratio 键 |

因此，指南本身连默认值也不一致。它没有给出独立两端区域的单位、相位映射、重叠规则或递推算法，不能据此推导一个唯一的新动画模型；也不能把 `.4 / .5` 数字恰好相同当作两个字段语义相同的证明。

原始 HTML、提取文本、抓取清单都保留在 `../.cache/mathart-investigation/public-docs/`，相关文件为 `guide__implicit-surface.*` 和 `manifest.json`。

## 1.7.8 的可执行合同

固定 JAR SHA-256：`a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018`。本轮重新读取该 JAR 的五个相关类，确认字节摘要与既有静态解码一致；没有运行目标程序。

| 项目 | 原包规则 |
| --- | --- |
| `window` | 两个正弦极值周围共用的相位窗口，单位弧度；运行时取 `max(1e-6, window)` |
| `floor` | 速度倍率表达式中的下限系数；构造时限制到 `[0,1]`，不是另一端的区域宽度 |
| `easing` | 窗口内的倍率曲线。原 JSON 使用大小写敏感的源名称，例如 `SINE_OUT`；未识别名称沿用继承值 |
| JSON 默认 | `window=.5`、`floor=.25`、`easing=SINE_OUT` |
| 覆盖顺序 | 上述默认 → `settings.param_edge_easing` → 动作 `args.edgeEasing` → 具名参数 `args.parameters.<name>.edgeEasing`，每个已识别成员分别覆盖 |
| 数字解析 | window/floor 的数值对象读 Double，字符串用 Java Double 字面量解析；非法文字保留继承值，不计算 `PI/2` 之类表达式 |
| 具名开始 | 把最终 edge 配置转成运行时对象，再交给 `StartImplicitParamAnimation`；min/max/step 则先按源 Float 解析后扩为 Double，精度规则不同 |
| 全部开始 / 停止 | 全部开始继续已有注册配置；停止不把参数配置重新注册。动作级 edge 读取仍可能发生，不能用它覆盖已有注册表 |
| 直接 API 的空 edge | 原 Animator 另有 `.4 / .5 / SINE_OUT` 的空对象回退；这不是 JSON 具名开始的默认 |
| `attackRatio/releaseRatio` | 此 JSON 读取链不查询它们；存在时不改变 window/floor。若同对象另有合法 `easing`，该已识别成员仍照常生效 |

原 `speedScale` 先把相位约简到一圈，再计算到 `π/2` 和 `3π/2` 的最短角距离，取较小值 `d`。其核心为：

```text
q = clamp01(d / window)
gain = floor + (1 - floor) × easing(Float32(q))
```

两端使用相同窗口和相同 gain 表达式。参数更新为：

```text
half = (max - min) / 2
deltaPhase = abs(step) × stepScale × gain / half × (Float32(dt) × referenceFps)
value = (min + max) / 2 + half × sin(nextPhase)
```

`referenceFps` 是传入的实际 Float 帧率大于 1 时的值，否则为 60；Implicit 在 `dt<=0` 或未运行时不更新。负 step 通过启动时的相位分支决定方向；退化或反向范围直接写 min。源曲线返回 Float，再扩为 Double 参与倍率计算。gain 没有额外夹紧，带回弹的曲线不能被自行改为严格限幅。

源 Java Double 解析可以产生 NaN/Infinity；本地保持已有的有限数值与工作容量准入，明确拒绝此类配置。本说明不把这些本地拒绝边界描述成原版也会拒绝，不覆盖非有限数值的原版执行结果。

这解释了不能做别名的原因：`window` 同时改变两端减速范围，`floor` 改变倍率；指南的两个 ratio 则声称各自控制不同端点的范围。一个是共同窗口加倍率，另一个是两个区域，无法逐字段互换。

可使用的源 JSON 示例：

```json
{"method":"paramStart","args":{"parameters":{"a":{"min":0.5,"max":1.5,"step":0.02,"edgeEasing":{"window":0.5,"floor":0.25,"easing":"SINE_OUT"}}}}}
```

## 静态证据定位

下表的 PC 是相应 Java 方法内的字节码偏移。完整 class SHA 和保留文件 SHA 见[精简证据 fixture](../tests/fixtures/source-implicit-edge-contract/20261027.json)。

| 类 / 方法 | 定位与结论 |
| --- | --- |
| `ParamEdgeEasingConfig.defaults` | PC 4、7、10：`.5 / .25 / SINE_OUT` |
| `ParamEdgeEasingConfig.fromJson` | PC 36–77 读取 window；87–129 读取 floor；140–170 读取 easing。三个指定键之外没有 ratio 读取分支 |
| `ParamEdgeEasingConfig.toRuntime` | PC 0–16：按 windowRad、speedFloor、easing 构造运行时对象 |
| `JsonImplicitSurfaceConfig` 构造及配置读取 | 构造 PC 144–147 默认配置；settings 解析 PC 500–524 全局覆盖 |
| `JsonImplicitSurfaceConfig.buildParamActionAnimations` | PC 162–197 动作级继承；441–469 具名覆盖；489–494 转成运行时 edge 并创建动画 |
| `OscillationEdgeEasing` 构造 / `speedScale` | 构造 PC 5–21 夹紧；speedScale PC 8–30 对两个极值取距离最小值；39–55 窗口与 Float 曲线；64 起组成倍率 |
| `ImplicitSurfaceParameterAnimator.update` | PC 0–28 运行、dt、实际 FPS；213–238 选 edge；243–329 相位递推并写参数 |
| `ImplicitSurfaceParameterAnimator.<clinit>` | PC 4、7、10：直接 API 空 edge 回退 `.4 / .5 / SINE_OUT` |

保留解码为 `.cache/domain-param-peer-{ParamEdgeEasingConfig,OscillationEdgeEasing}-bytecode.json` 和 `.cache/source-implicit-parameters-20261024/*.javap.txt`。这部分是静态来源事实，不冒充本轮新增原版运行。

## 当前产品与字段保存

当前导入由 `sourceRegistryParameterConfig.ts` 解析一次，再交给同一 `sourceOscillatingParameterRuntime.ts` / `sourceOscillationEdge.ts` 执行。Implicit 的固定回放、实际录像和录像后的继续播放共用该参数所有者，没有为文档比例另建算法。

时间线控件显示「端点窗口 rad」「最低速度比例」「端点缓动」，对应 window/floor/easing；英文同样标明 window 的 rad 单位。这里的语义已经正确，本轮不改 UI。

项目保存与重开通过 `serializeScene / parseScene`：可执行的 `implicitParameters[].configuration.edgeEasing` 只接受 window/floor/easing，曲线保存为已解析的本地源枚举（例如 `sine-out`）。原导入 JSON 的未知 ratio 键仍保留在 `provenance.original` 并产生未映射提示；它们不进入可执行配置，也不会被删除、改名或猜测成别名。此处验证的是本地项目保存格式，不声称提供原版 JSON 的重新导出器。

## 已验证范围与关闭判据

既有[参数动画验收](source-implicit-parameters.zh-CN.md)包含 19+10+11+10 共 50 帧原版实际数值与画面记录。原版是 CPU 24³ 网格，384×288 品牌叠加前作品区域；四组均未显式配置 `edgeEasing` 或全局 `param_edge_easing`。因此它们证明 **JSON 默认 `.5/.25` 的已接通参数链**，不证明自定义 window/floor 的完整值域，更不证明独立 attack/release 模型。原版图像、数值与清理记录本轮只复核，没有重跑。

本轮新测试 6 项及既有导入/编辑测试 6 项，共 **12 项通过**，全仓 TypeScript 检查通过。覆盖公共导入、原始字段保留、保存重开、逐层覆盖、源字符串/曲线规则、canonical 未知 ratio 拒绝以及实际控件文案。首轮唯一失败是测试错误指定了不存在的中文语言值，按已有英文 Provider 合同修正测试后通过；未修改产品行为。

MAS-IMP-019 可按以下有限口径关闭：

1. 固定原包的真实字段、算法、两套默认入口及覆盖顺序已有上述来源定位。
2. 指南两处不同默认和字段语义冲突保留在证据中，验收条款改为 window/floor/easing 的源合同。
3. 原有 50 帧默认参数链及本轮 12 项字段/保存/UI 检查均明确限定范围；未知 ratio 保留但不执行，没有别名。
4. 状态使用「源合同已校正并验证列举范围」，不使用「支持独立 attack/release」，也不再写「参数动画尚未接通」。

本轮已采用这一合同校正方案；没有授权或实现一个独立 attack/release 模型。将来若需要这种扩展，应另起有名称和完整算法的本地模型，不改变 1.7.8 文件的语义。本条关闭不代表 Implicit 整族、其他家族或发行验收完成。

复查文件在 `.cache/source-implicit-edge-contract-20261027/`：`audit.json`、`tests-r1.log`、`tests-r2.log`、`tsc.log`。最终定向测试墙钟 2.83 秒；本轮未单独测量 CPU、峰值 RSS、GPU 或 agent token，不作性能变化声明。
