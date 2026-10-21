# Map 源数学计算验收记录

后续进展见 [Map 构造配置与初始粒子验证](source-map-initialization-validation.zh-CN.md)：新导入项目已接入原版构造种子和 Java Random 初态。下文保留本次数学阶段的历史验证范围。

本轮补齐 **Map 的源公式语法、GPU 单步计算和参数 uniform 绑定**。这是 2.0 的一个子阶段，Map 整体功能与原版整图一致性仍未完成；11 个待验场景的原版整窗验收仍为 **0/11**。

新导入的非 CPU Map 项目选择 `mathart-1.7.8-gpu-v1`。已有本地文档不自动迁移；明确选择 CPU 或兼容数学导入的项目保留旧行为。保存和重开会保留数学版本。原版初始化、实际帧时钟、热编辑、累积与调色还需继续对齐，不能把这次数学对照当成画面验收。

## 改变了什么

原来的 Map GPU 路径使用本地数学解析器，并在结果发散或非有限时重置粒子。现在源数学路径使用已核验的共享 FastExpressionParser 语法，保留原版 `calculate_next` 的计算顺序和 `length(nextPos-pos)` 步长度量，保留非有限数学状态；诊断可以跳过无效绘制，但不能改变后续轨迹。二维计算忽略 z 公式并强制 z 为零。

`x/y/z` 始终表示本步旧位置；y 可以使用 `nx/x_next`，z 可以使用 `nx/x_next/ny/y_next`。公式编译层的缺失或空公式为零；项目导入层已经显式写入的默认公式不受影响。编辑器使用同一编译入口，不再用本地 MathJS 解释源公式。

参数值通过 uniform 上传，不进入程序缓存键。GPU owner 缓存一份当前公式计划；数学版本、维度、有效公式或参数名集合改变会替换计划，数值变化只重新绑定。Map 与内置 Symmetry 共享保留 `calculate_next` 结果的更新分支，二维/三维规则由已解析配置控制，旧的 Symmetry 专用分支名称已移除。

源 Map 没有隐式的 t/time 变量，也不把 `1e-3` 解析为科学计数法。原更新模板没有声明 PI/TWO_PI/E 等命名常量；可以使用数值或显式参数。非法 GLSL 名称、原 shader 全局名称、函数名参数、错误函数参数个数及超出有限 Float32 的参数会明确报错。函数名参数即使没有被调用也被本地支持范围排除；这是显式限制，不声称原版统一拒绝。uniform 在本地规范排序并重命名以隔离实现名称；原文档键和值不变，重命名不会用来修复源名称冲突。

GPU 不可用时明确报错，不静默回退到另一套 CPU 数学。原来的发散半径在源数学中不生效，也不影响重放身份。

## 独立证据与实际检查

固定参考为 MathArt 1.7.8：

- JAR SHA-256：`a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018`。
- `MapAttractorExpressionCompiler.class`：`62409725e0d049ecb75cfcc932d656b79bdb603ac7b5d53cb093472c911d79a6`。
- `FastExpressionParser.class`：`511d4bbb570e6b8bc73371a27f55e01c69134ff088d99051dcb7cdb50883b3b0`。
- 原 `map_attractor_update.frag`：`866ade650c83444f5fac41c86fb89da6624f5c0157bb77f7b3ce7beac9554181`。

直接通过随包 JVM 调用原编译器，生成了 81 组独立预期结果，没有启动原版 GUI。验收脚本重新核对 JAR、输入、输出和 shader 摘要。

