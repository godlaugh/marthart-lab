"""Run the unchanged diagnostic probe against one pinned original Bouncing preset.

Requires an operator-supplied original app, JDK and previously verified macOS
staged-loader host. No engine/JDK installation, bytecode patch or policy override.
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
import zipfile

PINS = json.loads((Path(__file__).resolve().parents[1] / 'tests/fixtures/source-bouncing-native-animation/presets.json').read_text())
JAR_SHA = 'a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018'
HOST_SHA = 'c8c08517e92499bb45762a1fe2ed9ffc5f08c357aff11bcd8f03ab860c6d057e'
PROBE_SHA = '6d3a5f36b76beb5f8cfd7d3a0b86ef37fca3b4bb63ff344540748bad77013e1d'
sha = lambda data: hashlib.sha256(data).hexdigest()

def require(condition, message):
    if not condition:
        raise RuntimeError(message)

def write(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('preset', choices=PINS)
    parser.add_argument('output', type=Path)
    for name in ['app-contents', 'java-home', 'host', 'app-data']:
        parser.add_argument('--' + name, type=Path, required=True)
    args = parser.parse_args()
    app = (args.app_contents / 'app').resolve()
    jdk, host, data, out = [p.resolve() for p in [args.java_home, args.host, args.app_data, args.output]]
    preset = PINS[args.preset]
    member, count, source_sha = [preset[k] for k in ['member', 'particleCount', 'sourceSha256']]
    jar = app / 'MathArt-1.7.8-b07191b3e97da6fe465555ef6e61a0be.jar'
    source = app / 'resources' / member
    probe = Path(__file__).resolve().parents[1] / 'tests/fixtures/source-bouncing-native-animation/NativeSceneProbe.java'
    require(sha(jar.read_bytes()) == JAR_SHA, 'Original JAR changed')
    require(sha(host.read_bytes()) == HOST_SHA, 'Offscreen host changed; review before running')
    require(sha(probe.read_bytes()) == PROBE_SHA, 'Diagnostic probe changed; review before running')
    with zipfile.ZipFile(jar) as archive:
        original = archive.read(member)
    require(sha(original) == source_sha and original == source.read_bytes(), 'Original preset identity mismatch')
    require(json.loads(original)['settings']['particle_count'] == count, 'Original particle count mismatch')
    # Eleven complete padded states plus ten active/paused pairs, images and
    # intermediate files; fail before running when the output cannot fit.
    required_bytes = 24 * ((int(count ** .5) + 1) ** 2 * 16) + 512 * 1024 ** 2
    require(shutil.disk_usage(out.parent).free >= required_bytes, 'Insufficient space for complete reference')
    out.mkdir()  # Never overwrite an earlier run.
    shutil.copy2(probe, out / probe.name)
    command = [str(jdk / 'bin/javac'), '-proc:none', '-cp', str(app / '*'), '-d', str(out), str(out / probe.name)]
    compiled = subprocess.run(command, capture_output=True, text=True, timeout=30)
    write(out / 'compile.json', {'command': command, 'exit': compiled.returncode, 'stdout': compiled.stdout, 'stderr': compiled.stderr})
    if compiled.returncode:
        raise RuntimeError(compiled.stderr)
    names = ['scene_access_policies_cache.json', 'license.dat', 'settings/settings.conf']
    def facts():
        return {name: {'exists': (data / name).exists(), 'sha256': sha((data / name).read_bytes()) if (data / name).exists() else None} for name in names}
    before = facts()
    policy = data / names[0]
    if policy.exists():
        shutil.copy2(policy, out / 'original-policy-cache.backup.json')
    write(out / 'user-files-before.json', before)
    classpath = ':'.join(str(p) for p in sorted(app.glob('*.jar'))) + ':' + str(out)
    command = [str(host), str((app / '../runtime/Contents/Home/lib/server/libjvm.dylib').resolve()), classpath, str(out / 'logs'), str(source), str(out), str(data)]
    started = time.monotonic()
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True, cwd=app,
        env={'PATH': str(jdk / 'bin') + ':/usr/bin:/bin', 'LANG': 'en_US.UTF-8', 'TMPDIR': str(out)})
    timed_out = False
    try:
        stdout, stderr = process.communicate(timeout=60)
    except BaseException as error:
        # The Popen child is still held and has not been reaped. Signal only
        # this newly created process group, never search for a similarly named app.
        timed_out = isinstance(error, subprocess.TimeoutExpired)
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGTERM)
        try:
            stdout, stderr = process.communicate(timeout=3)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            stdout, stderr = process.communicate(timeout=3)
        if not timed_out:
            raise
    try:
        os.killpg(process.pid, 0)
        group_exists = True
    except ProcessLookupError:
        group_exists = False
    report = {'case': args.preset, 'particleCount': count, 'sourceMember': member,
        'source': str(source), 'sourceSha256': source_sha, 'jarSha256': JAR_SHA, 'hostSha256': HOST_SHA, 'probeSha256': PROBE_SHA,
        'scope': 'Original methods and unmodified preset; three initial paused frames and 60 fixed-60-fps updates, each followed by a paused redraw. Eleven complete state readbacks, full 500x600 artwork before normal branding, normal license/policy initialization, no AWT windows.',
        'command': command, 'exit': process.returncode, 'stdout': stdout, 'stderr': stderr, 'seconds': time.monotonic() - started,
        'pid': process.pid, 'reaped': True, 'processGroupExists': group_exists, 'timedOut': timed_out, 'userFilesBefore': before, 'userFilesAfter': facts()}
    write(out / 'run.json', report)
    print(json.dumps({'case': args.preset, 'exit': report['exit'], 'seconds': report['seconds'], 'timedOut': timed_out, 'reaped': True, 'processGroupExists': group_exists, 'stderr': stderr, 'report': str(out / 'run.json')}), flush=True)
    if process.returncode or timed_out or group_exists:
        raise SystemExit(1)

if __name__ == '__main__':
    main()
