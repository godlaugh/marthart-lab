# Original Surface parameter-clock observations

`native.json` contains actual bundled JVM results, not a translated numerical
oracle. Original artifact SHA-256:
`a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018`.
The fixture records JAR, Processing, JVM, class, harness and runner hashes,
original target paths, bounded process results, and two identical executions.

Twelve traces cover point, nonempty mesh and empty mesh updates, with four
parameter configurations and ten updates each. Observations include changing
37/24/29.97/120/500 FPS, <=1 FPS fallback, zero/negative dt, initial values outside
the parameter range, negative steps and narrow ranges. Floating-point values
retain binary64 bits; frame inputs have passed through original Float32 fields.

JNI allocates PApplet/ParametricSurface/MeshSurface without their graphical
constructors. It runs the real JsonSurfaceFunction and animator constructors,
add/start/update/getter methods and the real surface update gates. Function
expressions are unused/null, and the surface uses its non-CPU branch with no
tracked dot. Mesh uses a one-element placeholder or empty particle array.
No scene queue, drawing, shaders, window, encoder or full GUI lifecycle runs.
These restrictions are intentional and do not establish framebuffer parity.

`source-surface-observed-clock.test.ts` compares real production CPU geometry and
GPU uniform producers against the nonempty native traces. Negative raw dt maps
to a zero active object dt; this test does not claim a live scene-clock adapter
has been installed. Original double parameter/phase recurrence is compared with
13-decimal tolerance for Java Math versus JS libm. Geometry/uniform Float32
values compare exactly. Empty native meshes are retained as observations only;
the local mesh configuration requires positive grid dimensions.

Reproduce on macOS with the original app and existing JNI headers:

```sh
python3 scripts/source-surface-clock/run.py \
  --app /path/to/MathArt.app \
  --jni-include /path/to/existing-jni-headers \
  --output /path/to/new-evidence-directory
```

The header directory must contain `jni.h` and `jni_md.h`. The runner installs
nothing, rejects a different application JAR digest, requires a new output
directory, compiles only this harness, and limits each owned JVM child to 45
seconds. It retains stdout/stderr and process results and reaps every child.
