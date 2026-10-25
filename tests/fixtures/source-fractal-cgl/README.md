# Fixed Mandelbrot CGL reference

`mandelbrot.json` preserves the original MathArt 1.7.8 resource bytes. The two deep views apply only the explicit `fractalChanges` in `reference.json`. The source file, original diagnostic inputs and mathematical RGBA outputs are pinned by SHA-256. Original binaries and large captures are not committed.

Run from `studio` on macOS with the locked Node dependencies, existing Chrome and Apple command-line compiler:

```sh
node scripts/verify-source-fractal-cgl.mjs
```

The verifier requires no original app or private `.cache` files. It imports each JSON through production code, advances the real display owner four times, and samples one pixel per display to initialize the production shader and texture owners. It reads **all elements of every active uniform**, plus the owner's actual reference orbit and gradient bytes. A separate windowless CGL process renders the full 500×600 raster using the current production shader, changing only GLSL version and precision declarations. The native oracle creates four MRT attachments; attachment 2 is RGBA8, exactly as in the production shader contract. It does not change DS arithmetic or inject reference values.

Each full bottom-up mathematical RGBA output must match its original reference digest, and production reference-orbit/LUT bytes must match their recorded digests. The retained original independent GL outputs were calibrated against the original Scene's central mathematical region. This is not whole-window, watermark, formula-overlay, animation, other-formula, cross-device, or integrated native-backend acceptance. A different device must report any mismatch, not relax the expected hash.

The fresh verification directory records inputs, actual uniforms, typed textures, generated shaders, raw output, device, source digests, subprocess exits and cleanup. Each native run has a 45-second deadline. `nativeCpuSeconds` and `nativePeakRssBytes` describe only that native child; total wall time includes capture, compilation and cleanup. Browser/process-family CPU and peak memory are unmeasured.
