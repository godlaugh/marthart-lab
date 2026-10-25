# Independent formula glyph backend

This backend renders mathematical annotation textures with the unmodified
official `org.scilab.forge:jlatexmath:1.0.7` library and a separately supplied
Java 21 runtime. It does not load MathArt or Processing. Source-compatible
formula consumers use this local service. The Apple Silicon 2.0 preview package
now includes a private runtime, library and helper; other entry points still
require explicit configuration.

Build with an explicitly supplied JDK and official upstream JAR:

```sh
node scripts/build-formula-glyph.mjs \
  --java-home /absolute/path/to/jdk/Contents/Home \
  --jar /absolute/path/to/jlatexmath-1.0.7.jar \
  --out /absolute/path/to/new-build-directory
```

The build pins the upstream artifact SHA-256, refuses an existing output
directory, compiles this project's Java source and packages its classes into a
sealed helper JAR. `backend.json` names the explicit runtime and both JARs.
There is no automatic download, system Java installation or MathArt discovery.
Keep these generated assets out of Git.

Build the self-contained local desktop preview with this selection:

```sh
npm run desktop:build:v2 -- --glyph-backend /absolute/path/to/backend.json
```

The desktop build consumes `javaHome` and `jarPath` from that file, recompiles
the current helper source, and runs the selected JDK's `jlink` for `java.desktop`.
It preserves included runtime legal files and the unmodified library's notices,
materializes internal runtime symlinks before packaging, and uses fixed relative
resource names so the application can move. No system Java is installed or
selected at application startup. `MATHART_GLYPH_BACKEND` remains an explicit
runtime override; an invalid selection fails without fallback.

Enable a source-checkout server with the resulting manifest:

```sh
MATHART_GLYPH_BACKEND=/absolute/path/to/new-build-directory/backend.json \
  node server/index.mjs
```

`GET /api/formula-glyph/health` reports availability, renderer identity, fixed
font size 50 and `straight-rgba8` format. `POST /api/formula-glyph` accepts only
`{"latex":"x^2+y^2","color":"#ffffff"}`. A successful response is row-major
RGBA bytes with `x-glyph-width`, `x-glyph-height`, `x-glyph-font-size`,
`x-glyph-format` and `x-glyph-renderer` headers. It preserves transparent padding;
occupied RGB equals the selected color, and transparent RGB is zero.

The Java boundary owns the mathematical command/environment allowlist. File and
image loading, macro definitions, dynamic command construction and TeX character
rewriting are unsupported. Unsupported syntax is an explicit error, not a
silent MathJax fallback. This interface does not advertise complete LaTeX.

Input is limited to 8,192 UTF-16 units and 64 nested groups; output to 16 million
pixels and 16,384 per dimension. Requests run in separate JVMs with a 256 MiB heap
limit and a 10-second default deadline. The owner retains every child until its
`close` event, including after cancellation, deadline and service shutdown. A
full concurrency slot returns a capacity error; requests are not queued.

When supplied, `helperJarSha256` must match before execution. Renderer identity covers the selected runtime files/configuration, helper JAR,
upstream JAR and host identity. Execution uses canonical paths, rejects ambiguous
classpath separators and checks runtime layout/file freshness before spawning.
The worker receives a minimal environment. No ambient environment snapshot is
written. This is not an OS sandbox or proof against every upstream parser bug.

Reproduce real-runtime and HTTP verification against recorded native fixtures:

```sh
node scripts/verify-formula-glyph.mjs \
  --backend /absolute/path/to/new-build-directory/backend.json \
  --reference /absolute/path/to/studio/tests/fixtures/source-formula-glyph-native.json \
  --out /absolute/path/to/new-verification-directory
```

The fixture includes original-artifact provenance and observed full-RGBA hashes.
The verification requires real dependencies and fails when unavailable; it does
not turn missing Java into a passing skip. It also exercises unsupported inputs,
malformed responses, capacity, live cancellation, deadline, close, file freshness,
canonical paths and real local HTTP transfer/disconnect/shutdown.

The upstream library and fonts have their own license notices. Obtain assets from
the [official JLaTeXMath project](https://github.com/opencollab/jlatexmath) and
[Eclipse Temurin](https://github.com/adoptium/temurin21-binaries); retain their
complete license/source materials when preparing a distribution. The local 2.0
preview includes the runtime's `legal/` files, upstream JAR notices, dependency
links and helper source; it is ad hoc signed, not a notarized public release.
See the [packaged validation report](../../docs/native-v2-glyph-packaging-validation.zh-CN.md)
and the earlier [service report](../../docs/source-formula-glyph-service-validation.zh-CN.md).
