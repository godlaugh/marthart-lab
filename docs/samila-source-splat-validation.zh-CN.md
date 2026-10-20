# Samila 散点与颜色验证

2026-10-21，2.0 的 M3 实现阶段。新导入的 Samila 项目接入原版散点尺寸、噪声颜色和累积规则。已有本地作品保持原行为；未重新打包或替换 1.0 Apple Silicon 应用。原版 JVM／JOGL **整图一致性仍为 0/11**。

最终呈现的后续修正见 [Samila 最终呈现验证](samila-source-presentation-validation.zh-CN.md)。下列结果保留本批次当时的代码与验证范围。

## 本次改变

| 项目 | 新导入项目采用的规则 |
|---|---|
| 绘制版本 | 显式保存 `samila-splat-1.7.8`；开发接口可用 `samilaSplat:'legacy-v1'` 保留旧导入绘制行为 |
| 点尺寸 | 消费 `spot_size`，默认 .01；不把通用 `dot_size` 当作 Samila 点尺寸 |
| 参考尺寸 | 预览使用实际画布像素尺寸；PNG、视频保留已呈现主画布物理高度作为点尺寸参考，归一亮度使用未缩放的标称尺寸 |
| 点与四边形 | 对实际目标进行 16 点绘制探测，成功使用 POINTS，否则使用原版四边形核；新目标重新探测 |
| 噪声颜色 | 原版 CPU 生成的 256×256 Float32 二维 Simplex 表；在最终 NDC 坐标采样，采用线性过滤和边缘夹取 |
| 色板 | 根 `palette` 字符串数组，缺失使用原版六色；1024 项 LUT、源浮点插值和尾部接缝规则；空数组使用默认余弦分支 |
| 编辑 | 提供等距 RGB 色标、余弦系数和颜色偏移；隐藏没有源含义的曲线、HSV、周期及点像素半径控件 |
| 导入优先级 | 通用 JSON `color`、`render_mode` 不冒充源运行时设置；保留原配置。背景按 `background_color`、`bgcolor` 优先级和源整数颜色格式读取，只使用 RGB |
| 衰减与亮度 | 寿命公式固定使用 60 Hz；累积衰减与源归一尺度独立于文档采样帧率。保留源 Float32 getter 值，非有限值及本地资源超限明确报错 |

颜色解释、输入版本校验和 Worker 传参分别由单一边界持有。Samila 与 Fractal 复用独立 `sourcePaletteRuntime`，避免维护两份源 LUT 算法。预览队列和直接导出共用穷举的 `snapshotGenerationInput`，新输入字段缺少登记时会产生 TypeScript 错误。

原始配置、未消费字段和数值词法保留在项目来源记录里。源颜色格式解析失败时恢复为白色并报告；背景透明字节不参与源 RGB 背景。旧本地文档不会因打开或保存而自动切换版本。

## 独立参照的范围

固定原包 `MathArt-1.7.8-b07191b3e97da6fe465555ef6e61a0be.jar`，SHA-256：

`a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018`

静态证据见本地 `.cache/v2-samila-splat-audit.md` 与 `.cache/v2-samila-splat-source/manifest.json`。Processing 的 JSON getter 另外绑定固定 core JAR，区分背景的 `toString()` 和色板数组只接受字符串的规则。

噪声期望值由独立 Python 字节码解释器生成，65536 个 Float32 值完整哈希比较；色板参照由独立的源方法转录生成。图像参照运行原包完整 vertex／fragment shader，仅适配 GLSL ES 头部，并把两条数学公式替换为固定坐标以排除随机流差异。生产侧运行实际 `IteratedDensitySession`，读取全部浮点累积像素，明确转换通道排列后比较。

原 shader 夹具共 156 组，其中 120 组符合实际宿主的噪声 LUT／色板选择，计入生产对照；其余 28 组人工 ramp LUT 和 8 组直接噪声 fallback 仅保留作诊断，不计作通过。四边形分支通过只抑制首次 16 点探测绘制来触发，随后恢复正常调用。这验证故障回退，不能说明原版 macOS 驱动会选择哪个分支。

## 实测结果

公开流程的前两次验证找到了实际生产问题：Worker 参数白名单遗漏主画布高度，以及 DPR 2 下的通用预览预算缩小了实际累积图。前者通过共享、编译期穷举的输入快照修复；后者使用精确尺寸分支，保留图像／工作缓冲预算并在超限时拒绝。独立参照没有绕过这两个公开入口问题。

