import {describe,expect,it} from 'vitest';
import {RootsSceneClock,RootsSceneClockError,ROOTS_SCENE_MAX_GRADIENT_ACTIONS} from '../src/engine/rootsSceneClock';
import type {RootsSceneClip,RootsSceneGradientAction} from '../src/engine/rootsSceneClock';
import type {RootsGradientConfiguration} from '../src/engine/rootsGradientConfig';
import cameraFixtures from './fixtures/roots/camera-2929-clock-compat.json';
import targets from './fixtures/roots/gradient-static-targets.json';

const camera={phi:0,theta:0,gamma:0,zoom:1};
const config:RootsGradientConfiguration={mode:'hue_rotate',interpolation:'linear',speed:360};
const start=(overrides:Partial<RootsGradientConfiguration>={}):RootsSceneGradientAction=>({kind:'start',config:{...config,...overrides}});
const stop:RootsSceneGradientAction={kind:'stop'};
const clip=(duration:number,gradientActions:readonly RootsSceneGradientAction[]=[],extra:Partial<RootsSceneClip>={}):RootsSceneClip=>({duration,easing:'linear',gradientActions,...extra});
const clock=(clips:readonly RootsSceneClip[],initialOffset=0)=>new RootsSceneClock(camera,clips,{gradient:{initialOffset}});
function code(action:()=>unknown):string|undefined {
  try{action();}catch(error){expect(error).toBeInstanceOf(RootsSceneClockError);return(error as RootsSceneClockError).code;}
}
const bits=(value:number)=>{const view=new DataView(new ArrayBuffer(4));view.setFloat32(0,value);return view.getUint32(0).toString(16).padStart(8,'0');};

describe('scene clock preserves the accepted camera-only contract',()=>{
  it.each(cameraFixtures.cases)('matches all 10 frozen 2929 frames for $easing',fixture=>{
    const clips:RootsSceneClip[]=fixture.clips.map(({rates,...row})=>({...row,rates:rates as [number,number,number]|undefined}));
    const current=new RootsSceneClock(fixture.initial,clips);
    const frames=fixture.steps.map(({dt,paused})=>current.step(dt,{paused}));
    expect(frames).toEqual(fixture.frames);
    for(const frame of frames){expect(frame).not.toHaveProperty('gradient');expect(frame).not.toHaveProperty('managerFinishedAtFrameStart');}
  });
  it('does not activate or inspect latent gradient actions without the explicit option',()=>{
    const current=new RootsSceneClock(camera,[{duration:1,easing:'linear',gradientActions:'unparsed legacy metadata' as never}]);
    expect(current.step(.25).camera).toEqual(camera);expect(current.gradientActionCount).toBe(0);
    expect(current.snapshot()).not.toHaveProperty('gradient');
  });
  it('keeps zero signs and transactional camera arithmetic behavior',()=>{
    const current=new RootsSceneClock({...camera,phi:-0},[clip(1,[],{rates:[1,0,0]})]);
    expect(Object.is(current.step(-0).camera.phi,-0)).toBe(true);
    const max=3.4028234663852886e38,overflow=new RootsSceneClock({...camera,phi:max},[clip(1,[],{rates:[max,0,0]})]);
    expect(code(()=>overflow.step(1))).toBe('arithmetic');expect(overflow.snapshot().frame).toBe(0);
  });
});

