#!/usr/bin/env python3
"""Perlin color lifecycle oracle transcribed from retained MathArt 1.7.8 bytecode.

No product TypeScript imports and no JVM/native renderer execution. Reuses only
binary32 helpers and the separately transcribed RGB arithmetic oracle. Python
libm is not proof of Java Math or framebuffer parity. --check is read-only.
"""
import argparse
import hashlib
import importlib.util
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures/source-perlin/colors.json'
spec = importlib.util.spec_from_file_location('binary32', ROOT / 'scripts/source-surface-gradient-oracle.py')
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)
COORDINATES = [0, .125, .5, .875, 1]
PALETTE = [0x60ff0000, 0xa000ff00, 0xe00000ff]
DEFAULT_PALETTE = [0xfffc6255, 0xffff862f, 0xffffcd62, 0xff83c167, 0xff58c4dd, 0xff9a72ac]
MODES = ['hue_rotate', 'offset_cycle', 'cross_fade', 'palette_morph']
SPACES = ['rgb', 'linear', 'oklab', 'oklch']


def byte(x):
    return min(255, max(0, math.floor(x + .5)))


def linear_d(v):
    return v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4


def srgb_d(v):
    v = max(0, v)
    return 12.92 * v if v <= .0031308 else 1.055 * v ** (1 / 2.4) - .055


def oklab(color):
    r, g, b = [linear_d(((color >> s) & 255) / 255) for s in [16, 8, 0]]
    l = math.cbrt(.4122214708*r + .5363325363*g + .0514459929*b)
    m = math.cbrt(.2119034982*r + .6806995451*g + .1073969566*b)
    s = math.cbrt(.0883024619*r + .2817188376*g + .6299787005*b)
    return [.2104542553*l + .793617785*m - .0040720468*s,
            1.9779984951*l - 2.428592205*m + .4505937099*s,
            .0259040371*l + .7827717662*m - .808675766*s]


def from_oklab(l, a, b):
    x = l + .3963377774*a + .2158037573*b
    y = l - .1055613458*a - .0638541728*b
    z = l - .0894841775*a - 1.291485548*b
    x, y, z = x*x*x, y*y*y, z*z*z
    return [byte(srgb_d(v)*255) for v in [4.0767416621*x - 3.3077115913*y + .2309699292*z,
            -1.2684380046*x + 2.6097574011*y - .3413193965*z,
            -.0041960863*x - .7034186147*y + 1.707614701*z]]


def lerp(a, b, t, space):
    t = p.f(t)
    if space == 'rgb':
        return p.rgb(a, b, t)
    alpha = byte(p.add((a >> 24) & 255, p.mul(((b >> 24) & 255) - ((a >> 24) & 255), t)))
    if space == 'linear':
        def to_linear(v):
            v = p.f(v / 255)
            return p.f(v / p.f(12.92)) if v <= p.f(.04045) else p.f(p.f(p.f(v + p.f(.055)) / p.f(1.055)) ** 2.4)
        def from_linear(v):
            v = max(0, v)
            return p.mul(12.92, v) if v <= p.f(.0031308) else p.sub(p.mul(1.055, p.f(v ** (1 / 2.4))), .055)
        rgb = []
        for s in [16, 8, 0]:
            x, y = to_linear((a >> s) & 255), to_linear((b >> s) & 255)
            rgb.append(byte(p.mul(from_linear(p.add(x, p.mul(p.sub(y, x), t))), 255)))
    else:
        x, y = oklab(a), oklab(b)
        if space == 'oklab':
            rgb = from_oklab(*[u + (v-u)*t for u, v in zip(x, y)])
        else:
            cx, cy = math.hypot(x[1], x[2]), math.hypot(y[1], y[2])
            hx = 0 if cx < 1e-12 else math.atan2(x[2], x[1])
            hy = hx if cy < 1e-12 else math.atan2(y[2], y[1])
            delta = math.fmod(hy-hx, math.tau)
            if delta > math.pi:
                delta -= math.tau
            elif delta < -math.pi:
                delta += math.tau
            light, chroma, hue = x[0]+(y[0]-x[0])*t, cx+(cy-cx)*t, hx+delta*t
            rgb = from_oklab(light, chroma*math.cos(hue), chroma*math.sin(hue))
    return sum(v << s for v, s in zip([alpha]+rgb, [24, 16, 8, 0]))


