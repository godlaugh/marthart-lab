# Original Fractal action and timing ingress

`source.json` records 21 original `JsonComplexFractalConfig.setupTimeline` action
parses and 7 additional target-timing parses. The actual original constructors and
private fields establish ordinary targets, ordered parameter children, the last
valid gradient child, edge inheritance and parser errors. Each harness ran twice
in separate JVM processes with identical decoded output. Provenance carries the
original JAR/JVM/class, harness and raw-output SHA-256 identities.

`oracle.c` wraps each raw actions value in one original animate timeline item.
It allocates config and FractalMobject without graphical construction, initializes
the config's edge field with original ParamEdgeEasingConfig.defaults/fromJson, and
creates the original safe Scene and GradientAnimator. It invokes original
setupTimeline and reads the actual resulting AnimationGroup/child fields. No
animation update, GUI, shader, render or encoder executes. Null target fields mean
no target, not zero. Native nonfinite values are represented as strings. Error
cases establish rejection, not a particular exception subtype. The fixture's
object member order is retained in its input; tests resolve native HashMap order
through the existing owner rather than sorting names.

`timing-oracle.c` invokes original setupTimeline for real fractal_zoom items and
reads the constructed target's duration and selected targetZoom. This establishes
that both duration and keys.time use JSONObject.getFloat: Double.parseDouble then
Float32 narrowing. A decimal just above a Float32 midpoint can first round to the
exact midpoint as double and then round down as float. Two key times thereby tie,
and the later key wins. Ordinary action array arguments instead try direct
Float.parseFloat first. The ordinary-hex-rounding and parameter-double-then-float
cases retain this distinction. NaN first-key locking, null/invalid duration minimum,
missing duration default and Infinity duration are also observed. These source
nonfinite outcomes do not imply local runtime admission.

To reproduce, use operator-provided original artifacts/JNI headers:

```sh
clang -I "$JNI_HEADERS" oracle.c -o /tmp/fractal-actions-oracle
/tmp/fractal-actions-oracle "$BUNDLED_LIBJVM" "$ORIGINAL_JAR_CLASSPATH"
clang -I "$JNI_HEADERS" timing-oracle.c -o /tmp/fractal-timing-oracle
/tmp/fractal-timing-oracle "$BUNDLED_LIBJVM" "$ORIGINAL_JAR_CLASSPATH"
```

Classpath includes packaged dependencies. Parse JSON following REA_ORACLE_JSON.
Executed runs used -Xmx256m and a 45-second subprocess timeout. No binary is
committed. Tests consume saved facts and need no original program installation.
