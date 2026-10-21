#!/usr/bin/env python3
"""Independent fixed-JAR Samila queue/parameter/camera instruction transcript.

From studio/: python3 scripts/source-samila-timeline-oracle.py [--check] [--jar PATH]
Uses retained class disassemblies and the independent bytecode easing interpreter,
never product TS or original Java execution. Default fixture is maintained under
 tests/fixtures/source-samila/timeline.json. --output allows ignored diagnostics.
"""
import argparse
import copy
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import struct

ROOT=Path(__file__).resolve().parents[1]
JAR_SHA='a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018'
DEFAULT_JAR=ROOT.parent/'.cache/mathart-investigation/MathArt.app/Contents/app/MathArt-1.7.8-b07191b3e97da6fe465555ef6e61a0be.jar'
DEFAULT_OUT=ROOT/'tests/fixtures/source-samila/timeline.json'
spec=importlib.util.spec_from_file_location('independent_zero_duration',ROOT/'scripts/source-zero-duration-oracle.py')
zero=importlib.util.module_from_spec(spec);spec.loader.exec_module(zero)
F=zero.f
TAU=2*math.pi

def bits(v):return struct.pack('>f',v).hex()
def lerp(a,b,t):return F(a+F(F(b-a)*t))
def wrap(v):
    turns=0
    while v>TAU:v-=TAU;turns+=1
    while v<0:v+=TAU;turns+=1
    assert turns<10000,'fixture exceeds bounded independent wrap work'
    return v

def parameter_config(raw):
    def number(k,fallback):
        v=raw.get(k)
        if isinstance(v,bool):return fallback
        try:return float(v) if v is not None else fallback
        except (ValueError,TypeError):return fallback
    step,lo,hi=number('step',.001),number('min',-1),number('max',1)
    lo,hi=min(lo,hi),max(lo,hi)
    return dict(step=step,min=lo,max=hi,mid=(lo+hi)*.5,amp=(hi-lo)*.5)

def phase(initial,c):
    if c['amp']<=1e-6:return 0.
    value=max(c['min'],min(c['max'],initial))
    p=math.asin(max(-1,min(1,(value-c['mid'])/c['amp'])))
    return math.pi-p if c['step']<0 else p

def parameter_child(action,initial):
    args=action.get('args')
    payload=args if isinstance(args,dict) else args[0] if isinstance(args,list) and args and isinstance(args[0],dict) else None
    if payload is None:return None
    configs={};phases={}
    # Fixture keys have independent scalar writes; the native JSONObject key
    # iteration order is not inferred. Compare counts/final maps, not key order.
    for name,raw in payload.get('parameters',{}).items():
        if not isinstance(raw,dict) or raw.get('enable',True) is False:continue
        c=parameter_config(raw);configs[name]=c
        if action['method']=='paramStart':phases[name]=phase(initial.get(name,c['min']),c)
    return dict(method=action['method'],configs=configs,phases=phases)

def compile_queue(raw,easings):
    initial=raw.get('parameters',{});initial_camera=dict(phi=F(math.pi/2),theta=0.,gamma=0.,zoom=1.,focalDistance=20.)
    queue=[]
    for index,clip in enumerate(raw.get('timeline',[])):
        if clip.get('enabled',True) is False:continue
        duration=F(clip.get('duration',1));kind=clip.get('type','wait').lower()
        entry=dict(sourceIndex=index,kind='wait',duration=duration,childDuration=duration,targets={},rates=None,parameters=[],easing='LINEAR')
        if kind=='animate':
            entry['kind']='animate';easing=clip.get('easing','SINE_IN_OUT');entry['easing']=easing if easing in easings.names else 'SINE_IN_OUT'
            for action in clip.get('actions',[]):
                method=action.get('method','');args=action.get('args')
                if method in ['paramStart','paramStop']:
                    child=parameter_child(action,initial)
                    if child is not None:entry['parameters'].append(child)
                    continue
                if not isinstance(args,list):continue
                arg=lambda i:F(args[i]) if i<len(args) else 0.
                if method=='ambient' and len(args)>=2:entry['rates']=[arg(0),arg(1),arg(2)]
                elif method=='stopAmbient':entry['rates']=[0.,0.,0.]
                elif method in ['rotatePhi','rotateTheta','rotateGamma']:
                    key=method[6:].lower();entry['targets'][key]=F(initial_camera[key]+arg(0))
                elif method=='rotateTo' and len(args)>=3:entry['targets'].update(dict(zip(['phi','theta','gamma'],map(arg,range(3)))))
                elif method in ['zoom','focal']:entry['targets']['zoom' if method=='zoom' else 'focalDistance']=arg(0)
            # CameraAnimator: MoveCamera counts once regardless of axes.
            camera_children=int(any(k in entry['targets'] for k in ['phi','theta','gamma']))+int('zoom' in entry['targets'])+int('focalDistance' in entry['targets'])+int(entry['rates'] is not None)
            if camera_children>1 or entry['parameters']:entry['duration']=max(F(0),duration)
        queue.append(entry)
    return initial_camera,queue

