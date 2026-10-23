# Original Roots formula drawing order

`native.json` records three actual GL texture submissions from MathArt 1.7.8.
The input is a derived copy of bundled Degree10: the two extra formulas and the
main equation use the same text, position and scale, but distinct green, blue
and red colors. No math, sample count, camera, timeline or license configuration
was changed. Input/probe/texture/framebuffer digests identify the observation.

The original draws green extra, blue extra, then red main. Production before the
fix drew red main first: 429 pixels differed, with a maximum channel difference
of 190. After the producer-order fix, the entire 500×600 formula framebuffer is
byte-identical. A separate original 320×240 render and product replay are also
byte-identical. These are captured boundaries before later vendor overlays; the
original full PNGs still contain its normal FREE watermark.

The test also preserves main-first ordering for existing generic saved layouts
and checks hidden/empty filtering. Real Worker/App and PNG checks live in the
local capture directory and its `after`, `wide/product` reports. Unit ordering
tests alone are not whole-scene, full-solver or recording parity evidence.
