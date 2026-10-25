# Symmetry 初始化修复与本地验证

> 2026-10-25 补充：本文的默认预热 100 是作者／构造配置值；真实原版普通首帧只提交一次预热，并在 GPU 调用处钳制为 16。修正与原版全量观察见 [冷启动运行边界](source-symmetry-cold-runtime-validation.zh-CN.md)。

2026-10-21。**源 JSON 导入的默认值、构造种子和初始点流已修复；原版整窗效果仍未验收。** 本轮没有操作原生窗口，也没有重新打包或替换 1.0 Apple Silicon 应用。

后续更新：[编辑顺序与原版 JVM 验证](source-symmetry-editor-order-validation.zh-CN.md)已解决下文当时未验证的有限参数编辑树顺序；整窗验收仍待完成。

这是对[上一轮初始化差异审计](symmetry-initialization-audit.zh-CN.md)的后续。原版目标固定为 MathArt 1.7.8，JAR SHA-256 为 `a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018`。

## 修复内容

- 新导入的 GPU Symmetry 使用源默认 262,144 粒子、构造阶数 3、预热 100 步。部分参数表保留缺项；缺失 uniform 上传零。旧本地文档和显式 legacy 导入保留原有行为。
- 源参数按 JSONObject／HashMap 顺序读取；保留键名，执行数值／布尔转换与修正幂次舍入。模板识别、Double 到 float 的初始范围转换和上下界排序独立于本地表达式解析。
- 按粒子数、构造阶数、参数键和 Double 位计算 64 位种子。Java Random 按 X、Y 顺序采样，每个运算分别舍入到 Float32；退化坐标轴不消耗随机数。分块跳转与 65,536 边界保持点流不变。
- 项目单独保存构造参数快照，参数动画和重播复用种子；检查器编辑重建配置。自定义着色器的编译阶数也取构造快照。缓存标识保留种子差异，避免把负零与正零视作同一初态。
- 保存重开保留构造事实；为已消费字段登记数字来源记录。共享 Java 长整数混合函数，移除了与 Perlin 的重复实现。

## 已执行验证

| 检查 | 结果与范围 |
|---|---|
| 独立参考的 9 组有序参数 | 43 个指定点逐位一致，合计 196,648 个前缀粒子的完整 RGBA Float32 摘要一致 |
| 实际导入／保存重开，6 组 JSON | 构造种子、数量、阶数和 42 个指定点一致，包括原包 Emperor’s Cloak 的 656 万粒子配置；没有用完整大场景渲染冒充抽样验证 |
| 实际 WebGL2 初始化上传 | 9 组配置通过恒等自定义着色器，43 个指定点读回逐位一致，GPU owner 释放后保留字节为零 |
| 实际 App 的 Map／Symmetry | 导入、预览、播放暂停、项目导出后重新导入均通过；PNG 的完整 RGBA 等于实际 Worker 输出 |
| Map 视频回归 | 192×128、3 FPS、3 帧 MP4；上传的每帧 PNG 等于 Worker 输出 |
| 完整回归 | 325 个文件、5,904 项测试通过；随后对自定义编译阶数的快照修正另跑 4 个文件、59 项专项测试通过 |
| Web 构建 | TypeScript 与 Vite 构建通过；保留已有大文件分包提示，没有运行 desktop:build |

源参考由独立 Python 程序按保留字节码推导，没有运行原版 JVM。GPU 恒等着色器检查的是上传和状态保存，不是原版多项式演化或最终窗口图像。本轮保留浏览器、Vite 和导出服务清理结果。

[查看本地 Symmetry 预览](../.cache/source-symmetry-initialization-public-final/symmetry-preview.png) · [查看导出的 Symmetry PNG](../.cache/source-symmetry-initialization-public-final/symmetry.png) · [查看 Map 预览](../.cache/source-symmetry-initialization-public-final/map-preview.png)

图片采用明确缩小的工作量：256 粒子、预热 4 步、每帧一步，替换为一秒等待时间线并关闭原文公式叠加；用于验证工作流，不代表原版完整披风效果。

## 尚未证明的范围

**原版整窗口验收仍为 0/11。** 已确认原版可见系数编辑经 `applyChanges` 重建 Mobject；但 Compose `SnapshotStateMap` 在重建时的精确遍历顺序尚未证明。beta、gamma、omega 同处 HashMap 碰撞桶，其插入顺序会改变构造种子，连普通默认参数也不能忽略这一点。本地编辑使用保存的键顺序构造新的 HashMap，具有可重放性，但尚未证明与原版检查器编辑逐次一致。

本地文档只接收有限参数／有限 Float32 初始范围，仍有 800 万粒子、每帧 16 次、预热 10 万次等明确容量限制；不是原版所有非法／极端输入的完整兼容声明。初始范围渲染入口仍受现有本地范围预算约束。原版窗口合成、颜色噪声、视口适配与原生实时帧行为仍须继续对照。测试中的旧模型用例显式选择 legacy，保留原有约束覆盖；没有把源模型的新规则伪装成旧行为。

## 开销

相同粒子数量、范围和 65,536 分块大小，比较旧计数随机算法与新 Java Random。两者输出本来就不同，此表比较完成同类初始化任务的成本，不表示两种数学等价。每个配置测首次调用和两次热调用，均在 Node 中进行，不含 GPU。

| 粒子数量 | 旧算法首次／热运行墙钟 | 新算法首次／热运行墙钟 | 新算法首次／热运行 CPU |
|---|---|---|---|
| 262,144 | 8.56 / 2.94–2.98 ms | 32.44 / 28.79–29.14 ms | 36.47 / 28.90–29.16 ms |
| 6,562,144 | 77.02 / 74.47–76.52 ms | 747.00 / 729.02–733.10 ms | 819.08 / 794.78–795.75 ms |

首次模块加载另计 79.51 ms；这里的“首次”不是操作系统冷缓存。初始化测量进程族采样峰值 RSS 约 278 MiB。实际 App 工作流共 11.63 秒、采样 CPU 24.05 秒、进程族峰值 RSS 约 2.16 GiB。250 ms 采样会漏掉短进程与瞬时峰值，共享页可能重复计入；GPU 内存与 token 成本未测量，不作性能提升声明。

## 复现与证据

```sh
npm test -- tests/source-symmetry-initialization.test.ts tests/source-symmetry-math.test.ts tests/symmetry-custom-authoring.test.tsx
node scripts/audit-source-symmetry-initialization.mjs <新目录> --gpu
node scripts/verify-captured-density-public.mjs <另一个新目录>
```

审计脚本依赖本地已保留的独立 oracle、原包和 manifest，先校验摘要；`--gpu` 额外检查真实 WebGL2 上传。可读静态补充：[UI 生命周期](../.cache/source-symmetry-initialization-audit/ui-lifecycle-report.zh-CN.md)、[设置与重建顺序](../.cache/source-symmetry-initialization-audit/settings-fallback-reload.zh-CN.md)。原始记录：[初始化和 GPU](../.cache/source-symmetry-initialization-fixed-final/report.json)、[App 工作流](../.cache/source-symmetry-initialization-public-final/report.json)、[成本](../.cache/symmetry-initialization-costs.json)。