def transcript(raw,fps,easings,post_frames=2,steps=None):
    camera,queue=compile_queue(raw,easings);rates=[0.,0.,0.];values=copy.deepcopy(raw.get('parameters',{}));drift={};drift_phases={};drift_active=False
    raw_dt=F(1/F(fps));time=F(0);index=0;current=None;frames=[];revision=0;after=0
    def write(name,value,origin,writes):
        nonlocal revision
        old=values.get(name);values[name]=value;revision+=1
        writes.append(dict(name=name,value=value,origin=origin,sameValue=old==value))
    for frame_index in range(10001 if steps is None else len(steps)):
        if steps is not None:
            raw_dt=F(steps[frame_index]['rawDt'])
            camera.update({k:F(v) for k,v in steps[frame_index].get('restoreCamera',{}).items()})
        before=index>=len(queue) and current is None;remaining=F(0);writes=[];before_values=dict(values)
        if current is not None:remaining=F(remaining+max(F(0),F(queue[index]['duration']-current['runtime'])))
        for item in queue[index+(1 if current else 0):]:remaining=F(remaining+max(F(0),item['duration']))
        active=F(0) if before else min(raw_dt,remaining) if remaining>0 else F(0)
        time=F(time+(raw_dt if before else active));started=None;finished=None
        if not before:
            if current is None:
                current=dict(runtime=F(0),startCamera=dict(camera),startRates=list(rates));started=index
            item=queue[index];current['runtime']=F(current['runtime']+active);run=current['runtime'];done=run>=item['duration'];child_done=run>=item['childDuration']
            if item['kind']=='animate':
                # Base camera callbacks apply their easing once to base progress.
                if item['targets'] or item['rates'] is not None:
                    progress=zero.constrain(F(zero.div(run,item['childDuration'])));eased=easings.apply(item['easing'],progress)
                    for key,target in item['targets'].items():camera[key]=lerp(current['startCamera'][key],target,eased)
                    if item['rates'] is not None:
                        rates=[lerp(a,b,eased) for a,b in zip(current['startRates'],item['rates'])]
                        if child_done:rates=list(item['rates']) # SetAmbientRotation.onFinish snaps.
                progress=1. if item['childDuration']<=0 else min(F(run/item['childDuration']),1.)
                eased=easings.apply(item['easing'],progress)
                for child in item['parameters']:
                    if child['method']=='paramStart':
                        for name,c in child['configs'].items():
                            if c['amp']<=1e-6:value=c['min']
                            else:
                                delta=((abs(c['step'])*float(eased))/c['amp'])*(float(max(active,0))*60.)
                                child['phases'][name]=wrap(child['phases'].get(name,0.)+delta)
                                value=c['mid']+c['amp']*math.sin(child['phases'][name])
                            write(name,value,'animation',writes)
                        if child_done and child['configs']:
                            drift=copy.deepcopy(child['configs']);drift_phases=dict(child['phases']);drift_active=bool(drift)
                    elif child_done:drift={};drift_phases={};drift_active=False
            if done and child_done:finished=index;index+=1;current=None
            # Scene always invokes mobject once when manager was unfinished.
            if drift_active and active>0:
                for name,c in drift.items():
                    if c['amp']<=1e-6:value=c['min']
                    else:
                        delta=(abs(c['step'])/c['amp'])*(float(active)*60.)
                        drift_phases[name]=wrap(drift_phases.get(name,0.)+delta)
                        value=c['mid']+c['amp']*math.sin(drift_phases[name])
                    write(name,value,'drift',writes)
        if steps is None or raw_dt>0:
            for key,rate in zip(['phi','theta','gamma'],rates):camera[key]=F(camera[key]+F(rate*raw_dt))
        complete=index>=len(queue) and current is None
        frames.append(dict(frameIndex=frame_index,time=frame_index/fps,sceneTime=time,rawDt=raw_dt,activeDt=active,managerFinishedAtFrameStart=before,queueIndex=index,queueComplete=complete,startedClip=started,finishedClip=finished,camera=dict(camera),cameraBits={k:bits(v) for k,v in camera.items()},rates=list(rates),parameters=dict(values),parameterWrites=len(writes),parameterWriteRevision=revision,writeDirty=bool(writes),sameValueWrites=sum(w['sameValue'] for w in writes),valueChangedThisFrame=values!=before_values,writes=writes,driftActive=drift_active,driftPhases=dict(drift_phases)))
        if before:after+=1
        if steps is None and complete and after>=post_frames:break
    else:
        if steps is None:raise ValueError('oracle queue frame budget exceeded')
    return dict(fps=fps,frames=frames,queueDurations=[q['duration'] for q in queue],constructedPhases=[copy.deepcopy(q['parameters']) for q in compile_queue(raw,easings)[1]])

