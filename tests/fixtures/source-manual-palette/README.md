# 原版 Manual 随机配色向量

固定 MathArt 1.7.8 原包数值方法在现有 Temurin 21.0.7 无头执行的真实输出；原 JAR、方法、类、采集命令和清理记录见 [source.json](source.json)。没有重写原版随机源或修改原包。

- `pure.json`：73 组原颜色解析、传递函数、OKLab 和 AWT 转换。
- `pure-edges.json`：12 组极小负 hue、正负零等补充边界。
- `random.json`：9 组完整色板，130 个只读观察到的 Math.random 返回值。
- `random-edges.json`：3 组完整色板、6 组主色，96 个真实随机返回值。

四个文件均逐字节复制对应有效 oracle。Float32 输入/输出按 bits 比较；随机数按 Float64 bits 解码，严格比较结果数组和调用次数。根测试只向本地候选算法提供这些观察值，不向原程序注入种子。

`tests/source-manual-palette-generation.test.ts` 验证全部 103 个原版案例，并另测本地边界拒绝。实际 App、原生/WebGL、保存和导出证据与限制见 [中文验收记录](../../../docs/source-bouncing-random-palette.zh-CN.md)。有限数值对照不等于原版窗口或所有随机输入一致。
