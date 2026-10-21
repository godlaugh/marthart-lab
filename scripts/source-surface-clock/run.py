"""Bounded, owned-process execution of original Surface parameter update code."""
from pathlib import Path
import hashlib,json,os,signal,subprocess,time,zipfile

import argparse
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--app',type=Path,required=True,help='Original MathArt.app bundle')
parser.add_argument('--jni-include',type=Path,required=True,help='Existing directory containing jni.h and jni_md.h')
parser.add_argument('--output',type=Path,required=True,help='New local evidence directory; never overwrite prior evidence')
options=parser.parse_args()
root=Path(__file__).resolve().parents[2]
source=Path(__file__).resolve().parent
cache=options.output.resolve();cache.mkdir(parents=True,exist_ok=False)
app=options.app.resolve()/'Contents'
jar=app/'app/MathArt-1.7.8-b07191b3e97da6fe465555ef6e61a0be.jar'
core=app/'app/core-4.5.0-acdf3bce2932985b9d091c284407a54.jar'
jvm=app/'runtime/Contents/Home/lib/server/libjvm.dylib'
classpath=':'.join(str(p) for p in sorted((app/'app').glob('*.jar')))
def sha(path):
    with open(path,'rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def invoke(command,timeout,stem):
    start=time.perf_counter()
    p=subprocess.Popen(command,cwd=root,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
    owned_pid=p.pid; timeout_hit=False
    try:stdout,stderr=p.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        timeout_hit=True
        # The directly owned child is unreaped, so its PID/group cannot be reused.
        try:os.killpg(owned_pid,signal.SIGTERM)
        except ProcessLookupError:pass
        try:stdout,stderr=p.communicate(timeout=3)
        except subprocess.TimeoutExpired:
            try:os.killpg(owned_pid,signal.SIGKILL)
            except ProcessLookupError:pass
            stdout,stderr=p.communicate(timeout=3)
    (cache/f'{stem}-stdout.txt').write_bytes(stdout);(cache/f'{stem}-stderr.txt').write_bytes(stderr)
    result={'pid':owned_pid,'processGroup':owned_pid,'newSession':True,'timeoutSeconds':timeout,'timeoutHit':timeout_hit,'returnCode':p.returncode,'elapsedSeconds':time.perf_counter()-start,'reaped':p.returncode is not None}
    (cache/f'{stem}-process.json').write_text(json.dumps(result,indent=2)+'\n')
    if timeout_hit or p.returncode:raise RuntimeError(f'{stem} failed: {result}; stderr={stderr.decode(errors="replace")[:1600]}')
    return stdout,result

if sha(jar)!='a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018':raise RuntimeError('Original artifact digest differs')
compile_result=invoke(['clang','-std=c11','-Wall','-Wextra','-I',str(options.jni_include.resolve()),str(source/'oracle.c'),'-o',str(cache/'oracle')],30,'active-compile')[1]
runs=[];actual=None
for index in range(2):
    stdout,process=invoke([str(cache/'oracle'),str(jvm),classpath],45,f'active-run-{index+1}')
    value=json.loads(stdout.split(b'REA_SURFACE_CLOCK_JSON\n',1)[1])
    if actual is not None:assert value==actual, 'Original JVM traces differ'
    actual=value;runs.append(process)
classes={}
with zipfile.ZipFile(jar) as z:
    for name in ['mathart/surface/ParametricSurface','mathart/surface/MeshSurface','mathart/surface/SurfaceParameterAnimator','mathart/surface/SurfaceParameterAnimator$ParamConfig','mathart/surface/math/JsonSurfaceFunction','mathart/animation/OscillationEdgeEasing']:
        classes[name]=hashlib.sha256(z.read(name+'.class')).hexdigest()
report={'kind':'original-Surface-variable-fps-update-traces','actual':actual,'execution':{'originalSurfaceUpdate':True,'originalMeshUpdate':True,'originalAnimatorAndFunctionConstructors':True,'originalSurfaceConstructors':False,'GLOrWindow':False,'scope':'JNI allocated PApplet/Surface/Mesh, original parameter-function constructor with null unused expressions, original animator constructor and add/start/update; GPU branch without tracking/geometry, mesh nonempty placeholder or empty array. Actual parameter getters/phases/time. No scene queue, rendering, UI, recording lifecycle or native pixels.'},'provenance':{'artifactPath':str(jar),'artifactSha256':sha(jar),'coreSha256':sha(core),'jvmPath':str(jvm),'jvmSha256':sha(jvm),'classes':classes,'harnessSha256':sha(source/'oracle.c'),'runnerSha256':sha(Path(__file__)),'stdoutSha256':[sha(cache/f'active-run-{i}-stdout.txt') for i in [1,2]]},'processes':runs,'compile':compile_result,'identicalRuns':True}
(cache/'source.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'cases':len(actual),'frames':sum(len(c['frames']) for c in actual),'identicalRuns':True,'processes':runs},indent=2))
