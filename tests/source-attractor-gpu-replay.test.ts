import {describe,it,expect} from 'vitest';
import {parseProjectFile} from '../src/engine/legacyImport';
import {prepareSourceAttractorScene} from '../src/engine/sourceAttractorDocument';
import {replaySourceAttractorGpu} from '../src/engine/sourceAttractorGpuReplay';
import {SourceAttractorGpu,prepareSourceAttractorGpuWork} from '../src/engine/sourceAttractorGpu';
import {sceneAtTime} from '../src/engine/timeline';
import {parseScene,serializeScene} from '../src/engine/document';

function fixture(timeline:unknown[]=[{type:'animate',duration:0,actions:[{method:'track',args:[0]}]},{type:'wait',duration:1}]){
 const scene=parseProjectFile(JSON.stringify({config_version:'1.0',type:'ATTRACTOR',name:'GPU replay',equations:{dx:'1',dy:'0',dz:'0'},settings:{render_mode:'GPU',particle_count_gpu:2,sub_steps:3,time_step:1,scale_x:2,offset_x:1},initialization:{warmup_steps:100,bounds:{min_x:2,max_x:2,min_y:0,max_y:0,min_z:0,max_z:0}},timeline})).scene;
 scene.timeline.fps=4;const prepared=prepareSourceAttractorScene(scene);if(prepared.backend!=='gpu')throw Error('GPU expected');
 return{scene,options:{...prepared,tracks:scene.timeline.tracks,fps:scene.timeline.fps,time:0}};
}
describe('source GPU Attractor public replay ownership',()=>{
 it('tracks original transformed seeds without CPU warmup or reading evolved GPU positions',()=>{
  const {scene,options}=fixture();
  for(const time of [0,.25,1,2,.5]){
   const replay=replaySourceAttractorGpu({...options,time});
   expect(replay.frame.camera.center).toEqual([5,0,0]);
   expect(sceneAtTime(scene,time).evaluatedSourceCamera!.camera).toEqual(replay.frame.camera);
  }
  expect(replaySourceAttractorGpu({...options,time:2}).updates).toBe(replaySourceAttractorGpu({...options,time:1}).updates);
 });
 it('distinguishes an empty display-only queue from zero/negative duration dispatched updates',()=>{
  const empty=fixture([]).options;expect(replaySourceAttractorGpu(empty).updates).toBe(0);
  const options=fixture([{type:'wait',duration:0},{type:'wait',duration:-1},{type:'wait',duration:0}]).options;
  expect(replaySourceAttractorGpu(options).updates).toBe(1);
  expect(replaySourceAttractorGpu({...options,time:.25}).updates).toBe(2);
  expect(replaySourceAttractorGpu({...options,time:2}).updates).toBe(3);
 });
 it('ignores native GPU gradient args without parsing them and preserves imported raw source',()=>{
  const {scene,options}=fixture([{type:'animate',duration:0,actions:[{method:'gradientStart',args:{speed:'x'.repeat(65537)}},{method:'track',args:[0]}]}]);
  expect(scene.timeline.tracks[0].actions!.map(a=>a.method)).toEqual(['track']);
  expect(parseScene(serializeScene(scene)).provenance).toEqual(scene.provenance);
  expect(replaySourceAttractorGpu(options).frame.camera.center).toEqual([5,0,0]);
 });
 it('rejects impossible warmup before context allocation while retaining signed int overflow semantics',()=>{
  const {options}=fixture(),configuration=structuredClone(options.configuration);configuration.particleCountGPU=1;
  configuration.warmup={steps:2147483647,staggerMin:0,staggerMax:0};
  expect(()=>new SourceAttractorGpu({...options,configuration})).toThrow('预算');
  configuration.warmup.staggerMax=1;
  expect(prepareSourceAttractorGpuWork(configuration,options.shader.operations,0)).toMatchObject({warmup:0,passes:0,work:0});
  const owner=new SourceAttractorGpu({...options,configuration});expect(owner.diagnostics().contextOwned).toBe(false);owner.dispose();owner.dispose();
 });
 it('bounds copy-only draws as well as arithmetic and reports cancellation without a context',()=>{
  const {options}=fixture(),configuration={...options.configuration,stepsPerFrame:-1,warmup:{steps:0,staggerMin:0,staggerMax:0}};
  expect(()=>prepareSourceAttractorGpuWork(configuration,options.shader.operations,10001)).toThrow('预算');
  const owner=new SourceAttractorGpu({...options,configuration,isCancelled:()=>true});expect(()=>owner.initialize()).toThrow('取消');expect(owner.diagnostics().contextOwned).toBe(false);owner.dispose();
 });
});
