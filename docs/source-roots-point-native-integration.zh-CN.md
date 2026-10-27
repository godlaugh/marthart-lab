# Roots 点云原生接入与验收边界（2026-10-27）

本次在 `c94bc0e` 后接入 Roots 点云的 v15 原生绘制通路。共享绘制输入、原生持久目标、页面代理与 Worker 异步交接已落地；**同序 renderer 诊断、两次实际 Generator 独立求解，以及 preview.15 的隐藏桌面导入、暂停 PNG、保存重开已通过**。两次自然到达的终点图像不同，不能将链路完成写成重复图像或原版全图一致。Roots 整族和 2.0 全部 11 类场景尚未完成。

`2.0.0-preview.15` 的构建、签名、基本启动/恢复和 Roots 专项界面验证分别留存证据。证据仅来自同一台 Apple M2 Max Mac，未验证第二台设备。精简机器索引见 [fixture](../tests/fixtures/source-roots-point-native-integration/20261027.json)。原版参考资格、宿主校准、独立到达顺序差异及历史失败见[点云完整终点对照](source-roots-point-cloud-reference.zh-CN.md)；密度模式是[另一条已有验收](source-roots-dense-terminal.zh-CN.md)，本次不替代它。

## 生产输入与资源归属

`rootsPointCloudDrawing.ts` 同时供 WebGL 和原生使用：shader 数学主体、14 项 typed uniform、256×1 RGBA8 LUT、clear/fade，以及 ring 最近窗口的分块顺序均在该处产生。原始 xyz 按 Float32 位传递；metric 由既有源函数限制到 [0,1]，保留负零。LUT 为 LINEAR、CLAMP_TO_EDGE、无 mip。原生适配器不重新解释相机、调色板或求根公式。

数值计算、到达顺序、1,000 万点 ring、300 万点最近窗口、时钟和录制状态仍由 Worker 内的 `RootsNativePresentationSession` 及其既有计算 owner 负责。同步与异步操作共用生成器；异步分支只在实际显示和释放处等待。native 策略下点云采用 CGL，旧 WebGL 和密度路径保留。页面持有 lease、全局短事务和随机 native token，不持有第二份完整求根 ring。

`rootsPointCloudPageBroker.ts` 将每条消息绑定到实际 Worker 对象及 session/request/display/rpc 身份。finish ACK 的 codec 像素视图位于 96 字节头之后；页面交付边界复制为独立 RGBA buffer，再 transfer 给 Worker，避免将 ACK backing 当作独立图像。客户端只翻行一次，全部 alpha 保留。Worker 私有完成图缓存与对外交付副本分开，后续读取不会使用已 detach 的 buffer。

## v15 窄协议与失败边界

请求 version=15、family=7，外层 format=9；共同头为 88 字节，ACK 固定 96 字节。仅包含五个操作：

| 操作 | 作用与提交点 |
|---|---|
| create | 取得 primary/offscreen 之一的独立目标及实际 point-size range；同 session/role 不可重复 |
| begin | 绑定完整 0–2 个 range 和 chunk schedule，预检后执行 clear/fade；首次必须显式 clear |
| append | 按 ordinal/range/offset 接收独立四元组块；ACK 后提交真实已绘计数 |
| finish | 仅完整覆盖后读回全部 RGBA，displayIndex 加一并结束短事务 |
| release | 精确释放 token；允许未知提交进度和失败的部分帧，不用旧 checkpoint 阻止清理 |

仅 begin 到 finish/release 期间占用共享事务。retained idle target 可与其它 family 共存，旧 v13 独占条件不变。取消不 abort 共享 CGL 请求：先接收并记账当前 ACK，再停止后续块、释放自己的资源。未知 create 结果、部分帧失败和 release 失败均保留清理责任；明确 foreign ownership 拒绝不释放外来 token。退休 Worker 在清理 ACK 前不终止，迟到结果不发布。

原生联合预算为 256 MiB；每目标 resident 为 `4WH + 1024 LUT + 1 MiB VBO + 3×shader UTF8 + 1 MiB control`，无深度/MSAA。传输另外预留 packet×8 与 response×4。begin 在改变目标前分别核对当前 begin、schedule 最大实际 append、未来完整 finish 三个峰值，取最大值，不把串行阶段相加；finish 仍按当时的联合占用复核。Worker 的 ring/队列及像素留存沿其自身预算计算，不重复冒充 native allocation。完整点数和顺序不因分块而改变。

## 已完成的真实原生证据

