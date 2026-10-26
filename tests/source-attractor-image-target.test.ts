import {afterEach,describe,expect,it,vi} from 'vitest';
import {parseProjectFile} from '../src/engine/legacyImport';
import {generateScene,generateSceneAsync} from '../src/engine/temporal';
import {SourceAttractorGpuReplaySession} from '../src/engine/sourceAttractorGpuReplay';
import {sourceAttractorImageTarget,sourceAttractorPreviewPixelDensity,validSourceAttractorRasterDensity} from '../src/engine/sourceAttractorImageTarget';
import type {GenerateContext,SceneOutput} from '../src/types';

function scene(backend:'CPU'|'GPU'='CPU'){return parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'ATTRACTOR',name:'Image target',settings:{render_mode:backend,particle_count_cpu:2,particle_count_gpu:2,sub_steps:1},initialization:{warmup_steps:0,warmup_stagger_min:0,warmup_stagger_max:0},equations:{dx:'1',dy:'0',dz:'0'},main_equation:{enabled:false},timeline:[{type:'wait',duration:1}]})).scene;}
const context:GenerateContext={time:0,width:117,height:53,quality:'preview',sourcePointPixelDensity:2,sourceViewport:{logicalWidth:405,logicalHeight:486,referenceLogicalHeight:486,target:'primary',projectionPass:'perspective'}};
afterEach(()=>vi.restoreAllMocks());
describe('source Attractor image target: CPU and GPU share physical request semantics',()=>{
 for(const backend of ['CPU','GPU'] as const)it.each([1,2])(`${backend} density %i keeps 500x600 physical and scales only the logical camera`,density=>{
  expect(sourceAttractorImageTarget(scene(backend),{width:500,height:600},density,486)).toEqual({width:500,height:600,logicalWidth:500/density,logicalHeight:600/density,density,sourceViewport:{logicalWidth:500/density,logicalHeight:600/density,referenceLogicalHeight:486,target:'offscreen',projectionPass:'perspective'}});
 });
 it.each(['CPU','GPU'] as const)('%s rounds odd images through source float/Math.round and does not triple fixed-time video',backend=>{
  expect(sourceAttractorImageTarget(scene(backend),{width:503,height:607},2,486)).toMatchObject({width:504,height:608,logicalWidth:252,logicalHeight:304});
  expect(sourceAttractorImageTarget(scene(backend),{width:1920,height:1080},2,486)).toMatchObject({width:1920,height:1080,logicalWidth:960,logicalHeight:540});
 });
 it('does not guess missing display facts or admit local Attractor to source normalization',()=>{
  const s=scene('GPU');for(const d of [NaN,0,1.25])expect(()=>sourceAttractorImageTarget(s,{width:500,height:600},d,486)).toThrow();
  expect(()=>sourceAttractorImageTarget(s,{width:500,height:600},2,NaN)).toThrow();delete s.attractorSource;expect(()=>sourceAttractorImageTarget(s,{width:500,height:600},2,486)).toThrow('源场景');
 });
 it('uses completed CPU point facts, requiring a primary camera',()=>{
  const s=scene(),out=generateScene(s,context);expect(sourceAttractorPreviewPixelDensity(s,out)).toBe(2);
  out.sourceCameraFrame={...out.sourceCameraFrame!,viewport:{...out.sourceCameraFrame!.viewport,target:'offscreen'}};expect(sourceAttractorPreviewPixelDensity(s,out)).toBeUndefined();
 });
 it('delivers explicit GPU density independently of quality resolution, synchronously and asynchronously',async()=>{
  const s=scene('GPU'),frame=generateScene(scene(),context).sourceCameraFrame!;
  const draw=vi.spyOn(SourceAttractorGpuReplaySession.prototype,'generate').mockImplementation(r=>({type:'raster',width:r.width,height:r.height,pixels:new Uint8ClampedArray(r.width*r.height*4),backend:'webgl2',sourceCameraFrame:structuredClone(frame),stats:{samples:2,generated:2,invalid:0,elapsedMs:0}}));
  for(const output of [generateScene(s,context),await generateSceneAsync(s,context)]){
   expect(output.type).toBe('raster');expect(output).toHaveProperty('sourceAttractorPixelDensity',2);expect(sourceAttractorPreviewPixelDensity(s,output)).toBe(2);expect(validSourceAttractorRasterDensity(output,2)).toBe(true);expect(validSourceAttractorRasterDensity(output,1)).toBe(false);
  }
  const unknown=generateScene(s,{...context,sourcePointPixelDensity:undefined});expect(unknown).not.toHaveProperty('sourceAttractorPixelDensity');expect(sourceAttractorPreviewPixelDensity(s,unknown)).toBeUndefined();expect(validSourceAttractorRasterDensity(unknown,undefined)).toBe(true);
  const before=draw.mock.calls.length;expect(()=>generateScene(s,{...context,sourcePointPixelDensity:NaN})).toThrow('像素密度');expect(draw).toHaveBeenCalledTimes(before);
  const invalid={...unknown,sourceAttractorPixelDensity:NaN} as SceneOutput;expect(validSourceAttractorRasterDensity(invalid,NaN)).toBe(false);
 });
});
