import {describe,it,expect} from 'vitest';
import {createScene,parseScene,persistentScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {generateScene,TemporalGenerationSession} from '../src/engine/temporal';
import {prepareParticleCamera,sceneAtTime,timelineWarnings} from '../src/engine/timeline';
import {supportsParticleTracking,outputCamera} from '../src/engine/sceneCamera';
import {attractorParticleId,ParticleCameraCache,MAX_CAMERA_SAMPLES} from '../src/engine/particleCamera';
import {parseLegacyScene} from '../src/engine/legacyImport';
import {simulationTime} from '../src/engine/simulationClock';
import {historyTimes} from '../src/engine/temporal';
import type {AnimationTrack,SceneDocument} from '../src/types';
const action=(method:string,args:Record<string,number|boolean>={},start=0,duration=0,easing='linear'):AnimationTrack=>({id:crypto.randomUUID(),type:'animate',target:'camera.actions',from:0,to:0,start,duration,easing,pingPong:false,enabled:true,actions:[{id:crypto.randomUUID(),method,args}]});
const make=()=>{const s=createScene(definition('attractor'));s.parameters={speed:1};s.equations={dx:'speed',dy:'0',dz:'0'};Object.assign(s.settings,{simulationMode:'continuous',attractorBackend:'cpu',particleCount:3,burnIn:0,staggerMin:0,staggerMax:0,showTrails:false,subSteps:1,dt:.125,simulationFps:8,variableTimeStep:false,initialSpread:0,initialX:0,initialY:0,initialZ:0,integrator:'euler',scale:1});s.timeline.duration=10;s.timeline.tracks=[action('track',{index:1})];return s;};
const render=(s:SceneDocument,time:number,session?:TemporalGenerationSession)=>generateScene(s,{time,width:32,height:24,quality:'export'},session);
const close=(actual:number[],expected:number[])=>actual.forEach((v,i)=>expect(v).toBeCloseTo(expected[i],7));
describe('producer-owned continuous Attractor indexed camera',()=>{
 it('collects requests without integrating or changing the authored scene, and resolves the actual stable id',()=>{
  const s=make(),before=JSON.stringify(s),plan=prepareParticleCamera(s,1.25)!;expect(plan.requests).toEqual([{index:1,time:0},{index:1,time:1.25}]);expect(sceneAtTime(s,1.25).camera).toEqual(s.camera);
  const out=render(s,1.25);if(out.type!=='geometry')throw Error('geometry');const slot=Array.from(out.particleIds!).indexOf(1);expect(out.cameraFrame?.camera.target).toEqual(Array.from(out.positions.slice(slot*3,slot*3+3)));close(out.cameraFrame!.camera.target,[1.25,0,0]);expect(out.stats.samples).toBe(30);expect(out.cameraFrame!.camera.autoFit).toBe(false);expect(JSON.stringify(s)).toBe(before);
 });
 it('keeps cold, warm, fractional, backward and restored seeks identical, with owned cache reset',()=>{
  const s=make(),owner=new TemporalGenerationSession(),restored=parseScene(JSON.stringify(s));s.timeline.tracks[0].duration=.5;s.timeline.tracks[0].easing='there-and-back';restored.timeline=structuredClone(s.timeline);
  for(const time of [0,.25,.5,1.31,2.5,.125,2]){const warm=render(s,time,owner),cold=render(restored,time);expect(warm.cameraFrame).toEqual(cold.cameraFrame);if(warm.type==='geometry'&&cold.type==='geometry')expect(warm.positions).toEqual(cold.positions);}
  close(render(s,2).cameraFrame!.camera.target,[2,0,0]);expect(owner.diagnostics().tracking.entries).toBeGreaterThan(0);owner.reset();expect(owner.diagnostics().retainedBytes).toBe(0);expect(persistentScene(s)).toEqual(s);
 });
 it('freezes an exact fractional historical sample, then restarts from that resolved baseline',()=>{
  const s=make();s.timeline.tracks.push(action('stopTracking',{},.31),action('track',{index:2},1,.5));
  close(render(s,.9).cameraFrame!.camera.target,[Math.fround(.31),0,0]);close(render(s,1.25).cameraFrame!.camera.target,[(Math.fround(.31)+1.25)/2,0,0]);close(render(s,2).cameraFrame!.camera.target,[2,0,0]);
  const owner=new TemporalGenerationSession();for(const t of [2,.8,1.25,3])expect(render(s,t,owner).cameraFrame).toEqual(render(s,t).cameraFrame);owner.reset();
 });
 it('uses animated dynamics and transforms from the same producer clock without counting a second trajectory',()=>{
  const s=make();s.timeline.tracks.push({id:'speed',type:'numeric',target:'parameters.speed',start:0,duration:1,from:1,to:3,easing:'linear',enabled:true,pingPong:false});s.settings.scaleX=2;s.settings.offsetX=3;
  const out=render(s,1);close(out.cameraFrame!.camera.target,[6.75,0,0]);expect(out.stats.samples).toBe(24);
 });
 it('lets later numeric targets win with a historical tracked fromCurrent baseline, and combines orbit optics',()=>{
  const s=make();s.timeline.tracks.push(action('rotateTheta',{angle:.7},.5,1),action('zoom',{value:2},.5,1));
  const out=render(s,2);close(out.cameraFrame!.camera.target,[2,0,0]);expect(out.cameraFrame!.camera.zoom).toBe(2);expect(Math.hypot(...out.cameraFrame!.camera.position.map((v,i)=>v-out.cameraFrame!.camera.target[i]))).toBeCloseTo(Math.hypot(...s.camera.position),8);
  s.timeline.tracks.push({id:'target',type:'numeric',target:'camera.targetX',start:.75,duration:1,from:0,fromCurrent:true,to:10,easing:'linear',enabled:true,pingPong:false});expect(render(s,1.25).cameraFrame!.camera.target[0]).toBeCloseTo(5.375,7);
  s.timeline.tracks.push(action('track',{x:2,y:3,z:4},2,1));close(render(s,4).cameraFrame!.camera.target,[2,3,4]);
 });
 it('keeps unavailable/out-of-range actions as no-ops, without selecting a surviving neighbor',()=>{
  const s=make();s.timeline.tracks.push(action('track',{index:999},.5));const out=render(s,2);close(out.cameraFrame!.camera.target,[2,0,0]);expect(out.warnings?.join()).toContain('越界');
  s.equations.dx='sqrt(-1)';s.timeline.tracks=[{id:'base',type:'numeric',target:'camera.targetX',start:0,duration:.1,from:5,to:5,easing:'linear',enabled:true,pingPong:false},action('track',{index:1},.2)];const dead=render(s,1);expect(dead.stats.generated).toBe(0);expect(dead.cameraFrame!.camera.target[0]).toBe(5);expect(dead.warnings?.join()).toContain('死亡或位置无效');
 });
 it('does not confuse stable ids with compacted geometry or hide a later usable index',()=>{
  const s=make();Object.assign(s.settings,{initialSpread:1,seed:7});s.equations.dx='x < 0 ? sqrt(-1) : 1';
  const zero=render({...s,timeline:{...s.timeline,tracks:[]}},0);if(zero.type!=='geometry')throw Error('geometry');const live=Array.from(zero.positions).findIndex((v,i)=>i%3===0&&v>=0)/3;
  s.timeline.tracks=[action('track',{index:live})];const out=render(s,1);if(out.type!=='geometry')throw Error('geometry');expect(out.particleIds).toContain(live);const slot=Array.from(out.particleIds!).indexOf(live);expect(out.cameraFrame!.camera.target).toEqual(Array.from(out.positions.slice(slot*3,slot*3+3)));
 });
 it('retains source float-to-int lookup and preserves the existing Surface clamp separately',()=>{
  expect(attractorParticleId(1.9,3)).toBe(1);expect(attractorParticleId(-.4,3)).toBe(0);expect(attractorParticleId(.999999999,3)).toBe(1);for(const index of [-1,3,1e30])expect(attractorParticleId(index,3)).toBeUndefined();
  const r=parseLegacyScene(JSON.stringify({config_version:'1.0.0',type:'ATTRACTOR',name:'Track',equations:{dx:'1',dy:'0',dz:'0'},settings:{render_mode:'CPU',particle_count_cpu:3,burn_in:0},timeline:[{type:'animate',duration:0,actions:[{method:'track',args:[1.9]}]},{type:'wait',duration:2}]}));expect(r.scene.timeline.tracks[0].actions![0].args).toEqual({index:1.9});expect(r.warnings.join()).not.toContain('动态粒子采样合同');
 });
 it('keeps density/static unsupported, returns camera paired with the output, and clears cancellation ownership',()=>{
  const s=make();expect(supportsParticleTracking(s)).toBe(true);const out=render(s,1);expect(outputCamera(sceneAtTime(s,3),out)).toBe(out.cameraFrame);
  s.settings.presentation='density';expect(supportsParticleTracking(s)).toBe(false);expect(prepareParticleCamera(s,1)).toBeUndefined();expect(timelineWarnings(s).join()).toContain('未执行');
  s.settings.presentation='points';s.settings.simulationMode='static';expect(supportsParticleTracking(s)).toBe(false);
  const owner=new TemporalGenerationSession(),source=make();render(source,1,owner);expect(()=>generateScene(source,{time:2,width:32,height:24,quality:'export',isCancelled:()=>true},owner)).toThrow('已取消');expect(owner.diagnostics().retainedBytes).toBe(0);
 });
 it('honors timeline time clamps, inactive stops and disabled tracking without leaking live state',()=>{
  const s=make();s.timeline.duration=1;s.timeline.tracks=[action('stopTracking',{},0),action('track',{index:1},.25,.25)];
  const out=render(s,2);close(out.cameraFrame!.camera.target,[1,0,0]);expect(out.cameraFrame!.time).toBe(2);expect(out.temporal!.time).toBe(2);expect(prepareParticleCamera(s,2)!.requests.every(request=>request.time<=1)).toBe(true);
  s.timeline.tracks[1].enabled=false;expect(render(s,1).cameraFrame).toBeUndefined();s.timeline.tracks[1].enabled=true;close(render(s,.2).cameraFrame?.camera.target??s.camera.target,s.camera.target);
 });
 it('shares fixed-step identity for UI decimals while preserving exact requested display time and real fractions',()=>{
  const tick=1/30,decimal=.0333333333333333;
  expect(simulationTime(decimal,30)).toEqual({frame:1,fraction:0,gridTime:tick});
  expect(simulationTime(tick-1e-11,30).frame).toBe(0);expect(simulationTime(tick-1e-11,30).fraction).toBeGreaterThan(0);
  expect(simulationTime(tick+1e-11,30).frame).toBe(1);expect(simulationTime(tick+1e-11,30).fraction).toBeGreaterThan(0);
  expect(historyTimes(decimal,5,30)).toEqual([0,decimal]);
  for(const showTrails of [false,true])for(const index of [1,999999]){
   const s=make(),owner=new TemporalGenerationSession();Object.assign(s.settings,{showTrails,simulationFps:30,dt:tick});s.timeline.tracks[0].actions![0].args={index};
   for(const time of [0,decimal,tick,tick-1e-11,tick+1e-11,.0666666666666667,decimal]){
    const out=render(s,time,owner),cold=render(s,time);expect(out.temporal!.time).toBe(time);expect(out.cameraFrame!.time).toBe(time);expect(out.cameraFrame).toEqual(cold.cameraFrame);
    if(out.type!=='geometry'||cold.type!=='geometry')throw Error('geometry');expect(out.positions).toEqual(cold.positions);if(index===1)expect(out.cameraFrame!.camera.target).toEqual(Array.from(out.positions.slice(3,6)));else expect(out.warnings!.join()).toContain('越界');
   }
   owner.reset();expect(owner.diagnostics().retainedBytes).toBe(0);
  }
 });
 it('bounds retained tracking facts independently of scene duration',()=>{
  const cache=new ParticleCameraCache();for(let i=0;i<MAX_CAMERA_SAMPLES+2;i++)cache.put({index:0,time:i},{status:'available',particleId:0,position:[i,0,0]});expect(cache.diagnostics().entries).toBe(MAX_CAMERA_SAMPLES);expect(cache.has({index:0,time:0})).toBe(false);expect(cache.diagnostics().estimatedRetainedBytes).toBe(4*1024*1024);cache.reset();expect(cache.diagnostics().entries).toBe(0);
 });
});
