"""Re-run original parameter builder/children/registry/scalar target via bundled JVM.
Usage: python3 scripts/verify-source-symmetry-parameters.py APP JNI_HEADERS NEW_OUTPUT
No Java installation, original app main, graphics initialization or native window.
"""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time
import zipfile

app, headers, output = (Path(p).resolve() for p in sys.argv[1:])
root = Path(__file__).resolve().parent.parent
fixture_path = root / 'tests/fixtures/symmetry/parameter-runtime.json'
fixture = json.loads(fixture_path.read_text())
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
jvm = app / 'Contents/runtime/Contents/Home/lib/server/libjvm.dylib'
jars = sorted((app / 'Contents/app').glob('*.jar'))
sources = [{'name': p.name, 'sha256': sha(p)} for p in jars]
if sha(jvm) != fixture['jvmSha256'] or sources != fixture['sources']:
    raise ValueError('Original bundled runtime identity differs')
harness = root / 'scripts/oracles/source-symmetry-parameters.c'
if sha(harness) != fixture['harnessSha256']:
    raise ValueError('Oracle harness identity differs from fixture')
application = [p for p in jars if p.name.startswith('MathArt-')]
if len(application) != 1:
    raise ValueError('Ambiguous application JAR')
with zipfile.ZipFile(application[0]) as jar:
    for row in fixture['classes']:
        if hashlib.sha256(jar.read(row['entry'])).hexdigest() != row['sha256']:
            raise ValueError('Original class identity differs: ' + row['entry'])
if not all((headers / name).is_file() for name in ['jni.h', 'jni_md.h']):
    raise ValueError('Existing JNI headers required')
output.mkdir()
inputs = [{k: v for k, v in row.items() if k not in ['initial', 'frames']} for row in fixture['cases']]
(output / 'input.json').write_text(json.dumps({'cases': inputs}))
binary = output / 'oracle'
subprocess.run(['clang', '-O2', '-Wall', '-Wextra', '-Werror', '-I', str(headers),
                str(harness), '-o', str(binary)], check=True, timeout=30)
started = time.monotonic()
run = subprocess.run([str(binary), str(jvm), ':'.join(map(str, jars)), str(output / 'input.json')],
                     capture_output=True, text=True, timeout=20)
(output / 'stdout').write_text(run.stdout)
(output / 'stderr').write_text(run.stderr)
run.check_returncode()
rows = json.loads(run.stdout.split('REA_ORACLE_JSON\n', 1)[1])
expected = [{k: row[k] for k in ['id', 'initial', 'frames']} for row in fixture['cases']]
if rows != expected:
    raise ValueError('Native parameter definitions/state differ from recorded fixture')
report = {'status': 'passed', 'scope': fixture['scope'], 'elapsedSeconds': time.monotonic()-started,
          'fixtureSha256': sha(fixture_path), 'harnessSha256': sha(harness),
          'binarySha256': sha(binary), 'jvmSha256': sha(jvm), 'sources': sources,
          'classes': fixture['classes'], 'cases': len(rows),
          'frames': sum(len(row['frames']) for row in rows), 'rows': rows}
(output / 'report.json').write_text(json.dumps(report))
print(json.dumps({k: report[k] for k in ['status', 'cases', 'frames', 'elapsedSeconds']}))
