import {describe,it,expect} from 'vitest';
import {parseLegacyScene,parseProjectFile} from '../src/engine/legacyImport';
import {parseScene,serializeScene} from '../src/engine/document';
import {editSourceMapScene} from '../src/engine/sourceMapScene';
import {sourceMapInitialSeed} from '../src/engine/sourceMapInitialSeed';
import {prepareIteratedFrame,visibleIteratedControls} from '../src/scenes/iteratedDensity';
import {iteratedInitialChunk} from '../src/engine/iteratedSeed';
import {iteratedBaselineKey} from '../src/engine/iteratedIdentity';
import {definition} from '../src/scenes';
const raw=(extra:object={})=>({config_version:'1.0.0',type:'MAP_ATTRACTOR',name:'Map construction',parameters:{a:.2},equations:{x_next:'a*x+y',y_next:'nx-y',z_next:'ny+z'},settings:{batch_size:17,burn_in_steps:0,dimension:3},...extra});
const project=(extra:object={})=>parseProjectFile(JSON.stringify(raw(extra))).scene;
describe('source Map construction across project, editor and runtime',()=>{
 it('retains configuration and Float32 initial states through save/reopen',()=>{
  const scene=project(),saved=parseScene(serializeScene(scene));
  expect(saved.mapSource).toEqual(scene.mapSource);expect(saved.provenance?.original).toEqual(raw());
  const first=prepareIteratedFrame(scene,0,0),second=prepareIteratedFrame(saved,0,0);
  expect(first.config.sourceInitialSeed).toBe(sourceMapInitialSeed(scene.mapSource!));
  expect(iteratedInitialChunk(second.config,0,17)).toEqual(iteratedInitialChunk(first.config,0,17));
  const encoded=JSON.parse(serializeScene(scene));encoded.mapSource.construction.dimension=9;
  expect(()=>parseScene(JSON.stringify(encoded))).toThrow();
 });
 it('separates project and runtime defaults and preserves the compatibility opt-out',()=>{
  const runtime=parseLegacyScene(JSON.stringify({config_version:'1.0.0',type:'MAP_ATTRACTOR',name:'Base'})).scene;
  expect(runtime.parameters).toEqual({a:-1.7,b:1.8,c:1.6,d:.9});
  expect(runtime.settings.batchSize).toBe(262144);expect(runtime.equations.z).toBe('');
  const p=project({settings:{dimension:4,batch_size:3,burn_in_steps:0,x0_min:'1/3',x0_max:'2/3'}});
  expect(p.settings.dimension).toBe(3);expect(p.settings.initialXMin).toBe(-1);expect(p.settings.initialXMax).toBe(1);
  const d=parseLegacyScene(JSON.stringify(raw({settings:{dimension:4,batch_size:3,burn_in_steps:0,x0_min:'1/3',x0_max:'2/3'}}))).scene;
  expect(d.settings.dimension).toBe(2);expect(d.settings.initialXMin).toBe(Math.fround(1/3));
  expect(project({settings:{render_mode:'CPU',batch_size:3}}).settings.iteratedBackend).toBe('gpu');
  expect(parseLegacyScene(JSON.stringify(raw()),{iteratedMath:'legacy-v1'}).scene.mapSource).toBeUndefined();
 });
 it('keeps construction fixed for runtime uniforms but rebuilds on explicit inspector edits',()=>{
  const before=project(),seed=prepareIteratedFrame(before,0,0).config.sourceInitialSeed;
  const runtime={...before,parameters:{...before.parameters,a:.4}};
  expect(prepareIteratedFrame(runtime,0,0).config.sourceInitialSeed).toBe(seed);
  const rebuilt=editSourceMapScene(before,runtime);
  expect(prepareIteratedFrame(rebuilt,0,0).config.sourceInitialSeed).not.toBe(seed);
  const formula=editSourceMapScene(rebuilt,{...rebuilt,equations:{...rebuilt.equations,x:' a*x+y '}});
  expect(formula.mapSource!.construction.equations.x).toBe(formula.equations.x);
  const camera=editSourceMapScene(before,{...before,camera:{...before.camera,zoom:2}});
  expect(camera.mapSource).toBe(before.mapSource);
  expect(()=>prepareIteratedFrame({...before,settings:{...before.settings,batchSize:18}},0,0)).toThrow('重建');
  expect(()=>prepareIteratedFrame({...before,equations:{...before.equations,x:'y'}},0,0)).toThrow('重建');
 });
 it('owns immutable bounds, source shader iteration clamp and dormant local seed',()=>{
  const scene=project({settings:{batch_size:17,burn_in_steps:0,iterations_per_frame:17,x0_min:2,x0_max:-2,y0_min:.1,y0_max:.1}});
  expect(scene.mapSource!.construction.initial).toEqual({xMin:-2,xMax:2,yMin:Math.fround(.1),yMax:Math.fround(.1)});
  expect(scene.settings.iterationsPerFrame).toBe(17);expect(prepareIteratedFrame(scene,0,0).config.iterations).toBe(16);
  const key=iteratedBaselineKey(scene);scene.settings.seed='dormant';scene.settings.initialZMin='dormant';
  expect(iteratedBaselineKey(scene)).toBe(key);expect(prepareIteratedFrame(scene,0,0).config.seed).toBe(0);
  const controls=visibleIteratedControls(scene.kind,scene.settings,definition('map').controls,scene.timeline,scene.palette,scene.equations,scene.mapSource);
  expect(controls.some(c=>['seed','initialMode','initialRange','initialZMin','initialZMax'].includes(c.key))).toBe(false);
 });
 it('preserves signed-zero construction identity and raw numeric evidence',()=>{
  const scene=project({parameters:{a:'-0'}}),saved=parseScene(serializeScene(scene));
  expect(Object.is(saved.parameters.a,-0)).toBe(true);expect(sourceMapInitialSeed(saved.mapSource!)).toBe(sourceMapInitialSeed(scene.mapSource!));
  const changed=editSourceMapScene(saved,{...saved,parameters:{...saved.parameters,a:0}});
  expect(iteratedBaselineKey(changed)).not.toBe(iteratedBaselineKey(saved));
  const fields=project().provenance?.sourceNumberTokens?.map(row=>row.path.join('.'));
  expect(fields).toContain('settings.dimension');expect(fields).toContain('settings.batch_size');
 });
});
