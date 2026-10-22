# 域着色原版残差：真实提交边界验证

2026-10-22 更新：真实 VBO 的原生独立重放已与实际 Scene 数学区域零差异。原生与禁用 ANGLE program cache 的浏览器 UV/z 全图一致，但颜色仍有 **744 个中心区域差异像素**；注入原生最终复数值后只剩 1 个像素相差 1。主要残差已定位到复数迭代执行，尚无经验证可集成的生产修复，**域着色家族未通过一致性验收**。

## 对照对象与范围

输入是原版 MathArt 1.7.8 的 `DomainColoringConfigs/domain_coloring_zero_linear_demo.json`。主视口逻辑尺寸 405 × 486，输出逻辑尺寸 250 × 300，像素密度 2，实际 500 × 600；暂停帧、调试文字关闭，原版 FREE 水印保留。

| 路径 | 实际执行内容 | 能支持的结论 |
|---|---|---|
| 原版实际 Scene | 随包 JVM、Processing、JOGL，原版 Scene、shader、许可、绘制和增强方法 | 本机原版离屏输出；域着色尚未单独完成 GUI 对照 |
| 原生独立 shader 副本 | 同一原生 GL 上独立 program/FBO，输出 UV、z、复数中间值 | 受控运算实验；手写顶点版本不能冒充实际 Scene |
| 浏览器原版 shader 重放 | 原版实际 shader 文本适配 GLSL ES 接口，真实 VBO/索引/绘制时 uniform | 浏览器执行同一输入后的结果；不是原生 GPU 输出 |
| MathArt Lab 生产路径 | 实际导入、生成、着色、增强与导出 | 当时产品实际结果；不能由重放脚本替代 |
| 可提交坐标复验 | 记录的真实顶点 shader 与输入，单独输出 UV/z | 只验证浏览器坐标边界，不包含原版复数公式或产品着色 |

原生设备为 Apple M2 Max、OpenGL 4.1 Metal 90.5；本次成功浏览器重放为 **ANGLE Metal / Apple M2 Max**。历史无后缀 `retained-source-webgl.rgba` 也是 Metal，不能用另一个带 `-gl` 后缀文件的 SwiftShader 元数据给它标注设备。显式 SwiftShader 控制组明显不同，不能混合统计。

颜色残差统一使用固定中心 ROI `[55,55,445,510]`，共 177,450 像素，避免水印区域以调查数学内容。它不是全图验收，也没有删改原版完整图片或水印。

## 原版真实 draw 捕获

观察器在实际 `PJOGL.drawElementsImpl` 调用前读取 element、vertex、texCoord VBO 和当前 uniform，随后继续执行原方法及原参数。读取缓冲区使用 `COPY_READ_BUFFER`，保存并恢复原绑定；没有改写 Scene、shader、uniform、VBO 或原始 app 包。

实际提交值如下：

- TRIANGLES，6 个 unsigned-short 索引：`0,1,2,2,3,0`。
- 四个 vertex：xy 分别为 `(-125,-150)`、`(125,-150)`、`(125,150)`、`(-125,150)`；z 均为 `-259.8076171875`，w 均为 1。
- 四个 texCoord：`(0,0),(1,0),(1,1),(0,1)`。
- vertex/texCoord 提交 stride 都为 0，表示紧密排列；驱动查询返回的有效 stride 分别为 16、8 字节，两种值都保留。

首次观察器把提交 stride 0 与查询 stride 16 误判成状态改变，抛错触发了原版 GPU→CPU fallback；那次图片明确废弃为颜色参考。第二次保存异常后仍执行原 draw，完整图恢复基线，但捕获仍未完成。最终按紧密排列语义核对提交值和查询值，捕获成功。

最终运行 10.531 秒、exit 0、stderr 空、各 GL 检查 0、各 AWT Window 检查 0，进程组已回收。正常许可/签名策略流程保持生效，策略缓存刷新前备份，settings 摘要不变，license.dat 仍不存在。无桌面输入或激活。未测量 CPU 时间、进程族峰值内存或整个任务 token 成本，不作性能声明。