本地 `.cache/roots-point-native-v15-20261027/index.json` 指向 `build-r4` helper，SHA-256 为 `77f5076ccb50a6d57a876836769f0597b018aa2a7418b826d5adb10656299daf`。strict clang 构建通过，实际 parser 68 项通过，真实 native service 生命周期测试 8 项通过。包含分块/顺序、同 session 两目标及多个 owner、透明度/fade、部分帧释放、非有限 xyz、真实编译失败后的子进程退休与恢复，以及 HTTP lease。

`r5-compare-final/report.json` 借用已校准原版 r5 的 1,310,720 个有效点，经过正式共享 producer、TS codec、Node service 和 CGL，比较完整 500×600、300,000 像素、1,200,000 RGBA 字节：

| 帧 | range / chunk | 全部 RGBA 不同字节 |
|---|---|---:|
| same-order-20chunks | 单 range，20 块 | 0 |
| same-order-40chunks | 单 range，40 块 | 0 |
| two-range-window | 两 range，21 块 | 0 |
| same-target-repeat-clear | 同目标再次 clear，20 块 | 0 |

四帧 RGBA SHA-256 均为 `a21c4f0b3e6faaa9e956932f1fe2b826c39733577518e4c8082d6861d5a3a1e0`。每帧 146,692 个非不透明像素；不忽略 alpha，不设容差。13 个数值 uniform 逐位相同；sampler 明确从原版 unit 1 绑定到 owned unit 0，LUT 相同，不能称全部 14 项 bits 相同。实际加载的源文件与输入 pins 稳定，service/input/Vite 清理完成，owned 进程为 0。

这是**借用原版点流的绘制诊断**，不是独立求根、自然到达顺序、公式/品牌全图或完整 ring 联合峰值证明。之前原版自身两次运行及独立产品的差异继续保留，不因这四帧相同而改判。

## 实际 Generator 独立求解与交付

`.cache/roots-point-native-product-20261027/capture-r1/report.json` 已通过完整性门槛。路径为公开 `Generator → generation Worker → 4 个 computation Worker → page broker → HTTP v15 → sealed CGL`，输入是相同的源配置 SHA `1b2a2d9d26486916ad3cec87bc7e3bea230791a8db06ff6912532e93470494c6`，没有输入原版点流或排序实际绘制顺序。两次均独立完成 131,072 个样本、1,310,720 个根，接收 44 个自然到达批次，四个计算 Worker 均结束；终点 queue/waiting/pending 为 0。

| 运行 | 首个完成请求索引（从 0 计） | 全程 finish ACK | native append | 含观察器的运行耗时 |
|---|---:|---:|---:|---:|
| run 0 | 15 | 18 | 91 | 16.4541 s |
| run 1 | 21 | 24 | 106 | 13.5922 s |

合计 42 次 finish 的事务覆盖/identity 均通过检查。每轮终点及其后两次暂停共六张完整 500×600 图，逐字节核对 native wire 翻行一次后、broker 独立交付、Worker/Session 输出和 Generator 输出相同。真实 ring 仍分配 160,000,000 字节、容量 1,000 万点、最近窗口 300 万点；本输入没有 wrap，不能外推环绕覆盖。六张数学图 alpha 均为 25–255、146,692 个非不透明像素；每次实际 clear=1、fade=0，两轮各自的数学图及公式图在暂停后稳定。

三组源公式确实取得 glyph identity，并经正式公式合成与 PNG 编码；raw PNG 解码后等于完整公式 RGBA。glyph identity 为 `692e1c24c8504892fbf5c3dfb0d673317ed559d070625a66cd659cc039c407d0`。这是当前产品公式/编码与真实字形来源的交付核验，没有新增原版品牌整图等价声明。

**两次独立终点没有逐像素相同。** 数学图不同 18,867 像素、25,898 字节，RGBA 最大差为 [3,3,4,3]；公式图不同 18,789 像素、25,769 字节。报告原样保留这些差异；`ok=true` 表示独立计算和交付覆盖通过，不表示图像 equality。原始 tuple、到达顺序及原版比较另作诊断，不以容差或生产排序消除差异。

报告 `sourceStable=true`、page errors 为空，两个 broker 均剩余 0 Worker、全部 native resource 已确认释放，browser/Vite/service 关闭完成，剩余 owned 进程为 0。全 harness 为 33.3257 s；包含有界复制、hash 和 `Response.clone`，不是无观察器吞吐或 cold/warm 性能比较。该报告未采集 CPU 时间及进程族峰值内存；实际命令为 Node 26.7.0、浏览器 156.0.8078.48，不能改记为下面 Node24 微基准的环境。

