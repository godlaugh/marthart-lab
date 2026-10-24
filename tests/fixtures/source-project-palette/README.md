# Original project palette boundary

`oracle.json` contains 84 actual MathArt 1.7.8 `ProjectState` executions: 12 scene types × absent, empty, singleton, raw strings, null, object and mixed-array palettes. 48 successful imports/exports and 36 expected type errors. Each state starts with a sentinel palette so omission is verified to replace previous state. Failed native imports retain the observed partial list; the product deliberately validates before committing any state.

The headless probe calls only the public constructor, `fromJson`, `toJson` and getters. It uses existing Temurin 21.0.7, not the application's bundled JVM. No application entry point, bridge, renderer, network or GUI is launched. Before/after AWT window counts are zero. This does not establish original GUI events, pixel parity or persistence to disk.

`source.json` binds the original JAR/class identities, capture harness, original input and raw report, independently reviewed finalization, and this fixture. Full private evidence is retained in `.cache/source-project-palette-20261024/`; the harness is `ProjectPaletteProbe.java`, orchestration is `capture.mjs`. Target and compiler exited 0, and owned process groups were confirmed empty.

The initial post-run audit failed because its initializer list only allowed `ui/state` classes. Fractal import also initializes the FormulaRegistry metadata table. A separate bytecode audit closed all 18 concrete formula classes (plus their generated metadata lambdas) to in-memory collections, builders, enums and strings. `run/validation.json` finalizes the existing output without rerunning the target; `run/report.json` preserves the first audit failure.

The independent static evidence is in `.cache/common-gradient-followup-audit-20261024/project-palette-boundary-audit.md`: `fromJson` PC 10965–11114, `toJson` PC 7826–7904. Runtime defaults and Appearance's later padding/count behavior are separate boundaries.

Run the public import and canonical-save regression with:

```sh
npm test -- tests/source-project-palette.test.ts
```

Reading fixtures does not execute the original artifact. Local preparation limits (65,536 strings and 1 MiB of UTF-16 text) are explicit product resource bounds, not native format limits. Downstream scene constraints still apply, including Surface's empty-palette rejection and Domain's narrower color-text parser.
