# Original Bouncing recording reference

`NativeSceneProbe.java` executes MathArt 1.7.8 with its original JVM, scene,
shaders, authorization, branding and VideoRecorder. `capture-source-bouncing-original.py`
pins the original JAR, preset, staged-loader host and this probe. Recording mode
requires an existing explicit FFmpeg executable; it does not install anything.

```sh
python3 scripts/capture-source-bouncing-original.py bouncing1 NEW_OUTPUT \
  --mode recording --ffmpeg /absolute/path/to/ffmpeg \
  --app-contents /absolute/path/to/MathArt.app/Contents \
  --java-home /absolute/path/to/existing/jdk \
  --host /absolute/path/to/verified/launch-staged-loader \
  --app-data '/absolute/path/to/original/MathArt/data'
```

The original preset retains every particle and setting except `record_duration`,
explicitly set to 0.3 seconds in the retained input descriptor. The probe uses
128×96 output, 12 FPS and original defaults (scale 3, high quality). Each run has
four active displays: one non-encoded warmup, followed by three encoded frames.

The host bridges new `PGraphics` allocation to its JOGL drawable. Original
`ensureRenderBuffer()` computes the actual 384×288 dimensions. Each frame calls
original `Scene.update(false)` **before** export-buffer `beginDraw`, then original
`render`, `endDraw` and `VideoRecorder.recordFrame`, following `MathArt.draw`.
Updating the primary PGL while already inside an export buffer was the cause of
the former zero-viewport active reference; no viewport repair or paused redraw
is substituted in this probe.

A forwarding GL observer records each particle draw's count, update index,
viewport, camera uniforms and selected complete state textures. It captures the
full artwork at the normal `drawWatermark` entry, before branding primitives.
The normal branded framebuffer, PNG, exact encoder-input RGBA and actual original
MP4 are retained separately. Observers restore GL readback state. Every active
frame must have the complete expected viewport, count and update index. Missing
telemetry, GL errors, original error logs or encoder cleanup failure invalidate
the run. Settings/license states and normal policy-cache changes are recorded.

`verify-source-bouncing-recording-parity.mjs REFERENCE NEW_OUTPUT` checks the real
product export planner and native Generator against every original artwork RGB
pixel, final alpha, camera matrix and Float32 clock. It also encodes the **same
original branded PNGs** through the production export server and compares decoded
RGB to the actual original VideoRecorder movie. This latter check proves encoder
transport/parameter equivalence for those inputs, not product-generated branding
or full GUI movie equivalence. Both use the same explicitly selected FFmpeg.

This is a short, bounded recording reference. It does not establish long videos,
all sizes/parameters, cross-device behavior or original window presentation.
Raw vendor artifacts, captures, videos, state textures and executables stay in
`.cache/`; only this diagnostic source and compact evidence indexes enter Git.
