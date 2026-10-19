"""Static EulerIntegrator/GenericDifferentialEquation instruction oracle.

Fixed initial boxes avoid depending on production or Java RNG. This computes
independent staged Float32 trajectories, not original JVM runtime results.
"""
import json
import math
import struct
import sys
from pathlib import Path


def f32(value):
    try:
        return struct.unpack('>f', struct.pack('>f', value))[0]
    except OverflowError:
        return math.copysign(math.inf, value)


def bits(values):
    return [struct.unpack('>I', struct.pack('>f', value))[0] for value in values]


def case(name, initial, dt, warmup, substeps, frames, parameters=None):
    parameters = parameters or {'a': .25}
    scale, offset = [2, -3, .5], [1, .25, -2]
    raw = list(map(f32, initial))
    dt = f32(dt)
    integrated = 0

    def advance():
        nonlocal raw, integrated
        x, y, z = [parameters.get(key, value) for key, value in zip(['x', 'y', 'z'], raw)]
        derivatives = [f32(parameters['a'] * x + y), f32(x - z), f32(-y + z / 2)]
        raw = [f32(value + f32(derivative * dt)) for value, derivative in zip(raw, derivatives)]
        integrated += 1

    def snapshot():
        transformed = [f32(f32(value * s) + o) for value, s, o in zip(raw, scale, offset)]
        return {'rawBits': bits(raw), 'positionBits': bits(transformed), 'steps': integrated}

    for _ in range(max(0, warmup)):
        advance()
    rows = [snapshot()]
    for _ in range(frames):
        for _ in range(max(0, substeps)):
            advance()
        rows.append(snapshot())
    return {'name': name, 'initial': initial, 'dt': dt, 'warmup': warmup, 'substeps': substeps,
            'parameters': parameters, 'scale': scale, 'offset': offset, 'rows': rows}


fixtures = {
    'provenance': {'kind': 'independent-static-instruction-transcription',
                   'jarSha256': 'a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018',
                   'methods': ['GenericDifferentialEquation.compute PC12-80', 'EulerIntegrator.step PC9-74',
                               'StrangeAttractor.update PC48-241'], 'nativeExecution': False},
    'equations': {'dx': 'a*x+y', 'dy': 'x-z', 'dz': '-y+z/2'},
    'cases': [case('staged-floats', [.1, -.2, .3], .125, 2, 3, 5),
              case('negative-step', [-.75, .5, 2], -.03125, 3, 2, 4),
              case('zero-time-step', [2, -3, 4], 0, 2, 5, 2),
              case('negative-substeps', [2, -3, 4], .1, 1, -2, 2),
              case('parameter-shadows-coordinate', [.1, -.2, .3], .05, 2, 2, 4, {'a': .25, 'x': 4}),
              case('negative-warmup', [-.1, .2, -.3], .005, -1, 1, 3)]}
path = Path(__file__).resolve().parent.parent / 'tests/fixtures/source-attractor/motion.json'
content = json.dumps(fixtures, indent=2) + '\n'
if '--check' in sys.argv:
    if path.read_text() != content:
        raise SystemExit('Source Attractor motion fixtures are stale')
    print(f"{len(fixtures['cases'])} independent staged Float32 trajectories verified")
else:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)
