# Samila：Electron 运行时严格对照

2026-10-21，在项目安装的 **Electron 44.7.2／Chromium 152.0.7977.149** 中，Samila 的 220 组完整累积图像和世界坐标全部逐位相同。该检查使用现有 macOS 桌面图形策略，补上了此前只在 Chrome 中运行的验证范围。

## 验证方式

两个参照生成器和产品验证器增加 `--electron-runtime`，共用一个负责启动、页面和关闭的运行时 owner。独立参照仍从固定 MathArt 1.7.8 JAR 提取原 shader，实际输出仍调用当前产品渲染模块，双方不共享公式或预期像素的生成代码。

每次运行使用独立临时配置目录和隐藏的 Electron 窗口；没有启动 MathArt Lab 主界面，没有输入鼠标／键盘，也没有移动用户窗口。实际报告记录 `visibleWindows: 0` 和 `disableProgramCaching`。运行结束关闭所属 Electron 实例，验证器同时关闭 Vite。

参照与验证必须使用相同图形配置及运行时类型。将 Chrome 参照交给 Electron 验证会提前拒绝；历史未记录 runtime 字段的参照仅按原有 Chrome 记录解释。默认 Chrome 路径保留，不能静默把两种运行时的结果混用。

首次诊断入口将 `app.whenReady()` 放在 ESM 顶层等待，启动超过 30 秒；改为从异步函数等待后正常运行。失败实例已由启动工具终止，失败证据单独保留。这项启动错误不作为锁屏导致 Electron 不可用的证据。

## 实测结果

| 检查 | 结果 |
| --- | --- |
| 原始采样参照 | 180 组通过；1.67 秒 |
| 完整绘制参照 | 220 组通过；2.21 秒；观察接口不改变图像 |
| 实际产品完整累积图像 | **220/220 逐位相同** |
| 实际产品世界坐标 | **220/220 逐位相同** |
| 跨范围稀疏坐标 | **20/20 逐位相同** |
| 同一实例切换映射／投影 | 156 组通过 |
| 六倍补采连续样本 | 393,222 个，零差异，覆盖分块和短尾 |
| 产品观察接口开关 | 220/220 图像不变 |
| 运行时不匹配、未知选项 | 均提前拒绝 |
| Chrome 路径回归 | 220/220 图像与坐标逐位相同 |

产品矩阵耗时 16.53 秒；源码前后哈希一致，Electron 和 Vite 清理成功。报告为 `.cache/samila-direct-electron-accepted/report.json`，同目录有可读版本；参照位于 `.cache/samila-sampler-electron-oracle-final/` 和 `.cache/samila-direct-electron-oracle-final/`。临时运行目录均在忽略的 `.cache/` 下。

这些是功能验证的墙钟耗时，不是性能对比。CPU 时间、进程族峰值内存、GPU 驱动内存和任务 token 成本未测量。本轮只改验证工具和说明，未修改产品渲染代码，未重跑全量产品单元测试或构建，未重建或替换 1.0 安装包。

## 复跑及剩余范围

在 `studio/` 使用锁定工具链、已安装 Electron 与既有固定 JAR、独立噪声表／色板参照：

```sh
node scripts/build-samila-sampler-oracle.mjs .cache/samila-sampler-electron-oracle-final --desktop-graphics --electron-runtime
node scripts/build-samila-direct-oracle.mjs .cache/samila-direct-electron-oracle-final --desktop-graphics --electron-runtime
node scripts/verify-source-samila-sampler.mjs .cache/samila-direct-electron-accepted .cache/samila-sampler-electron-oracle-final/fixture.json .cache/samila-direct-electron-oracle-final/fixture.json --desktop-graphics --electron-runtime
```

本次证明安装的 Electron 渲染运行时可以执行相同检查，并不包含打包应用的完整界面、文件选择器或视频编码链路。更不等于原生 MathArt 的 Java／JOGL 运行、随机流、线程时序、DPI 和完整窗口效果已匹配；原版整窗验收仍为 **0/11**。

此前 Chrome 中的缓存原因、普通浏览器失败对照及固定版本源码依据见 [GPU 缓存验证](samila-gpu-cache-validation.zh-CN.md)。
