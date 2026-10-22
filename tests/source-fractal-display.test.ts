import {describe,expect,it} from 'vitest';
import fixture from './fixtures/source-fractal-display/mandelbrot.json';
import {parseProjectFile} from '../src/engine/legacyImport';
import {SourceFractalHostSession} from '../src/engine/sourceFractalHostSession';
import {bindSourceFractalFrame,prepareSourceFractalScene} from '../src/engine/sourceFractalTimeline';
import {prepareFractalRender} from '../src/scenes/complex';
import {SourceFractalDisplay,sourceFractalDisplayInput,sourceFractalRenderState,type SourceFractalDisplayFacts} from '../src/engine/sourceFractalDisplay';
function input(){
 const scene=parseProjectFile(JSON.stringify(fixture)).scene,host=new SourceFractalHostSession(prepareSourceFractalScene(scene),{paused:true});
 const snapshot=host.snapshot();bindSourceFractalFrame(scene,{...snapshot.state,displayFrame:0,simulationFps:60});
 return sourceFractalDisplayInput(prepareFractalRender(scene,{time:0,width:250,height:300,quality:'preview'}),scene);
}
const draw=(owner:SourceFractalDisplay,i= input())=>owner.display(i,f=>f);
describe('original ComplexFractalMobject display owner',()=>{
 it('matches original runtime lastRenderState for the bundled Mandelbrot at 250×300',()=>{
  expect(sourceFractalRenderState(input())).toBe(1354526813);
 });
 it('matches seven observed paused native displays, including delayed PShader gradientSize',()=>{
  const owner=new SourceFractalDisplay(),i=input(),facts=Array.from({length:7},()=>draw(owner,i));
  expect(facts.map(f=>[f.previewScale,f.gradientSize,f.passIndexAfter])).toEqual([[.25,0,1],[.5,0,2],[1,0,2],[1,1024,2],[1,1024,2],[1,1024,2],[1,1024,2]]);
  expect(facts.map(f=>f.needsAnotherDisplay)).toEqual([true,true,true,false,false,false,false]);
 });
 it('shares the pass and pending uniform across targets, preserving first coarse black fallback transition',()=>{
  const owner=new SourceFractalDisplay(),i=input();for(let n=0;n<4;n++)draw(owner,i);
  const off=draw(owner,{...i,logicalSize:[405,486]});expect(off).toMatchObject({stateReset:true,previewScale:.25,gradientSize:1024,requestedGradientSize:0,useGradientTexture:false});
  const back=draw(owner,i);expect(back).toMatchObject({stateReset:true,previewScale:.25,gradientSize:0,passIndexAfter:1});
 });
 it('full/parameter-animation displays still carry the initial delayed uniform and stop at the last pass',()=>{
  for(const method of ['one-pass','guessing','multi-pass'] as const){
   const owner=new SourceFractalDisplay(),i={...input(),method,parametersRunning:true};
   expect(draw(owner,i)).toMatchObject({previewScale:1,gradientSize:0,requestedGradientSize:1024,needsAnotherDisplay:true});
   expect(draw(owner,i)).toMatchObject({previewScale:1,gradientSize:1024,needsAnotherDisplay:false});
   expect(draw(owner,{...i,parametersRunning:false}).previewScale).toBe(1);
  }
  const owner=new SourceFractalDisplay(),i={...input(),method:'guessing' as const};expect(draw(owner,i).previewScale).toBe(Math.fround(.33));expect(draw(owner,i).previewScale).toBe(1);
 });
 it('applyConfig resets the pass without deleting the existing shader uniform queue',()=>{
  const owner=new SourceFractalDisplay(),i=input();for(let n=0;n<4;n++)draw(owner,i);owner.applyConfiguration();
  expect(draw(owner,i)).toMatchObject({stateReset:false,passIndexBefore:0,previewScale:.25,gradientSize:1024,useGradientTexture:false});
 });
 it('hashes native omissions, int32 overflow, all palette entries, and solid alpha without broadening invalidation',()=>{
  const i=input(),hash=sourceFractalRenderState(i),n=i.native;
  expect(sourceFractalRenderState({...i,parametersRunning:true,native:{...n,native:{...n.native,dynamicParams:n.native.dynamicParams.map(v=>v+1)}}})).toBe(hash);
  expect(sourceFractalRenderState({...i,color:{...i.color,inside:{...i.color.inside,algorithmId:99,p0:[9,9,9,9]}}})).toBe(hash);
  expect(sourceFractalRenderState({...i,color:{...i.color,inside:{...i.color.inside,solidArgb:0x00000000}}})).not.toBe(hash);
  expect(sourceFractalRenderState({...i,color:{...i.color,fallback:{...i.color.fallback,packedColors:[...i.color.fallback.packedColors,0xffffffff]}}})).not.toBe(hash);
  expect(sourceFractalRenderState({...i,logicalSize:[250.00000001,300]})).toBe(hash);
  expect(sourceFractalRenderState({...i,native:{...n,native:{...n.native,julia:[-0,n.native.julia[1]]}}})).not.toBe(hash);
 });
 it('does not commit a failed raster and prevents reentrant display/config mutation',()=>{
  const owner=new SourceFractalDisplay(),i=input();let failed:SourceFractalDisplayFacts|undefined;
  expect(()=>owner.display(i,f=>{failed=f;expect(()=>draw(owner,i)).toThrow('重入');expect(()=>owner.applyConfiguration()).toThrow('显示期间');throw Error('failed draw');})).toThrow('failed draw');
  expect(draw(owner,i)).toEqual(failed);
 });
});
