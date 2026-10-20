# Samila 数学配置与投影验证

2026-10-21，2.0 的 M3 实现阶段。这一批修正新导入 Samila 的配置读取、公式解释、26 种函数组合和 6 种投影。原版 JVM／JOGL 整图一致性仍为 **0/11**；没有打包或替换现有 1.0 Apple Silicon 应用。

## 使用与兼容

重新导入原版 Samila JSON 会启用数学版本 `mathart-1.7.8`。已保存的本地作品，包括上一批只有 `source-ndc-v1` 视口标记的作品，不会自动升级数学规则。开发接口 `parseLegacyScene(text, {samilaMath:'legacy-v1'})` 可保留旧数学导入；已有视口和相机退出选项仍有效。

| 输入 | 新规则 |
|---|---|
| 根级 `samila` | 整个对象优先于 `settings` 的六个数学字段；缺项使用原版缺省值，不从 `settings` 补齐 |
| 省略公式 | 固定为 `sin(x*y)` 与 `cos(x-y)`；显式空白公式为零 |
| 参数 | 缺省为空；着色器的 a／b／c／d 缺值为零；可使用 e／f 等显式参数 |
| 数值字段 | 按原版字面量 getter 读取，不把 `PI`、`1/2` 当数值表达式 |
| 采样范围 | 先比较 double 上下界，再转换为 float32；保留反向、相等及转换后重合的原始范围 |
| RANDOM 组合／投影 | 按原版当前绘制路径分别落到 f1_vs_f2／直角坐标，不按种子选择 |
| 公式 | 复用原包 FastExpressionParser 对应的解析与 GLSL 生成规则；显式参数优先于同名常量 |

公式不隐式注入 t／time；如需使用，必须显式声明对应参数。原模板中 PI 声明晚于插入的公式函数，其它命名常量也没有对应声明；这些常量的公式使用会明确拒绝，不在移植时暗中修复。显式参数 e 或小写 pi 仍按变量优先规则处理。

原始 JSON、未消费字段及已登记数值词法保留在来源记录中。非有限文档值、不支持的参数标识符和超出本地容量的输入会明确报错。有限 double 参数若转换成无穷 float，上传值按源规则变为零，作者值仍保留。

## 数学差异与验证边界

新 GPU 分支直接保留源数学公式：地理投影不做旧本地经纬归一化；Aitoff 不额外乘二；Lambert 保留下限；Mollweide 按近极点分支或固定五次 Newton 更新。两条公式在组合之前都须得到有限值，即使某个组合没有使用其中一条结果。

独立参照从固定安装包重新提取 `samila_splat.vert`，在同一 Chrome WebGL2 环境单独编译原函数；期望值不来自生产实现。该方法验证函数翻译及生产 GPU 接线，不等于运行原版应用，更不等于整张作品一致。

CPU 是派生路径。其 JS 数学函数、表达式中间精度与 GPU 运算有差异；零向量的 GLSL `atan(0,0)` 未定义，极大值、投影奇点及高频三角函数也可能产生明显偏差。CPU 或自动回退的结果会显示限制说明，不承诺与 GPU 逐位一致。

另以原模板的实际插入位置验证命名常量：只转换 GLSL 版本和精度声明，插入返回 PI 的公式后，Chrome 编译器报告 `PI: undeclared identifier`；预先声明的参数 pi／e 均编译成功。没有移动原模板常量声明或执行绘制，报告为 `.cache/samila-declaration-order/report.md`。

## 本轮实测结果

全套 **312 个测试文件／5,759 项测试通过**，耗时 97.53 秒；TypeScript 与 Web 构建通过，保留既有大 bundle 提示。

| 对照路径 | 样本 | 结果 |
|---|---:|---|
| GPU 数学函数 | 2,369 | 全部在阈值内；最大归一化误差约 3.41e-7 |
| 实际 GPU 生成入口 | 2,028 | 全部在阈值内；最大归一化误差约 5.37e-7 |
| CPU 派生函数 | 2,369 | 2,240 在阈值内；129 条差异中有 39 条有限／非有限分类差异 |

阈值为 `abs(actual-expected) / max(1,abs(expected)) ≤ 2e-5`。CPU 差异集中在零向量、地理范围外、Lambert 对跖点和平方溢出输入；没有放宽阈值或把这些差异改记通过。原参照重建耗时 1.26 秒，最终对照耗时 4.81 秒。

真实 App 在 DPR 1 下完成原版 JSON 导入、保存、清空为另一个场景后重新导入保存文件、192×128 PNG 及 3 帧／3 fps MP4。PNG 完整 RGBA 与导出 Worker 一致；FFprobe 确认视频尺寸、帧率与帧数，三个上传 PNG 的完整 RGBA 分别与对应 Worker 一致。本轮公共流程耗时 7.02 秒，源码哈希前后稳定，浏览器、开发服务与导出服务均成功关闭，Worker 错误为零。

公共夹具来自固定原包 `data/samila/Samila.json`，明确使用每批 256 点、GPU、点尺寸 2、alpha .8、关闭拖尾及一秒等待片段。它验证当前数学版本的公开链路，不代表原版高批次负载。DPR 2 手势验证属于[上一批视口记录](samila-source-viewport-validation.zh-CN.md)，没有冒充本轮重新执行。

翻译审计自测通过，但整体审计仍因 **76 处既有界面翻译缺口**失败；这些原文全部存在于基线 `24b4265`，且均未在其翻译表中登记。本轮新增界面文案已补英语。详细基线核对在 `.cache/samila-math-i18n-baseline-comparison.json`，未将整体审计记为通过。

本地完整报告为 `.cache/samila-math-comparison-final/report.md` 和 `.cache/samila-source-math-public-final/report.md`。以下脚本纳入 Git，需现有 Chrome、固定原包和本地静态研究缓存；视频验证还需 FFmpeg／FFprobe。它们不是新克隆的默认检查，也不会安装系统依赖：

```sh
node scripts/build-samila-source-math-oracle.mjs
node scripts/verify-samila-source-math-gpu.mjs
node scripts/verify-samila-source-math-public.mjs
```

## 尚未完成

采样仍采用本地可重放随机流。原版活动渲染器每帧取得新的随机种子，未消费配置中的 seed／func_seed；保存这些字段不能证明原版随机序列已复刻。时间线调度、噪声颜色、点覆盖与透明合成、窗口热调整及原版整图对照仍是独立待完成项。

本批不提出性能提升结论。验证记录中的耗时只覆盖相应测试；完整 agent token、进程族 CPU／峰值内存、GPU 驱动内存及等价原版端到端基线未测量。

## 原包证据

固定 `MathArt-1.7.8-b07191b3e97da6fe465555ef6e61a0be.jar`，SHA-256：`a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018`。

`BaseSamilaConfig` 和 `JsonSamilaConfig` 负责缺省值与根级对象优先级；`SamilaExpressionCompiler` 负责固定符号和公式生成；`SamilaMobject.drawSplatBatch` 负责区间、模式及随机种子上传；`uploadSplatShaderParameterUniforms` 负责参数 float 转换。Processing 的 `JSONObject` 定义 getString／getDouble／getInt 读取差异。

本地审计为 `.cache/v2-samila-math-config-audit.md`，15 个类的身份清单及完整五个内置 Samila 配置在 `.cache/v2-samila-math-source/`。这些是静态包内证据，不是原版窗口截图。此前视口与手势的独立验证见[Samila 源视口记录](samila-source-viewport-validation.zh-CN.md)。
