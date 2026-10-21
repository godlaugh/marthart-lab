# Original Fractal gradient animator oracle

`source.json` contains 19 finite cases / 266 snapshots obtained by calling shipped
MathArt 1.7.8 classes in its bundled JVM, repeated with identical decoded results.
Provenance includes JAR, JVM, individual classes, C harness and raw-output SHA-256.
No proprietary binaries are included, and tests need not execute the original app.

Cases 0–15 cover HUE_ROTATE, OFFSET_CYCLE, CROSS_FADE and PALETTE_MORPH, each with
all four affectInside/affectOutside combinations and RGB interpolation. Cases
16–18 cover PALETTE_MORPH with both flags and LINEAR, OKLAB, OKLCH interpolation.
Every case uses three deliberately distinct initial offsets, passed through the
original FractalMobject.setGradientOffsets: .123456789, -.234567891, 1.345678912.
The actual target stores them as Float32; original GradientAnimator.start reads
those Float32 values widened to double as its three independent baselines.

Each case performs this explicit bounded sequence:

1. Snapshot inactive original GradientAnimator and initialized target.
2. Original StartGradientAnimation (duration 1F, LINEAR easing) update 0F, then .25F.
3. Original GradientAnimator.update(.125F).
4. Start animation update .75F (finish, speed scale forced to 1).
5. Animator update 2.75F (wrap), 0F and -.25F.
6. Original StopGradientAnimation (duration .5F, LINEAR easing) update .125F.
7. Animator update .2F; stop animation update .375F (finish).
8. Stopped animator update .5F; a new idle stop animation update .25F.
9. Direct animator.start(config), recapturing current target offsets.

All cases use speed 137.25 double. `samples[].frame` is the actual original
GradientRuntimeState.buildFrame double triple; `applied` is the actual target's
Float32 triple. `base`, progress, scale and speed are original fields. Array order
is always palette, inside, outside. `animation` records original float runtime
and start/finish flags where relevant. Every floating value includes exact bits.
Before each operation the harness clears only gradientDirty, allowing `dirty` to
show whether this operation changed an applied Float32 offset; false does not
mean no callback occurred. buildFrame itself is read-only.

The harness uses JNI AllocObject for FractalMobject to bypass graphics setup, but
uses original numerical setters, GradientTarget callbacks, actual GradientAnimator
and RuntimeState constructors, and original start/stop animation/update methods.
It executes no copied formulas, PApplet, SceneManager, render, shader, GUI or encoder.
Consequently this fixture proves the explicit numerical lifecycle, not native
frame-queue scheduling or palette pixels. Flags false/false are intentionally
covered even though a higher-level importer may omit such an action.

Reproduction with operator-provided artifacts and JNI headers:

```sh
clang -I "$JNI_HEADERS" oracle.c -o /tmp/fractal-gradient-oracle
/tmp/fractal-gradient-oracle "$BUNDLED_LIBJVM" "$ORIGINAL_JAR_CLASSPATH" > /tmp/fractal-gradient-output.txt
```

Classpath includes all original packaged JARs. Parse the array after the marker
`REA_ORACLE_JSON`. Executed runs used a 45-second timeout and -Xmx256m. Java and
JavaScript transcendental last-bit equality should not be assumed; final Float32
application and arithmetic order are separately observable in this fixture.
