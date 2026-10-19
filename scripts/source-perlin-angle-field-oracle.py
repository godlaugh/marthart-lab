#!/usr/bin/env python3
"""Independent static CPU Perlin angle-field transcription, never product TS.

Source methods: PerlinNoiseField.buildAngleField/fbm/sampleFieldAngle/angleLerp.
Reuses the independently transcribed Processing noise reference. Neither the
original Java runtime nor a native framebuffer is executed. --check is read-only.
"""
import argparse
import hashlib
import importlib.util
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT/'tests/fixtures/source-perlin/angle-field.json'
spec = importlib.util.spec_from_file_location('processing_reference', ROOT/'scripts/source-perlin-flow-oracle.py')
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)
f, add, sub, mul, div = p.f, p.add, p.sub, p.mul, p.div
PI, TAU = f(math.pi), f(math.tau)


def clamp(value, lo, hi):
    return max(lo, min(hi, value))


def angle_lerp(a, b, t):
    # frem has the dividend's sign. PC17-32 repairs only d < -PI, not <=.
    a, b, t = f(a), f(b), f(t)
    d = sub(f(math.fmod(add(sub(b, a), PI), TAU)), PI)
    if d < -PI:
        d = add(d, TAU)
    return add(a, mul(d, clamp(t, 0., 1.)))


def fbm(noise, x, y, octaves):
    result, amplitude, weight, frequency = 0., 1., 0., 1.
    for _ in range(max(1, min(6, octaves))):
        result = add(result, mul(noise.sample(mul(x, frequency), mul(y, frequency), 0.), amplitude))
        weight = add(weight, amplitude)
        amplitude, frequency = mul(amplitude, .5), mul(frequency, 2.)
    return div(result, weight) if weight > 0 else 0.


def shape(width, height, cell):
    # Finite positive dimensions exercised here; source round is ties towards +∞.
    build_cell = max(4, cell)
    return [max(2, math.floor(div(width, build_cell)+.5)+1), max(2, math.floor(div(height, build_cell)+.5)+1)]


def build(config):
    seed = p.texture_seed(int(config['seed']))
    # buildAngleField itself does not reseed. Explicit override diagnoses this
    # shared-noise ownership; default is the CPU constructor's noiseSeed call.
    noise_seed = int(config.get('noiseSeed', str(seed)))
    noise = p.Noise(noise_seed)
    nx, ny = shape(config['width'], config['height'], config['fieldCellSize'])
    sx = mul(div(seed & 65535, 65535), 10.)
    sy = mul(div((seed & 0xffffffff) >> 16, 65535), 10.)
    scale, offset, angle_scale = f(config['curveNoiseScale']), f(config['curveNoiseOffset']), f(config['curveAngleScale'])
    angles = []
    for x in range(nx):
        column = []
        for y in range(ny):
            noise_value = fbm(noise, add(sx, mul(div(x, nx-1), scale)), add(sy, mul(div(y, ny-1), scale)), config['curveNoiseOctaves'])
            column.append(mul(mul(mul(add(offset, noise_value), PI), .7), angle_scale))
        angles.append(column)
    return angles


def sample(angles, config, x, y, width=None, height=None):
    if not angles or len(angles) < 2 or len(angles[0]) < 2:
        return 0.
    nx, ny = len(angles), len(angles[0])
    width = f(config['width'] if width is None else width)
    height = f(config['height'] if height is None else height)
    x = clamp(f(x), 0., max(0., sub(width, .001)))
    y = clamp(f(y), 0., max(0., sub(height, .001)))
    # Deliberately max1 here versus build's max4: source uses two boundaries.
    cell = max(1., f(config['fieldCellSize']))
    gx, gy = div(x, cell), div(y, cell)
    ix, iy = max(0, min(nx-2, math.floor(gx))), max(0, min(ny-2, math.floor(gy)))
    tx, ty = clamp(sub(gx, ix), 0., 1.), clamp(sub(gy, iy), 0., 1.)
    a = angle_lerp(angles[ix][iy], angles[ix+1][iy], tx)
    b = angle_lerp(angles[ix][iy+1], angles[ix+1][iy+1], tx)
    angle = angle_lerp(a, b, ty)
    shift = mul(mul(mul(config['noiseOffset'], PI), .7), config['curveAngleScale'])
    return add(angle, shift)