完整原版 raw PNG 在未观察、观察失败但继续 draw、最终成功捕获三种正常绘制运行中 SHA-256 均为：

`7c9a176bcaa2760b704203a0710d16ee3b3efc5df718283b86c3b9034ef07fe5`

## 真实 VBO 重放的结果

浏览器保留真实属性 float32 字节、索引顺序、draw 时矩阵及其他 uniform，并执行原版实际 shader。原始大图保留在本机缓存；Git 只保存精简的输入记录和来源摘要。

| 比较 | 不同像素 | 最大分量差 |
|---|---:|---:|
| 真实 VBO 重放 vs 历史直接 clip 顶点重放，ROI RGBA8 | 0 | 0 |
| 两种浏览器重放的整图 UV/z float32，300,000 像素 | 0 | 0 |
| 真实 VBO 重放 vs 原版实际 Scene，ROI RGBA8 | 744 | 195 |

因此换成真实提交数据没有减少残差，不能据此修改产品顶点路径。

另一次历史分层记录显示：生产路径原始色彩与原版 ROI 有 772 个差异像素；GPU-only 路径有 747 个；浏览器原版 shader 与 GPU-only 仅 3 个像素相差 1，但与原版 Scene 有 744 个差异像素。增强后产品实际导出有 2,285 个 ROI 差异像素。原版 raw 输入经过本地增强的独立检查已排除增强层为主要来源。这些是各自保存的历史产物测量，不把脚本重放数字当成当前生产验收。

## 旧诊断 UV 算术的纠正

旧原生独立副本用手写六顶点并计算 `vUv=p/vec2(250,300)+vec2(.5)`。在浏览器中，它与真实 attribute 输入产生 103,714 个 UV/z 差异像素，最大分量差约 `1.1920929e-7`。

单变量控制保持矩阵顶点其他部分不变，只将 UV 改为精确四角 0/1：整图 UV/z 和 float32 色彩均恢复零差异，匹配真实 VBO/直接 clip 重放。故旧诊断坐标差来自它自己的 UV 算术表示，不能标作原版实际顶点行为。具体是否由融合算术或除法优化造成，没有逐指令证据。

旧受控副本还有一条有效但有限的发现：相同诊断坐标下，原生 GL 与 ANGLE Metal 的 `c_pow(z,2)` 有 64,952 个像素出现低位差；注入相同原生 z 后差异不变，27 次迭代会放大它。该发现证明坐标之后的数学执行也能不同，但输入来自旧诊断顶点，不能把全部 744 个实际 Scene 残差直接归因给超越函数。

## 正确输入下的原生重放与数学分层

后续一次原生运行使用捕获的真实 VBO、索引、原版 vertex/fragment shader 和实际 uniform，在独立 FBO 直接输出 RGBA8。**与原版实际 Scene 的固定 ROI 为 0 差异**；完整原版 raw PNG 仍与上述基线 SHA 相同。该校准通过后才采集 UV/z、`c_pow`、首次和 27 次迭代的 float32 输出。本次 9.441 秒、exit 0、stderr 空、无超时，进程组不存在；许可、设置与正常策略检查继续保持，策略刷新前备份。

所有本轮浏览器控制显式使用 `--enable-angle-features=disableProgramCaching`，设备为 ANGLE Metal / Apple M2 Max。该参数与桌面验证保持一致，防止其他场景实验中已观察到的 program cache 干扰；此前未带参数的结果保留为历史记录，不混算。

| 正确 VBO 的 Native/Metal 比较 | 全图不同像素 | 含义 |
|---|---:|---|
| UV/z | 0 | 本组残差不来自坐标映射或插值输出 |
| `c_pow(z,2)` float 输出 | 64,847 | 坐标之后已经存在数学低位差 |
| 首次 `sin(w+z²)` 迭代 | 47,462 | 差异在第一次复数求值出现 |
| 27 次迭代 float 输出 | 43,522 | 迭代会放大差异，含非有限值分歧 |
| 最终 RGBA8 | 1,779；固定 ROI 744 | 原生独立重放相对浏览器数学内容，不含 Scene 水印对比 |

