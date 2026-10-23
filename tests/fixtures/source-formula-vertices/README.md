# Original TexMobject vertex observations

`native.json` records CPU-transformed XY corners read from real Processing GL
attribute buffers after the three formula texture draws in MathArt 1.7.8's
Degree10 scene. The original app used its bundled JVM, normal FREE policy and
watermark, and a 250×300 logical / 500×600 physical offscreen target. No original
formula, glyph, renderer or license method was replaced. The process exited and
was reaped; settings and license facts before/after are included.

The retained local probe and full buffers are under the fixture's `capture`
path. JAR, JVM, probe, input, vertex and texture hashes identify the evidence.
The three independent glyph textures also matched the production glyph service
byte-for-byte. A browser replay of captured vertices and matrices matched the
complete 500×600 buffer after the third formula draw exactly.

These goldens test native float operation order and integer image centering at
logical scale and pixel density 2. They do not establish arbitrary pixel-density
rounding, all formula placements, overlapping-label order, or full scene/video
parity. Later original branding/watermark draws were retained in the original
raw/enhanced PNG files; the captured formula boundary is not a modified PNG.
