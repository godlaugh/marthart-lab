# Bouncing RGBA8 blend residual

This is a diagnostic replay of four failed pixels from the [full animation
acceptance](../source-bouncing-native-animation/README.md). It does not change the
product or turn a known mismatch into a passing parity assertion.

`NativeBlendDiagnostic.java` runs after the original paused particle draw at
native frames 8, 23, 38 and 53 (updates 6, 21, 36 and 51). It reuses the original
program, uniforms, state texture and VAO in owned scratch attachments. Framebuffer,
texture binding, blending enablement and clear color are restored before the
original scene continues. Original settings, policy and branding are preserved.
The helper does not replace shaders or modify simulation state.

At each frame it:

- Replays all 2,000,000 points in ordered segments, reading the affected pixel
  after each of 176 candidate IDs. The final segment includes all remaining IDs.
- Draws those 176 points individually without blending into RGBA32F, reading the
  exact float fragment output at that pixel. Zero output can mean no coverage.
- Draws particle ID 1973629 alone over five destination green values, 138–142,
  into both RGBA8 and RGBA32F. Other destination channels remain (134,188,198).

The candidate list is specific to this captured preset, camera, size and four
states. It was selected from the complete native state using a conservative
one-pixel distance from the target pixel center. All four states produce the
same candidate list. This is not a general particle-selection algorithm.

## Reproduce

Use the operator-provided app/JDK/owned offscreen launcher described by the
[animation probe](../source-bouncing-native-animation/README.md). From `studio`:

```sh
node tests/fixtures/source-bouncing-native-blend/prepare-native.mjs /new/probe-directory
```

This copies the acceptance probe, adds four diagnostic calls, and stops after
frame 53. It refuses an existing directory or an ambiguous injection boundary.
Compile **both** generated Java files into the native capture directory. Use the
same normal-policy capture lifecycle, file backups, timeout and process-group
reaping as the animation probe; retain `run.json` and both Java source digests.
The executed local wrapper is indexed in `source.json`. No JDK, original app,
launcher or third-party bytecode is shipped with this fixture.

Then run for each frame in `8 23 38 53`:

```sh
node tests/fixtures/source-bouncing-native-blend/browser-probe.mjs /native/capture 8 /new/report-directory
```

The browser probe uses the actual product importer/camera/render program, reads
the native captured state, and reproduces the same scratch draws in headless
Chrome. Access to the GPU class's current context/program is deliberately confined
to this diagnostic file; this is not a supported product API or normal renderer.
Native state identity, source stability, GL errors, page errors and resource
cleanup are recorded. No desktop window is opened.

A zero exit code means the **diagnostic ran**, not pixel parity. The report retains
all differing values; the separate full animation verifier continues to fail.
`source.json` records the executed results and their hashes. Large raw images and
state textures remain outside Git.

## Interpretation limits

The original point fragment floats agree at every candidate in all four states.
The first and only cumulative difference occurs at ID 1973629. Its RGBA32F green
blend result agrees, while the RGBA8 destination differs by one byte. This locates
the observed mismatch in the blend/output conversion boundary on this Apple M2 Max
(GL4 versus ANGLE Metal). It does not establish the driver's internal arithmetic,
FMA use, tie rule, behavior on other devices, or a universal correction.

Native RGBA8 control reads use `glReadPixels(..., GL_FLOAT)`; convert them back to
bytes with rounding for that comparison. Their normalized float readback can
itself differ by one ULP from browser byte/255 conversion. Keep this separate
from the actual RGBA32F readback, and do not count that conversion as a shader
mismatch. The cumulative RGBA8 replay uses byte reads on both sides.