## 独立点集残差与按原版顺序绘制

后续 CPU 核对保留了每条记录的 worker 和 sequence 身份。两次产品运行的完整四元组多重集逐位相同，但各有 73,792 条记录与原版 r5 不同：x 有 46,852 个 Float32 字不同、最大绝对差约 `3.10e-25`；y 有 54,932 个字不同、最大绝对差约 `4.14e-25`。z 和 metric 全部逐位相同。差异包括正负零与极近零值，不能称为“小 ULP”，也没有将其归零或加容差。

额外诊断只把产品独立 run 0 的全部 1,310,720 条原始记录按原版实际 worker/sequence 到达顺序重排，不改数值。经正式 v15 的 20 块上传后，500×600 完整 RGBA 与原版 r5 为 **0 字节差异**，SHA 与上表一致。故这些数值残差在本次输入和视图中没有改变像素；不外推到任意相机、病态多项式或默认完整负载。自然到达的独立图像差异继续保留，此诊断不把并发顺序固定进产品。

固定 Node 24.18.0 的该单帧诊断耗时 188.24 ms，其中 codec 9.52 ms、service RPC 74.74 ms；包含哈希与读取开销，不是无观察器的帧率基准。源文件、输入均稳定，剩余自有进程为 0。原始报告为 `.cache/roots-point-native-product-20261027/reordered-r1/report.json`，逐字段比较为同目录上一级的 `raw-field-comparison-r1.json`。

## 实际取消与释放

维护验证器 [verify-roots-point-native.mjs](../scripts/verify-roots-point-native.mjs) 提供 `--check`、`--run` 和 `--cancel`。取消测试在实际 CGL append ACK 已到达后，额外延迟 50 ms 交给客户端，期间调用公开 `Generator.cancel()`；不替换 ACK 内容。确认交付前没有提前 release 或终止 Worker，交付后收到 release ACK 才终止 Worker。最终页面 owner、退休 Worker、浏览器 Worker、原生资源和自有进程均为 0。

`cancel-r2/report.json` 用固定 Node 24.18.0 实际执行成功，耗时 3.020 s。首轮仅因观察器立即读取 Playwright 的异步 target-detach 状态而失败，保留在 `cancel-r1`；修复为等待有界关闭事件，最终归零要求不变。此检查不代表所有 OS 释放失败均已实测。

## CPU 检查与测量勘误

已留存的 focused CPU 检查为：codec 61 项、native backend 18 项；另一次交付边界组合为 PageBroker 12 项、Worker backend 9 项、client 14 项及相同 backend 18 项，共 53 项。两组重复包含 backend，不能把 79 与 53 相加作为去重总数。PageBroker 新测试使用真正 codec ACK 视图和 `structuredClone` transfer，覆盖迟到 ACK、失败释放重试、退休、交错事务、交付异常及 retained-memory 闭包清除。模拟 transport 不构成原生 GPU 证明。

后续联合检查已执行：主验收 9 个文件、180 项通过（执行输出在协作线程，未留文件日志，因此不造 SHA）；Worker/导出兼容检查 19 个文件、294 项通过，日志为 `.cache/roots-point-cloud-producer-20261027/worker-export-final.log`。这些组与前述 focused 组重叠，不能直接相加。最终全仓 typecheck 的实际日志路径为同目录 `worker-export-final-tsc.log`；文件无诊断输出，执行结果和 SHA 单列于 fixture。

旧 `r5-compare-final` 的约 1.6 秒“codec”区间包含 `assert(encoded.ok, JSON.stringify(encoded))` 的成功分支实参求值：整块 Uint8Array 被序列化后才停表。这不是纯 codec 延迟；旧整帧耗时与 RSS 也受该观察器影响。`performance-erratum.json` 保留旧报告、解释有效证据范围，不重写历史像素结果。

独立 CPU 定位对相同 20 MiB 点输入和完整 packet SHA 复验：实际 Vite SSR 的两次 warm 编码为 4.330/3.834 ms，单独 JSON 序列化为 1363.869/1367.101 ms。另 Node24 等价 owner 微基准（旧双 encode 对新 admit+encode）cold 为 165.061→16.103 ms，五次 warm 中位数 wall 为 142.232→6.349 ms、self CPU 为 146.504→6.466 ms；self 峰值 RSS 为 193,069,056→171,491,328 字节。全部 packet hash 相同；metric 校验保留。这些是 CPU 微基准，**不代替浏览器/Worker/HTTP 的完整任务性能**，无 agent token 成本或跨设备测量。

