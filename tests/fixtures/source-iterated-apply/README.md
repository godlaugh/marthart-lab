# Original Map / Symmetry Apply configuration oracle

`source.json` contains 9 inputs × 3 observed routes through the original MathArt 1.7.8 JVM classes. `input.json` preserves the complete input documents. `oracle.c` is the JNI harness; no original binaries or decompiled classes are distributed here.

The routes are:

1. Input JSON → original runtime config → original Mobject initial seed.
2. Original `ProjectState.fromJson(input)` → `toJson()` → new original runtime config/Mobject.
3. `toJson()` on the same unchanged ProjectState → another new runtime config/Mobject.

Route 2 represents the configuration boundary used by Apply. Route 3 tests the repeated same-value boundary. The harness does **not** invoke `MathArtSession.applyChanges`, GUI, GL initialization, main, or rendering. Correspondence to Apply is independently established by bytecode: `MathArtSession.applyChanges` synchronizes timeline at PC73/76, calls `project.toJson` at83, then `bridge.updateConfig` at145. There is no equality guard. `MathArt.reloadConfig` stores JSON37 and schedules INITIALIZING128. Explicit InspectorHeader Apply clears focus4 then calls applyChanges8; its enabled condition is EDIT permission, not dirty state.

`parameters` / `parameterOrder` describe the runtime Map config or Symmetry Mobject parameter map. `editorParameters` / `editorParameterOrder` describe the actual ProjectState SnapshotStateMap and are only present in routes 2/3. They are intentionally separate:

- Absent or empty editor parameters stay empty in **both families**, even when runtime construction injects defaults.
- Standard Symmetry editor `delta_power=2.25` remains 2.25; runtime construction uses 2.0.
- Map whitespace equations are trimmed through ProjectState; the raw equation and seed change.
- Symmetry explicit standard defaults may change runtime parameter iteration order through ProjectState export and consequently change the seed.
- Map absent parameters can construct directly with injected defaults but fail after ProjectState export supplies an empty parameter object. The original exception is retained; it is not replaced by a synthetic success expectation.

Values use original `Double.toString` decimal strings. Seeds are signed Java long strings, never JavaScript numbers. Order arrays must be preserved. JSON object order alone is not the order contract. The full repeated exports are omitted; `rawOracleOutputSha256` identifies the privately retained full output, while source/JVM/harness/input SHA-256 values bind the fixture's provenance.

## Reproduction

Requires the authorized original MathArt bundle, its matching bundled JVM/JARs, a C compiler, and JNI headers already available locally. These are not installed by this fixture.

Compile `oracle.c` with the existing JNI header include directory and platform include directory, e.g. on macOS:

```sh
cc -O0 -I "$JNI_HEADERS" -I "$JNI_HEADERS/darwin" oracle.c -o /tmp/mathart-apply-oracle
```

Invoke with exactly three arguments: absolute `libjvm.dylib` path, explicit colon-separated paths to all bundled `Contents/app/*.jar`, and absolute `input.json` path. Use a fresh JVM process. The harness requests headless mode and a 256 MiB Java heap; Map/Symmetry Mobject constructors receive a null PApplet and no graphics methods are called.

Standard output may contain original diagnostics before `REA_ORACLE_JSON`. Parse the JSON after that marker. To obtain the compact case records in `source.json`, remove only each stage's `export` property; retain all other returned fields. The input IDs pair records with original documents. `oracle.c` has no production TypeScript dependencies or reimplemented seed algorithm. A fixture comparison should test the production boundary against these facts, not rewrite these expected values after a mismatch.

Original artifact SHA-256: `a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018`.
