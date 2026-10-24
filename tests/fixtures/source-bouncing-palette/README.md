# 弹跳手动色板证据

面向使用者的验收见 [中文记录](../../../docs/source-bouncing-palette.zh-CN.md)。

`manual-after.json` 是原版 `ManualGradientPaletteEditorKt.insertManualPaletteAfterSelected(List,int)` 的 43 项实际输入／输出，来自已安装 Temurin 21.0.7 的两次无窗口运行。它包含真实的异常及原始条目；不是产品实现生成的期望值。目标 JAR SHA-256：`a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018`。

产品测试对照插入后的完整数组和选中索引，验证输入未被改写。空输入的原方法返回越界索引 1；产品保留新增单白色的行为，并选择有效索引 0。原版 UI 的整板规范化没有应用到产品导入数据，不能从这些向量推导完整原版窗口交互一致。

`source.json` 固定原 JAR／类身份、完整运行记录及静态审计哈希，列出实际 App 验证、相关测试、构建、翻译检查的命令与结果。完整原始执行命令、依赖身份、反汇编和探针留在本地缓存；原应用及依赖没有进入 Git。

实际 App 验证器以无头 Chrome 运行，既测试原生 CGL，也测试 WebGL。PNG 对照产品实际交付的像素；画布恢复对照同次执行前后的呈现像素。这些检查不提供新的原版 GUI 或完整艺术画面对照。
