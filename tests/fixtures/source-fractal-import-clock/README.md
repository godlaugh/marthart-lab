# Original Fractal import and fixed-frame observations

These four inputs investigate three obsolete `timeline-import.test.ts` assertions:
initial `center_hi_lo`, a Wait followed by a target, and two consecutive targets.
The fourth input adds `center` beside `center_hi_lo` to distinguish initial config
parsing from animation target parsing. All use Mandelbrot and the imported 30 fps.

`oracle.c` invokes the original `JsonComplexFractalConfig` constructor (null
PApplet), its viewport getters, `ComplexFractalScene` constructor, `setupTimeline`,
`Scene.add`, `setRenderMode(30)` and `ComplexFractalScene.update(false)`. PApplet
and the graphical mobject are allocated with JNI AllocObject. Initial viewport
values come from the real config getters and original `setZoom`/`setCenterParts`.
The source `applyConfig` bytecode at offsets 765–820 establishes that it consumes
these getters, creates DoubleDouble values with zero low parts, and floors zoom
at 1e-6. The harness does **not** execute full applyConfig or graphical constructors.

Other mobject values are synthetic harness prerequisites inherited from the
clock oracle: iterations 127, bailout 4, Julia (-.7,.27015), inactive parameter
and gradient animators, and zero ambient/rotation rates. Their snapshots are
retained only in local raw evidence, not asserted as original config defaults.
No formula registry remapping, GUI, GL, render, recording or encoder is verified.

Each case performs 92 native fixed updates. Eighteen selected update ordinals
cover first display, midpoints, both sides of clip boundaries, and completion.
Ordinal 0 is the first update, matching the local fixed-preview contract; seconds
are a local selector for an ordinal, not a native arbitrary-seek API. `source.json`
retains all four initial viewports and 72 selected frames, with original IEEE bits
and queue/time facts. Two independent JVM runs produced identical full outputs.
The input JSON is embedded in the harness and duplicated in `inputs.json` for
review. `source.json` records JAR, JVM, relevant classes, harness, inputs and raw
output SHA-256 hashes. No original binary is checked in.

Reproduce with the operator-provided artifacts and JNI headers:

```sh
clang -I "$JNI_HEADERS" -I "$JNI_HEADERS/darwin" oracle.c -o /tmp/fractal-import-clock-oracle
/tmp/fractal-import-clock-oracle "$BUNDLED_LIBJVM" "$ORIGINAL_JAR_CLASSPATH" > /tmp/fractal-import-clock-output.txt
```

Classpath must list all packaged JAR paths separated by colons; JNI does not
expand a launcher-style wildcard. Bound execution to 45 seconds. The harness uses
headless mode and -Xmx256m. Parse JSON after `REA_IMPORT_CLOCK_JSON`. The checked-in
fixture selects `viewport`, `sceneTime`, `managerIndex`, and `managerFinished`
from each original snapshot; it computes no expected animation values.

Tests exercise public project import, project save/reopen, and `sceneAtTime`,
including backward reconstruction. Initial viewports and Float32 clock/queue
facts are exact. Double viewport comparison retains the existing scene-clock
oracle bound (8 × Number.EPSILON relative, minimum Number.MIN_VALUE), allowing
cross-runtime transcendental rounding. Low components use their own magnitude;
the bound is not relaxed to the magnitude of the high component.
