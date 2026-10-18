import {describe,it,expect} from 'vitest';
import {parseProjectFile} from '../src/engine/legacyImport';
import {parseScene,serializeScene,createScene} from '../src/engine/document';
import {prepareSourceSurfaceParticles} from '../src/engine/sourceSurfaceParticles';
import {generateScene} from '../src/engine/temporal';
import {ordinarySourceViewport} from '../src/engine/ordinarySourceCamera';
import {outputBuffers} from '../src/engine/outputBuffers';
import {sceneAtTime} from '../src/engine/timeline';
import {definition} from '../src/scenes';

const F=Math.fround;
function source(palette:unknown=['#80112233'],settings:Record<string,unknown>={}){
 return {config_version:'1.0.0',type:'SURFACE',name:'Source colors',palette,equations:{x:'u',y:'v',z:'0'},settings:{u_segments:1,v_segments:1,u_min:0,u_max:10,v_min:0,v_max:10,scale_x:1,scale_y:1,scale_z:1,speed_u:1,speed_v:1,periodic_u:true,periodic_v:true,flowing_u:true,flowing_v:true,...settings},timeline:[{type:'animate',duration:1,actions:[{method:'track',args:[0]}]},{type:'wait',duration:1}]};
}
const imported=(palette?:unknown,settings?:Record<string,unknown>)=>parseProjectFile(JSON.stringify(source(palette,settings))).scene;

