#!/usr/bin/env python3
"""Independent Perlin CPU particle instruction oracle; never imports product TS.

Reuses the separately transcribed Processing noise primitive. Python libm is
not JVM execution or native framebuffer parity evidence. Configs describe
runtime fields, not source-JSON parsing. Diagnostic state overrides are only
fixture probes and are not requests for a public restore API. --check is read-only.
"""
import argparse
import copy
import hashlib
import importlib.util
import json
import math
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures/source-perlin/particles.json'
spec = importlib.util.spec_from_file_location('processing_noise_oracle', Path(__file__).with_name('source-perlin-flow-oracle.py'))
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)
f, add, sub, mul, div = p.f, p.add, p.sub, p.mul, p.div
PI, TAU, EPS = f(math.pi), f(math.tau), f(.0001)


def mix64(seed):
    x = seed & p.MASK64
    x = ((x ^ (x >> 33)) * -49064778989728563) & p.MASK64
    x = ((x ^ (x >> 33)) * -4265267296055464877) & p.MASK64
    x ^= x >> 33
    return x-(1 << 64) if x >= 1 << 63 else x


class Random:
    def __init__(self, seed):
        self.state = (seed ^ 25214903917) & p.MASK48

    def next_float(self):
        self.state = (self.state * 25214903917+11) & p.MASK48
        return (self.state >> 24)/(1 << 24)

    def high(self, high):
        high = f(high)
        if high == 0 or math.isnan(high):
            return 0.
        while True:
            value = mul(self.next_float(), high)
            if value != high:
                return value

    def between(self, low, high):
        low, high = f(low), f(high)
        if low >= high:
            return low
        while True:
            value = add(self.high(sub(high, low)), low)
            if value != high:
                return value


def bounds(width, height):
    w, h = f(width), f(height)
    return (800., 800.) if w < 200 or h < 200 else (w, h)


def squared(x, y):
    return add(mul(x, x), mul(y, y))


def trig(angle):
    return [f(math.cos(angle)), f(math.sin(angle))]


def smooth(value):
    t = max(0., min(1., f(value)))
    return mul(mul(t, t), sub(3, mul(2, t)))


