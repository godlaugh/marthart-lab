# Original Fractal mapping and configuration oracle

`source.json` retains 17 cases / 87 observed original JVM states. `oracle.c`
executes the original FormulaParamSet, FormulaDomainService, FormulaRuntimeMapper,
ordinary and formula setters, FractalParamAnimation callbacks and
JsonFormulaParamBinder using an AllocObject mobject with explicit numerical
fields. It does not call the mobject constructor, Scene, GUI, renderer or GPU.
The initial values (power 7, bailout 9, Julia [.125,-.25], legacy slots
[11,12,13,14]) are deliberately distinct probe inputs, not product defaults.

`configuration.json` retains 16 additional original JsonComplexFractalConfig
constructor results with a null PApplet and a real Processing JSONObject. This
executes its configuration parsers and binder without creating a scene or GUI.
The two large-integer cases prove that Java Long and Double numeric token kinds
produce different intValue results. Their original token spellings are retained
in `config-inputs.json`; an already parsed JavaScript number loses this fact, so
the local parser explicitly declines this ambiguous input instead of guessing.

All observations, input/harness/raw-output digests, artifact identity and measured
execution costs are retained in the JSON. The tests need no proprietary binary.

Cases cover all 12 standard formula metadata sets, sparse maps versus getter
fallbacks, dynamic-slot overwrite order, lambda/julia_seed priority, ordinary
setter/animation writes followed by registry remapping, source FLOAT narrowing,
native bailout floors, dense binder defaults, range clamping, expression and
complex-component conversion, and the initial parser's ordered legacy fields.
Initial applyConfig factory behavior also has focused source-derived tests; the
config oracle reads config getters and does not claim full mobject applyConfig
or host-frame/render execution. Full Scene/Manager integration is separately
verified by the scene owner.

With already-provided original JARs/JVM and JNI headers:

```sh
clang -I "$JNI_HEADERS" oracle.c -o /tmp/fractal-mapping-oracle
/tmp/fractal-mapping-oracle "$BUNDLED_LIBJVM" "$ORIGINAL_JAR_CLASSPATH" inputs.json
clang -I "$JNI_HEADERS" config-oracle.c -o /tmp/fractal-config-oracle
/tmp/fractal-config-oracle "$BUNDLED_LIBJVM" "$ORIGINAL_JAR_CLASSPATH" config-inputs.json
```

Read JSON after `REA_MAPPING_ORACLE_JSON` or
`REA_FORMULA_CONFIG_ORACLE_JSON`. Bound each process to 45 seconds. Both harnesses
set `-Djava.awt.headless=true` and `-Xmx256m`. These are focused numerical probes;
custom formula registration, nonfinite live animation state, arbitrary
parameter types and GUI/GPU pixels are outside their coverage.