def shifted(palette, coordinate, offset, running, space):
    # PerlinNoiseField.sampleShiftedPalette PC0–32: defensive white/single.
    if not palette:
        return 0xffffffff
    if len(palette) == 1:
        return palette[0]
    u = p.wrap(p.add(coordinate, p.wrap(offset)))
    position = p.mul(u, len(palette) if running else len(palette)-1)
    index = min(int(position), len(palette)-(1 if running else 2))
    amount = p.sub(position, index)
    following = (index+1) % len(palette) if running else index+1
    return lerp(palette[index], palette[following], amount, space if running else 'rgb')


def sample(palette, coordinate, state, running, space):
    a = shifted(palette, coordinate, state['primary'], running, space)
    if state['blend'] <= 0:
        return a
    b = shifted(palette, coordinate, state['secondary'], running, space)
    return lerp(a, b, state['blend'], space if running else 'rgb')


def frame(base, progress, mode, interpolation):
    # GradientRuntimeState.buildFrame double arithmetic, Perlin target F32 writes.
    u = progress % 1
    shaped = u if interpolation == 'linear' else u*u*u*(u*(u*6-15)+10) if interpolation == 'oklch' else u*u*(3-2*u)
    primary = inside = outside = base
    wave = lambda frequency, phase: math.sin((progress * frequency + phase) * math.tau)
    if mode == 'hue_rotate':
        primary = base + shaped
    elif mode == 'offset_cycle':
        d = wave(.5, 0)*.05
        inside, outside = base+shaped+d, base+shaped-d*.5
    elif mode == 'cross_fade':
        d = (.5+.5*wave(1, .25))*.08
        inside, outside, primary = base+shaped-d, base+shaped+d, base+shaped
    else:
        d = wave(.75, .35)*.06
        inside, outside, primary = base+shaped-d, base+shaped+d, base+shaped
    primary, inside, outside = map(p.f, [primary, inside, outside])
    average = p.mul(.5, p.add(inside, outside))
    if mode == 'hue_rotate':
        return p.state(primary, primary, 0)
    if mode == 'offset_cycle':
        return p.state(average, average, 0)
    return p.state(average if mode == 'cross_fade' else primary, outside,
                   p.soft(p.distance(inside, outside), .38 if mode == 'cross_fade' else .30))


