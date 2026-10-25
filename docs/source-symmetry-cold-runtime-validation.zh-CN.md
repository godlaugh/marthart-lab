# Symmetry 冷启动运行边界与原版预览对照

2026-10-25：原版完整输入的八帧离屏预览确认并修复两处生产错误：**冷对象点径错误、普通首帧预热执行过多**。作者数据保留原值；效果一致性仍未通过，不将本次修复视为 Symmetry 全部完成。

## 原版观察

使用未修改 MathArt 1.7.8 JAR（SHA-256 `a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018`），原 `Emperors_Cloak1.json` 保留 562,144 粒子、degree 23、burn-in 100、每次迭代 1、作者 dot_size 1.5 和 Wait 10。正常 ProjectState → MathArt.initScene → Scene.runFrame(false)，原驱动 Apple M2 Max / OpenGL 4.1 Metal90.5。

主视口为逻辑 405×486、pixel density 2、物理 810×972。仅注入配对时钟 1000 + 16 × 帧序号毫秒，八帧原始 Float32 时间、参数、投影与 modelview 矩阵已与生产核对。完整初始 2,248,576 个 Float32 值逐位一致；seed 为 `6403493509108980441`。

正常许可实际返回 VIEW=true、RUN=true、EXPORT=false。本次只运行允许的预览并读取诊断数据，没有执行原版录制／导出。完整正常预览含原水印和叠加，另存核心缓冲供算法对照；核心缓冲不替代完整原预览，也不代表公开应用窗口验收。原帧中仍观测到 GL1282，原始错误保留，不能声称原版无 GL 错误。

完整原始记录：`.cache/source-symmetry-original-full-20261025/Emperors_Cloak1-run5/`；中文说明及文件索引见同目录上层 `OBSERVED.zh-CN.md`、`run5-index.json`。早期失败 run1–run4 均保留。

## 修复及所有权

| 边界 | 原版实测／静态调用链 | 修复后的本地行为 |
|---|---|---|
| 冷点径 | BaseSymmetryChaosConfig 默认 1.8f；JsonSymmetryChaosConfig 不消费作者 dot_size | 新对象使用 1.7999999523162842；作者 1.5 不被覆盖 |
| 显式热修改 | 原 updateDotSize(F) 无条件存 max(1,value)；同作者值也可能改变运行值 | 独立 transient 字段记录已经消费的 Float32 值；1.50 可以将冷 1.8 改为 1.5 |
| 导出显示比例 | 热 setter 先钳制，splat 再乘 displayScale | 输入 .5 → 运行值 1 → 比例 3 时点径 3 |
| 保存与历史 | 作者配置与当前运行对象不同 | Save 保留当前热点径；序列化／重开删除 transient；历史与内存草稿保留已消费值 |
| 冷重建 | Apply／Reset 新对象重新用配置默认 | Apply、重新开始、公开源录制起点恢复冷值；覆盖无 raw 色板元数据的旧文档与固定预览入口 |
| 普通预热 | 原 update 只调用一次 runUpdatePass；后者钳制到最多 16 | 作者 burn-in 100 保留，实际首帧执行 16 + 1 + 1 |
| 重播预算 | 原 replay 保留剩余 burn-in，每次提交至多 12 | 不截断作者或整段剩余预算；普通执行及重建预算共同消费帧计划 |

点径热写入不改变 seed、Apply identity 或 replay identity；完整渲染／暂停捕获 identity 包含它，避免复用旧点径的画面。固定预览同样从点径 owner 取运行值；控件入口不再依赖 live 模式。普通预热与工作预算归同一个 frame-plan owner，不再分别解释 burn-in。

原 CPU setter 实测及首帧真实 GL uniform 的精简 fixture 为 [cold-runtime-20261025.json](../tests/fixtures/symmetry/cold-runtime-20261025.json)，保留原证据 SHA-256。Java NaN／Infinity 行为不是产品接受非法输入的依据；本地拒绝非有限 Float32 与非法 transient 状态。

## 八帧生产对照

生产使用实际 SourceIteratedSession / WebGL2，完整输入及上下文与原版配对。只做原始像素行方向、墨迹通道顺序和无效纹理 padding 的格式转换；没有改容差或替换期望图。

