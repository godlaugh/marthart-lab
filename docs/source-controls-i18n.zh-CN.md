# 2.0 场景控件语言验收（2026-10-24）

**补齐了分形、弹跳粒子、Perlin、曲面等新增控件的 244 条英文翻译，并修复了动态分形标签混用语言的问题。** 静态界面缺口由 129 处降到 0；这不等于所有底层诊断信息都已翻译。

## 修改与原因

新控件多数已经调用翻译器，但对应词条没有加入英文目录，因此英文模式仍显示中文。另一类是经 `Control` 组件显示的元数据：标签由 `Fields.Control` 统一翻译，静态检查此前把 JSX 内的这些配置误当成直接显示的文字。

本轮保留统一翻译入口，只让检查器识别从 `Fields` 导入的 `Control`、`spec` 下的标签/帮助/组名以及选项标签。缺少目录项仍报错；语义键、选项值和其他组件的属性不获豁免。检查器自检覆盖这些区别，实际组件渲染另行验证，不把静态通过当作完整界面证据。

分形动画还有一个实际问题：先拼接“改变中心”，再交给占位符翻译，插入值“中心”会按保护作者文本的规则原样保留，得到 `Change 中心`。现在先翻译内置目标名称，再组成 `Change Center`。作者输入的名称、公式、参数 ID 和原文件内容仍原样保存。

## 已执行验证

| 检查 | 结果与范围 |
| --- | --- |
| 词条与静态界面检查 | 3,257 个合并目录项；占位符、英文内容、内置场景元数据检查通过；129 → 0 处静态界面缺口 |
| 组件与回调测试 | 6 文件、60 项通过；包括 4 类源分形公式及旧参数状态、14 种弹跳初始形状、Perlin CPU 粒子/曲线和 GPU、曲面 CPU/GPU 点/网格 |
| 真实浏览器 | 6 组通过：分形、弹跳、Perlin CPU/GPU、曲面 CPU/GPU；公开文件导入、几何与外观面板、英文→中文→英文切换、项目 JSON 下载 |
| 作者数据 | 6 组中文作品名称和原始导入配置均在导出中保留；组件渲染不改写场景数据；后端等语义值不随语言改变 |
| 2.0 构建 | TypeScript 与 `build:v2` 通过；仍有既有的大体积 chunk 提示 |

浏览器使用默认 WebGL 开发预览和独立无界面 Chrome 工作区，未操作主屏。原版数值模式的分形动画动态标签也在真实 App 中点击展开并检查。最终截图等待当前导入场景的 Worker 交付、就绪状态及布局稳定后取得；早期脚本只等待一次 Ready，可能截到前一场景或后续重算，已纠正验证脚本。这不是产品渲染算法改动。

最终浏览器结果没有页面或 Worker 错误，运行前后源码哈希一致，浏览器与开发服务器关闭成功。最终记录：

- `.cache/source-controls-i18n-20261024-settled/report.json`：6 组界面记录、源码哈希、Worker 交付和清理结果。
- 同目录 `*-english.png` 与项目 JSON：实际截图及下载文件。
- `.cache/i18n-updated-20261024.log`、`.cache/i18n-status-verified-20261024.json`：静态检查结果。
- `.cache/i18n-verified-tests-20261024.log`、`.cache/i18n-build-20261024.log`：相关测试与构建。

本轮开始时，还对上一提交的构建执行了 **12/12 类场景**的创建、显示、保存、JSON 下载和刷新重开检查，全部通过，记录在 `.cache/v2-creation-current-20261024/report.json`。该项属于翻译改动前的基线检查；改动后的界面证据是上述 6 组源配置，不混为同一轮构建证据。

复现命令：

```sh
node scripts/check-i18n.mjs --self-test
npm test -- tests/source-controls-i18n.test.tsx tests/i18n.test.tsx tests/release-catalog.test.tsx tests/source-fractal-controls.test.tsx tests/source-bouncing-controls.test.tsx tests/source-surface-mesh-controls.test.tsx
npm run build:v2
node scripts/verify-source-controls-i18n.mjs .cache/source-controls-i18n-new
```

最终浏览器检查约 28.22 秒，12 类基线检查约 39.44 秒；未测量 CPU、峰值内存、GPU 或独立 token 成本，未控制冷暖缓存，不作性能提升结论。

## 仍未完成

源代码清单仍有 3,893 处未进入英文目录的其他字符串，包括引擎诊断、导入警告及动态消息；本轮没有把它们统一隐藏或替换。例如分形源执行提示仍可能在英文状态栏保留中文。

这次关闭的是已列出的控件语言缺口。更多场景配置的原版画面对照、原版主窗口验证和最终 Apple Silicon 发行仍需继续，2.0 Goal 保持进行中。
