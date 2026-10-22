"""Execute the shipped viewport methods on synthetic JNI objects, without UI."""
from pathlib import Path
import argparse,hashlib,json,os,signal,subprocess,time
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--app',type=Path,required=True)
p.add_argument('--jni-include',type=Path,required=True)
p.add_argument('--output',type=Path,required=True)
a=p.parse_args();root=Path(__file__).resolve().parent.parent
out=a.output.resolve();out.mkdir(parents=True,exist_ok=False)
app=a.app.resolve()/'Contents';jvm=app/'runtime/Contents/Home/lib/server/libjvm.dylib'
harness=root/'tests/fixtures/source-viewport/navigation-oracle.c'
old=json.loads((root/'tests/fixtures/source-viewport/navigation-source.json').read_text())
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
jar=app/'app/MathArt-1.7.8-b07191b3e97da6fe465555ef6e61a0be.jar'
core=app/'app/core-4.5.0-acdf3bce2932985b9d091c284407a54.jar'
if sha(jar)!=old['jarSha256'] or sha(core)!=old['coreJarSha256']:raise RuntimeError('Selected original artifacts differ')
records=[]
def invoke(command,seconds,name):
 start=time.monotonic();process=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
 expired=False
 try:stdout,stderr=process.communicate(timeout=seconds)
 except subprocess.TimeoutExpired:
  expired=True
  # Child remains unreaped, so this owned process group cannot have been reused.
  try:os.killpg(process.pid,signal.SIGTERM)
  except ProcessLookupError:pass
  try:stdout,stderr=process.communicate(timeout=3)
  except subprocess.TimeoutExpired:
   try:os.killpg(process.pid,signal.SIGKILL)
   except ProcessLookupError:pass
   stdout,stderr=process.communicate(timeout=3)
 (out/(name+'-stdout.txt')).write_bytes(stdout);(out/(name+'-stderr.txt')).write_bytes(stderr)
 records.append(dict(name=name,pid=process.pid,elapsedSeconds=time.monotonic()-start,returncode=process.returncode,timedOut=expired,reaped=process.returncode is not None))
 (out/'processes.json').write_text(json.dumps(records,indent=2)+'\n')
 if expired or process.returncode:raise RuntimeError(name+' failed; inspect retained stderr')
 return stdout
invoke(['clang','-std=c11','-Wall','-Wextra','-I',str(a.jni_include.resolve()),str(harness),'-o',str(out/'oracle')],30,'compile')
classpath=':'.join(str(f) for f in sorted((app/'app').glob('*.jar')))
runs=[]
for index in range(2):
 data=invoke([str(out/'oracle'),str(jvm),classpath],45,'run-'+str(index+1))
 runs.append(json.loads(data.split(b'REA_ORACLE_JSON\n',1)[1]))
if runs[0]!=runs[1]:raise RuntimeError('Two native runs differ')
old_cases={row['id']:row for row in old['cases']}
for row in runs[0]:
 if row['id'] in old_cases:
  # Old wrapper also adds descriptive fields; compare every raw field.
  for key,value in row.items():
   if old_cases[row['id']].get(key)!=value:raise RuntimeError('Existing native case changed: '+row['id']+'/'+key)
result={**old,'harnessSha256':sha(harness),'jvmSha256':sha(jvm),'executableSha256':sha(out/'oracle'),'cases':[{**old_cases.get(row['id'],{}),**row} for row in runs[0]],
 'scope':'Original MathArt mouse and pause methods on synthetic Map, Symmetry and Surface objects. No constructors, Scene.update/render, rendering thread or window; not GPU/whole-window parity.',
 'identicalRuns':True,'priorCasesUnchanged':True}
(out/'source.json').write_text(json.dumps(result,indent=2)+'\n')
(out/'manifest.json').write_text(json.dumps(dict(app=str(a.app.resolve()),classpath=classpath,runnerSha256=sha(Path(__file__)),processes=records),indent=2)+'\n')
print(json.dumps(dict(cases=len(runs[0]),identicalRuns=True,priorCasesUnchanged=True,output=str(out/'source.json'))))
