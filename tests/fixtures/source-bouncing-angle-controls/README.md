# Original Bouncing inspector angle conversions

`NativeSceneProbe.java` invokes only the two pure static conversion methods in
MathArt 1.7.8's `BouncingParticlesSectionKt` through reflection. It uses the
original bundled JVM and dependencies, with the existing staged JVM host. No
scene/project instance, protected scene action, GUI window or application-data
access is requested. It writes a new `numerics.json` under the host's second
probe argument. The original application is not modified.

`native.json` retains 36 input/output Float32 bit patterns, including signed zero
and extremes, with original JAR/host/probe hashes and local run evidence paths.
The probe exited successfully and was reaped; no owned process group remained.
The original capture took 2.49 seconds. No CPU/RSS or cold/warm performance claim
is made for this small numerical probe.

`tests/source-bouncing-controls.test.tsx` compares the product conversions to
these runtime values and verifies degree edits without changing radian storage.
It also covers a concrete lossy roundtrip: unchanged display must preserve the
imported radian bit pattern. An independent public App verification is available:

```sh
MATHART_SOURCE_RENDERER_BACKEND=/absolute/path/to/backend.json \
  node scripts/verify-source-bouncing-native-export.mjs NEW_OUTPUT \
  --warmup-boundaries --separate-fps --angle-controls
```

That verification uses an explicit 512-particle fixture, headless Chrome, the
real native renderer and FFmpeg. It does not claim original GUI interaction or
exhaustive parameter coverage. See the [readable report](../../../docs/source-bouncing-angle-controls.zh-CN.md).