class Motion:
    def __init__(self, config):
        self.config = config.copy()
        seed = int(config['seed'])
        self.texture_seed = p.texture_seed(seed)
        self.random_seed = seed if -(1 << 31) <= seed < (1 << 31) else mix64(seed)
        self.random = Random(self.random_seed)
        self.noise = p.Noise(self.texture_seed)
        w, h = bounds(config['width'], config['height'])
        self.positions, self.velocities = [], []
        for _ in range(config['particleCount']):
            self.positions.append([self.random.between(div(-w, 2), div(w, 2)), self.random.between(div(-h, 2), div(h, 2)), 0.])
            self.velocities.append(trig(self.random.high(TAU)))

    def sample(self, x, y, z):
        a = self.noise.sample(x, y, z)
        b = self.noise.sample(add(mul(x, 2), 17.31), add(mul(y, 2), 9.73), mul(z, 1.37))
        return add(mul(a, .72), mul(b, .28))

    def angle_map(self, value):
        t = max(0., min(1., value))
        return f(math.pow(t, f(1.5))) if self.config['angleMap'] == 'SOFT_POWER' else t

    def snapshot(self):
        return dict(positions=copy.deepcopy(self.positions), velocities=copy.deepcopy(self.velocities), randomState=str(self.random.state))

    def update(self, request):
        c = self.config
        for key in ['width', 'height']:
            if key in request:
                c[key] = request[key]
        for key in ['positions', 'velocities']:
            if key in request:
                setattr(self, key, [[f(value) for value in row] for row in request[key]])
        time, dt = f(request['time']), max(0., f(request['dt']))
        w, h = bounds(c['width'], c['height'])
        hx, hy = mul(w, .5), mul(h, .5)
        base = mul(mul(c['stepSize'], dt), 60)
        prob = min(1., mul(c['respawnRate'], dt))
        seed_x = mul(div(self.texture_seed & 65535, 65535), 10)
        seed_y = mul(div((self.texture_seed >> 16) & 65535, 65535), 10)
        wrapped, respawned, steps = [], [], []
        for i, position in enumerate(self.positions):
            x, y, _ = position
            u, v = div(add(x, hx), max(1., w)), div(add(y, hy), max(1., h))
            nx, ny = add(seed_x, mul(u, c['noiseScale'])), add(seed_y, mul(v, c['noiseScale']))
            nz, offset = mul(time, c['timeScale']), mul(c['noiseOffset'], TAU)
            step = base
            if c['flowMode'] == 'VECTOR_FIELD':
                e = max(f(.015), min(f(.08), div(.65, max(1., f(c['noiseScale'])))))
                gx = div(sub(self.sample(add(nx, e), ny, nz), self.sample(sub(nx, e), ny, nz)), mul(2, e))
                gy = div(sub(self.sample(nx, add(ny, e), nz), self.sample(nx, sub(ny, e), nz)), mul(2, e))
                magnitude = f(math.sqrt(squared(gx, gy)))
                if magnitude > EPS:
                    candidate = [div(gy, magnitude), div(-gx, magnitude)]
                else:
                    candidate = self.velocities[i].copy()
                    if squared(*candidate) < EPS:
                        candidate = [1., 0.]
                if c['angleMap'] != 'LINEAR':
                    angle = f(math.atan2(candidate[1], candidate[0]))
                    mapped = self.angle_map(div(add(angle, PI), TAU))
                    candidate = trig(add(mul(mapped, TAU), offset))
                elif abs(f(c['noiseOffset'])) > EPS:
                    candidate = trig(add(f(math.atan2(candidate[1], candidate[0])), offset))
                old = self.velocities[i]
                if squared(*old) < EPS:
                    old = candidate
                strength = smooth(mul(magnitude, 2))
                blend = add(.18, mul(.36, strength))
                vx, vy = [add(a, mul(sub(b, a), blend)) for a, b in zip(old, candidate)]
                length = f(math.sqrt(squared(vx, vy)))
                velocity = [div(vx, length), div(vy, length)] if length > EPS else candidate.copy()
                step = mul(base, add(.9, mul(.2, strength)))
            else:
                angle = mul(self.angle_map(self.sample(nx, ny, nz)), TAU)
                if c['flowMode'] == 'SWIRL_FIELD':
                    angle = add(f(math.atan2(y, x)), angle)
                velocity = trig(add(angle, offset))
            self.velocities[i] = velocity
            x, y = add(x, mul(velocity[0], step)), add(y, mul(velocity[1], step))
            did_wrap = False
            if x < -hx:
                x, did_wrap = hx, True
            elif x > hx:
                x, did_wrap = -hx, True
            if y < -hy:
                y, did_wrap = hy, True
            elif y > hy:
                y, did_wrap = -hy, True
            did_respawn = prob > 0 and self.random.high(1) < prob
            if did_respawn:
                x, y = self.random.between(-hx, hx), self.random.between(-hy, hy)
            self.positions[i] = [x, y, 0.]
            wrapped.append(did_wrap)
            respawned.append(did_respawn)
            steps.append(step)
        # JSON module compilers can rewrite -0.0 into +0. Keep numeric source
        # values unchanged and independently retain the actual Float32 bits.
        bits = [struct.unpack('>I', struct.pack('>f', value))[0] for value in steps]
        return dict(**self.snapshot(), wrapped=wrapped, respawned=respawned, actualStep=steps, actualStepBits=bits)


DEFAULT = dict(seed='1771842692935', width=800, height=600, particleCount=3,
               noiseScale=8., noiseOffset=0., stepSize=.15, timeScale=.17,
               respawnRate=0., flowMode='ANGLE_FIELD', angleMap='LINEAR')
FRAMES = [dict(time=0., dt=1/30), dict(time=1/30, dt=1/30),
          dict(time=.271, dt=.007), dict(time=.28, dt=0.),
          dict(time=.25, dt=-.02), dict(time=3., dt=.1)]


def run(name, frames=None, diagnostic=False, **options):
    config = dict(DEFAULT, **options)
    owner = Motion(config)
    initial = dict(**owner.snapshot(), textureSeed=owner.texture_seed, randomSeed=str(owner.random_seed))
    rows = [dict(input=copy.deepcopy(request), expected=owner.update(request)) for request in (FRAMES if frames is None else frames)]
    return dict(name=name, diagnostic=diagnostic, config=config, initial=initial, frames=rows)