def run(name, **overrides):
    config = dict(seed='0', width=22., height=10., fieldCellSize=4, curveNoiseScale=1.2,
                  curveNoiseOctaves=2, curveNoiseOffset=0., curveAngleScale=4., noiseOffset=0.)
    config.update(overrides)
    angles = build(config)
    w, h, cell = config['width'], config['height'], config['fieldCellSize']
    points = [[0.,0.], [w,h], [-3.,-1.], [w+20.,h+20.], [w/2,h/2],
              [cell,cell], [cell-.0001,cell+.0001], [w-.001,h-.001], [w/3,h/7]]
    # Width/height are call arguments, not implicitly inferred from the array.
    alternate = dict(point=[w/2,h/2], width=w/2, height=h/3)
    alternate['expected'] = sample(angles, config, *alternate['point'], alternate['width'], alternate['height'])
    return dict(name=name, input=config, nx=len(angles), ny=len(angles[0]), angles=angles,
                points=points, samples=[sample(angles,config,*point) for point in points], alternateExtent=alternate)


def mix64(value):
    mask = (1 << 64)-1
    value &= mask
    value = ((value ^ (value >> 33)) * -49064778989728563) & mask
    value = ((value ^ (value >> 33)) * -4265267296055464877) & mask
    value ^= value >> 33
    return value if value < (1 << 63) else value-(1 << 64)


def seed_facts(raw):
    random_seed = raw if -(1 << 31) <= raw < (1 << 31) else mix64(raw)
    texture_seed = ((random_seed+(1 << 31)) & 0xffffffff)-(1 << 31)
    return dict(rawSeed=str(raw), textureSeed=texture_seed, randomSeed=str(random_seed),
                curveRngSeed=str(mix64(raw ^ 7866515270071974961)))


class Random48:
    def __init__(self, seed):
        self.state = (seed ^ 0x5deece66d) & ((1 << 48)-1)

    def next_float(self):
        self.state = (self.state*0x5deece66d+11) & ((1 << 48)-1)
        return f((self.state >> 24)/(1 << 24))


