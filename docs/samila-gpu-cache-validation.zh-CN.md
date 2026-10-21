# Samila 严格 GPU 对照：桌面配置通过

后续已在项目安装的 Electron 44.7.2 中复跑严格矩阵，220/220 图像与坐标逐位相同，见 [Electron 验证](samila-electron-validation.zh-CN.md)。下文保留本轮 Chrome 测量与当时的限制。

2026-10-21：Samila 在 **macOS 桌面启动配置**下完成严格对照：220 组完整累积图像、220 组世界坐标、20 组跨范围稀疏采样全部逐位相同，393,222 个连续样本没有差异。原生 MathArt 应用整窗对照仍为 **0/11**；这里运行的是原包 shader 的浏览器适配参照，不是原版 Java／JOGL 窗口。

## 原来为什么报错

旧验证脚本使用普通 Chrome 启动配置。原 shader 自身也会在第一次链接和再次链接后产生不同的浮点结果。复现中，同一个已链接程序重复绘制保持一致；重新链接相同 shader 后，20 组样本中有 10 组位型变化。原 shader、翻译后的 Metal 文本、输入 uniform 位型及观察输出均保持相同。

新诊断固定四个种子、五个采样范围和样本编号 1，每个浏览器依次创建三个上下文，每个上下文链接三个程序，每个程序重复绘制三轮。独立运行六个浏览器，共 162 轮、3,240 次单样本读回：

| 启动模式 | 第一次链接的三轮 | 后续八次链接，每次三轮 |
| --- | --- | --- |
| 普通 Chrome | 每轮 20/20 相同 | 每轮 10/20 相同 |
| 关闭 Chromium GPU 程序缓存 | 每轮 20/20 | 每轮 10/20 |
| 关闭 GPU shader 磁盘缓存 | 每轮 20/20 | 每轮 10/20 |
| 同时关闭上述两项 | 每轮 20/20 | 每轮 10/20 |
| 关闭 ANGLE 程序缓存 | 每轮 20/20 | **每轮 20/20** |
| 恢复普通 Chrome 配置 | 每轮 20/20 | 每轮 10/20 |

“相同”均指与各浏览器的第一轮逐位比较，不预设第一轮就是原生 MathArt 的正确答案。54 个程序的 Metal 翻译文本 SHA-256 均为 `15cc0de1f12c175a78ceeb4be4a14d6e73aba674899f94c30c4fb62257a24136`。报告记录版本、输入位型、原始输出及清理结果；所有浏览器、程序和上下文均已释放。六组测量合计 6.99 秒，只是诊断墙钟耗时。

## 对应源码与修正边界

