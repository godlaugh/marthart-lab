# 复根点云完整终点对照与绘制差异定位（2026-10-27）

后续进展见[点云原生接入与验收](source-roots-point-native-integration.zh-CN.md)。以下保留原生接入前的 WebGL 对照与诊断记录；不代表当前工作树仍未接入原生通路。

本轮完成了有界点云输入的原版参考、两次实际产品独立求解，以及完整 RGBA 分层比较。**当前生产 WebGL 点云仍与原版有差异；没有修改生产代码，也没有完成 Roots 整族验收。** 现有原生 CGL 服务在同顺序诊断中三次完整数学帧零差异，但尚未接入产品点云通路。

桌面包仍为 `2.0.0-preview.14`。2.0 的 11 类场景整体目标、M3 和 Goal 均未完成。本轮只有同一台 Apple M2 Max Mac 的证据，没有跨设备结论。精简路径和 SHA-256 见[证据索引](../tests/fixtures/source-roots-point-cloud-reference/20261027.json)。完整原包、像素、二进制及运行记录留在本地忽略目录，不提交到 Git。

## 输入与完成边界

点云输入复用[高密度终点](source-roots-dense-terminal.zh-CN.md)的有界配置，仅将 `settings.render_mode` 从 `GPU_DENSITY` 改为 `GPU_3D`。其来源是原包 `Degree10_UnitCircle_T1T2_Formula06.json`，有界配置采用 131,072 个样本、4 个线程、空时间线、32,256 批大小和 seed 0；不等于原预设 47,550,000 个样本的默认终点。多项式、参数、相机、调色板和三组公式保留。输入 SHA-256 为 `1b2a2d9d26486916ad3cec87bc7e3bea230791a8db06ff6912532e93470494c6`。

原版实际 JVM 最大堆为 536,870,912 字节，主画布逻辑尺寸 405×486、密度 2；离屏目标逻辑尺寸 250×300、物理尺寸 500×600、密度 2。原版与产品均保留 1,000 万点环形容量和 300 万点最近窗口，实际完成 1,310,720 个根，没有降低点数或只比较局部区域。

原版 `GPU_3D` 的 `pendingPointCount` 保存供回退使用的历史批次，终点为 1,310,720，**不能套用密度模式的 pending=0 条件**。完成依据是实际原版完成谓词、四个线程结束、计算队列为空，以及环形总写入、有效保留和实际绘制覆盖均为 1,310,720。产品自己的待处理队列归零单独记录。

产品采集经过真实 `Generator → generation Worker → 4 个计算 Worker → RootsNativePresentationSession → WebGL2`。两轮各收到 44 个数据批次，其中 4 个携带结束标记；没有将原版根或 VBO 输入独立求解主验证。终点以及后续两次暂停输出全部保存。实际帧先清屏，`useAccumulationBuffer=false`、fade 次数为 0；暂停稳定性来自观测，不是由 `showTrails` 或配置名称推断。

CPU 后验检查按实际提交顺序核对 raw ring、正式 metric 限制函数和 GPU 上传数据，六个快照均覆盖全部 1,310,720 个四元组，差异为 0 字节。GPU 读回、Session 像素和 Generator 完成像素也逐字节相同。数学层 alpha 为 25–255，未强制改成不透明。

## 原版参考的资格与宿主校准

最终参考为 `default-fbo-host/reference-r5`，独立重复为 `reference-control-r6`。两次正常策略检查的 VIEW、RUN、EDIT、EXPORT 均允许；保留 FREE 策略的原版水印、品牌、安装包、设置和许可。没有改 shader、应用内部标志或原版计算逻辑，没有可见窗口。

两次均先执行正常主画布 `beginDraw/endDraw`，不推进 Scene。JOGL 无窗口目标的默认 framebuffer 实际为 FBO 1；宿主适配器仅在当前 drawable 所有的默认 FBO 上，将默认 `GL_BACK` 映射到公开的 `COLOR_ATTACHMENT0`。29 次映射的请求、实际绑定及调用栈均保留。实际 `glGetError` 调用正常转发，被动记录的非零错误结果为空，stderr 为空，进程清理确认完成。

每次运行都保留终点及两次暂停的三段完整 RGBA：最后品牌绘制之后、`endDraw` 之后、`loadPixels` 之后。三段完全相同；翻行一次后等于完整品牌缓冲和解码后的原版 PNG。因而最终参考的数学层、公式层、品牌层和 PNG 边界可以分别比较。原版 r5 的完整品牌图仍有 141,277 个非不透明像素，不能把 alpha=255 当作原版 PNG 契约。

### 观察器勘误

