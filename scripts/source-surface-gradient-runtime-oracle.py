#!/usr/bin/env python3
"""Independent source-derived full head/trail RGB lifecycle fixtures.

Reuses only the Python F32 palette oracle, never product TypeScript. No original
JVM, UI, or framebuffer execution is claimed. Tiny dyadic 4fps queues avoid clock
rounding ambiguity while retaining ordered animation callbacks and Surface's
positive-dt update guard. --check verifies the committed fixture.
"""
import argparse
import hashlib
import importlib.util
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures/source-surface-gradient/runtime.json'
spec = importlib.util.spec_from_file_location('palette_oracle', ROOT / 'scripts/source-surface-gradient-oracle.py')
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)
PALETTE = [0x60ff0000, 0xa000ff00, 0xe00000ff]
COORDS = [0., .5, 1.]


def frame(base, progress, mode):
    # GradientRuntimeState.buildFrameAtProgress: RGB selects cubic phase shape.
    u = progress % 1
    shaped = (u*u)*(3-2*u)
    palette = inside = outside = base
    wave = lambda frequency, phase: math.sin((progress*frequency+phase)*6.283185307179586)
    if mode == 'HUE_ROTATE':
        palette = base+shaped
    elif mode == 'OFFSET_CYCLE':
        spread = wave(.5, 0)*.05
        inside, outside = (base+shaped)+spread, (base+shaped)-spread*.5
    elif mode == 'CROSS_FADE':
        spread = (.5+.5*wave(1, .25))*.08
        inside, outside, palette = (base+shaped)-spread, (base+shaped)+spread, base+shaped
    else:
        spread = wave(.75, .35)*.06
        inside, outside, palette = (base+shaped)-spread, (base+shaped)+spread, base+shaped
    return dict(palette=palette, inside=inside, outside=outside)


class Runtime:
    def __init__(self, mode):
        self.mode, self.running, self.base, self.progress, self.scale, self.speed = mode, False, 0., 0., 0., 0.
        self.state = p.state(0, 0, 0)
        self.head = [p.sample('HUE_ROTATE', u, self.state, False, PALETTE) for u in COORDS]
        self.records, self.time, self.callbacks = [], 0., 0

    def apply(self):
        if not self.running:
            return
        self.callbacks += 1
        self.state, changed = p.smoothing(self.state, p.mapping(self.mode, frame(self.base, self.progress, self.mode)))
        if changed:
            self.head = [p.sample(self.mode, u, self.state, True, PALETTE) for u in COORDS]
            # refreshParticleColorsByOffset PCs237–248 replaces the last head
            # row with the first for cyclic gradients. History sampling does
            # not perform this seam replacement.
            self.head[-1] = self.head[0]

    def start_children(self, actions):
        children = []
        for action in actions:
            if action == 'start':
                self.base, self.progress, self.scale, self.speed, self.running = self.state['primary'], 0., 0., 90., True
                self.apply()
                self.apply()  # StartGradientAnimation.onStart setSpeedScale(0).
                children.append([action, False, 0.])
            else:
                children.append([action, not self.running, self.scale])
        return children

    def update_children(self, children, eased, finished):
        for action, idle, captured in children:
            if idle:
                continue
            self.scale = eased if action == 'start' else captured*(1-eased)
            self.apply()
            if finished:
                self.scale = 1. if action == 'start' else 0.
                self.apply()
                if action == 'stop':
                    self.running, self.speed, self.scale = False, 0., 0.

    def update_surface(self, dt):
        if dt <= 0:
            return
        self.time = p.add(self.time, dt)
        if self.running:
            self.progress = (self.progress+((self.speed*self.scale)*dt)/360)%1
            self.apply()
        self.records.append(self.time)

    def output(self, display_time):
        trails = []
        for row, u in enumerate(COORDS):
            for record in self.records:
                if self.running and len(self.records) > 1:
                    age = p.f(p.f(p.age(self.time, record))/p.f(120))
                    progress = (self.progress-((self.speed*self.scale)*age)/360)%1
                    color = p.sample(self.mode, u, p.mapping(self.mode, frame(self.base, progress, self.mode)), True, PALETTE)
                else:
                    color = self.head[row]
                alpha = 255 if self.running else ((self.head[row] >> 24) or 255)
                # Processing packs the normalized stroke alpha again.
                alpha = int(p.mul(255, p.f(alpha/255)))
                trails.append([color & 0xffffff, alpha])
        return dict(time=display_time, sceneTime=self.time, callbacks=self.callbacks, running=self.running,
                    head=[x & 0xffffff for x in self.head], headAlpha=[x >> 24 for x in self.head],
                    trailRGB=[x[0] for x in trails], trailAlpha=[x[1] for x in trails], records=len(self.records))


def scenario(mode, name, groups):
    runtime = Runtime(mode)
    frames = []
    index = 0
    for actions in groups:
        children = runtime.start_children(actions)
        for eased in [.5, 1.]:
            runtime.update_children(children, eased, eased == 1.)
            runtime.update_surface(.25)
            frames.append(runtime.output(index*.25))
            index += 1
    # Final trails instant has zero active dt: no gradient or particle update.
    runtime.update_surface(0)
    frames.append(runtime.output(index*.25))
    return dict(name=name, mode=mode, groups=groups, frames=frames)


def fixtures():
    rows = [scenario(mode, 'lifecycle', [['start'], [], ['stop'], [], ['start'], []]) for mode in p.MODES]
    for name, groups in [('idle-stop-start', [['stop', 'start'], []]),
                         ('idle-start-stop', [['start', 'stop'], []]),
                         ('running-stop-start', [['start'], ['stop', 'start'], []])]:
        rows.append(scenario('HUE_ROTATE', name, groups))
    return dict(metadata=dict(evidenceKind='Independent Python binary32/binary64 transcription; no original JVM execution',
        artifactSha256='a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018',
        sourceMethods=['GradientRuntimeState.buildFrameAtProgress/advance/buildFrameAtAgeSeconds',
          'GradientAnimator.start/setSpeedScale/update', 'AnimationGroup.onStart/update',
          'StartGradientAnimation.onStart/onUpdate/onFinish', 'StopGradientAnimation.onStart/onUpdate/onFinish',
          'ParametricSurface.update/applyGradientState/refreshParticleColorsByOffset/drawTrailsLines'],
        palette=PALETTE, coordinates=COORDS, fps=4, speed=90, interpolation='RGB', fadeTrails=False,
        limitations=['No framebuffer or native runtime evidence', 'Small dyadic queues only; collision and seam cases covered by separate producer tests']), scenarios=rows)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    rendered = json.dumps(fixtures(), indent=2, allow_nan=False)+'\n'
    if args.check:
        if not OUT.exists() or OUT.read_text() != rendered:
            raise SystemExit('FAIL: runtime fixture differs; regenerate and review')
    else:
        OUT.write_text(rendered)
    print(json.dumps(dict(status='checked' if args.check else 'written', sha256=hashlib.sha256(rendered.encode()).hexdigest())))


if __name__ == '__main__':
    main()
