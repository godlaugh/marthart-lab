"""Run a pinned diagnostic probe against one pinned original Bouncing preset.

Requires an operator-supplied original app, JDK and previously verified macOS
staged-loader host. No engine/JDK installation, bytecode patch or policy override.
"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import signal
import subprocess
import struct
import time
import zipfile

PINS = json.loads((Path(__file__).resolve().parents[1] / 'tests/fixtures/source-bouncing-native-animation/presets.json').read_text())
JAR_SHA = 'a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018'
HOST_SHA = 'c8c08517e92499bb45762a1fe2ed9ffc5f08c357aff11bcd8f03ab860c6d057e'
PROBE_SHA = '6d3a5f36b76beb5f8cfd7d3a0b86ef37fca3b4bb63ff344540748bad77013e1d'
RECORDING_PROBE_SHA = '56f0ed86b33436c7339bf00d95c2d34ca72e36be13bd8e9b1e7edc54d3a2a89a'
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
    parser.add_argument('--mode', choices=['animation', 'recording'], default='animation')
    parser.add_argument('--ffmpeg', type=Path, help='Existing encoder required for recording mode; no installation')
    parser.add_argument('--recording-fps', type=int, help='Recording mode only; default 12, range 1–120')
    parser.add_argument('--recording-duration', type=float, help='Recording mode only; default 0.3s, at most eight active frames')
    parser.add_argument('--full-recording', action='store_true', help='Preserve the full original preset and duration; default60fps/500x600 output, bounded lossless PNG evidence')
    for name in ['app-contents', 'java-home', 'host', 'app-data']:
        parser.add_argument('--' + name, type=Path, required=True)
    args = parser.parse_args()
    recording = args.mode == 'recording'
    require(recording == (args.ffmpeg is not None), '--ffmpeg is required only for recording mode')
    ffmpeg = args.ffmpeg.resolve() if recording else None
    if recording:
        require(ffmpeg.is_file() and os.access(ffmpeg, os.X_OK), 'Selected FFmpeg must be an existing executable')
    require(recording or args.recording_fps is None and args.recording_duration is None and not args.full_recording, 'Recording clock options require recording mode')
    require(not args.full_recording or args.recording_duration is None, '--full-recording preserves original duration; do not supply --recording-duration')
    fps = args.recording_fps if args.recording_fps is not None else 60 if args.full_recording else 12
    duration = args.recording_duration if args.recording_duration is not None else .3
    require(1 <= fps <= 120, 'Recording FPS must be 1–120')
    require(math.isfinite(duration) and .1 <= duration <= 8, 'Recording duration must be finite and between 0.1 and 8 seconds')
    # Preflight resource bound only. Original runtime completion selects the
    # captured frames; this does not truncate or replace its stopping rule.
    f32 = lambda value: struct.unpack('f', struct.pack('f', value))[0]
    bound = 0.
    for _ in range(8):
        bound = f32(bound + f32(1. / fps))
    require(not recording or args.full_recording or f32(duration) <= bound, 'Recording exceeds the eight-active-frame diagnostic capacity')
    app = (args.app_contents / 'app').resolve()
    jdk, host, data, out = [p.resolve() for p in [args.java_home, args.host, args.app_data, args.output]]
    preset = PINS[args.preset]
    member, count, source_sha = [preset[k] for k in ['member', 'particleCount', 'sourceSha256']]
    jar = app / 'MathArt-1.7.8-b07191b3e97da6fe465555ef6e61a0be.jar'
    source = app / 'resources' / member
    probe = Path(__file__).resolve().parents[1] / ('tests/fixtures/source-bouncing-native-recording/NativeSceneProbe.java' if recording else 'tests/fixtures/source-bouncing-native-animation/NativeSceneProbe.java')
    probe_sha = RECORDING_PROBE_SHA if recording else PROBE_SHA
    require(sha(jar.read_bytes()) == JAR_SHA, 'Original JAR changed')
    require(sha(host.read_bytes()) == HOST_SHA, 'Offscreen host changed; review before running')
    require(sha(probe.read_bytes()) == probe_sha, 'Diagnostic probe changed; review before running')
    with zipfile.ZipFile(jar) as archive:
        original = archive.read(member)
    require(sha(original) == source_sha and original == source.read_bytes(), 'Original preset identity mismatch')
    require(json.loads(original)['settings']['particle_count'] == count, 'Original particle count mismatch')
    width, height, max_active_frames, timeout = 128, 96, 8, 60
    if args.full_recording:
        duration = json.loads(original)['settings']['record_duration']
        require(isinstance(duration, (int, float)) and math.isfinite(duration) and .1 <= duration <= 60, 'Original duration outside full-reference capacity')
        width, height, timeout = 500, 600, 1800
        elapsed, expected_frames = 0., 0
        while elapsed < f32(duration) and expected_frames < 10000:
            elapsed = f32(elapsed + f32(1. / fps))
            expected_frames += 1
        # One extra display is diagnostic headroom, never an encoded substitute.
        require(expected_frames < 10000, 'Full reference exceeds10000 active displays')
        max_active_frames = expected_frames + 1
    # Eleven complete padded states plus ten active/paused pairs, images and
    # intermediate files; fail before running when the output cannot fit.
    required_bytes = 24 * ((int(count ** .5) + 1) ** 2 * 16) + 512 * 1024 ** 2
    if args.full_recording:
        # Two complete lossless RGBA PNGs per display, worst-case incompressible
        # data plus PNG/deflate overhead; eleven states and encoder headroom.
        required_bytes = math.ceil(max_active_frames * width * height * 9 * 4 * 2 * 1.01) + 12 * ((int(count ** .5) + 1) ** 2 * 16) + 2 * 1024 ** 3
    require(shutil.disk_usage(out.parent).free >= required_bytes, 'Insufficient space for complete reference')
    out.mkdir()  # Never overwrite an earlier run.
    original_source = source
    if recording:
        project = json.loads(original)
        if not args.full_recording:
            project['settings']['record_duration'] = duration
        source = out / 'input.json'
        write(source, {'project': project, 'ffmpegPath': str(ffmpeg), 'fps': fps, 'fullRecording': args.full_recording, 'width': width, 'height': height, 'maxActiveFrames': max_active_frames})
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
        stdout, stderr = process.communicate(timeout=timeout)
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
        'mode': args.mode, 'source': str(source), 'sourceSha256': sha(source.read_bytes()), 'originalSource': str(original_source), 'originalSourceSha256': source_sha,
        'jarSha256': JAR_SHA, 'hostSha256': HOST_SHA, 'probeSha256': probe_sha,
        'scope': f'Original ensureRenderBuffer(default scale3), Scene.update(false) before buffer.beginDraw/render, and real VideoRecorder. Only original record_duration changed to {duration}s; all particles retained. Up to eight active384x288 frames at {fps}fps, first warmup not encoded; original completion checked after every display. 128x96 original high-quality MP4 using explicitly selected installed FFmpeg. Context-binding graphics allocation bridge; normal policy/license/branding, no AWT windows.' if recording else 'Original methods and unmodified preset; three initial paused frames and 60 fixed-60-fps updates, each followed by a paused redraw. Eleven complete state readbacks, full 500x600 artwork before normal branding, normal license/policy initialization, no AWT windows.',
        'command': command, 'exit': process.returncode, 'stdout': stdout, 'stderr': stderr, 'seconds': time.monotonic() - started,
        'pid': process.pid, 'reaped': True, 'processGroupExists': group_exists, 'timedOut': timed_out, 'userFilesBefore': before, 'userFilesAfter': facts()}
    if recording:
        report['recording'] = {'fps': fps, 'duration': duration, 'maxActiveFrames': max_active_frames, 'fullPreset': args.full_recording, 'width': width, 'height': height, 'timeoutSeconds': timeout, 'requiredFreeBytes': required_bytes}
        if args.full_recording:
            report['scope'] = f'Unmodified original full {count}-particle preset, duration {duration}s at {fps}fps. Original500x600 output/default3x render, full artwork and branded PNG per active display, original VideoRecorder. Normal policy/license/branding and context-binding graphics allocation bridge; no AWT windows. Streaming evidence, no frame/duration/particle reduction.'
        report['ffmpeg'] = {'selectedPath': str(args.ffmpeg), 'resolvedPath': str(ffmpeg), 'sha256': sha(ffmpeg.read_bytes())}
    report['captureStatus'] = 'failed' if process.returncode or timed_out or group_exists or ' ERROR ' in stdout else 'passed'
    write(out / 'run.json', report)
    print(json.dumps({'case': args.preset, 'exit': report['exit'], 'seconds': report['seconds'], 'timedOut': timed_out, 'reaped': True, 'processGroupExists': group_exists, 'stderr': stderr, 'report': str(out / 'run.json')}), flush=True)
    if report['captureStatus'] != 'passed':
        raise SystemExit(1)

if __name__ == '__main__':
    main()
