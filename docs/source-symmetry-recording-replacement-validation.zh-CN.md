# Symmetry 色板录制、替换与工作区边界验收

2026-10-25，在提交 `9f5ae66415f26d55aaf6898a45b159557e44a7e0` 上，真实 App / production Worker / WebGL2 的五组联合流程 **144 项检查通过**，运行 29.313 秒。没有修改产品以适配验证。精简记录为 [recording-replacement-20261025.json](../tests/fixtures/source-symmetry-controls/recording-replacement-20261025.json)，完整证据保存在 `.cache/symmetry-control-final-ui-20261025/`。

本次补齐新色板 owner 与录制、工作区切换的组合边界。先前通用 [live UI](source-symmetry-live-ui-validation.zh-CN.md)、[录制故障矩阵](source-iterated-recording-public-validation.zh-CN.md)、[色板编辑器](source-symmetry-samila-palette-ui.zh-CN.md) 和 [暂停 PNG](source-symmetry-paused-capture-validation.zh-CN.md) 证据继续有效；没有重新执行或扩大这些历史结论。

## 输入和判据

输入来自原包 `data/SymmetryChaos/Emperors_Cloak.json`，原 16 色列表及公式保留。有限测试设置为 batch 512、burn-in 32、每帧迭代 16、作者 dot_size 6、Wait 1 秒、禁用主方程；添加已知 Cosine/Curve 配置并从 Manual 开始。原包和成员 SHA 见 fixture 的 `sourceMember`。**仅提取原包 JSON，没有启动原版，也没有原版像素对照。** 作者点径是此运行基线的输入，不证明原版 cold 构造点径、热 setter 或后续修复。

建立完整 cold 配置 A 后，通过真实 Appearance UI 生成作者 B：Cosine 色数 9、A.r = 0.75，新增第三个 Curve 节点并设 Y = 0.9。判据遵循生产 owner 的职责：

- `sourceSymmetryPaletteEditing.ts` 的完整 cold snapshot 供 Reset/recording；raw 色板、生成器参数、Manual 快照、Curve 节点属于作者。
- 录制从 cold A 创建新 live incarnation，但继续使用已有 Worker。录制结束后运行色板仍为 A，作者 raw/editor B 与 cold anchor 必须完整保留。画面没有继续使用 B 不等于 B 丢失。
- 库返回要新建暂停会话，恢复离开时的 runtime/author/cold 分工；不要求保留旧会话、旧时刻或旧累积像素。
- 同 ID 文件导入是新文档绑定，必须清除旧作者编辑器并退出旧 Worker。Appearance 可以立即创建默认 editor，因此不要求该字段永远不存在。

## 实际矩阵

| 联合流程 | 实际证据与结果 |
|---|---|
| 热 B → 完成源录制 | 公共 `Export artwork → Animation video`；4 fps、97×65 逻辑导出，warmup 1 + encoded 3。实际 Worker offscreen 为 291×195；3 张实际上传 PNG 全部 RGBA 摘要与对应 Worker 帧一致。FFmpeg 输出 96×64、4 fps、3 帧 MP4，解码帧确有变化。无普通 generate 插入固定录制期间。结束使用 runtime A，作者 B、Manual/Curve 与完整 cold anchor 保留。 |
| 首帧上传后 Cancel export | 等第一张真实 PNG 被服务接受，暂缓其 HTTP 回执，再点公共取消。仅 1 张编码帧/上传；实际 DELETE、无 `/finish`、无下载。收到生产 recording finish 回执并恢复 realtime，Worker 保留、作者 B 保留。没有伪造服务成功。 |
| 暂停 resize / profile | 窗口 1360×900 → 1440×960 → 1360×900，实际输出 782×552 → 862×612 → 782×552；low → high → low 输出 782×552 → 1564×1104 → 782×552。实际新帧 paused=true、objectUpdates=0，session、replayRevision、sceneTime 不变，作者与 cold 不变。未要求累积像素往返相等。 |
| 库切走和返回 | 打开实际 Surface 邻居，再返回已保存 Symmetry。新暂停 live incarnation，Worker 实际从 2 换到 4；离开时 runtime A、raw/editor B、cold anchor 均完整恢复。随后公共 Manual 恢复原 16 色，Curve 仍有 3 节点，Cosine 参数仍是 B。 |
| 同 ID 文件替换 | 公共 JSON 导出不含 editor/session；新文件保持 ID，换为 3 个明确颜色，经生产持久化 owner 整理后用实际文件输入导入，不 reload 页面。旧 Worker 4 明确 terminated，新 Worker 5；新默认 Manual、Cosine A.r = 0.5 / count 3、默认 2 节点 Curve，切回 Manual 恢复新文件颜色。旧 B 不渗入新文档。 |

