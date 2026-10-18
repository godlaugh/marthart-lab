import {describe,it,expect} from 'vitest';
import type {AnimationAction,AnimationTrack} from '../src/types';
import {evaluateOrdinarySourceCameraTimeline as evaluate,resolveOrdinarySourceCameraTimeline as layout,type OrdinarySourceCameraParticles,type OrdinaryCameraParticleFrame} from '../src/engine/ordinarySourceCameraTimeline';
import type {SourceCameraScalars,SourceCameraVec3} from '../src/engine/sourceCamera';

const initial:SourceCameraScalars={phi:0,theta:0,gamma:0,center:[0,0,0],zoom:1,focalDistance:20};
const action=(method:string,index?:number):AnimationAction=>({id:crypto.randomUUID(),method,args:index===undefined?{}:{index}});
const clip=(actions:AnimationAction[]=[],duration=.5,type:AnimationTrack['type']='animate'):AnimationTrack=>({id:crypto.randomUUID(),type,target:'camera.actions',from:0,to:0,start:0,duration,easing:'linear',pingPong:false,enabled:true,actions});

// Instruction-derived identity/order scenarios, not native particle trajectories
// or pixel parity. The two particles deliberately move +1 per Mobject call.
// MathArt 1.7.8 JAR a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018:
// Scene.update PC132/183/225; CameraTrackTransition.onUpdate PC19/onFinish PC15;
// ParametricSurface.update PC0..65; MeshSurface.setTrackedDot PC35..169;
// StrangeAttractor.getParticlePos PC20..29 and executeGPUUpdate PC302..380.
// These doubles isolate the scheduler/identity boundary from unresolved source
// formula, lattice, initialization and GPU production implementations.
describe('source camera particle lifecycle boundary',()=>{
 it.each([
  ['independent-cpu',[5,12,57,104,104]],
  ['last-selected-gpu',[5,10,56,104,104]],
  // At the second transition start both copied center and shared target are
  // 102. The next producer update to 103 happens AFTER this frame's lerp.
  ['shared-mesh-proxy',[50,102,102,104,104]],
  ['initial-attractor-gpu',[5,10,55,100,100]],
 ] as const)('preserves %s identities across eager bindings and both read phases',(policy,expected)=>{
  const tracks=[clip([action('track',0)]),clip([action('track',1)])];
  const createParticles=():OrdinarySourceCameraParticles=>{
   const slots:[number,number,number][]=[[10,0,0],[100,0,0]],proxy:[number,number,number]=[0,0,0];let selected=0;
   return{
    bind(request){
     selected=Number(request.action.args!.index);let target=slots[selected];
     if(policy==='shared-mesh-proxy'){proxy[0]=target[0];target=proxy;}
     return{kind:'bound',readPosition:()=>target};
    },
    update(){
     if(policy==='independent-cpu')slots.forEach(p=>p[0]++);
     else if(policy==='last-selected-gpu')slots[selected][0]++;
     else if(policy==='shared-mesh-proxy')proxy[0]++;
    },
   };
  };
  expect(Array.from({length:5},(_,i)=>evaluate(initial,tracks,4,i/4,{createParticles}).camera.center[0])).toEqual(expected);
 });
 it('binds even overwritten actions, preserves the last effective target, and ignores disabled clips',()=>{
  const disabled=clip([action('track',99)]);disabled.enabled=false;
  const last={...action('track',3),enabled:false};
  const tracks=[clip([action('track',0),action('stopTracking'),action('track',1),action('track',99)]),disabled,clip([last])];
  const calls:string[]=[];let started=false;
  const out=evaluate(initial,tracks,4,.25,{createParticles:()=>({
   bind(r){expect(started).toBe(false);calls.push(`${r.trackId}:${r.actionIndex}:${r.action.args!.index}`);
    if(r.action.args!.index===99)return{kind:'ignored',reason:'confirmed source index out of range'};
    const captured=Number(r.action.args!.index);return{kind:'bound',readPosition:()=>[captured,0,0]};
   },update(){started=true;},
  })});
  expect(calls).toEqual([`${tracks[0].id}:0:0`,`${tracks[0].id}:2:1`,`${tracks[0].id}:3:99`,`${tracks[2].id}:0:3`]);
  expect(out.camera.center).toEqual([1,0,0]);
  expect(out.diagnostics.map(d=>d.code)).toContain('tracking-target-ignored');
  expect(out.diagnostics.map(d=>d.code)).toContain('action-enabled');
 });
 it('updates on waits before the first read and on the final frame, but never after queue completion',()=>{
  const tracks=[clip([],.25,'wait'),clip([action('track',0)]),clip([],.25,'wait')];
  const calls:string[]=[];
  const result=evaluate(initial,tracks,4,1,{createParticles:()=>{
   let x=10;return{bind:()=>({kind:'bound',readPosition:()=>{calls.push(`read:${x}`);return[x,0,0];}}),update:r=>{calls.push(`update:${r.frameIndex}`);x++;}};
  }});
  expect(calls).toEqual(['update:0','read:11','update:1','read:12','update:2','read:13','update:3','read:14','read:14']);
  expect(result.camera.center).toEqual([14,0,0]);expect(result.sceneTime).toBe(1.25);
 });
 it('passes the clamped final active dt, independently of controller raw dt and elapsed display time',()=>{
  const frames:OrdinaryCameraParticleFrame[]=[];
  const out=evaluate(initial,[clip([action('track',0)],.3)],4,1,{createParticles:()=>({bind:()=>({kind:'bound',readPosition:()=>[0,0,0]}),update:f=>frames.push(f)})});
  expect(frames).toEqual([{frameIndex:0,time:.25,deltaTime:.25},{frameIndex:1,time:Math.fround(.3),deltaTime:Math.fround(Math.fround(.3)-.25)}]);
  expect(out.queueComplete).toBe(true);expect(out.frameIndex).toBe(4);
 });
 it('does not update an empty queue, and display-only layout neither binds nor reads particles',()=>{
  let updates=0,binds=0;
  expect(evaluate(initial,[],4,1,{createParticles:()=>({bind:()=>{binds++;throw Error('unexpected bind');},update:()=>{updates++;}})}).camera).toEqual(initial);
  expect([updates,binds]).toEqual([0,0]);
  expect(layout(initial,[clip([action('track',0)])],4).span).toBe(.5);
 });
 it('retains captured object identity when a producer replaces its current slot array',()=>{
  const out=evaluate(initial,[clip([action('track',0)])],4,.75,{createParticles:()=>{
   let slots:[[number,number,number]]=[[7,0,0]];
   return{bind:()=>{const old=slots[0];return{kind:'bound',readPosition:()=>old};},update:()=>{slots=[[99,0,0]];}};
  }});
  expect(out.camera.center).toEqual([7,0,0]);
 });
 it('snapshots a mutable vector and returns independent camera values',()=>{
  const vector:[number,number,number]=[10,20,30];
  const out=evaluate(initial,[clip([action('track',0)])],4,0,{createParticles:()=>({bind:()=>({kind:'bound',readPosition:()=>vector}),update:()=>{vector.fill(100);}})});
  expect(out.camera.center).toEqual([5,10,15]);vector.fill(200);expect(out.camera.center).toEqual([5,10,15]);
 });
 it('recreates particle state for backward seeks and never borrows scalar cache state',()=>{
  const tracks=[clip([action('track',0)],1)];let creations=0,offset=0;
  const createParticles=():OrdinarySourceCameraParticles=>{creations++;let x=offset;return{bind:()=>({kind:'bound',readPosition:()=>[x,0,0]}),update:()=>{x++;}};};
  const late=evaluate(initial,tracks,4,1,{createParticles}),early=evaluate(initial,tracks,4,0,{createParticles});
  expect(late.camera.center).toEqual([4,0,0]);expect(early.camera.center).toEqual([0,0,0]);offset=100;
  expect(evaluate(initial,tracks,4,1,{createParticles}).camera.center).toEqual([104,0,0]);expect(creations).toBe(3);
 });
 it('validates the full plan and work capacity before creating a producer',()=>{
  let creations=0;const createParticles=():OrdinarySourceCameraParticles=>{creations++;throw Error('unexpected creation');};
  expect(()=>evaluate(initial,[clip([action('track',0)]),clip([],0)],4,0,{createParticles})).toThrow('零时长');
  expect(()=>evaluate(initial,[],120,86400,{createParticles})).toThrow('预算');expect(creations).toBe(0);
 });
 it('does not hide missing identity or invalid coordinates as source no-ops',()=>{
  const tracks=[clip([action('track',0)])];
  expect(()=>evaluate(initial,tracks,4,0,{createParticles:()=>({bind:()=>{throw Error('unknown identity');},update:()=>{}})})).toThrow('unknown identity');
  for(const value of [[NaN,0,0],[Infinity,0,0],[1,2]])expect(()=>evaluate(initial,tracks,4,0,{createParticles:()=>({bind:()=>({kind:'bound',readPosition:()=>value as unknown as SourceCameraVec3}),update:()=>{}})})).toThrow();
 });
 it('cancels between producer update and the final target read, then restarts from fresh state',()=>{
  let cancelled=false,reads=0;const tracks=[clip([action('track',0)],.25)];
  const createParticles=():OrdinarySourceCameraParticles=>({bind:()=>({kind:'bound',readPosition:()=>{reads++;return[9,0,0];}}),update:()=>{cancelled=true;}});
  expect(()=>evaluate(initial,tracks,4,0,{createParticles,isCancelled:()=>cancelled})).toThrow('取消');expect(reads).toBe(1);
  cancelled=false;expect(evaluate(initial,tracks,4,0,{createParticles}).camera.center).toEqual([9,0,0]);expect(reads).toBe(3);
 });
});
