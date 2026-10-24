# Roots / Perlin 色板生成器与热更新验收

2026-10-24。仍处于 **M3：场景补全与效果一致性验证**。本批接入 Roots、Perlin 的手动随机、Cosine 和 RGB 曲线生成器，并修复 Perlin 调色导致模拟重建的问题。

## 使用变化

- Roots 密度、Roots 点云、Perlin CPU 粒子、Perlin CPU 场线、Perlin GPU 纹理均可在外观面板切换生成器。
- 改参数、改生成数量立即更新作品。切回 Manual 恢复进入生成器前的色板；「应用为手动色板」保留生成结果。
- 保存的是生成后的颜色。重开作品时，生成器回到 Manual，临时曲线和 Cosine 参数不持久化。
- Roots 保留颜色原文；Perlin 的手动快照保留完整 ARGB，包括原透明度。新生成颜色为不透明 RGB。
- Perlin 实时预览调色保留当前播放时间、粒子/场线几何、渐变动画状态和画布。此前色板被包含在重建身份中，改色会从零开始。

## 原版证据与修复边界

固定 MathArt 1.7.8 JAR 的 SHA-256 为 `a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018`。本批新增的是**静态字节码审计**，没有运行原版或操作桌面窗口。Cosine / Curve 数值算法沿用此前已执行的 61 个原版案例，本批没有重新执行它们。

精确 Bootstrap 复核纠正了早期报告中的错误：Appearance 的 callback #79 调 `applyChanges`，属于 Domain；#80 调 `updatePaletteOnly`，属于 Roots、Perlin 等适用场景。`inspectorCommit` 保留调用方 callback，不会把这条热更新替换成完整重建。旧 `.cache/common-gradient-followup-audit-20261024/roots-domain-perlin-gradient-audit.md` 中 Roots/Perlin full reload 的结论已撤回，以新审计为准。

| 边界 | 原版静态结论 | 本地处理 |
| --- | --- | --- |
| Perlin 即时颜色 | `updatePaletteOnly` 的八位颜色解析强制 alpha FF | 仅在实时色板应用时转成不透明颜色，保存值不改写 |
| Perlin 几何 | `applyPalette` 更新颜色/显示缓存，不重建场景 | 将色板变化与结构变化分开，调用既有颜色状态拥有者 |
| Roots 专用 reset | `resetForPaletteChange` 只写 `pointCloudShapeDirty=true` | 不重启求根、不清密度墨迹或点云历史 |
| 冷配置 | 热更新、Save 均不写 `currentJsonConfig` | 本批修正 Perlin 的配置快照；Roots 录制配置边界仍待接入 |

录制有一个原版行为需要特别说明：工具栏开始录制前会 reset 场景，因此使用最后一次完整应用/加载的配置。仅热改色后直接录制，可能使用此前的色板；保存文件并不更新这份运行配置，重新加载保存的作品才会更新。本批对 Perlin 分开管理这两份状态，并确保录制结束不会把旧色板写回用户保存的作品；不将这个结论扩展到 Roots 录制。

新审计入口为 `.cache/roots-perlin-generator-route-review-20261024/README.md` 和 `.cache/roots-palette-reset-review-20261024/review.zh-CN.md`。前者保留回调绑定、热解析、冷配置所有赋值点；后者保留 Roots reset 全方法及工具栏录制调用证据。

## 已执行验证

相关源码测试 **529 项、17 个文件通过**。其中新增测试覆盖三种 Perlin 显示模式的热改色、几何/时钟/目标保留、原 alpha 保存、结构编辑仍重建，以及录制前后冷配置与保存值分离。图形目标被替换的单元测试只证明状态所有权，不作为原版像素证据。

真实 Chrome WebGL2 / Generator / Worker 流程 **36 项检查通过**：暂停改色确实改变 GPU 像素，时钟与更新数不变；截图仍可用；录制 warmup 与同输入冷配置控制实例逐字节一致；录制结束后不会自动把保存色板重新热应用。3 个所属 Worker 全部终止，浏览器及 Vite 关闭，运行前后源文件摘要一致。耗时 6.90 秒，该脚本未单独测量进程族 CPU/RSS。

`build:v2` 通过，保留已有的大块体积提示。

真实 App 界面验收 **5 组、247 项检查通过**：32 色输入从生成器上限 25 色开始，修改到 9 色，验证 Cosine 参数、曲线节点、Manual 精确恢复、应用为手动、保存重开与项目下载。每组 Cosine、Curve 都确实改变已呈现的画布；Roots 采样实例保留，Perlin 已播放后暂停的时间、更新数、实例保持不变。

| 模式 | 实际 PNG | 解码后不同颜色数 |
| --- | --- | ---: |
| Roots GPU 密度 | 451×382，同物理尺寸 | 62 |
| Roots GPU 点云 | 451×382，同物理尺寸 | 77 |
| Perlin CPU 粒子 | 256×192 | 1,038 |
| Perlin CPU 场线，INDEX 配色 | 256×192 | 99 |
| Perlin GPU 纹理 | 256×192 | 10,099 |

五张 PNG 解码后的 RGBA SHA-256 均与实际截图输出相同。场线明确使用 INDEX；seed-space 配色中的固定颜色团属于另一种已有语义，未由本批断言其热色板变化。粒子使用轨迹显示，保存重开后先正常播放形成可见轨迹，再暂停截图；截图本身不推进模拟。

