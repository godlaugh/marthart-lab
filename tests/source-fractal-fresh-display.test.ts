import type {prepareFractalRender} from '../src/scenes/complex';
import {afterEach,describe,expect,it,vi} from 'vitest';
import fixture from './fixtures/source-fractal-display/mandelbrot.json';
import {parseProjectFile} from '../src/engine/legacyImport';
import {SourceFractalFreshRecordingSession} from '../src/engine/sourceFractalFreshRecording';
import {withFractalFreshRecording} from '../src/engine/sourceFractalRecording';
import {generateScene,TemporalGenerationSession} from '../src/engine/temporal';
import {fractalGpu} from '../src/engine/fractalGpu';
import type {GenerateContext,SceneDocument,SceneOutput,RasterOutput} from '../src/types';
const scene=()=>withFractalFreshRecording(parseProjectFile(JSON.stringify(fixture)).scene,60);
const context=(frame:number):GenerateContext=>({time:frame/60,quality:'export',width:16,height:12,fractalRecording:{displayFrame:frame,simulationFps:60},fractalViewport:{logicalWidth:8,logicalHeight:6,target:'offscreen'},fractalPixelDensity:2});
function setup(){
 const calls:{scene:SceneDocument;context:GenerateContext;prepared?:ReturnType<typeof prepareFractalRender>}[]=[];
 const render=vi.fn((scene:SceneDocument,context:GenerateContext,prepared?:ReturnType<typeof prepareFractalRender>):SceneOutput=>{calls.push({scene:structuredClone(scene),context:{...context},prepared});return{type:'raster',width:context.width,height:context.height,pixels:new Uint8ClampedArray(context.width*context.height*4),stats:{samples:1,generated:1,invalid:0}};});
 return{owner:new SourceFractalFreshRecordingSession(render),render,calls};
}
afterEach(()=>{vi.restoreAllMocks();fractalGpu.dispose();});
describe('fresh recording couples numerical and progressive display history',()=>{
 it('keeps local coloring/scheduling available for saved source-arithmetic-only recording documents',()=>{
  const s=scene(),f=setup();delete s.fractalSourceColor;delete s.settings.fractalColorProfile;
  for(let i=0;i<3;i++)expect((f.owner.generate(s,context(i)) as RasterOutput).fractalRecording!.displayFrame).toBe(i);
  for(const current of f.calls){
   expect(current.context.fractalDisplay).toBeUndefined();expect(current.prepared!.colorPlan).toBeUndefined();
   expect(current.prepared!.sourcePlan!.formula).toBe('mandelbrot');
   expect(current.prepared!.source!.native).toEqual(current.scene.evaluatedFractalScene!.formula.native);
  }
 });
 it('keeps one original display sequence for continuous frames and includes warmup exactly once',()=>{
  const s=scene(),f=setup(),outputs=Array.from({length:5},(_,i)=>f.owner.generate(s,context(i)) as RasterOutput);
  expect(f.calls.map(c=>[c.context.fractalDisplay!.ordinal,c.context.fractalDisplay!.previewScale,c.context.fractalDisplay!.gradientSize])).toEqual([[0,.25,0],[1,.5,0],[2,1,0],[3,1,1024],[4,1,1024]]);
  expect(outputs.map(o=>o.fractalRecording!.displayFrame)).toEqual([0,1,2,3,4]);expect(outputs.map(o=>o.fractalRecording!.warmup)).toEqual([true,false,false,false,false]);
 });
 it('reconstructs skipped/backward/repeated ordinals without rendering intermediate pixel frames',()=>{
  const s=scene(),reference=setup();for(let i=0;i<7;i++)reference.owner.generate(s,context(i));
  const random=setup();for(const ordinal of [3,6,1,1,0]){
   random.owner.generate(s,context(ordinal));const actual=random.calls.at(-1)!;
   expect(actual.context.fractalDisplay).toEqual(reference.calls[ordinal].context.fractalDisplay);
   expect(actual.scene.evaluatedFractalScene).toEqual(reference.calls[ordinal].scene.evaluatedFractalScene);
  }
  expect(random.render).toHaveBeenCalledTimes(5);
 });
 it('reconstructs the complete selected input and dimensions instead of reusing another recording identity',()=>{
  const original=scene(),f=setup();f.owner.generate(original,context(0));f.owner.generate(original,context(1));
  const changed=structuredClone(original);changed.settings.centerX=1.125;changed.fractalSourceColor!.outside.density=7;
  const next={...context(2),width:20,fractalViewport:{logicalWidth:10,logicalHeight:6,target:'offscreen' as const}},control=setup();
  f.owner.generate(changed,next);control.owner.generate(changed,next);
  expect(f.calls.at(-1)!.scene).toEqual(control.calls[0].scene);expect(f.calls.at(-1)!.context.fractalDisplay).toEqual(control.calls[0].context.fractalDisplay);
  const draft=structuredClone(changed);draft.settings.centerX=500;expect(f.calls.at(-1)!.scene.settings.centerX).toBe(1.125);
 });
 it('clears both owners after failed/cancelled rendering and allows a correct explicit reconstruction',()=>{
  const s=scene(),f=setup(),reference=setup();reference.owner.generate(s,context(3));f.owner.generate(s,context(0));
  f.render.mockImplementationOnce(()=>{throw Error('failed GPU');});expect(()=>f.owner.generate(s,context(1))).toThrow('failed GPU');
  let checks=0;expect(()=>f.owner.generate(s,{...context(3),isCancelled:()=>++checks>12})).toThrow(expect.objectContaining({name:'AbortError'}));
  f.owner.generate(s,context(3));expect(f.calls.at(-1)!.context.fractalDisplay).toEqual(reference.calls[0].context.fractalDisplay);
 });
 it('accounts for random-access display preparation in the shared reconstruction work budget',()=>{
  const f=setup(),s=scene();expect(()=>f.owner.generate(s,context(3000))).toThrow(expect.objectContaining({code:'capacity',message:expect.stringContaining('共享 200 万')}));
  expect(f.render).not.toHaveBeenCalled();f.owner.generate(s,context(0));expect(f.calls[0].context.fractalDisplay!.ordinal).toBe(0);
 });
 it('routes public fresh-frame generation through the retained recording display owner',()=>{
  vi.spyOn(fractalGpu,'sample').mockImplementation(points=>({values:new Float32Array(points.length*4),sourceRGBA:new Uint8Array(points.length*2).fill(255)}));
  const s=scene(),session=new TemporalGenerationSession();
  try{
   const frames=Array.from({length:4},(_,i)=>generateScene(s,context(i),session) as RasterOutput);
   expect(frames.map(o=>[o.fractalRender!.display!.ordinal,o.fractalRender!.display!.previewScale,o.fractalRender!.display!.gradientSize])).toEqual([[0,.25,0],[1,.5,0],[2,1,0],[3,1,1024]]);
   expect(frames.map(o=>o.fractalRecording!.displayFrame)).toEqual([0,1,2,3]);
  }finally{session.reset();}
 });
});
