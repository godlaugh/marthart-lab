#!/usr/bin/env python3
"""Independent Float32 witnesses for pinned MeshSurface continuous shift.

Transcribed from original classfile bytecode, not the TypeScript implementation.
This is static-source evidence, not an execution of the original Java runtime.
Usage: python3 scripts/source-surface-mesh-oracle.py > tests/fixtures/source-surface-mesh-shifts.json
"""
import json
import math
import struct
import argparse
from pathlib import Path

def f(value):
    return struct.unpack('f', struct.pack('f', value))[0]

def dist(a, b):
    x, y, z = [f(x-y) for x, y in zip(a, b)]
    return f(math.sqrt(f(f(f(x*x)+f(y*y))+f(z*z))))

def sample(u, v, amount, offset):
    raw = [f(u), f(v + amount*u), f(u*v*.17)]
    return [f(x+offset) for x in raw]

def score(shift, n, amount, offset, wrap):
    count, period = min(18, max(16, n*2)), max(1, n-1)
    total = 0.
    for k in range(count):
        t = f(k/(count-1))
        mapped = f(f(t*period)+shift)
        if wrap:
            mapped = f(math.fmod(mapped, period))
            if mapped < 0:
                mapped = f(mapped+period)
        else:
            mapped = max(0., min(period, mapped))
        mapped = f(mapped/period)
        total = f(total + dist(sample(1., t, amount, offset), sample(0., mapped, amount, offset)))
    return f(total/count)

def best_shift(n, amount, offset, wrap):
    period = max(1, n-1)
    steps = max(32, period*2)
    best, shift = f(3.4028234663852886e38), 0.
    for k in range(steps+1):
        candidate = f(-period + f(f(2*period)*f(k/steps)))
        value = score(candidate, n, amount, offset, wrap)
        if value < best:
            best, shift = value, candidate
    radius = max(1., f(period*f(.25)))
    for k in range(65):
        candidate = f(f(shift-radius)+f(f(2*radius)*f(k/64)))
        value = score(candidate, n, amount, offset, wrap)
        if value < best:
            best, shift = value, candidate
    return shift

inputs = [(3,.17,0.,False), (5,.63,0.,False), (7,-.35,0.,False),
          (9,.13,0.,True), (17,.27,0.,True), (5,.63,100000000.,False)]

def function_point(u, v, a):
    values = [a+u, v+u/3, u*v]
    return [f(f(f(value)*f(scale))+f(offset)) for value, scale, offset in
            zip(values, [3,.1,-7], [-50331648,2,5])]

def function_frame(a):
    positions, normals = [], []
    for v in [0.,1.]:
        for u in [0.,.5,1.]:
            point = function_point(u,v,a)
            eps = f(1.e-5)
            neighbor_u = f(u-eps) if f(u-eps) >= 0 else f(u+eps)
            neighbor = function_point(neighbor_u,v,a)
            tangent = [f(x-y) for x,y in zip(point,neighbor)] if neighbor_u < u else [f(x-y) for x,y in zip(neighbor,point)]
            mag = dist(tangent,[0.,0.,0.])
            normal = [f(x*f(1/mag)) for x in tangent] if mag > f(1.e-8) else [0.,0.,1.]
            positions.extend(point)
            normals.extend(normal)
    return {'a':a, 'positions':positions, 'normals':normals}

def seam_normal(u,v):
    point = [f(u),f(u*u),f(v)]
    eps = f(.001)
    neighbor_u = f(u+eps) if f(u+eps) <= 1 else f(u-eps)
    neighbor = [f(neighbor_u),f(neighbor_u*neighbor_u),f(v)]
    tangent = [f(x-y) for x,y in zip(point,neighbor)] if neighbor_u < u else [f(x-y) for x,y in zip(neighbor,point)]
    mag = dist(tangent,[0.,0.,0.])
    return [f(x/mag) for x in tangent] if mag != 0 and mag != 1 else tangent

result = {
    'evidenceKind': 'static-source-independent-float32-oracle',
    'jarSha256': 'a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018',
    'classSha256': '95a1c0c80e593ba4de21fcbdfb8bfb24dbd034fbebce95d4aed7d2829a412906',
    'methods': ['calculateBestWrapShiftContinuous', 'getUWrapShiftScore'],
    'cases': [{'numV': n, 'amount': amount, 'offset': offset, 'wrapV': wrap,
               'shift': best_shift(n, amount, offset, wrap)} for n, amount, offset, wrap in inputs],
    'sharedFunctionFrames': [function_frame(16777217), function_frame(16777219)],
    'paramNormals': [seam_normal(u,v) for u,v in [(1.,0.),(0.,0.),(0.,1.),(1.,1.)]],
}
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--check', action='store_true', help='Compare generated witnesses to the retained fixture without rewriting it')
args = parser.parse_args()
if args.check:
    fixture = Path(__file__).resolve().parents[1] / 'tests/fixtures/source-surface-mesh-shifts.json'
    if json.loads(fixture.read_text()) != result:
        parser.exit(1, 'Mesh source oracle differs from retained fixture: '+str(fixture)+'\n')
    print('Mesh source oracle matches retained fixture.')
else:
    print(json.dumps(result, indent=2))