describe('source gradient frame targets and ordered active/raw phases',()=>{
  it.each(targets.vectors)('$mode/$interpolation matches independent Python target bits',vector=>{
    // A .5s starting clip at speed180 finishes at scale1, so each of its two
    // updates contributes progress .25. The first phase tests the source
    // buildFrame + Roots F32 target mapping independently of the final phase.
    const current=clock([clip(.5,[start({mode:vector.mode.toLowerCase() as RootsGradientConfiguration['mode'],interpolation:vector.interpolation.toLowerCase() as RootsGradientConfiguration['interpolation'],speed:180})])],vector.baseAll);
    const frame=current.step(.5),phase=frame.gradient!.phases[0];
    expect(phase.progressAfter).toBe(vector.progress);expect(bits(phase.offsetAfter)).toBe(vector.targetFloatBits);
  });
  it('matches independent 4fps start/stop frames and freezes the GPU scalar offset',()=>{
    const current=clock([clip(1,[start()]),clip(.5,[stop])]);
    const expected=[.125,.375,.75,.25,.5,.5,.5];
    expected.forEach((offset,index)=>{
      const frame=current.step(.25);expect(frame.gradient!.offset).toBe(offset);
      expect(frame.gradient!.updates).toBe(index<6?2:1);
      expect(frame.managerFinishedAtFrameStart).toBe(index>=6);
    });
    expect(current.snapshot().gradient).toMatchObject({running:false,progress:.5,speedScale:0,targetSpeed:0,offset:.5});
  });
  it('continues once per raw frame after the queue completes',()=>{
    const current=clock([clip(1,[start()])]);
    const frames=Array.from({length:7},()=>current.step(.25));
    expect(frames.map(f=>f.gradient!.offset)).toEqual([.125,.375,.75,.25,.5,.75,0]);
    expect(frames.map(f=>f.gradient!.phases.map(p=>p.kind))).toEqual([['active','raw'],['active','raw'],['active','raw'],['active','raw'],['raw'],['raw'],['raw']]);
  });
  it('never merges two dt values: independent high-speed remainder witness',()=>{
    // Python binary64 + binary32 transcription: active=.01F, raw=(1/60)F.
    // Two remainder operations yield .5; merging dt would yield .53125.
    const frame=clock([clip(.01,[start({speed:3.6e18})])]).step(1/60);
    expect(frame.gradient!.phases.map(p=>p.progressAfter)).toEqual([.828125,.5]);
    expect(frame.gradient!.offset).toBe(.5);expect(frame.activeDt).toBe(Math.fround(.01));
  });
  it('does not carry an overstepped short group to the next group',()=>{
    const current=clock([clip(.1,[start()]),clip(.1,[stop])]);
    const first=current.step(.25);
    expect(first.queueIndex).toBe(1);expect(first.gradient!.running).toBe(true);
    expect(first.gradient!.phases.map(p=>p.dt)).toEqual([Math.fround(Math.fround(.1)+Math.fround(.1)),.25]);
    expect(current.step(.25).gradient!.running).toBe(false);
  });
  it('paused calls only reapply the running target without queue/time/progress advance',()=>{
    const current=clock([clip(1,[start()])]);
    const initial=current.step(7,{paused:true});expect(initial.startedClip).toBeNull();expect(initial.gradient!.phases).toEqual([{kind:'raw',dt:0,applied:false,progressBefore:0,progressAfter:0,offsetBefore:0,offsetAfter:0}]);
    current.step(.25);const before=current.snapshot();const paused=current.step(7,{paused:true});
    expect(paused.camera).toEqual(before.camera);expect(paused.clipRuntime).toBe(before.clipRuntime);expect(paused.sceneTime).toBe(before.sceneTime);
    expect(paused.gradient!.progress).toBe(before.gradient!.progress);expect(paused.gradient!.offset).toBe(before.gradient!.offset);
    expect(paused.gradient!.phases).toHaveLength(1);expect(paused.gradient!.phases[0]).toMatchObject({kind:'raw',dt:0,applied:true});
  });
  it('dt0 starts all actions and applies the target while preserving negative-zero equality',()=>{
    const current=clock([clip(1,[start()])],-0),frame=current.step(-0);
    expect(frame.startedClip).toBe(0);expect(frame.gradient!.running).toBe(true);
    expect(frame.gradient!.progress).toBe(0);expect(Object.is(frame.gradient!.offset,-0)).toBe(true);
    expect(frame.gradient!.phases.every(p=>p.applied)).toBe(true);
  });
  it('uses current retained F32 offset as the next start baseline',()=>{
    const current=clock([clip(.25,[start()]),clip(.25,[stop]),clip(.25,[start({speed:180})])]);
    expect(current.step(.25).gradient!.offset).toBe(.5);expect(current.step(.25).gradient!.offset).toBe(.5);
    expect(current.step(.25).gradient!.offset).toBe(.75);
  });
  it('keeps an overflowed target cast instead of corrupting the last finite offset',()=>{
    const max=3.4028234663852886e38;
    const frame=clock([clip(1,[start({mode:'cross_fade'})])],max).step(.25);
    expect(frame.gradient!.offset).toBe(max);expect(frame.gradient!.progress).toBe(.125);
  });
  it('allows source easing overshoot above one and clamps only negative scale',()=>{
    const over=clock([clip(1,[start()],{easing:'back-out'})]).step(.5);
    expect(over.gradient!.speedScale).toBeGreaterThan(1);
    const under=clock([clip(1,[start()],{easing:'back-in'})]).step(.25);
    expect(under.gradient!.speedScale).toBe(0);expect(under.gradient!.progress).toBe(0);
  });
});

