# Perlin 原版参考与纹理过滤修复

日期：2026-10-22。修复前基线 `aa392e7`。本轮已经修改正式渲染代码，并通过实际构建页面导入原版 JSON、导出 PNG 验证。结论只覆盖下面的 GPU filament 案例，整类场景验收仍为 **0/11**。

## 结果

使用原版 `Noise/noise1.json`，输出 500 × 600，在相同实际场景时间 `float32(1/30)` 比较固定中心区域 `[55,55,445,510]`（右下边界不包含）。区域是在修复前沿用既有比较规则选定，没有根据差异动态裁剪。

| 同时刻比较 | 不同 RGBA 像素 | RGB MAE | 最大通道差 |
| --- | ---: | ---: | ---: |
| 修复前原始 GPU 输出 / 原版 raw | 29,225 | 0.0594815441 | 1 |
| 修复前增强 PNG / 原版增强 PNG | 29,235 | 0.0596036442 | 2 |
| 修复后实际公开界面 PNG / 原版增强 PNG | **0** | **0** | **0** |

未裁剪整图仍有 13,043 个不同 RGBA 像素，RGB MAE 2.55831，最大通道差 210；包含原版文字、水印及增强边缘，尚未逐项完成归因，不能称整图一致。原版正常 FREE 许可、策略检查和水印全部保留。

两组原版时间分别为 0、float32(1/30)。时间 0 的原始中心区域同样由 29,057 个差异像素降到 0。各自连续三次暂停绘制的 raw 和 enhanced PNG 均字节稳定。当前产品初始固定回放 frameIndex 0 已执行一次更新，因此首次把原版未更新的时间 0 与产品初始图比较，得到的 138,945 个增强差异像素属于**时间未对齐的比较**，没有用它衡量本修复收益，也没有为了迁就截图修改场景时钟。

## 根因及结构修复

在原版真实 GPU draw 前读取 sampler uniform、绑定纹理、过滤状态及 mip 层，并恢复读操作改变的 active texture。此捕获没有改写 shader、uniform 或纹理；捕获前后正常画面一致。

- 原版 512 × 512 flow 纹理 level 0，与本地生成的 1,048,576 字节完全相同。
- 原版 256 × 1 palette 纹理 level 0，与本地 1,024 字节完全相同。
- 两个采样纹理都是 LINEAR_MIPMAP_LINEAR / LINEAR、CLAMP_TO_EDGE，实际各向异性值为 16。
- 原版 Processing `Texture.allocate` 在支持时使用设备的 `maxAnisoAmount`；本地 Perlin 仅设置了普通三线性过滤，漏掉此状态。

受控实验只补充设备支持的最大各向异性过滤，即使 raw 与 enhanced 的中心区域都变为零差异，支持这是本案例的直接原因。正式修复位于共同的 `SourcePerlinGpuDrawing` 纹理拥有者，因此独立 GPU 输出和保留的 CPU target 中 GPU 绘制都使用相同规则。没有硬编码 16，没有修改噪声公式、颜色数据或加入像素特判。

原公式合成器已经实现同一 Processing 规则。本轮将可选扩展解析提取到 `sourceProcessingTextureSampling.ts`，两处使用同一能力边界；没有扩展时维持默认过滤，扩展返回无效上限时明确失败并清理资源。nearest framebuffer 附件不应用该规则。公式字形的既有采样行为保持不变。

## 验证与复现

已实际执行：

- 8 个相关测试文件共 70 项通过，覆盖 Perlin GPU/保留 target/录制、暂停 PNG、公式合成生命周期与导出。
- `npm run build:v2` 通过；仍有既有的大 chunk 提示。
- `node scripts/verify-source-perlin-gpu.mjs`：独立原版 shader 参考，六种 flow 纹理、两种 render style、尺寸阈值、更新色板、共享 target、无扩展路径及资源失败清理；另以两组原生中心区域 SHA-256 固定回归。共 21 组结果、10 组失败／清理检查通过，剩余 GL 对象为 0。
- 公式合成器 10 项真实浏览器检查通过，包括 HTTP 字形摘要、重复绘制、PNG、透明混合、取消及 10 帧 MP4。
- 构建后的 5179 页面实际导入原版 JSON，导出 500 × 600 PNG，无页面错误；最终 PNG 的固定区域与原生增强图逐像素全等。

