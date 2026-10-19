import {prepareSourceSurfaceParticles} from '../src/engine/sourceSurfaceParticles';
import {SOURCE_PARTICLE_GRADIENT_DEFAULT} from '../src/engine/sourceParticleGradientConfig';
import {describe,expect,it} from 'vitest';
import {parseProjectFile} from '../src/engine/legacyImport';
import {parseScene,serializeScene} from '../src/engine/document';
import {sceneAtTime} from '../src/engine/timeline';
import {generateScene} from '../src/engine/temporal';
import {ordinarySourceViewport} from '../src/engine/ordinarySourceCamera';
import type {SceneDocument} from '../src/types';
import golden from './fixtures/source-surface-gradient/runtime.json';

const F=Math.fround;
function imported(mode:string,groups:string[][]){
 const result=parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'SURFACE',name:'Source gradient lifecycle',
  equations:{x:'u',y:'v',z:'0'},palette:['#60FF0000','#A000FF00','#E00000FF'],
  settings:{u_segments:3,v_segments:1,u_min:0,u_max:96,v_min:0,v_max:1,speed_u:1,speed_v:0,periodic_u:false,periodic_v:false,
   scale_x:1,scale_y:1,scale_z:1,offset_x:0,offset_y:0,offset_z:0,show_trails:true,fade_trails:false,trail_lifetime:10},
  timeline:[...groups.map(actions=>actions.length?{type:'animate',duration:.5,easing:'LINEAR',actions:actions.map(action=>action==='start'?{method:'gradientStart',args:{mode,interpolation:'RGB',speed:90}}:{method:'gradientStop',args:[]})}:{type:'wait',duration:.5}),{type:'trails',enable:false}],
 }));
 result.scene.timeline.fps=4;return result;
}
function output(scene:SceneDocument,time:number,quality:'preview'|'export'='preview'){
 const out=generateScene(scene,{time,width:96,height:64,quality,sourceViewport:ordinarySourceViewport(scene,96,64,quality==='preview'?'primary':'offscreen',64)});
 if(out.type!=='geometry')throw new Error('Expected source geometry');return out;
}
function colors(packed:readonly number[]){return new Float32Array(packed.flatMap(color=>[(color>>>16&255)/255,(color>>>8&255)/255,(color&255)/255]));}
const alphas=(values:readonly number[])=>new Float32Array(values.map(value=>value/255));

// All expected head/trail bytes come from the standalone Python source oracle.
// The public importer, sceneAtTime, save/reopen, generator and reverse seeks must
// agree with those bytes. No native application or rendered pixels are claimed.
describe('source Surface gradient lifecycle through imported documents and generated geometry',()=>{
 it.each(golden.scenarios)('$mode $name matches every full head and trail frame after save/reopen',scenario=>{
  const {scene,warnings}=imported(scenario.mode,scenario.groups),saved=serializeScene(scene),reopened=parseScene(saved);
  expect(warnings.some(message=>message.includes('独立生产 owner')||message.includes('既有本地解析'))).toBe(false);
  for(const expected of scenario.frames){
   const out=output(reopened,expected.time);
   expect(out.colors,`head RGB @${expected.time}`).toEqual(colors(expected.head));
   expect(out.pointAlphas,`head alpha @${expected.time}`).toEqual(alphas(expected.headAlpha));
   expect(out.trails!.colors,`trail RGB @${expected.time}`).toEqual(colors(expected.trailRGB));
   expect(out.trails!.alphas,`trail alpha @${expected.time}`).toEqual(alphas(expected.trailAlpha));
   expect(out.positions).toEqual(new Float32Array([expected.sceneTime,0,0,32+expected.sceneTime,0,0,64+expected.sceneTime,0,0]));
   expect(out.trails!.positions.length/3).toBe(expected.records*3);
   expect(out.trails!.indices!.length).toBe(Math.max(0,expected.records-1)*6);
   expect(out.warnings?.some(message=>message.includes('独立生产 owner')||message.includes('参数/渐变帧时钟未'))).toBe(false);
   const evaluated=sceneAtTime(reopened,expected.time),throughTimeline=output(evaluated,expected.time);
   expect(throughTimeline.colors).toEqual(out.colors);expect(throughTimeline.trails).toEqual(out.trails);
   expect(throughTimeline.sourceCameraFrame).toEqual(out.sourceCameraFrame);
   expect(evaluated.surfaceSourcePalette).toEqual(reopened.surfaceSourcePalette);
   expect(evaluated.palette).toEqual(reopened.palette);
  }
  // Exported scene and reverse seeking use a fresh replay, independent of the
  // latest generated frame, without resetting authored source palette state.
  for(const expected of [...scenario.frames].reverse()){
   const out=output(reopened,expected.time,'export');
   expect(out.colors).toEqual(colors(expected.head));expect(out.trails!.colors).toEqual(colors(expected.trailRGB));
  }
  expect(serializeScene(reopened)).toBe(saved);
 });
 it('freezes head and history after the terminal zero-dt instant and completed queue',()=>{
  const {scene}=imported('PALETTE_MORPH',[['start'],[],['stop'],[],['start'],[]]);
  const before=output(scene,2.75),instant=output(scene,3),later=output(scene,5);
  for(const out of [instant,later]){
   expect(out.positions).toEqual(before.positions);expect(out.colors).toEqual(before.colors);expect(out.pointAlphas).toEqual(before.pointAlphas);expect(out.trails).toEqual(before.trails);
  }
 });
 it('uses opaque dynamic trail alpha then retained palette alpha when stopped, including fade quantization',()=>{
  const {scene}=imported('HUE_ROTATE',[['start'],[],['stop'],[]]);scene.settings.fadeTrails=true;
  const active=output(scene,.75),stopped=output(scene,1.25);
  expect(Array.from(active.trails!.alphas.slice(0,4))).toEqual([0,F(85/255),F(170/255),1]);
  const expected=golden.scenarios[0].frames.find(frame=>frame.time===1.25)!;
  const base=expected.headAlpha[0];
  const fade=(ordinal:number)=>F(Math.trunc(F(255*F(F(base*F(ordinal/5))/255)))/255);
  expect(Array.from(stopped.trails!.alphas.slice(0,6))).toEqual(Array.from({length:6},(_,ordinal)=>fade(ordinal)));
  expect(stopped.pointAlphas![0]).toBe(F(base/255));expect(stopped.trails!.alphas.at(-1)).toBeLessThan(1);
 });
 it('poisons a replay cancelled inside a gradient color refresh instead of publishing partial colors',()=>{
  const {scene}=imported('HUE_ROTATE',[['start'],[]]);let checks=0,limit=Infinity;
  const particles=prepareSourceSurfaceParticles(scene).create('all',()=>++checks>limit);
  limit=checks+3;
  expect(()=>particles.beginGradientActions([{kind:'start',config:SOURCE_PARTICLE_GRADIENT_DEFAULT}])).toThrow('已取消');
  limit=Infinity;
  expect(()=>particles.snapshot()).toThrow('已取消');
  expect(()=>particles.interpolateGradientActions(.5,false)).toThrow('已取消');
 });

});
