#!/usr/bin/env python3
"""Independent controlled-millis Samila host + queue transcript.

python3 scripts/source-samila-realtime-oracle.py [--output PATH] [--check]
Reads fixed-JAR bytecode Evidence only. Never imports product code or executes
original Java. Queue/parameter/easing semantics reuse the independently authored
source-samila-timeline-oracle, with explicit per-update raw dt.
"""
import argparse, copy, hashlib, importlib.util, json, struct, zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('samila_bytecode_oracle',ROOT/'scripts/source-samila-timeline-oracle.py')
timeline=importlib.util.module_from_spec(spec);spec.loader.exec_module(timeline)
F=timeline.F

def i32(v):return ((int(v)+2147483648)%4294967296)-2147483648
def now_seconds(v):return F(F(i32(v))/F(1000))
def initial_frame(raw,easings):
    camera,_=timeline.compile_queue(raw,easings)
    return dict(sceneTime=F(0),rawDt=F(0),activeDt=F(0),queueIndex=0,queueComplete=not raw.get('timeline'),camera=camera,cameraBits={k:timeline.bits(v) for k,v in camera.items()},rates=[0.,0.,0.],parameters=copy.deepcopy(raw.get('parameters',{})),parameterWrites=0,parameterWriteRevision=0)

def run_case(case,easings):
    raw=case['raw'];steps=[];frame=initial_frame(raw,easings);last=F(0);paused=case.get('paused',False);saved={k:frame['camera'][k] for k in ['phi','theta','gamma']};restore=None;events=[];epoch=0
    for ordinal,event in enumerate(case['events']):
        event=copy.deepcopy(event);kind=event['kind'];raw_dt=F(0);updated=False
        if kind=='apply':
            raw=copy.deepcopy(event.get('raw',case['raw']));steps=[];frame=initial_frame(raw,easings);last=F(0);saved={k:frame['camera'][k] for k in ['phi','theta','gamma']};restore=None;epoch+=1
        elif kind=='pause':
            saved={k:frame['camera'][k] for k in ['phi','theta','gamma']};paused=True
        elif kind=='resume':
            if saved is not None:
                restore=copy.deepcopy(saved);frame=copy.deepcopy(frame);frame['camera'].update(saved)
            last=now_seconds(event['millis']);paused=False
        elif kind=='camera':
            frame=copy.deepcopy(frame);frame['camera'].update({k:F(v) for k,v in event['angles'].items()})
        elif kind=='update' and not paused:
            now=now_seconds(event['millis']);raw_dt=F(0) if last==0 else F(now-last);last=now
            step=dict(rawDt=raw_dt)
            if restore is not None:step['restoreCamera']=restore;restore=None
            steps.append(step);frame=timeline.transcript(raw,30,easings,steps=steps)['frames'][-1];updated=True
        elif kind not in ['update','capture','display']:
            raise ValueError('unknown oracle event '+kind)
        snapshot=copy.deepcopy(frame);snapshot['rawDt']=raw_dt;snapshot['activeDt']=frame['activeDt'] if updated else F(0);snapshot['parameterWrites']=frame['parameterWrites'] if updated else 0
        snapshot['cameraBits']={k:timeline.bits(v) for k,v in snapshot['camera'].items()}
        events.append(dict(ordinal=ordinal,input=event,epoch=epoch,paused=paused,updated=updated,lastTime=last,lastTimeBits=timeline.bits(last),savedAngles=copy.deepcopy(saved),expected=snapshot))
    return events

