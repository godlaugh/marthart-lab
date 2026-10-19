#!/usr/bin/env python3
"""Independent static Perlin CPU curve-color oracle from retained bytecode.

Imports only independent Python references, never product TypeScript. Original
Java/JOGL execution and native whole-frame equality are outside this fixture.
"""
import argparse
import hashlib
import importlib.util
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT/'tests/fixtures/source-perlin/curve-colors.json'


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT/'scripts'/filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


c = load('color_reference', 'source-perlin-color-oracle.py')
a = load('angle_reference', 'source-perlin-angle-field-oracle.py')
f, add, sub, mul, div = a.f, a.add, a.sub, a.mul, a.div
PALETTE = [0x10ff0000, 0x8000ff00, 0xf00000ff]
REPLACEMENT = [0x00ffffff, 0xff102030, 0x604080c0, 0xb0ff8800]


def blobs(config, runtime):
    rng = a.Random48(a.mix64(int(config['seed']) ^ -7046029254386353131))
    lo = max(0., f(config['minRadius']))
    hi = max(lo, f(config['maxRadius']))
    result = []
    for _ in range(max(0, config['circleCount'])):
        x, y = mul(rng.next_float(), config['width']), mul(rng.next_float(), config['height'])
        radius = add(lo, mul(rng.next_float(), sub(hi, lo)))
        color = c.shifted(runtime.palette, rng.next_float(), 0., runtime.running, runtime.space)
        result.append(dict(x=x,y=y,radius=radius,color=color))
    return result


def seed_space(config, point, circles, sampler):
    x, y = f(point['x']), f(point['y'])
    u = a.clamp(div(x, max(1., f(config['width']))), 0., 1.)
    v = a.clamp(div(y, max(1., f(config['height']))), 0., 1.)
    color = sampler(mul(add(u, v), .5))
    for blob in circles or []:
        if blob is None:
            continue
        dx, dy = sub(x, blob['x']), sub(y, blob['y'])
        distance = f(math.sqrt(add(mul(dx, dx), mul(dy, dy))))
        if distance < blob['radius']:
            t = sub(1., div(distance, blob['radius']))
            smooth = mul(mul(t, t), sub(3., mul(2., t)))
            color = c.lerp(color, blob['color'], smooth, 'rgb')
    return color


def resolve(config, point, circles, runtime, snapshot=None):
    state, running, space = snapshot or (runtime.state, runtime.running, runtime.space)
    sampler = lambda u: c.sample(runtime.palette, u, state, running, space)
    mode = config['mode']
    if mode == 'seed_space':
        return seed_space(config, point, circles, sampler)
    x = div(point['x'], max(1., f(config['width'])))
    y = div(point['y'], max(1., f(config['height'])))
    if mode == 'noise':
        noise = a.p.Noise(int(config.get('noiseSeed', str(a.p.texture_seed(int(config['seed']))))))
        q = a.fbm(noise, mul(x, config['curveNoiseScale']), mul(y, config['curveNoiseScale']), config['curveNoiseOctaves'])
    elif mode == 'index':
        q = 0. if point['count'] <= 1 else div(point['index'], point['count']-1)
    else:
        q = add(mul(.65, x), mul(.35, y))
    return sampler(q)


def operations():
    return [dict(kind='begin',actions=[dict(kind='start',mode='hue_rotate',interpolation='linear',speed=120.)]),
            dict(kind='interpolate',eased=1.,finished=True),dict(kind='update',dt=.75),
            dict(kind='begin',actions=[dict(kind='stop')]),dict(kind='interpolate',eased=1.,finished=True),
            dict(kind='replace',palette=REPLACEMENT),
            dict(kind='begin',actions=[dict(kind='start',mode='cross_fade',interpolation='oklab',speed=270.)]),
            dict(kind='interpolate',eased=.5,finished=False),dict(kind='update',dt=.37),
            dict(kind='replace',palette=PALETTE),
            dict(kind='begin',actions=[dict(kind='start',mode='palette_morph',interpolation='oklch',speed=-90.)]),
            dict(kind='interpolate',eased=1.,finished=True),dict(kind='update',dt=.61),dict(kind='replace',palette=[])]


