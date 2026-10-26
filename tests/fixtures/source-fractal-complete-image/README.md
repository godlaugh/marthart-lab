# Fractal full-scene formula reference

Captured from authorized, operator-provided MathArt 1.7.8 on this Apple Silicon Mac. No original binaries, image assets or pixel buffers are included in this fixture. `reference.json` pins the retained local images/readbacks and exact input JSON; `NativeSceneProbe.java` is the diagnostic host source.

The original license and scene-access services initialized normally. VIEW/RUN/EXPORT were allowed; FREE watermark rendering remained enabled. The original policy cache refreshed normally and its previous contents were backed up; license/settings digests did not change. Both runs exited 0 and their owned process groups were empty. AWT Window objects remained zero; this is not an enumeration of every possible JOGL surface.

The host performed seven paused original `Scene.runFrame` calls at logical250×300/density2 with primary logical405×486. Frame3 was stable. Its forwarding GL proxy reads after each original draw without changing drawing arguments. It restores read framebuffer/read-buffer and active texture bindings. Draw2 is the mathematical buffer; draw3 adds the original TexMobject; draw4–6 add the original watermark. Final draw6 equals the complete original raw PNG. Instrumented default raw-frame3 PNG is byte-identical to the earlier uninstrumented formula-enabled capture in `.cache/fractal-full-scene-iq92hrg2/`.

`default` changes only main_equation.enabled. `clear` also changes position/scale/color and supplies ignored main latex and root formulas. This exercises generated text and source import semantics without obscuring the formula behind the watermark.

The production comparison uses the public Generator's fresh recording frame3 at60FPS and the same mathematical viewport plus explicit primary height486. The source timeline only waits; no parameter motion affects these images. Original paused Scene time and local fixed recording time are distinct, so this comparison establishes these static images rather than complete timing equivalence.

Reproduce the comparison with existing configured native/glyph backends:

```sh
node scripts/verify-source-fractal-complete-image.mjs /absolute/native-capture-root /absolute/passed-native-production-report.json /absolute/glyph-backend.json /absolute/new-output-directory
```

The native production report supplies a pinned independently built renderer executable. The verifier rechecks its source pin, source input, probe/launcher, original JAR, full original pixel buffers and final cleanup. Original capture itself requires the operator-provided original package, independent Java compiler and an authorized normal-policy runtime; the local runner is retained with its execution report.