describe('source Surface palette and alpha through authored document and production output',()=>{
 it('keeps ARGB and invalid source strings through import, save and timeline copies',()=>{
  const s=imported(['#80112233','invalid','0x0000FF']);
  const reopened=parseScene(serializeScene(s));expect(reopened.surfaceSourcePalette).toEqual({colors:['#80112233','invalid','0x0000FF']});
  const frame=sceneAtTime(reopened,.5);expect(frame.surfaceSourcePalette).toEqual(reopened.surfaceSourcePalette);
  frame.surfaceSourcePalette!.colors[0]='#000000';expect(reopened.surfaceSourcePalette!.colors[0]).toBe('#80112233');
 });
 it('migrates previously saved source particle colors without overriding later edits from provenance',()=>{
  const s=imported(['#FF0000']);delete s.surfaceSourcePalette;s.palette.stops=['#112233','#445566'];
  const reopened=parseScene(serializeScene(s));expect(reopened.surfaceSourcePalette).toEqual({colors:['#112233','#445566']});
  expect(reopened.provenance).toMatchObject({original:{palette:['#FF0000']}});
  expect(parseScene(serializeScene(reopened)).surfaceSourcePalette).toEqual(reopened.surfaceSourcePalette);
 });
 it('rejects source empty/nonstring palettes at import rather than substituting a local palette',()=>{
  expect(()=>imported([])).toThrow('至少需要一种颜色');expect(()=>imported([1])).toThrow('必须是字符串');expect(()=>imported(null)).toThrow('colors 数组');
 });
 it('does not permit source palette payload on ordinary local surface documents',()=>{
  const s=createScene(definition('surface'));s.surfaceSourcePalette={colors:['#FFFFFF']};expect(()=>parseScene(serializeScene(s))).toThrow('原版 CPU 点曲面');
 });
 it('retains base alpha initially and on zero-dt actions, then multiplies both periodic edge fades',()=>{
  const s=imported(),p=prepareSourceSurfaceParticles(s).create('all');
  expect(p.snapshot().pointAlphas[0]).toBe(F(128/255));
  p.update({frameIndex:0,time:0,deltaTime:0});expect(p.snapshot().pointAlphas[0]).toBe(F(128/255));
  p.update({frameIndex:1,time:.5,deltaTime:.5});expect(p.snapshot().pointAlphas[0]).toBe(F(32/255));
  p.update({frameIndex:2,time:1,deltaTime:.5});expect(p.snapshot().pointAlphas[0]).toBe(F(128/255));
  const copy=p.snapshot();copy.pointAlphas.fill(0);copy.colors.fill(0);expect(p.snapshot().pointAlphas[0]).toBe(F(128/255));expect(p.snapshot().colors[0]).toBe(F(17/255));
 });
 it.each([{periodic_u:false,periodic_v:false},{flowing_u:false,flowing_v:false}])('retains base alpha with inactive boundary fades: %j',settings=>{
  const p=prepareSourceSurfaceParticles(imported(undefined,settings)).create('all');p.update({frameIndex:0,time:.5,deltaTime:.5});expect(p.snapshot().pointAlphas[0]).toBe(F(128/255));
 });
 it('keeps ignored source fade_points as provenance, and permits a saved local fade toggle',()=>{
  const result=parseProjectFile(JSON.stringify(source(undefined,{fade_points:false})));
  expect(result.scene.settings.fadePoints).toBe(true);expect(result.warnings.some(w=>w.includes('fade_points'))).toBe(true);expect(result.scene.provenance).toMatchObject({original:{settings:{fade_points:false}}});
  result.scene.settings.fadePoints=false;const reopened=parseScene(serializeScene(result.scene)),p=prepareSourceSurfaceParticles(reopened).create('all');
  p.update({frameIndex:0,time:.5,deltaTime:.5});expect(p.snapshot().pointAlphas[0]).toBe(F(128/255));
 });
 it('fades approaching the upper edge and wraps to zero alpha at the exact endpoint',()=>{
  const p=prepareSourceSurfaceParticles(imported(undefined,{u_segments:20,speed_v:0,periodic_v:false})).create('all');
  p.update({frameIndex:0,time:.25,deltaTime:.25});expect(p.snapshot().pointAlphas[19]).toBe(F(32/255));
  p.update({frameIndex:1,time:.5,deltaTime:.25});expect(p.snapshot().pointAlphas[19]).toBe(0);
 });
 it('applies palette alpha before trail quantization and keeps trail alpha independent of head fade',()=>{
  const p=prepareSourceSurfaceParticles(imported(undefined,{periodic_u:false,periodic_v:false})).create('all');
  for(let i=0;i<3;i++)p.update({frameIndex:i,time:(i+1)*.25,deltaTime:.25});
  expect(Array.from(p.snapshot().trails!.alphas)).toEqual([0,F(64/255),F(128/255)]);
  const q=prepareSourceSurfaceParticles(imported()).create('all');q.update({frameIndex:0,time:.5,deltaTime:.5});q.update({frameIndex:1,time:.75,deltaTime:.25});
  expect(q.snapshot().pointAlphas[0]).toBe(F(72/255));expect(q.snapshot().trails!.alphas.at(-1)).toBe(F(128/255));
 });
 it('preserves source zero-alpha trail fallback without making transparent heads opaque',()=>{
  const p=prepareSourceSurfaceParticles(imported(['#00112233'],{fade_trails:false})).create('all');p.update({frameIndex:0,time:.5,deltaTime:.5});
  expect(p.snapshot().pointAlphas[0]).toBe(0);expect(p.snapshot().trails!.alphas[0]).toBe(1);
 });
 it('invalidates evaluated palette caches and delivers transferable source colors and alpha',()=>{
  const s=imported(['#80112233']);s.timeline.fps=4;
  const context={time:.25,width:96,height:64,quality:'preview' as const,sourceViewport:ordinarySourceViewport(s,96,64,'primary',64)};
  const a=generateScene(s,context);if(a.type!=='geometry')throw Error('geometry required');
  expect(Array.from(a.colors!.slice(0,3))).toEqual([F(17/255),F(34/255),F(51/255)]);expect(a.pointAlphas![0]).toBe(F(32/255));expect(outputBuffers(a)).toContain(a.pointAlphas!.buffer);
  s.surfaceSourcePalette={colors:['#FF0000']};const b=generateScene(s,context);if(b.type!=='geometry')throw Error('geometry required');
  expect(Array.from(b.colors!.slice(0,3))).toEqual([1,0,0]);expect(b.pointAlphas![0]).toBe(F(63/255));
 });
 it('keeps invalid-color recovery diagnostics on actual generated output',()=>{
  const s=imported(['invalid']);const out=generateScene(s,{time:0,width:32,height:32,quality:'preview',sourceViewport:ordinarySourceViewport(s,32,32,'primary',32)});
  expect(out.warnings?.some(w=>w.includes('第 1 色无法解析'))).toBe(true);
 });
 it('rejects malformed fade settings while older source documents retain the source default',()=>{
  const s=imported();s.settings.fadePoints='false';expect(()=>prepareSourceSurfaceParticles(s)).toThrow('布尔值');delete s.settings.fadePoints;
  const p=prepareSourceSurfaceParticles(s).create('all');p.update({frameIndex:0,time:.5,deltaTime:.5});expect(p.snapshot().pointAlphas[0]).toBe(F(32/255));
 });
});
