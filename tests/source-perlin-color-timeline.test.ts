import {describe,it,expect} from 'vitest';
import type {AnimationAction,AnimationTrack} from '../src/types';
import {OrdinarySourceCameraTimelineSession,resolveOrdinarySourceCameraTimeline,type OrdinarySourceCameraParticles} from '../src/engine/ordinarySourceCameraTimeline';
import {SourcePerlinColorRuntime} from '../src/engine/sourcePerlinColorRuntime';
import {importSourcePerlinGradientGroup} from '../src/engine/sourcePerlinGradientImport';
import type {SourceCameraScalars} from '../src/engine/sourceCamera';

const initial:SourceCameraScalars={phi:Math.PI/2,theta:0,gamma:0,zoom:1,center:[0,0,0],focalDistance:20};
const palette=[0x60ff0000,0xa000ff00,0xe00000ff];
const start=(speed=90):AnimationAction=>({id:crypto.randomUUID(),method:'gradientStart',gradient:{model:'offsets',mode:'hue_rotate',interpolation:'linear',speed,affectInside:true,affectOutside:true}});
const stop=():AnimationAction=>({id:crypto.randomUUID(),method:'gradientStop'});
const clip=(actions:AnimationAction[],extra:Partial<AnimationTrack>={}):AnimationTrack=>({id:crypto.randomUUID(),type:'animate',target:'camera.actions',from:0,to:0,start:0,duration:1,easing:'linear',pingPong:false,enabled:true,actions,...extra});
function harness(tracks:AnimationTrack[],family:'perlin'|'surface'='perlin',fail?:()=>boolean){
 let colors:SourcePerlinColorRuntime|undefined,texture:Uint32Array|undefined,creates=0;
 const events:string[]=[],steps:{index:number;time:number;dt:number}[]=[];
 const session=new OrdinarySourceCameraTimelineSession(initial,tracks,4,{particleActions:family,createParticles:():OrdinarySourceCameraParticles=>{
  creates++;colors=new SourcePerlinColorRuntime({palette});texture=undefined;
  return{
   bind:()=>{throw Error('Perlin must not bind a local particle');},
   beginGradientActions:actions=>{events.push('begin:'+actions.map(a=>a.kind).join(','));colors!.beginGradientActions(actions);},
   interpolateGradientActions:(eased,finish)=>{events.push(`interpolate:${eased}:${finish}`);colors!.interpolateGradientActions(eased,finish);},
   setRecordingTrails:enabled=>events.push('record:'+enabled),
   setShowTrails:enabled=>events.push('show:'+enabled),
   update:frame=>{if(fail?.())throw Error('consumer failure');events.push('update:'+frame.frameIndex);steps.push({index:frame.frameIndex,time:frame.time,dt:frame.deltaTime});colors!.update(frame.deltaTime);},
   displayFrame:index=>{events.push('draw:'+index);texture=colors!.paletteTexture();},
  };
 }});
 return{session,events,steps,get creates(){return creates;},get colors(){return colors!;},get texture(){return texture!;}};
}

