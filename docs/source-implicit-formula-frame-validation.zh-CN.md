# 隐式曲面公式帧与位置验证

日期：2026-10-22。基线为 `a7473b6`。本轮修复新导入的原版 CPU 隐式曲面公式位置与主式内容，保留旧保存作品的本地布局。整图验收仍为 0/11。

## 原因与原版证据

旧导入把原版 position `[0,200]`、scale `0.25` 变成固定 1280×720 参考画布上的 `[640,560]`、scale `0.625`。生成输出没有公式帧，renderer 最后从文档重建本地公式，500×600 导出因此落在 y≈465，自动主式也采用本地 `F(x,y,z)=...` 排版。

已保留的原版正常许可运行日志直接记录：

- 主式：`{x}^{2} + {y}^{2} - {z}^{2} - 1 = 0`。
- 位置 `(0.0,200.0)`，scale `0.25`。
- 主画布逻辑尺寸 405×486；离屏逻辑尺寸 250×300，density 2，输出 500×600。

复用 `Scene.render` 与 `TexMobject.display` 字节码：离屏比例为目标逻辑高度 / 主画布高度；公式位于目标中心加位置偏移乘该比例，字形以原 scale 乘比例，并使用 CENTER 的整数半尺寸。换算到物理输出，本例中心 y 为 `300 + 200×600/486 = 546.913580...`，不是固定参考画布映射。没有添加按像素位置修补，也没有新启动原版。

受控摘要 `tests/fixtures/source-implicit-presentation/formula-frame.json` 保留实际日志事实、输入 fixture 对应关系、JAR 与四个相关 class 的 SHA-256。公式位置公式是字节码推导；日志没有独立捕获最终文字 quad，不能把推导冒充原生坐标读取。

## 生产边界与兼容

导入、文档验证与公式内容构造共享一个已确认家族的布局资格判定。新源 implicit CPU mesh 导入使用现有 `source-surface-centered-v1` 格式，直接保存原偏移/scale；运行时尺寸不写入作品。自动主式复用既有源表达式 parser 与 LaTeX emitter，并按原版附加 ` = 0`。

`generateScene` 在执行时间线和几何生成前确定初始公式内容，为每个 progress/final 输出独立附上同一份实际公式事实和请求中的主画布逻辑高度。Worker 客户端要求该路径交付 geometry、正确布局及与 camera viewport 一致的公式高度；缺失或损坏会拒绝，renderer 既有的“源帧缺公式”检查阻止晚期文档 fallback。公式显示与静态导出继续复用同一源字形合成和 PNG 增强 owner。

旧已保存作品即使保留源 implicit 数值标记或原始 provenance，只要仍是本地公式布局，就维持原行为和用户编辑结果；没有从名称或数值反推来源，也没有自动覆盖手动布局。要获得新导入规则，可以重新导入保留的原始 MathArt 文件。普通本地隐式作品不能仅写入 centered 布局冒充该源身份。其他源家族的资格没有扩大。

## 回归与成本

已执行 4 文件 51 例：新增 `source-implicit-formula-frame` 6 例，既有 `source-surface-formula-layout` 16 例、`source-fractal-formula-producer` 5 例、`generation-client-surface` 24 例，全部通过；类型检查通过。新增回归覆盖实际生成、主高度、初始主式、progress/final 隔离、保存重开、旧布局兼容与 Worker 错误字段拒绝。

同一 60³ fixture 的完整 `parseProjectFile → generateScene` 任务，在独立无子进程 Node 中比较基线与修改后。几何位置 SHA-256 均为 `22748688212d01bd3c63b4f8c0177a6458e7acc2978c434a8b6688cf5be494d1`。

| 完成任务 | 基线 elapsed / CPU / peak RSS | 修改后 elapsed / CPU / peak RSS |
| --- | --- | --- |
| 新进程首轮 ×1 | 369.42 ms / 594.11 ms / 157.95 MiB | 373.29 ms / 596.58 ms / 157.53 MiB |
| warm ×5 总计 | 1553.45 ms / 1932.98 ms / 212.39 MiB | 1578.46 ms / 1951.26 ms / 211.55 MiB |

峰值 RSS 为进程累计值，含初始化；首轮不代表 OS 冷缓存。基线晚期公式 fallback 不属于此生成调用，未计入。字形服务请求、浏览器合成、Worker 启动、GL/GPU、agent tokens 未测量，因此此数据不代表整个 UI 导出耗时。其他已知重任务在测量期间暂停。

## 实际公开导出结果

最终 `build:v2`（含类型检查）通过；`scripts/verify-source-implicit-export.mjs` 经真实页面导入与导出通过，无页面错误。脚本分别匹配预览和离屏生成完成消息，确认两者都交付原版文本、offset `[0,200]`、scale `0.25`、primary height 486；继续验证 density 2 和真实 PNG 增强 Worker 完成。

| 与原版 enhanced 比较 | 修复前 | 修复后 |
| --- | ---: | ---: |
| 中心 RGB MAE | 0.025299145 | 0.002637363 |
| 中心不同 RGBA 像素 | 416 | 135 |
| 中心最大通道差 | 162 | 32 |
| 全图 RGB MAE | 2.221990 | 2.176211111 |
| 全图不同 RGBA 像素 | 7,795 | 7,472 |

中心区域保持 `[55,55,445,510]`，没有改变容差或截取规则。产品公式目视已移至底部 y≈547，与上述实际事实及位置推导相符。本轮 PNG SHA-256：`5cfc825b7d02dae1b5255f7acdbfcf287ad6ffa8704b369959dce336b3625f84`；原版 enhanced SHA-256：`56f1833df3d77c0f4ba523c75424f4a211f906777e814ca593c14191cea301cb`。

原版正常许可水印覆盖底部公式，另有左上角 logo；本轮没有移除、修改或伪造这些原版元素。全图尚不相等。此前 raw 几何层的 28 个差异像素未在本轮扩修，增强后中心仍有 135 个差异像素；不能将中心改善提升为全图验收通过。

完整本地证据目录：`.cache/implicit-formula-frame-20261022/`，含 `public-final/report.json`、`comparison.json/png`、`tests-final.log`、`build.log` 与两份成本报告，不进入版本库。
