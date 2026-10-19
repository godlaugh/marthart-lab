import {describe,it,expect} from 'vitest';
import {parseLegacyScene,parseProjectFile} from '../src/engine/legacyImport';
import {parseScene,serializeScene} from '../src/engine/document';
import {createSourcePerlinGpuReplay} from '../src/engine/sourcePerlinGpuReplay';
import {createAnimationTrack,resolveTimeline,sceneAtTime} from '../src/engine/timeline';
import {SourcePerlinGpuSession} from '../src/scenes/sourcePerlinGpu';
const source=()=>({config_version:'1.0.0',type:'PERLIN',name:'Source GPU',settings:{render_mode:'GPU',seed:'1771842692935',gpu_brightness:'1+1',gpu_texture_style:3},palette:['#FFAA2233','#FF3366FF'],timeline:[{type:'animate',duration:.5,easing:'LINEAR',actions:[{method:'gradientStart',args:{mode:'HUE_ROTATE',speed:90}},{method:'paramStart',args:{parameters:{noise_scale:{min:1,max:20,step:2}}}}]},{type:'animate',duration:.25,actions:[{method:'gradientStop',args:{}}]},{type:'wait',duration:.5}]});
const imported=()=>parseLegacyScene(JSON.stringify(source())).scene;
describe('source Perlin GPU public authoring and replay',()=>{
 it('imports source settings once and preserves original source evidence',()=>{
  const result=parseLegacyScene(JSON.stringify(source()));expect(result.source).toEqual(source());
  const scene=result.scene;expect(scene.perlinGpuSource?.uniforms.brightness).toBe(2);expect(scene.perlinGpuSource?.seed).toBe('1771842692935');
  expect(scene.timeline.tracks[0].actions?.map(a=>a.method)).toEqual(['gradientStart','paramStart']);expect(scene.timeline.tracks[0].actions?.[1].perlinParameters?.parameters[0].name).toBe('noise_scale');
 });
 it('saves canonical edits without reimporting original values',()=>{
  const scene=imported();scene.perlinGpuSource!.uniforms={...scene.perlinGpuSource!.uniforms,brightness:3};scene.perlinGpuSource!.seed='-9223372036854775808';
  const reopened=parseScene(serializeScene(scene));expect(reopened.perlinGpuSource).toEqual(scene.perlinGpuSource);expect(serializeScene(reopened)).toBe(serializeScene(scene));
 });
 it('roundtrips retained source numeric tokens through the actual project-file path',()=>{
  const raw=JSON.stringify({...source(),settings:{...source().settings,seed:9007199254740992,gpu_render_style:1,gpu_march_steps:8,noise_scale:.01}}).replace('9007199254740992','9007199254740993');
  const scene=parseProjectFile(raw).scene;expect(scene.perlinGpuSource?.seed).toBe('9007199254740993');
  const reopened=parseScene(serializeScene(scene));expect(reopened.provenance?.sourceNumberTokens).toEqual(scene.provenance?.sourceNumberTokens);
  expect(reopened.provenance?.sourceNumberTokens?.some(item=>item.path.join('.')==='settings.gpu_march_steps')).toBe(true);
  expect(reopened.provenance?.sourceNumberTokens?.some(item=>item.path.includes('noise_scale')&&item.path.at(-1)==='min')).toBe(true);
 });
 it('retains only the last valid gradient and skips absent args',()=>{
  const s=source();s.timeline[0].actions=[{method:'gradientStart',args:{mode:'HUE_ROTATE',speed:90}},{method:'gradientStart',args:{mode:'NOT_A_MODE',speed:5}}];
  const scene=parseLegacyScene(JSON.stringify(s)).scene;expect(scene.timeline.tracks[0].actions).toHaveLength(1);expect(scene.timeline.tracks[0].actions?.[0].gradient?.speed).toBe(90);
 });
 it('preserves object camera args, skips scalar args, and keeps unknown clips as waits',()=>{
  const raw={...source(),parameters:{ignored:'not an expression'},timeline:[{type:'animate',duration:.5,actions:[{method:'rotateTheta',args:{}},{method:'rotatePhi',args:null},{method:'ambient',args:{}},{method:'stopAmbient',args:{}},{method:'rotateGamma',args:[2]}]},{type:'future',duration:.25}]};
  const scene=parseLegacyScene(JSON.stringify(raw)).scene;
  expect(scene.parameters).toEqual({});expect(scene.timeline.tracks[0].actions?.map(a=>[a.method,a.args])).toEqual([['rotateTheta',{angle:0}],['stopAmbient',{}]]);
  expect(scene.timeline.tracks[1]).toMatchObject({type:'wait',duration:.25});
 });
 it('replays cold, warm and reverse seeks with identical displayed palettes and time',()=>{
  const scene=imported(),warm=createSourcePerlinGpuReplay(scene),cold=createSourcePerlinGpuReplay(scene);
  try{for(const time of [0,.25,.5,.75,1,2])warm.timeline.evaluate(time);cold.timeline.evaluate(2);expect(warm.display()).toEqual(cold.display());
   const frozen=structuredClone(warm.display());warm.timeline.evaluate(3);expect(warm.display()).toEqual(frozen);
   warm.timeline.evaluate(.25);const fresh=createSourcePerlinGpuReplay(scene);fresh.timeline.evaluate(.25);expect(warm.display()).toEqual(fresh.display());fresh.timeline.reset();
  }finally{warm.timeline.reset();cold.timeline.reset();}
 });
 it('creates an instant source trails clip and validates the public timeline',()=>{
  const scene=imported(),track=createAnimationTrack(scene,'trails');expect(track.duration).toBe(0);scene.timeline.tracks.push(track);
  expect(()=>resolveTimeline(scene)).not.toThrow();expect(()=>sceneAtTime(scene,1)).not.toThrow();expect(parseScene(serializeScene(scene)).timeline.tracks.at(-1)?.duration).toBe(0);
 });
 it('rejects source payload on other scene kinds and malformed source actions',()=>{
  const scene=imported();expect(()=>parseScene(JSON.stringify({...scene,kind:'surface'}))).toThrow(/Perlin/);
  scene.timeline.tracks[0].actions!.push({id:'bad',method:'track',args:{index:0}});expect(()=>parseScene(JSON.stringify(scene))).toThrow(/不分派/);
 });
 it('rejects a cancelled request without silently returning a local raster and recovers owner',()=>{
  const scene=imported(),session=new SourcePerlinGpuSession();
  const context={time:0,quality:'preview' as const,width:64,height:48,isCancelled:()=>true,sourceViewport:{logicalWidth:64,logicalHeight:48,referenceLogicalHeight:48,target:'primary' as const,projectionPass:'perspective' as const}};
  expect(()=>session.generate(scene,context)).toThrow(/取消|cancelled/);expect(session.diagnostics().retainedBytes).toBe(0);session.reset();
 });
});
