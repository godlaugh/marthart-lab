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
explicitly set to 0.3 seconds by default in the retained input descriptor. The
probe uses 128×96 output, 12 FPS by default and original defaults (scale 3, high
quality). This default run has four active displays: one non-encoded warmup,
followed by three encoded frames.

Recording mode also accepts `--recording-fps` and `--recording-duration`. A
preflight rejects inputs exceeding the probe's eight-active-frame capacity;
the original runtime selects completion after **every** display, including
warmup. A completed warmup produces zero encoded frames and an original MP4
container without a video stream. The diagnostic never synthesizes a frame.

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

For completion boundaries, capture three new `bouncing1` references with
FPS/duration pairs `1/0.3`, `10/0.1` and `10/0.10000000894069672`, then run:

```sh
node scripts/verify-source-bouncing-recording-boundary.mjs NEW_OUTPUT OVER EQUAL ABOVE
MATHART_SOURCE_RENDERER_BACKEND=/absolute/path/to/backend.json \
  node scripts/verify-source-bouncing-native-export.mjs NEW_UI_OUTPUT --warmup-boundaries
```

The first check compares original runtime clocks and actual encoded frame counts
with the production clock owner. The second exercises public App rejection and
retry through headless Chrome and the real native renderer/FFmpeg. See the
[readable acceptance report](../../../docs/source-bouncing-warmup-completion.zh-CN.md).

## Full original-duration recordings

Add `--full-recording` to the recording capture command to preserve the **entire
original preset**, including its duration. It defaults to the original configured
60 FPS and 500×600 output; original `ensureRenderBuffer()` supplies the actual
1500×1800 frame. This option cannot be combined with a duration override.

The reference keeps every active artwork and final branded frame as lossless
PNGs. Hashes bind artwork RGB, final alpha/RGBA and original encoder input;
selected complete particle states remain retained. Disk admission covers worst
case PNG expansion, state files and encoder space. Capture stops only on original
completion; bounded diagnostic headroom and a 30-minute deadline fail explicitly
if completion is not observed. Progress is written after every 60 frames.

```sh
MATHART_SOURCE_RENDERER_BACKEND=/absolute/path/to/backend.json \
  node scripts/verify-source-bouncing-full-recording.mjs FULL_REFERENCE NEW_OUTPUT
```

The full comparator requires an **existing Pillow** installation for lossless PNG
validation; it installs nothing. It verifies every PNG against the original GL
readback hashes, then holds only the current native product frame while comparing
full RGB, alpha, clocks and camera matrices. Every original branded PNG goes
through the production HTTP export service. Complete decoded RGB streams are
hashed without retaining an entire uncompressed movie in RAM.

Simulation FPS and the original encoder's actual FPS are distinct observations.
In the retained FREE-tier run, `VideoRecorder` reduced encoding to15fps while the
configured scene still advanced at60fps. The comparator derives the encoder rate
from the actual process argv and explicitly selects both rates in the product
plan. Normal original license/branding remain active. MathArt Lab's optional
separate simulation rate can reproduce that playback speed; its default follows
the user's export rate and does not import a license cap.

H.264 thread choice also affects CRF pixels. The `mathart` service profile uses
the original automatic codec choice, while decoder/filter limits and service
job/byte/deadline bounds remain in force. Ordinary format profiles retain two
codec threads. `benchmark-source-recording-encoder.mjs REFERENCE NEW_OUTPUT
BASELINE_SERVER_BUNDLE` compares two completed exports per implementation, with
the same full original inputs, and records sampled CPU/RSS and elapsed time.
Each encoder is a fresh process; it does not claim controlled OS-cold caches.

The default capture is a short, bounded recording reference. Full mode validates
the selected complete preset and duration; neither mode establishes all
sizes/parameters, cross-device behavior or original window presentation.
Raw vendor artifacts, captures, videos, state textures and executables stay in
`.cache/`; only this diagnostic source and compact evidence indexes enter Git.
