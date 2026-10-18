import {describe,expect,it} from 'vitest';
import {parseProjectFile} from '../src/engine/legacyImport';
import {parseScene,serializeScene} from '../src/engine/document';
import {generateScene} from '../src/engine/temporal';
import {sceneAtTime} from '../src/engine/timeline';
import {ordinarySourceViewport} from '../src/engine/ordinarySourceCamera';
import type {SceneDocument} from '../src/types';

const F=Math.fround;
const range={min:-10,max:10,step:1};
const start=(parameters:Record<string,unknown>)=>({method:'paramStart',args:{edgeEasing:{floor:1},parameters}});
const group=(actions:unknown[],duration=.5)=>({type:'animate',duration,easing:'LINEAR',actions});
const wait={type:'wait',duration:.5};
function imported(timeline:unknown[],parameters:Record<string,number>={a:0,b:0},extra:Record<string,unknown>={}){
 const raw={config_version:'1.0.0',type:'SURFACE',name:'Parameter geometry',parameters,
  equations:{x:'a+u',y:'b+v',z:'a-b'},palette:['#FF0000','#00FF00'],
  settings:{u_segments:2,v_segments:1,u_min:0,u_max:4,v_min:0,v_max:1,speed_u:0,speed_v:0,periodic_u:false,periodic_v:false,
   scale_x:1,scale_y:1,scale_z:1,offset_x:0,offset_y:0,offset_z:0,show_trails:true,fade_trails:false,trail_lifetime:10},
  timeline,...extra};
 const scene=parseProjectFile(JSON.stringify(raw)).scene;scene.timeline.fps=4;return parseScene(serializeScene(scene));
}
function output(scene:SceneDocument,time:number,quality:'preview'|'export'='preview',isCancelled?:()=>boolean){
 const out=generateScene(scene,{time,width:96,height:64,quality,isCancelled,sourceViewport:ordinarySourceViewport(scene,96,64,quality==='preview'?'primary':'offscreen',64)});
 if(out.type!=='geometry')throw Error('source geometry required');return out;
}
const head=(scene:SceneDocument,time:number)=>Array.from(output(scene,time).positions.slice(0,3));

