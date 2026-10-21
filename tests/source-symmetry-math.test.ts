import {describe,it,expect,vi,afterEach} from 'vitest';
import {parseLegacyScene,parseProjectFile} from '../src/engine/legacyImport';
import {parseScene,serializeScene} from '../src/engine/document';
import {SOURCE_SYMMETRY_MATH,usesSourceSymmetryMath} from '../src/engine/sourceSymmetryMath';
import {prepareIteratedFrame} from '../src/scenes/iteratedDensity';
import {generateScene} from '../src/engine/temporal';
import {ordinarySourceViewport} from '../src/engine/ordinarySourceCamera';
import type {SceneDocument} from '../src/types';
import {visibleIteratedControls} from '../src/scenes/iteratedDensity';
import {definition} from '../src/scenes';
import {withSymmetryTemplate} from '../src/engine/symmetryEditing';
import {iteratedBaselineKey} from '../src/engine/iteratedIdentity';

const raw=(mode='GPU')=>({config_version:'1.0.0',type:'SYMMETRY_CHAOS',name:'Source polynomial',equation:{template:'modified'},parameters:{lambda:2,alpha:-2.43,beta:1,gamma:.05,omega:0,delta:.5,delta_power:3,symmetry_degree:5},settings:{render_mode:mode,batch_size:3,burn_in_steps:0},timeline:[]});
const imported=()=>parseProjectFile(JSON.stringify(raw())).scene;
const context=(scene:SceneDocument)=>({time:0,width:32,height:24,quality:'export' as const,sourceViewport:ordinarySourceViewport(scene,32,24,'primary',24)});
afterEach(()=>vi.unstubAllGlobals());
describe('source Symmetry numerical contract at the document boundary',()=>{
 it('selects native GPU arithmetic for new GPU imports and retains source provenance on reopen',()=>{
  const scene=imported(),saved=parseScene(serializeScene(scene));
  expect(saved.settings.symmetryMathModel).toBe(SOURCE_SYMMETRY_MATH);
  expect(saved.provenance?.original).toEqual(raw());
  expect(prepareIteratedFrame(saved,0,0).field).toMatchObject({kind:'symmetry',mathModel:SOURCE_SYMMETRY_MATH,parameters:{n:5,deltaPower:3,delta:.5}});
 });
 it('keeps explicitly requested local CPU and legacy import mathematics distinct',()=>{
  expect(parseLegacyScene(JSON.stringify(raw('CPU'))).scene.settings.symmetryMathModel).toBeUndefined();
  expect(parseLegacyScene(JSON.stringify(raw()),{iteratedMath:'legacy-v1'}).scene.settings.symmetryMathModel).toBeUndefined();
 });
 it('includes arithmetic identity in replay invalidation',()=>{
  const scene=imported(),before=iteratedBaselineKey(scene);scene.settings.symmetryMathModel='legacy-v1';
  expect(iteratedBaselineKey(scene)).not.toBe(before);
 });
 it('lets authored custom GLSL own its kernel and restores the selected built-in when cleared',()=>{
  const scene=imported();scene.equations.glsl='void calculate_next(in vec3 p,out vec3 n,out float m){n=p;m=0.;}';
  expect(usesSourceSymmetryMath(scene)).toBe(false);expect(prepareIteratedFrame(scene,0,0).field.kind).toBe('symmetry-custom');
  scene.equations.glsl='';expect(usesSourceSymmetryMath(scene)).toBe(true);
 });
 it('preserves the source built-in selection when custom GLSL was present at import',()=>{
  const value=raw();Object.assign(value.equation,{glsl:'void calculate_next(in vec3 p,out vec3 n,out float m){n=p;m=0.;}'});
  const scene=parseProjectFile(JSON.stringify(value)).scene;expect(usesSourceSymmetryMath(scene)).toBe(false);
  const selected=withSymmetryTemplate(scene,'modified');expect(usesSourceSymmetryMath(selected)).toBe(true);
  expect(prepareIteratedFrame(selected,0,0).field).toMatchObject({parameters:{deltaPower:3}});
 });
 it('keeps arbitrary custom correction uniforms and rejects an invalid built-in switch',()=>{
  const value=raw();value.parameters.delta_power=7.5;Object.assign(value.equation,{glsl:'void calculate_next(in vec3 p,out vec3 n,out float m){n=p*delta_power;m=0.;}'});
  const scene=parseProjectFile(JSON.stringify(value)).scene;
  expect(scene.parameters.delta_power).toBe(7.5);expect(scene.settings.deltaPower).toBe(7.5);
  expect(prepareIteratedFrame(scene,0,0).field.kind).toBe('symmetry-custom');
  expect(()=>withSymmetryTemplate(scene,'modified')).toThrow('修正幂次');
  expect(scene.equations.glsl).toContain('p*delta_power');
 });
 it('offers only applicable controls and describes GPU failure accurately',()=>{
  const result=parseProjectFile(JSON.stringify(raw())),scene=result.scene;
  const controls=visibleIteratedControls(scene.kind,scene.settings,definition(scene.kind).controls,scene.timeline,scene.palette,scene.equations);
  expect(controls.find(c=>c.key==='escapeRadius')).toBeUndefined();expect(controls.find(c=>c.key==='iteratedBackend')?.options?.some(o=>o.value==='cpu')).toBe(false);
  expect(result.warnings.join()).not.toContain('明确回退 CPU');expect(result.warnings.join()).toContain('GPU 不可用时明确报错');
  const before=iteratedBaselineKey(scene);for(const value of [0,-1,'dormant']){scene.settings.escapeRadius=value;expect(iteratedBaselineKey(scene)).toBe(before);expect(prepareIteratedFrame(scene,0,0).config.escape).toBe(0);}
 });
 it('rejects unknown arithmetic identities before creating a context',()=>{
  const scene=imported();scene.settings.symmetryMathModel='future';const getContext=vi.fn();
  vi.stubGlobal('OffscreenCanvas',class{getContext=getContext;});
  expect(()=>generateScene(scene,context(scene))).toThrow('数学模型');expect(getContext).not.toHaveBeenCalled();
 });
 it('fails clearly on unavailable GPU rather than silently changing the numerical contract',()=>{
  vi.stubGlobal('OffscreenCanvas',class{getContext(){return null;}});
  const scene=imported();expect(()=>generateScene(scene,context(scene))).toThrow('未回退到不同的 CPU 数学');
 });
 it('does not reinterpret an already selected source model as CPU arithmetic',()=>{
  const scene=imported();scene.settings.iteratedBackend='cpu';
  expect(()=>generateScene(scene,context(scene))).toThrow('源 Symmetry 数学需要 GPU');
 });
});
