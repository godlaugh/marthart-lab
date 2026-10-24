# Domain 色板生成器与打开项目状态

2026-10-24。本批为开发中的 2.0 Domain 接入 Manual、Cosine 和 RGB Curve。使用已验证的共享生成算法，保持 Domain 原有的离散颜色渲染；没有添加连续 Cosine 渲染路径。

## 使用与保存

- 主色板与 CPU 回退色板编辑同一份颜色，并共享当前打开项目的生成器参数、数量和手动颜色快照。切换属性页不会使两个编辑器各自保留不同的草稿。
- 原版项目导入时读取生成器标志和参数，保留曲线节点顺序、空通道和两个标志同时开启的情况。打开外观面板只显示这些状态，不自动生成颜色或应用场景。
- 修改参数、数量或模式时，一次提交颜色和编辑状态，沿用 Domain 的完整应用行为。只返回 Manual 时恢复原颜色，保留本次编辑后的生成器参数；“应用为手动色板”保留生成结果。
- 保存和导出项目只保留最终颜色。保存操作保留当前打开的编辑状态；重新打开保存文件回到 Manual。导入原文仍保留在来源记录中，但不会再次用其中的旧参数覆盖当前作品。
- CPU 仍使用完整颜色列表，GPU 仍使用前 16 色。生成最多 25 色不意味着 GPU 会使用全部颜色；着色、公式、视口和故障回退的作者选择保持原有独立含义。

## 原版依据

固定 MathArt 1.7.8 JAR，SHA-256 为 `a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018`。本批复用既有数值向量和静态审计，仅补充静态字节码读取，没有运行原版应用或操作桌面窗口。

| 边界 | 证据与处理 |
| --- | --- |
| 生成器状态 | `ProjectState.fromJson` PC 1097–1413 读取标志、Cosine 系数与 RGB 曲线；`toJson` 的 Fractal 分支才输出这些字段，Domain 分支 PC 7015–7470 不输出。Domain 保存颜色，不保存生成器会话。 |
| 原子应用 | `domain.palette.colors` 在 registry PC 3495–3498 为 LIVE_VISUAL；`inspectorCommit` PC 131–133 执行 callback；Appearance 的 Bootstrap 79 绑定 `applyChanges`。Domain 在暂停和播放时均完整加载配置。 |
| 模式与双标志 | 编辑器 Curve 优先于 Cosine。普通参数/数量编辑不改标志，显式模式切换才使两者互斥。Domain renderer 始终只使用离散颜色。 |
| 导入数值 | ProjectState 的 `parseVec3` 使用 `JSONArray.getFloat`，不解释 `1/2` 这样的算式；直接 runtime-config 的 Cosine 配置仍按 ConfigUtils 表达式规则解释。两种入口共用明确区分的解析边界。 |
| 属性页寿命 | 原 `InspectorPanel` 在同一主体依次调用几何、设置、相机和外观，没有本地 Geometry/Appearance 切页条件。共享打开状态避免本地独有的切页与 CPU 回退编辑器造成状态分叉；不会将临时状态写入文件。 |

详细缓存：`.cache/fractal-domain-generator-owner-review-20261024/`、`.cache/roots-control-command-routing-review-20261024/` 和 `.cache/domain-generator-composition-lifetime-20261024/`。完整类、方法 PC 与文件摘要保留在各目录的 manifest 中。

## 状态归属

`domainSourcePalette.colors` 是唯一用于保存和渲染的颜色列表。`domainPaletteEditor` 明确属于打开会话，跟随本地草稿、撤销/重做和复制；其中的 Manual 颜色仅为返回手动时的快照，不参与渲染。

持久化边界统一排除会话字段，本地文件输入也不恢复它。渲染请求、Domain 完整应用配置和直接 renderer 入口在复制前排除会话字段，避免每帧携带曲线和手动快照。录制返回沿用当前作者文档，不把工作线程中的运行配置覆盖回编辑器。

Fractal 与 Domain 共用生成器导入解析器，保留两种入口的数值解释差异；不借用 Fractal 整份着色配置来解释 Domain 的无关字段。现有 Fractal 保存语义保持独立。

## 本地验证

最终回归 37 个文件、666 项通过，`build:v2` 的 TypeScript 和 Vite 构建通过，仅保留既有大 chunk 提示；i18n 自检与静态扫描没有必需 UI 翻译缺口。覆盖导入、双面板受控提交、保存与运行态投影，以及实际 Generator → Worker handler → 数值/CPU renderer → 队列的正常和延迟录制停止。录制测试只替换消息传输；确认返回当前 UI 文档和生成器状态，不能将其当作实际 App 录制操作验收。独立静态复核没有发现已证实的实质缺陷。