早期 `reference-r4` 的数学及公式 GPU 捕获有效，但 PNG 受到未初始化主画布的宿主影响：原版 `endDraw` 弹回空的 primary framebuffer，没有重绑目标；其后的 alpha-only clear 错落在离屏目标上。单变量正常初始化主画布后，alpha 保留，14 个点云 uniform 不变。这是宿主生命周期问题，不是产品 alpha 缺陷；旧 r4 PNG 不能作为原版导出规范。旧文件和 r2/r4 比较报告均保留，没有覆盖。

另有两个观察器问题已分开保存：早期 point-cloud r1 的旧 GL 查询产生 1280；r2 的宽泛 `glDraw*` 匹配误把状态操作 `glDrawBuffer` 当作绘制，再查询 program 0 的 uniforms，制造了 1281。最终 r5/r6 改用精确绘制方法集合，不再出现这些错误。

对先前 dense `reference-r1` 的只读回溯也确认：终点和两次暂停期间的 **6 个 1281** 属于上述 `glDrawBuffer` 观察器问题。frame 0 的原版 `probePointSplatSupport` 错误及正常 quad 回退是另一条路径，不能合并解释。本轮未重跑或修改 dense 输出；旧 dense 数学、公式及严格密度差异结论保持，历史报告不应被称为 GL 全程无错误。证据为 `dense-observer-retrospective.json`。

## 独立求解后的完整画面对照

下面均比较完整 500×600、300,000 像素、1,200,000 个 RGBA 字节，包含 alpha，不裁切 ROI。每轮终点与两次暂停得到相同的差异计数。

| 产品独立运行 | 数学层不同像素 / 字节 | 三组公式后不同像素 / 字节 | 数学层单通道最大差 |
|---|---:|---:|---:|
| run 0 对原版 r5 | 13,287 / 17,735 | 13,235 / 17,642 | 4 |
| run 1 对原版 r5 | 7,432 / 9,459 | 7,399 / 9,404 | 3 |

比较器保留 `status: differences`，退出码 1 表示严格比较未通过，不是脚本崩溃。三组公式后的艺术层取自最后一次实际公式绘制后的完整缓冲；没有把数学层的通过或失败代替公式层验证。对完整原版 raw/enhanced PNG 也保留比较：run 0 分别有 21,205 / 23,295 个不同像素，run 1 为 15,707 / 17,407。这些图还包含原版品牌，不能把其全部差异称为“只有水印差异”。

原版自身独立 r5/r6 也不是逐位相同：数学层 19,679 个像素、27,257 个 RGBA 分量不同，最大差 4；完整品牌/raw PNG 为 19,077 个不同像素，增强 PNG 为 20,740。两次各自内部暂停均稳定。原版并发到达顺序不是固定种子即可保证的稳定图像顺序；这不构成放宽比较阈值的理由，也不能据此把所有产品差异归因于到达顺序。

## 同顺序诊断定位到了哪里

独立主验证保留失败。另行标记的诊断才把原版 r5 的实际完整点流按原顺序交给生产 `RootsNativePointCloudGpu`，用于隔离求解器和到达顺序。当前 WebGL 的 `run-4-calibrated` 仍有 **11 个像素、13 个 RGBA 字节不同，最大差 1**。这是最终 r5 点流的数字；较早 r4 的 9 像素结果不是当前参考。

实际 Transform Feedback 诊断以相同 shader 数学主体独立链接程序，读取全部点的 clip、pointSize、metric，再附加已有 world/view 局部量。它不是对原应用已链接程序的直接截获。反射名称/类型/大小、每块实际写入数和完整读回均核验；追加输出前后原有六个输出的 7,864,320 个 Float32 词保持相同。

观察到 world XYZ 的 3,932,160 个词全相同，第一处分歧是 view Z 的 44,480 个词。仅将浏览器 clip 的 Z/W 替换为原生诊断值，整图差异归零；仅替换 pointSize，仍为 11 像素差。因此这个输入的残差不能仅归因于 pointSize。替换实验是因果诊断，不是可发布的实现。

另一个候选只把**实际浏览器 GPU 输出的 world XYZ**送入现有 `transformRootsNativeViewBatch`，再经过原 projection/fragment，整图也为 0 差。没有把原版逐点 view/clip 值输入候选，也没有用 Java/CPU 三角函数替换原 GPU raw→world。但候选 clip Z 仍有 364,030 个词不同，pointSize 也不同；本例 depth test 关闭，不能宣称所有中间状态等价。单次 CPU helper 约 **129 ms**，还未计 GPU→CPU world 读回和实际产品集成成本，不能直接引入每帧往返。

## 现有 CGL 服务的结果与接入限制

