# Original JVM viewport samples

`navigation-source.json` records direct original MathArt 1.7.8 methods running on synthetic JNI objects, without constructors, application main, rendering thread or a window. It is not an original whole-window rendering comparison. The fixture includes artifact/runtime/harness digests and the exact Float32 bit ordering. `navigation-oracle.c` is the unchanged executed harness; no original binary is committed.

The harness takes the original bundled `libjvm.dylib` path and its application JAR classpath as two arguments. Compile with the installed JNI headers (including their Darwin subdirectory), then invoke with that explicitly selected bundle. The fixture wrapper adds provenance, readable input fields and operation descriptions to the harness's raw output; it does not derive numeric expected values from the implementation.

The local run's complete classpath, artifact hashes, stdout and stderr are retained at `.cache/source-map-lifecycle/viewport/navigation-oracle-manifest.json`. Original methods used: `MathArt.mousePressed`, `mouseDragged`, `mouseWheel`, `togglePause`, `GenericMapAttractorScene.handlePausedViewportDrag`, and flag-only `PApplet.redraw/noLoop/loop`. The original wall-clock `lastTime` is intentionally omitted because it is nondeterministic.

Ten numeric cases are regression goldens (three drag/wheel/resume, six wheel counts, one degenerate Map viewport). Two additional original guard cases establish that running/pick mode does not navigate or request redraw. Browser wheel/pointer mapping, bounded input buffering, real GPU state retention and complete App interactions are verified separately, not inferred from these synthetic objects.
