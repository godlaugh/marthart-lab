"""Run original animation callbacks/target/LUT through the bundled JVM.
Usage: python3 scripts/verify-source-symmetry-gradient.py APP JNI_HEADERS NEW_OUTPUT
"""
import hashlib
import json
from pathlib import Path
import struct
import subprocess
import sys
import time

app, headers, output = (Path(p).resolve() for p in sys.argv[1:])
root = Path(__file__).resolve().parent.parent
fixture = json.loads((root / 'tests/fixtures/symmetry/gradient-runtime.json').read_text())
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
jvm = app / 'Contents/runtime/Contents/Home/lib/server/libjvm.dylib'
jars = sorted((app / 'Contents/app').glob('*.jar'))
sources = [{'name': p.name, 'sha256': sha(p)} for p in jars]
if sha(jvm) != fixture['jvmSha256'] or sources != fixture['sources']:
    raise ValueError('Original bundled runtime identity differs')
if not all((headers / name).is_file() for name in ['jni.h', 'jni_md.h']):
    raise ValueError('Existing JNI headers required')
output.mkdir()
inputs = [{k: v for k, v in row.items() if k != 'frames'} for row in fixture['cases']]
(output / 'input.json').write_text(json.dumps({'cases': inputs}))
harness = root / 'scripts/oracles/source-symmetry-palette.c'
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
if len(rows) != len(inputs):
    raise ValueError('Native case coverage differs')
for actual, expected in zip(rows, fixture['cases']):
    if actual['id'] != expected['id'] or len(actual['frames']) != len(expected['frames']):
        raise ValueError('Native frame identity/coverage differs')
    for frame, golden in zip(actual['frames'], expected['frames']):
        compact = {k: v for k, v in frame.items() if k != 'lut'}
        compact['lutSha256'] = hashlib.sha256(struct.pack('<3072f', *frame['lut'])).hexdigest()
        if compact != golden:
            raise ValueError('Native frame differs: ' + expected['id'])
report = {'status': 'passed', 'scope': fixture['scope'], 'elapsedSeconds': time.monotonic()-started,
          'harnessSha256': sha(harness), 'binarySha256': sha(binary), 'jvmSha256': sha(jvm),
          'sources': sources, 'rows': rows}
(output / 'report.json').write_text(json.dumps(report))
print(json.dumps({k: report[k] for k in ['status', 'elapsedSeconds']}))