`production-cgl/prepared-r1` 通过生产编码器、生产 `createSourceRendererService` 和 preview.14 内现有 helper，按原版点流顺序绘制同一完整数学帧。三次均为 **0 像素、0 RGBA 字节差异**。这是现有服务的实际诊断，不是新写的独立 CGL oracle，但也**不是 Generator、界面或 Roots 生命周期已经接入**。

本次只持有有效点流，未同时持有产品的 160 MB ring。若直接整帧打包，ring、活动属性、传输副本和目标合计已超过 256 MiB；不能据诊断通过声称产品容量通过。当前 generic v3 是清屏后销毁的一次性目标，不能代替 Roots 的保留历史/淡出、resize、取消和资源释放状态。通用纹理协议的 mipmap 过滤与原版 LINEAR 仍不同；本例像素相同不证明所有纹理状态等价。三次诊断只覆盖数学层，不覆盖公式、品牌和完整桌面。

下一步应复用现有原生服务和有界分块所有权，为 POINTS、实际 palette 过滤和保留目标生命周期建立明确合同，再做真实产品、容量及取消恢复验证。不得伪装为 triangles、减少点数、把整帧大副本切片当作有界生产，也不应直接集成约 129 ms 的 CPU 往返候选。

## 已执行检查、成本与证据位置

主采集、最终 r5 严格消费、两轮独立对照和上述诊断已经实际执行。新增验证器另通过语法检查与 `--check-sources`。六个严格消费者负例实际拒绝：空 runs、缺暂停阶段、少一个 ring 点、少一个实际绘制点、缺 GPU 上传 pin、空 glyph 集。PNG 边界另有六个 CPU 检查，覆盖实际正常 primary 的三个阶段以及旧参考缺证明、未初始化 primary、模拟 endDraw 改 alpha；局部边界通过不替代全局 GL/权限/清理资格。未知 GL 错误记录不当作空记录放行。本轮没有因文档整理重复 GPU、全量测试或构建。

| 实际工作 | 耗时及范围 |
|---|---|
| 两轮实际产品采集 | 22.243 s；完整进程族 CPU/RSS 未测，不据此声称性能改善 |
| 原版 r5 / r6 | 11.526 / 11.302 s；子进程 CPU（含编译与监测）11.699 / 10.570 s；抽样进程族 RSS 峰值 946,634,752 / 842,940,416 B |
| CPU view 候选 | helper 129.071 ms，CPU 136.225 ms；整个 CPU 准备 443.500 ms、该进程峰值 RSS 139,001,856 B；不含浏览器进程族/GPU 私有内存 |
| 候选浏览器 | 整体 1.320 s；含诊断 HTTP/读回的绘制循环 158.100 ms，非生产帧时长 |
| 现有 CGL 服务三次 | 172.801 / 29.645 / 28.754 ms，首上下文与两次复用分开；另有含冷 Vite 加载的编码准备 2,378.255 ms |

CGL 短诊断只有 3 次进程抽样，RSS 峰值 284,096 KiB、观测 CPU 220 ms，不是精确高水位或稳态基准。所有性能数字均限本次输入；token、GPU 私有内存、跨设备和正式端到端成本未单测。

原版 r5/r6、实际产品与诊断的自有浏览器/服务/JVM 均已关闭或 reaped，剩余自有进程为 0。最后核对 615 个 `src` 和 27 个 `server` 文件与独立产品采集时的 SHA 全部相同。三个证据目录合计约 2.5 GB、约 1,900 个文件，保留在 `.cache`，不随源码提交；封存后的准确清单以本地 evidence-index 为准。

主要可复用入口：

- [验证器](../scripts/verify-roots-point-cloud-terminal.mjs)：`--capture-only` 执行独立产品采集，`--check-capture` 执行 CPU 完整性核对，`--compare … --require-png-boundary` 执行最终严格对照。
- `.cache/roots-point-cloud-product-20261027/capture-r1/`：两轮生产结果、`native-comparison.r5.json`、实际上传链及绘制状态。
- `.cache/roots-point-cloud-20261027/default-fbo-host/`：最终 r5/r6、`repeat-r5-r6.json`、原始数值/像素、权限与宿主映射。
- `.cache/roots-point-cloud-renderer-diagnostic-20261027/`：`run-4-calibrated`、TF 完整输出及 `world-view-candidate-findings.json`。
- `.cache/roots-point-cloud-20261027/production-cgl/prepared-r1/`：实际生产服务的三次同序诊断。

尚未关闭的边界包括默认 47,550,000 样本终点、独立求解器和并发排序差异、点云原生产品集成、完整 ring/window 容量、动态相机/旋转/拖尾、正式界面与打包回归、品牌以及跨设备验证。本轮的完整像素诊断不能代替这些验收。
