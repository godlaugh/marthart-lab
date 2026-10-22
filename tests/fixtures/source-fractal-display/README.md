# Original Fractal display evidence

`mandelbrot.json` retains the rendering inputs from the shipped MathArt 1.7.8
`data/Fractal/mandelbrot.json`. Unused curve control points, equation decoration,
and unrelated scene settings were omitted. This is an input fixture, not a copy
of the local implementation's output.

The original class `ComplexFractalMobject.class` SHA-256 is
`d616f53f5364be32f3e280a7bb00e40785abbb3374e724fc9862badac3ef596f`.
Retained classfile evidence is in the ignored local evidence directory
`.cache/native-fractal-host-semantics-20261022/ComplexFractalMobject.class.json`.

The original JVM/GL runtime's seven paused display observations are retained at
`.cache/source-fractal-display-20261022/native-display-fractal/frame-{0..6}/`.
At logical size 250×300, `lastRenderState` is 1354526813. The observed
`(u_previewScale, u_gradientSize, passIndex-after)` sequence is:

```
(.25, 0, 1)
(.50, 0, 2)
(1.0, 0, 2)
(1.0, 1024, 2)  # frames 3 through 6
```

After a stable full display, the first display into another logical size has
scale .25 and actual gradient size 1024, while binding the fallback black
texture. The next draw consumes queued size 0. The retained original transition
capture is `native-transition-fractal/alternate-size/` in the same directory.

This delay is independently explained by the original bytecode: `renderFractal`
first calls `bindRefOrbitTexture` (offset 1644), which calls `PShader.bind`.
Only afterward does it queue `u_gradientSize` (1692), then call
`bindGradientTexture` (1699). `PShader.bind` consumes pending uniforms only when
not already bound. Thus texture binding and the size uniform belong to different
points in the display lifecycle; pretending that the full pass immediately
uses its new size is incorrect.

`computeRenderState` includes complete packed palette entries and solid alpha,
but omits center, zoom, rotation, time, dynamic parameter slots and coloring
algorithm IDs. It uses Java float bits, double folding and signed int overflow.
The tests preserve those omissions instead of broadening the hash to all inputs.
`applyConfig` resets passIndex without recreating the shader or its pending queue.

The owner tests establish display state transitions and the runtime hash. The
injected-renderer live/recording tests establish producer integration, target
switches and absence of implicit warmup draws. They do not establish GPU pixel
parity. Original GL captures and real browser comparisons are separate evidence.
