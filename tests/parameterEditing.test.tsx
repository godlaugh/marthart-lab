import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {createScene,parseScene,persistentScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {sceneAtTime,createAnimationTrack} from '../src/engine/timeline';
import {generateScene} from '../src/engine/temporal';
import {randomizeSamilaParameters,exploreSamila} from '../src/scenes/samila';
import {parameterEditingSpecs,readParameterEditing,parameterSamplingRanges,parameterAnimationSuggestion,parseParameterRanges,withParameterRange,withParameterValue,withoutEditableParameter,resetParameterRanges,sampleParameterRange,MAX_PARAMETER_RANGE_JSON} from '../src/engine/parameterEditing';
import {ParameterEditor} from '../src/components/ParameterEditor';
import type {SceneDocument,Settings} from '../src/types';
const doc=(kind:'symmetry'|'samila'='samila')=>createScene(definition(kind));
const metadata=(ranges:Record<string,unknown>)=>({parameterRanges:JSON.stringify({version:1,ranges})});
const bound={min:-2,max:4,step:.01};
describe('parameter editing metadata ownership',()=>{
 it('has fixed source symmetry bounds and exposes delta only for Modified',()=>{
  const s=doc('symmetry');s.settings.parameterRanges='malformed foreign field';const rows=parameterEditingSpecs(s);expect(rows.map(x=>x.name)).not.toContain('delta');
  for(const [name,limit]of Object.entries({lambda:3,alpha:3,beta:1.5,gamma:1,omega:1}))expect(rows.find(x=>x.name===name)).toMatchObject({range:{min:-limit,max:limit,step:.001},displayDecimals:3,canDelete:false,rangeSource:'fixed'});
  s.settings.template='modified';expect(parameterEditingSpecs(s).find(x=>x.name==='delta')?.range).toEqual({min:-1,max:1,step:.001});expect(()=>withParameterRange(s,'lambda',bound)).toThrow('固定');expect(()=>withoutEditableParameter(s,'lambda')).toThrow('不能删除');
 });
 it('keeps imported out-of-range values and full precision when editing bounds or serializing',()=>{
  let s=doc();s.parameters={a:123.456789,b:-9};const before=structuredClone(s);s=withParameterRange(s,'a',bound);expect(s.parameters).toEqual(before.parameters);expect(before.settings.parameterRanges).toBeUndefined();expect(parameterEditingSpecs(s).find(x=>x.name==='a')).toMatchObject({value:123.456789,range:bound});
  s=withParameterValue(s,'a',-1000.123456789);expect(s.parameters.a).toBe(-1000.123456789);expect(parseScene(JSON.stringify(persistentScene(s)))).toEqual(persistentScene(s));expect(parseParameterRanges(s.settings).a).toEqual(bound);
  const sy=withParameterValue(doc('symmetry'),'lambda',7.123456789);expect(sy.parameters.lambda).toBe(7.123456789);
 });
 it('rejects malformed, nonfinite, degenerate, unrepresentable and oversized metadata',()=>{
  const bad:Settings[]=[{parameterRanges:''},{parameterRanges:'[]'},{parameterRanges:'null'},{parameterRanges:4},{parameterRanges:'x'.repeat(MAX_PARAMETER_RANGE_JSON+1)},{parameterRanges:'{"version":2,"ranges":{}}'},{parameterRanges:'{"version":1,"ranges":{},"extra":1}'},metadata({a:{min:0,max:1}}),metadata({a:{...bound,foo:1}}),metadata({a:{min:1,max:1,step:1}}),metadata({a:{min:2,max:1,step:.1}}),metadata({a:{min:-1e308,max:1e308,step:1}}),metadata({a:{min:1e20,max:2e20,step:.001}}),metadata({a:{min:0,max:1,step:0}}),metadata({a:{min:0,max:1,step:2}}),metadata({constructor:bound}),metadata({x:bound}),metadata(Object.fromEntries(Array.from({length:129},(_,i)=>['p'+i,bound])))];
  for(const value of bad)expect(()=>parseParameterRanges(value)).toThrow();expect(()=>withParameterRange({...doc(),parameters:{a:1}},'a',{min:NaN,max:1,step:1})).toThrow();
 });
 it('preserves valid orphan metadata, removes only an explicitly deleted parameter range and resets only owned metadata',()=>{
  const s=doc();s.parameters={a:1,b:2};Object.assign(s.settings,metadata({a:bound,b:{min:0,max:3,step:.1},old:bound}),{foreign:'retained'});const out=withoutEditableParameter(s,'a');expect(out.parameters).toEqual({b:2});expect(Object.keys(parseParameterRanges(out.settings))).toEqual(['b','old']);expect(s.parameters.a).toBe(1);expect(parseParameterRanges(s.settings).a).toEqual(bound);
  const reset=resetParameterRanges(out);expect(reset.settings.parameterRanges).toBeUndefined();expect(reset.settings.foreign).toBe('retained');expect(reset.parameters).toEqual(out.parameters);expect(reset.timeline).toBe(out.timeline);
 });
 it('keeps malformed optional metadata out of real scene generation and provides an explicit editor recovery path',()=>{
  const s=doc();s.settings.parameterRanges='invalid';s.settings.count=40;const state=readParameterEditing(s);expect(state.error).toContain('JSON');expect(state.specs.every(x=>!x.range)).toBe(true);expect(()=>parameterSamplingRanges(s)).toThrow();expect(()=>parameterAnimationSuggestion(s,'parameters.a')).toThrow();
  const withBad=generateScene(s,{time:0,width:40,height:30,quality:'preview'}),without=generateScene(resetParameterRanges(s),{time:0,width:40,height:30,quality:'preview'});expect(withBad.type).toBe('geometry');expect(withBad).toMatchObject({type:without.type,stats:{samples:without.stats.samples,generated:without.stats.generated,invalid:without.stats.invalid}});if(withBad.type==='geometry'&&without.type==='geometry')expect(withBad.positions).toEqual(without.positions);
 });
 it('does not interpret a same-named setting on unrelated families or mutate authored animation ranges',()=>{
  const other=createScene(definition('map'));other.settings.parameterRanges='foreign';expect(parameterEditingSpecs(other)).toEqual([]);expect(parameterSamplingRanges(other)).toEqual({});expect(parameterAnimationSuggestion(other,'parameters.a')).toBeUndefined();expect(()=>withParameterValue(other,'a',2)).toThrow();
  let s=doc();s.parameters={a:1};s.timeline.tracks=[{id:'osc',type:'param',target:'parameters.a',from:0,to:1,start:0,duration:5,easing:'linear',enabled:true,pingPong:false,parameterClock:'elapsed',parameterAnimations:[{target:'parameters.a',min:50,max:70,step:.7,enabled:true}]}];const at=sceneAtTime(s,1).parameters.a,track=structuredClone(s.timeline.tracks);s=withParameterRange(s,'a',bound);expect(parameterAnimationSuggestion(s,'parameters.a')).toEqual({min:-2,max:4});expect(parameterAnimationSuggestion(s,'palette.offset')).toBeUndefined();expect(parameterAnimationSuggestion(s,'parameters.a.extra')).toBeUndefined();expect(s.timeline.tracks).toEqual(track);expect(sceneAtTime(s,1).parameters.a).toBe(at);expect(at).toBeGreaterThan(4);
 });
 it('samples custom intervals deterministically without quantizing tiny intervals, while preserving old two-argument exploration',()=>{
  let s=doc();s.parameters={a:100,b:-100,arcsin:2};s=withParameterRange(s,'a',{min:1e-9,max:2e-9,step:1e-11});s=withParameterRange(s,'b',{min:-5,max:-4,step:.1});const ranges=parameterSamplingRanges(s),original={...s.parameters};
  const a=randomizeSamilaParameters(s.parameters,42,ranges);expect(a).toEqual(randomizeSamilaParameters(s.parameters,42,ranges));expect(a).not.toEqual(randomizeSamilaParameters(s.parameters,43,ranges));expect(a.a).toBeGreaterThanOrEqual(1e-9);expect(a.a).toBeLessThanOrEqual(2e-9);expect(a.b).toBeGreaterThanOrEqual(-5);expect(a.b).toBeLessThanOrEqual(-4);expect(a.arcsin).toBeGreaterThanOrEqual(-3);expect(s.parameters).toEqual(original);
  expect(Object.values(randomizeSamilaParameters(s.parameters,42)).every(v=>v>=.1&&v<=2.5)).toBe(true);expect(Object.values(exploreSamila(42,{candidates:2}).parameters).every(v=>v>=.1&&v<=2.5)).toBe(true);
  expect(sampleParameterRange(bound,0)).toBe(-2);expect(sampleParameterRange(bound,1)).toBe(4);expect(()=>sampleParameterRange(bound,NaN)).toThrow();expect(()=>sampleParameterRange(bound,-.1)).toThrow();
 });
 it('uses shared bounds only when creating real parameter tracks and preserves authored tracks through reload',()=>{
  let s=doc();s.parameters={a:120};s=withParameterRange(s,'a',bound);
  const created=createAnimationTrack(s,'param');expect(created.parameterAnimations).toEqual([{target:'parameters.a',min:-2,max:4,step:1,enabled:true}]);
  created.parameterAnimations![0]={target:'parameters.a',min:50,max:70,step:.7,enabled:true};s.timeline.tracks=[created];
  const edited=withParameterRange(s,'a',{min:-100,max:-50,step:.5}),saved=parseScene(JSON.stringify(persistentScene(edited)));
  expect(saved.timeline.tracks[0].parameterAnimations).toEqual(created.parameterAnimations);expect(sceneAtTime(saved,1).parameters.a).toBe(sceneAtTime(s,1).parameters.a);expect(createAnimationTrack(saved,'param').parameterAnimations?.[0]).toMatchObject({min:-100,max:-50,step:1});
  expect(createAnimationTrack(doc('symmetry'),'param').parameterAnimations?.[0]).toMatchObject({target:'parameters.lambda',min:-3,max:3});
  const invalid=doc();invalid.settings.parameterRanges='bad';expect(()=>createAnimationTrack(invalid,'param')).toThrow('JSON');
 });
 it('does not admit invalid values or unknown parameter keys',()=>{
  for(const v of [NaN,Infinity,-Infinity])expect(()=>withParameterValue(doc(),'a',v)).toThrow();expect(()=>withParameterValue(doc(),'missing',1)).toThrow();expect(()=>withoutEditableParameter(doc(),'missing')).toThrow();expect(()=>resetParameterRanges(doc('symmetry'))).toThrow();
 });
});
describe('parameter slider render contract',()=>{
 const html=(s:SceneDocument)=>renderToStaticMarkup(<ParameterEditor scene={s} onChange={()=>{}}/>);
 it('preserves formula focus IDs, three-decimal Symmetry display and out-of-range stored values',()=>{
  const s=doc('symmetry');s.parameters.lambda=7.123456789;const output=html(s);expect(output).toContain('id="param-lambda"');expect(output).toContain('value="7.123"');expect(output).toContain('title="7.123456789"');expect(output).toContain('type="range"');expect(output).toContain('step="0.001"');expect(output).toContain('当前值 7.123456789 超出滑块范围');expect(output).not.toContain('删除参数 lambda');expect(output).not.toContain('编辑参数范围');
 });
 it('exposes editable Samila ranges and malformed metadata repair without inventing controls for Roots',()=>{
  expect(html(doc())).toContain('应用参数范围');const bad=doc();bad.settings.parameterRanges='bad';const output=html(bad);expect(output).toContain('role="alert"');expect(output).toContain('重置编辑范围');expect(output).not.toContain('type="range"');expect(html(createScene(definition('roots')))).toBe('');
 });
});
