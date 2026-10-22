import {describe,it,expect} from 'vitest';
import fixture from './fixtures/source-viewport/navigation-source.json';
import {navigateSourceViewportCamera} from '../src/engine/sourceViewportNavigation';
import {SourceSceneHostClock} from '../src/engine/sourceSceneHostClock';
import {OrdinarySourceCameraTimelineSession} from '../src/engine/ordinarySourceCameraTimeline';
import type {SourceCameraScalars} from '../src/engine/sourceCamera';
import type {AnimationTrack} from '../src/types';
const bits=(n:number)=>{const v=new DataView(new ArrayBuffer(4));v.setFloat32(0,n);return v.getUint32(0);};
const number=(n:number)=>{const v=new DataView(new ArrayBuffer(4));v.setUint32(0,n);return v.getFloat32(0);};
const camera=(a:number[]):SourceCameraScalars=>{const [phi,theta,gamma,zoom,x,y,z]=a.map(number);return{phi,theta,gamma,zoom,center:[x,y,z],focalDistance:20};};
const encoded=(c:SourceCameraScalars)=>[c.phi,c.theta,c.gamma,c.zoom,...c.center].map(bits);
const initial=camera(fixture.cases[0].initial.floatBits);
function nav(c:SourceCameraScalars,mode:'rotate'|'map-2d',event:unknown,w=640,h=480){const r=navigateSourceViewportCamera(c,mode,event,w,h);if(!r.ok)throw r.error;return r.value;}
describe('source iterated viewport original JVM fixtures',()=>{
 for(const row of fixture.cases.filter(row=>row.navigated))it(row.id,()=>{
  const c=camera(row.initial.floatBits),host=new SourceSceneHostClock(false,c);host.setPaused(true,c);
  const input=row.input,start=input.start!,end=input.end!;
  let next=nav(c,row.id==='map2-resume'?'map-2d':'rotate',{kind:'drag',dx:end[0]-start[0],dy:end[1]-start[1]},input.width,input.height);
  next=nav(next,'rotate',{kind:'wheel',count:input.wheelCount});expect(encoded(next)).toEqual(row.navigated!.floatBits);
  expect(encoded({...next,...host.setPaused(false,next,1000)})).toEqual(row.resumed!.floatBits);
 });
 for(const row of fixture.cases.filter(row=>row.id.startsWith('wheel-')))it(row.id,()=>{
  expect(encoded(nav(camera(row.initial.floatBits),'rotate',{kind:'wheel',count:row.input.count}))).toEqual(row.result!.floatBits);
 });
 it('matches native zero width/height/zoom safeguards',()=>{
  const row=fixture.cases.find(row=>row.id==='map2-degenerate')!;
  expect(encoded(nav(camera(row.initial.floatBits),'map-2d',{kind:'drag',dx:37,dy:-33},0,0))).toEqual(row.result!.floatBits);
 });
 it('rejects malformed input before returning a changed view',()=>{
  for(const event of [null,[],{}, {kind:'pan'}, {kind:'drag',dx:NaN,dy:1}, {kind:'drag',dx:1e300,dy:0}, {kind:'wheel',count:1,extra:1}])expect(navigateSourceViewportCamera(initial,'rotate',event,1,1).ok).toBe(false);
 });
 it('keeps active zoom captured starts while future zoom captures the live value',()=>{
  const zoom=(value:number):AnimationTrack=>({id:String(value),type:'animate',target:'camera.actions',from:0,to:0,start:0,duration:1,easing:'linear',pingPong:false,enabled:true,actions:[{id:'zoom',method:'zoom',args:{value}}]});
  const origin={...initial,zoom:1},active=new OrdinarySourceCameraTimelineSession(origin,[zoom(5),zoom(9)],4,{});
  expect(active.step(.25).camera.zoom).toBe(2);active.writeViewport({...origin,zoom:10});
  expect(active.step(0,{paused:true}).camera.zoom).toBe(10);
  expect(active.step(.25).camera.zoom).toBe(3); // Existing child start=1, not 10.
  active.step(.5);active.writeViewport({...origin,zoom:7});
  expect(active.step(.25).camera.zoom).toBe(7.5); // Next child captures 7.
  const idle=new OrdinarySourceCameraTimelineSession(origin,[],4,{});idle.snapshot();idle.writeViewport({...origin,zoom:7,center:[4,5,6]});
  expect(idle.step(.25).camera).toMatchObject({zoom:7,center:[4,5,6]});
 });
});