| 指标 | 修复前 | 冷点径／预热修复后 |
|---|---:|---:|
| 首帧实际数学步数 | 57,338,688（每粒子 102） | 10,118,592（每粒子 18） |
| 初始 Float32 差异 | 0 | 0 |
| 首帧不同 RGBA 像素数 | 370,670 | 162,715 |
| 第八帧不同 RGBA 像素数 | 399,516 | 345,325 |
| 首帧粒子最大绝对差 | 见原始比较 | 0.003773987293243408 |

修复显著减少首帧差异，但残差随迭代发展，不能声称效果一致。相同公式文本不保证不同 GPU 执行路径逐位一致，不能仅凭猜测归因驱动。后续只读探针已取得首帧第 16、17、18 步的真实完整状态：最大绝对差分别为 0.0006922781467437744、0.0017493963241577148、0.003773987293243408。因此分歧已存在于首次 16 步预热结束，尚未定位首个不同的迭代／运算。原 run6 与 run5 的首帧粒子、墨迹、正常预览等八项逐字节相同；生产加观察后的全部八帧粒子／RGBA 也与无中间探针运行逐字节相同。详见 `first-update-boundary-comparison.json` 与原版 `RUN6.zh-CN.md`。

原始对照在 `.cache/source-symmetry-production-full-20261025/`：`cloak1-baseline-run1`、`cloak1-corrected-run1` 及相应 `*-comparison.json`。每次均保留源码／输入前后 pin、完整八帧像素与粒子／墨迹、清理结果。修复后八帧观察含启动、诊断读回和写盘约 11.935 秒，未构成受控冷／热性能比较；CPU、完整进程族峰值内存、GPU 内存和 token 成本未测，不宣称提速。

独立 CPU 显式 `fmaf` 左关联模型还复现了全部 562,144 粒子在第 16／17／18 步的 x/y：合计 3,372,864 个 Float32 比较值全部逐位相同。未比较 metric，也没有把有限样本推为任意公式或具体驱动根因。该模型仅用于定位，尚未集成进渲染产品。完整可重跑源码和输入 pin 在原版证据的 `cpu-fma-run6-full/`；墙钟 1.538 秒、子进程 CPU 0.719 秒、单进程峰值 RSS 28,459,008 字节，均不是渲染性能对比。

精简全帧记录见 [full-preview-20261025.json](../tests/fixtures/symmetry/full-preview-20261025.json)，完整索引为 `.cache/source-symmetry-production-full-20261025/validation-index.json`。未提交截图、二进制或本地缓存。

## 验证范围

实际 production GPU 重播回归再次通过：6 组小批次共 219 帧，涵盖作者 burn-in 0／100／1000、暂停／更新、30／60 宿主 FPS和重播前未预热；各帧独立递推与完整粒子回读一致。另有有序参数快照、重复重播、取消后显式恢复，以及 65,536 粒子／640×480 的 30 帧完整重播，累计 100 次绘制、13,107,200 次数学步。脚本旧普通预热期望按真实原 GL 钳制修正，整段重播预算保持完整。原始报告 `replay-after-cold-fix-run1/report.json`；这是生产执行器回归，未将适配着色器当作原版完整帧。

生产相关 CPU 回归累计 12 个文件、222 项通过；新测试第一次将 time/frame 参数顺序写反导致验证器失败，纠正后 4 项通过，未修改产品迎合测试。TypeScript 与 2.0 Vite 构建通过，保留已有大 chunk 提示。范围包括 cold/hot fixture、保存／重开／冷重建、固定预览、身份、原帧调度、Symmetry/Map replay、GPU 资源和自定义公式边界。

[色板录制与替换的 144 项 App 检查](source-symmetry-recording-replacement-validation.zh-CN.md) 是先前固定源码基线，不能视为本次新点径实现已通过全部相同检查。[新的点径实际 App 矩阵](source-symmetry-point-size-ui-validation.zh-CN.md) 在本次源码上完成 83 项检查，包括同值事件、Save 后 retained PNG（比例 3）、文件重开、Apply、录制、无 raw 色板旧文档和固定预览。该矩阵的 14 项 CPU 检查是上述 222 项的子集，不重复计数。

本机只有一台 Mac；第二设备验证未执行。原版导出许可不可用、完整原窗口及多场景完整效果验收仍未完成，Goal 保持 M3。
