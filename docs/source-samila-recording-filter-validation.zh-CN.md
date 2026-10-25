# Samila 录制预览：纹理过滤修复验收

2026-10-25：**上一轮两帧、7 个颜色通道的差异已经修复。** 正式 ArtRenderer 对照原版的 20 张完整预览全部逐字节一致。原因是漏用了原版的纹理过滤设置，不是此前怀疑的 CGL 与浏览器混合舍入差异。Goal 仍在 M3；这项结果不代表所有场景或 2.0 发行已完成。[结构化证据索引](../tests/fixtures/source-samila-recording-filter/20261025.json)另存文件摘要。

## 修复及依据

原版 Processing 在创建纹理时启用设备支持的最大各向异性过滤。新采集的 5 帧均实际读到 16 倍，且没有独立 sampler 对象覆盖它。之前只记录 LINEAR min/mag，漏记了这项参数。本地使用的 Three.js 0.180.0 又会跳过无 mipmap 纹理的 anisotropy 设置，因此只给属性赋值并不能生效。

现在显示资源所有者在自己的纹理上传回调中应用相同的设备能力，保留 LINEAR、level 0 和原始 RGBA。回调通过公共 `initTexture` 执行，不读取 Three 的私有纹理句柄。上传失败会阻止后续绘制，保留资源供释放；同一资源不能交给第二个 renderer，以免产生预算之外的第二份 GPU 缓存。重复绘制复用上传；需要重新上传时重新查询能力。真正的浏览器 context lost/restored 尚未单独实测。

定位过程保留了反证：没有该过滤时，独立 CGL 与 ANGLE 的 18 个完整采样/混合缓冲相同，二者都复现原 7 处差异。补上实测参数后，独立 CGL 对新旧两组各 5 张原版图均完全相等。差异点变化的是采样 RGB，alpha 没变；没有针对像素位置、颜色值或误差阈值加补丁。

[原版状态与隔离实验说明](../.cache/samila-preview-isolation-20261025/README.zh-CN.md)保留原始 JAR、Processing 类、状态、输入及运行摘要。

## 正式代码对照

| 原版参考 | 完整 RGBA 结果 |
| --- | --- |
| 同尺寸、白背景 | 5/5 完全一致 |
| 3 倍缩小、白背景 | 5/5 完全一致 |
| 3 倍缩小、非黑背景，上一轮参考 | 5/5 完全一致 |
| 3 倍缩小、非黑背景，新采集参考 | 5/5 完全一致 |

每次输入是原版完整导出图像，包含其正常 FREE 品牌；比较整个录制预览 FBO，不裁剪、不遮罩、不修改 alpha。这个验证隔离显示合成过程，不代表本地生成器已经复刻品牌层。终点仍是原版 `endOnscreenDraw` 之前的有效主 FBO，没有证明真实 OS 窗口合成。

[20 帧正式对照](../.cache/samila-preview-isolation-20261025/production-preview-2026-10-25T08-34-25.628Z/report.json)的源文件与参考摘要在运行前后相等，GL 无错误、隐藏窗口全部关闭。原版新采集继续保留原离屏宿主的 GL_BACK 限制，没有将这些错误隐藏。

## 扩展测试与剩余边界

另用独立 CGL 生成 12 种合成输入的预期图，连续驱动同一个实际 ArtRenderer。11 项完整 RGBA 相同，包括背景 alpha 0/64/255、非整数缩放、active resize、录制/普通预览切换及新帧。8 次 PNG 检查保留全部原始 RGBA，包含 alpha 为零时的 RGB。

**一个扩展案例仍有差异：24×18 高对比度合成图缩为 8×6 时，3 个像素的 4 个通道相差 1。** 该输入不是原版 Samila 采集帧。它单独保留为未完成项，没有放宽阈值，也没有把 12 项都标为通过。更换 highp sampler 后差异不变。独立分阶段对照确认：输入字节、行方向、Float32 顶点与 UV 相同；混合前已有 13 个 Float32 组件不同，最大约 0.00294。具体纹理 footprint/gradient 或后端各向异性实现仍未隔离，不能把它称为最终混合舍入。见[扩展采样诊断](../.cache/samila-preview-filter-validation-20261025/cgl-sampling/README.zh-CN.md)。

[12 项正式验证](../.cache/samila-preview-filter-validation-20261025/renderer-2026-10-25T08-39-12.300Z/report.json) · [独立 CGL 预期](../.cache/samila-preview-filter-validation-20261025/native-oracle-run1/report.json)

真实 App 的[完整录制并恢复、停止保存并延迟 resize、在原生结果交付前取消](../.cache/samila-native-recording-20261025/ui-2026-10-25T08-42-28.981Z/report.json)三条流程也通过，原始上传不变，窗口及拥有的原生进程均已关闭。

本轮 2 个相关测试文件共 32 项通过；TypeScript、`build:v2` 与 diff 检查通过。构建保留已有的较大 chunk 提示。测试覆盖纹理扩展缺失、异常能力、上传/GL 失败后的禁止重试、纹理重新上传、跨 renderer 使用和释放。模拟测试不作为实际 GPU context restore 的证据。

## 成本和范围

20 帧正式对照脚本耗时 3.81 秒，`time` 为 4.36 秒 wall、8.17/5.70 秒 user/system，报告最大 RSS 578,437,120 字节。12 项显示验证脚本耗时 2.61 秒，`time` 为 2.98 秒 wall、6.61/4.01 秒 user/system，最大 RSS 554,860,544 字节。独立 CGL 12 项期望生成耗时 0.82 秒。App 三流程脚本耗时 14.73 秒，`time` 为 15.11 秒 wall、20.36/8.13 秒 user/system，最大 RSS 734,461,952 字节。

每次使用新隐藏宿主，系统和驱动缓存未控制。前后案例数量、采样质量不同，不据此声称加速。新增过滤的纯 GPU 开销、进程族同时峰值、GPU 内存和代理 token 成本未测。

本轮只修改开发分支的录制预览过滤，已安装的 1.0 和发行包没有更新。后续 [16 项原生界面验收](source-samila-native-workflow-validation.zh-CN.md)已补齐热编辑、Apply、resize、画质、库切换和同 ID 文件替换；其他明确需求和发行验收仍保留。

## 后续梯度隔离：保留差异，排除错误修复

同日追加 9 项最小实验，固定原合成输入、24×18→8×6、4 samples、RGBA32F，双方使用同一片段表达式。隐式采样各自逐位重现上一轮结果。插值 UV 有 1 个 Float32 分量不同，实际导数有 16 个不同；显式使用实际导数时，采样差异从 13 个分量降为 7 个。固定相同梯度后，CGL 与 ANGLE 的整个缓冲相等，固定 UV、关闭各向异性及 texelFetch 控制也相等。

但 **CGL 的固定梯度结果相对其原隐式采样仍改变 13 个分量**；ANGLE 的这两种结果原本就相同。因此固定梯度会把 CGL 移向当前 ANGLE 结果，并未恢复原版行为，不能作为产品修复。证据把差异收窄到插值／导数或隐式 footprint 选择，不支持“相同显式输入下各向异性过滤仍不同”的解释。每采样点内部实现仍不可见。本次未改产品、未改容差，原 4 字节失败继续保留。

见[9 项梯度隔离说明](../.cache/samila-preview-gradient-20261025/README.zh-CN.md)、[跨后端完整比较](../.cache/samila-preview-gradient-20261025/comparison-run1.json)及[同后端 implicit 与 fixed 比较](../.cache/samila-preview-gradient-20261025/implicit-vs-fixed.json)。
