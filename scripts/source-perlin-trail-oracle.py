#!/usr/bin/env python3
"""Independent Perlin trail storage/sampling/draw-shape instruction oracle.

No product imports. NaN separator coordinates are serialized as null, retaining
one record and its original index. Append operations are isolated storage/draw
probes, not a proposal for a public arbitrary-state API. --check is read-only.
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
OUT = ROOT / 'tests/fixtures/source-perlin/trails.json'


def f(value):
    return struct.unpack('>f', struct.pack('>f', value))[0]


def add(a, b):
    return f(f(a)+f(b))


def sub(a, b):
    return f(f(a)-f(b))


def mul(a, b):
    return f(f(a)*f(b))


def div(a, b):
    return f(f(a)/f(b))


def squared(x, y):
    return add(mul(x, x), mul(y, y))


def encode(value):
    if isinstance(value, float) and math.isnan(value):
        return None
    if isinstance(value, list):
        return [encode(v) for v in value]
    if isinstance(value, dict):
        return {k: encode(v) for k, v in value.items()}
    return value


class Trail:
    def __init__(self, config):
        self.config = config.copy()
        self.maximum = max(0, config['capacity']) if not config['accumulation'] else 0
        self.capacity = min(360, self.maximum)
        self.records = []
        if not config['accumulation']:
            self.append(config['initialPosition'], 0.)

    def append(self, position, time):
        if not self.capacity:
            return
        if len(self.records) == self.capacity and self.capacity < self.maximum:
            self.capacity = min(self.capacity*2, self.maximum)
        row = dict(zip(['x', 'y', 'z'], [math.nan if value is None else f(value) for value in position]))
        row['time'] = f(time)
        self.records.append(row)
        if len(self.records) > self.capacity:
            self.records.pop(0)

    def expire(self, time):
        while self.records and sub(time, self.records[0]['time']) > f(self.config['trailLifetime']):
            self.records.pop(0)

    def operate(self, operation):
        kind = operation['op']
        if kind == 'append':
            self.append(operation['position'], operation['time'])
        elif kind == 'expire':
            self.expire(operation['time'])
        elif kind == 'setVisible':
            self.config['showTrails'] = operation['value']
        elif kind == 'move':
            if not self.config['accumulation'] and self.config['showTrails']:
                if operation.get('wrapped', False) or operation.get('respawned', False):
                    self.append([None, None, None], operation['time'])
                should_append = True
                if self.records:
                    last = self.records[-1]
                    if not math.isnan(last['x']) and not math.isnan(last['y']):
                        threshold = max(f(.15), mul(operation['actualStep'], 1.25))
                        dx, dy = sub(operation['position'][0], last['x']), sub(operation['position'][1], last['y'])
                        should_append = squared(dx, dy) >= mul(threshold, threshold)
                if should_append:
                    self.append(operation['position'], operation['time'])
            if not self.config['accumulation']:
                self.expire(operation['time'])
        else:
            raise ValueError(kind)

    def snapshot(self):
        config, records = self.config, self.records
        shapes, shape = [], []
        split = mul(max(config['width'], config['height']), .55)
        split_squared = mul(split, split)
        denominator = max(1, len(records)-1)

        def finish():
            # Actual no-arg beginShape means POLYGON: vertexCount >=3.
            if len(shape) >= 3:
                raw = [mul(255, div(i, denominator)) if config['fadeTrails'] else 255. for i in shape]
                alpha_bytes = [int(mul(255, div(max(0., min(255., value)), 255))) for value in raw]
                shapes.append(dict(recordIndices=shape.copy(), positions=[[records[i]['x'], records[i]['y'], 0.] for i in shape],
                                   rawAlphas=raw, alphaBytes=alpha_bytes, alphas=[div(value, 255) for value in alpha_bytes]))
            shape.clear()

        if config['showTrails'] and not config['accumulation'] and len(records) >= 2:
            previous = None
            for i, row in enumerate(records):
                if math.isnan(row['x']) or math.isnan(row['y']):
                    finish()
                    previous = None
                    continue
                if previous is not None and squared(sub(row['x'], previous['x']), sub(row['y'], previous['y'])) > split_squared:
                    finish()
                shape.append(i)
                previous = row
            finish()
        return encode(dict(count=len(records), allocatedCapacity=self.capacity, maximumCapacity=self.maximum,
                           records=copy.deepcopy(records), visibleShapes=shapes, showTrails=config['showTrails']))


DEFAULT = dict(capacity=360, initialPosition=[0., 0., 0.], showTrails=True,
               accumulation=False, trailLifetime=4., width=800, height=600, fadeTrails=True)


def move(x, y=0., time=0., step=.1, **flags):
    return dict(op='move', position=[x, y, 0.], time=time, actualStep=step, **flags)


def append(x, y=0., time=0.):
    return dict(op='append', position=[x, y, 0.], time=time)


def run(name, operations, checkpoints=None, interface="native-method-diagnostic", **options):
    config = dict(DEFAULT, **options)
    owner = Trail(config)
    initial = owner.snapshot()
    snapshots = []
    for i, operation in enumerate(operations):
        owner.operate(operation)
        if checkpoints is None or i in checkpoints:
            snapshots.append(dict(afterOperation=i, expected=owner.snapshot()))
    return dict(name=name, interface=interface, config=config, operations=operations, initial=initial, snapshots=snapshots)



def production(name, operations, checkpoints=None, **options):
    lifetime = options.get('trailLifetime', DEFAULT['trailLifetime'])
    # Dot3D constructor argument derived by Perlin initParticles, float multiply
    # before Java f2i and signed-int addition. Production cases use finite range.
    value = mul(lifetime, 60)
    narrowed = 0 if math.isnan(value) else max(-2147483648, min(2147483647, int(value)))
    capacity = ((narrowed+120+(1 << 31)) & ((1 << 32)-1))-(1 << 31)
    assert all(op['op'] in ['move', 'setVisible', 'expire'] for op in operations)
    return run(name, operations, checkpoints=checkpoints, interface='production', capacity=capacity, **options)


def production_cases():
    result = [
        production('production-normal-three-point-shape', [move(.15,time=.01),move(.3,time=.02),move(.45,time=.03)]),
        production('production-nan-separator-index-fade', [move(1.,time=.01),move(2.,time=.02),move(-400.,time=.03,wrapped=True),move(-399.,time=.04),move(-398.,time=.05)]),
        production('production-respawn-index-fade', [move(1.,time=.01),move(2.,time=.02),move(20.,time=.03,respawned=True),move(21.,time=.04),move(22.,time=.05)]),
        production('production-long-jump-equality', [move(440.,time=.01),move(880.,time=.02)]),
        production('production-long-jump-strict', [move(440.00003,time=.01),move(441.,time=.02),move(442.,time=.03)]),
        production('production-small-raw-viewport', [move(10.,time=.01),move(100.,time=.02),move(110.,time=.03),move(120.,time=.04)], width=100,height=120),
        production('production-hidden-expiration', [move(1.,time=.1),move(2.,time=.2),dict(op='setVisible',value=False),dict(op='expire',time=1.),dict(op='expire',time=1.0000001192092896),move(10.,time=1.3),dict(op='setVisible',value=True),move(11.,time=1.4),move(12.,time=1.5),move(13.,time=1.6)], trailLifetime=1.),
        production('production-lifetime-zero-capacity120', [move(i*.2,time=0.) for i in range(1,128)], checkpoints=[0,117,118,119,120,126], trailLifetime=0.),
        production('production-no-fade', [move(1.,time=.1),move(2.,time=.2),move(3.,time=.3)], fadeTrails=False),
        production('production-accumulation-empty-history', [move(1.,time=.1),move(2.,time=.2,wrapped=True)], accumulation=True),
    ]
    spec = importlib.util.spec_from_file_location('particle_motion_oracle', Path(__file__).with_name('source-perlin-particle-oracle.py'))
    motion_module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(motion_module)
    config = dict(motion_module.DEFAULT, particleCount=1, stepSize=1000.)
    owner = motion_module.Motion(config)
    initial = owner.snapshot()['positions'][0]
    operations = []
    for index in range(200):
        time = f((index+1)/60)
        frame = owner.update(dict(time=time, dt=1/60))
        operations.append(dict(op='move',position=frame['positions'][0],time=time,
                               actualStep=frame['actualStep'][0],wrapped=frame['wrapped'][0],respawned=frame['respawned'][0]))
    result.append(production('production-lifetime4.1-motion-wraps-grow-overwrite', operations, checkpoints=[0,178,179,180,182,183,199],
                             initialPosition=initial, trailLifetime=4.1))
    return result


def fixtures():
    cases = [
        run('minimum-distance-below-equal-above', [move(.149999, time=.01), move(.15, time=.02), move(.300001, time=.03)]),
        run('scaled-distance-threshold', [move(1.2499, step=1., time=.1), move(1.25, step=1., time=.2), move(2.5, step=1., time=.3)]),
        run('negative-step-still-minimum-distance', [move(-.15, step=-2., time=.1), move(-.3, step=-2., time=.2)]),
        run('zero-step-unchanged-no-record', [move(0., step=0., time=.1), move(0., step=0., time=.2)]),
        run('wrap-separator-and-new-point', [move(1.,time=.1),move(2.,time=.2),move(-400.,time=.3,wrapped=True),move(-399.,time=.4),move(-398.,time=.5)]),
        run('respawn-separator-and-new-point', [move(1.,time=.1),move(2.,time=.2),move(30.,time=.3,respawned=True),move(31.,time=.4),move(32.,time=.5)]),
        run('wrap-and-respawn-one-separator', [move(20.,time=.1,wrapped=True,respawned=True),move(21.,time=.2),move(22.,time=.3)]),
        run('expiry-strict-lifetime-equality', [append(1.,time=.5),append(2.,time=1.),dict(op='expire',time=1.),dict(op='expire',time=1.0000001192092896)], trailLifetime=1.),
        run('expiry-float32-subtraction', [append(1.,time=.1),append(2.,time=.2),dict(op='expire',time=.3)], trailLifetime=.2),
        run('append-before-expire', [move(1.,time=2.)], trailLifetime=.5),
        run('initial-record-even-hidden', [move(1.,time=.1),dict(op='expire',time=5.)], showTrails=False),
        run('hide-keeps-expiring-show-resumes', [move(1.,time=.1),move(2.,time=.2),dict(op='setVisible',value=False),move(30.,time=.5),move(40.,time=1.2),dict(op='setVisible',value=True),move(41.,time=1.3),move(42.,time=1.4),move(43.,time=1.5)], trailLifetime=1.),
        run('capacity-overwrite-includes-separators', [move(1.,time=.1),move(2.,time=.2),move(3.,time=.3),move(100.,time=.4,wrapped=True),move(101.,time=.5),move(102.,time=.6)], capacity=4),
        run('capacity-one-break-is-overwritten', [move(10.,time=.1,wrapped=True),move(20.,time=.2,respawned=True)], capacity=1),
        run('zero-capacity', [move(10.,time=.1),move(20.,time=.2,wrapped=True)], capacity=0),
        run('negative-capacity-clamped', [move(10.,time=.1)], capacity=-1),
        run('accumulation-no-trail-storage', [move(1.,time=.1),move(20.,time=.2,respawned=True)], accumulation=True),
        run('one-and-two-point-polygon-invisible', [append(1.,time=.1),append(2.,time=.2)]),
        run('nan-counts-in-fade-denominator', [append(1.),append(2.),append(None,None),append(3.),append(4.),append(5.)]),
        run('consecutive-nan-breaks', [append(1.),append(2.),append(None,None),append(None,None),append(3.),append(4.),append(5.)]),
        run('nan-only-x-or-y', [append(1.),append(2.),append(None,10.),append(3.),append(4.),append(5.),append(10.,None)]),
        run('long-jump-equality-connected', [append(440.),append(880.)]),
        run('long-jump-strict-over-break', [append(440.00003),append(441.),append(442.)]),
        run('short-shapes-around-break-discarded', [append(1.),append(None,None),append(2.),append(3.)]),
        run('raw-small-viewport-not-motion-fallback', [append(10.),append(100.),append(110.),append(120.)], width=100,height=120),
        run('zero-viewport-breaks-every-distinct-point', [append(1.),append(2.),append(3.)], width=0,height=0),
        run('no-fade-opaque', [append(1.),append(2.),append(3.)], fadeTrails=False),
        run('fade-byte-truncation', [append(i) for i in range(1,11)]),
        run('draw-z-is-zero', [dict(op='append',position=[1.,0.,900.],time=.1),dict(op='append',position=[2.,0.,-900.],time=.2)], initialPosition=[0.,0.,5.]),
        run('grow-360-to-maximum', [append(i*.2,time=i*.01) for i in range(1,367)], checkpoints=[358,359,360,365], capacity=365),
    ]
    cases.extend(production_cases())
    return dict(schema=1, provenance=dict(kind='independent-static-instruction-transcription',nativeExecution=False,
        jarSha256='a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018',
        perlinClassSha256='ef1de66f25e6fed5a126cb260005d0b5d7fd161118cc83993f0648009de96d92',
        methods=['PerlinNoiseField.initParticles/update PC1087-1340/drawTrails2D',
                 'Dot3D.<init>/addTrail/grow/updateTrailExpiration',
                 'PGraphics.colorCalc(FFFF)/beginShape()/endShape()',
                 'PGraphicsOpenGL$Tessellator.tessellatePolygon vertexCount>=3'],
        limits=['No native execution, GPU rasterization, colors, line widths or bevel/point tessellation.',
                'null in x/y/z is exactly a retained NaN separator component, not a deleted record.',
                'Move operations receive motion results; wrap/respawn decisions are tested independently by particle oracle.',
                'Each move records then expires at its absolute float time; explicit append/expire operations are storage diagnostics.',
                'Native-method diagnostic capacity is explicit; production cases derive int(F(lifetime*60))+120 and use only move/setVisible/expire.',
                'One production growth case uses independently generated particle motion; no product module is imported.',
                'Visible shapes encode source POLYGON stroke minimum3 vertices and byte-quantized defaultRGB255 alpha.',
                'Byte alpha normalized to Float32 for GPU upload; rawAlphas retain pre-colorCalc values.']), cases=cases)


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--check',action='store_true')
    args=parser.parse_args()
    data=fixtures()
    compact=lambda value:json.dumps(value,separators=(',', ':'),allow_nan=False)
    lines=['{','"schema":1,','"provenance":'+compact(data['provenance'])+',','"cases":[']
    lines += [compact(case)+(',' if i+1<len(data['cases']) else '') for i,case in enumerate(data['cases'])]
    text='\n'.join(lines+[']}', ''])
    if args.check:
        if not OUT.exists() or OUT.read_text()!=text:
            raise SystemExit('Perlin trail fixture differs; regenerate and review')
    else:
        OUT.parent.mkdir(parents=True,exist_ok=True)
        OUT.write_text(text)
    print(json.dumps(dict(cases=len(data['cases']),productionCases=sum(c['interface']=='production' for c in data['cases']),operations=sum(len(c['operations']) for c in data['cases']),
                         snapshots=sum(len(c['snapshots']) for c in data['cases']),bytes=len(text.encode()),sha256=hashlib.sha256(text.encode()).hexdigest())))


if __name__=='__main__':
    main()
