# 项目默认色板：导入、保存和生成器数量验收

2026-10-24。本批修复了「原版项目没有写 palette 时，部分场景使用了渲染器默认色板」的问题。仍处于 **M3：场景补全与效果一致性验证**。

## 用户可见变化

导入没有填写根 `palette` 的 MathArt 项目时，九类支持共用生成器的场景现在取得原版项目的七色：

`#FC6255`、`#FF862F`、`#FFFF00`、`#59743E`、`#83C167`、`#1D4A81`、`#9A72AC`。

此前 Roots 可能落到渲染器的四色默认值，Surface、Attractor、Domain、Samila 等可能落到六色。Symmetry 原有的七色常量也已归入共同的项目入口，避免各场景维护不同解释。

Surface 和 Attractor 的 Cosine/Curve 编辑器会据此从 **7 色**开始。Fractal 在项目未指定模式时使用手动色板；直接读取运行时配置仍保留其原有 Cosine 默认。显式颜色和 Cosine 参数不会在加载时自动重新生成。

原始项目的省略信息仍保留在来源记录中。保存为本地作品后重开，读取已保存的颜色；旧作品不会被重新替换默认色板。

## 原版验证依据

原版不是直接把文件交给渲染器：`MathArtSession.loadProject` 先调用 `ProjectState.fromJson`，再将 `toJson` 的结果交给场景。项目入口会把缺省色板实体化为七色；独立渲染器的默认值属于另一条入口。

对固定 MathArt 1.7.8 JAR 进行了 **84 个无窗口原版案例**：12 类场景各覆盖缺省、空数组、单色、原字符串、null、对象、混合非字符串数组。

| 输入 | 原版观察 |
| --- | --- |
| 未填写 palette | 清除之前的色板，补七色 |
| 空数组 | 保留空数组，不当作缺省 |
| 单色或合法字符串数组 | 保留数量、顺序和原字符串；不裁到 25 项 |
| null、非数组或非字符串成员 | 抛出类型错误，不替换成默认色板 |

48 个成功案例与 36 个预期错误均保留。原版错误可能留下已读取的字符串前缀；本地先验证再提交，避免半更新作品。项目准备阶段设置 65,536 色及 1 MiB UTF-16 文本预算，这是本地资源限制。

使用现有 Temurin 21.0.7，调用公开状态方法，未启动原版应用窗口。原 JAR、依赖和工具身份在运行前后相同；目标和编译进程 exit 0，所属进程组均已退出。首次收尾审计因白名单未包含 Fractal 公式元数据初始化类而失败；独立静态审查确认 18 个相关类只构造内存表、枚举和配置后，只读完成验收，没有重跑原方法。首次错误报告完整保留。

## 实际应用验收

无头 Chrome 操作真实 App 的文件导入控件，覆盖 Surface、Attractor、Fractal、Implicit、Domain、Roots、Perlin、Symmetry、Samila，**44 项检查通过**：

- 九类项目的七色实际进入生成器/渲染器输入。
- 原始项目中未填写 palette 的事实保持不变。
- 保存、重开、下载项目 JSON 后颜色与来源仍一致。
- Surface、Attractor 切换生成器时数量为 7，切回手动恢复七色。
- Fractal 项目缺省模式为手动。

该流程使用 WebGL 策略；本批没有新增 CGL、原版 GUI 或原版整图像素一致性的结论。已查看 Surface 的实际页面截图，作品正常显示。浏览器和辅助服务均已关闭，无所属辅助进程残留。

源测试共 **344 项、13 个文件通过**。其中补充回归发现 Samila 旧测试仍断言项目缺省六色及旧错误措辞，已按原版证据修正并重新通过。`build:v2` 通过，仍有已有的大块体积提示。

| 流程 | 耗时 | 采样进程族 CPU | 采样峰值 RSS |
| --- | ---: | ---: | ---: |
| 原版编译及 84 案例 | 2.44 秒 | 1.86 秒 | 339,600 KiB |
| 九类实际 App 导入/保存/导出 | 23.20 秒 | 52.02 秒 | 2,489,968 KiB |

这些是验收流程测量，不是性能提升声明。未拆分冷热运行，无改动前等价性能基线；本批代理 token 成本未单独测量。短命进程可能漏采，CPU/RSS 为采样值。

## 保留的限制与下一步

这次只修正共同项目色板入口和 Fractal 的缺省模式。各场景其他字段仍有项目入口与运行时入口差异，不能由此宣称完整项目导入一致。Surface 渲染器仍拒绝空色板；Domain 仍使用较窄的颜色字符串校验，这些下游约束没有被伪装成原版项目格式限制。

七类生成器的下一步接入已核清关键差异：

| 场景 | 后续接入必须保留的规则 |
| --- | --- |
| Fractal | 生成器参数持久化；连续 Cosine 渲染与生成颜色列表分别管理 |
| Domain | 可读入生成模式，但打开检查器不自动改写实际色板 |
| Implicit | 源 CPU 显示读取离散色标；导入通用 color flags 的差异仍待修正 |
| Perlin | 新生成 RGB 转为 alpha FF；旧导入颜色的 alpha 保留 |
| Symmetry / Samila | live Cosine 同时更新离散列表和连续 LUT；Curve/手动显式关闭连续 Cosine |
| Roots | UI 数量读取项目色板，不读取渲染器四色 fallback |

全部 11 个剩余场景家族、通用能力、原版效果对照和 Apple Silicon 最终集成发行仍在 Goal 范围内。已安装的 1.0 应用未更新。

证据入口：[原版 fixture 说明](../tests/fixtures/source-project-palette/README.md)、[公共导入回归](../tests/source-project-palette.test.ts)、[App 验证脚本](../scripts/verify-source-project-palette.mjs)。完整本地报告为 `.cache/source-project-palette-20261024/run/validation.json` 和 `.cache/source-project-palette-app-20261024/report.json`；独立静态审计保存在 `.cache/common-gradient-followup-audit-20261024/`、`.cache/common-gradient-family-audit-20261024/`。
