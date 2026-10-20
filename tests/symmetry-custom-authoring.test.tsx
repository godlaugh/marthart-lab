import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {parseLegacyScene} from '../src/engine/legacyImport';
import {parseScene,persistentScene,createScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {withSymmetryTemplate,withSymmetryCustomSource} from '../src/engine/symmetryEditing';
import {parameterEditingSpecs,parameterAnimationSuggestion,withParameterValue,withoutEditableParameter} from '../src/engine/parameterEditing';
import {mainEquation,formulaLabels,defaultFormulas} from '../src/engine/formulas';
import {SymmetryFormula} from '../src/components/SymmetryFormula';
import {ParameterEditor} from '../src/components/ParameterEditor';
import {ExplorePanel} from '../src/components/ExplorePanel';
import {hasSymmetryCustom,MAX_SYMMETRY_CUSTOM_SOURCE_LENGTH} from '../src/engine/symmetryCustom';
import {createAnimationTrack,sceneAtTime} from '../src/engine/timeline';
import type {AnimationTrack} from '../src/types';

const source='\n// Caller source, preserved exactly.\nuniform float gain;\nuniform float delta;\nvoid calculate_next(in vec3 pos, out vec3 nextPos, out float stepMetric) {\n nextPos=vec3(pos.x*gain+0.01, pos.y+delta, 9.0); stepMetric=-2.0;\n}\n';
const legacy=(glsl:unknown)=>({config_version:'1.0.0',type:'SYMMETRY_CHAOS',name:'Custom source test',equation:{glsl,formula:'Caller display: <x> & "gain"',template:'standard'},parameters:{gain:1.234567891,delta:3.1415926535,lambda:9.123456789,symmetry_degree:5},settings:{batch_size:32,render_mode:'GPU',burn_in_steps:0}});
// This suite retains the established local numeric/oscillator authoring model.
// Source queue/camera imports are covered separately by source-density-pipeline.
const imported=()=>parseLegacyScene(JSON.stringify(legacy(source)),{iteratedCamera:'legacy-v1'}).scene;
const reload=(s:ReturnType<typeof imported>)=>parseScene(JSON.stringify(persistentScene(s)));

describe('custom Symmetry imported authoring and persistence',()=>{
 it('prepares exact editable source without changing parameters, rendering choices or source provenance',()=>{
  const scene=imported(),before=JSON.stringify(scene),text=source.replace('pos.x*gain','sin(pos.x*gain)'),next=withSymmetryCustomSource(scene,text);
  expect(JSON.stringify(scene)).toBe(before);expect(next.equations.glsl).toBe(text);expect(next.equations.formula).toBe(scene.equations.formula);
  expect(next.settings).toEqual(scene.settings);expect(next.parameters).toEqual(scene.parameters);expect(next.provenance).toEqual(scene.provenance);
  expect(reload(next).equations.glsl).toBe(text);expect(reload(scene).equations.glsl).toBe(source);
  expect(()=>withSymmetryCustomSource(scene,'#define BAD 1')).toThrow('预处理');expect(()=>withSymmetryCustomSource(scene,'')).toThrow('为空');
  // The owner parser deliberately leaves driver syntax/type checks to actual
  // generation; callers cannot treat successful preparation as compilation.
  expect(()=>withSymmetryCustomSource(scene,'void calculate_next(in vec3 pos,out vec3 nextPos,out float stepMetric){nextPos=pos stepMetric=1.;}')).not.toThrow();
 });
 it('retains exact source, display text, parameters and caller backend through real import and project reload',()=>{
  const input=legacy(source),result=parseLegacyScene(JSON.stringify(input)),saved=reload(result.scene);
  expect(result.source).toEqual(input);expect(saved.equations).toEqual({glsl:source,formula:input.equation.formula});
  expect(saved.parameters).toEqual(input.parameters);expect(saved.settings.iteratedBackend).toBe('gpu');
  expect(result.warnings.join('\n')).toContain('stepMetric');expect(result.warnings.join('\n')).not.toContain('明确回退 CPU');
  expect(result.warnings.join('\n')).not.toMatch(/尚未映射[^\n]*equation\.glsl/);
 });
 it('distinguishes absent or blank source from malformed source without trimming authored text',()=>{
  for(const raw of [undefined,null,'',' \r\n\t']){
   const scene=parseLegacyScene(JSON.stringify(legacy(raw))).scene;
   expect(hasSymmetryCustom(scene)).toBe(false);
   if(typeof raw==='string')expect(reload(scene).equations.glsl).toBe(raw);
  }
  for(const raw of [false,7,{},[]])expect(()=>parseLegacyScene(JSON.stringify(legacy(raw)))).toThrow('equation.glsl');
 });
 it('uses a separate raw GLSL storage budget and preserves unsupported syntax for diagnostics',()=>{
  const large=source+'/*'+'x'.repeat(10000)+'*/';const scene=parseLegacyScene(JSON.stringify(legacy(large))).scene;
  expect(reload(scene).equations.glsl).toBe(large);
  const atLimit='x'.repeat(MAX_SYMMETRY_CUSTOM_SOURCE_LENGTH);expect(reload(parseLegacyScene(JSON.stringify(legacy(atLimit))).scene).equations.glsl).toBe(atLimit);
  expect(()=>parseLegacyScene(JSON.stringify(legacy(atLimit+'x')))).toThrow('65536');
  expect(()=>reload({...scene,equations:{glsl:atLimit+'x'}})).toThrow('公式无效');
  expect(()=>reload({...scene,equations:{formula:'x'.repeat(8193)}})).toThrow('公式无效');
  const bad=reload(parseLegacyScene(JSON.stringify(legacy('#define ORIGINAL 1\ninvalid shader text'))).scene);
  expect(bad.equations.glsl).toContain('#define ORIGINAL');
  const html=renderToStaticMarkup(<SymmetryFormula scene={bad}/>);expect(html).toContain('role="alert"');expect(html).toContain('invalid shader text');
 });
 it('exposes all custom values without fixed coefficient ranges, rounds or delete restrictions',()=>{
  const scene=imported(),specs=parameterEditingSpecs(scene);
  expect(specs.map(s=>s.name)).toEqual(Object.keys(scene.parameters));
  expect(specs.every(s=>s.range===undefined&&s.displayDecimals===undefined&&s.canDelete)).toBe(true);
  expect(specs.find(s=>s.name==='gain')?.customBinding).toBe('matched');expect(specs.find(s=>s.name==='lambda')?.customBinding).toBe('unmatched');
  expect(parameterEditingSpecs({...scene,equations:{glsl:'#define X 2'}}).every(s=>s.customBinding==='unknown')).toBe(true);
  expect(parameterAnimationSuggestion(scene,'parameters.lambda')).toBeUndefined();
  const html=renderToStaticMarkup(<ParameterEditor scene={scene} onChange={()=>{}}/>);
  expect(html).toContain('value="9.123456789"');expect(html).toContain('param-delta');expect(html).toContain('删除参数 lambda');expect(html).not.toContain('type="range"');
  const edited=reload(withParameterValue(scene,'lambda',-100.123456789));expect(edited.parameters.lambda).toBe(-100.123456789);
  const removed=reload(withoutEditableParameter(edited,'lambda'));expect(removed.parameters.lambda).toBeUndefined();expect(removed.equations.glsl).toBe(source);
 });
 it('uses a single undoable template transition that retains values and only fills absent defaults',()=>{
  const original=imported(),before=structuredClone(original);original.parameters={gain:7,lambda:99};const template=withSymmetryTemplate(original,'modified');
  expect(template.equations.glsl).toBeUndefined();expect(template.equations.formula).toBe(original.equations.formula);
  expect(template.parameters).toEqual({gain:7,lambda:99,alpha:2,beta:.2,gamma:.2,omega:0,delta:0});
  expect(template.settings.template).toBe('modified');expect(original.equations).toEqual(before.equations);
  expect(parameterEditingSpecs(reload(template)).find(s=>s.name==='lambda')).toMatchObject({rangeSource:'fixed',canDelete:false});
  expect(hasSymmetryCustom(reload(original))).toBe(true);
  expect(()=>withSymmetryTemplate(original,'unknown')).toThrow('未知');expect(()=>withSymmetryTemplate(createScene(definition('map')),'standard')).toThrow('只有');
 });
 it('keeps custom parameter animation and explicit formula annotation through persistence',()=>{
  const scene=imported(),track=createAnimationTrack(scene,'param');track.target='parameters.gain';track.start=0;track.duration=4;track.parameterAnimations=[{target:'parameters.gain',min:.2,max:.8,step:1,enabled:true}];scene.timeline.tracks=[track];
  const saved=reload(scene);expect(sceneAtTime(saved,1).parameters.gain).toBe(sceneAtTime(scene,1).parameters.gain);expect(sceneAtTime(saved,1).parameters.gain).not.toBe(scene.parameters.gain);
  expect(mainEquation(saved)).toContain('calculate\\_next');expect(mainEquation(saved)).not.toContain('lambda');
  saved.formulas=defaultFormulas();saved.formulas.main.visible=true;saved.formulas.main.latex='g(x)=x^2';expect(formulaLabels(saved)[0].latex).toBe('g(x)=x^2');
 });
 it('separates native imported compile-degree conversion from unconstrained runtime uniform values',()=>{
  for(const [raw,expected]of [[undefined,3],[1.25,2],[5.75,5],[51,51],[1e300,2147483647],[-1e300,2]] as const){
   const input={...legacy(source),parameters:{delta_power:-27.5,...(raw===undefined?{}:{symmetry_degree:raw})}};
   const result=parseLegacyScene(JSON.stringify(input)),scene=reload(result.scene);
   expect(scene.settings.degree).toBe(expected);expect(scene.parameters.symmetry_degree).toBe(raw);expect(scene.parameters.delta_power).toBe(-27.5);
   if(expected>50){expect(()=>withSymmetryTemplate(scene,'standard')).toThrow('当前自定义源码保持不变');expect(scene.equations.glsl).toBe(source);}
  }
 });
 it('preserves GLSL identifiers and their animations without applying MathJS name restrictions',()=>{
  const input={...legacy(source),parameters:{_gain:.5,time:2,x:3,sin:4}},scene=parseLegacyScene(JSON.stringify(input),{iteratedCamera:'legacy-v1'}).scene;
  const track=createAnimationTrack(scene,'param');expect(track.target).toBe('parameters._gain');scene.timeline.tracks=[track];
  const saved=reload(scene);expect(saved.parameters).toEqual(input.parameters);expect(sceneAtTime(saved,1).parameters._gain).toBe(sceneAtTime(scene,1).parameters._gain);
  expect(reload(withSymmetryTemplate(scene,'standard')).parameters._gain).toBe(.5);
  for(const name of ['__proto__','prototype','constructor','bad-name'])expect(()=>parseLegacyScene(JSON.stringify({...input,parameters:{[name]:1}}))).toThrow('参数名');
 });
 it('rejects parameter deletion while enabled numeric, oscillator or paramStart actions depend on it',()=>{
  const base:AnimationTrack={id:'dependent',target:'parameters.gain',from:1,to:2,start:0,duration:2,easing:'linear',enabled:true,pingPong:false};
  const range={target:'parameters.gain',min:1,max:3,step:1,enabled:true};
  const tracks:AnimationTrack[]=[base,{...base,type:'param',parameterAnimations:[range]},{...base,type:'animate',actions:[{id:'start',method:'paramStart',parameters:[range]}]}];
  for(const track of tracks){const scene=imported();scene.timeline.tracks=[track];const initial=JSON.stringify(scene);expect(()=>withoutEditableParameter(scene,'gain')).toThrow('仍被启用的动画引用');expect(JSON.stringify(scene)).toBe(initial);expect(Number.isFinite(sceneAtTime(scene,1).parameters.gain)).toBe(true);scene.timeline.tracks=[{...track,enabled:false}];const removed=withoutEditableParameter(scene,'gain');expect(()=>sceneAtTime(reload(removed),1)).not.toThrow();expect(removed.timeline.tracks).toEqual(scene.timeline.tracks);}
  const scene=imported();scene.settings.deltaPower=100;expect(()=>withSymmetryTemplate(scene,'standard')).toThrow('修正幂次');expect(scene.equations.glsl).toBe(source);
 });
 it('renders an escaped source draft with explicit validation and disables fixed-template exploration in custom mode',()=>{
  const scene=imported();const html=renderToStaticMarkup(<SymmetryFormula scene={scene} onChange={()=>{}}/>);
  expect(html).toContain('Caller display: &lt;x&gt; &amp;');expect(html).toContain('自定义 GLSL 源码');expect(html).toContain('gain, delta');expect(html).toContain('使用模板公式');expect(html).not.toContain('data-symmetry-key');
  expect(html).toContain('<textarea');expect(html).toContain('验证并应用 GLSL');expect(html).toContain('草稿不会改变当前画面');
  expect(html).not.toContain('maxLength');expect(html).not.toContain('maxlength');
  const explore=renderToStaticMarkup(<ExplorePanel scene={scene} onChange={()=>{}}/>);expect(explore).toMatch(/class="apply-button" disabled=""/);expect(explore).toContain('不能使用内置模板');
  const builtin=withSymmetryTemplate(scene,'standard');expect(renderToStaticMarkup(<ExplorePanel scene={builtin} onChange={()=>{}}/>)).not.toMatch(/class="apply-button" disabled=""/);
 });
});
