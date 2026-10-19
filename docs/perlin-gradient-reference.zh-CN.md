# Perlin 渐变参考行为核对

2026-10-19。固定参考 MathArt 1.7.8 JAR 的 SHA256 为 `a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018`。以下为包内类文件的静态观察与推导，没有运行原版应用。

原验收清单把“Cosine／Curve／HSV 缺函数参数渐变”当成 Perlin 的原版缺项，这个判断不准确。

原版 Perlin 编辑器可用 Manual、Cosine、Curve；Cosine 和 Curve 会先生成 2–25 个普通颜色，写入作品 palette 数组，再交给同一个运行时动画器。相关枚举没有 Sine／HSV。不能把本地函数色图的参数动画当成原版 Perlin 的运行合同。

| 原版动作 | Perlin 实际消费方式 |
|---|---|
| HUE_ROTATE | 色板主偏移，并非直接对 RGB 色标做 HSV 色相旋转 |
| OFFSET_CYCLE | 内外两个偏移的平均值 |
| CROSS_FADE | 同一色板在两个偏移处的采样混合，并非两组任意色标的单程过渡 |
| PALETTE_MORPH | 主偏移与外部偏移的采样混合 |

RGB、Linear RGB、OKLab、OKLCH 四种颜色插值确有执行路径。Perlin 动作构造器强制启用两个影响区域；CPU 粒子、曲线及 GPU 纹理均接入动画器。停止动画本身不触发颜色重新生成，只有实际状态变化才刷新；GPU 使用 256 项颜色纹理。曲线模式下，初始化时生成的空间色圆还保留自己的固定颜色，不能随每帧渐变重新生成。

当前本地实现的色相变换、双色板过渡、动画速度、停止刷新时机和 GPU 色板采样与这些源规则仍有差距。因此 MAS-NOI-033／034 **仍未完成**，下一步应实现独立的源 Perlin 色板状态，并接通粒子、曲线、GPU 三个消费者；保留现有作品的本地模型。

证据定位：

- `GradientEditorMode.<clinit>` 仅三枚举，class SHA256 `1d3085063fc73b595a9c3aed901f95264c3966907b43ec90f393b1173325e044`。
- `AppearanceSectionKt.syncPaletteFromCosine/syncPaletteFromCurve` 生成并替换 `ProjectState.palette`；`ProjectState.toJson` 写普通 palette 数组。
- `JsonPerlinConfig.parseConfig` PC944 调用继承的 `parsePalette`；`buildGradientActionAnimation` PC114–138 强制两个区域为 true。
- `PerlinNoiseField.update` 在 GPU 分支返回前先更新渐变；`applyGradientFrame`、`applyGradientState`、`sampleGradientPalette` 与 `rebuildPaletteTexture` 分别拥有偏移、刷新、采色和纹理表示。该 class SHA256 为 `ef1de66f25e6fed5a126cb260005d0b5d7fd161118cc83993f0648009de96d92`。

本地详细报告 `.cache/v2-perlin-gradient-contract-audit.md` 保留 8 个重新核对的类哈希、方法指令位置和证据文件。这里没有证明完整噪声算法、原版实时调度、原生驱动或整图一致性；原版整图验收仍为 0/11。
