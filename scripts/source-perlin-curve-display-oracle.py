#!/usr/bin/env python3
"""Independent static instruction transcription of Perlin curve display policy.

This deliberately does not import product TypeScript or render any native pixels.
Cache sequences model successful source calls; they do not model resource failures.
"""
import argparse
import hashlib
import json
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures/source-perlin/curve-display.json'


def f(value):
    return struct.unpack('>f', struct.pack('>f', value))[0]


def adjacent(value, delta):
    bits = struct.unpack('>I', struct.pack('>f', value))[0]
    return struct.unpack('>f', struct.pack('>I', bits + delta))[0]


def color(packed, alpha):
    # Perlin drawFieldCurves2D PC34–48,100–149; PGraphics RGB255 colorCalc.
    alpha255 = f(min(1., max(f(.01), f(alpha))) * 255.)
    inputs = [float((packed >> shift) & 255) for shift in [16, 8, 0]] + [alpha255]
    calc = [f(x / 255.) for x in inputs]
    channels = [int(f(255. * x)) for x in calc]
    return dict(alpha255=alpha255, colorCalc=calc, bytes=channels,
                rgba=[f(x / 255.) for x in channels],
                packed=(channels[3] << 24) | (channels[0] << 16) | (channels[1] << 8) | channels[2])


FLAGS = ['noiseOffsetAnimationActive', 'noiseOffsetDriftRunning',
         'curveNoiseScaleDriftRunning', 'curveAngleScaleDriftRunning']


def sequence(name, events, initial=None):
    state = dict(curveCount=2, geometryDirty=False, cacheDirty=False,
                 cache=None, geometryBuilds=0, cacheBuilds=0, allocations=0,
                 gradient=[0., 0., 0.], flags={})
    if initial:
        state.update(initial)
    rows = []
    for event in events:
        action = event['action']
        effects = []
        if action == 'geometry-dirty':
            state['geometryDirty'] = True
        elif action == 'palette':
            if event.get('validNonempty', True) and event.get('fieldCurves', True):
                state['cacheDirty'] = True
                effects.append('refresh-colors')
        elif action == 'gradient':
            values = [f(event[key]) for key in ['offset', 'secondaryOffset', 'blend']]
            values[2] = max(0., min(1., values[2]))
            if values != state['gradient']:
                state['gradient'] = values
                if event.get('fieldCurves', True):
                    state['cacheDirty'] = True
                    effects.append('refresh-colors')
        elif action == 'flags':
            state['flags'].update(event['values'])
        elif action == 'draw':
            direct = any(state['flags'].get(key, False) for key in FLAGS)
            if not direct and state['curveCount'] == 0:
                effects.append('empty-return')
            else:
                if state['geometryDirty']:
                    state['geometryBuilds'] += 1
                    state['geometryDirty'] = False
                    state['cacheDirty'] = True
                    effects.append('rebuild-geometry')
                if direct:
                    effects.append('direct' if state['curveCount'] else 'direct-empty-return')
                else:
                    width, height, scale = event['width'], event['height'], f(event['lineScale'])
                    old = state['cache']
                    changed = old is None or old['width'] != width or old['height'] != height
                    changed = changed or abs(f(old['lineScale'] - scale)) > f(.0001) or state['cacheDirty']
                    if changed:
                        cw, ch = max(1, width), max(1, height)
                        if old is None or old['width'] != cw or old['height'] != ch:
                            state['allocations'] += 1
                            effects.append('allocate-cache')
                        state['cacheBuilds'] += 1
                        state['cache'] = dict(width=cw, height=ch, lineScale=scale)
                        state['cacheDirty'] = False
                        effects.append('rebuild-cache')
                    effects.append('image-cache')
        else:
            raise ValueError(action)
        rows.append(dict(event=event, expected=dict(effects=effects,
            geometryDirty=state['geometryDirty'], cacheDirty=state['cacheDirty'],
            cache=state['cache'], geometryBuilds=state['geometryBuilds'],
            cacheBuilds=state['cacheBuilds'], allocations=state['allocations'])))
    return dict(name=name, initial=initial or {}, steps=rows)


def draw(width=320, height=200, scale=1., **extra):
    return dict(action='draw', width=width, height=height, lineScale=scale, **extra)


