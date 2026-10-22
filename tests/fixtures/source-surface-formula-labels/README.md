# Original Surface formula labels

`source.json` retains 11 complete automatic labels produced by MathArt 1.7.8
`JsonSurfaceConfig(PApplet, JSONObject).getFormulas()` in two independent bundled
JVM processes. Six inputs use the packaged Surface equations and initial
parameters; five probe names and an ignored native `main_equation.latex` field.
The separate `../source-real-latex-native.json` retains 119 expression results
from the same runs. Expected text is original runtime output, not local output.

`oracle.c` and `input.json` reproduce both groups using operator-provided artifacts:

```sh
clang -std=c11 -Wall -Wextra -I "$JNI_HEADERS" oracle.c -o /tmp/surface-label-oracle
/tmp/surface-label-oracle "$BUNDLED_LIBJVM" "$ORIGINAL_JAR_CLASSPATH" input.json
```

The classpath contains the packaged JARs. Read JSON after `REA_ORACLE_JSON`.
Runs used headless AWT, `-Xmx256m`, and a 45-second subprocess deadline. The
PApplet constructor supplies ConfigUtils's non-null argument; no runSketch,
Scene, TexMobject, graphics initialization, GL, GUI, or encoder is invoked.
Config inputs are minimal JSON objects, so file-constructor displayLabel behavior
is not covered. Original underscore-only name escaping is retained. Explicit
custom text remains a local MathArt Lab feature and is not claimed native behavior.

The source record pins JAR, JVM, relevant class, harness, input and result SHA-256.
Raw stdout/stderr and the earlier rejected null-PApplet attempt remain under
`studio/.cache/surface-latex-source-20261022/`. Native pixel/font parity and every
possible numeric string are outside this fixture's coverage.
