#!/usr/bin/env python3
"""Independent F32 transcription of retained MathArt 1.7.8 classfile instructions.

Does not import product code or execute the reference JVM. Python/libm sin is an
independent numerical oracle, not a claim of native renderer/runtime parity.
Run from any directory; --check compares the committed deterministic fixture.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import struct

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'tests/fixtures/source-surface-gradient/numerics.json'
MODES = ('HUE_ROTATE', 'OFFSET_CYCLE', 'CROSS_FADE', 'PALETTE_MORPH')


def f(x):
    return struct.unpack('>f', struct.pack('>f', x))[0]


def add(a, b):
    return f(f(a) + f(b))


def sub(a, b):
    return f(f(a) - f(b))


def mul(a, b):
    return f(f(a) * f(b))


def clamp(x, lo=0, hi=1):
    return f(lo if x < lo else hi if x > hi else x)


def wrap(x):
    # PApplet.floor(F) invokes Math.floor(D), followed by saturating d2i.
    x = f(x)
    i = min(2147483647, max(-2147483648, math.floor(x)))
    result = sub(x, f(i))
    return add(result, 1) if result < 0 else result


def distance(a, b):
    d = abs(sub(wrap(a), wrap(b)))
    return min(d, sub(1, d))


def wave(x):
    return add(.5, mul(.5, f(math.sin(mul(f(6.2831854820251465), x)))))


def soft(gap, maximum):
    t = f(clamp(gap, 0, .5) / f(.5))
    smooth = mul(mul(t, t), sub(3, mul(2, t)))
    return clamp(mul(smooth, maximum), 0, f(maximum))


def state(p, s, b):
    return {'primary': f(p), 'secondary': f(s), 'blend': f(b)}


def mapping(mode, frame):
    p, inside, outside = (f(frame[k]) for k in ('palette', 'inside', 'outside'))
    gap = distance(inside, outside)
    w = wave(wrap(mul(.5, add(inside, outside))))
    if mode == 'HUE_ROTATE':
        return state(p, wrap(add(add(p, .06), mul(.06, w))),
                     clamp(add(.06, mul(.08, w)), 0, f(.22)))
    if mode == 'OFFSET_CYCLE':
        return state(inside, outside, clamp(add(.08, soft(gap, .28)), 0, f(.4)))
    if mode == 'CROSS_FADE':
        return state(inside, outside,
                     clamp(add(add(.16, soft(gap, .45)), mul(.08, w)), 0, f(.72)))
    return state(p, outside,
                 clamp(add(add(.12, soft(gap, .34)), mul(.05, w)), 0, f(.56)))


def circular_lerp(a, b, amount):
    a, b = wrap(a), wrap(b)
    delta = sub(b, a)
    if delta > .5:
        delta = sub(delta, 1)
    elif delta < -.5:
        delta = add(delta, 1)
    return wrap(add(a, mul(delta, clamp(f(amount)))))


def smoothing(previous, target):
    # applyGradientState PC 0–62: nonfinite target components retain old state.
    p = {k: f(v) for k, v in previous.items()}
    t = {k: (f(v) if math.isfinite(v) else p[k]) for k, v in target.items()}
    candidate = state(circular_lerp(p['primary'], t['primary'], .2),
                      circular_lerp(p['secondary'], t['secondary'], .2),
                      add(p['blend'], mul(sub(clamp(t['blend']), p['blend']), .18)))
    changed = (distance(candidate['primary'], p['primary']) > f(.0001)
               or distance(candidate['secondary'], p['secondary']) > f(.0001)
               or abs(sub(candidate['blend'], p['blend'])) > f(.0001))
    # No write at all when every candidate delta is <= epsilon, PC 166–171.
    return (candidate if changed else p), changed


def rgb(a, b, t):
    t = clamp(f(t))
    packed = 0
    for shift in (24, 16, 8, 0):
        x, y = (a >> shift) & 255, (b >> shift) & 255
        packed |= int(add(x, mul(y - x, t))) << shift
    return packed


def shifted(palette, coordinate, offset, cyclic):
    if len(palette) == 1:
        return palette[0]
    v = wrap(add(coordinate, wrap(offset)))
    position = mul(v, len(palette) if cyclic else len(palette) - 1)
    index = int(position)
    index = min(index, len(palette) - (1 if cyclic else 2))
    t = sub(position, index)
    following = (index + 1) % len(palette) if cyclic else index + 1
    # cyclic invokes selected lerpColors; noncyclic directly invokes ManimColors.lerp.
    # RGB is selected in this foundation fixture, so both use the independent byte lerp.
    return rgb(palette[index], palette[following], t)


def sample(mode, coordinate, current, cyclic, palette):
    u = f(coordinate)
    p, s, blend = (f(current[k]) for k in ('primary', 'secondary', 'blend'))
    blend = clamp(blend)
    if mode == 'HUE_ROTATE':
        a = shifted(palette, u, p, cyclic)
        if blend <= 0:
            return a
        return rgb(a, shifted(palette, u, s, cyclic), blend)
    if mode == 'OFFSET_CYCLE':
        w = wave(add(mul(u, 2), p))
        delta = mul(sub(w, .5), .14)
        mix = clamp(add(add(.12, mul(blend, .45)), mul(.25, w)), 0, f(.72))
        a = shifted(palette, add(u, delta), add(p, mul(delta, .5)), cyclic)
        b = shifted(palette, sub(u, delta), sub(s, mul(delta, .5)), cyclic)
    elif mode == 'CROSS_FADE':
        w = wave(sub(mul(u, 1.25), p))
        delta = mul(sub(w, .5), .1)
        mix = clamp(add(.1, mul(mul(.75, blend), w)), 0, f(.85))
        a = shifted(palette, add(u, delta), p, cyclic)
        b = shifted(palette, sub(u, delta), s, cyclic)
    else:
        w = f(math.sin(mul(f(6.2831854820251465), add(mul(u, 2.5), s))))
        warped = add(u, mul(.12, w))
        partial = add(mul(.35, warped), mul(.65, u))
        mix = clamp(add(.15, mul(.6, blend)), 0, f(.7))
        a = shifted(palette, warped, p, cyclic)
        modulation = mul(.06, f(math.sin(mul(f(6.2831854820251465), add(u, p)))))
        b = shifted(palette, partial, add(s, modulation), cyclic)
    return rgb(a, b, mix)


def age(time, record_time):
    time, record_time = f(time), f(record_time)
    if not math.isfinite(record_time):
        return -2147483648
    delta = sub(time, record_time)
    if not math.isfinite(delta) or delta <= 0:
        return 0
    # Math.round(F): closest integer, ties toward positive infinity, saturating int.
    return max(0, min(2147483647, math.floor(mul(delta, 120) + .5)))


def fixtures():
    metadata = {
        'evidenceKind': 'Independent Python float32 derivation from retained classfile bytecode; no native JVM execution',
        'artifactSha256': 'a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018',
        'classes': [
            {'entry': 'mathart/surface/ParametricSurface.class', 'classSha256': 'f845653098ac1a4112420b83cf258596be4569da66eabb0feaacc3020d0e5ceb', 'decodedEvidenceSha256': 'c4d539dbd1d30d52c460f2497d9e01d9943309548f6d4b4e30a6f6c56fc86b4d'},
            {'entry': 'mathart/utils/ManimColors.class', 'classSha256': 'a4da46f892de65a559dfc117164c79bb5a4a22988abc24772a1eb2af7edc286e', 'decodedEvidenceSha256': 'a5dacdd6138ad2bc23288f932e79f3250e833b6215847ce36ac48a8bb32b6ed5'},
            {'entry': 'processing/core/PApplet.class', 'classSha256': '5e2413f11fbdd22e9e8b4a27ed2c260e9678fadf41984183796f98680ba9c35f', 'decodedEvidenceSha256': 'd6b72831f71cce2b856f094e75b320f341f1eaeea6c7c3fbb28550e175ebcca5', 'artifact': 'Processing core 4.5.0 (separate JAR)', 'artifactSha256': '89410e2c4f59cb4b4aeb2a3baeaf6a4bc189d6e1c612920c3f8e0f58b62a769a'},
            {'entry': 'mathart/animation/gradient/GradientActionConfig$GradientMode.class', 'classSha256': 'd8f339a97c2c32796b9ba2dff64e00cdede4ef29c8278fa17c781f9b52189202', 'decodedEvidenceSha256': '5f01d37bdd9b4f3dc2bf6c973041d7dcd299598cc8764d772e2a33f7b0a97e04'},
        ],
        'methods': ['mapGradientFrameToPaletteState', 'applyGradientState', 'sampleSurfaceGradientColor', 'sampleShiftedPalette', 'circularLerpUnit', 'circularUnitDistance', 'normalizedCircularDistance', 'softBlendFromGap', 'wrapUnit', 'quantizeTrailAgeKey', 'ManimColors.lerp', 'PApplet.sin/floor/lerp/constrain'],
        'interpolation': 'RGB; noncyclic palette segments directly use ManimColors.lerp regardless of runtime interpolation selection',
        'precision': 'Round every Java float instruction to IEEE binary32. PApplet.sin uses Python libm double sin then binary32; Java Math.sin implementation not executed.',
        'nonFiniteEncoding': 'null input plus nonFiniteInputs path tag; null does not mean Java zero',
        'limitations': ['No native JVM, application window, or framebuffer execution', 'Non-RGB lerp dispatch requires separate existing interpolation oracle; these samples use RGB', 'Temporal GradientRuntime production and draw order are outside this numerical foundation'],
    }
    result = {'metadata': metadata, 'mapping': [], 'smoothing': [], 'samples': [], 'ages': []}
    for mode in MODES:
        for name, values in [('zero', (0, 0, 0)), ('quarter-gap', (.2, .125, .375)), ('half-gap', (.9, 0, .5)), ('wrap-gap', (-.4, .98, .02)), ('negative-and-multiturn', (2.3, -1.2, 2.7)), ('same-wrapped', (.25, -.25, .75))]:
            frame = dict(zip(('palette', 'inside', 'outside'), map(f, values)))
            result['mapping'].append({'name': mode.lower() + '-' + name, 'mode': mode, 'frame': frame, 'expected': mapping(mode, frame)})
    epsilon_target = f(f(.0001) / f(.2))
    bits = struct.unpack('>I', struct.pack('>f', epsilon_target))[0]
    above = struct.unpack('>f', struct.pack('>I', bits + 1))[0]
    for name, prev, target in [
        ('unchanged', (0, 0, 0), (0, 0, 0)),
        ('standard-factors', (.1, .3, .2), (.4, .5, .8)),
        ('wrap-shortest-arcs', (.95, .05, .5), (.05, .95, .6)),
        ('positive-half-tie', (0, .25, 0), (.5, .75, .5)),
        ('negative-half-tie', (.5, .75, .5), (0, .25, 0)),
        ('negative-multiturn', (.25, .8, .2), (-2.1, 3.2, 2)),
        ('blend-clamp-low', (.2, .4, .8), (.2, .4, -1)),
        ('strict-epsilon-equal-no-write', (0, 0, 0), (epsilon_target, 0, 0)),
        ('strict-epsilon-next-float-write', (0, 0, 0), (above, 0, 0)),
        ('other-change-commits-subthreshold-primary', (0, 0, 0), (epsilon_target, 0, 1)),
    ]:
        prev, target = state(*prev), state(*target)
        expected, changed = smoothing(prev, target)
        result['smoothing'].append({'name': name, 'previous': prev, 'target': target, 'expected': expected, 'changed': changed})
    palette = [0x10203040, 0x80E010A0, 0xFFE0D030, 0x0070A0FF]
    coordinates = [-.25, 0, .125, .333333333, .5, .875, .99999994, 1, 1.75]
    states = [state(.17, .69, .43), state(-1.2, 2.35, -1), state(.98, .02, 2)]
    for mode in MODES:
        for cyclic in (False, True):
            for i, coordinate in enumerate(coordinates):
                current = states[i % len(states)]
                result['samples'].append({'name': f'{mode.lower()}-{"cyclic" if cyclic else "open"}-{i}', 'mode': mode, 'coordinate': f(coordinate), 'state': current, 'cyclic': cyclic, 'palette': palette, 'expected': sample(mode, coordinate, current, cyclic, palette)})
        current = state(.23, .77, .8)
        result['samples'].append({'name': mode.lower() + '-singleton', 'mode': mode, 'coordinate': .5, 'state': current, 'cyclic': True, 'palette': [0x804080FF], 'expected': sample(mode, .5, current, True, [0x804080FF])})
    for name, time, recorded in [('zero', 0, 0), ('positive', 1, .25), ('future', 1, 2), ('half-quantum', f(1 / 240), 0), ('just-below-half', f(1 / 240) - 1e-9, 0), ('multiple-half', f(2.5 / 120), 0), ('negative-clock', -2, -3), ('saturating-int', 1e8, 0), ('nan-record', 1, math.nan), ('infinite-record', 1, math.inf), ('nan-clock', math.nan, 0), ('infinite-clock', math.inf, 0)]:
        item = {'name': name, 'time': f(time), 'recordTime': f(recorded), 'expected': age(time, recorded)}
        tags = {}
        for key in ('time', 'recordTime'):
            if not math.isfinite(item[key]):
                tags[key] = 'NaN' if math.isnan(item[key]) else 'Infinity'
                item[key] = None
        if tags:
            item['nonFiniteInputs'] = tags
        result['ages'].append(item)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    data = fixtures()
    rendered = json.dumps(data, indent=2, allow_nan=False) + '\n'
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_text() != rendered:
            raise SystemExit('FAIL: numerical fixture differs; regenerate and review the source-derived changes')
    else:
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT.write_text(rendered)
    counts = {k: len(v) for k, v in data.items() if isinstance(v, list)}
    print(json.dumps({'status': 'checked' if args.check else 'written', 'counts': counts, 'sha256': hashlib.sha256(rendered.encode()).hexdigest()}))


if __name__ == '__main__':
    main()
