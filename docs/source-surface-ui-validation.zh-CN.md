# 曲面实时预览接入界面

源曲面现在通过实际 App 界面使用保留会话：播放、暂停、参数编辑、保存与 Apply
都经过同一个 GenerationQueue 和 Worker。仅已使用源曲面模型的文档启用；
旧本地几何文档不自动升级。已安装的 Apple Silicon 1.0 应用没有重新打包或替换。

## 已实现的行为

- 播放沿用当前对象和队列，使用浏览器实际显示间隔的帧率观测。
- 暂停后改参数保留时间、队列、动画相位；CPU 点等待下一次对象更新，
  CPU 网格和 GPU 绘制可读取修改后的函数值。这遵循上一轮实际 JVM 参数观察。
- Apply 提交完整配置并从头构造；暂停 Apply 保持暂停，播放 Apply 保持播放。
  同一份文档再次 Apply 也会产生一次明确重载事件。
- 保存源曲面作为元数据变化，不重建当前动画。
- 视口使用已交付相机，不为了显示再次执行固定帧率回放。
- 连续编辑保留尚未消费的 Apply 配置；过期操作和取消后的后续参数写入不再发布。

队列加入 Surface 的播放与编辑路由，并提取域着色和曲面共用的显式参数事件验证。
批量事件在第一次写入前完整检查，运行参数不从整份文档差异猜测。

## 验证结果

| 验证范围 | 结果 |
| --- | --- |
| 17 个相关测试文件 | **277/277 通过** |
| 实际 App：CPU 点、CPU 网格、GPU 点、GPU 网格 | **4/4 通过** |
| Generator→GenerationQueue→Worker→实际 WebGL，含 CPU 模式切换 | **5/5 通过** |
| TypeScript 和生产构建 | 通过；仍有现有大包提示 |

App 测试通过文件导入、Play/Pause、Save、参数输入和 Apply 按钮操作真实页面。
每组检查运行时间推进、暂停改参不推进、不重建，保存后仍持有原会话，
暂停 Apply 回到零时刻，播放 Apply 创建新会话对象并保持播放。
同时保留 Worker 请求/响应事实与画布截图，并验证修改后的实际像素表现。
最终试例包含参数动画与相机旋转，避免只验证静止相机。

首轮 App 测试中，未指定相机的平面网格画布没有可见图形，两个网格像素变化断言失败。
没有降低断言：之后明确指定正面相机，四组重新执行通过。默认相机下的该平面视图
未计入这轮可见图像验收。全部失败和后续执行报告仍保留在本地。

最终 App 四组执行约 13.71 秒，独立队列与绘制五组约 6.66 秒。
没有测本轮 CPU 时间、进程族峰值内存、VRAM 或 agent token 成本；
没有以这些耗时宣称性能提升，也未重新执行全部项目测试。

## 原版依据和未完成项

原版保留字节码中，`reloadConfig` 记录暂停状态并安排初始化；
`initScene` 销毁旧场景、创建新 GenericSurfaceScene；`draw` 在暂停重载时调用
`Scene.update(true)`、绘制首帧后 `noLoop`。这是静态依据，不是完整 GUI 重载的运行验收。
原版参数修改的实际运行证据见上一轮中文参数修改报告。

本轮尝试打开 Yomado 时，工具实际返回“Mac 已锁定，自动解锁失败”；
已发出手动解锁提示，没有继续发送桌面输入，也没有把创建虚拟屏或已授权状态
当作截图与输入成功的证据。

仍需完成：

1. 曲面当前 PNG 的保留状态导出、原版录制生命周期和暂停视口手势。
   当前普通导出/录制功能仍使用既有路径，不能视为这些原版行为已经验收。
2. 空时间线 CPU 点项目目前仍走本地几何导入路径，尚未纳入源实时会话。
3. 其它场景的剩余 2.0 工作，以及全部 11 个场景的原版整窗效果对照。
   **原版整窗对照仍为 0/11，Goal 保持进行中。**

## 可读画面与复现

最终 App 截图位于 `.cache/surface-ui-acceptance/`，分别为
`CPU-POINTS.png`、`CPU-MESH.png`、`GPU-POINTS.png`、`GPU-MESH.png`。

```sh
node scripts/verify-source-surface-ui.mjs /absolute/path/new-ui-evidence
node scripts/verify-source-surface-live.mjs /absolute/path/new-worker-evidence
```

本轮主要证据：
`.cache/surface-ui-acceptance/report.json`、
`.cache/surface-queue-browser/report.json`、
`.cache/surface-ui-acceptance-tests.json`、
`.cache/surface-ui-acceptance-build.log`。
