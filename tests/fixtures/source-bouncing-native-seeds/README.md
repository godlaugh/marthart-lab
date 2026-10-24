# Original Bouncing numerical producer

The probe executes the unmodified MathArt 1.7.8 JSON configuration constructor,
BouncingParticlesMobject constructor and private `uploadInitialState` producer
in the application's original JVM. Its final GL upload is captured by a strict
diagnostic sink. No GPU commands or rendering result are claimed.

The 88 explicit small inputs include 86 successful numerical cases and two
observed unsupported `Math.` formula-prefix cases. Successful cases retain all
17 requested particles and padded texture words. The original method owns the
sampling, random call order, fallback, velocity and Float32 writes; this probe
does not reimplement them. The original constructor runs normally, without
unsafe allocation or private-field replacement.

```sh
python3 scripts/capture-source-bouncing-seeds.py NEW_REFERENCE \
  --app-contents /absolute/path/to/MathArt.app/Contents \
  --java-home /absolute/path/to/existing/jdk \
  --host /absolute/path/to/verified/launch-staged-loader \
  --app-data '/absolute/path/to/original/MathArt/data'
node scripts/verify-source-bouncing-native-seeds.mjs NEW_REFERENCE NEW_COMPARISON
```

Capture pins the original JAR and reviewed host, bounds fixtures to 200 cases
and 1000 particles each, and refuses existing output directories. The original
settings/license/policy files that exist are copied exactly to isolated app
data. Normal license and policy initialization must allow Bouncing RUN; no
license restriction is changed. The compiler and original runtime must already
exist. Only the newly created process group is supervised, with a 90-second
deadline and confirmed exit. No software is installed.

The verifier binds the reference to current input/probe identities, compares
every padded Float32 word and six parsed configuration fields, and specifically
requires the observed `Unknown variable: Math` rejection for the two prefix
cases. It does not accept arbitrary errors as a passing result. Initial failed
classification evidence remains separate from the final verified run.

This covers the listed finite inputs, not the whole expression language,
transcendental edge cases, all configurations, GPU frames or GUI behavior.
Original artifacts and generated runtime outputs remain in ignored `.cache/`.
See the [readable report](../../../docs/source-bouncing-native-seeds.zh-CN.md).