GPU 验证脚本显式禁用 ANGLE program cache。独立参考不导入生产采样能力解析函数；其过滤规则来自 Processing 分配方法和实际 draw 状态。新增的无扩展测试首次失败，是参考复用纹理还保留此前的 anisotropy=16；已在模拟扩展缺失前恢复其默认值 1，保留失败记录，纠正后通过。不是放宽像素阈值。

精简、可提交的原生输入与两组区域摘要见 [native-gpu-raster.json](../tests/fixtures/source-perlin/native-gpu-raster.json)。摘要包括 seed、palette、uniform、尺寸、时间、ROI、draw 证据哈希，原始大图不入库。脚本需要已有 Chrome、项目依赖及固定原版 JAR；其他设备如果摘要不同，应保留设备证据继续调查，不自动放宽容差。

## 原生执行范围与证据

正常离屏宿主使用原版 bundled JVM，加载原版 JSON、场景和 shader，逻辑导出 250 × 300、density 2；实际 buffer 为 500 × 600。原版 primary 为 405 × 486、density 2；本地 CSS viewport 为 406 × 486、density 2。本例 GPU 绘制使用实际导出 resolution 和捕获的 uniform；primary 宽度并未完全相同，因此不能外推其它依赖窗口宽度的场景。

时间对齐通过原版 `setRenderMode(30)`、一次 `update(false)` 再暂停绘制实现，实际 `sceneTime` 和 `frameDeltaTime` 均为 float32(1/30)。没有直接伪造时钟字段。原生宿主与真实窗口的像素校准此前只完成 Cornucopia，未新增 Perlin 原版 GUI 窗口对照。

| 完成任务 | elapsed | 结果 |
| --- | ---: | --- |
| 未更新时间 0 的正常三帧 | 9.364 秒 | exit 0 |
| 实际 draw 状态和纹理捕获 | 6.722 秒 | exit 0，正常图不变 |
| 时间对齐后的实际 draw 与三帧 | 6.983 秒 | exit 0，三帧稳定 |

所有原生运行带 55 秒进程组截止时间，实际未超时，均已回收，进程组不存在；无桌面输入或主屏窗口。运行前保留正常 policy 缓存备份；settings 摘要未变，license 文件保持原先不存在。正常启动产生的远端策略刷新保留，没有把旧备份盲目写回。

以上原生任务不同，不能作为冷暖性能对照。另外以同一生产 renderer、同输入 500 × 600 和同一浏览器完成两次交错前后对比：临时隐藏可选扩展复现旧过滤，每次新建独立 context。

| 过滤 | 两次首帧（含编译、上传、读回） | 两次 warm 30 帧绘制加读回 |
| --- | --- | --- |
| 旧默认过滤 | 13.7 / 10.2 ms | 89.0 / 86.4 ms |
| 最大各向异性过滤 | 11.4 / 11.0 ms | 89.1 / 90.1 ms |

完整记录为 `benchmark.json`。两次样本不足以证明性能改善或回退，首帧并不代表 OS/GPU 冷缓存；flow 生成不计入这些绘制测量。CPU 时间、进程族峰值内存、独立 GPU 时间和 agent token 成本未测量。

完整本地证据位于 `.cache/perlin-native-reference-20261022/`：

- `native-perlin/`：初始暂停参考；`draw-state/native-perlin/`：actual shader、uniform、纹理层与过滤。
- `matched-time/native-perlin/`：时间对齐后原生三帧、clock、正常策略和资源清理。
- `production-replay/`、`anisotropy-control/`：修复前与单变量实验；`comparison-matched-time.json`：同时间比较。
- `product-final/report.json`、`export.png`、`comparison.json`：实际构建 UI 导出、Worker 帧状态及最终比较。
- `formula-regression/report.json`：共享过滤规则提取后的公式检查。

剩余范围是完整画面、动画、CPU Perlin、其他原版模板/尺寸以及其它设备，不能由这个固定 GPU 案例直接判定通过。
