import {describe,it,expect} from 'vitest';
import {RootsSceneClock,RootsSceneClockError,ROOTS_SCENE_MAX_CLIPS} from '../src/engine/rootsSceneClock';
import type {RootsSceneClip} from '../src/engine/rootsSceneClock';
import {lookupSourceEasing,SOURCE_EASING_NAMES} from '../src/engine/sourceEasing';

const initial={phi:0,theta:0,gamma:0,zoom:1};
const linear=(duration:number,extra:Partial<RootsSceneClip>={}):RootsSceneClip=>({duration,easing:'linear',...extra});
function errorCode(action:()=>unknown):string|undefined {
  try{action();}catch(error){expect(error).toBeInstanceOf(RootsSceneClockError);return(error as RootsSceneClockError).code;}
}

describe('Roots source camera queue: independent static frame goldens',()=>{
  // Exact binary fractions, derived from SetAmbientRotation/Animation/Scene
  // bytecode, not from the production easing or clock implementation.
  it('updates rates before integrating all three angles, then stops on the next clip',()=>{
    const clock=new RootsSceneClock(initial,[linear(1,{rates:[1,2,-1]}),linear(.5,{rates:[0,0,0]})]);
    const expected=[[.25,.0625],[.5,.1875],[.75,.375],[1,.625],[.5,.75],[0,.75],[0,.75]];
    expected.forEach(([rate,angle],i)=>{
      const result=clock.step(.25);
      expect(result.rates).toEqual([rate,rate*2,rate===0?0:-rate]);
      expect(result.camera).toEqual({phi:angle,theta:angle*2,gamma:-angle,zoom:1});
      expect(result.frame).toBe(i+1);
      expect(result.startedClip).toBe(i===0?0:i===4?1:null);
      expect(result.finishedClip).toBe(i===3?0:i===5?1:null);
      expect(result.queueComplete).toBe(i>=5);
    });
  });
  it('clamps manager time to all remaining durations, not this clip, while camera takes rawDt',()=>{
    const clock=new RootsSceneClock(initial,[linear(.1,{rates:[1,0,0]}),linear(.1)]);
    const first=clock.step(.25);
    expect(first.activeDt).toBe(.20000000298023224);
    expect(first.rawDt).toBe(.25);expect(first.sceneTime).toBe(.20000000298023224);
    expect(first.camera.phi).toBe(.25);expect(first.queueIndex).toBe(1);
    expect(first.startedClip).toBe(0);expect(first.finishedClip).toBe(0);
    const second=clock.step(.25);
    expect(second.activeDt).toBe(.10000000149011612);
    expect(second.sceneTime).toBe(.30000001192092896);
    expect(second.camera.phi).toBe(.5);expect(second.queueComplete).toBe(true);
    const third=clock.step(.25);
    expect(third.sceneTime).toBe(.550000011920929);expect(third.camera.phi).toBe(.75);
  });
  it('does not carry a large frame remainder into the next clip',()=>{
    const clock=new RootsSceneClock(initial,[linear(.25,{zoom:2}),linear(.25,{zoom:5})]);
    const first=clock.step(10);
    expect(first.camera.zoom).toBe(2);expect(first.sceneTime).toBe(.5);expect(first.queueComplete).toBe(false);
    expect(first.startedClip).toBe(0);expect(first.finishedClip).toBe(0);
    const second=clock.step(0);
    expect(second.startedClip).toBe(1);expect(second.finishedClip).toBe(null);expect(second.camera.zoom).toBe(2);
    expect(clock.step(.25).camera.zoom).toBe(5);
  });
  it('does not start while paused; zero-dt unpaused starts and applies progress zero',()=>{
    const clock=new RootsSceneClock(initial,[linear(1,{zoom:3,rates:[1,0,0]})]);
    const paused=clock.step(5,{paused:true});
    expect(paused).toMatchObject({frame:1,rawDt:0,activeDt:0,sceneTime:0,queueIndex:0,startedClip:null,paused:true});
    const zero=clock.step(0);
    expect(zero).toMatchObject({frame:2,rawDt:0,activeDt:0,sceneTime:0,startedClip:0,finishedClip:null});
    expect(zero.camera).toEqual(initial);expect(zero.rates).toEqual([0,0,0]);
    expect(clock.step(.5).camera).toEqual({phi:.25,theta:0,gamma:0,zoom:2});
  });
  it('retains rates after completion and does not advance them during a pause',()=>{
    const clock=new RootsSceneClock(initial,[linear(.5,{rates:[1,-2,3]})]);
    expect(clock.step(.5).camera).toEqual({phi:.5,theta:-1,gamma:1.5,zoom:1});
    expect(clock.step(9,{paused:true}).camera).toEqual({phi:.5,theta:-1,gamma:1.5,zoom:1});
    expect(clock.step(.25).camera).toEqual({phi:.75,theta:-1.5,gamma:2.25,zoom:1});
  });
  it('starts both children from the previous frame state and snapshots again on the next clip',()=>{
    const clock=new RootsSceneClock(initial,[linear(.5,{zoom:3,rates:[2,0,0]}),linear(1,{zoom:7,rates:[-2,0,0]})]);
    expect(clock.step(.5).camera).toEqual({phi:1,theta:0,gamma:0,zoom:3});
    const frame=clock.step(.25);
    expect(frame.camera.zoom).toBe(4);expect(frame.rates[0]).toBe(1);expect(frame.camera.phi).toBe(1.25);
  });
  it('snaps ambient targets on finish but does not invent a ZoomCamera.onFinish snap',()=>{
    const clock=new RootsSceneClock(initial,[{duration:1,easing:'there-and-back',zoom:5,rates:[2,0,0]}]);
    expect(clock.step(.5).camera).toEqual({phi:1,theta:0,gamma:0,zoom:5});
    const final=clock.step(.5);
    expect(final.camera.zoom).toBe(1);expect(final.rates[0]).toBe(2);expect(final.camera.phi).toBe(2);
    expect(final.queueComplete).toBe(true);
  });
  it('preserves non-unit easing endpoint and negative/zero zoom',()=>{
    const clock=new RootsSceneClock(initial,[{duration:1,easing:'not-quite-there',zoom:3},linear(1,{zoom:0}),linear(1,{zoom:-2})]);
    expect(clock.step(1).camera.zoom).toBe(2.4000000953674316);
    expect(clock.step(1).camera.zoom).toBe(0);
    expect(clock.step(1).camera.zoom).toBe(-2);
  });
  it('preserves the source remaining-duration left fold and F32 time addition',()=>{
    const clock=new RootsSceneClock(initial,[linear(16777216),linear(1),linear(1)]);
    const first=clock.step(16777218);
    expect(first.activeDt).toBe(16777216);expect(first.sceneTime).toBe(16777216);
    expect(first.queueIndex).toBe(1);
    const second=clock.step(1);
    expect(second.sceneTime).toBe(16777216);expect(second.queueIndex).toBe(2);
    expect(clock.step(1).queueComplete).toBe(true);
  });
  it('matches independent non-binary float-stage bits for progress, lerp, and angle integration',()=>{
    // Python struct binary32 transcription of the retained fsub/fmul/fadd
    // sequence; no production clock/easing function generated these bit words.
    const clock=new RootsSceneClock({phi:.1,theta:-.3,gamma:.7,zoom:1/3},[linear(.7,{zoom:2/3,rates:[.3,-.2,.7]})]);
    const result=clock.step(1/30),view=new DataView(new ArrayBuffer(4));
    const bits=(value:number)=>{view.setFloat32(0,value);return view.getUint32(0).toString(16).padStart(8,'0');};
    expect(bits(result.rawDt)).toBe('3d088889');
    expect(result.rates.map(bits)).toEqual(['3c6a0ea3','bc1c09c2','3d088889']);
    expect([result.camera.phi,result.camera.theta,result.camera.gamma,result.camera.zoom].map(bits)).toEqual(['3dcdc676','be99c336','3f337c04','3eb2cb2d']);
  });
  it('has no phantom initial wait for an empty queue',()=>{
    const clock=new RootsSceneClock(initial,[]);
    expect(clock.snapshot()).toMatchObject({frame:0,queueComplete:true,startedClip:null,finishedClip:null});
    expect(clock.step(.25)).toMatchObject({frame:1,rawDt:.25,activeDt:.25,sceneTime:.25,queueComplete:true});
  });
});

