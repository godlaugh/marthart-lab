#!/usr/bin/env python3
"""Independent static MathArt/Processing flow-texture oracle; no product imports.

Retained bytecode: PerlinNoiseField.<init>/mix64/buildFlowTexture,
PApplet.noise/noise_fsc/noiseSeed, PGraphics.<clinit>/colorCalc. Python libm
is not a Java/driver execution oracle. Small images are diagnostic inputs;
original size selector emits only 512, 1024, 2048. --check is read-only.
"""
import argparse
import hashlib
import json
import math
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures/source-perlin/flow-textures.json'
MASK48, MASK64 = (1 << 48)-1, (1 << 64)-1


def f(x):
    try:
        return struct.unpack('>f', struct.pack('>f', x))[0]
    except OverflowError:
        return math.copysign(math.inf, x)


def f2i(x):
    # JVM narrowing saturation, including float overflow during octave scaling.
    if math.isnan(x):
        return 0
    if x >= 2147483647:
        return 2147483647
    if x <= -2147483648:
        return -2147483648
    return int(x)


def add(a, b):
    return f(f(a)+f(b))


def sub(a, b):
    return f(f(a)-f(b))


def mul(a, b):
    return f(f(a)*f(b))


def div(a, b):
    return f(f(a)/f(b))


def powf(a, b):
    return f(math.pow(f(a), f(b)))


def sinf(a):
    return f(math.sin(f(a)))


def ridge(a):
    return sub(1, mul(abs(sub(a, .5)), 2))


def int32(value):
    return ((value+(1 << 31)) & ((1 << 32)-1))-(1 << 31)


def texture_seed(seed):
    # Constructor PC594-630 preserves signed-int seeds, otherwise Murmur finalizer.
    if -(1 << 31) <= seed < (1 << 31):
        return seed
    x = seed & MASK64
    x = ((x ^ (x >> 33)) * -49064778989728563) & MASK64
    x = ((x ^ (x >> 33)) * -4265267296055464877) & MASK64
    return int32(x ^ (x >> 33))


def style_seed(seed, style):
    return int32(texture_seed(seed) ^ int32(-1640531527*(style+1)))


COS = [f(math.cos(mul(mul(i, f(math.pi/180)), .5))) for i in range(720)]


class Noise:
    def __init__(self, seed):
        state = (seed ^ 25214903917) & MASK48
        self.table = []
        for _ in range(4096):
            state = (state * 25214903917+11) & MASK48
            self.table.append((state >> 24) / (1 << 24))

    def fade(self, value):
        return mul(.5, sub(1, COS[f2i(mul(value, 360)) % 720]))

    def sample(self, x, y, z):
        # PApplet.noise PC94-152; input/frac arithmetic stays binary32.
        x, y, z = [abs(f(v)) for v in [x, y, z]]
        xi, yi, zi = f2i(x), f2i(y), f2i(z)
        xf, yf, zf = sub(x, xi), sub(y, yi), sub(z, zi)
        result, amplitude = 0., .5
        table = self.table
        for _ in range(4):
            offset = xi+(yi << 4)+(zi << 8)
            rx, ry = self.fade(xf), self.fade(yf)
            a = table[offset & 4095]
            a = add(a, mul(rx, sub(table[(offset+1) & 4095], a)))
            b = table[(offset+16) & 4095]
            b = add(b, mul(rx, sub(table[(offset+17) & 4095], b)))
            a = add(a, mul(ry, sub(b, a)))
            offset += 256
            b = table[offset & 4095]
            b = add(b, mul(rx, sub(table[(offset+1) & 4095], b)))
            c = table[(offset+16) & 4095]
            c = add(c, mul(rx, sub(table[(offset+17) & 4095], c)))
            b = add(b, mul(ry, sub(c, b)))
            a = add(a, mul(self.fade(zf), sub(b, a)))
            result = add(result, mul(a, amplitude))
            amplitude = mul(amplitude, .5)
            xi, yi, zi = int32(xi << 1), int32(yi << 1), int32(zi << 1)
            xf, yf, zf = mul(xf, 2), mul(yf, 2), mul(zf, 2)
            if xf >= 1:
                xi, xf = int32(xi+1), sub(xf, 1)
            if yf >= 1:
                yi, yf = int32(yi+1), sub(yf, 1)
            if zf >= 1:
                zi, zf = int32(zi+1), sub(zf, 1)
        return result