class Runtime:
    def __init__(self, palette):
        self.palette = (palette or DEFAULT_PALETTE).copy()
        self.state = p.state(0, 0, 0)
        self.refreshed = None
        self.mode, self.space = 'hue_rotate', 'rgb'
        self.running, self.progress, self.scale, self.speed, self.base = False, 0., 0., 0., 0.
        self.revision, self.dirty, self.texture, self.builds = 0, True, None, 0
        self.children = []

    def apply(self):
        if not self.running:
            return
        state = frame(self.base, self.progress, self.mode, self.space)
        if state == self.state:
            return
        self.state = state
        self.refreshed = (state.copy(), self.running, self.space)
        self.revision += 1
        self.dirty = True

    def begin(self, actions):
        self.children = []
        for action in actions:
            if action['kind'] == 'start':
                self.mode, self.space = action['mode'], action['interpolation']
                self.base, self.progress, self.scale, self.speed, self.running = self.state['primary'], 0., 0., action.get('speed', 90.), True
                self.apply()  # GradientAnimator.start immediately applies frame.
                self.apply()  # StartGradientAnimation.onStart setSpeedScale(0).
                self.children.append(['start', False, 0.])
            else:
                self.children.append(['stop', not self.running, self.scale])

    def interpolate(self, eased, finished):
        eased = p.f(eased)
        for child in self.children:
            action, idle, captured = child
            if idle:
                continue
            self.scale = eased if action == 'start' else captured*(1-eased)
            self.apply()
            if finished:
                self.scale = 1. if action == 'start' else 0.
                self.apply()
                if action == 'stop':
                    self.running, self.speed, self.scale = False, 0., 0.
                child[1] = True

    def update(self, dt):
        if self.running:
            if dt > 0:
                self.progress = (self.progress + self.speed*self.scale*p.f(dt)/360) % 1
            self.apply()

    def replace(self, palette):
        # applyPalette returns for empty; cachePalette clones then dirties before
        # synchronous CPU refresh. Only populated consumer paths refresh here.
        if not palette:
            return
        self.palette = palette.copy()
        self.refreshed = (self.state.copy(), self.running, self.space)
        self.revision += 1
        self.dirty = True

    def draw(self):
        if self.dirty or self.texture is None:
            self.texture = [sample(self.palette, p.f(i/255), self.state, self.running, self.space) for i in range(256)]
            self.dirty = False
            self.builds += 1

    def row(self, include_texture=False):
        result = dict(state=self.state.copy(), revision=self.revision, running=self.running,
            progress=self.progress, speedScale=self.scale, base=self.base,
            current=[sample(self.palette, u, self.state, self.running, self.space) for u in COORDINATES],
            refreshed=None if self.refreshed is None else [sample(self.palette, u, *self.refreshed) for u in COORDINATES],
            textureDirty=self.dirty, textureBuilds=self.builds)
        if include_texture:
            result['texture'] = self.texture.copy()
        return result


def run_case(name, palette, operations):
    r = Runtime(palette)
    rows = [r.row()]
    for op in operations:
        kind = op['kind']
        if kind == 'begin':
            r.begin(op['actions'])
        elif kind == 'interpolate':
            r.interpolate(op['eased'], op['finished'])
        elif kind == 'update':
            r.update(op['dt'])
        elif kind == 'draw':
            r.draw()
        elif kind == 'replace':
            r.replace(op['palette'])
        else:
            raise ValueError(kind)
        rows.append(r.row(kind == 'draw'))
    return dict(name=name, palette=palette, operations=operations, rows=rows)


def start(mode, space, speed=90):
    return dict(kind='start', mode=mode, interpolation=space, speed=speed)


def begin(*actions):
    return dict(kind='begin', actions=list(actions))


def interp(eased, finished=False):
    return dict(kind='interpolate', eased=eased, finished=finished)


