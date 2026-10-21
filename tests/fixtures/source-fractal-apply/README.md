# Original same-instance Fractal Apply during an active queue

`source.json` contains three cases, twelve original `ComplexFractalScene.update` calls each, plus initial
and before/after Apply snapshots (45 snapshots total). Two independent JVM
processes produced identical decoded outputs with no stderr. Artifact, class,
JVM, harness and raw-output SHA-256 values are in `source.json.provenance`. The additional capacity fixture below
adds two cases and 30 snapshots, for five cases and 75 snapshots in total.

This fixture reuses `source-fractal-runtime`'s explicit `initialInput`, original
formula binder and real Scene/SceneManager/AnimationGroup initialization. It
additionally creates the original ColoringRuntimeMapper and zeroed color packing
arrays needed by `ComplexFractalMobject.applyConfig`. PApplet and Mobject use
AllocObject to bypass graphical constructors. Scene, animators, registry and
mappers are original objects. Apply creates a **real JsonComplexFractalConfig**
from `applyInput` and invokes **the same existing Mobject.applyConfig**. No local
formula or animation implementation supplies expected results.

Before frame 3, the harness captures `beforeApply`, calls applyConfig and captures
`afterApply`. Frame 3 is then a real paused `Scene.update(true)`; frame 4 resumes
with the recorded fixed step. The harness does not invoke MathArtSession or host
callbacks. Static evidence separately establishes that original paused Apply
uses this object path; this does not reproduce Compose events or native GL.

- Case 0: Apply during ordinary center/zoom/rotation/bailout/Julia animation with
  active parameter Start and gradient Start children. Original ordinary capture
  fields and queue progress survive. Apply sets center [9,-8] and zoom 7;
  the next running frame returns to the old captured path, center [.75,-.375]
  and zoom 2.125. Existing Start children do not restart cleared animators.
- Case 1: Apply during the original FractalZoomTargetAnimation after an earlier
  parameter/gradient start. The target retains its original DD center and zoom
  capture, including the accumulated runTime. Resume yields zoom 2 and center
  [.4,-.13333333333333333], rather than recapturing the applied [9,-8], zoom 7.
- Case 2: Apply switches Newton to Nova during active parameter/gradient Stop
  children and ordinary bailout animation. The same stop children and queue
  remain. Nova's supplied start_value [.2,.3] is mapped to native Julia.

Every case later reaches a fresh Start group. At frame 8 it restarts parameter
and gradient runtimes; clearing the old runtime does not remove future queue
entries. The supplied Apply JSON has no timeline, yet the old queue survives.

The snapshot extends `source-fractal-runtime`:

- `animationDetails`: recursive real child class, started/finished/runTime and
  captured ordinary/target start fields. Unstarted ordinary capture fields are
  Java zero defaults; unstarted target DD captures are null.
- `parameterAnimator`: running plus sizes of config, scalar/complex phase,
  fixed-imaginary and step-scale maps.
- `gradient`: running, progress, speedScale, targetSpeed, three base offsets,
  routing flags and three applied Float32 offsets. Mode/interpolation are also
  recorded at state level. Apply stops motion but preserves progress/base/config;
  applied offsets are replaced by config [.625,.75,-.5].
- `ambientAngles` and `activeFormulaId` supplement existing native properties,
  registry maps, camera theta, scene time and queue observations.

The paused call preserves all observed fields except frameDeltaTime, which
becomes zero. This is distinct from the immediate `afterApply` snapshot, where
frameDeltaTime still holds the preceding .05F. The explicit .25F rotation rate,
[0,.5F,0] ambient rates, prior offsets and PApplet.frameRate=60 are deliberate
probe inputs, not asserted application defaults. The fake PApplet path uses
its frameRate; actual MathArt uses getEffectiveFps (recording config.renderFps,
live measured frameRate). No renderer, host recording, GUI or encoder executes.

Reproduce using operator-provided original artifacts and JNI headers:

```sh
clang -I "$JNI_HEADERS" oracle.c -o /tmp/fractal-apply-oracle
/tmp/fractal-apply-oracle "$BUNDLED_LIBJVM" "$ORIGINAL_JAR_CLASSPATH"
```

Classpath includes all packaged JARs. Parse stdout after `REA_ORACLE_JSON`.
Runs used a 45-second subprocess timeout and -Xmx256m. No original binaries are
committed. Floating outputs retain values and IEEE bits. This fixture establishes
the bounded numerical application/continuation path, not whole-app equivalence.

## Retained HashMap capacity regression

`capacity-oracle.c` / `capacity.json` reuse the same bounded harness with two
cases, twelve updates each. Case 0 first registers 25 unknown names; the original
parameter animator stores these configs even though they have no formula binding.
Its HashMap expands to capacity 64. Case 1 registers only two, leaving capacity16.
Both finish that group, Apply the same configuration, pause, then start exactly
the same two parameter configs (`exponent` and `exponent_im`).

JNI reads the actual private JDK `HashMap.table` length and original keySet order,
without changing the table. `clearParams` empties entries but retains table
capacity. `parameterAnimator.tableCapacity` and `.order` are direct observations:

| Case | Capacity before / after Apply | Future iteration order | Frame4 exponent imaginary |
|---|---|---|---|
| 25 prior registrations | 64 / 64 | exponent, exponent_im | 0.1621092790743515 |
| 2 prior registrations | 16 / 16 | exponent_im, exponent | 0.125 |

Both frame4 real parts are 4.0749824253445235. Full-complex `exponent` writes its
captured fixed imaginary component, so reversing these writes changes the final
parameter value. This is numerical evidence, not merely a map-order assertion.
Both independent original JVM runs match exactly and emit no stderr. The initial
probe attempt stopped at the harness's 20-child snapshot bound (exit6); it was
raised to32 to admit the deliberately25-child case. The application did not fail.
No product source or TS test code was changed by this fixture producer.