describe('all child start calls precede ordered update/finish calls',()=>{
  const cases=[
    {names:['start','stop'],runningBefore:false,finalRunning:false,finalScale:0},
    {names:['stop','start'],runningBefore:false,finalRunning:true,finalScale:1},
    {names:['start','start'],runningBefore:false,finalRunning:true,finalScale:1},
    {names:['stop','stop'],runningBefore:false,finalRunning:false,finalScale:0},
    {names:['start','stop'],runningBefore:true,finalRunning:false,finalScale:0},
    {names:['stop','start'],runningBefore:true,finalRunning:false,finalScale:1},
    {names:['start','start'],runningBefore:true,finalRunning:true,finalScale:1},
    {names:['stop','stop'],runningBefore:true,finalRunning:false,finalScale:0},
  ];
  it.each(cases)('$names, runningBefore=$runningBefore',entry=>{
    const actions=entry.names.map(name=>name==='start'?start():stop);
    const current=clock([...(entry.runningBefore?[clip(.25,[start()])]:[]),clip(1,actions)]);
    if(entry.runningBefore)current.step(.25);
    current.step(.5);const result=current.step(.5);
    expect(result.gradient).toMatchObject({running:entry.finalRunning,speedScale:entry.finalScale});expect(result.queueComplete).toBe(true);
    if(entry.names.join(',')==='start,stop')expect(result.gradient!.progress).toBe(0);
  });
  it('a later start determines the shared config but earlier children still finish',()=>{
    const current=clock([clip(1,[start(),stop,start({speed:180})])]);
    current.step(.5);const result=current.step(.5);
    expect(result.gradient!.config!.speed).toBe(180);expect(result.gradient!.speedScale).toBe(1);
    expect(result.gradient!.running).toBe(false);expect(result.gradient!.targetSpeed).toBe(0);
  });
  it('finishes camera ambient first while non-unit zoom easing and gradient finish differ',()=>{
    const result=clock([clip(1,[start()],{easing:'there-and-back',zoom:5,rates:[2,0,0]})]).step(1);
    expect(result.camera).toEqual({phi:2,theta:0,gamma:0,zoom:1});expect(result.gradient!.speedScale).toBe(1);
  });
});

describe('transactional errors, cancellation, and bounded ownership',()=>{
  it('rejects malformed explicit configuration and checks aggregate action capacity before cloning',()=>{
    expect(code(()=>clock([clip(1,[start({speed:Infinity})])]))).toBe('input');
    expect(code(()=>clock([clip(1,[{kind:'wrong'} as never])]))).toBe('input');
    expect(code(()=>clock([clip(1,Array.from({length:ROOTS_SCENE_MAX_GRADIENT_ACTIONS+1},()=>stop))]))).toBe('capacity');
    expect(code(()=>clock([],1e40))).toBe('input');
  });
  it('copies configs and action arrays, freezes snapshots and resets all owned state',()=>{
    const raw={...config};const actions:RootsSceneGradientAction[]=[{kind:'start',config:raw}];const current=clock([clip(1,actions)]);
    raw.speed=0;actions.length=0;const frame=current.step(.25);
    expect(frame.gradient!.offset).toBe(.125);expect(Object.isFrozen(frame.gradient)).toBe(true);expect(Object.isFrozen(frame.gradient!.config)).toBe(true);expect(Object.isFrozen(frame.gradient!.phases[0])).toBe(true);
    current.step(.25);expect(frame.gradient!.offset).toBe(.125);
    current.reset();expect(current.snapshot().gradient).toMatchObject({running:false,progress:0,offset:0,updates:0});expect(current.snapshot().gradient).not.toHaveProperty('config');expect(current.step(.25)).toEqual(frame);
  });
  it('rejects nonfinite intermediate progress transactionally even when divided result could be finite',()=>{
    const current=clock([clip(3,[start({speed:1e308})])]);const before=current.snapshot();
    expect(code(()=>current.step(3))).toBe('arithmetic');expect(current.snapshot()).toEqual(before);
    expect(current.step(0).gradient!.running).toBe(true);
  });
  it('cancels inside child start/update loops and retries without leaked progress/config',()=>{
    const actions=Array.from({length:512},()=>start());const current=clock([clip(1,actions)]);let calls=0;
    const before=current.snapshot();expect(code(()=>current.step(.25,{isCancelled:()=>++calls===8}))).toBe('cancelled');expect(current.snapshot()).toEqual(before);
    expect(current.step(.25).gradient!.offset).toBe(.125);
  });
  it('preserves caller callback exceptions and aborts before committing completed phases',()=>{
    const current=clock([clip(1,[start()])]);const failure=new Error('caller owned');
    expect(()=>current.step(.25,{isCancelled:()=>{throw failure;}})).toThrow(failure);
    let calls=0;expect(code(()=>current.step(.25,{isCancelled:()=>++calls===5}))).toBe('cancelled');expect(current.snapshot().frame).toBe(0);
    expect(current.step(.25).gradient!.phases).toHaveLength(2);
  });
  it('retains at most two current phase facts after many frames, not frame history',()=>{
    const current=clock([clip(.25,[start()])]);for(let i=0;i<1000;i++)current.step(.25);
    expect(current.snapshot().frame).toBe(1000);expect(current.snapshot().gradient!.phases).toHaveLength(1);
  });
});