def fixtures():
    cases = [run(mode.lower()+'-'+angle.lower(), flowMode=mode, angleMap=angle, noiseOffset=-.31)
             for mode in ['ANGLE_FIELD', 'SWIRL_FIELD', 'VECTOR_FIELD'] for angle in ['LINEAR', 'SOFT_POWER']]
    for name, seed in [('int32-min', '-2147483648'), ('int32-max', '2147483647'), ('first-outside-int32', '2147483648'),
                       ('long-max', '9223372036854775807'), ('long-min', '-9223372036854775808'), ('zero-seed', '0')]:
        cases.append(run(name, seed=seed))
    cases += [run('small-height-forces-both-800', width=256, height=192),
              run('exact-200-does-not-fallback', width=200, height=200),
              run('resize-live-bounds', frames=[dict(time=0.,dt=1/30),dict(time=.1,dt=.1,width=200,height=256),dict(time=.2,dt=.01,width=199,height=600)]),
              run('wrap-large-step', stepSize=1000., frames=[dict(time=0.,dt=1.),dict(time=.5,dt=.5)]),
              run('wrap-then-respawn', stepSize=1000., respawnRate=60., frames=[dict(time=0.,dt=1.),dict(time=.5,dt=.5)]),
              run('respawn-certain', respawnRate=60., frames=[dict(time=0.,dt=1/30),dict(time=.2,dt=.1)]),
              run('respawn-probabilistic', particleCount=8, respawnRate=7.),
              run('negative-respawn-no-random', respawnRate=-9.),
              run('vector-zero-noise-scale', noiseScale=0., flowMode='VECTOR_FIELD'),
              run('vector-offset-epsilon-equality', noiseOffset=f(.0001), flowMode='VECTOR_FIELD'),
              run('negative-step', stepSize=-2., flowMode='SWIRL_FIELD'),
              run('empty-particles', particleCount=0),
              run('diagnostic-boundary-equality', diagnostic=True, frames=[dict(time=0.,dt=0.,positions=[[-400.,-300.,0.],[400.,300.,0.],[400.01,-300.01,0.]])]),
              run('diagnostic-zero-direction', diagnostic=True, noiseScale=0., flowMode='VECTOR_FIELD', frames=[dict(time=0.,dt=1/30,velocities=[[0.,0.],[.001,0.],[1.,0.]])])]
    return dict(schema=1, provenance=dict(kind='independent-static-instruction-transcription', nativeExecution=False,
        jarSha256='a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018',
        classSha256='ef1de66f25e6fed5a126cb260005d0b5d7fd161118cc83993f0648009de96d92',
        methods=['PerlinNoiseField.<init> PC584-648/mix64/initParticles', 'update PC64-1085/particleNoise/applyAngleMap/smooth01/wrapParticle', 'PApplet.random(F)/random(FF)/randomSeed/noise'],
        limits=['Python libm, no executed JVM or native framebuffer comparison.',
                'Runtime field inputs, not JSON parsing or parameter-drift orchestration.',
                'No trail storage/color/drawing; two diagnostic cases override arrays without prescribing public API.',
                'Positions retain source z=0; velocities are source speedU/speedV.',
                'actualStepBits holds unsigned Float32 bits; Vite JSON module conversion loses numeric negative zero.',
                'width/height overrides model changed PApplet dimensions, not export target dimensions.']), cases=cases)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    data = fixtures()
    compact = lambda x: json.dumps(x, separators=(',', ':'), allow_nan=False)
    lines = ['{', '"schema":1,', '"provenance":'+compact(data['provenance'])+',', '"cases":[']
    lines += [compact(case)+(',' if i+1 < len(data['cases']) else '') for i, case in enumerate(data['cases'])]
    text = '\n'.join(lines+[']}', ''])
    if args.check:
        if not OUT.exists() or OUT.read_text() != text:
            raise SystemExit('Perlin particles fixture differs; regenerate and review')
    else:
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(text)
    print(json.dumps(dict(cases=len(data['cases']), frames=sum(len(c['frames']) for c in data['cases']),
                         bytes=len(text.encode()), sha256=hashlib.sha256(text.encode()).hexdigest())))


if __name__ == '__main__':
    main()
