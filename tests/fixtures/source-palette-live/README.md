# Source palette commit ownership

`source.json` pins the original MathArt 1.7.8 classfile audit and its local retained evidence. This is static evidence, not a runtime oracle. It corrects an earlier audit that confused two Appearance callbacks.

Roots and Perlin use `updatePaletteOnly`, with opaque UI color parsing and retained simulation state. The cold JSON configuration is separate from ProjectState's saved colors. The toolbar recording callback resets before recording; Roots' palette-specific reset only invalidates its CPU shape cache.

The local production owner is exercised by `tests/source-perlin-live.test.ts` and the real browser/Worker script `scripts/verify-source-perlin-live.mjs`. The latter compares recording pixels with an independent cold configuration instance, not with the original application. Generator numerical parity belongs to the separate `source-gradient-palette` fixtures.

See [Chinese acceptance record](../../../docs/source-roots-perlin-gradient-generators.zh-CN.md) for actual App coverage, corrected findings and unresolved boundaries. No original executable/classfiles or generated captures are committed here.