def fixtures():
    stop = dict(kind='stop')
    draw = dict(kind='draw')
    update = lambda dt: dict(kind='update', dt=dt)
    cases = []
    for mode in MODES:
        for space in SPACES:
            # Last dirty advance is intentionally not drawn before stop: texture
            # observes stopped mode; CPU refresh retains the last running recipe.
            operations = [draw, begin(start(mode, space)), interp(.5), update(.25), draw,
                interp(1, True), update(.25), begin(stop), interp(.5), update(.25),
                interp(1, True), update(.25), draw, draw, begin(start(mode, space)),
                interp(1, True), update(.25), draw]
            cases.append(run_case(mode+'-'+space, PALETTE, operations))
    for name, groups in [('idle-stop-start', [[stop, start('hue_rotate', 'oklch')]]),
                         ('idle-start-stop', [[start('hue_rotate', 'oklch'), stop]]),
                         ('running-stop-start', [[start('cross_fade', 'linear')], [stop, start('palette_morph', 'oklab')]])]:
        operations = [draw]
        for group in groups:
            operations += [begin(*group), interp(.5), update(.25), draw, interp(1, True), update(.25), draw]
        cases.append(run_case(name, PALETTE, operations))
    for initial_draw in [False, True]:
        # HUE_ROTATE progress0 maps exactly to zero. Start and changing the
        # selected interpolation alone must not dirty already-cached colors.
        operations = ([draw] if initial_draw else []) + [begin(start('hue_rotate', 'linear', 0)),
            interp(1, True), draw, begin(start('hue_rotate', 'oklch', 0)), interp(1, True),
            update(.5), draw, begin(stop), interp(1, True), draw]
        cases.append(run_case('same-value-config-'+('drawn' if initial_draw else 'undrawn'), PALETTE, operations))
    for name, palette in [('single', [0x35abcdef]), ('empty-constructor-default', [])]:
        cases.append(run_case(name, palette, [draw, begin(start('cross_fade', 'oklch')), interp(1, True), update(.5), draw, begin(stop), interp(1, True), draw]))
    cases.append(run_case('palette-edit-refresh-without-offset-change', PALETTE,
        [draw, dict(kind='replace', palette=[]), draw, begin(start('hue_rotate', 'oklab', 0)),
         dict(kind='replace', palette=PALETTE), draw, begin(stop), interp(1, True),
         dict(kind='replace', palette=PALETTE), draw,
         dict(kind='replace', palette=[0x20000000, 0x80ffffff, 0xd03040ff]), draw]))
    sampler_cases = [dict(name=name, palette=palette, running=running, interpolation=space,
        state=p.state(.25, .75, .2), samples=[sample(palette, u, p.state(.25, .75, .2), running, space) for u in COORDINATES])
        for name, palette in [('empty-defensive-white', []), ('single-packed-alpha', [0x35abcdef])]
        for running in [False, True] for space in SPACES]
    # Independent initial CPU particle gradient has inclusive last endpoint;
    # it is intentionally NOT represented by the initial stopped sampler recipe.
    initial_particles = []
    for count in [1, 2, 5, 17]:
        colors = []
        for i in range(count):
            position = 0 if count == 1 else p.f(p.mul(len(PALETTE)-1, i)/p.f(count-1))
            index, fraction = int(position), p.f(math.fmod(position, 1))
            if i == count-1:
                index, fraction = len(PALETTE)-2, 1.
            index = max(0, min(index, len(PALETTE)-2))
            colors.append(p.rgb(PALETTE[index], PALETTE[index+1], fraction))
        initial_particles.append(dict(count=count, colors=colors))
    return dict(provenance=dict(kind='independent-static-instruction-transcription', nativeExecution=False,
        jarSha256='a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018',
        classSha256='ef1de66f25e6fed5a126cb260005d0b5d7fd161118cc83993f0648009de96d92',
        methods=['PerlinNoiseField.<init> PC7/17/22/27/711–737', 'applyGradientFrame PC0–163',
            'applyGradientState PC0–152', 'sampleGradientPalette PC0–78', 'sampleShiftedPalette PC0–254',
            'ensureGpuResources PC24–39', 'rebuildPaletteTexture PC0–89', 'initParticles PC0–154',
            'ManimColors.gradient PC0–175', 'ManimColors.lerp/lerpLinearRgb/lerpOklab/lerpOklch',
            'GradientAnimator/GradientRuntimeState/StartGradientAnimation/StopGradientAnimation'],
        limitations=['Python libm, no JVM execution or framebuffer parity',
            'Empty samplerCases exercise defensive white; runtime constructor normalizes empty to DEFAULT_PALETTE',
            'refreshed is null until an actual refresh; initial CPU particles use inclusive endpoint gradient in initialParticles',
            'revision is an oracle count of scalar or palette replacement refreshes, not a field present in the original class',
            'No particle dynamics, curve geometry, GPU texture filtering, source render clock or seed-space random generator verification']),
        coordinates=COORDINATES, cases=cases, samplerCases=sampler_cases, initialParticles=initial_particles)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    data = fixtures()
    text = json.dumps(data, indent=2, allow_nan=False)+'\n'
    if args.check:
        if not OUT.exists() or OUT.read_text() != text:
            raise SystemExit('Perlin color fixture differs; regenerate and review')
    else:
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(text)
    print(json.dumps(dict(cases=len(data['cases']), rows=sum(len(c['rows']) for c in data['cases']), sha256=hashlib.sha256(text.encode()).hexdigest())))


if __name__ == '__main__':
    main()