另有一次失败来自脚本用 JSON 字符串顺序比较保存对象，已改为深度内容比较。全套测试首次发现旧视口用例在 40 像素高画布、默认极小散点下确实没有覆盖任何像素；夹具显式指定点尺寸和参考高度后继续验证 NDC 重心，不改变生产规则。失败报告与日志均保留在本地 `.cache/`。

最终固定源码验证结果如下。公开流程与 GPU 对照运行前后源码哈希一致，浏览器、Vite 和导出服务均清理成功，无 Worker 错误。

| 检查 | 实际结果 | 墙钟时间 |
|---|---|---:|
| 全套测试 | 317 个文件、5,795 项通过 | 43.93 秒 |
| TypeScript 与 Web 构建 | 通过，保留既有大 bundle 提示 | Vite 阶段 16.80 秒 |
| 独立噪声 LUT | 65,536 个 Float32 值完整 SHA-256 相同 | 独立参照生成约 11.31 秒 |
| 独立色板 LUT | 7 套、每套 1024×RGB，全部逐值相同，包括偏移、负偏移、余弦与尾部接缝 | 包含在下列对照中 |
| 原 shader → 生产 GPU | 120/120 组、788 项断言；最大归一化绝对误差 `2.98e-8`，阈值 `2e-5` | 7.38 秒 |
| 实际 App 操作 | DPR 1／2；空色板→手动→余弦、A R 编辑、点尺寸 .08→.12、保存重开均通过 | 与下列导出合计 26.69 秒 |
| PNG | 两种 DPR 均导出 192×128 非空图像，完整 RGBA 等于实际 Worker 输出 | 同上 |
| MP4 | 两种 DPR 均经 FFprobe 确认 192×128、3 fps、3 帧；各帧编码前上传 PNG 的完整 RGBA 等于对应 Worker 输出 | 同上 |

| DPR | 实际预览像素 | 导出保留的主画布高度 | 源尺寸 uniform（预览／PNG／视频相同） |
|---|---:|---:|---:|
| 1 | 822×537 | 537 | 5.9666666984558105 |
| 2 | 1644×1074 | 1074 | 11.933333396911621 |

公开夹具使用固定原包 samila1 的公式和参数，明确改为小批次、关闭拖尾，并编辑配色和点尺寸，检验本地操作链路；不是原包高负载整图基准。噪声表 SHA-256 为 `eedfca17edaf176e3d94ba52814c708ca30a06b61fe0063c27346f8c82145943`。

人工可读的详细报告是 `.cache/source-samila-splat-release/report.md` 和 `.cache/samila-source-splat-public-release/report.md`。整体翻译审计仍因 **71 处既有界面缺口**失败；本批新增界面没有遗漏，不把整体翻译审计记为通过。

## 仍未覆盖

本地确定性随机流与原版逐帧随机流不同。CPU 路径仍有数学和栅格精度差异，不能把 GPU 累积对照推广为 CPU 等价。负透明度按源累积规则允许并由调色阶段处理；源最终呈现到透明目标时的额外混合、操作系统窗口合成和导出行为，尚未由本次累积对照证明。

原版窗口本轮检查返回锁定，没有获取原版运行画面。静态审计纠正了旧记录：原版同一实例热调整尺寸会清空像素、重新探测点支持，但保留 theta 锚点；本地仍使用可重放的冷重建。原版实时线程、高批次长期补采和跨设备行为待验证。

不提出性能提升结论。记录检查墙钟时间和实现的有界资源统计；完整任务 token、进程族 CPU／峰值 RAM、驱动内存与等价原版端到端基线未测量。额外 LUT 和探测临时内存计入实现预算，探测按小块读取并支持取消。

## 复跑

在 `studio` 目录使用已有固定工具链、Chrome、FFmpeg 和固定原包：

```sh
python3 scripts/source-samila-noise-oracle.py
node scripts/source-samila-palette-oracle.mjs
node scripts/build-samila-splat-oracle.mjs --noise-lut .cache/samila-noise-oracle/noise-lut.f32 --palette-fixture .cache/samila-palette-oracle/fixture.json
node scripts/verify-source-samila-splat.mjs
node scripts/verify-samila-source-math-public.mjs --splat
npm test
npm run build
```

前三个脚本生成独立参照，第四个脚本消费参照并比较生产 GPU；参数和默认本地证据路径见各脚本。公开流程直接导入、编辑、保存重开并导出 PNG／MP4，使用无界面的 Chrome，不操作用户前台窗口。