def texel(noise, style, size, x, y):
    n = noise.sample
    u, v = div(x, size), div(y, size)
    if style == 0:  # buildFlowTexture PC73-264
        a, b = n(mul(u, 3), mul(v, 3), .11), n(mul(u, 9), mul(v, 9), .37)
        c = n(mul(add(u, mul(v, .75)), 26), mul(sub(v, mul(u, .33)), 6), .71)
        d = n(mul(sub(u, mul(v, .42)), 42), mul(add(v, mul(u, .18)), 8), 1.13)
        q = powf(add(add(add(mul(.42, a), mul(.28, b)), mul(.22, ridge(c))), mul(.08, ridge(d))), 1.35)
    elif style == 1:  # PC274-431
        a = n(mul(add(u, mul(v, .4)), 4.5), mul(sub(v, mul(u, .3)), 4.5), .19)
        b = n(mul(sub(u, mul(v, .2)), 14), mul(add(v, mul(u, .2)), 14), .53)
        c = n(mul(add(u, v), 36), mul(sub(v, u), 36), .97)
        q = powf(add(add(mul(.35, a), mul(.3, b)), mul(.35, powf(ridge(c), 2.5))), 1.2)
    elif style == 2:  # PC441-557
        a = n(mul(add(u, mul(.15, sinf(mul(v, math.tau)))), 8), mul(v, 2.6), .23)
        b = n(mul(add(u, mul(v, .65)), 18), mul(sub(v, mul(u, .28)), 3), .77)
        q = powf(add(mul(.62, a), mul(.38, powf(ridge(b), 1.8))), 1.1)
    elif style == 3:  # PC567-706
        dx, dy = sub(u, .5), sub(v, .5)
        r = f(math.sqrt(add(mul(dx, dx), mul(dy, dy))))
        a = add(.5, mul(.5, sinf(add(mul(42, r), mul(5, n(mul(u, 6), mul(v, 6), .13))))))
        b = n(mul(add(u, mul(v, .4)), 10), mul(sub(v, mul(u, .4)), 10), .89)
        q = powf(add(mul(.58, a), mul(.42, b)), 1.35)
    elif style == 4:  # PC716-834
        a = n(mul(u, 3.5), mul(sub(1, v), 8.5), .21)
        b = n(mul(add(u, mul(a, .35)), 14), mul(add(v, mul(a, .2)), 14), .91)
        c = powf(max(0., min(1., add(sub(1, v), mul(.25, b)))), 1.9)
        q = powf(add(add(mul(.48, a), mul(.22, b)), mul(.3, c)), .95)
    else:  # PC839-955; source fallback is style5, even for other integers.
        a = n(mul(u, 2.2), mul(v, 2.2), .09)
        b = n(mul(add(u, mul(v, .25)), 7), mul(sub(v, mul(u, .25)), 7), .49)
        c = n(mul(u, 18), mul(v, 18), 1.01)
        q = powf(add(add(mul(.55, a), mul(.3, b)), mul(.15, c)), 1.55)
    q = max(0., min(1., q))
    # PApplet.color(F)->PGraphics.colorCalc(F,F), initial RGB255 colorMode.
    gray = int(mul(div(mul(q, 255), 255), 255))
    return q, gray