`pause()` 等待真实 `symmetry-playback` ACK，暂停本身不必绘制新帧。因此录制后留存的 `after.output` 可能仍是最后一个未暂停显示；没有篡改这份历史事实。后续 resize/profile 的新输出独立证明暂停与零数值更新。`run-1/report.json` 保留原始请求、回执及状态，`audit.json` 对该区分作了显式复核。

## 验证与证据绑定

环境为本机 Mac，Node **24.18.0**，隐藏 Chrome **155.0.8059.85**，DPR 1。被动 observer 记录实际 Generator / Worker 请求、回执、实际 renderer 接收和 RGBA 摘要；不替换随机数、时钟、算法或输出。屏幕与 canvas PNG 保留完整可见内容；非均匀像素只排除恒定画面，不作为艺术质量或原版一致性的证据。

- 实际 App：`run-1/report.json`，5 组 / 144 项；589 个源码、输入和运行脚本 pin 前后一致，page/Worker error 均为 0。
- CPU 前置：`cpu-prepare-2/report.json`，10 项通过，真实 parser、recording planner、persistence owner 和 observer 语法检查；无渲染。`cpu-prepare-1` 保留误用设置字段名称造成的验证器失败，未启动浏览器或 GPU；修正为实际源配置/相机 owner 后通过。
- CPU 回归：`tests/source-symmetry-palette-lifecycle.test.ts` 与 `tests/symmetry-palette-generator.test.ts`，18/18；原始 JSON 在 `cpu-tests.json`。
- 独立留存证据审计：`audit.mjs` / `audit.json`，43 项；重新解码 4 张实际 PNG，核对 Worker 摘要、A/B/cold 分工、暂停 ACK、新显示状态、源 pin 与清理。
- 清理：context、Chrome browser、Vite、export server 均 fulfilled；服务 owned process = 0。完成后立即归还独占 GPU 时段。本次没有完整浏览器进程族 CPU/RSS、显存或性能比较结论。

证据索引 `.cache/symmetry-control-final-ui-20261025/index.json` 绑定 42 个本地文件，SHA-256：`d478b6f06fc80ac194d8b1f4c0a2da1b6af83207cb94af847bad78f730dfce60`。轻量 fixture 绑定该索引、原始报告、CPU 结果及 12 个相关产品源码 pin；不提交视频、截图或本地缓存。

重跑实际 App 必须先取得独占 GPU 时段，并使用尚不存在的目录：

```sh
../.cache/local-toolchain/node_modules/.bin/node .cache/symmetry-control-final-ui-20261025/verify-app.mjs --run-ui .cache/symmetry-control-final-ui-20261025/run-NEW
```

## 明确范围

本次通过的是有限的 **palette owner 联合 App 生命周期**，不代表 Symmetry 全部需求完成。没有原版完整帧/录制一致性、原版 cold/热点径、原始全 batch 负载、第二台设备或任意公式结论。`Cancel export` 与 preview cancel 是不同路径；旧通用 preview cancel 证据没有在此新 palette 组合上重跑。后续产品变化需按源码 pin 判断影响，不能将未来状态写成此基线已验。