实际 App 的 CPU/GPU 两组、426 项检查通过，使用独立无窗口 Chrome。验证了主画布交付、暂停/播放期间完整应用、切页共享参数和 Manual 快照、撤销、保存后继续编辑、保存文件重新打开，以及两个 256×192 PNG 的实际捕获→增强 Worker→下载摘要链。CPU 修改第 32 色会改变实际 RGBA；GPU 前 16 色边界下同一修改不改变 RGBA；一次撤销精确恢复全部 32 个原颜色字符串。所检查的实际 Worker 请求不含临时生成器状态；最终 wire 数组保留的是重开后的请求，传输边界另有 client/handler 测试覆盖。

最终源码验收总耗时 29.297 秒，进程族采样 CPU 41.95 秒、峰 RSS 2,679,984 KiB，无页面错误；源码全程稳定，浏览器、Vite、导出服务均已关闭，遗留服务进程为 0。记录在 `.cache/domain-gradient-app-final-20261024/`，其中包含可读报告、App 截图、两个 PNG 和保存文件。前一次有效验收留在 `.cache/domain-gradient-app-1792824056139/`。首轮脚本同时发送两种颜色事件，造成两次提交和一次撤销不匹配；修正为单次用户提交后，两种后端的 revision 都只增 1。失败记录保留在 `.cache/domain-gradient-app-1792824003675/`，没有修改产品迎合该断言。

共享组件的 Fractal 实际 App 回归两组、185 项通过，源码全程稳定，浏览器和服务均已退出。最终 Domain 控制器只做了类型明确的声明提取，Fractal 的共享组件与导入器没有再变更。

扩展回归发现两个 Domain 旧断言混淆临时状态与持久化数据，已保留全部参数/执行检查并改用对应投影。旧独立色板测试的 Mandelbrot 样例已走源色板路径；完整 `511dee4` 源码快照也重现五项失败。将样例切换到仍使用独立色板的 Phoenix，并明确断言不启用源色板，保留全部颜色计算、512 色、别名和拒绝规则的检查，没有删除测试或改变产品导入来迎合它。

这些是本地产品交付证据；没有运行原版，也没有声明原版整图一致。

可复查索引：[本批来源与验收摘要](../tests/fixtures/source-palette-live/domain-20261024.json)。它区分原版静态依据、旧数值向量与本地 App 证据，不将它们合并成原版运行结论。

## 相同操作的成本

基线为 `511dee4` 的 App 和 DomainColorControls，其他依赖两组均使用当前版本，因而只比较这两个入口的改动。两次独立无窗口 Chrome 顺序运行：打开相同作品与外观面板，再执行六次手动 RGB 修改，均等待真实 Worker 和 renderer 交付。初始帧和六个修改帧的完整 RGBA 序列一致。

| 测量 | 修改前 | 修改后 |
| --- | ---: | ---: |
| 冷启动至外观可用 | 1.625 秒 | 1.583 秒 |
| 冷阶段进程族 CPU | 3.09 秒 | 3.11 秒 |
| 冷阶段峰值 RSS | 1,416,192 KiB | 1,417,072 KiB |
| 六次手动修改 | 1.560 秒 | 1.540 秒 |
| 修改阶段进程族 CPU | 1.63 秒 | 1.61 秒 |
| 修改阶段峰值 RSS | 1,485,296 KiB | 1,482,256 KiB |

每组一次，CPU/RSS 每 250 ms 采样；短暂子进程与瞬时峰值可能遗漏。没有清除系统或驱动缓存，未计浏览器启动、Vite 准备、Node/Vite CPU 与内存、GPU 时间/显存或 agent tokens；不能据此推断普遍加速。源码全程稳定，两个 Chrome 进程族和 Vite 都已退出。

可重跑脚本为 `scripts/benchmark-domain-palette-editor.mjs`。最终源码成功记录在 `.cache/domain-palette-editor-cost-20261024/run-shPKJQ/report.json`，类型声明提取前的有效测量保留在 `run-I0yNOZ`。首跑误将初始 `startAt=0` 重建帧等同于显式应用的时间 0；基线和候选均拒绝该断言。修正验证器以区分初始重建与应用动作后通过，失败记录保留在 `run-BdDqfQ`，产品代码没有为此调整。

## 仍需后续验证的范围

- 原版匹配输入下的整图效果，以及所有公式、长期动画和录制组合，不由本批生成器界面矩阵证明。
- 原版 Appearance 对空/单色色板的临时补齐尚未统一接入；本地加载继续保留输入原文。
- 整个 Inspector 关闭/重开时原版 remember 状态的实际寿命没有新增运行验证。
- 实际 App 的录制操作和同 ID 文件替换没有纳入本批矩阵；录制状态交接有生产边界测试，同 ID 替换有对象级测试和静态复核。
- 其余场景需求、通用能力和 Apple Silicon 最终集成发行仍在 2.0 Goal 内；已安装的 1.0 应用没有更新。
