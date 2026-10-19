#!/usr/bin/env python3
"""Independent retained-instruction Attractor color fixtures; no JVM execution.

Reuses the independent Python binary32/RGB arithmetic oracle, never product TS.
The Attractor target mapping, direct state, slot sampling and lifecycle below
are separate from Surface's smoothing and historical trail color behavior.
"""
import importlib.util
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures/source-attractor/colors.json'
spec = importlib.util.spec_from_file_location('float_palette', ROOT / 'scripts/source-surface-gradient-oracle.py')
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)
PALETTE = [0x60ff0000, 0xa000ff00, 0xe00000ff]


def linear(a, b, t):
    def to_linear(v):
        v = p.f(v / 255)
        return p.f(v / p.f(12.92)) if v <= p.f(.04045) else p.f(p.f(p.f(v + p.f(.055)) / p.f(1.055)) ** 2.4)
    def from_linear(v):
        v = max(0, v)
        return p.mul(12.92, v) if v <= p.f(.0031308) else p.sub(p.mul(1.055, p.f(v ** (1 / 2.4))), .055)
    def byte(v):
        return min(255, max(0, math.floor(v + .5)))
    channels = []
    for shift in [24, 16, 8, 0]:
        x, y = (a >> shift) & 255, (b >> shift) & 255
        if shift == 24:
            channels.append(byte(p.add(x, p.mul(y - x, t))))
        else:
            x, y = to_linear(x), to_linear(y)
            channels.append(byte(p.mul(from_linear(p.add(x, p.mul(p.sub(y, x), t))), 255)))
    return sum(v << shift for v, shift in zip(channels, [24, 16, 8, 0]))


def frame(base, progress, mode, interpolation):
    u = progress % 1
    shaped = u if interpolation == 'linear' else u*u*u*(u*(u*6-15)+10) if interpolation == 'oklch' else u*u*(3-2*u)
    primary = inside = outside = base
    wave = lambda frequency, phase: math.sin((progress * frequency + phase) * 6.283185307179586)
    if mode == 'hue_rotate':
        primary = base + shaped
    elif mode == 'offset_cycle':
        d = wave(.5, 0) * .05
        inside, outside = base + shaped + d, base + shaped - d * .5
    elif mode == 'cross_fade':
        d = (.5 + .5 * wave(1, .25)) * .08
        inside, outside, primary = base + shaped - d, base + shaped + d, base + shaped
    else:
        d = wave(.75, .35) * .06
        inside, outside, primary = base + shaped - d, base + shaped + d, base + shaped
    primary, inside, outside = map(p.f, [primary, inside, outside])
    average = p.mul(.5, p.add(inside, outside))
    if mode == 'hue_rotate':
        return p.state(primary, primary, 0)
    if mode == 'offset_cycle':
        return p.state(average, average, 0)
    return p.state(average if mode == 'cross_fade' else primary, outside,
                   p.soft(p.distance(inside, outside), .38 if mode == 'cross_fade' else .30))


class Runtime:
    def __init__(self, mode, interpolation):
        self.mode, self.interpolation = mode, interpolation
        self.state = p.state(0, 0, 0)
        self.running, self.progress, self.scale, self.speed, self.base = False, 0., 0., 0., 0.
        self.colors = PALETTE.copy()

    def apply(self):
        if not self.running:
            return
        state = frame(self.base, self.progress, self.mode, self.interpolation)
        if state == self.state:
            return
        self.state = state
        self.colors = []
        for u in [0., .5, 1.]:
            a = p.shifted(PALETTE, u, state['primary'], True)
            if state['blend'] > 0:
                b = p.shifted(PALETTE, u, state['secondary'], True)
                a = (linear if self.interpolation == 'linear' else p.rgb)(a, b, state['blend'])
            self.colors.append(a)

    def begin(self, actions):
        children = []
        for action in actions:
            if action == 'start':
                self.base, self.progress, self.scale, self.speed, self.running = self.state['primary'], 0., 0., 90., True
                self.apply()
                self.apply()
                children.append([action, False, 0.])
            else:
                children.append([action, not self.running, self.scale])
        return children

    def interpolate(self, children, eased, finished):
        for action, idle, captured in children:
            if idle:
                continue
            self.scale = eased if action == 'start' else captured * (1 - eased)
            self.apply()
            if finished:
                self.scale = 1. if action == 'start' else 0.
                self.apply()
                if action == 'stop':
                    self.running, self.speed, self.scale = False, 0., 0.

    def update(self, dt):
        if self.running:
            if dt > 0:
                self.progress = (self.progress + self.speed * self.scale * p.f(dt) / 360) % 1
            self.apply()

    def row(self):
        return dict(packed=self.colors.copy(), state=self.state.copy(), running=self.running,
                    progress=self.progress, speedScale=self.scale, base=self.base)


def scenario(mode, interpolation, groups, name):
    r = Runtime(mode, interpolation)
    rows = [r.row()]
    for actions in groups:
        children = r.begin(actions)
        for eased in [.5, 1.]:
            r.interpolate(children, eased, eased == 1.)
            r.update(.25)
            rows.append(r.row())
    r.update(0)
    rows.append(r.row())
    return dict(name=name, mode=mode, interpolation=interpolation, groups=groups, rows=rows)


groups = [['start'], [], ['stop'], [], ['start'], []]
cases = [scenario(mode, interpolation, groups, mode + '-' + interpolation)
         for mode in ['hue_rotate', 'offset_cycle', 'cross_fade', 'palette_morph']
         for interpolation in ['rgb', 'linear']]
cases += [scenario('hue_rotate', interpolation, groups, 'cyclic-rgb-' + interpolation) for interpolation in ['oklab', 'oklch']]
cases += [scenario('hue_rotate', 'rgb', groups, name) for name, groups in [
    ('idle-stop-start', [['stop', 'start'], []]), ('idle-start-stop', [['start', 'stop'], []]),
    ('running-stop-start', [['start'], ['stop', 'start'], []])]]
data = dict(provenance=dict(kind='independent-static-instruction-transcription', nativeExecution=False,
    jarSha256='a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018',
    methods=['StrangeAttractor.applyGradientFrame PC5-163', 'applyGradientState PC0-123',
             'sampleShiftedPalette PC78-251', 'sampleGradientPalette PC0-75',
             'GradientRuntimeState/GradientAnimator/StartGradientAnimation/StopGradientAnimation']), palette=PALETTE, cases=cases)
text = json.dumps(data, indent=2) + '\n'
if '--check' in sys.argv:
    if OUT.read_text() != text:
        raise SystemExit('Source Attractor color fixtures are stale')
else:
    OUT.write_text(text)
print(str(len(cases)) + ' independent Attractor color lifecycles verified')