def run(name, mode='seed_space', ops=None, **overrides):
    config = dict(seed='9223372036854775807',width=320.,height=200.,circleCount=3,
                  minRadius=180.,maxRadius=260.,curveNoiseScale=1.2,curveNoiseOctaves=2,
                  mode=mode,palette=PALETTE)
    config.update(overrides)
    runtime = c.Runtime(config['palette'])
    circles = blobs(config, runtime)
    xy = [(0.,0.),(320.,200.),(-20.,250.),(160.,100.)]
    if circles:
        xy += [(circles[0]['x'],circles[0]['y'])]
    points = [dict(index=i,count=len(xy),x=x,y=y) for i,(x,y) in enumerate(xy)]
    points[0]['count'] = 1  # INDEX single-curve branch; ignored by other modes.
    ops = operations() if ops is None else ops
    current = lambda snapshot=None:[resolve(config,p,circles,runtime,snapshot) for p in points]
    cached = current()
    def row():
        return dict(state=runtime.state.copy(),running=runtime.running,interpolation=runtime.space,
                    revision=runtime.revision,currentColors=current(),cachedColors=cached.copy(),
                    blobColors=[b['color'] for b in circles])
    rows = [row()]
    for op in ops:
        revision = runtime.revision
        if op['kind'] == 'begin':runtime.begin(op['actions'])
        elif op['kind'] == 'interpolate':runtime.interpolate(op['eased'],op['finished'])
        elif op['kind'] == 'update':runtime.update(op['dt'])
        elif op['kind'] == 'replace':runtime.replace(op['palette'])
        else:raise ValueError(op['kind'])
        # Runtime retains the synchronous refresh context. A completed stop can
        # leave current sampling stopped while the cached color is still cyclic.
        if runtime.revision != revision:
            cached = current(runtime.refreshed)
        rows.append(row())
    return dict(name=name,input=config,blobRngSeed=str(a.mix64(int(config['seed']) ^ -7046029254386353131)),
                points=points,blobs=circles,operations=ops,rows=rows)


def fixtures():
    cases = [run('lifecycle-'+mode,mode=mode) for mode in ['seed_space','noise','index','position']]
    cases += [run('negative-long-reversed-radius',seed='-9223372036854775808',minRadius=75.,maxRadius=20.,ops=[]),
              run('negative-count-no-blobs',seed='-1',circleCount=-3,ops=[]),
              run('negative-radii-zero-radius',seed='0',minRadius=-20.,maxRadius=-1.,ops=[]),
              run('single-alpha-palette',seed='2147483648',palette=[0x12345678],ops=[])]
    config = dict(width=100.,height=80.)
    circle_a = dict(x=40.,y=40.,radius=40.,color=0x20ff0000)
    circle_b = dict(x=60.,y=40.,radius=40.,color=0xe00000ff)
    zero = dict(x=50.,y=40.,radius=0.,color=0xffffffff)
    runtime = c.Runtime(PALETTE)
    points = [dict(x=x,y=y) for x,y in [(50.,40.),(40.,40.),(80.,40.),(0.,40.),(-50.,140.)]]
    overlaps = []
    for name, circles in [('forward',[circle_a,circle_b]),('reverse',[circle_b,circle_a]),
                          ('null-and-zero',[None,circle_a,zero,circle_b]),('missing',None)]:
        overlaps.append(dict(name=name,input=config,blobs=circles,points=points,
            palette=PALETTE,state=runtime.state.copy(),running=False,interpolation='rgb',
            expected=[seed_space(config,p,circles,lambda q:c.sample(runtime.palette,q,runtime.state,False,'rgb')) for p in points]))
    return dict(provenance=dict(kind='independent-static-instruction-transcription',nativeExecution=False,
        jarSha256='a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018',
        classSha256='ef1de66f25e6fed5a126cb260005d0b5d7fd161118cc83993f0648009de96d92',
        gradientActionConfigClassSha256='aac233667191d07c592bd43cb72f18f19b7330c4a6e90770bbe686e95ebdc2f2',
        gradientRuntimeStateClassSha256='cf5739c2cd51f12404776a7aa475a3f07b7157b4b9d617fae1f72649c7b8f9d5',
        methods=['resolveCurveColor PC0-155','buildSeedColorSpace PC0-144','sampleSeedSpaceColor PC0-189',
                 'refreshFieldCurveColors PC0-186','applyGradientState','applyPalette',
                 'GradientActionConfig.parseNonNegative PC0-95 / sanitize PC0-44',
                 'GradientRuntimeState.start PC0-107'],
        limits=['Independent Python references only; no product TypeScript import, JVM execution or framebuffer comparison.',
                'Cached colors update only on source refresh; stopping without a scalar change may leave cached cyclic colors.',
                'Blob packed colors persist through palette/gradient changes; overlap interpolation is always RGB including packed alpha.',
                'Source stroke later ignores packed alpha and uses curveAlpha. These values describe stored curve colors, not displayed opacity.',
                'Raw finite negative action speed is retained in input and sanitized to zero, as both source JSON import and runtime start require.',
                'Synthetic null/reordered blobs and raw negative configuration fields are method diagnostics; import admissibility is separate.']),
        cases=cases,syntheticOverlapCases=overlaps)


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--check',action='store_true')
    args=parser.parse_args()
    data=fixtures()
    compact=lambda v:json.dumps(v,separators=(',',':'),allow_nan=False)
    text='{\n'+',\n'.join(json.dumps(k)+':'+compact(v) for k,v in data.items())+'\n}\n'
    if args.check:
        if not OUT.exists() or OUT.read_text()!=text:raise SystemExit('Curve-color fixture differs; regenerate and review')
    else:
        OUT.parent.mkdir(parents=True,exist_ok=True);OUT.write_text(text)
    print(json.dumps(dict(cases=len(data['cases']),rows=sum(len(c['rows']) for c in data['cases']),
        bytes=len(text.encode()),sha256=hashlib.sha256(text.encode()).hexdigest())))


if __name__=='__main__':main()