def fixtures():
    seeds = [0, -1, 9223372036854775807]
    seed_cases = [dict(seed=str(s), textureSeed=texture_seed(s), styleSeeds=[style_seed(s, i) for i in range(6)])
                  for s in [0, -1, 12345, -(1 << 31), (1 << 31)-1, -(1 << 31)-1,
                            1 << 31, 9007199254740993, (1 << 63)-1, -(1 << 63)]]
    coordinates = [[0, 0, 0], [.125, .25, .5], [-.125, -.25, -.5],
                   [-31.999, 17.501, -2.17], [1/3, 1/7, 1/11], [4095.5, 256.25, 16.125],
                   [2147483648., .25, .5], [-2147483648., -.25, -.5],
                   [f(3.4028234663852886e38), 0., .5]]
    noise_cases = []
    for seed in [0, -1, 2147483648, 9223372036854775807, -9223372036854775808]:
        owner = Noise(seed)
        noise_cases.append(dict(seed=str(seed), tablePrefix=owner.table[:8],
                                samples=[owner.sample(*point) for point in coordinates]))
    cases = []
    for seed in seeds:
        for style in range(6):
            owner = Noise(style_seed(seed, style))
            small = bytes(texel(owner, style, 8, x, y)[1] for y in range(8) for x in range(8))
            samples = []
            for size in [512, 1024, 2048]:
                points = [[0, 0], [size-1, size-1], [size//2, size//2], [size//3, size//7], [size-1, 1]]
                values = [texel(owner, style, size, *point) for point in points]
                samples.append(dict(size=size, points=points, scalar=[v[0] for v in values], gray=[v[1] for v in values]))
            row = dict(seed=str(seed), style=style, small8GrayHex=small.hex(), samples=samples)
            if seed == 0:
                full = bytes(texel(owner, style, 32, x, y)[1] for y in range(32) for x in range(32))
                row['small32GraySha256'] = hashlib.sha256(full).hexdigest()
            if seed == 0 and style == 0:
                full_source = bytes(texel(owner, style, 512, x, y)[1] for y in range(512) for x in range(512))
                row['source512GraySha256'] = hashlib.sha256(full_source).hexdigest()
            cases.append(row)
    return dict(provenance=dict(kind='independent-static-instruction-transcription', nativeExecution=False,
        jarSha256='a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018',
        processingJarSha256='89410e2c4f59cb4b4aeb2a3baeaf6a4bc189d6e1c612920c3f8e0f58b62a769a',
        classes={'PerlinNoiseField':'ef1de66f25e6fed5a126cb260005d0b5d7fd161118cc83993f0648009de96d92',
                 'PApplet':'5e2413f11fbdd22e9e8b4a27ed2c260e9678fadf41984183796f98680ba9c35f',
                 'PGraphics':'d495bc8e9b3f6855759da98715874d9f95aed561664c12edf792a08abcb5e818'},
        methods=['PerlinNoiseField.<init> PC584-648/mix64/buildFlowTexture/rebuildFlowTextures',
                 'PApplet.noise(FFF)/noise_fsc/noiseSeed/<init> PC139-147',
                 'PGraphics.<clinit>/colorCalc(FF)'],
        limits=['Python libm, no executed Java or framebuffer; final transcendental bits may vary.',
                'Small8/32 textures are synthetic diagnostics; source selector emits only512/1024/2048.',
                'Scalar output includes F32 transcendental results; gray bytes use defaultRGB255 primarygraphics.',
                'No upload/filtering/mipmap/shader/frame-clock verification.']),
        seedCases=seed_cases, noiseCoordinates=coordinates, noiseCases=noise_cases,
        cosineSamples=[dict(index=i,value=COS[i]) for i in [0,1,17,89,90,179,180,359,360,539,719]], cases=cases)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    data = fixtures()
    compact = lambda x: json.dumps(x, separators=(',', ':'), allow_nan=False)
    lines = ['{']
    for key in ['provenance','seedCases','noiseCoordinates','noiseCases','cosineSamples']:
        lines.append(json.dumps(key)+':'+compact(data[key])+',')
    lines.append('"cases":[')
    lines += [compact(c)+(',' if i+1<len(data['cases']) else '') for i,c in enumerate(data['cases'])]
    text = '\n'.join(lines+[']}', ''])
    if args.check:
        if not OUT.exists() or OUT.read_text()!=text:
            raise SystemExit('Perlin flow fixture differs; regenerate and review')
    else:
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(text)
    print(json.dumps(dict(cases=len(data['cases']), sparseTexels=270, small8Texels=1152,
                         small32Texels=6144, source512Texels=262144, bytes=len(text.encode()), sha256=hashlib.sha256(text.encode()).hexdigest())))


if __name__ == '__main__':
    main()