实测 Chrome 为 `155.0.8059.85`，Chromium revision 为 `0e66b94549a8bd85f03fbdf189b752d6e7b63c32`，设备为 Apple M2 Max／ANGLE Metal。该 revision 的 DEPS 指向 ANGLE `cccf60cde32c911b017a315b82235df61da5057b`。[固定版本 DEPS](https://chromium.googlesource.com/chromium/src/+/0e66b94549a8bd85f03fbdf189b752d6e7b63c32/DEPS#352)

该版 ANGLE 的新编译路径从 shader 反射取得 `hasIsnanOrIsinf`，据此禁用快速浮点优化；程序二进制的保存／恢复遗漏了这个字段，恢复路径又不重新做反射。结果是相同 Metal 文本可能用不同的数学选项编译。字段遗漏是源码事实；本轮的缓存开关实验支持它与观测差异有关，但没有直接记录每次缓存命中、Metal 编译选项或机器指令。[保存／恢复代码](https://chromium.googlesource.com/angle/angle/+/cccf60cde32c911b017a315b82235df61da5057b/src/libANGLE/renderer/metal/ProgramExecutableMtl.mm#546)，[恢复后编译路径](https://chromium.googlesource.com/angle/angle/+/cccf60cde32c911b017a315b82235df61da5057b/src/libANGLE/renderer/metal/ProgramMtl.mm#219)

项目已有 `desktop/graphics.mjs`，因先前的 Fractal 对照问题，在 macOS 设置 `disableProgramCaching`。这项策略保留应用已经创建的 GL 程序，也保留调用者的显式覆盖。本轮没有新增桌面开关，而是修复 **Samila 验证环境没有采用已有桌面配置** 的遗漏。该 ANGLE feature 会阻止程序二进制缓存的查询和保存。[固定版本查询入口](https://chromium.googlesource.com/angle/angle/+/cccf60cde32c911b017a315b82235df61da5057b/src/libANGLE/Program.cpp#1007)

两个独立参照生成脚本和实际产品验证脚本现在共享一个显式 `--desktop-graphics` 选项，调用现有桌面策略。报告保存配置和策略文件哈希，参照配置与验证配置不一致时提前拒绝。默认仍为普通浏览器模式，历史失败记录保留。没有改 shader、随机种子、公式或比较阈值。

## 实际通过范围

| 检查 | 桌面配置实测结果 |
| --- | --- |
| 原始采样参照 | 180 组通过，1.66 秒 |
| 完整绘制参照 | 220 组通过，2.17 秒；观察接口开关不改变图像 |
| 产品完整累积图像 | **220/220 逐位相同**，也满足原有误差阈值 |
| 产品世界坐标 | **220/220 逐位相同** |
| 跨范围稀疏坐标 | **20/20 逐位相同** |
| 同一实例切换映射／投影 | 156 组通过 |
| 连续样本 | 393,222 个，零差异；含分块边界与短尾 |
| 产品观察接口开关 | 220/220 图像不变 |
| 配置不匹配／未知选项 | 两项均提前拒绝 |

产品严格对照耗时 15.61 秒，源码前后哈希一致，浏览器与 Vite 清理完成。完整数据位于 `.cache/samila-direct-desktop-accepted/report.json`，同目录有可读 `report.md`。独立参照在 `.cache/samila-sampler-desktop-oracle/` 和 `.cache/samila-direct-desktop-oracle/`；重复编译诊断在 `.cache/samila-gpu-repeatability-final/`。这些是本地验证产物，不进入 Git。

普通浏览器对照保留在 `.cache/samila-direct-browser-control-final/report.json`：完整图像 220/220 满足原阈值、165/220 逐位相同；世界坐标仅 3/220、稀疏坐标 10/20 逐位相同，报告仍为 failed。两份报告按不同启动配置分别解释，不能只引用桌面配置的通过结论。

本轮只改验证工具和说明，没有更改产品渲染代码，也没有重建或替换 1.0 Apple Silicon 应用。未重跑全量产品单元测试和打包；此前播放、PNG／视频验证见 [实时播放记录](samila-realtime-clock-validation.zh-CN.md)。CPU 时间、进程族峰值内存、驱动分配和完整任务 token 成本未测量，本轮耗时不用于性能优劣结论。

## 复跑

在 `studio/` 使用项目锁定的 Node 和已安装依赖、Chrome、Python 3，保留固定 MathArt 1.7.8 JAR，以及既有独立噪声表／色板参照：

```sh
node scripts/diagnose-samila-gpu-repeatability.mjs
node scripts/build-samila-sampler-oracle.mjs .cache/samila-sampler-desktop-oracle --desktop-graphics
node scripts/build-samila-direct-oracle.mjs .cache/samila-direct-desktop-oracle --desktop-graphics
node scripts/verify-source-samila-sampler.mjs .cache/samila-direct-desktop-accepted .cache/samila-sampler-desktop-oracle/fixture.json .cache/samila-direct-desktop-oracle/fixture.json --desktop-graphics
```

后续仍需原生应用的时间、随机流、相机和整幅效果对齐。普通浏览器不自动继承桌面启动配置；本轮也没有重新运行 Electron 内的 Samila 矩阵。因此不能将此次通过扩展为所有浏览器、设备或原版窗口均一致。
