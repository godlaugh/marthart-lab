#!/usr/bin/env python3
"""Independent fixed-JAR lifecycle oracle. No product TypeScript imports/execution.

Reuses the independent Python Processing noise transcription. Events encode
source constructor/buildFlowTexture/rebuildFlowTextures/ensureGpuResources;
size requests are already-selected buckets, not simulated native rendering.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures/source-perlin/flow-resources.json'
spec = importlib.util.spec_from_file_location('flow_oracle', Path(__file__).with_name('source-perlin-flow-oracle.py'))
flow = importlib.util.module_from_spec(spec)
spec.loader.exec_module(flow)


def fixtures():
    coordinates = [[.125, .25, .5], [-31.999, 17.501, -2.17], [4095.5, 256.25, 16.125]]
    cases = []
    for seed in [0, 12345, 9007199254740993]:
        current_seed = flow.texture_seed(seed)
        size = None
        builds = 0
        steps = []
        for event in [{'type': 'construct'}, {'type': 'switch', 'backend': 'gpu'}, {'type': 'switch', 'backend': 'cpu'},
                      {'type': 'prepare', 'size': 512}, {'type': 'prepare', 'size': 512},
                      {'type': 'switch', 'backend': 'cpu'}, {'type': 'prepare', 'size': 1024},
                      {'type': 'prepare', 'size': 512}]:
            seeds = []
            if event['type'] == 'prepare' and size != event['size']:
                size = event['size']
                builds += 1
                for style in range(6):
                    current_seed = flow.style_seed(seed, style)
                    seeds.append(current_seed)
            noise = flow.Noise(current_seed)
            steps.append(dict(event=event, size=size, builds=builds, buildStyleSeeds=seeds,
                              noiseSeed=str(current_seed), samples=[noise.sample(*p) for p in coordinates]))
        cases.append(dict(seed=str(seed), steps=steps))
    return dict(provenance=dict(kind='independent-static-instruction-transcription', nativeExecution=False,
        jarSha256='a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018',
        processingJarSha256='89410e2c4f59cb4b4aeb2a3baeaf6a4bc189d6e1c612920c3f8e0f58b62a769a',
        classSha256='ef1de66f25e6fed5a126cb260005d0b5d7fd161118cc83993f0648009de96d92',
        methods=['PerlinNoiseField.<init> PC642 noiseSeed', 'ensureGpuResources PC43-61 dirty/null guard',
                 'rebuildFlowTextures PC1-40 ordered six-image loop', 'buildFlowTexture PC28 noiseSeed, no restore',
                 'ParticleSystemMobject.setUseCPURender PC2 boolean only'],
        limitations=['No original JVM/JOGL execution, GL upload or framebuffer comparison.',
                     'Switch events here are no-ops; source backend setter performs no texture work.',
                     'Source noise samples use the independent Processing four-octave default transcription.']),
        coordinates=coordinates, cases=cases)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    text = json.dumps(fixtures(), ensure_ascii=False, separators=(',', ':'))+'\n'
    if args.check:
        if not OUT.exists() or OUT.read_text() != text:
            raise SystemExit('Flow resource oracle differs; regenerate and review')
    else:
        OUT.write_text(text)
    print(json.dumps(dict(bytes=len(text.encode()), sha256=hashlib.sha256(text.encode()).hexdigest(), nativeExecution=False)))


if __name__ == '__main__':
    main()
