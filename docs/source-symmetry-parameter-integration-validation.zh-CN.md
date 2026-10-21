# Symmetry 参数动画接入与界面验收

2026-10-21。**已接通项目导入、参数编辑、保存重开、共享时间线、GPU 和 PNG/MP4 导出。** 原版窗口整图一致性仍为 **0/11**，本报告不把本地链路通过视为全部 2.0 场景验收完成。

## 现在能做什么

导入 Symmetry 项目中的 `paramStart / paramStop` 后，可以在时间线选择该动作，按原始参数名设置范围、步长与边界缓动。参数与相机、渐变在同一个固定帧队列中执行；等待片段中继续变化，队列结束后停止对象更新。保存后重新导入，参数配置保持一致。

本轮实际在界面把 beta 的步长从 0.02 改为 0.03，保存、重新打开、播放暂停，并导出图片和视频。验证使用后台浏览器，不操作用户主屏幕。

## 实现与依据

- 新项目导入写入 `symmetryParameterModel: symmetry-registry-1.7.8`。旧的未标记本地项目维持既有行为，打开时不会自动迁移；不允许混合不同参数模型。
- `sourceRegistryParameterConfig.ts` 的原始动作解析已接入公开导入流程。保留参数名、顺序和原始数字来源路径；外层继续跳过非数组/对象 args；Symmetry 不读取曲面的全局边界缓动设置。
- `sourceSymmetryTimeline.ts` 成为相机、参数和渐变的共享状态所有者。原渐变文件只保留渐变运行时与识别规则，相关调用方已迁移，没有保留两套队列。
- 参数子动画使用实际 activeDt；开始全部子项后更新各子项，再按“参数 → 渐变”更新对象。参数速率使用原版 Mobject.update 的常数 60。负时长的组合动画保留子项时长，但组时长取不小于零；界面跨度仍包含该组实际占用的一帧。
- 同帧求值后的参数写入 GPU 方程或自定义 uniform。构造种子、初始粒子和自定义 GLSL 的构造替换值继续归作者配置所有；逐帧参数变化不重新初始化粒子。
- 原版 display 在完整 double 参数表变化超过 `1e-9`，或参数数量/成员变化时，才更新上次确认的参数快照。这个判断已接入累积清除，替代对 Float32 方程字段做 JSON 相等比较。小变化会相对上次确认的快照累积；未被方程读取的参数也参与判断。
- 源参数动作不读取动作级 enabled。删除参数的引用检查也采用同一规则，防止界面认为一个实际运行的动作已停用。

参数运行与解析依据沿用[63 组、366 帧原版 JVM 对照](source-symmetry-parameter-config-validation.zh-CN.md)。本轮更新顺序、组合时长与累积快照判断来自固定 MathArt 1.7.8 字节码：`SymmetryChaosMobject.update` PC 8–24；`display` PC 177–188、223–246；`JsonSymmetryChaosConfig.setupTimeline` PC 450–521。前者类 SHA-256 为 `f994fa6fc9dcf984c9ffad6e4e539e497ed038935ab701f8c7450d1f5caba54c`。

## 已执行验证

| 验证 | 结果与实际范围 |
|---|---|
| 全量测试 | 336 文件、6,189 项通过，含项目格式、原始数字、动作模型、等待/完成、冷热与回退求值、构造种子不变、原始名称编辑、删除引用检查 |
| TypeScript 与网页构建 | 通过；仅有既有的大资源分块提示 |
| 实际自定义 GPU | 12 帧 uniform 驱动的粒子坐标逐项匹配独立 Float32 加法递推，队列完成后不再迭代 |
| 公开生成入口 | 内建 lambda、未使用参数、自定义 gain 三组，各 12 帧；累积清除次数分别为 4、7、7，粒子初始化仅一次 |
| 细微参数变化 | double 值变化而 Float32 相同的案例仍按阈值清除；不是每帧都清除 |
| 回退、保存重开 | 后退到指定帧后的全部像素及原始累积数据，与新建会话重新生成完全相同 |
| 更新/显示回归 | 内建与自定义 GPU 的空队列、零时长、短队列、初始化、无效点和回退检查通过 |
| 实际界面 | Map、Symmetry 均完成导入、相机编辑、播放暂停、保存重开；Symmetry 额外完成参数动作步长编辑与保存校验 |
| PNG | 两场景均为 192×128；解码后的全部 RGBA 与实际 Worker 栅格完全相等，图像非单色 |
| MP4 | 两场景均为 192×128、3 FPS、3 帧；逐张上传 PNG 与 Worker 对照，Symmetry 使用原版不透明显示规则；ffprobe 确认视频规格 |
| 清理 | 各验证关闭浏览器、Vite 和导出服务；GPU 会话释放后报告保留字节为零 |

PNG/MP4 的像素检查是本地生成链路验证，不是原版应用截图比较，也不是有损视频压缩后逐像素无差异的声明。

## 可重复记录

- 新增 `scripts/verify-source-symmetry-parameter-integration.mjs`；输出 `.cache/source-symmetry-parameters/gpu-integration/report.json`。
- 扩展 `scripts/verify-captured-density-public.mjs`；输出 `.cache/source-symmetry-parameters/public-integration/report.json`，同目录包含项目文件、PNG、MP4 和预览截图。
- `scripts/verify-source-symmetry-frame-plan.mjs` 回归输出 `.cache/source-symmetry-parameters/frame-plan-regression/report.json`。
- 测试和构建日志：`.cache/source-symmetry-parameters/integration-full-tests.log`、`integration-build.log`。
- `tests/source-symmetry-parameter-integration.test.ts`：新增公开导入/保存、共享求值、GPU 帧参数与界面结构检查。

```sh
npm test
npm run build
node scripts/verify-source-symmetry-parameter-integration.mjs .cache/symmetry-parameter-new
node scripts/verify-captured-density-public.mjs .cache/symmetry-public-new
node scripts/verify-source-symmetry-frame-plan.mjs .cache/symmetry-frame-plan-new
```

需要已有 Chrome、FFmpeg/ffprobe；前后记录源码摘要，避免验证过程中源码变化。新建输出目录保存本机证据，不进入 Git。未重新打包或替换已安装的 1.0 Apple Silicon 应用。

## 测量与限制

GPU 参数专项约 33.20 秒，运行时并行执行了全量测试与构建；界面/导出约 12.62 秒。不能把这两个数字当作受控性能基准。单独的更新/显示回归耗时约 2.38 秒，250 ms 采样进程族 CPU 约 6.19 秒、峰值 RSS 约 1.36 GiB（含浏览器和 Vite）。RSS 可能重复计算共享页，采样会漏掉峰值或短进程，CPU 为观察下界，未区分短时 PID 复用。未测 GPU 内存或 token；没有等价的受控前后及冷热性能比较，不作性能提升结论。

本轮累积清除验证覆盖固定帧回放中未暂停、没有原版 replayPending 的状态。还需核对原版编辑触发的重建/重播、原版暂停与重播标志、真实窗口的渲染与完整图像。共享队列沿用已验证的 Scene 时钟；本轮没有重新执行原版 Scene + JOGL 整条渲染链。2.0 总 Goal 保持进行中。

后续进展：[编辑路径与共享会话验收](source-symmetry-session-validation.zh-CN.md)。固定预览已复用独立会话；GPU 分帧重播和界面事件接入仍待完成。
