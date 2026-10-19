import {describe,it,expect} from 'vitest';
import {parseProjectFile} from '../src/engine/legacyImport';
import {parseScene,serializeScene,createScene} from '../src/engine/document';
import {definitions} from '../src/scenes';
import {prepareSourceAttractorScene,usesSourceAttractor,parseSourceAttractorDocument} from '../src/engine/sourceAttractorDocument';
import {parseSourceNumberTokens} from '../src/engine/sourceNumberTokens';
import {importSourceParticleGradient} from '../src/engine/sourceParticleGradientImport';

const source=(extra:Record<string,unknown>={})=>({config_version:'1.0',type:'ATTRACTOR',name:'Native CPU',equations:{dx:'y',dy:'-x',dz:'0'},...extra});
const imported=(extra:Record<string,unknown>={})=>parseProjectFile(JSON.stringify(source(extra)));
describe('public source Attractor document and import owner',()=>{
 it('selects canonical source CPU with absent defaults and leaves existing local documents unchanged',()=>{
  const {scene}=imported(),payload=scene.attractorSource!;
  expect(usesSourceAttractor(scene)).toBe(true);expect(payload.configuration).toMatchObject({nativeBackend:'cpu',particleCountCPU:250,particleCountGPU:200000,settingsPresence:'absent'});
  expect(payload.visual.trails).toEqual({lineWeight:1,lifetime:4,show:true,fade:false});expect(payload.backgroundColor).toBe(0xff000000);
  expect(scene.settings.simulationMode).toBeUndefined();expect(scene.settings.integrator).toBeUndefined();expect(scene.settings.particleCount).toBeUndefined();
  expect(scene.sourceCamera).toMatchObject({configuration:{kind:'absent'}});expect(scene.timeline.schedule).toBe('ordinary-camera-sequence-v1');
  const local=createScene(definitions.find(d=>d.kind==='attractor')!),text=serializeScene(local),saved=parseScene(text);
  expect(usesSourceAttractor(saved)).toBe(false);expect(serializeScene(saved)).toBe(text);
 });
 it('owns exact ConfigUtils inputs, inactive GPU count, empty palette, transforms and source Euler fallback',()=>{
  const {scene,warnings}=imported({settings:{particle_count:999,particle_count_cpu:2,particle_count_gpu:123456,sub_steps:'3/2',time_step_min:.2,time_step_max:.1,scale_x:'PI/2',offset_y:7,integration_method:'RK4',dot_size:-2,line_weight:-1,trail_lifetime:0,show_trails:'TRUE',gpu_exposure:11},palette:[]});
  expect(scene.attractorSource!.configuration).toMatchObject({particleCountCPU:2,particleCountGPU:123456,stepsPerFrame:1,dtRange:{min:Math.fround(.1),max:Math.fround(.2)},transform:{scaleX:Math.fround(Math.PI/2),offsetY:7}});
  expect(scene.attractorSource!.visual).toMatchObject({palette:{kind:'colors',colors:[]},points:{dotRadius:-2},trails:{lineWeight:-1,lifetime:0,show:true}});
  expect(warnings.join('\n')).toContain('Euler');expect(scene.settings.scaleX).toBeUndefined();
  expect((scene.provenance!.original as ReturnType<typeof source>&{settings:Record<string,unknown>}).settings.gpu_exposure).toBe(11);
  expect(parseScene(serializeScene(scene)).attractorSource).toEqual(scene.attractorSource);
 });
 it('preserves numeric spelling, ARGB, authored changes and ignores provenance when reopening',()=>{
  const raw=JSON.stringify(source({settings:{particle_count_cpu:1,particle_count_gpu:3,background_color:1,sub_steps:2},initialization:{warmup_steps:1,bounds:{min_x:0}},parameters:{x:7},timeline:[{type:'animate',duration:1,actions:[{method:'gradientStart',args:[{speed:60}]},{method:'track',args:[0]}]}]}));
  const scene=parseProjectFile(raw.replace('"particle_count_gpu":3','"particle_count_gpu":4294967297').replace('"background_color":1','"background_color":1.0').replace('"warmup_steps":1','"warmup_steps":1e0')).scene;
  expect(scene.attractorSource!.configuration.particleCountGPU).toBe(1);expect(scene.attractorSource!.backgroundColor).toBe(0xffffffff);
  expect(scene.provenance!.sourceNumberTokens).toEqual(expect.arrayContaining([{path:['settings','particle_count_gpu'],token:'4294967297'},{path:['settings','background_color'],token:'1.0'},{path:['initialization','warmup_steps'],token:'1e0'},{path:['timeline','0','actions','0','args','0','speed'],token:'60'},{path:['timeline','0','actions','1','args','0'],token:'0'}]));
  scene.attractorSource!.configuration.particleCountCPU=4;scene.attractorSource!.visual.palette={kind:'colors',colors:['#00123456','#ff000080']};scene.attractorSource!.backgroundColor=0x804080c0;scene.parameters.x=9;
  const reopened=parseScene(serializeScene(scene));expect(reopened.attractorSource).toEqual(scene.attractorSource);expect(reopened.parameters.x).toBe(9);expect(reopened.provenance).toEqual(scene.provenance);
 });
 it('uses getDouble parameter literals and exact keys, including coordinate shadowing',()=>{
  const {scene}=imported({equations:{dx:'x',dy:'constructor',dz:'0'},parameters:{x:'0x1.2p3',constructor:4,'unused.key':2}});
  const prepared=prepareSourceAttractorScene(scene),out=new Float32Array(3);(prepared.backend==='cpu'?prepared.equation:(()=>{throw Error('CPU expected');})()).create().compute(100,200,300,out);expect(Array.from(out)).toEqual([9,4,0]);
  expect(parseScene(serializeScene(scene)).parameters).toEqual(scene.parameters);
  const blank=prepareSourceAttractorScene(imported({equations:{dx:'',dy:'   ',dz:'0'}}).scene);(blank.backend==='cpu'?blank.equation:(()=>{throw Error('CPU expected');})()).create().compute(1,2,3,out);expect(Array.from(out)).toEqual([0,0,0]);
  for(const value of ['8/3','a+1',true,null,'Infinity'])expect(()=>imported({parameters:{a:value}})).toThrow(/double/);
 });
 it('supports source track and gradient grouping with Attractor-specific admission',()=>{
  const timeline=[{type:'animate',duration:1,actions:[{method:'track',args:[0]},{method:'gradientStart',enabled:false,args:{targetDomain:'FRACTAL',mode:'CROSS_FADE',interpolation:'LINEAR',speed:30}},{method:'gradientStop',args:null}]}];
  const {scene}=imported({settings:{particle_count_cpu:1},timeline});
  expect(scene.timeline.tracks[0].actions!.map(a=>a.method)).toEqual(['track','gradientStart','gradientStop']);
  expect(scene.timeline.tracks[0].actions![1]).toMatchObject({enabled:true,gradient:{model:'offsets',mode:'cross_fade',interpolation:'linear',speed:30,affectInside:true,affectOutside:true}});
  expect(parseScene(serializeScene(scene)).timeline).toEqual(scene.timeline);
  const gated=imported({settings:{show_trails:false},timeline:[{type:'animate',duration:1,actions:[{method:'gradientStart',args:{speed:'1'.repeat(65537)}},{method:'gradientStop'}]}]}).scene;
  expect(gated.timeline.tracks[0].actions).toEqual([]);
  expect(importSourceParticleGradient({targetDomain:'FRACTAL'},'attractor').kind).toBe('start');expect(importSourceParticleGradient({targetDomain:'FRACTAL'},'surface').kind).toBe('skip');
 });
 it('never substitutes local GPU or local parameter animation into a canonical source document',()=>{
  const gpu=imported({settings:{render_mode:'GPU'}}).scene;expect(prepareSourceAttractorScene(gpu).backend).toBe('gpu');expect(gpu.attractorSource!.configuration.particleCountGPU).toBe(200000);
  for(const edit of [(s:ReturnType<typeof imported>['scene'])=>{s.timeline.tracks[0].type='param';},(s:ReturnType<typeof imported>['scene'])=>{s.timeline.tracks[0].actions=[{id:'param',method:'paramStart',args:{}}];}]){
   const s=imported({timeline:[{type:'animate',duration:1,actions:[]}]}).scene;edit(s);expect(()=>parseScene(serializeScene(s))).toThrow('没有参数动画');
  }
  const {scene}=imported();scene.attractorSource!.configuration.nativeBackend='gpu';expect(parseScene(serializeScene(scene)).attractorSource).toEqual(scene.attractorSource);
  scene.parameters['invalid.key']=1;expect(()=>parseScene(serializeScene(scene))).toThrow('GPU');
 });
 it('fails closed on malformed canonical payload, camera, schedule and local effects',()=>{
  const {scene}=imported();
  expect(parseSourceAttractorDocument({...scene.attractorSource,extra:true}).ok).toBe(false);
  for(const edit of [(s:typeof scene)=>{s.kind='surface';},(s:typeof scene)=>{delete s.sourceCamera;},(s:typeof scene)=>{delete s.timeline.schedule;},(s:typeof scene)=>{s.settings.scale=2;},(s:typeof scene)=>{s.attractorSource!.backgroundColor=-1;}]){
   const bad=structuredClone(scene);edit(bad);expect(()=>parseScene(serializeScene(bad))).toThrow();
  }
  expect(()=>parseSourceNumberTokens([{path:['settings','mesh_fill_opacity'],token:'1'}],'attractor')).toThrow();
  expect(()=>parseSourceNumberTokens([{path:['initialization','bounds','min_x'],token:'0'},{path:['initialization','bounds','min_x'],token:'0.0'}],'attractor')).toThrow('重复');
 });
});