## preview.15 构建与基本冒烟

`desktop-build.mjs` 将版本更新为 `2.0.0-preview.15`，并在 staging 中加入 `server/source-roots-point-protocol.mjs`。实际 r3 构建包含 `tsc --noEmit` 与 `build:v2`，结果通过；39 项 desktop 测试与 deep/strict 签名检查通过。r1 的测试 fixture 类型错误、r2 的沙箱 GitHub DNS 失败分别保留原日志，不改写为产品执行失败或成功。

初次验收的 app.asar SHA-256 为 `8e8238302e8920e1d2c39e0401777e3e57f4590ba2b380c97ff182070b1f4037`，已备份。随后只澄清中英文提示为“预览不透明显示、PNG 保留 RGBA”，24 项相关测试与最终 r4 构建通过，最终 app.asar 为 `3a4e3e63ac3e6c28ef278edc237cd3af700c877251cd43ad26cce3ea8ec78f62`。包内已签名 helper SHA-256 为 `e7babe842bd5364eff19d4e621cad54af15be3b1dbd8ad085a7b459a099c5fb9`，与 manifest 一致，最终 deep/strict 签名检查通过。其身份与前述 build-r4 参考 helper 分开记录。

`.cache/desktop-smoke-oXndNh/report.json` 的 initial/restore 两阶段均通过，耗时 7,894/2,831 ms。检查包括 UI/画布就绪、渲染器无 Node、隔离与 sandbox、PNG 保存、随机端口恢复和活动 encoder 的退出清理；两次退出码 0、owned 进程 0、服务及端口关闭。该冒烟没有验证此次 Roots 点云专项导入/录制/跨 family 路径。

## 最终桌面包的实际场景验证

[verify-roots-native-desktop.mjs](../scripts/verify-roots-native-desktop.mjs) 在最终包上通过公开界面完成原 JSON 导入、终点、同实例暂停 PNG、保存、完整退出与重开。最终记录为 `.cache/roots-point-cloud-native-desktop-20261027/run-3/report.json`。两次运行各完成 131,072 个样本和 1,310,720 个根，实际四个计算 Worker 均结束；共观察到 16 个原生 finish。主预览与 500×600 离屏截图使用各自真实尺寸，没有把独立导出替代当前截图。

每张 PNG 分层绑定：实际 v15 完整数学 RGBA 等于 Worker capture；三组公式使用包内实际字形服务；增强/编码 Worker 消费真实公式合成结果，下载 PNG 解码后等于该 Worker 编码的完整 RGBA。alpha 最小 42、最大 255、非不透明像素 103,026，没有强制改成全不透明。此项是产品交付链验证，不是独立原版公式布局或品牌层 oracle。保存重开的文档状态通过；两次独立到达的 PNG 仍有 9,294 个像素、14,218 个通道不同，最大字节差 5，未设容差判为逐位一致。

两个阶段均 `visibleWindows=0`、无 show 事件、退出码 0、自有进程组为空、端口关闭；页面错误为空。包、输入、helper、glyph 和验证器 hash 均未变化。最终完整流程 85.588 s，包含被动复制、哈希及下载核对；CPU、进程族 RSS、GPU 私有内存未量，不据此宣称帧率改善。首个输出父目录错误在应用启动前退出；此前 run-2 的成功结果与文案修改前的包保留，最终包结果以 run-3 为准。

应用位置：`dist-desktop-v2/MathArt Lab 2 Preview-darwin-arm64/MathArt Lab 2 Preview.app`。这是 Apple Silicon 本地预览包，1.0 应用保持独立。

## 待补的产品验收

上述 Generator 证据覆盖固定 offscreen 终点、两个后续暂停重绘、公式/PNG 交付、实际取消及成功释放；隐藏桌面另覆盖 primary、offscreen 当前截图和保存重开。真实桌面录制、动态窗口 resize、UI 取消/失败恢复与跨 family 切换尚未在这条新通路整体实测，不能由 CPU 替身或邻近路径通过代替。无观察器的同树完整成本与进程族峰值内存也待测。

未完成项也包括默认 47,550,000 样本终点、尚无证据的相机/轨迹组合和第二台设备；本次有界参考使用 131,072 样本，不能外推为默认负载完成。M3、Roots 整族和全部 11 类场景的总目标仍保持未完成。