def cases(evidence):
    out=[]
    for member in ['data/samila/Samila.json',*[f'data/samila/samila{i}.json' for i in range(1,5)]]:
        data=evidence.jar.read(member);raw=json.loads(data);out.append(dict(name='packaged-'+Path(member).stem,raw=raw,fps=4,resource=dict(member=member,sha256=hashlib.sha256(data).hexdigest())))
    def action(method,args):return dict(method=method,args=args)
    def param(step=.03,lo=-1,hi=1,name='a'):return action('paramStart',{'parameters':{name:dict(step=step,min=lo,max=hi)}})
    def clip(actions=None,duration=.5,easing='LINEAR',kind=None):return dict(type=kind or ('animate' if actions is not None else 'wait'),duration=duration,easing=easing,**({'actions':actions} if actions is not None else {}))
    stop=action('paramStop',{});wait=lambda duration:clip(duration=duration)
    def add(name,timeline,parameters=None,fps=4):out.append(dict(name=name,fps=fps,raw=dict(type='SAMILA',config_version='1.0.0',name=name,equations=dict(f1='a',f2='x'),parameters=parameters or {'a':0.},settings=dict(batch_size=8,render_mode='GPU',show_trails=False),timeline=timeline)))
    add('empty-queue',[])
    add('zero-final-start',[clip([param()],0)])
    add('negative-final-start',[clip([param()],-1)])
    add('negative-camera-parameter-final',[clip([action('rotateTheta',[1]),param()],-1)])
    add('negative-camera-parameter-followed-wait',[clip([action('rotateTheta',[1]),param()],-1),wait(.5)])
    add('zero-start-short-wait',[clip([param()],0),wait(.05)],fps=10)
    add('subframe-start',[clip([param()],.01),wait(.02)],fps=30)
    add('same-group-start-stop',[clip([param(),stop]),wait(.5)])
    add('same-group-stop-start',[clip([stop,param()]),wait(.5)])
    add('cross-group-delayed-stop-restart',[clip([param()],.25),clip([stop],.5),wait(.25),clip([param(-.02,-2,2)],.25),wait(.5)])
    add('old-drift-overwrites-new-animation',[clip([param(.02)],.25),clip([param(.1,-2,2)],.75),wait(.5)])
    add('same-group-start-start-last-registry',[clip([param(.02),param(-.03,-2,2)]),wait(.5)])
    add('empty-start-preserves-old-drift',[clip([param()],.25),clip([action('paramStart',{})],.5),wait(.25)])
    add('empty-array-stop-ignored-object-stop-applied',[clip([param()],.25),clip([action('paramStop',[])],.25),clip([stop],.25),wait(.25)])
    add('same-value-write-dirty',[clip([param(0,.5,.5)],.25),wait(.5)],{'a':.5})
    add('subthreshold-write-dirty',[clip([param(1e-12)],.25),wait(.5)])
    add('new-parameter-defaults-and-enable',[clip([action('paramStart',{'parameters':{'fresh':{},'a':{'step':.02,'enabled':False},'disabled':{'enable':False}}})],.25),wait(.25)])
    add('negative-easing-wrap',[clip([param(.2)],1,'BACK_IN'),wait(.25)],{'a':-.8})
    add('zero-easing-endpoint-finishes-drift',[clip([param()],.5,'THERE_AND_BACK'),wait(.25)])
    add('relative-camera-built-before-runtime',[clip([action('rotateTheta',[1]),action('ambient',[0,1,0]),param()],.5),clip([action('rotateTheta',[1])],.5),clip([action('stopAmbient',[])],.5),wait(.25)])
    add('builder-last-axis-and-inert-camera-fields',[clip([action('rotateTo',[1,2,3]),action('rotateTheta',[.25]),action('zoom',[2]),action('focal',[30]),action('ambient',[.2,.3,.4])],.5),wait(.25)])
    add('unknown-clips-wait-disabled-skipped',[dict(type='align',duration=.25,actions=[param()]),dict(type='animate',duration=99,enabled=False,actions=[param()]),clip([dict(method='ambient',enabled=False,args=[0,.5,0])],.25),wait(.25)])
    return out

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--jar',type=Path,default=DEFAULT_JAR);parser.add_argument('--output',type=Path,default=DEFAULT_OUT);parser.add_argument('--check',action='store_true');args=parser.parse_args()
    evidence=zero.Evidence(args.jar);easings=zero.Easings(evidence)
    names=['JsonSamilaConfig','GenericSamilaScene','SamilaParamAnimation','SamilaParamAnimation$ParamConfig','SamilaMobject','SamilaMobject$DriftConfig','Scene','SceneManager','Animation','AnimationGroup','CameraAnimator','CameraController','MoveCamera','ZoomCamera','SmoothFocalDistance','SetAmbientRotation','Wait']
    for name in names:evidence.read('.cache/v2-samila-timeline-source/'+name+'.class.json')
    rows=[]
    for item in cases(evidence):rows.append(dict(**item,expected=transcript(item['raw'],item['fps'],easings)))
    report=dict(provenance=dict(kind='independent-python-bytecode-transcription',nativeExecution=False,jarSha256=JAR_SHA,evidence=evidence.rows,methods=['JsonSamilaConfig.setupTimeline PC373-444 camera first, then parameter children; builder snapshots entire queue','SamilaParamAnimation.<init> PC209-296 construction snapshot and calcPhase; ParamConfig PC13-60 sorted endpoints/double middle and amplitude','SamilaParamAnimation.update PC26 runtime float; PC38 duration<=0 progress1; PC68 one easing; PC85 max(dt,0); PC106 finish','SamilaParamAnimation.onUpdate PC128-151 double increment times dt*60; wrapPhase while >TAU/<0; updateParameter208','SamilaParamAnimation.onFinish PC36 install replacement drift or PC58 clear all drift','SamilaMobject.update PC31 drift after queue; updateParamDrift PC105-132 no easing and double dt*60; updateParameter PC47 unconditional dirty','Scene.update PC16 prefinished, PC108 total-remaining clipped dt, PC132 queue, PC183 model, PC225 raw-dt camera','SceneManager.update PC43 one clip start, PC62 one update, PC87 next index; AnimationGroup PC48-65 max positive duration','SetAmbientRotation.onStart runtime rates; onUpdate easing/float lerp; onFinish snaps rates; CameraController.update float rate*rawDt'],limitations=['No original JVM, GUI, GL initialization, framebuffer or random stream executed. Assumes original Mobject GL initialization succeeds.','Fixed render-mode dt is explicit; native interactive millis first-dt0 behavior is not modeled.','Python and JS host double transcendental low bits may differ; compare finite doubles at declared tolerance, Float32 camera bits exactly.','Parameter getter cases here use numeric values/defaults only; malformed scalar/schema/whole-source import coverage belongs to separate boundary tests.','Independent parameter names have order-independent final writes. Per-frame key write list is diagnostic; native JSONObject HashMap traversal order is not asserted.','Write dirty means a call to updateParameter, not a claim of rendered clearing/6x compensation coverage.']),cases=rows)
    text=json.dumps(report,ensure_ascii=False,separators=(',',':'),allow_nan=False)+'\n';args.output.parent.mkdir(parents=True,exist_ok=True)
    if args.check:
        if args.output.read_text()!=text:raise SystemExit('Samila timeline oracle drift')
    else:args.output.write_text(text)
    print(json.dumps(dict(cases=len(rows),frames=sum(len(r['expected']['frames']) for r in rows),bytes=len(text.encode()),sha256=hashlib.sha256(text.encode()).hexdigest(),output=str(args.output),nativeExecution=False)))
if __name__=='__main__':main()
