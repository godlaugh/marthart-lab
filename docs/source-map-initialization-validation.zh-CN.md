# Map 构造配置与初始粒子验证

本轮完成 Map 的**原版构造配置、种子和 Java Random 初始粒子**，并接入导入、参数编辑、保存重开和 GPU。2.0 总目标仍进行中，原版整窗效果验收仍为 **0/11**。

## 使用上有什么变化

新导入的原版 Map 项目保存独立的构造状态。公式原文、参数顺序、参数双精度值、维度和粒子数共同决定种子；时间线改变参数时保留该种子。检查器明确修改参数、公式或结构后重建构造状态。保存重开保留这一状态，已有不含该状态的本地项目不自动迁移。

项目文件入口遵循原版 ProjectState 的转换，固定选择 GPU；直接配置入口仍区分 CPU 和 GPU。GPU 源数学不可用时明确报错。旧兼容导入继续可用，安装中的 1.0 应用未重新打包或替换。

以下差异由统一配置模块处理，避免导入器、编辑器和渲染器各自解释：

- 直接配置没有 `settings` 时保留 Base 默认值，忽略其余公式、参数；项目入口缺参数则是空参数表，不能擅自补默认系数。
- 项目入口 trim 公式，直接配置保留原始空白；3D 空公式按原维度规则补齐。
- 编辑公式和有效公式分别保存。例如 2D 自动补出的 `z=0.0` 不会冒充用户输入，切换 3D 时仍可按原规则补 z。
- 参数经过原 JSONObject / Compose map 的顺序规则，不能按字母排序来计算种子；编辑参数和引擎注入参数分别保存。
- XY 范围转 Float32 并归一；相等或浮点舍入后相等的轴不消耗随机抽样。3D Z 固定在 `[-1,1]` 抽样。
- 配置保留原始每帧迭代数，GPU 按原 shader 上限执行至多 16 次。粒子数和预热有明确的本地资源限制。

Map 与 Symmetry 共用一份 Java Random 初始化实现，旧的 Symmetry 专用字段已经迁移到内部 `sourceInitialSeed`，没有复制另一套随机数生成器。Map 的保存格式保留的是构造事实，不存一份容易失效的派生种子。

## 实际验证结果

| 验证 | 结果 | 范围 |
|---|---|---|
| 原 JVM 配置 | 32 组输入 × 项目/直接配置两条路径，共 64 条对照通过 | 配置字段、公式、参数值和顺序，以及错误分支 |
| 原 JVM 种子 | 13 组全部一致 | 原 `computeInitialStateSeed` 直接调用 |
| 初始点 | 12 组合法范围、96 点逐位一致；分块偏移测试通过 | 原 `randomInRange` 直接调用，外围采样循环镜像原字节码 |
| GPU 上传 | 12 组 × 2 个独立 owner，共 768 个分量逐位一致 | 本机 WebGL2，恒等递推隔离初态；不是原版 JOGL |
| 实际界面编辑 | 数值编辑保持同一 Worker/context，编译/链接计数维持 16/8；公式编辑变成 18/9 | 1,024 粒子，构造状态随明确编辑更新 |
| 保存、重开、PNG | 完整 RGBA 与独立冷算一致；257×193 PNG 与独立渲染一致 | 新 Map 构造状态及旧 Symmetry 编辑回归 |
| 原格式导入与数学回归 | 实际 Worker 返回非空 GPU 预览；5,040 个状态分量对照再次通过 | 相同初始状态下的本机 WebGL2，不等于原版整窗 |
| 自动测试 | 344 个文件、6,361 项通过 | 包括源 Symmetry 初态及重播回归 |
| Web 构建 | 通过 | 未构建桌面发行包 |

原 JVM 初始化 oracle 另有一组逆序范围，它绕过构造器，仅验证私有范围函数；生产入口明确拒绝未归一化的内部范围，没有把这组结果声称为合法构造结果。96 点之中包括负零；测试从原 JSON 字节读取，避免打包器把负零转换为正零。

首次全套测试发现 4 项 CPU 相机测试仍通过项目入口选择 Map。项目入口现在按原版固定 GPU，因此测试改为明确选择既有 CPU 兼容路径；相机、取消恢复和裁剪断言均保留，最终全套通过。

可提交的精简证据在 [初始化 fixture](../tests/fixtures/map/initialization-source.json) 和 [配置 fixture](../tests/fixtures/map/configuration-source.json)，包含原包、类、JVM、输入、harness 和结果摘要。固定原包 SHA-256 为 `a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018`。

本机完整记录：[配置审计](../.cache/source-map-config/findings.zh-CN.md)、[初态审计](../.cache/source-map-initialization/README.md)、[GPU 对照](../.cache/source-map-initialization/gpu-final-probe/report.json)、[实际界面与 PNG](../.cache/source-map-initialization/edit-ui.json)、[原格式导入与数学回归](../.cache/source-map-initialization/math-import-probe/report.json)。原包和私有缓存不进入 Git。

## 还差什么

Map 仍使用本地固定时钟重放。原版一帧中的两次更新、暂停显示继续累积、运行参数原地更新、变换触发 Replay、窗口尺寸变化，以及源散点和最终调色链尚未全部接入。编辑后重建是本地明确的编辑行为，不能等同于原版所有热编辑操作。完整原版窗口对照尚未执行。

这些检查都在后台执行，没有移动桌面窗口或发送桌面键鼠输入。Yomado 的窗口归属与可用状态需要在下一次原生窗口测试前重新确认。

## 测量与复现

| 任务 | 墙钟 | 采样 CPU | 进程族峰值 RSS |
|---|---:|---:|---:|
| 最终 GPU 初态对照 | 2.36 秒 | 6.33 秒 | 约 1.40 GiB |
| 界面编辑、保存与 PNG | 12.16 秒 | 31.65 秒 | 约 2.03 GiB |
| 原格式导入与数学回归 | 4.48 秒 | 10.49 秒 | 约 1.66 GiB |
| 全套测试 | 41.12 秒 | 287.88 秒 | 约 4.12 GiB |
| Web 构建 | 19.68 秒 | 33.04 秒 | 约 1.91 GiB |

CPU/RSS 每 250 ms 采样，可能遗漏短进程和峰值，RSS 可能重复计入共享页，CPU 是观测下界；未区分短任务中的 PID 重用。GPU 内存、代理 token 和单独冷/暖耗时未测量。本轮改变初始化语义，没有等价语义的前后性能比较，不据此声明性能提升。

在 studio 目录使用项目固定 Node，浏览器脚本顺序执行：

```sh
npm test
npm run build
node scripts/verify-source-map-initialization.mjs <新的输出目录>
node scripts/verify-iterated-edit-ui.mjs <新的输出前缀> --source-map
node scripts/verify-source-map-math.mjs <另一个新的输出目录>
```
