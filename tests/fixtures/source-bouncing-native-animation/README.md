# Original Bouncing animation reference

This probe runs the original `Bouncing/bouncing1.json` with all 2,000,000 particles.
It uses the original bundled JVM and normal license/policy initialization. The
original input, shaders, geometry, permissions and watermark behavior are not
rewritten. `NativeSceneProbe.java` requires an operator-provided original app,
JDK and macOS offscreen JVM launcher; no proprietary binary is included here.

The existing staged-loader launcher is documented in the local investigation at
`.cache/native-offscreen-reference-20261022/text-parity/thread-host-investigation/staged-loader-owned-exit/`.
Its calling convention is libjvm path, colon-separated packaged JARs plus probe
classpath, JVM log directory, original scene JSON, new output directory, and
original application-data directory. Compile the probe with the existing JDK:

```sh
"$JAVA_HOME/bin/javac" -proc:none -cp "$APP_CONTENTS/app/*" -d "$OUTPUT" NativeSceneProbe.java
```

Use the original app's JVM with a 60-second process-group deadline, back up its
policy cache before startup, and preserve before/after settings and license
hashes. This is an operational requirement of the probe, not permission to alter
those files. The reference run wrapper is retained locally at
`.cache/bouncing-native-animation-20261024/residual-states/native-capture.py`.
It compiles before execution, starts an owned process group, enforces timeout,
reaps it, and stores the run manifest consumed by the verifier. Setup/runner
availability is distinct from the checked-in numerical and image evidence.

Three paused frames initialize the original display. Then the original scene
runs 60 fixed-60-fps updates, each followed by one paused redraw. The offscreen
host's active particle draw has viewport 0×0; these empty active images are
explicitly rejected as artwork references. Paused redraws have viewport 500×600.
At 11 checkpoints, complete state textures before/after the paused redraw match,
so redraw does not advance the simulation. Two stable initial paused frames plus
60 updated paused frames yield 62 artwork observations (61 distinct states).

Each texture contains 1,415² RGBA Float32 texels: 2,000,000 real particles and
2,225 zero padding texels. Checkpoints are updates 0, 1, 2, 5, 6, 10, 21, 30, 36,
51 and 60. The four extra checkpoints cover every observed artwork mismatch.
`source.json` retains original artifact identities, state hashes, artwork hashes,
comparison results and exact residual coordinates. Large raw textures/images
remain in ignored cache; these hashes are evidence indexes, not executable
substitutes for the original state or pixels.

Artwork RGB is captured after scene drawing, at the original `drawWatermark`
depth-state boundary, before branding. The original watermark still executes and
is present in the final PNG. Original completed PNG alpha is checked separately
against the product's completed alpha. Intermediate artwork alpha is not silently
called identical: it differs because original `endOffscreenDraw` restores opaque
background alpha after this capture point. No brand region is cropped.

Run the production comparison against an existing capture manifest:

```sh
node scripts/verify-source-bouncing-native-animation.mjs /absolute/path/to/native-bouncing /new/report-directory
```

It invokes real production import, full seed generation, GPU update, camera and
point/boundary rendering in Chrome. It checks original run cleanup, input/probe
identity, permission results, state preservation, full-state bits, full artwork
RGB, final alpha, camera uniforms and GPU cleanup. Failed pixel parity returns
nonzero while retaining the complete report. As of this capture, 58/62 frames
match fully; four frames each differ by one green-channel level in one pixel.
All 11 full state textures and all camera matrices match exactly. Do not weaken
the check or label the whole animation exact until the remaining render-path
difference is resolved. This is not an App UI, original window, recording or
cross-device acceptance test.
