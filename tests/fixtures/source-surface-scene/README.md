# Original CPU Surface scene lifecycle

`native.json` is the actual output of the original MathArt 1.7.8 bundled JVM,
not a translated oracle. JAR SHA-256:
`a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018`.
It retains artifact paths/digests, class hashes, input/harness/runner hashes,
compile/process records, stdout hashes and two identical executions.

Ten original JSON projects run 133 updates per execution: point and mesh
parameter starts/stops, point → mesh → point replacement, gradual transitions
with pauses, zero-duration start, empty mesh queue, parameter clip, signed scene
time and initial pauses in both modes. Each scene executes original JSON config
parsing, CPU constructors, queue setup, `Scene.update`, parameter actions,
camera updates and mode replacement. The original live object and initial bound
object are recorded separately. Finite double parameters retain binary64 bits.

The harness constructs actual PApplet/PGraphics but never calls Scene.render.
It sets render mode, explicit renderStep and independent PApplet.frameRate to
make the original updates reproducible. CPU particles are real, not allocated
placeholder arrays. The base PGraphics shader warning remains in local stderr;
this fixture proves no shader, native framebuffer, GUI, interactive wall-clock,
encoding or full application lifecycle behavior. The original transition alpha
is Float32; the local public presentation frame carries its rounded draw byte.

`source-surface-scene-clock.test.ts` uses the production JSON import and retained
ordinary scene queue with the selected Surface producer. It compares scene
time, raw dt, queue position/completion, camera/rates, object time, CPU first
position and replacement mode/identity. Geometry and scalar Float32 comparisons
are exact. Mesh geometry's first vertex equals the observed first native
particle for these zero-speed `x=a+u,y=v,z=0` projects; this is not a comparison
of complete native mesh rendering. Remaining-duration and initial-object double
values are retained observations, not all independently asserted.

Reproduce on an Apple Silicon Mac with the existing original app and JNI headers:

```sh
python3 scripts/source-surface-scene/run.py \
  --app /absolute/path/MathArt.app \
  --jni-include /absolute/path/existing-jni-headers \
  --output /absolute/path/new-evidence-directory
```

No dependency installation. A differing original JAR digest is rejected; the
output directory must be new. Each owned JVM process has a 45-second timeout
with process-group cleanup and direct-child reaping. Local run evidence:
`.cache/surface-scene-native-final/`.
