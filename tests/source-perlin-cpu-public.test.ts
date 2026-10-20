import {describe,it,expect} from 'vitest';
import {parseLegacyScene,parseProjectFile} from '../src/engine/legacyImport';
import {parseScene,serializeScene} from '../src/engine/document';
import {createAnimationTrack,resolveTimeline,sceneAtTime} from '../src/engine/timeline';
import {replaySourcePerlinCamera} from '../src/engine/sourcePerlinReplay';
import {SourcePerlinSession} from '../src/scenes/sourcePerlin';
import {usesSourcePerlin,usesSourcePerlinCpu} from '../src/engine/sourcePerlinIdentity';
const input=()=>({config_version:'1.0.0',type:'PERLIN',name:'CPU source',settings:{render_mode:'CPU',seed:'1771842692935',particle_count:24,step_size:.75,cpu_render_style:'PARTICLES'},palette:['#FFAA2233','#FF3366FF'],timeline:[{type:'animate',duration:.5,actions:[{method:'gradientStart',args:{mode:'HUE_ROTATE',speed:90}},{method:'paramStart',args:{parameters:{noise_offset:{min:-1,max:1,step:.01}}}}]},{type:'wait',duration:1}]});
describe('public source Perlin CPU authoring boundaries',()=>{
 it('imports semantic CPU configuration while retaining original source and long tokens',()=>{
  const raw=JSON.stringify(input()).replace('"1771842692935"','9007199254740993'),result=parseProjectFile(raw),scene=result.scene;
  expect(usesSourcePerlinCpu(scene)).toBe(true);expect(usesSourcePerlin(scene)).toBe(true);expect(scene.perlinGpuSource).toBeUndefined();
  expect(scene.perlinSource).toMatchObject({seed:'9007199254740993',cpuStyle:'particles',particles:{count:24,stepSize:.75}});
  expect(scene.provenance?.sourceNumberTokens?.some(t=>t.path.join('.')==='settings.seed'&&t.token==='9007199254740993')).toBe(true);
  expect(scene.timeline.tracks[0].actions?.map(a=>a.method)).toEqual(['gradientStart','paramStart']);
 });
 it('roundtrips both CPU styles and canonical edits without rereading source',()=>{
  for(const style of ['PARTICLES','FIELD_CURVES']){
   const raw=input();raw.settings.cpu_render_style=style;const scene=parseLegacyScene(JSON.stringify(raw)).scene;
   scene.perlinSource!.particles.count=18;scene.perlinSource!.curves.count=7;scene.perlinSource!.seed='-9223372036854775808';
   const reopened=parseScene(serializeScene(scene));expect(reopened.perlinSource).toEqual(scene.perlinSource);expect(serializeScene(reopened)).toBe(serializeScene(scene));
  }
 });
 it('runs source actions and instant trails through camera queries without allocating graphics',()=>{
  const scene=parseLegacyScene(JSON.stringify(input())).scene,trail=createAnimationTrack(scene,'trails');expect(trail.duration).toBe(0);scene.timeline.tracks.push(trail);
  expect(resolveTimeline(scene).duration).toBeGreaterThan(0);
  for(const time of [0,.25,1,.1])expect(sceneAtTime(scene,time).evaluatedSourceCamera).toEqual(replaySourcePerlinCamera(scene,time));
  expect(parseScene(serializeScene(scene)).timeline.tracks.at(-1)?.duration).toBe(0);
 });
 it('does not reinterpret saved local Perlin documents as source CPU',()=>{
  const scene=parseLegacyScene(JSON.stringify(input())).scene;delete scene.perlinSource;
  expect(usesSourcePerlinCpu(scene)).toBe(false);expect(usesSourcePerlin(scene)).toBe(false);
 });
 it('rejects conflicting or misplaced model owners and unsupported source tracking',()=>{
  const scene=parseLegacyScene(JSON.stringify(input())).scene;
  expect(()=>parseScene(JSON.stringify({...scene,kind:'surface'}))).toThrow(/Perlin/);
  expect(()=>parseScene(JSON.stringify({...scene,perlinGpuSource:{}}))).toThrow(/一个活动/);
  scene.timeline.tracks[0].actions!.push({id:'track',method:'track',args:{index:0}});
  expect(()=>parseScene(serializeScene(scene))).toThrow(/不分派|不支持/);
 });
 it('requires explicit primary viewport facts before generation and cleans a cancelled owner',()=>{
  const scene=parseLegacyScene(JSON.stringify(input())).scene,owner=new SourcePerlinSession(),context={time:0,quality:'preview' as const,width:64,height:48};
  expect(()=>owner.generate(scene,context)).toThrow(/主画布/);
  expect(()=>owner.generate(scene,{...context,sourcePerlinViewport:{width:64,height:48,pixelDensity:1},sourceViewport:{logicalWidth:64,logicalHeight:48,referenceLogicalHeight:48,target:'primary',projectionPass:'perspective'},isCancelled:()=>true})).toThrow(/取消|cancelled/);
  expect(owner.diagnostics().target).toBeUndefined();owner.reset();
 });
});
