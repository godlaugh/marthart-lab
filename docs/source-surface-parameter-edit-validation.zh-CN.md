# 曲面实时参数修改验证

本轮已把参数修改接到保留中的曲面对象、Worker 和 Generator 客户端。
修改参数不重建会话、不重置队列、不停掉已有参数动画；模式切换后修改当前对象，
时间线动作继续保留原有绑定。编辑界面尚未启用这条曲面实时链路。

## 原版观察

使用已保存的 MathArt 1.7.8 原始 JAR，SHA-256 为
`a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018`。
原版 `MathArt.updateParameter` 的曲面分支只读取 currentScene、取得当前曲面的
SurfaceFunction 并调用 setParameter。为此在独立 JVM 中分配 MathArt 控制对象，
只设置 currentScene，不运行它的构造函数或窗口生命周期；场景和 CPU 粒子本身仍通过
原版 JSON 解析、构造和 Scene.update 执行。

六个项目每次合计 90 步，两次执行完全相同，覆盖点、网格、点→网格→点、参数片段、
空点队列与空网格队列。每步保留修改前、修改后和更新后的状态。

实际观察到：

- 手动值进入当前函数，已有 CPU 粒子坐标不会立即改变。
- 暂停期间队列、对象时间和粒子位置不推进。
- 参数动画保持原相位；下一次更新可能覆盖手动值。
- 模式切换后，新对象收到编辑，旧对象的参数不随这次编辑改变。
- 未声明参数的写入没有改变被观察到的函数值或粒子。
- 队列完成后，CPU 粒子不因为参数编辑而自行执行一次更新。

数值和运行来源见 `tests/fixtures/source-surface-scene/edits-native.json`；
该文件是实际 JVM 输出，包含对象身份关系、binary64 参数位、类和输入摘要、
运行日志摘要与子进程退出记录。不是本地算法生成的期望值。

## 本地实现与验证

生产函数已经统一持有表达式常量、函数版本和模式切换时的共享初值。
这次把编辑直接送到这个所有者；没有另造一份参数状态，也没有重新启动参数动画。
Worker 使用 `surface-parameter` 接收单次编辑；Generator 的
`updateSurfaceParameter` 要求当前已完成画面的身份，并检查响应身份。
无效数值在修改前拒绝，过期画面不能控制新会话。

执行结果：

| 验证 | 结果 |
| --- | --- |
| 六个文件的针对性测试 | 88/88 通过 |
| 原版编辑观察 | 六项目 × 15 步 × 两次，结果相同 |
| 原有队列观察兼容性 | 十项目、133 步，两次相同，并与旧 fixture 的 actual 完全相同 |
| 真实 Generator→Worker→ArtRenderer | CPU 点、CPU 网格、CPU 模式切换、GPU 点、GPU 网格，5/5 通过 |
| TypeScript 与生产构建 | 通过；保留现有大包提示 |

浏览器检查实际读取 WebGL 像素，验证暂停编辑不推进队列、CPU 点坐标暂不变化、
网格和 GPU 输出响应参数、未知参数无影响、拒绝非有限值后仍能读取当前画面，
并保留暂停恢复、过期控制、缓冲区转移和模式切换检查。
浏览器运行约 14.51 秒；首轮原版 JVM 两次分别约 1.12、0.41 秒（最终证据刷新时间另见运行记录）。
本轮未测 CPU 时间、进程族峰值内存、VRAM 或 agent token 成本，不作性能提升声明。

第一次测试发现空时间线 CPU 点项目通过现有本地几何路径导入，无法进入源曲面会话。
对此没有伪造源版本或标记数值验证通过：保留该原版观察，并单独记录导入边界。
其余五个项目的 75 步进入生产源曲面队列测试。点坐标与原版实际粒子逐步比较；
网格首顶点按原版观察到的函数值和该项目 `x=a+u,u=0` 推导，不能算原版网格截图比较。

## 仍未完成

- 曲面编辑界面接线、完整 Apply 重载生命周期、视口操作、当前 PNG 和录制。
- 空时间线 CPU 点项目的源会话导入路径。
- 原版 GUI、JOGL 绘制与完整窗口一致性验证：仍为 **0/11**。

本轮没有操作桌面窗口，没有验证 Yomado 上的目标窗口输入，也没有修改已安装的 1.0 应用。
Goal 保持进行中。

## 复现及本地证据

在项目根目录使用现有 Node/JNI 环境运行：

```sh
python3 scripts/source-surface-scene/run.py \
  --app /absolute/path/MathArt.app \
  --jni-include /absolute/path/existing-jni-headers \
  --cases scripts/source-surface-scene/edit-cases.json \
  --output /absolute/path/new-evidence-directory
node scripts/verify-source-surface-live.mjs /absolute/path/new-browser-evidence
```

本次本地证据：`.cache/surface-edit-native-final/source.json`、
`.cache/surface-edit-scene-regression/source.json`、
`.cache/surface-edit-tests.json`、`.cache/surface-edit-build.log`、
`.cache/surface-edit-browser/report.json`。
所有受控 JVM 子进程正常退出并已回收。
