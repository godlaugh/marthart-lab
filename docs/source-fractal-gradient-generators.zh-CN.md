# Fractal 色板生成器接入与验收

2026-10-24。本批仅接入开发中 2.0 的 Fractal Cosine / RGB Curve 编辑器，保留已有 Manual 编辑。Domain 和其它场景的后续接入不在本批完成范围；已安装的 1.0 应用没有更新。

## 使用变化

- 外观面板可以切换 Manual、Cosine、RGB Curve，调整生成数量、Cosine 系数和曲线节点，或随机生成参数。
- Fractal 的生成参数与颜色一起保存。重新打开项目会恢复参数和模式；打开外观面板本身不应用或重写颜色。
- 切回 Manual 只恢复进入生成器之前的颜色，保留刚编辑过的系数、曲线、偏移、伽马和插值空间。「应用为手动色板」保留生成后的颜色。
- 暂停时编辑使用现有分形应用路径，保留当前动画进度；播放时应用从头运行。录制仍遵循既有完整加载快照规则。
- 已导入的两个生成器标志都为 true 时，编辑器显示 Curve，而作品仍按连续 Cosine 渲染。编辑参数不会偷偷修正标志；显式切换模式或应用为 Manual 才统一标志。界面对此显示说明。

## 原版证据与状态边界

依据固定 MathArt 1.7.8 JAR，SHA-256 为 `a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018`。本批实现没有启动原版应用、原版 JVM 或 GUI；复用既有数值 oracle 和静态字节码审计。

| 内容 | 原版边界与本地处理 |
| --- | --- |
| Cosine 渲染 | Inspector 生成 2–25 个离散 RGB 字符串；Fractal 作品仍由独立连续 Cosine 路径生成 1024 色 LUT。两条路径的公式精度和采样点不同，不能混用。 |
| Curve 渲染 | RGB 曲线生成离散颜色供原有色板纹理采样。曲线节点本身不进入 renderer。 |
| 双标志 | UI 的 Curve 优先级与 runtime 的 `useCosine` 是两个事实。参数/数量编辑保留标志；显式模式事件使其互斥。 |
| 缺省曲线 | 原 `ProjectState` 构造器每通道为 `(0,0)`、`(1,1)`。缺字段保留默认；显式空数组才清空。只有三通道明确为空且用户切入 Curve 时，才调用已有随机曲线生成器。 |
| 导入与加载 | 保留字段遗漏、原节点顺序、重复 x 和越界值。编辑时才使用既有原版规范化/生成器；加载不生成新颜色、不提交。 |
| Manual 快照 | 保存颜色原文，包含 alpha、无效字符串、空/单色与超过 25 色的尾部；恢复只替换颜色。 |
| 编辑身份 | 本地曲线节点 ID 随本地项目保存；原生项目导入时新建 ID，原版 `curveToJson` 仅写 x/y。本批没有新增原生项目导出器。 |
| 旧项目兼容 | 本地旧配置没有 `useCurve` / `curves` 时仍保留遗漏。源 Project 入口默认 Manual/七色；直接 runtime-config 入口默认 Cosine/六色。 |

详细来源保存在 `.cache/fractal-domain-generator-owner-review-20261024/README.md` 与 `manifest.json`，包括原类/缓存摘要和方法 PC。缺省曲线还由已执行的 `.cache/source-project-palette-20261024/run/oracle.json` 的 `FRACTAL-absent` 案例印证：三个 `savedColor.curve_*` 都为两个 ramp 端点。`ProjectState.<init>()V` PC 4214–4346 构造三组曲线；`fromJson(JSONObject)V` PC 1306–1413 只有存在键时解析；`parseCurve(JSONArray,List)V` PC 1 清空原列表。

共享编辑器新增可选受控适配器，Fractal 的 canonical owner 一次接收参数和生成颜色。原有通用调用者继续只保存颜色，保留其临时生成器行为。独立审阅发现并修复了一个状态泄漏：受控曲线编辑曾覆盖通用草稿，恢复默认或 Undo 到缺省字段后会重新带回旧节点。现在缺省 ramp 使用独立初值，受控编辑只更新 Fractal owner。

## 已执行验证

使用锁定 Node 24.18.0 / npm 11.16.0。以下为实际执行结果，不将组件 hook 模拟或纯数值测试当成浏览器画面证明。

