# Source power reference fixture

`native.json` was produced on 2026-10-22 by `ReferenceProbe.java`, executing the shipped MathArt 1.7.8 `PerturbationReferenceOrbitService.buildOrbit` on Temurin 21.0.7. Six power/variant combinations retain every packed Float32 bit across 12 reference states. This is real original JVM method execution, not original GL/UI framebuffer validation. The probe does not start the application or access settings, licenses, policy services, windows or GL.

- Shipped MathArt JAR SHA256: `a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018`.
- Reference class SHA256: `49e2ff25d087087e00c70bd6d14a24a0d754fe10645d801d0cc14e77289bfd73`.
- Probe SHA256: `458751cf07e75002c6f9a785df58efdb14a46b66ea7d72d0528828b299f0d717`.
- Output SHA256: `e738730e00b32d30e458d3d3b5364d0f2461e82d0cc1d63ea949cccbd7a36484`.

Compile with `javac -proc:none -cp '<original app jars>/*' -d <owned cache> ReferenceProbe.java`, then run `java -cp '<owned cache>:<original app jars>/*' ReferenceProbe`. Source bodies in `fractalNativePowerGlsl.ts` are the original `formula_poly.glsl`; its hash is recorded there. The production raster keeps original DS arithmetic, common full shader loop and same-fragment coloring. Preview pass scheduling remains local; the fixture does not claim original progressive-export equivalence.