| 检查 | 实际结果 | 能说明的范围 |
|---|---|---|
| 原编译器 81 组输入 | 48 组生成文本在 uniform 排序/重命名后完全一致；18 组双方拒绝；15 组按明确本地限制拒绝 | 公式编译与支持边界，不等于原 GL 成功执行 |
| 原更新片元程序与生产 GPU owner | 10 类公式 × 1/4/16 次迭代 × 2 个独立 owner × 3 帧，共 5,040 个状态分量 | 相同初始粒子下，本机 WebGL2 数学状态 |
| 有限与非有限状态 | 4,680 个有限分量精确相同；360 个非有限分量类别一致；预设相对误差限 0.00002，实际最大残差为 0 | 包含顺序别名、幂、余数、三组原包预设、发散与非有限保留 |
| 参数名改变 | 添加新参数恰好增加一个编译程序；仅改数值不增加程序 | GPU owner 的编译身份与绑定 |
| 实际 App 参数编辑 | 两次数值编辑均保持同一 Worker/GL context，shader 编译次数 16、program 链接次数 8 不变 | 源 Map 预览的实际连接，不是模拟 Worker |
| 实际 App 公式编辑 | shader 编译次数升为 18，program 链接次数升为 9，context 不变 | 结构变化正确重编译 |
| 保存重开、PNG | 保留模型与参数；完整 RGBA 与独立冷算一致；257×193 下载 PNG 与独立渲染结果一致 | 本地保存/导出流程 |
| 新原版格式导入 | 实际 Worker 返回源模型 WebGL2 预览，非空，未报错 | 新导入版本选择与渲染连接 |
| Symmetry 回归 | 17 组原始片元与生产 owner 对照通过 | 共享更新分支没有改变既有源 Symmetry 算术 |
| 测试与构建 | 全套 341 文件 / 6,249 项通过；最终小型整理后相关 6 文件 / 93 项及构建通过 | 未打包或替换已安装的 1.0 应用 |

公开界面测试也回归了旧数学 Symmetry 的编辑、保存和导出。示例工作量为 1,024 粒子，不能据此推断百万粒子性能。浏览器运行于无界面模式，没有移动用户窗口或发送桌面输入。

第一版探针的 UI 等待条件可能命中初始 Ready 状态，截图仍在计算，因此该 UI 记录作废；最终探针等待真实 Worker 的源模型图像，并要求非空后再截图。首次 Symmetry 回归因两个 Vite 服务争用端口而未启动；顺序重跑通过，没有停止其它进程。

完整记录：[公式与状态对照](../.cache/source-map-expression/probe-final/report.json)、[界面编辑与导出](../.cache/source-map-expression/edit-ui.json)、[Symmetry 回归](../.cache/source-map-expression/symmetry-regression-final/report.json)、[原编译器审计](../.cache/source-map-expression/findings.zh-CN.md)。私有证据不进入 Git。

## 尚未完成的 Map 部分

生命周期字节码审计已经确认：队列未结束时每帧可能两次对象更新，暂停显示仍累积；参数热更新、ApplyChanges 重建、变换重播和尺寸变化具有不同边界。构造 seed 由实例持有，重播不重新按当前参数计算。完整证据在 [生命周期审计](../.cache/source-map-lifecycle/native-audit.md)。这些属于源代码控制流证据，尚未全部接入 Map 的生产 owner。

后续需要完成原版初始化/Java Random、源实时更新和暂停显示、参数编辑与 Replay、平方状态纹理、源散点与最终调色，再进行匹配输入、随机性、物理尺寸、相机和时间的原版整窗对照。当前仍使用本地初始化及固定重放，部分 UI 热编辑会重放轨迹。以上差异继续保留在里程碑，未标为完成。

原生窗口上次检查仍报告锁屏，已发出手动解锁请求。本轮没有重复尝试自动解锁，没有复用所有权未知的虚拟屏。

## 成本与复现

| 完整任务 | 墙钟 | 采样 CPU | 进程族峰值 RSS |
|---|---:|---:|---:|
| 最终公式、GPU、导入检查 | 4.49 秒 | 10.52 秒 | 约 1.62 GiB |
| 界面编辑、保存、PNG | 12.21 秒 | 31.40 秒 | 约 2.01 GiB |
| Symmetry 回归 | 2.99 秒 | 6.49 秒 | 约 1.37 GiB |
| 全套测试 | 40.77 秒 | 287.15 秒 | 约 4.00 GiB |
| 最终构建 | 19.35 秒 | 32.37 秒 | 约 1.89 GiB |

CPU/RSS 每 250 ms 采样，可能漏掉短进程和峰值；共享页可能重复计算，CPU 为观测下界，未区分短任务中的 PID 重用。GPU 内存和代理 token 未单独测量。部分任务并行；这些不是吞吐或性能提升声明，没有等价工作量的优化前后比较，也没有单独冷/暖耗时分项。

在 studio 目录使用项目固定 Node，依次运行两个浏览器脚本：

```sh
node scripts/verify-source-map-math.mjs <新的输出目录>
node scripts/verify-iterated-edit-ui.mjs <新的输出前缀> --source-map
node scripts/verify-source-symmetry-kernel.mjs <另一个新的输出目录>
```

数值探针需要本机保留的 `.cache/source-map-expression/` 与 `.cache/source-symmetry-kernel-audit/` 证据。构建仍有既有的产物体积警告，不影响本次成功结果。