describe('source Perlin gradient dispatch through the shared scene queue',()=>{
 it('replays the selected raw gradient without allowing skipped later actions to erase it',()=>{
  const imported=importSourcePerlinGradientGroup([
   {method:'gradientStop',args:{}},
   {method:'gradientStart',args:[{mode:'HUE_ROTATE',speed:90,interpolation:'LINEAR'}]},
   {method:'gradientStart',args:{mode:'UNKNOWN'}},
   {method:'gradientStop'},
  ]);
  expect(imported.selectedIndex).toBe(1);
  const selected=imported.action!;
  const action:AnimationAction=selected.kind==='start'?{id:'imported',method:'gradientStart',gradient:selected.config}:{id:'imported',method:'gradientStop'};
  const replay=harness([clip([action])]);replay.session.evaluate(.75);
  const direct=harness([clip([start()])]);direct.session.evaluate(.75);
  expect(replay.colors.snapshot()).toEqual(direct.colors.snapshot());expect(replay.texture).toEqual(direct.texture);
 });
 it('applies the last successfully constructed gradient child, unlike Surface groups',()=>{
  const perlin=harness([clip([start(),stop()])]);perlin.session.evaluate(.75);
  expect(perlin.events[0]).toBe('begin:stop');expect(perlin.colors.snapshot().gradient.running).toBe(false);expect(perlin.colors.snapshot().revision).toBe(0);
  const reversed=harness([clip([stop(),start()])]);reversed.session.evaluate(.75);
  expect(reversed.events[0]).toBe('begin:start');expect(reversed.colors.snapshot().gradient.progress).toBe(.15625);
  const surface=harness([clip([start(),stop()])],'surface');surface.session.evaluate(0);
  expect(surface.events[0]).toBe('begin:start,stop');
 });
 it('interpolates then advances once at time zero; stops object updates after queue completion',()=>{
  const h=harness([clip([start()])]);
  // Four 1/4-second updates, linear start scales 1/4, 1/2, 3/4, 1.
  // GradientRuntimeState.advance: progress += 90 * scale * dt / 360.
  const expected=[.015625,.046875,.09375,.15625];
  for(let i=0;i<4;i++){h.session.evaluate(i/4);expect(h.colors.snapshot().gradient.progress).toBe(expected[i]);}
  expect(h.events.slice(0,4)).toEqual(['begin:start','interpolate:0.25:false','update:0','draw:0']);
  const snapshot=h.colors.snapshot(),texture=h.texture;
  h.session.evaluate(2);expect(h.steps).toHaveLength(4);
  expect(h.colors.snapshot()).toEqual(snapshot);expect(h.texture).toEqual(texture);expect(h.creates).toBe(1);
 });
 it('keeps the final partial activeDt and stops before the object update',()=>{
  const h=harness([clip([start()],{duration:.25}),clip([stop()],{duration:.125})]);
  h.session.evaluate(.25);
  expect(h.steps).toEqual([{index:0,time:.25,dt:.25},{index:1,time:.375,dt:.125}]);
  expect(h.colors.snapshot().gradient.running).toBe(false);expect(h.colors.snapshot().gradient.progress).toBe(.0625);
  expect(h.colors.snapshot().refreshed?.running).toBe(true);
 });
 it('uses full remaining-queue time for zero duration, repairing NaN easing before update',()=>{
  const only=harness([clip([start()],{duration:0})]);only.session.evaluate(0);
  expect(only.steps).toEqual([{index:0,time:0,dt:0}]);expect(only.colors.snapshot().gradient.speedScale).toBe(1);expect(only.colors.snapshot().gradient.progress).toBe(0);
  const trailingWait=harness([clip([start()],{duration:0}),clip([],{type:'wait',duration:1})]);trailingWait.session.evaluate(0);
  expect(trailingWait.steps[0].dt).toBe(.25);expect(trailingWait.colors.snapshot().gradient.progress).toBe(.0625);
 });
 it('does not bind geometry for supported camera actions or let duplicate gradients discard camera motion',()=>{
  const h=harness([clip([start(180),{id:'z',method:'zoom',args:{value:2}},{...start(90),enabled:false}])]);
  const frame=h.session.evaluate(.75);
  expect(frame.camera.zoom).toBe(2);expect(h.colors.snapshot().gradient.progress).toBe(.15625);expect(frame.diagnostics.some(d=>d.code==='action-enabled')).toBe(true);
  expect(resolveOrdinarySourceCameraTimeline(initial,[clip([start(),stop()])],4,{particleActions:'perlin'}).span).toBe(1);
 });
 it('recreates owned color state on reverse seek and consumer failure',()=>{
  let reject=false;const tracks=[clip([start()]),clip([stop()])],h=harness(tracks,'perlin',()=>reject);
  h.session.evaluate(1);h.session.evaluate(0);expect(h.creates).toBe(2);
  const cold=harness(tracks);cold.session.evaluate(0);expect(h.texture).toEqual(cold.texture);expect(h.colors.snapshot()).toEqual(cold.colors.snapshot());
  reject=true;expect(()=>h.session.evaluate(.25)).toThrow('consumer failure');reject=false;
  h.session.evaluate(.25);const fresh=harness(tracks);fresh.session.evaluate(.25);
  expect(h.creates).toBe(3);expect(h.texture).toEqual(fresh.texture);
 });
 it.each(['track','rotateGamma','rotate','paramStart','paramStop'])('rejects unsupported canonical %s instead of executing a local substitute',method=>{
  const h=harness([clip([{id:'unsupported',method,args:{}}])]);expect(()=>h.session.evaluate(0)).toThrow(/Perlin/);expect(h.creates).toBe(0);
 });
 it('dispatches Perlin visibility separately from Surface recording, before the object update',()=>{
  const tracks=[clip([],{type:'trails',duration:0,trailsEnabled:false}),clip([start()])];
  const perlin=harness(tracks);perlin.session.evaluate(0);expect(perlin.events.slice(0,3)).toEqual(['show:false','update:0','draw:0']);
  const surface=harness(tracks,'surface');surface.session.evaluate(0);expect(surface.events.slice(0,3)).toEqual(['record:false','update:0','draw:0']);
 });
 it('preserves disabled clip semantics and validates overwritten canonical configuration',()=>{
  const disabled=harness([clip([start()],{enabled:false})]);disabled.session.evaluate(0);expect(disabled.steps).toHaveLength(0);expect(disabled.colors.snapshot().gradient.running).toBe(false);
  const invalid=start();invalid.gradient!.speed=NaN;
  expect(()=>harness([clip([invalid,stop()])]).session.evaluate(0)).toThrow('有限');
 });
});