def fixtures():
    epsilon = f(.0001)
    color_inputs = [
        ('opaque', 0xff1234fe, 1.), ('packed-alpha-ignored-zero', 0x001234fe, 1.),
        ('packed-alpha-ignored-half', 0x801234fe, .5),
        ('alpha-floor-zero', 0x00ffffff, 0.), ('alpha-floor-negative', 0x10203040, -3.),
        ('alpha-over-one', 0xffffffff, 4.), ('alpha-just-below-half', 0x00010203, adjacent(.5, -1)),
        ('alpha-just-above-half', 0x00010203, adjacent(.5, 1)),
        ('alpha-fraction', 0x7f7f80ff, .1234567),
        ('alpha-254-over-255', 0xffffffff, f(254 / 255)),
    ]
    widths = [(0., 1.), (-1., 1.), (.02, 1.), (.1, .2), (1.3, .56),
              (1.3, .5316330194473267), (adjacent(.02, -1), 1.), (adjacent(.02, 1), 1.)]
    thresholds = [(0., adjacent(epsilon, -1)), (0., epsilon), (0., adjacent(epsilon, 1)),
                  (1., f(1.0001)), (1., adjacent(f(1.0001), -1)),
                  (2., f(2.0001)), (2., adjacent(f(2.0001), 1))]
    sequences = [
        sequence('cache-reuse-palette-and-geometry', [
            draw(), draw(), dict(action='palette', validNonempty=False), draw(),
            dict(action='palette'), draw(), dict(action='geometry-dirty'), draw()]),
        sequence('gradient-change-not-running-flag', [
            draw(), dict(action='flags', values=dict(gradientRunning=True, noiseScaleDriftRunning=True)),
            draw(), dict(action='gradient', offset=0., secondaryOffset=0., blend=0.), draw(),
            dict(action='gradient', offset=.1, secondaryOffset=0., blend=0.), draw()]),
        sequence('direct-retains-dirty-cache-until-static', [
            draw(), dict(action='flags', values=dict(noiseOffsetDriftRunning=True)),
            dict(action='geometry-dirty'), draw(), draw(),
            dict(action='flags', values=dict(noiseOffsetDriftRunning=False)), draw(), draw()]),
        sequence('target-size-single-cache-and-no-density-key', [
            draw(), draw(targetIdentity='export', pixelDensity=2),
            draw(640, 400), draw(), draw(scale=.56), draw(scale=.56)]),
        sequence('small-changes-relative-to-last-rebuild', [
            draw(scale=1.), draw(scale=f(1.00005)), draw(scale=f(1.00009)),
            draw(scale=f(1.00014)), draw(scale=f(1.00019))]),
        sequence('empty-cache-return-before-geometry', [draw()],
                 dict(curveCount=0, geometryDirty=True)),
        sequence('zero-size-diagnostic-rebuild-every-draw', [draw(0, 0), draw(0, 0)]),
    ]
    return dict(provenance=dict(kind='independent-static-instruction-transcription',
        nativeExecution=False,
        mathartJarSha256='a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018',
        processingJarSha256='89410e2c4f59cb4b4aeb2a3baeaf6a4bc189d6e1c612920c3f8e0f58b62a769a',
        perlinClassSha256='ef1de66f25e6fed5a126cb260005d0b5d7fd161118cc83993f0648009de96d92',
        pGraphicsClassSha256='d495bc8e9b3f6855759da98715874d9f95aed561664c12edf792a08abcb5e818',
        methods=['drawFieldCurveCache PC0–125', 'drawFieldCurves2D PC0–212',
                 'isFieldCurveAnimating PC0–33', 'rebuildFieldCurvesIfNeeded PC0–25',
                 'rebuildFieldCurveCache PC0–289', 'applyPalette', 'applyGradientState',
                 'PGraphics.colorCalc(FFFF) RGB255 PC124–172,473–572'],
        limits=['Successful lifecycle calls only; resource failures have no source oracle here.',
                'Zero-size cache sequence is method diagnostic, not a renderable camera.',
                'Geometry rebuilding modeled as event; no geometric output or native pixels.',
                'Draw lineScale is already computed for final target; no second cache scale.',
                'RGBA assumes source default RGB255, not arbitrary inherited colorMode.']),
        colors=[dict(name=n, input=dict(packed=p, alpha=a), expected=color(p, a)) for n,p,a in color_inputs],
        widths=[dict(input=dict(lineWeight=w, lineScale=s), expected=max(f(.02), f(f(w)*f(s)))) for w,s in widths],
        thresholds=[dict(input=dict(cachedScale=a, newScale=b),
                         expected=dict(difference=abs(f(f(a)-f(b))), rebuild=abs(f(f(a)-f(b)))>epsilon))
                    for a,b in thresholds],
        animationFlags=[dict(input={key: True}, expected=key in FLAGS)
                        for key in FLAGS+['gradientRunning','noiseScaleDriftRunning']],
        sequences=sequences)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    data = (json.dumps(fixtures(), indent=2, ensure_ascii=False, allow_nan=False) + '\n').encode()
    if args.check:
        if OUT.read_bytes() != data:
            raise SystemExit('curve display fixture differs')
    else:
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_bytes(data)
    print(f'{OUT.relative_to(ROOT)} {len(data)} bytes sha256={hashlib.sha256(data).hexdigest()}')
