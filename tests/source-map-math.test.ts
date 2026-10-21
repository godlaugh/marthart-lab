import {describe,it,expect,vi,afterEach} from 'vitest';
import {parseLegacyScene,parseProjectFile} from '../src/engine/legacyImport';
import {parseScene,serializeScene,createScene} from '../src/engine/document';
import {SOURCE_MAP_MATH,prepareSourceMapExpressions,sourceMapGpuField} from '../src/engine/sourceMapMath';
import {prepareIteratedFrame,visibleIteratedControls} from '../src/scenes/iteratedDensity';
import {generateScene} from '../src/engine/temporal';
import {ordinarySourceViewport} from '../src/engine/ordinarySourceCamera';
import {iteratedBaselineKey} from '../src/engine/iteratedIdentity';
import {analyzeEquationDraft} from '../src/engine/equationEditor';
import {definition} from '../src/scenes';
const raw=(mode='GPU')=>({config_version:'1.0.0',type:'MAP_ATTRACTOR',name:'Map math boundary',equations:{x_next:'x + a',y_next:'nx+y',z_next:'ny+z'},parameters:{a:.1},settings:{render_mode:mode,dimension:3,batch_size:3,burn_in_steps:0},timeline:[]});
const imported=()=>parseProjectFile(JSON.stringify(raw())).scene;
afterEach(()=>vi.unstubAllGlobals());
describe('source Map math document and execution boundaries',()=>{
 it('versions new GPU imports, preserves original data and reopens without migration',()=>{
  const scene=imported(),saved=parseScene(serializeScene(scene));
  expect(saved.settings.mapMathModel).toBe(SOURCE_MAP_MATH);expect(saved.provenance?.original).toEqual(raw());
  expect(prepareIteratedFrame(saved,0,0).field).toMatchObject({kind:'map',mathModel:SOURCE_MAP_MATH,dimension:3});
  delete scene.settings.mapMathModel;expect(parseScene(serializeScene(scene)).settings.mapMathModel).toBeUndefined();
  expect(parseLegacyScene(JSON.stringify(raw('CPU'))).scene.settings.mapMathModel).toBeUndefined();
  expect(parseLegacyScene(JSON.stringify(raw()),{iteratedMath:'legacy-v1'}).scene.settings.mapMathModel).toBeUndefined();
 });
 it('owns ordered aliases, preserves old coordinates, and ignores dormant 2D z text',()=>{
  const plan=prepareSourceMapExpressions({x:' y ',y:'nx + x',z:'ny + nx + z'},[],3);
  expect(prepareSourceMapExpressions({x:'x',y:'y'},[],3).source).toContain('float z_next = 0.0;');
  expect(plan.source).toContain('float x_next = y;');expect(plan.source).toContain('float y_next = (nx + x);');expect(plan.source).toContain('float z_next = ((ny + nx) + z);');
  expect(()=>prepareSourceMapExpressions({x:'nx',y:'y'},[],2)).toThrow('x_next');
  expect(()=>prepareSourceMapExpressions({x:'x',y:'ny'},[],2)).toThrow('y_next');
  expect(()=>prepareSourceMapExpressions({x:'x',y:'y',z:'nz'},[],3)).toThrow('z_next');
  expect(prepareSourceMapExpressions({x:'x',y:'y',z:'this is invalid'},[],2).source).toContain('float z_next = 0.0;');
 });
 it('shares the source grammar, with no implicit time or template constants',()=>{
  const source=prepareSourceMapExpressions({x:'-x^2+2(x+1)',y:'x%y'},[],2).source;
  expect(source).toContain('((-(x * x)) + (2.0 * (x + 1.0)))');expect(source).toContain('mod(x, y)');
 });
 it('uses uniform values without changing compiled program identity',()=>{
  const input={equations:{x:'a*x+b',y:'x'},parameters:{a:.1,b:.2},dimension:2 as const};
  const first=sourceMapGpuField(input),next=sourceMapGpuField({...input,parameters:{b:5,a:2}});
  expect(next.key).toBe(first.key);expect(next.uniforms).not.toEqual(first.uniforms);
  expect(sourceMapGpuField({...input,equations:{x:'a*x-b',y:'x'}}).key).not.toBe(first.key);
  expect(()=>sourceMapGpuField({...input,parameters:{a:1e40,b:0}})).toThrow('Float32');
 });
 it('rejects source-invalid GLSL and unsupported names instead of sanitizing formulas',()=>{
  for(const x of ['t+x','time+x','PI+x','1e-3*x','sin()','pow(x,y,z)'])expect(()=>prepareSourceMapExpressions({x,y:'y'},[],2)).toThrow();
  for(const name of ['x','nx','pos','sin','iterations','stateTex','a b','float','gl_value','__proto__'])expect(()=>prepareSourceMapExpressions({x:'x',y:'y'},[name],2)).toThrow();
  expect(prepareSourceMapExpressions({x:'PI*x',y:'time+y'},['PI','time'],2).source).toContain('sourceMapParameter');
 });
 it('uses the same parser for editor errors, completion, and rendering',()=>{
  const scene=imported(),good=analyzeEquationDraft(scene,{x:'2x',y:'nx+x',z:'ny+z'});
  expect(Object.values(good).every(value=>!value.error&&value.sourceReal)).toBe(true);
  expect(good.x.suggestions.some(s=>s.name==='nx'||s.name==='time'||s.name==='PI')).toBe(false);
  expect(good.y.suggestions.some(s=>s.name==='nx')).toBe(true);
  expect(analyzeEquationDraft(scene,{x:'time+x'}).x.error).toBeDefined();
 });
 it('treats escape radius as dormant and includes arithmetic version in replay identity',()=>{
  const scene=imported(),before=iteratedBaselineKey(scene);scene.settings.escapeRadius='dormant';
  expect(prepareIteratedFrame(scene,0,0).config.escape).toBe(0);expect(iteratedBaselineKey(scene)).toBe(before);
  const controls=visibleIteratedControls(scene.kind,scene.settings,definition(scene.kind).controls,scene.timeline,scene.palette,scene.equations);
  expect(controls.find(c=>c.key==='escapeRadius')).toBeUndefined();expect(controls.find(c=>c.key==='iteratedBackend')?.options?.some(o=>o.value==='cpu')).toBe(false);
  scene.settings.mapMathModel='legacy-v1';expect(iteratedBaselineKey(scene)).not.toBe(before);
 });
 it('does not silently fall back to local CPU maths or single sampling',()=>{
  vi.stubGlobal('OffscreenCanvas',class{getContext(){return null;}});
  const scene=imported(),context={time:0,width:16,height:12,quality:'export' as const,sourceViewport:ordinarySourceViewport(scene,16,12,'primary',12)};
  expect(()=>generateScene(scene,context)).toThrow('未回退到不同的 CPU 数学');
  scene.settings.iteratedBackend='cpu';expect(()=>generateScene(scene,context)).toThrow('源 Map 数学需要 GPU');
  scene.settings.mapMathModel='future';expect(()=>generateScene(scene,context)).toThrow('数学模型');
  const single=createScene(definition('map'));single.settings.mapMathModel=SOURCE_MAP_MATH;expect(()=>generateScene(single,context)).toThrow('持续批次');
 });
});