首次验证中的假设错误已保留：Roots 默认相机使合成平面输入近乎侧视；Perlin 暂停控制确认不会自动生成一张新帧；粒子冷起点尚无足够轨迹顶点。验证器改为明确相机输入、观察独立暂停确认，并等真实更新形成轨迹。没有为测试改变产品或降低非空图像要求。Roots 换尺寸清屏失败另列在下方限制中。

最终 App 流程耗时 **30.10 秒**（总收尾时间 31.82 秒），采样进程族 CPU **49.39 秒**、峰值 RSS **2,279,456 KiB**，无采样错误。这是一次流程测量，没有 App 改动前性能基线；未测代理 token、设备 GPU 时间或显存。源文件前后摘要相同，页面未捕获异常，浏览器/Vite/导出服务均关闭，服务所属进程数为 0。已检查 Roots 密度和 Perlin GPU 的页面截图。

完整 App 记录、五张 PNG、页面截图与前序失败说明保存在 `.cache/roots-perlin-gradient-app-1792819330383/`。可复跑脚本为 [五组界面验收](../scripts/verify-roots-perlin-gradient-palette.mjs)。

## 热更新成本对比

在独立 Chrome 进程中顺序运行两版相同操作：固定种子、48×36 GPU 输出，初始化后运行 100 ms 并暂停，连续提交 8 次不同色板，每次完整交付像素并计算摘要。基线只替换为提交 `78767059` 的 `sourcePerlin.ts`，其余依赖均使用当前版本，因此衡量的是本次会话修复，不是两个完整历史发行版。

| 阶段 | 修复前耗时 | 修复后耗时 | 修复前 CPU / 峰值 RSS | 修复后 CPU / 峰值 RSS |
| --- | ---: | ---: | ---: | ---: |
| 首次初始化、播放、暂停 | 1,093.1 ms | 1,129.8 ms | 1,670 ms / 1,216,416 KiB | 1,720 ms / 1,216,560 KiB |
| 已初始化后的 8 次调色 | 5,753.0 ms | 19.5 ms | 6,250 ms / 1,286,640 KiB | 10 ms / 1,217,616 KiB |

旧版每次调色回到时间 0 / 更新数 0；新版保留 100 ms / 更新数 1。减少的工作正是原来多余的模拟和图形资源重建。两版输出状态不同，不声明图像相等或所有尺寸都获得这一比例的加速。

这是每版一次的样本；未清操作系统/驱动缓存。首阶段包含 Worker 模块导入，排除浏览器启动和主页面导入；CPU/RSS 只采样 Chrome 进程族，不含 Node/Vite。新版暖阶段仅取得首尾两次样本，10 ms CPU 接近 `ps` 的计量粒度，峰值可能漏采；未测 GPU 时间、显存和代理 token。两版各 1 个 Worker 全部终止，Chrome 退出码均为 0，Vite 关闭，实际加载代码摘要符合所选版本，源文件前后不变。

脚本为 [热色板成本基准](../scripts/benchmark-source-perlin-palette.mjs)，本地证据为 `.cache/perlin-palette-cost-20261024/run-oWyHVS/report.json`。

## 尚未关闭的范围

- 本批没有新增原版 GUI 或热改色前后整图像素对照；本地流程通过不等于五种模式已经完成原版效果验收。
- 原版进入 Appearance 会修改空/单色色板，补足两色但暂不提交；本地仍优先保留原保存值。短列表补齐、手动快照与运行状态的完整对应还未实现。
- 原版空色板热命令是 no-op；Roots 当前手动编辑为空会得到白色，Perlin 规范配置仍拒绝空色板。这些不是原版项目文件格式限制。
- 本批结束时 Perlin 仍按规范色板值的变化识别热编辑；后续 [显式色板命令修复](source-perlin-palette-commands.zh-CN.md) 已处理保留实例上的同值再次提交。原始非标准颜色字符串的 UI 热解析仍未完成。
- Roots 已有录制流程仍从当前作品构造，尚未接入本次发现的独立冷色板快照；本批只验其预览热改色与截图，未验热改色后的录制对应。
- 原版 Roots GPU 以 32 位数组 hash 判断色板缓存，存在碰撞；本地比较实际颜色内容。本批不声明这类异常输入相同。
- Roots 密度求根完成后，将暂停截图改为另一物理尺寸会清除密度墨迹；没有待画点时，导出和返回主预览均可能为空。本批 256×192 试验实际复现了这一已有路径，未把空图判为有效作品，也没有通过重新求根掩盖该行为。同尺寸截图与任意尺寸截图的范围必须区分。
- 此后 [Fractal 生成器接入](source-fractal-gradient-generators.zh-CN.md) 已完成本地界面验收。Domain、Implicit、Symmetry、Samila 的生成器接入，以及全部 11 个场景家族的未决需求、通用能力、原版效果对照和 Apple Silicon 最终集成发行仍在 Goal 内。

已安装的 1.0 应用没有更新。此处验证的是开发中的 2.0。

实现入口：[共用生成器](../src/components/SourceGradientPaletteEditor.tsx)、[Perlin 色板编辑器](../src/components/SourcePerlinPaletteEditor.tsx)、[Perlin 实时会话](../src/scenes/sourcePerlin.ts)。验证入口：[来源摘要索引](../tests/fixtures/source-palette-live/README.md)、[状态回归](../tests/source-perlin-live.test.ts)、[真实 Worker 验证](../scripts/verify-source-perlin-live.mjs)。本地回归和构建日志保存在 `.cache/roots-perlin-generators-20261024/`。
