# Source palette commit ownership

`source.json` pins the original MathArt 1.7.8 classfile audit and its local retained evidence. This is static evidence, not a runtime oracle. It corrects an earlier audit that confused two Appearance callbacks.

Roots and Perlin use `updatePaletteOnly`, with opaque UI color parsing and retained simulation state. The cold JSON configuration is separate from ProjectState's saved colors. The toolbar recording callback resets before recording; Roots' palette-specific reset only invalidates its CPU shape cache.

The local production owner is exercised by `tests/source-perlin-live.test.ts` and the real browser/Worker script `scripts/verify-source-perlin-live.mjs`. The latter compares recording pixels with an independent cold configuration instance, not with the original application. Generator numerical parity belongs to the separate `source-gradient-palette` fixtures.

See [Chinese acceptance record](../../../docs/source-roots-perlin-gradient-generators.zh-CN.md) for actual App coverage, corrected findings and unresolved boundaries. No original executable/classfiles or generated captures are committed here.

`followup-20261024.json` records the subsequent explicit Perlin palette-command fix and Fractal controlled-generator integration. It pins local production/App reports and reused static evidence separately; it is an evidence index, not an original pixel oracle. See the [Perlin command record](../../../docs/source-perlin-palette-commands.zh-CN.md) and [Fractal generator record](../../../docs/source-fractal-gradient-generators.zh-CN.md) for current coverage and limits.