describe('Roots camera clock ownership and failure boundaries',()=>{
  it('copies authored input, freezes public snapshots, and resets without retaining frame history',()=>{
    const camera={...initial};const rates:[number,number,number]=[1,0,0];const clips=[linear(1,{zoom:3,rates})];
    const clock=new RootsSceneClock(camera,clips);camera.zoom=100;rates[0]=100;clips[0]=linear(1,{zoom:100});
    const first=clock.step(.5);
    expect(first.camera.zoom).toBe(2);expect(first.rates[0]).toBe(.5);
    expect(Object.isFrozen(first)).toBe(true);expect(Object.isFrozen(first.camera)).toBe(true);expect(Object.isFrozen(first.rates)).toBe(true);
    clock.step(.5);expect(first.camera.zoom).toBe(2);
    clock.reset();expect(clock.snapshot().camera).toEqual(initial);expect(clock.snapshot().frame).toBe(0);
    expect(clock.step(.5)).toEqual(first);
  });
  it('narrows finite initial/target/dt fields once and keeps negative zero camera at zero dt',()=>{
    const clock=new RootsSceneClock({...initial,phi:-0,zoom:1/3},[linear(1,{zoom:2/3})]);
    expect(clock.snapshot().camera.zoom).toBe(.3333333432674408);
    expect(Object.is(clock.step(-0).camera.phi,-0)).toBe(true);
    expect(clock.step(1).camera.zoom).toBe(.6666666865348816);
  });
  it.each([0,-1,NaN,Infinity,1e40,1e-50])('rejects invalid or underflowed duration %s explicitly',duration=>{
    expect(errorCode(()=>new RootsSceneClock(initial,[linear(duration)]))).toBe('input');
  });
  it('rejects malformed fields/canonical names and the queue allocation bound',()=>{
    expect(errorCode(()=>new RootsSceneClock({...initial,phi:1e40},[]))).toBe('input');
    expect(errorCode(()=>new RootsSceneClock(initial,[linear(1,{rates:[0,Infinity,0]})]))).toBe('input');
    expect(errorCode(()=>new RootsSceneClock(initial,[linear(1,{zoom:NaN})]))).toBe('input');
    expect(errorCode(()=>new RootsSceneClock(initial,[{duration:1,easing:'SINE_IN'}]))).toBe('input');
    expect(errorCode(()=>new RootsSceneClock(initial,Array.from({length:ROOTS_SCENE_MAX_CLIPS+1},()=>linear(1))))).toBe('capacity');
    const clock=new RootsSceneClock(initial,[]);
    for(const dt of [-1,NaN,Infinity,1e40])expect(errorCode(()=>clock.step(dt))).toBe('input');
    expect(clock.snapshot().frame).toBe(0);
  });
  it('does not commit a partially computed camera on overflow',()=>{
    const max=3.4028234663852886e38;
    const clock=new RootsSceneClock({...initial,phi:max},[linear(1,{rates:[max,0,0]})]);
    const before=clock.snapshot();
    expect(errorCode(()=>clock.step(1))).toBe('arithmetic');expect(clock.snapshot()).toEqual(before);
    expect(clock.step(0).startedClip).toBe(0);
  });
  it('reports source duration-sum overflow instead of treating it as completed or infinite',()=>{
    const clock=new RootsSceneClock(initial,[linear(3.4028234663852886e38),linear(3.4028234663852886e38)]);
    expect(errorCode(()=>clock.step(.1))).toBe('arithmetic');expect(clock.snapshot().frame).toBe(0);
  });
  it('cancels within the bounded remaining-time fold and can retry with unchanged start values',()=>{
    const clock=new RootsSceneClock(initial,Array.from({length:500},()=>linear(1,{zoom:3})));
    const before=clock.snapshot();let checks=0;
    expect(errorCode(()=>clock.step(.5,{isCancelled:()=>++checks===4}))).toBe('cancelled');
    expect(checks).toBe(4);expect(clock.snapshot()).toEqual(before);
    expect(clock.step(.5).camera.zoom).toBe(2);
  });
  it('preserves caller callback errors and catches cancellation after arithmetic but before commit',()=>{
    const clock=new RootsSceneClock(initial,[linear(1,{zoom:3})]);const failure=new Error('caller failure');
    expect(()=>clock.step(.5,{isCancelled:()=>{throw failure;}})).toThrow(failure);
    let calls=0;expect(errorCode(()=>clock.step(.5,{isCancelled:()=>++calls===3}))).toBe('cancelled');
    expect(clock.snapshot().frame).toBe(0);expect(clock.step(.5).camera.zoom).toBe(2);
  });
});

describe('exact retained source easing lookup',()=>{
  it('maps all 46 registered source keys without changing public spelling semantics',()=>{
    for(const name of SOURCE_EASING_NAMES)expect(lookupSourceEasing(name.toUpperCase().replaceAll('-','_'))).toBe(name);
    expect(lookupSourceEasing('SINE_IN_OUT')).toBe('sine-in-out');
  });
  it('does not trim, case-fold, accept inherited names, or choose a fallback',()=>{
    for(const raw of ['sine-in-out','sine_in_out',' SINE_IN_OUT','SINE_IN_OUT ','step','toString',null,undefined,1])
      expect(lookupSourceEasing(raw)).toBeUndefined();
  });
});
