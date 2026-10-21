# Samila 随机采样与六倍补采验证

本文保留提交 `eae5fdc` 的历史验收结果，包括严格坐标检查失败。后续生产路径改为同一 GPU 绘制，原 shader 自身的重复编译差异及新验证结果见 [GPU 直接绘制验证](samila-direct-gpu-validation.zh-CN.md)。以下旧结果不表示当前代码已重新执行相同协议。

这一批修正 2.0 Samila 的样本生成规则。原版参数变化后的六倍补采，是一个随机种子下连续的六倍样本；之前本地把它当成六个独立随机批次，图案会不同。新导入采用独立版本 `samila-pcg-1.7.8`，已有本地作品不自动升级。

## 行为与范围

- GPU 直接按原 PCG 算法生成坐标；X 使用一次 hash，Y 使用第二次 hash。普通帧使用一个批次，参数变化后使用同一种子和连续的六倍样本编号。计算可分块，但不会重新编号或在块间衰减。
- 运行时每个新的本地采样帧取得一个系统随机值。源配置的 `seed`／`func_seed` 保留为来源数据，不参与新版本的实际采样；旧版本仍保留原来的可重放序列。
- 原版有效的 display 绘制会继续采样，包括相同时间的再次绘制。本地仍使用固定帧率重放，相同时间请求可以命中缓存。这一批没有实现原版热实例的每次 display、暂停截图继续采样或实时线程时钟。
- 当前会话保存临时种子记录，便于倒退和重新计算。重新打开作品、新建导出 Worker、销毁 Worker 后重新开始都是新的随机会话；保存的 JSON 不保存这份临时记录。因此重新打开或重新导出的图案可能不同。
- 六倍补采仍按原规则计入累积归一化；只进行一次历史复制、衰减和上限处理。新版本不使用旧的“停止记录”控制来跳过原本应发生的采样。
- CPU 使用相同 uint 哈希和逐步 Float32 派生计算；GPU 融合运算、后续数学与 CPU 栅格化仍可能不同，CPU 不作为原生像素一致性证明。

临时种子按 4,096 帧分页，每帧 4 字节种子和 1 字节有效标记；10 MiB 数组预算可容纳 512 页，即 2,097,152 个帧编号。实际分配计入现有 768 MiB 工作预算。此预算是已知缓冲估算，不包括所有 JavaScript 对象或驱动内存，也不是进程峰值测量。

## 原包证据

固定 MathArt 1.7.8 JAR SHA-256：`a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018`。

原 `samila_splat.vert` SHA-256：`29eaf8274e35c582d6425d1b6be901cfb0e57d9a5b11277eba9f006eaa098093`。

`SamilaMobject.drawSplatBatch` PC347–353 从 `ThreadLocalRandom.nextInt()` 取得种子并上传。`display` PC256–278 选择 1／6 倍后仅调用一次批次绘制；绘制方法 PC687–728 计算总样本数，PC1094 单次 draw。Shader 269–280 定义 PCG，317–327 根据原始样本编号与种子计算坐标。完整静态审计在 `.cache/v2-samila-random-audit.md`，类和 shader 身份已重新核对原包。

若常量公式使链接器移除种子 uniform，原版会跳过取随机值；本地仍按固定帧维护临时记录，不能宣称随机调用次数完全一致。

配置无法推导原版实际随机种子。独立对照使用显式相同的种子；它证明给定相同随机输入时的算法，不证明捕获了原版 JVM 随机序列。

## 浮点一致性仍未完成

独立参照把固定 JAR 内的原始 shader 放入 Chrome 执行，使用显式相同的种子。它与原生 JVM／JOGL 整窗运行是两种证据。

最初，孤立 GPU 采样片段有 22/120 项坐标位模式不同，整数 PCG 哈希一致。使用 `isnan/isinf` 结果检查后，孤立片段的结果改变；但完整生产程序仍有浮点差异。将范围从向量 uniform 改成两个标量，或把内部公式判据改成原式，均未消除差异，因此未采用这些无效候选修改。

扩展验证发现，差异也存在于默认 `[-π,π]`、`[-3,2]` 和 `[0.1,0.7]`，并非只影响极大范围。当前完整生产 GPU 的 20 个范围样本中，10 个坐标逐位相同，10 个不同；已观测最大差异 43 ULP，出现在接近零的相减。ULP 是浮点数最小刻度，不能直接换算为固定像素误差。整数哈希与连续编号检查通过，不代表完整采样坐标或图像已经逐位一致。

已保留原 GLSL、生产 GLSL 和 ANGLE 翻译结果。采样算式的翻译链相同；完整程序优化导致舍入不同是当前推断，尚未证明具体驱动根因。输出包含此限制，严格 GPU 对照报告保留 **failed** 状态。