def curve_seeds(seed, count, width, height, sampling):
    rng = Random48(mix64(seed ^ 7866515270071974961))
    width, height = f(width), f(height)
    aspect = max(f(.0001), div(width, max(1., height)))
    cols = max(1, math.ceil(math.sqrt(mul(count, aspect))))
    rows = max(1, math.ceil(count/cols))
    cw, ch = div(width, cols), div(height, rows)
    points = []
    for i in range(count):
        if sampling == 'random':
            point = [mul(rng.next_float(), width), mul(rng.next_float(), height)]
        else:
            jx, jy = add(.18, mul(.64, rng.next_float())), add(.18, mul(.64, rng.next_float()))
            point = [min(width, mul(add(i % cols, jx), cw)),
                     min(height, mul(add(i // cols, jy), ch))]
        points.append(point)
    return points


def curve_path(angles, config, point, length, step, width, height):
    # fillFieldCurve integrates independently in each direction from the seed.
    xs, ys = [0.]*length, [0.]*length
    if not length:
        return xs, ys
    middle = length//2
    half_w, half_h = mul(width, .5), mul(height, .5)
    xs[middle], ys[middle] = sub(point[0], half_w), sub(point[1], half_h)
    for indices, op in [(range(middle-1,-1,-1), sub), (range(middle+1,length), add)]:
        x, y = point
        for i in indices:
            angle = sample(angles, config, x, y, width, height)
            x = op(x, mul(f(math.cos(angle)), step))
            y = op(y, mul(f(math.sin(angle)), step))
            xs[i], ys[i] = sub(x, half_w), sub(y, half_h)
    return xs, ys


def geometry_case(name, field, **overrides):
    config = dict(seed=field['input']['seed'], count=3, length=5,
                  width=field['input']['width'], height=field['input']['height'],
                  sampling='random', stepSize=31.25, noiseOffset=-.75)
    config.update(overrides)
    w, h = f(config['width']), f(config['height'])
    if w < 200 or h < 200:
        w = h = 800.
    count, length = max(1, config['count']), max(2, config['length'])
    points = curve_seeds(int(config['seed']), count, w, h, config['sampling'])
    def paths(offset):
        field_config = dict(field['input'], noiseOffset=offset)
        xs, ys = [], []
        for point in points:
            x, y = curve_path(field['angles'], field_config, point, length, config['stepSize'], w, h)
            xs.extend(x); ys.extend(y)
        return dict(xs=xs,ys=ys)
    return dict(name=name, angleFieldCase=field['name'], input=config,
                effectiveWidth=w,effectiveHeight=h,seeds=points,**paths(config['noiseOffset']),
                rebuild=dict(noiseOffset=.625,**paths(.625)))


def fixtures():
    cases = [run('non-square-half-cell-rounding'),
        run('non-square-short-last-cell', width=21., height=9.),
        run('negative-offset-and-seed', seed='-1', noiseOffset=-.75, curveNoiseOffset=-1.25),
        run('large-long-seed', seed='9223372036854775807', width=13., height=25., curveNoiseOctaves=6),
        run('minimum-long-seed', seed='-9223372036854775808', width=9., height=17.),
        run('raw-cell-one-build-versus-sample', fieldCellSize=1, width=7., height=11.),
        run('raw-cell-zero-build-versus-sample', fieldCellSize=0, width=7., height=11.),
        run('fractional-extents-minimum-grid', width=.0005, height=3.5, fieldCellSize=20, curveNoiseScale=.01, curveAngleScale=.1),
        run('octaves-below-minimum', curveNoiseOctaves=-3),
        run('octaves-above-maximum', curveNoiseOctaves=17),
        run('large-angle-wrapping', curveAngleScale=37., curveNoiseOffset=5.2, noiseOffset=-.91),
        run('shared-noise-owner-changed', noiseSeed=str(p.style_seed(0,5))),
        run('curve-viewport-non-square', width=320.,height=200.,fieldCellSize=80,seed='9223372036854775807'),
        run('curve-viewport-fallback', width=800.,height=800.,fieldCellSize=200,seed='-9223372036854775808',curveAngleScale=37.,curveNoiseOffset=-1.25)]
    geometry = [geometry_case('random-odd-long-seed',cases[-2]),
                geometry_case('jittered-even-negative-step',cases[-2],sampling='jittered-grid',count=5,length=6,stepSize=-19.5),
                geometry_case('random-crosses-field-boundary',cases[-2],count=2,length=7,stepSize=350.),
                geometry_case('jittered-minimum-count-length-zero-step',cases[-2],sampling='jittered-grid',count=0,length=0,stepSize=0.),
                geometry_case('width-small-both-extents-fallback',cases[-1],width=199.,height=600.,sampling='jittered-grid',count=2,length=4),
                geometry_case('height-small-both-extents-fallback',cases[-1],width=600.,height=199.,count=1,length=3)]
    seeds = [seed_facts(s) for s in [0,-1,2147483647,-2147483648,2147483648,-2147483649,9007199254740993,9223372036854775807,-9223372036854775808]]
    lerps = []
    for name,a,b,t in [('positive-seam',3.1,-3.1,.5),('negative-seam',-3.1,3.1,.5),
                       ('positive-pi-tie',0,PI,.5),('negative-pi-tie',0,-PI,.5),
                       ('beyond-two-turns',32.,-25.,.3),('negative-remainder',4.,-20.,.75),
                       ('clamp-low',.2,1.8,-.5),('clamp-high',.2,1.8,1.5),
                       ('equal-float-rounded',100000000.,100000001.,.5)]:
        lerps.append(dict(name=name,a=a,b=b,t=t,expected=angle_lerp(a,b,t)))
    noise = p.Noise(12345)
    fbms = [dict(x=x,y=y,octaves=o,expected=fbm(noise,x,y,o)) for x,y,o in
            [(0.,0.,1),(.25,.75,2),(-.25,-.75,2),(10.2,-4.3,6),(.125,.375,0),(.125,.375,9)]]
    synthetic = [[f(3.1),f(-3.1)],[f(-3.),f(3.)]]
    synthetic_config = dict(width=8.,height=8.,fieldCellSize=8,noiseOffset=-.5,curveAngleScale=2.)
    synthetic_points = [[0.,0.],[4.,4.],[8.,8.],[-1.,100.]]
    layouts = [dict(width=w,height=h,fieldCellSize=c,shape=shape(w,h,c))
               for w,h,c in [(800.,600.,20),(9.999999,6.,4),(10.,6.,4),(10.000001,6.,4),(1e6,1e6,4)]]
    return dict(provenance=dict(kind='independent-static-instruction-transcription',nativeExecution=False,
        jarSha256='a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018',
        classSha256='ef1de66f25e6fed5a126cb260005d0b5d7fd161118cc83993f0648009de96d92',
        processingJarSha256='89410e2c4f59cb4b4aeb2a3baeaf6a4bc189d6e1c612920c3f8e0f58b62a769a',
        methods=['buildAngleField PC0-246','fbm PC0-100','sampleFieldAngle PC0-248','angleLerp PC0-45',
                 'mix64 PC0-28','sampleCurveSeed PC0-179','fillFieldCurve PC0-266','initFieldCurves PC0-241'],
        limits=['No original Java/JOGL/framebuffer execution; Python libm is not native equality proof.',
                'Arrays are x-major: angles[x][y]. Configs describe object fields, not JSON parsing or defaults.',
                'Raw cell0/1 and tiny extents are diagnostic method inputs; constructor/import admissibility is separate.',
                'Build does not reseed Processing noise. Explicit noiseSeed case models a previously changed shared owner.',
                'Large layout is count-only; no original resource limit or allocation success is asserted.',
                'Curve paths are centered XY arrays, each curve contiguous. Rebuild retains seeds and changes only noiseOffset.',
                'No color, rendering, or native whole-frame parity. Small curve counts are diagnostic coverage, not original full-scene output.']),
        cases=cases,angleLerpCases=lerps,fbmNoiseSeed='12345',fbmCases=fbms,
        syntheticInterpolation=dict(input=synthetic_config,angles=synthetic,points=synthetic_points,
                                    expected=[sample(synthetic,synthetic_config,*point) for point in synthetic_points]),
        missingFieldSamples=[dict(angles=a,expected=sample(a,synthetic_config,4,4)) for a in [[],[[1.]],[[1.,2.]]]],
        layoutCases=layouts,seedCases=seeds,curveGeometryCases=geometry)


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--check',action='store_true')
    args=parser.parse_args()
    data=fixtures()
    compact=lambda value:json.dumps(value,separators=(',', ':'),allow_nan=False)
    lines=['{','"provenance":'+compact(data['provenance'])+',','"cases":[']
    lines += [compact(case)+(',' if i+1<len(data['cases']) else '') for i,case in enumerate(data['cases'])]
    lines += ['],']
    other=[key for key in data if key not in ['provenance','cases']]
    lines += [json.dumps(key)+':'+compact(data[key])+(',' if i+1<len(other) else '') for i,key in enumerate(other)]
    text='\n'.join(lines+['}', ''])
    if args.check:
        if not OUT.exists() or OUT.read_text()!=text:raise SystemExit('Perlin angle field fixture differs; regenerate and review')
    else:
        OUT.parent.mkdir(parents=True,exist_ok=True);OUT.write_text(text)
    print(json.dumps(dict(cases=len(data['cases']),nodes=sum(c['nx']*c['ny'] for c in data['cases']),samples=sum(len(c['samples'])+1 for c in data['cases']),bytes=len(text.encode()),sha256=hashlib.sha256(text.encode()).hexdigest())))


if __name__=='__main__':
    main()
