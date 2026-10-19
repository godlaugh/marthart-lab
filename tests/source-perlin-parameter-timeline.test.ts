import {describe,it,expect} from 'vitest';
import type {AnimationAction,AnimationTrack} from '../src/types';
import {OrdinarySourceCameraTimelineSession} from '../src/engine/ordinarySourceCameraTimeline';
import {SourcePerlinParameterRuntime} from '../src/engine/sourcePerlinParameterRuntime';
import {importSourcePerlinParameterAction,type SourcePerlinParameterAction} from '../src/engine/sourcePerlinParameterConfig';
import {SourcePerlinColorRuntime} from '../src/engine/sourcePerlinColorRuntime';

const initial={noise_offset:0,noise_scale:12,curve_noise_scale:1.25,curve_angle_scale:3.5};
const camera={phi:Math.PI/2,theta:0,gamma:0,zoom:1,center:[0,0,0] as [number,number,number],focalDistance:20};
const action=(method:'paramStart'|'paramStop',args:unknown):AnimationAction=>{
 const p=importSourcePerlinParameterAction(method,args);if(!p.ok||!p.value.action)throw Error('invalid fixture');
 return{id:crypto.randomUUID(),method,perlinParameters:p.value.action};
};
const start=()=>action('paramStart',{parameters:{noise_scale:{step:1,min:4,max:30}}});
const gradient:AnimationAction={id:'gradient',method:'gradientStart',gradient:{model:'offsets',mode:'hue_rotate',interpolation:'linear',speed:90,affectInside:true,affectOutside:true}};
const clip=(actions:AnimationAction[],duration=1,type='animate'):AnimationTrack=>({id:crypto.randomUUID(),target:'camera.actions',type:type as AnimationTrack['type'],from:0,to:0,start:0,duration,easing:'linear',pingPong:false,enabled:true,actions});
function harness(tracks:AnimationTrack[],backend:'cpu'|'gpu'='cpu'){
 let parameters:SourcePerlinParameterRuntime,colors:SourcePerlinColorRuntime,creates=0;
 const events:string[]=[],updates:{time:number;dt:number}[]=[];
 const session=new OrdinarySourceCameraTimelineSession(camera,tracks,4,{particleActions:'perlin',createParticles:()=>{
  creates++;parameters=new SourcePerlinParameterRuntime({initial,backend,style:'particles'});colors=new SourcePerlinColorRuntime();
  return{
   bind:()=>{throw Error('unexpected particle tracking');},
   beginPerlinParameterActions:(actions:readonly SourcePerlinParameterAction[])=>{events.push('parameters:start');parameters.begin(actions);},
   beginGradientActions:(actions:Parameters<SourcePerlinColorRuntime['beginGradientActions']>[0])=>{events.push('gradient:start');colors.beginGradientActions(actions);},
   interpolatePerlinParameterActions:(eased:number,finished:boolean,dt:number)=>{events.push(`parameters:update:${eased}:${finished}`);parameters.interpolate(eased,finished,dt);},
   interpolateGradientActions:(eased:number,finished:boolean)=>{events.push(`gradient:update:${eased}:${finished}`);colors.interpolateGradientActions(eased,finished);},
   update:(frame:{time:number;deltaTime:number})=>{events.push('object');updates.push({time:frame.time,dt:frame.deltaTime});colors.update(frame.deltaTime);parameters.update(frame.deltaTime);},
   displayFrame:()=>{events.push('display');colors.paletteTexture();},
  };
 }});
 return{session,events,updates,get creates(){return creates;},get parameters(){return parameters!;},get colors(){return colors!;}};
}
describe('Perlin specialized parameter children in the shared frame queue',()=>{
 it('starts all parameter children before gradients, then updates params before gradient and object',()=>{
  const h=harness([clip([gradient,start()])]);h.session.evaluate(0);
  expect(h.events).toEqual(['parameters:start','gradient:start','parameters:update:0.25:false','gradient:update:0.25:false','object','display']);
  expect(h.colors.snapshot().gradient.progress).toBe(.015625);
 });
 it('advances finish-time drift in the same frame on CPU, freezes all objects after queue completion',()=>{
  const h=harness([clip([start()],.25)]),gpu=harness([clip([start()],.25)],'gpu');h.session.evaluate(0);gpu.session.evaluate(0);
  const cpu=h.parameters.snapshot(),g=gpu.parameters.snapshot();
  expect(cpu.drifts[1].phase).toBeGreaterThan(g.drifts[1].phase);expect(cpu.drifts[1].running).toBe(true);
  const before=h.parameters.snapshot();h.session.evaluate(3);expect(h.parameters.snapshot()).toEqual(before);expect(h.updates).toHaveLength(1);
 });
 it.each([0,-1])('uses specialized terminal easing for duration %s, while gradient keeps generic easing',duration=>{
  const h=harness([clip([start(),gradient],duration),clip([],1,'wait')]);h.session.evaluate(0);
  expect(h.events).toContain('parameters:update:1:true');expect(h.updates[0].dt).toBe(.25);
  expect(h.parameters.snapshot().children[0].finished).toBe(true);expect(h.parameters.snapshot().values.noise_scale).not.toBe(initial.noise_scale);
 });
 it('empty zero-duration final queue does not advance time but finishes parameter child',()=>{
  const h=harness([clip([start()],0)]);h.session.evaluate(0);
  expect(h.updates).toEqual([{time:0,dt:0}]);expect(h.parameters.snapshot().drifts[1].running).toBe(true);expect(h.parameters.snapshot().values.noise_scale).toBe(12);
 });
 it('preserves ordered multiple parameter children and immediate stop across waits',()=>{
  const h=harness([clip([start(),action('paramStop',{})],.25),clip([],1,'wait')]);h.session.evaluate(.25);
  expect(h.parameters.snapshot().drifts.every(d=>!d.running)).toBe(true);
  const restart=harness([clip([action('paramStop',{}),start()],.25),clip([],1,'wait')]);restart.session.evaluate(.25);
  expect(restart.parameters.snapshot().drifts[1].running).toBe(true);
  expect(restart.parameters.snapshot().values.noise_scale).not.toBe(h.parameters.snapshot().values.noise_scale);
 });
 it('recreates parameter and color owners together on reverse seek',()=>{
  const tracks=[clip([start(),gradient]),clip([],1,'wait')],h=harness(tracks);h.session.evaluate(1.5);h.session.evaluate(.25);
  const fresh=harness(tracks);fresh.session.evaluate(.25);
  expect(h.creates).toBe(2);expect(h.parameters.snapshot()).toEqual(fresh.parameters.snapshot());expect(h.colors.snapshot()).toEqual(fresh.colors.snapshot());
 });
 it('rejects method mismatch, mixed representations and unsupported targets',()=>{
  const a=start();
  for(const invalid of [{...a,method:'paramStop'},{...a,parameters:[]},{...a,method:'zoom'}])expect(()=>harness([clip([invalid])]).session.evaluate(0)).toThrow(/Perlin/);
 });
});