新版本也修正了范围的有效性边界：有限端点相减可能溢出，但公式可以忽略输入并返回有限常量，此时仍应绘制。只有新采样版本允许该跨度，旧作品仍保留原行为。本地结果检查使用 builtin 判据；这不表示本地与原版的全部检查位置或浮点编译行为相同。

## 验证记录

| 检查 | 实际结果 | 边界 |
| --- | --- | --- |
| 全量测试 | 319 文件／5,810 项通过 | 49.59 秒 |
| Web 构建 | TypeScript 与 Vite 通过 | Vite 20.83 秒；保留既有大包提示 |
| 导入、编辑、保存重开、时间线、PNG、MP4 | DPR 1/2 通过 | 35.61 秒；实际系统随机值；输出可变 |
| 独立 PCG 与坐标参照 | CPU 与孤立 GPU 片段各 180/180 逐位相同 | 不代替完整生产程序 |
| 完整生产 GPU 跨范围坐标 | **10/20 相同，10/20 不同，严格检查未通过** | 普通和极大范围均有差异；最大 43 ULP |
| 实际 GPU 六倍补采 | 393,222/393,222 坐标逐位相同 | 6 × 65,537；范围仅 `[-1,1]`；检查每段实际结果 |
| 原 shader 与生产管线完整累积缓冲 | 36/36 完全相同 | 48 × 32；点与四边形；13/78 样本；`[-1,1]` 与 `[-π,π]`，另含 4 组跨度溢出用例；白色板 |
| 取消、倒退与资源释放 | 检查通过 | 软取消复用已取种子；显式 reset 后已登记资源为 0 |
| 跨度溢出的实际 session | 常量公式接受 13/13，传播无穷值的公式跳过 13/13 | 有限端点，GPU 实际执行 |

PNG 下载字节与对应 Worker RGBA 完全相同；视频上传保持对应目标 RGB 并使用不透明 alpha。两段视频均为 192 × 128、3 fps、3 帧；有损解码的 RGB 平均字节误差约 1.515–1.648，不作为原版视频一致性证明。预览、新导出与重新打开各有随机会话，不能要求它们共享一张相同图像。

最终独立对照用时 4.62 秒，状态仍为 `failed`；公开操作报告为 `passed`。二者验证前后源文件稳定，全部 396 个 `src/` 文件与最终代码一致。实际程序没有启用候选 shader 替换。完整记录分别在 `.cache/source-samila-sampler-complete/report.json` 与 `.cache/samila-sampling-public-complete/report.json`；测试和构建日志为 `.cache/samila-sampling-{tests,build}-complete.log`。

这些耗时来自并行验证，不能当作前后性能基准。CPU 时间、进程族峰值内存、驱动内存和完整任务 token 成本未测量；分页与缓冲数字仅为逻辑预算，不作提速或内存峰值承诺。

原版 JVM／JOGL 整窗对照仍为 **0/11**。本轮窗口检查返回 Mac 锁定，未取得原版画面。原版每次 display 的采样、热实例调整大小、截图继续采样和实际随机流仍未验收。

## 复跑与兼容

开发接口 `parseLegacyScene(text, {samilaSampling:'legacy-v1'})` 保留旧采样导入；加载和保存未标记的本地作品不会自动添加新版本。新版本与源数学、NDC、splat 及 bounded-v2 历史共同验证，未知版本或不完整组合明确报错。

当前验证入口已升级为同阶段坐标协议。从 `studio/` 目录复跑，使用固定原包和已准备的原包字节码证据，先生成噪声／色板及绘制参照：

```sh
python3 scripts/source-samila-noise-oracle.py
node scripts/source-samila-palette-oracle.mjs
node scripts/build-samila-sampler-oracle.mjs .cache/samila-sampler-oracle
node scripts/build-samila-direct-oracle.mjs .cache/samila-direct-oracle
node scripts/verify-source-samila-sampler.mjs .cache/source-samila-sampler .cache/samila-sampler-oracle/fixture.json .cache/samila-direct-oracle/fixture.json
node scripts/verify-samila-source-math-public.mjs .cache/samila-sampling-public --splat --timeline
```

需要项目锁定依赖、已安装的 Chrome、FFmpeg/ffprobe 和上述固定 JAR。严格采样检查当前应返回失败，不能将非零退出码忽略为通过。

浏览器验证使用无界面 Chrome，不占用前台屏幕。原始数组、原包提取和生成图像保留在忽略的 `.cache/` 中，不提交二进制。1.0 Apple Silicon 本地应用没有重新打包或替换。
