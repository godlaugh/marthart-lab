#!/usr/bin/env python3
"""Retained bytecode oracle for Processing's independent projmodelview matrix.

Uses the existing independent Python camera oracle for P and the modelview
before center translation; never loads product TypeScript. This is a static
source transcription, not an original JVM/JOGL runtime or pixel comparison.
"""
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('camera_oracle', ROOT / 'scripts/source-camera-bytecode-oracle.py')
camera = importlib.util.module_from_spec(spec)
spec.loader.exec_module(camera)
APP = ROOT.parent / '.cache/mathart-investigation/MathArt.app/Contents/app'
ARTIFACTS = {
    'MathArt-1.7.8-b07191b3e97da6fe465555ef6e61a0be.jar': 'a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018',
    'core-4.5.0-acdf3bce2932985b9d091c284407a54.jar': '89410e2c4f59cb4b4aeb2a3baeaf6a4bc189d6e1c612920c3f8e0f58b62a769a',
}
PINS = {
    'v2-camera-source/CameraController.json': '80a478f361fdcbca2d8aeda2cc96f55e500a3527fa889ffd69765d815d0be9dd',
    'v2-camera-source/Scene.json': '1237defdd1a14b13e63669cbf5dfdab517cb2e4587c47264fff4b87fb6f58e53',
    'v2-camera-source/PGraphicsOpenGL.json': 'a0129d4660d76f8f881dd867bef85f3bfab547f10db63616d482b7f8881c736c',
    'roots-projection-matrix-methods.json': '037bf25c8ca287341f71d44c497a5bada41d00bd66fc969cfc0430251abff92a',
}

def rows(flat):
    return [flat[i:i + 4] for i in range(0, 16, 4)]


def main():
    evidence = []
    for name, sha in ARTIFACTS.items():
        assert hashlib.sha256((APP / name).read_bytes()).hexdigest() == sha, name
    for name, sha in PINS.items():
        raw = (ROOT / '.cache' / name).read_bytes()
        decoded = json.loads(raw)
        assert decoded['classSha256'] == sha, name
        jar = next(iter(ARTIFACTS)) if decoded['entry'].startswith('mathart/') else list(ARTIFACTS)[1]
        with zipfile.ZipFile(APP / jar) as archive:
            assert hashlib.sha256(archive.read(decoded['entry'])).hexdigest() == sha, name
        evidence.append({'path': '.cache/' + name, 'entry': decoded['entry'], 'classSha256': sha,
                         'evidenceSha256': hashlib.sha256(raw).hexdigest()})
    # Reuse pinned camera cases to preserve their independent projection/modelview
    # coverage, then add nontrivial centers in both ortho and offscreen paths.
    cases = [{k: row[k] for k in ('id', 'frame', 'viewport')}
             for row in json.loads((ROOT / 'tests/fixtures/source-camera/matrices.json').read_text())['cases']]
    base = {'phi': 1.58, 'theta': -.37, 'gamma': .91, 'center': [123.456, -78.901, 34.567], 'focalDistance': 35.5, 'zoom': 1.234}
    for target in ['primary', 'offscreen']:
        for projection in ['perspective', 'scene-fade-orthographic']:
            cases.append({'id': target + '-' + projection + '-center', 'frame': base,
                          'viewport': {'logicalWidth': 253, 'logicalHeight': 197, 'referenceLogicalHeight': 133,
                                       'target': target, 'projectionPass': projection}})
    for case in cases:
        full = camera.source(case)
        before = camera.source(dict(case, frame=dict(case['frame'], center=[0., 0., 0.])))
        # Last rotateImpl -> updateProjmodelview copies projection then calls
        # PMatrix3D.apply(modelview); translateImpl then translates both matrices.
        transform = camera.multiply(rows(before['projection']), rows(before['modelView']))
        camera.translate(transform, *[-x for x in full['camera']['center']])
        final_product = camera.multiply(rows(full['projection']), rows(full['modelView']))
        case['expected'] = {'transform': sum(transform, []), 'finalProduct': sum(final_product, []),
                            'projection': full['projection'], 'modelView': full['modelView']}
    result = {
        'schemaVersion': 1, 'kind': 'independent-python-bytecode-transcription',
        'artifacts': ARTIFACTS, 'sourceEvidence': evidence,
        'sequence': [
            'Scene.applyPerspective: perspective then camera, each updates projmodelview.',
            'Scene.render accumulation: pushMatrix, camera, ortho, popMatrix. Projection remains orthographic.',
            'Scene.render: translate(width/2,height/2,0), optional offscreen scale.',
            'CameraController.applyTransform: rotateZ(-gamma), rotateX(phi), rotateZ(theta). Each rebuilds P*M.',
            'CameraController.applyTransform: translate(-center). translateImpl updates M and combined independently.'
        ],
        'methodOffsets': {'CameraController.applyTransform': [6, 14, 22, 50],
                          'Scene.render': [110, 125, 138, 142, 189, 227, 273, 281],
                          'PGraphicsOpenGL.rotateImpl': [66, 82],
                          'PGraphicsOpenGL.translateImpl': [7, 27],
                          'PGraphicsOpenGL.updateProjmodelview': [8, 19],
                          'PGraphicsOpenGL.popMatrix': [41, 93]},
        'cases': cases,
        'limits': ['No native Java/JOGL execution or original pixels.',
                   'Python and JavaScript host libm, not proof of identical transcendental results on every Java runtime.']
    }
    path = ROOT / 'tests/fixtures/source-camera/transforms.json'
    text = json.dumps(result, indent=2) + '\n'
    if '--check' in sys.argv:
        assert path.read_text() == text, 'source camera transform fixture drift'
    else:
        path.write_text(text)
    mismatch = sum(row['expected']['transform'] != row['expected']['finalProduct'] for row in cases)
    print(f'{len(cases)} transform fixtures verified; {mismatch} differ from final P*M recomputation')

if __name__ == '__main__':
    main()
