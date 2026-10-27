# 隐式曲面 GPU：本机原版路径与剩余缺口（2026-10-27）

原版 MathArt 1.7.8 在这台 Apple M2 Max 上可以完成隐式曲面的 GPU 模式绘制，但实际采用 **CPU 生成网格、GPU 绘制材质**。这不是 OpenGL Compute Shader 成功运行的证据。后续产品接入已完成六种稳定材质状态的整图零差异对照，见[GPU 材质验收](source-implicit-gpu-material.zh-CN.md)；首次及 dirty 网格重建的视口恢复也已接入，并完成 17 张含公式整图对照，见[重建帧验收](source-implicit-dirty-display.zh-CN.md)。两项结果均限定本机实际 CPU 回退，不证明 Compute 成功。

## 实际验证

使用原包 `data/Implicit/implicit_sphere.json`，只将 `settings.mesh_mode` 从 `CPU` 改为 `GPU`。方程、60×60×60 网格、缩放、透明度、配色、公式、相机和时间线均保留。文件名虽为 sphere，实际方程为 `x^2+y^2-z^2-1`，没有替换成另一个球体用例。

原版 JAR SHA-256 为 `a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018`。观察宿主调用原版正常授权、`reloadConfig → initScene → runFrame`；没有修改 JAR、许可、设置、品牌或资源，也未替换计算结果。正常权限检查通过，使用原版返回的访问策略。策略缓存可由原版刷新，单独记录前后状态；JAR、许可、设置及输入的前后摘要一致。

| 观察项 | 结果 |
|---|---|
| 实际 OpenGL | `4.1 Metal - 90.5`，Apple M2 Max |
| Compute / SSBO 扩展 | 两者均不可用 |
| 原版计算程序 | `computeProgram = 0` |
| 原版网格 | 90,120 个顶点，`meshShape` 存在 |
| 原版模式 | `meshMode = GPU`，`useCPURender = false` |
| 材质程序与绘制 | `materialProgram = 1`；实际三次三角形 draw，共 90,120 个顶点 |
| 完整帧 | 正常完成，保留原版品牌及公式 |
| 窗口与退出 | AWT 窗口数 0，进程退出码 0，剩余自有进程 0 |

宿主使用已校准的窗口外 FBO，先初始化 primary。仅当当前 FBO 确为 JOGL 所属的默认离屏 FBO 时，才将 `GL_BACK` 映射为它公开的默认 attachment；没有改动场景 GL 调用的其它参数。反射观察只读取字段。原版查询 GL2 的异常、SSBO 分配异常、Compute Shader 创建返回 0 均保留，没有将它们清除后宣称计算成功。采集图片用于说明实际路径，不作为逐像素一致性证明。

## 字节码解释与产品影响

只读 `javap -p -c` 显示，原版 `buildMesh()` 先尝试 `buildMeshGpu()`；失败返回 false 时继续 CPU Marching Cubes。`ImplicitGpuMarchingCubes.build()` 内部的失败返回 null，`program = 0` 时也返回 null。实际日志中的 CPU 网格生成记录与这些分支相符。

网格回退不修改 `meshMode`。只要 `meshShape` 存在且目标为 OpenGL，`useGpuMesh()` 仍选择 `renderMeshFillShape()` 和原版材质 shader。本轮实际 draw 证明该显示路径确实执行。后续产品据此复用源网格、调色板、相机与录制归属接入 GPU 材质；不能因本机缺少 Compute 能力而删掉显示要求，也不能把 WebGL 标量采样写成原版 Compute 实现。

计算能力和材质显示分别记账：本机原版 Compute 不可用是已观察到的边界，GPU 稳定材质对齐已有独立证据，网格重建造成的显示副作用仍未闭合。其他设备、驱动和原生 Compute 成功运行仍未验证；用户目前只有这一台 Mac。

## 证据与成本

精简索引见 [fixture](../tests/fixtures/source-implicit-gpu-capability/20261027.json)。完整本地证据在 `.cache/source-implicit-gpu-capability-20261027/`，包含输入及单字段差异、只读字节码、观察器、命令、原版日志、字段和 GL 调用、完整 PNG、前后摘要及进程退出记录。

本次运行墙钟 **11.047 秒**，包含观察器和退出检查；未测 CPU、进程族峰值 RSS、GPU 时间或 agent token，也没有冷暖性能对比。第一次启动准备因引用历史归档脚本的相对路径错误，在目标执行前失败；改为实际 runner 路径后运行成功，不将准备失败计作目标失败或成功样本。
