# Symmetry 旋转与镜像声明核验

2026-10-21。已完成验收项 **MAS-SYM-005** 的数学声明核验。保留指南中的原说法作为差异记录，产品说明以已固定原包公式为准：**非零 omega 不破坏公式的 n 重旋转关系；它打破的是原有镜像关系。gamma 是复共轭项的系数，不是一个固定旋转角度。**

这关闭的是公式声明的核验，不是原版图像验收。原版整窗口对照仍为 **0/11**，2.0 Goal 仍未完成。

## 给使用者的说明

- 阶数 n 指定公式在旋转 360°/n 前后的对应关系；特殊系数可能产生更多对称性。
- omega 为零时，公式也具有镜像关系。非零 omega 保留前述旋转关系，但打破原有镜像关系。
- 调整 gamma 会改变迭代映射及其形状，不等于把现有图案转过某个角度；需要旋转画面时使用相机角度。
- 公式的对称关系不保证任意有限粒子、初始分布、迭代次数、视角或裁切下的图片完整对称，更不保证收敛到非平凡图案。

内置源公式的参数面板新增了可展开说明；任意自定义 GLSL 不显示这段说明。生产数学公式没有为迎合指南描述而改动。

## 差异来源

先前保存的[官方指南](https://www.mathartstudio.art/guide/symmetry-chaos)把 gamma 描述为花瓣的旋转偏移，并将 omega 与引入镜像、破坏纯旋转对称联系起来。保留的 `guide__symmetry-chaos.json` SHA-256 为 `4131122eff1ac5cf9fb8639ff0abbe779954bb31f5ba595cf487dc43ed68cb81`；相关文本块为 25、26、196、198、199。本轮尝试重新读取网页失败，因此这里描述的是已保存版本，不断言当前在线页面仍然相同。

函数来源是已固定 MathArt 1.7.8 JAR，SHA-256 `a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018`；`SymmetryChaosFunctionGenerator.class` SHA-256 `6a839bddc08c8ab095a6feccbf4542e4896e73d260d69d0c89e06c0cc8f0215a`。脚本重新核对这两个摘要及保留的 Standard/Modified 提取函数摘要。

## 数学推导

令 z=x+iy，r=|z|，θ=arg(z)，共轭为 conj(z)。n 指 GPU 将 degree 四舍五入并限制到 2–50 后的整数；Modified 的 k 同理限制到 1–6。系数均为实数。原包两种内置函数可写为：

```text
F(z) = (A(z) + i·omega)·z + gamma·conj(z)^(n−1)
Standard: A(z) = lambda + alpha·r² + beta·Re(z^n)
Modified: A(z) 再加 delta·r·cos(n·k·θ)
```

令 R=exp(2πi/n)。因为 R^n=1，A(Rz)=A(z)，且 conj(Rz)^(n−1)=R·conj(z)^(n−1)，因此：

```text
F(Rz) = R·F(z)                      对任意实数 omega 成立
F(conj(z)) − conj(F(z)) = 2i·omega·conj(z)
```

第二式在 omega=0 时为零；omega≠0 且 z≠0 时不为零。结合旋转关系，omega=0 至少具有标准 D_n 的旋转/反射关系；非零 omega 打破这些反射关系。这里没有把某一张图的外观当作函数恒等式的证据。

改变 gamma 的差值为：

```text
F_(gamma+d)(z) − F_gamma(z) = d·conj(z)^(n−1)
```

它随输入位置变化，通常还改变输出的模长，因此不能统一解释为固定角度旋转。例如实际 GPU 的 Standard n=3、omega=0、z≈(0.21,0.32) 中，gamma 从 0.17 改为 0.31，输出由约 (0.044678,0.060335) 变成 (0.036516,0.041519)，模长也发生变化。

上述是理想实数运算的代数推导。Modified 在 r=0、delta≠0 时原实现存在 0/0，此处不把该非有限点纳入定义域，也未改变原实现；其非有限传播已有独立源数学测试。

## 实际 GPU 和界面验证

新增 `scripts/verify-symmetry-equivariance.mjs`。使用后台 Chrome WebGL2 分别运行保留的原包函数和生产函数，并以独立双精度极坐标表达式校验；未启动原版窗口或 JOGL。

覆盖所有整数 n=2…50、Standard 和 Modified 的全部 k=1…6，以及 omega=−0.12/0/0.12，共 **1,029 组参数**。每组使用 8 个有限非零点及它们的旋转/反射输入，共 24 个状态；另检查 gamma 差值关系。原包与生产函数的 **98,784 个 Float32 输出分量完全相等**，包括步长度量；数学关系共比较 98,784 个标量。

独立双精度值和旋转输入舍入不要求逐位一致：预先设定 `abs(actual−expected)/max(1,abs(expected)) ≤ 8e−5`，用于最多 300 次 Float32 复乘及旋转输入舍入的有界测试；这不是图像像素容差，也不是对所有输入的严格误差上界。实际最大残差见下表。

| 校验 | 最大归一残差 |
|---|---:|
| 独立极坐标表达式 | 4.55582337e-06 |
| n 重旋转关系 | 7.39276941e-06 |
| 镜像差值公式 | 4.88162041e-08 |
| gamma 差值公式 | 7.20918178e-08 |


相关参数编辑、源数学和 i18n 测试 **3 个文件、29 项通过**；TypeScript/Vite 构建通过，保留已有大 chunk 提示。

| 完成任务 | 耗时（秒） | 采样 CPU（秒） | 峰值 RSS（GiB） |
|---|---:|---:|---:|
| 1,029 组 GPU 与实际帮助面板 | 4.79 | 10.54 | 1.69 |
| 相关单测 | 3.63 | 7.70 | 1.65 |
| 构建 | 19.69 | 33.42 | 1.91 |

实际 App 中展开说明后内容可见；导入任意自定义 GLSL 后说明消失。此项只验证说明的适用边界，不宣称所有自定义方程都具有对称性。测试期间源摘要稳定，浏览器与 Vite 正常关闭；没有操作主屏，也没有替换已安装的 1.0 应用。

## 复验与剩余边界

```sh
node scripts/verify-symmetry-equivariance.mjs NEW_REPORT_DIRECTORY
```

需要本地 `.cache/source-symmetry-kernel-audit/manifest.json` 及其记录的原 JAR/提取函数。结果保存在 `.cache/symmetry-equivariance-all-ready/report.json`，同目录的 `parameter-help.png` 记录实际面板。相关单测与构建日志为 `.cache/symmetry-equivariance-checks.log`、`.cache/symmetry-equivariance-build.log`。这些证据和图片不提交 Git。

测量是整个新进程任务的成本，内部复用着色器，没有单独区分系统缓存冷/热；测试、构建与浏览器验证并行。CPU/RSS 以 250 ms 采样，CPU 是观察下界，RSS 可能重复计入共享页，可能漏掉短进程及峰值，未消除 PID 复用。GPU 内存和每个任务的 agent token 未测量；没有优化前后的等价任务基线，不声称性能提升。

原版窗口实测仍等待手动解锁 Mac。没有再次尝试自动解锁，也没有把公式恒等式或本地 GPU 测试当作整窗口效果一致性证据。
