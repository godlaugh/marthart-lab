# Fractal 渐进预览与 Guessing 验收

本轮修复了源 Newton/Nova GPU 路径下 Guessing 预览的严重延迟，并补验真实编辑界面的渐进画布、取消、切换作品、保存重开和 PNG 导出。CPU 与源 Newton GPU 两条操作链路均通过。

这完成了 MAS-FRA-020/021 的本地操作链路验证。原版 MathArt 的完整窗口画面对照仍未完成，不能据此宣布原版效果完全一致。没有重建或替换 1.0 桌面应用。

## 修复内容

Guessing 按小块提交四角和中心采样点。GPU 采样器原先只合并调用顺序中连续的横向像素，导致这些零散点几乎逐点绘制、逐点读取四个附件。同一 479×360 源 Newton 输入在修复前等待 60 秒仍未完成。

现在由 GPU 采样器统一排列请求索引，在每行内合并受工作量上限约束的区间，再把数值和颜色记录放回原始请求顺序。重复点保留；区间空隙可能被 GPU 计算，但不会作为额外请求结果返回或计入采样数量。沿用原着色器、全图坐标插值、单次 GPU 工作上限、取消和资源清理规则；新增索引表示计入内存估算。

## 实际界面结果

测试使用隔离的无头 Chrome、真实 App 控件、实际 Worker 与 ArtRenderer，以及真实导出服务。没有操作用户的桌面窗口。

| 验收项 | CPU | 源 Newton GPU |
|---|---|---|
| Multi Pass 中间结果按顺序到达主画布 | 24×18 → 47×36 → 94×71 → 188×141 | 60×45 → 120×90 → 240×180 → 479×360 |
| 浏览器动画帧观察到上述四级画布 | 通过 | 通过 |
| 每级画布有多种颜色、内容发生变化，且与该级实际输出的独立呈现逐字节一致 | 通过 | 通过 |
| 取消后释放 3 条真实迟到消息，不覆盖画布；再次计算成功 | 通过 | 通过 |
| 导入另一作品后释放旧作品的 3 条消息，不覆盖新作品 | 通过 | 通过 |
| Guessing 保存、重开、导出项目 JSON 后保留选择 | 通过 | 通过 |
| Guessing 预览确实产生预测像素，并与同配置 One Pass 有差异 | 31,784 个预测像素；11,783 个不同通道 | 6,528 个预测像素；2,373 个不同通道 |
| 从 Guessing 项目实际导出 257×193 PNG，与新建 One Pass 生成器完整 RGBA 对照 | 完全一致 | 完全一致 |

源 Newton GPU 的 Guessing 预览最终复跑约 1.24 秒完成，同配置 One Pass 约 0.74 秒。Guessing 在这个输入上仍然更慢，且有近似误差；本次修复不代表所有输入都适合 Guessing。导出会对全部输出像素直接求值。

取消检查通过延迟投递已经计算完成的真实 Worker 消息，验证旧消息不会覆盖新状态；它不证明取消时正在计算的 GPU 工作已经中断。PNG 对照使用新的生产生成器和渲染器，证明本地链路一致性，不是独立原版数学对照。

## 有界采样测量

在相同机器、Chrome 155.0.8059.85、桌面 ANGLE 策略下，使用 64×16 光栅、100 次迭代、323 个包含空隙和重复点的请求。修改前后完成相同工作，所有返回的数值、残差、源轨道事实及 RGBA 数组哈希完全一致。

| 测量 | 修改前 | 修改后 |
|---|---:|---:|
| 每轮绘制次数 | 323 | 12 |
| 新建采样器的第一轮 | 443 ms | 72.7 ms |
| 同一采样器暖运行，第 1 次 | 356.6 ms | 20.3 ms |
| 同一采样器暖运行，第 2 次 | 321.0 ms | 19.7 ms |
| 含启动与清理的整项墙钟时间 | 2.70 s | 1.79 s |
| 进程族累计 CPU 采样值 | 6.00 s | 4.52 s |
| 进程族 RSS 采样峰值 | 1,400,608 KiB | 1,303,008 KiB |

这是一个小型完成任务的测量，不能把其加速比例直接套到完整作品。CPU/RSS 每 250 ms 用 `ps` 采样：可能漏掉短进程或峰值，RSS 相加会重复计算共享页；CPU 是观察到的累计下界。第一轮仅指采样器冷启动，不保证操作系统缓存冷启动。GPU 内存、整个代理任务的 token 消耗未测量。界面验证含画布截取开销，其总耗时不作为性能基准。

## 验证与证据

- Fractal 相关测试：20 个文件、386 项通过，包含乱序及重复采样、带空隙的绘制工作上限、权限/设备故障和清理覆盖。
- `npm run build`：类型检查和 Web 构建通过；现有大包体提示仍存在。
- 保留源着色验证：51 组完整图像及主机计划、4 个 Worker 请求、12 组历史图像对照通过，跨实例失败为 0。
- 保留 Newton/Nova 数值验证：16 组参考向量、35 组轨道、8 个 Worker 请求及 3 项边界检查通过；这属于保留代码和着色器的对照，不是原版窗口验收。

可重跑脚本：

```sh
node scripts/verify-fractal-progress-public.mjs .cache/fractal-progress-repeat-cpu
node scripts/verify-fractal-progress-public.mjs .cache/fractal-progress-repeat-gpu --source-gpu
node scripts/verify-fractal-raster-batching.mjs .cache/fractal-batching-repeat
```

本轮本地完整证据保存在 `.cache/fractal-progress-public-cpu-accepted/`、`.cache/fractal-progress-public-gpu-accepted/`、`.cache/fractal-row-batching-before/`、`.cache/fractal-row-batching-after-final/`，含 PNG、完整报告和源码哈希。采样器修改前版本另保存在 `.cache/fractal-row-batching-baseline/owner.ts`。缓存证据不进入 Git。
