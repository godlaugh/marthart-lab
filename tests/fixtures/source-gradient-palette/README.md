# 原版 Cosine / Curve 色板证据

`oracle.json` 是 MathArt 1.7.8 公开纯方法的实际执行输出，未经改写。`source.json` 保存原包/类身份、运行环境、命令、哈希和限制；完整本地命令与探针在 `.cache/common-gradient-native-probe-20261024`。

61 案例：21 Cosine、22 Curve、10 安全振幅上界、5 随机 Cosine、3 随机 Curve。包含 5 个预期 null-list 构造错误和 3 个预期 maxStops<2 错误。8 个随机案例通过 API 显式传入独立 Random，记录 206 次 nextBits；候选按上层 nextDouble(from,until)、nextFloat、nextInt(from,until) 返回值重放，并验证调用次序和边界。没有修改全局 RNG、原 JAR 或许可。

浮点值用 `{text,bits}` 保留。测试以 bits 解码、比较规范化/随机状态及所有生成颜色；原点 ID 逐字保留，新 UUID 检查新建关系，不把随机 UUID 字面值当确定性期望。Curve 是 Float32 分段线性，保留重复 x/ID 与有符号零行为。

使用现有 Temurin 21.0.7；未覆盖原包自带 JVM。全部原调用只运行一轮，进程退出 0、资源已收尾。初次采集的报告文件名冲突发生在目标执行成功后；原错误保留，随后只读整理和校验通过，未重新执行原方法。没有原版 GUI、项目保存或整图一致性结论。

复核：`npm test -- tests/source-gradient-palette-generation.test.ts`。实际页面接入报告见 `docs/source-gradient-generators.zh-CN.md`。
