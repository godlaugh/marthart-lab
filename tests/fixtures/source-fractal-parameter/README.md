# Original Fractal parameter numerical oracle

`source.json` contains 12 cases and 80 actual original-JAR state observations.
The retained bundled JVM runs `oracle.c` through JNI, using AllocObject for the
Fractal mobject and only its formula metadata/ParamSet, numerical remappers,
Start/Stop parameter callbacks and FractalParameterAnimator.update. No Mobject
constructor, PApplet, GUI, scene host, renderer or OpenGL context is invoked.
Artifact, class, JVM, harness and raw-output digests are in `provenance`.

The fixtures cover scalar metadata, scalar suffix aliases, full complex values
with captured imaginary component, real/imaginary components in HashMap order,
unknown names, reversed and narrow ranges, positive multi-turn phase reduction,
direct negative dt, reference-FPS fallback, step signs, custom edge easing,
named/all stop and restart, replacement and multiple children in one group.
Direct negative animator dt is a numerical method probe; the normal original
mobject calls it only for dt>0. Child elapsed-time integration is separately
verified by the scene queue owner. The local runtime receives eased progress.

Tests compare real native state against the runtime with narrow callbacks that
model FLOAT narrowing for the selected FLOAT fixtures; COMPLEX remains double.
These fixtures do not establish all FormulaDomainService remapping, custom
formula registration, integer setter overflow, nonfinite arithmetic, GUI/GPU
pixels or scene host timing. Missing metadata remains distinct from scalar.
Transcendental differences between Java Math and JavaScript Math are compared
with a small relative tolerance. Fixture tests need no proprietary binaries.

Reproduction, with already-provided original JARs/JVM and JNI headers:

```sh
clang -I "$JNI_HEADERS" oracle.c -o /tmp/fractal-parameter-oracle
/tmp/fractal-parameter-oracle "$BUNDLED_LIBJVM" "$ORIGINAL_JAR_CLASSPATH" inputs.json
```

Read JSON after `REA_PARAMETER_ORACLE_JSON`; use a 45-second process deadline
and the harness's 256 MiB JVM heap bound. The original source files and binaries
are not included here.