describe('source Surface parameters through public import and geometry',()=>{
 it('writes known constants before particle calculations, leaves unknown bindings inert, and preserves authored values',()=>{
  const scene=imported([group([start({a:{min:7,max:7,step:0},missing:{min:99,max:99,step:0}})]),wait],{a:2,b:3}),saved=serializeScene(scene);
  const out=output(scene,0);
  expect(Array.from(out.positions)).toEqual([7,3,4,9,3,4]);
  expect(out.warnings?.some(w=>w.includes('1 个未声明参数'))).toBe(true);
  expect(scene.parameters).toEqual({a:2,b:3});expect(serializeScene(scene)).toBe(saved);
 });
 it('advances grouped actions on their final frame but stops standalone parameters before that frame update',()=>{
  const grouped=imported([group([start({a:range})]),wait]);
  // Native double phase: first gain .5, then gain1; dt*frameRate =1.
  expect(head(grouped,0)[0]).toBe(F(10*Math.sin(.05)));
  expect(head(grouped,.25)[0]).toBe(F(10*Math.sin(.05+.1)));
  const standalone=imported([{type:'param',duration:.5,easing:'BOUNCE_OUT',parameters:{a:range}},wait]);
  // Standalone gain stays1, edge distance >.4 so default edge scale is1.
  const once=F(10*Math.sin(.1));
  for(const time of [0,.25,.5,2])expect(head(standalone,time)[0]).toBe(once);
  const oneFrame=imported([{type:'param',duration:.25,parameters:{a:7}},wait],{a:2,b:0});
  expect(head(oneFrame,0)[0]).toBe(2);expect(head(oneFrame,.5)[0]).toBe(2);
 });
 it('captures mutated parameter values when later grouped actions start',()=>{
  const scene=imported([{type:'param',duration:.5,parameters:{a:3}},group([start({a:{min:0,max:10,step:1}})]),wait]);
  expect(head(scene,.25)[0]).toBe(3);
  const expected=F(5+5*Math.sin(Math.asin(-.4)+.1));
  expect(head(scene,.5)[0]).toBe(expected);
 });
 it('passes authored nominal FPS to the source animator, including its <=1 fallback',()=>{
  const scene=imported([group([start({a:range})],2)]);scene.timeline.fps=1;
  // One active second, half-speed startup, fallback rate60: delta =3.
  expect(head(scene,0)[0]).toBe(F(10*Math.sin(3)));
  scene.timeline.fps=4;
  // One quarter-second, startup1/8, nominal rate4: delta =.0125.
  expect(head(scene,0)[0]).toBe(F(10*Math.sin(.0125)));
 });
 it('a named stop freezes only its parameter while an empty standalone replaces the entire active registry',()=>{
  const scene=imported([group([start({a:range,b:range})]),group([{method:'paramStop',args:{parameters:{a:{}}}}]),wait]);
  const stopped=output(scene,.75),later=output(scene,1);
  expect(stopped.positions[0]).toBe(F(10*Math.sin(.2)));
  expect(later.positions[0]).toBe(stopped.positions[0]);expect(later.positions[1]).toBeGreaterThan(stopped.positions[1]);
  const replaced=imported([group([start({a:range,b:range})]),{type:'param',duration:.5},wait]);
  for(const time of [.5,.75,1,5])expect(head(replaced,time)).toEqual(head(replaced,.25));
 });
 it('starts all ordered children before updates, preserving idle stop/start versus start/stop differences',()=>{
  const stop={method:'paramStop',args:{}};
  const startsThenStops=imported([group([start({a:range}),stop]),wait]);
  for(const time of [0,.25,.5])expect(head(startsThenStops,time)[0]).toBe(0);
  const stopsThenStarts=imported([group([stop,start({a:range})]),wait]);
  expect(head(stopsThenStarts,0)[0]).toBe(F(10*Math.sin(.05)));
  expect(head(stopsThenStarts,.25)[0]).toBe(F(10*Math.sin(.05+.1)));
 });
 it('standalone animation ignores custom edge defaults and captures declared u/v shadow slots',()=>{
  const timeline=[{type:'param',duration:.5,parameters:{a:range,u:7,v:9}},wait];
  const base=imported(timeline,{a:9,b:0,u:1,v:2},{equations:{x:'u',y:'v',z:'a'}});
  const settings={...((base.provenance!.original as {settings:object}).settings),param_edge_easing:{window:1,floor:0,easing:'LINEAR'}};
  const custom=imported(timeline,{a:9,b:0,u:1,v:2},{equations:{x:'u',y:'v',z:'a'},settings});
  expect(output(custom,0).positions).toEqual(output(base,0).positions);
  expect(Array.from(output(custom,0).positions.slice(0,2))).toEqual([7,9]);
  expect(custom.parameters.u).toBe(1);expect(custom.parameters.v).toBe(2);
 });
 it('feeds tracking, trail histories, sceneAtTime and export from the same isolated parameter replay',()=>{
  const scene=imported([group([start({a:range}),{method:'track',args:[0]}]),wait]),saved=serializeScene(scene);
  for(const time of [.25,.75,0,.25]){
   const out=output(scene,time),evaluated=sceneAtTime(scene,time),throughTimeline=output(evaluated,time,'export');
   expect(throughTimeline.positions).toEqual(out.positions);expect(throughTimeline.trails).toEqual(out.trails);
   expect(evaluated.parameters).toEqual(scene.parameters);
   expect(evaluated.evaluatedSourceCamera?.camera.center).toEqual(out.sourceCameraFrame?.camera.center);
   if(time>=.25)expect(out.sourceCameraFrame?.camera.center).toEqual(Array.from(out.positions.slice(0,3)));
   expect(out.trails!.positions[0]).toBe(F(10*Math.sin(.05)));
  }
  expect(serializeScene(scene)).toBe(saved);
 });
 it('keeps terminal zero-dt recording actions and all later frames from advancing parameters or trails',()=>{
  const scene=imported([group([start({a:range})]),{type:'trails',enable:false}]);
  const last=output(scene,.25);
  for(const time of [.5,2]){const out=output(scene,time);expect(out.positions).toEqual(last.positions);expect(out.trails).toEqual(last.trails);}
 });
 it('rejects malformed persisted parameter contracts before publishing geometry',()=>{
  const scene=imported([group([start({a:range})])]);
  const action=scene.timeline.tracks[0].actions![0];
  action.surfaceParameters![0].configuration!.step=Infinity;
  expect(()=>output(scene,0)).toThrow(/有限|nonfinite/);
  expect(()=>parseScene(serializeScene(scene))).toThrow();
 });
 it('counts nested source registry operations against the public aggregate timeline capacity',()=>{
  const parameters=Object.fromEntries(Array.from({length:4096},(_,i)=>[`p${i}`,{min:0,max:0,step:0}]));
  // The track/action themselves also consume existing timeline capacity.
  expect(()=>imported([group([start(parameters)])])).toThrow('4096');
  expect(()=>imported([{type:'param',duration:.5,parameters}])).toThrow('4096');
 });
 it('rejects mixed saved parameter models even when the affected source clip is disabled',()=>{
  const actionScene=imported([group([start({a:range})])]);
  actionScene.timeline.tracks[0].enabled=false;
  actionScene.timeline.tracks[0].actions![0].parameters=[];
  expect(()=>parseScene(JSON.stringify(actionScene))).toThrow('混用');
  const clipScene=imported([{type:'param',duration:.5,parameters:{a:range}}]);
  clipScene.timeline.tracks[0].enabled=false;clipScene.timeline.tracks[0].parameterAnimations=[];
  expect(()=>parseScene(JSON.stringify(clipScene))).toThrow('混用');
 });
 it('fails boundedly for non-progressing huge phase reduction and admits a fresh replay after cancellation',()=>{
  const scene=imported([group([start({a:{...range,step:1e30}})]),wait]),saved=serializeScene(scene);
  expect(()=>output(scene,.25)).toThrow('无法推进');
  expect(serializeScene(scene)).toBe(saved);
  const ordinary=imported([group([start({a:range})]),wait]);
  expect(()=>output(ordinary,.5,'preview',()=>true)).toThrow('取消');
  expect(head(ordinary,0)[0]).toBe(F(10*Math.sin(.05)));
 });
});