| 验证 | 结果与覆盖 |
| --- | --- |
| 合并回归 | **25 个测试文件、653 项通过**，涵盖本批 Perlin 和 Fractal 配置/导入保存、连续 LUT、双标志、Manual 恢复、原子回调及受控状态重置；早期子集结果不重复相加。另已执行的 Fractal apply/live session 回归通过。 |
| 实际 App / Worker / WebGL2 | **2 组、185 项通过**：模式与参数、三模式保存重开、双标志、仅恢复颜色、烘焙、恢复默认和 Undo。Cosine 数量变化不改变实际连续渲染像素；参数修改会改变像素。 |
| PNG | 两张 **256×192** 图片分别包含 216 / 217 种颜色。捕获 RGBA 与增强 Worker 输入 SHA-256 相等，实际下载 PNG 与 Worker 编码 Blob SHA-256 相等；导出不改变主预览或动画时间。 |
| 共享调用者 | Surface / Attractor 实际界面 **4 组、96 项通过**；Roots / Perlin **5 组、269 项通过**。 |
| i18n 组件测试 | 合并回归内 **19 项通过**；新增 Fractal 双标志与持久化说明英文渲染、无加载提交。 |
| i18n 审计 | `check-i18n.mjs --self-test` 通过；3311 个目录条目，必需 UI 缺口 0、目录问题 0、元数据缺口 0。 |
| 构建 | 最终 `npm run build:v2` 通过，包括 TypeScript；仅有已有的打包体积提示。 |
| 独立源码复核 | `.cache/fractal-generator-controller-independent-review-20261024/`；发现的受控 fallback 泄漏已修复并关闭，其余限定 owner 边界未发现实质缺陷。 |
| 既有着色全流程 | `verify-fractal-source-color-ui.mjs` **9 个阶段、16 组校验通过**：固定颜色、零索引、无命中陷阱、参数、传递函数、渐变启动/停止/定位、保存重开及本地/原版规则切换。257×193 恒定颜色用例的 PNG 解码 RGBA 摘要与真实导出 Worker 相同。 |

新的边界测试证明：Cosine 数量 2→25 会改变保存列表，但连续 LUT 字节不变；修改 A 会改变 LUT。只修改 Curve 作者元数据不改变运行身份/LUT。双标志下 Curve 参数编辑保留连续 Cosine，显式切 Curve 才使用生成列表。保存往返保留 raw 来源与 canonical 编辑参数。

实际 App 总耗时 43.626 秒，其中两组交互流程 41.793 秒；Chrome 进程族采样 CPU 48.27 秒、峰值 RSS 2,322,032 KiB，142 次采样无错误。包含像素摘要观测，未测 Node/Vite、GPU 时间/显存和代理 token，也没有 Fractal 前后性能对比。源文件摘要前后相同；浏览器、Vite、导出服务全部关闭，遗留服务进程 0。图片与实际 App 截图均已查看，具有可见分形细节。

可读运行细节位于 `.cache/fractal-gradient-app-1792821696724/README.md`；缓存和 SHA-256 见 [证据索引](../tests/fixtures/source-palette-live/followup-20261024.json)。两次早期失败的脚本断言保留在独立目录：暂停 draw 序号应递增，且当前 PNG 在 1× 也有既有增强步骤。最终断言按真实 owner 契约校正，未为验证更改产品行为。

既有着色脚本原来使用过期的 checkbox、连续时间轴、自动应用和导出 renderer 假设。本批将它迁到现有模式选择、逐帧队列、显式应用与独立导出 Worker；本地规则切换保留在仍支持该入口的旧文档中验收。定位依据固定 `startAt`，不把用户输入秒数误当成随后实际显示帧的时间。原覆盖保留，产品未为脚本修改。最终全流程耗时 59.433 秒，源码稳定、浏览器/Vite 已关闭；报告位于 `.cache/fractal-source-color-ui-run-1792822518120/report.json`。此流程未单独测量 CPU/RSS。

测试入口：[Fractal 作者状态](../tests/fractal-source-palette-generator.test.ts)、[共享控制器状态](../tests/source-gradient-palette-controller.test.tsx)、[Fractal 控件](../tests/fractal-source-color-controls.test.tsx)、[英文渲染](../tests/source-controls-i18n.test.tsx)。相关算法、配置和运行测试分别为 `source-gradient-palette-generation`、`fractal-source-color`、`fractal-source-color-integration`、`source-fractal-apply`、`source-fractal-live-session`。

## 未由以上测试证明的范围

- 本次 App 矩阵没有覆盖录制、长时间播放和其它分形公式。没有新增原版整图对照，也不宣称全分形画面一致。
- 原版 Appearance 对空/单色列表会做临时补齐；本地继续保护导入原文，不在打开面板时改保存值。当前曲线通道、生成数量和 Manual 快照为编辑器临时状态，不能推断为原生文件字段；曲线节点与 Cosine 参数随项目保存。
- 非有限数值按产品策略拒绝；没有通过 NaN/Infinity 输入宣称原版等价。
- 本批没有 Fractal 性能前后基准，实际 App 的 CPU/RSS 采样只建立当前流程成本，不建立性能改进结论。

实现入口：[Fractal 作者操作](../src/engine/fractalSourcePaletteEditing.ts)、[Fractal 配置与运行投影](../src/engine/fractalSourceColor.ts)、[Fractal 色板界面](../src/components/FractalSourceColorControls.tsx)、[共享生成器界面](../src/components/SourceGradientPaletteEditor.tsx)。
