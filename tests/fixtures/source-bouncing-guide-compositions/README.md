# Guide Bouncing compositions

`cases.json` owns three explicit recipes derived from the pinned `bouncing2`
project. Guide rows 177/179/181 specify Rose, Hexagon and Ellipse examples. The
recipe records every override and the choices for unspecified fields. These are
derived guide inputs, not unmodified packaged presets. The guide fetch manifest
and extracted content hashes are retained in `source.json`.

The existing capture command accepts `guide-rose`, `guide-hexagon` or
`guide-ellipse` in **animation mode only**:

```sh
python3 scripts/capture-source-bouncing-original.py guide-rose NEW_REFERENCE \
  --app-contents /absolute/path/to/MathArt.app/Contents \
  --java-home /absolute/path/to/existing/jdk/Contents/Home \
  --host /absolute/path/to/verified/launch-staged-loader \
  --app-data '/absolute/path/to/original/MathArt/app-data'

MATHART_SOURCE_RENDERER_BACKEND=/absolute/path/to/backend.json \
MATHART_BOUNCING_STATE=product MATHART_VERIFY_DRIVER=playwright \
  node scripts/verify-source-bouncing-native-animation.mjs NEW_REFERENCE NEW_PRODUCT_REPORT

node scripts/verify-source-bouncing-native-state.mjs NEW_STATE_REPORT NEW_REFERENCE
```

The capture uses the original bundled JVM and normal license/policy/branding.
It compiles the existing diagnostic probe with the provided JDK, preserves
settings/license state, backs up policy metadata, and reaps its owned process
group. No dependencies are installed. New output directories are required.

The raw project, actual probe-input wrapper, recipe digest and original base
identity are bound in the manifest. Consumers distinguish the two input kinds
and reject modifications to the recipe, input, particle count or update stride.
The supplied probe now accepts either a raw pinned project (one update per
sample) or the explicit guide wrapper (ten updates per sample). Its new identity
is recorded; old captures remain historical evidence and are not silently
accepted as runs of the new probe. A fresh packaged-2M regression confirms the
default one-update behavior.

Every guide case executes **all 600 original updates** and captures 62 complete
artwork samples, including two initial stable frames. State checkpoints are
0,10,20,50,60,100,210,300,360,510,600. Product simulation executes every step too;
sampling only affects readback frequency. The component verifier consumes the
validated original update count instead of assuming one update per sample.

`source.json` indexes the actual captures, product and component comparisons,
input guards, reflection-state coverage, source freshness and sampled costs.
Large original images/state textures and runnable artifacts stay in `.cache/`.
No original GUI action or complete-video claim is made. See the
[readable acceptance report](../../../docs/source-bouncing-guide-compositions.zh-CN.md).
