# 2.0 创作预览入口验收

2026-10-22。本轮补上了普通使用者进入其余场景的入口：2.0 预览可以选择全部 12 类场景、85 个现有模板。当前仍是开发预览，原版整窗效果一致性验收保持 **0/11**。

## 如何使用

在 `studio` 仓库运行 `npm run dev:v2`，访问 <http://127.0.0.1:5179>。需要视频导出时，另开终端运行 `npm run server`。

构建后的预览使用 `npm run build:v2`，随后运行 `npm run preview:v2`，地址同上。Web 产物单独写入 `dist-v2/`。页面显示“2.0 预览”和“效果一致性验证中”。

5179 和原开发入口 5177 的浏览器工作区独立；作品可通过项目 JSON 导出／导入迁移。已有 Apple Silicon 1.0 应用本轮没有重新打包或替换。

## 实际验证结果

| 检查 | 本轮结果 |
| --- | --- |
| 场景目录及语言回归 | 2 个测试文件，25 项通过 |
| TypeScript 与 2.0 Web 构建 | `npm run build:v2` 通过 |
| 构建产物的实际界面 | 12/12 类通过 |
| 图片下载 | 曲面 PNG，96 × 72，3,605 字节 |
| 视频下载 | 曲面 MP4，64 × 48，4 FPS，2 帧，0.5 秒；FFprobe 检查通过 |
| 本地服务来源边界 | 2 项针对性 HTTP 测试通过 |

实际界面验收对每一类使用独立浏览器工作区，选择首个模板、新建默认场景、确认计算完成且画布具有可见内容、保存、下载项目 JSON，再刷新并检查作品仍存在。顶部新建菜单、场景模板分类和“我的作品”新建入口均能访问全部 12 类。

| 场景 | 模板数 | 创建、显示、保存、JSON 下载和重开 |
| --- | ---: | --- |
| 参数曲面 | 7 | 通过 |
| 奇异吸引子 | 7 | 通过 |
| 隐式曲面 | 9 | 通过 |
| 映射吸引子 | 5 | 通过 |
| 对称混沌 | 3 | 通过 |
| 噪声流场 | 10 | 通过 |
| 旋轮线 | 7 | 通过 |
| 弹跳粒子 | 5 | 通过 |
| Samila 生成艺术 | 3 | 通过 |
| 分形 | 11 | 通过 |
| 域着色 | 14 | 通过 |
| 复根图谱 | 4 | 通过 |

这次开放沿用场景注册表中的既有本地模板，不会改变已有作品或将本地模板转换为原版执行模型。普通构建继续使用 1.0 的单场景创作目录；读取已有其它类型作品仍使用完整注册表。

导出验收发现一个真实接入问题：5179 页面能读取健康状态，但写入图片被服务拒绝。根因是导出服务的默认来源列表缺少新入口。服务现在明确允许两个本机 5179 来源，仍拒绝未列出的端口、跨站请求和非法主机；桌面端显式空来源配置继续覆盖默认值。修复后通过真实预览代理完成 PNG、MP4 下载，未发生浏览器运行错误。

## 证据与范围

可复现脚本：

```sh
npm test -- tests/release-catalog.test.tsx tests/i18n.test.tsx
npm run build:v2
node scripts/verify-v2-creation-ui.mjs .cache/v2-creation-ui-acceptance --built
node --test --test-name-pattern='preview origin|rejects unsafe origins' server/export.verify.mjs
# 以下需要 preview:v2 和 server 已运行：
node scripts/verify-v2-creation-exports.mjs http://127.0.0.1:5179 .cache/v2-creation-exports-final
```

本机原始记录（缓存不入 Git）：

- `.cache/v2-creation-catalog-tests.json`、`.cache/v2-creation-build.log`
- `.cache/v2-creation-ui-acceptance/report.json`，以及逐场景截图和下载的项目 JSON
- `.cache/v2-creation-origin-tests.log`
- `.cache/v2-creation-exports-final/report.json`，以及实际 PNG、MP4 和完成界面截图

12 类界面验收耗时约 38.22 秒，记录了源码及构建产物 SHA-256，运行前后内容一致。本轮没有测量 CPU、峰值内存、VRAM 或 token 成本，也没有进行冷／热性能比较。

覆盖的是每类一个代表模板和一个默认新建作品，未遍历全部 85 个模板、所有参数或所有导出格式。本轮不是全套测试运行，也不构成桌面包验收。

## 原版画面对照仍待完成

本轮读取原版 MathArt 窗口返回 Computer Use `timeoutReached`，没有取得可靠截图。只读进程采样显示原版 JVM 已加载，采样期间主线程停留在辅助功能／Java AWT 界面等待，事件线程也在等待。这是采样观察，不能据此认定死锁、锁屏或具体根因。

原始采样保存在 `.cache/native-ui-resume-20261022/`，REA Evidence ID 为 `ev_b37d341adce9781f9bb8a9f8254223dca3cabfb03ac9676831aefd5e16ee512a`。本轮未向原版窗口发送输入或移动窗口。

后续仍需取得原版可靠画面，在相同作品、相机、时间和尺寸下完成剩余 11 类的整窗对照，并处理对照发现的差异。当前本地可操作、数值或局部 shader 验证不能代替这一步。
