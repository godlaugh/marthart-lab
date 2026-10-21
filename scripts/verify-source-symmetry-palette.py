"""Run pinned original classes headlessly; no installed Java or GUI required.

Usage: python3 scripts/verify-source-symmetry-palette.py APP JNI_HEADERS NEW_OUTPUT
JNI_HEADERS must already contain jni.h and the platform jni_md.h.
The output is a private evidence directory; this never overwrites the fixture.
"""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time

app, headers, output = map(lambda p: Path(p).resolve(), sys.argv[1:])
root = Path(__file__).resolve().parent.parent
fixture = json.loads((root / "tests/fixtures/symmetry/palette-runtime.json").read_text())
harness = root / "scripts/oracles/source-symmetry-palette.c"
jvm = app / "Contents/runtime/Contents/Home/lib/server/libjvm.dylib"
jars = app / "Contents/app"
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
assert sha(jvm) == fixture["jvmSha256"], "Pinned bundled JVM differs"
for source in fixture["sources"]:
    assert sha(jars / source["name"]) == source["sha256"], source["name"]
assert (headers / "jni.h").is_file() and (headers / "jni_md.h").is_file()
output.mkdir()
inputs = [{k: row[k] for k in ("id", "document", "offset", "cosine") if k in row}
          for row in fixture["cases"]]
input_file = output / "input.json"
input_file.write_text(json.dumps({"cases": inputs}))
binary = output / "oracle"
subprocess.run(["clang", "-O2", "-I", str(headers), str(harness), "-o", str(binary)],
               check=True, timeout=30)
classpath = ":".join(str(p) for p in sorted(jars.glob("*.jar")))
started = time.monotonic()
run = subprocess.run([str(binary), str(jvm), classpath, str(input_file)],
                     capture_output=True, text=True, timeout=20)
elapsed = time.monotonic() - started
(output / "stdout").write_text(run.stdout)
(output / "stderr").write_text(run.stderr)
run.check_returncode()
rows = json.loads(run.stdout.split("REA_ORACLE_JSON\n", 1)[1])
assert len(rows) == len(inputs)
for actual, expected in zip(rows, fixture["cases"]):
    assert actual["id"] == expected["id"]
    assert actual["lut"] == expected["lut"], expected["id"] + " LUT differs"
    assert actual["projectOutput"]["palette"] == expected["expectedPalette"]
report = {"status": "passed", "scope": fixture["scope"], "elapsedSeconds": elapsed,
          "harnessSha256": sha(harness), "binarySha256": sha(binary),
          "jvmSha256": sha(jvm), "sources": fixture["sources"],
          "inputs": inputs, "rows": rows}
(output / "report.json").write_text(json.dumps(report))
print(json.dumps({"status": "passed", "cases": len(rows), "elapsedSeconds": elapsed}))
