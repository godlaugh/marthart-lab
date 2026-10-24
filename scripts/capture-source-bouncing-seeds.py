"""Run the original Bouncing numerical producer against fixed small fixtures.

Requires existing original app, JDK and verified host. Copies only existing
normal settings/license/policy files to an isolated app-data directory. No GUI,
GL rendering, license alteration, bytecode modification or software installation.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / 'tests/fixtures/source-bouncing-native-seeds'
JAR_SHA = 'a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018'
HOST_SHA = 'c8c08517e92499bb45762a1fe2ed9ffc5f08c357aff11bcd8f03ab860c6d057e'
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    for name in ['app-contents', 'java-home', 'host', 'app-data']:
        parser.add_argument('--' + name, type=Path, required=True)
    args = parser.parse_args()
    app = (args.app_contents / 'app').resolve()
    jdk, host, original_data, out = [p.resolve() for p in [args.java_home, args.host, args.app_data, args.output]]
    jar = app / 'MathArt-1.7.8-b07191b3e97da6fe465555ef6e61a0be.jar'
    if sha(jar) != JAR_SHA or sha(host) != HOST_SHA:
        raise RuntimeError('Original JAR or reviewed host identity changed')
    if not (jdk / 'bin/javac').is_file():
        raise RuntimeError('Existing JDK compiler required')
    if not original_data.is_dir():
        raise RuntimeError('Existing original app data required')
    source_hashes = {name: sha(FIXTURE / name) for name in ['NativeSceneProbe.java', 'inputs.json']}
    cases = json.loads((FIXTURE / 'inputs.json').read_text())
    if not 1 <= len(cases) <= 200 or any(not 1 <= row['raw']['settings']['particle_count'] <= 1000 for row in cases):
        raise RuntimeError('Numerical fixture capacity exceeded')
    out.mkdir(mode=0o700)  # Never overwrite evidence, including failed runs.
    for name in source_hashes:
        shutil.copy2(FIXTURE / name, out / name)
    names = ['scene_access_policies_cache.json', 'license.dat', 'settings/settings.conf']

    def facts(root):
        return {name: {'exists': (root / name).exists(), 'sha256': sha(root / name) if (root / name).exists() else None} for name in names}

    data = out / 'app-data'
    data.mkdir(mode=0o700)
    before = facts(original_data)
    for name in names:
        source, target = original_data / name, data / name
        if source.exists():
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
    if facts(data) != before:
        raise RuntimeError('Original app data changed while copying')
    write = lambda name, value: (out / name).write_text(json.dumps(value, indent=2) + '\n')
    compile_command = [str(jdk / 'bin/javac'), '-proc:none', '-cp', str(app / '*'), '-d', str(out), str(out / 'NativeSceneProbe.java')]
    compiled = subprocess.run(compile_command, capture_output=True, text=True, timeout=30)
    write('compile.json', {'command': compile_command, 'exit': compiled.returncode, 'stdout': compiled.stdout, 'stderr': compiled.stderr})
    if compiled.returncode:
        raise RuntimeError(compiled.stderr)
    classpath = ':'.join(str(p) for p in sorted(app.glob('*.jar'))) + ':' + str(out)
    command = [str(host), str((app / '../runtime/Contents/Home/lib/server/libjvm.dylib').resolve()), classpath, str(out / 'logs'), str(out / 'inputs.json'), str(out), str(data)]
    started = time.monotonic()
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, cwd=app, start_new_session=True,
        env={'PATH': str(jdk / 'bin') + ':/usr/bin:/bin', 'LANG': 'en_US.UTF-8', 'TMPDIR': str(out)})
    timed_out, interrupted = False, None
    try:
        stdout, stderr = process.communicate(timeout=90)
    except BaseException as error:
        timed_out = isinstance(error, subprocess.TimeoutExpired)
        interrupted = None if timed_out else error
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGTERM)
        try:
            stdout, stderr = process.communicate(timeout=3)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            stdout, stderr = process.communicate(timeout=3)
    try:
        os.killpg(process.pid, 0)
        group_exists = True
    except ProcessLookupError:
        group_exists = False
    report = {'scope': 'Original numerical config/constructor/sampler/upload producer; final GL upload is captured by a diagnostic sink, not GPU or scene/window parity. Exact isolated copies of existing normal app data; normal license and policy initialization.',
        'command': command, 'jarPath': str(jar), 'jarSha256': sha(jar), 'hostSha256': sha(host), 'probeSha256': source_hashes['NativeSceneProbe.java'], 'inputSha256': source_hashes['inputs.json'],
        'exit': process.returncode, 'stdout': stdout, 'stderr': stderr, 'seconds': time.monotonic() - started, 'reaped': True, 'processGroupExists': group_exists,
        'timedOut': timed_out, 'interrupted': str(interrupted) if interrupted else None, 'originalFilesBefore': before, 'originalFilesAfter': facts(original_data), 'copiedFilesAfter': facts(data),
        'sourcesStable': all(sha(FIXTURE / name) == digest == sha(out / name) for name, digest in source_hashes.items())}
    report['status'] = 'passed' if process.returncode == 0 and not group_exists and not timed_out and not interrupted and report['sourcesStable'] else 'failed'
    write('run.json', report)
    print(json.dumps({key: report[key] for key in ['status', 'exit', 'seconds', 'reaped', 'processGroupExists', 'timedOut']}), flush=True)
    if interrupted:
        raise interrupted
    if report['status'] != 'passed':
        raise SystemExit(1)


if __name__ == '__main__':
    main()
