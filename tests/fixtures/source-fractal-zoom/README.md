# Original FractalZoomTargetAnimation oracle

`source.json` contains real calls into the locally retained MathArt 1.7.8 JAR,
using its bundled JVM. It is not output from a copied implementation. Artifact,
class, JVM, harness and raw-result SHA-256 identities are included in provenance.
No proprietary binary or class bytes are included.

- 64 target animation samples: forward/reverse/equal/near-equal zoom, max clipping,
  minimum zoom, sine easing, progress clamping and nonzero center low parts.
  `samples[].target` is the canonical constructor-clamped target; original raw
  target below 1e-9 was passed as 1e-12 in the C `floor` case.
- 22 raw JSON target-parser cases: merge precedence, last maximum Float32 time,
  equal and NaN times, null versus absent, string/expression parsing, invalid
  containers, and maxZoom fallback. `parseInitial` is passed through original
  mobject setters first, so its low parts are normalized before fallback reads.
  Nonfinite native doubles have string `value` plus exact IEEE-754 `bits`.
  Error cases only establish that the original parser throws; they do not claim
  an exception subtype. Missing `maxZoom` in an error case is unobserved.
- 12 Animation.update calls at float32 0.1 over duration 1. The mobject was changed
  after target construction and before the first update. This proves start-time
  capture and float runtime accumulation, including no more writes after finish.

`oracle.c` uses JNI AllocObject for mobject/config and only pure setters, parser,
animation constructors and numerical updates. It does not call render/initScene,
create a PApplet, launch a GUI or initialize an OpenGL context. Private oracle
logging is silenced to keep output machine-readable. JVM heap is bounded at
256 MiB. The command runner used a 45-second timeout.

Reproduction requires operator-provided original artifacts and JNI headers:

```sh
clang -I "$JNI_HEADERS" oracle.c -o /tmp/fractal-zoom-oracle
/tmp/fractal-zoom-oracle "$BUNDLED_LIBJVM" "$ORIGINAL_JAR_CLASSPATH" > /tmp/fractal-zoom-output.txt
```

`ORIGINAL_JAR_CLASSPATH` is the colon-separated list of the original app's JARs
(including its packaged Log4j dependencies). Parse JSON after `REA_ORACLE_JSON`.
No test requires possessing or executing the original application.

Tests compare Java Math and JavaScript Math with a small relative tolerance;
their transcendental last bits are not claimed identical. Center low parts are
compared at their own magnitude, not tolerated relative to the high part. This
fixture establishes the numerical methods; it does not establish original GUI,
GPU pixels or local timeline queue equivalence. The original config dispatches
TargetAnimation even for `keys`; the packaged KeyframeAnimation is not a license
to reinterpret imported keys as a multi-segment path.
