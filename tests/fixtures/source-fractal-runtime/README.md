# Original Fractal scene + formula registry + gradient chain

Three cases, ten actual original `ComplexFractalScene.update` calls each. Original
`JsonComplexFractalConfig.setupTimeline` constructs the actual AnimationGroup,
ordinary FractalParamAnimation, parameter Start/Stop children and gradient child.
The actual Scene/SceneManager clock advances them; original FractalMobject.update
calls the real parameter registry, formula domain service/runtime mapper and
GradientAnimator. This is not separate formula simulations spliced together.
Two independent JVM runs produced identical decoded snapshots.

Original JAR/JVM/class/harness/output hashes are in `source.json.provenance`.
`initialInput` documents explicit numerical probe setup. Before queue construction,
the original global FormulaRegistry resolves `newton`; original JsonFormulaParamBinder
binds and validates `{exponent:[3,.25],bailout:.001,relaxation:1}`. That ParamSet is
installed and original remapFormulaRuntimeFromParamSet runs. Native initial Julia
is [0,0], matching fresh supplied-ParamSet initialization; no local override is
needed. Other explicitly initialized probe fields include rotation rate .25F,
ambient (0,.5F,0), iterations 127, three gradient offsets [.125,-.25,.375], and
PApplet frameRate 60. These rate/offset values are deliberate inputs, not asserted
original defaults.

- Case 0: ordinary bailout/Julia + three parameter starts + inside-only CROSS_FADE,
  followed by Wait. Completion of the animation group alone does not trigger the
  Fractal scene's extra raw update; completion of the final Wait does.
- Case 1: same coupled ordinary/parameter work and HUE_ROTATE with both sides,
  ending at the group. The terminal frame therefore advances parameter and gradient
  work once with active dt and once with raw dt.
- Case 2: start group followed by ordinary bailout/Julia + all-parameter stop +
  gradient stop, then zero Wait. After the stop children finish, ordinary bailout
  remains 5; the registry no longer remaps over it. The zero Wait still consumes
  its own queue frame.

Frame 2 is paused in every case. The harness calls setRenderMode(60), then injects
explicit renderStep values (recorded per frame) to sample boundaries reproducibly.
PApplet and FractalMobject graphical constructors are bypassed with AllocObject;
Scene, binder, registry, animation and gradient constructors/methods are original.
No GL, display, native host recording callbacks, window or encoder executes.

Snapshot schema extends source-fractal-clock. `formula` contains native integer
power, Float32 formulaParams/dynamicParams, and original ParamSet scalar/complex
maps. `gradient` contains running, progress, speedScale and applied Float32 offsets
in palette/inside/outside order. Floating values preserve numeric value and exact
IEEE bits. The initial snapshot precedes all Scene updates.

To reproduce with operator-provided original artifacts/JNI headers:

```sh
clang -I "$JNI_HEADERS" oracle.c -o /tmp/fractal-runtime-oracle
/tmp/fractal-runtime-oracle "$BUNDLED_LIBJVM" "$ORIGINAL_JAR_CLASSPATH"
```

Classpath contains all original packaged JARs. Parse after REA_ORACLE_JSON. Runs
used a 45-second subprocess timeout and -Xmx256m. No original binary is committed.
The fixture proves the bounded numerical callback chain; it does not establish
renderer pixels, whole-app defaults, UI events or recording timing. Java/JS
transcendental last bits may differ; compare phase/complex values with a justified
small relative tolerance and preserve exact Float32 comparison separately.