def cases():
    def raw(name,queue):return dict(type='SAMILA',config_version='1.0.0',name=name,equations={'f1':'a+x*.1','f2':'y*.1'},parameters={'a':0.},settings={'render_mode':'GPU','batch_size':13,'show_trails':False},timeline=queue)
    wait=lambda d:dict(type='wait',duration=d)
    action=lambda m,a:dict(method=m,args=a)
    animate=lambda d,a:dict(type='animate',duration=d,easing='LINEAR',actions=a)
    param=action('paramStart',{'parameters':{'a':{'min':-1,'max':1,'step':.01}}})
    queue=[animate(.1,[param,action('ambient',[.2,.6,.1])]),wait(.05),animate(.05,[action('paramStop',{})]),wait(.01)]
    update=lambda t:dict(kind='update',millis=t)
    return [
      dict(name='irregular-and-queue-boundaries',raw=raw('irregular',queue),events=list(map(update,[1000,1017,1051,1234,1235,2000,2100,2143,2200]))),
      dict(name='zero-timestamp-sentinel',raw=raw('zero',[wait(10)]),events=list(map(update,[0,1,17,34]))),
      dict(name='pause-capture-resume-restores-angles',raw=raw('pause',queue),events=[update(1000),update(1030),dict(kind='pause',millis=1040),update(5000),dict(kind='camera',angles={'phi':1,'theta':2,'gamma':3}),dict(kind='capture',millis=10000),dict(kind='display',millis=19000),dict(kind='resume',millis=20000),update(20000),update(20033),update(20071)]),
      dict(name='initially-paused-then-resume',paused=True,raw=raw('paused',queue),events=[update(1000),dict(kind='capture',millis=9000),dict(kind='resume',millis=10000),update(10017),update(10050)]),
      dict(name='full-apply-new-lasttime',raw=raw('apply',queue),events=[update(1000),update(1033),update(1067),dict(kind='apply',millis=5000),update(5000),update(5017)]),
      dict(name='float32-millis-precision',raw=raw('precision',[wait(100)]),events=list(map(update,[16777215,16777216,16777217,16777218,16777235]))),
      dict(name='negative-wall-clock-delta',raw=raw('negative',[wait(100)]),events=list(map(update,[1000,1100,1050,1200]))),
      dict(name='signed-millis-wrap',raw=raw('wrap',[wait(100)]),events=list(map(update,[2147483640,2147483650,2147483700]))),
    ]

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path,default=ROOT/'.cache/samila-realtime-oracle/fixture.json');p.add_argument('--check',action='store_true');args=p.parse_args()
    evidence=timeline.zero.Evidence(timeline.DEFAULT_JAR);easings=timeline.zero.Easings(evidence)
    manifest_path=ROOT/'.cache/v2-samila-realtime-clock-manifest.json'
    manifest=json.loads(manifest_path.read_text())
    assert manifest['nativeExecuted'] is False
    for member in manifest['sources']:
        assert hashlib.sha256((ROOT/member['evidence']).read_bytes()).hexdigest()==member['evidenceSha256']
        artifact=ROOT/member['artifact']
        assert hashlib.sha256(artifact.read_bytes()).hexdigest()==member['artifactSha256']
        with zipfile.ZipFile(artifact) as archive:assert hashlib.sha256(archive.read(member['entry'])).hexdigest()==member['classSha256']
    queue_fixture=ROOT/'tests/fixtures/source-samila/timeline.json'
    queue_provenance=json.loads(queue_fixture.read_text())['provenance']
    with zipfile.ZipFile(timeline.DEFAULT_JAR) as archive:
        for member in queue_provenance['evidence']:
            assert hashlib.sha256((ROOT/member['path']).read_bytes()).hexdigest()==member['evidenceSha256']
            assert hashlib.sha256(archive.read(member['entry'])).hexdigest()==member['classSha256']
    dependencies={str(path.relative_to(ROOT)):hashlib.sha256(path.read_bytes()).hexdigest() for path in [Path(__file__),ROOT/'scripts/source-samila-timeline-oracle.py',ROOT/'scripts/source-zero-duration-oracle.py',queue_fixture]}
    rows=[dict(**case,expected=run_case(case,easings)) for case in cases()]
    report=dict(provenance=dict(kind='independent-python-fixed-bytecode-controlled-millis',dependencies=dependencies,queueEvidence=queue_provenance['evidence'],jarSha256=timeline.JAR_SHA,manifestSha256=hashlib.sha256(manifest_path.read_bytes()).hexdigest(),nativeExecution=False,methods=['PApplet.millis currentTimeMillis-offset then l2i','Scene.update millis i2f /1000 F, lastTime==0 sentinel, F subtraction; paused skips timer and updates','MathArt.togglePause saves phi/theta/gamma, resume restores then refreshes lastTime before loop','Scene whole-queue active dt clips manager/mobject; camera receives full raw dt; finished manager advances scene time by raw dt'],limitations=['Static Java bytecode transcription plus independent Python model, not native execution.','Public UI scheduler timing and captured native entropy are unmeasured.','Negative wall-clock/wrap traces expose original semantics; local admission policy differences must be labeled, not silently normalized.','Queue/parameter transcript shares independent source oracle; expected values never read product TS.']),cases=rows)
    text=json.dumps(report,ensure_ascii=False,separators=(',',':'),allow_nan=False)+'\n';args.output.parent.mkdir(parents=True,exist_ok=True)
    if args.check:assert args.output.read_text()==text,'realtime oracle drift'
    else:args.output.write_text(text)
    print(json.dumps(dict(cases=len(rows),events=sum(len(r['events']) for r in rows),sha256=hashlib.sha256(text.encode()).hexdigest(),output=str(args.output))))
if __name__=='__main__':main()