27 次迭代有 257 个非有限分量分歧；其距离不按有限误差处理。统计将 NaN/NaN 视为相同的非数值结果，不声称 NaN payload 位相同。原生 float 色彩再由 CPU 量化为 RGBA8 会另有 2 个 ROI ±1 像素差，因而校准使用直接原生 RGBA8，不用这个量化版本代替。

单变量注入进一步分开坐标、迭代与着色：

- 注入同一原生 z：原有 744 / 最大 195 的 ROI 色彩差异完全不变。
- 注入原生独立 `pow(z,2)` 输出：首次迭代全图零差异，但 27 次迭代后的 ROI 色彩反而变成 1,536 / 最大 200。独立表达式的输出不能未经验证替代循环里的原式；编译上下文或循环内执行差异尚未分离。
- 注入原生最终复数值 fz：全图只剩 1 个色彩像素相差 1，位置 `(305,425)`，原生 `[177,190,183,255]`，浏览器 `[177,190,182,255]`。大量颜色残差随迭代终值替换而消失。

因此主要残差边界现在可定位到复数迭代执行；仍不能声称某一个 sin/atan/log/exp 指令独占原因。给生产路径加入探针值、按像素特判或更换数学恒等式均不是已验证的修复。本轮没有修改产品公式、色彩算法、顶点或验收容差。

## 可复验交付与限制

精简记录：[真实 draw fixture](../tests/fixtures/source-domain-draw-boundary/native.json)，包含 VBO/索引值及原始字节摘要、实际矩阵、必要 viewport uniform、原版 vertex shader、JAR/class/输入/probe/宿主摘要。应用 JAR 与 class 摘要已重新核对本机原产物。没有提交原版二进制、大图或缓存。

可独立运行的[坐标复验脚本](../scripts/verify-source-domain-vertex-boundary.mjs)：

```sh
node scripts/verify-source-domain-vertex-boundary.mjs
```

需要本项目锁定依赖及已有 Chrome，不安装浏览器、不启动原版应用、不读取许可文件，也不依赖私有大缓存。脚本先核对 fixture 字节摘要，显式禁用 ANGLE program cache，再以浏览器实际 float FBO 比较四种顶点表示；记录实际设备与零容差结果到 `.cache/source-domain-vertex-boundary-verification.json`。本机已执行通过：clip 与精确 UV 两项均 0 差，旧生成 UV 为 103,714 像素差。若其他设备结果不同，保留报告并调查，不能据此自动放宽容差。

脚本不包含原版完整 fragment，因此不能独立复现 744 个颜色残差或证明原生数学执行一致。新的[原生重放摘要](../tests/fixtures/source-domain-draw-boundary/native-replay.json)保存校准、分层统计、剩余色彩像素与原始证据摘要，大型 float 数据仍在本机缓存。下一项有意义的工作应在已校准的真实输入上记录逐次迭代，区分原生循环中与独立表达式的求值差异，再验证具体实现改动；目前没有可据此直接提交的生产修复。

私有完整证据位于 `.cache/domain-native-residual-20261022/`：`stage-comparison.json`、`retained-source-webgl-comparison.json`；`float-boundary/` 保留受控 float 数据及失败假设；`draw-capture-plan/native-stride-domain/` 保留成功原版运行、真实 VBO、完整 PNG；`draw-capture-plan/actual-vbo-comparison.json` 和 `success-verification.json` 对应本轮测量。`actual-native-replay/` 保留本轮原生独立重放、禁用缓存的浏览器脚本、注入对照及全部 float 输出。这些私有缓存不随 Git 提交。

本次成果是残差归因与可重现输入边界，未新增 runtime 功能、未修改生产代码，也未完成域着色全图、动画或家族一致性验收。
