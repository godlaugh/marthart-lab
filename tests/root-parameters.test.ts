import {describe,it,expect} from 'vitest';
import {generateScene} from '../src/engine/temporal';
import {createScene,parseScene} from '../src/engine/document';
import {parseLegacyScene} from '../src/engine/legacyImport';
import {defaultRootParameter,parseRootParameters,validateRootParameters,withRootParameters,normalizeRootParameter} from '../src/engine/rootParameters';
import {definitions,prepareRootSampling,updateRootParameters} from '../src/scenes/complex';
import {exploreComplex} from '../src/engine/complexExplore';
import {random} from '../src/engine/expression';
import {prepareRootsNativeSampling} from '../src/engine/rootsNativeSampling';
import {paletteColor} from '../src/engine/palette';
import type {RootParameter,SceneDocument} from '../src/types';
const definition=definitions.find(d=>d.kind==='roots')!,context={time:0,quality:'preview' as const,width:32,height:24};
const source=()=>createScene(definition);
const parameter=(name:string,patch:Partial<RootParameter>={}):RootParameter=>({...defaultRootParameter(name),...patch});
function configure(parameters:RootParameter[],formula='z-1'){const s=source();s.settings=withRootParameters(s.settings,parameters);s.equations.polynomial=formula;s.settings.sampleCount=32;return s;}
function positions(s:SceneDocument){const o=definition.generate(s,context);if(o.type!=='geometry')throw new Error('expected geometry');expect(o.stats.invalid).toBe(0);return o;}
const legacy=(root_parameters:unknown,extra:Record<string,unknown>={})=>parseLegacyScene(JSON.stringify({config_version:'1.0.0',type:'COMPLEX_ROOTS',name:'roots',parameters:{},polynomial:{variable:'z',coefficients:{1:'1',0:'-a'}},root_parameters,sampling:{sample_count:8,seed:17},...extra}));

describe('one normalized owner of independent root parameters',()=>{
 it('samples disjoint real and rectangular ranges independently with the actual polynomial evaluator',()=>{
  const s=configure([parameter('left',{domain:'REAL_RANGE',minRe:2,maxRe:3}),parameter('right',{domain:'COMPLEX_RECT',minRe:20,maxRe:30,minIm:-7,maxIm:-5}),parameter('t3',{domain:'FIXED',value:[.25,.5]})],'z-left-right-t3');
  const out=positions(s),sampling=prepareRootSampling(s.settings),rng=random(Number(s.settings.seed));
  for(let i=0;i<32;i++){const p=sampling.sample(rng);rng();expect(p.left[0]).toBeGreaterThanOrEqual(2);expect(p.left[0]).toBeLessThan(3);expect(p.left[1]).toBe(0);expect(p.right[0]).toBeGreaterThanOrEqual(20);expect(p.right[0]).toBeLessThan(30);expect(p.right[1]).toBeGreaterThanOrEqual(-7);expect(p.right[1]).toBeLessThan(-5);expect([...out.positions.slice(i*3,i*3+3)]).toEqual([Math.fround(p.left[0]+p.right[0]+.25),Math.fround(p.right[1]+.5),0]);}
 });
 it('supports more than three arbitrary names, custom natural-e override, and fixed values without consuming RNG',()=>{
  const s=configure(['alpha','beta_2','gamma','delta','e'].map((name,i)=>parameter(name,{domain:'FIXED',value:[i+1,i]})),'z-alpha-beta_2-gamma-delta-e');
  const sample=prepareRootSampling(s.settings).sample(()=>{throw new Error('fixed must not sample');});expect(Object.keys(sample)).toEqual(['alpha','beta_2','gamma','delta','e']);expect([...positions(s).positions.slice(0,3)]).toEqual([15,10,0]);
 });
 it('normalizes real and imaginary color metrics with the selected parameter own bounds and uses its imaginary depth',()=>{
  const s=configure([parameter('height',{domain:'COMPLEX_RECT',minRe:10,maxRe:20,minIm:30,maxIm:40})]);Object.assign(s.settings,{rootDisplayParameter:'height',rootRender:'DEPTH',rootColor:'t2_imag',depthScale:2});
  const o=positions(s),sampling=prepareRootSampling(s.settings),rng=random(Number(s.settings.seed));for(let i=0;i<o.positions.length;i+=3){const sampled=sampling.sample(rng);rng();expect(o.positions[i+2]).toBe(Math.fround(sampled.height[1]*2));expect([...o.colors!.slice(i,i+3)]).toEqual(paletteColor(s.palette,(sampled.height[1]-30)/10).map(Math.fround));}expect(new Set(o.colors).size).toBeGreaterThan(12);
  s.settings.rootDisplayParameter='missing';expect(()=>positions(s)).toThrow('不存在');
 });
 it('preserves old global bounds and inactive t3 deterministic sequence only when no explicit model exists',()=>{
  const s=source();Object.assign(s.settings,{domain1:'REAL_RANGE',domain2:'COMPLEX_RECT',rangeMin:5,rangeMax:8});
  const r=random(9),expected={t1:[5+r()*3,0],t2:[5+r()*3,5+r()*3],t3:[1,0]};expect(prepareRootSampling(s.settings).sample(random(9))).toEqual(expected);
  s.settings.rootParameters=JSON.stringify([parameter('new',{domain:'REAL_RANGE',minRe:100,maxRe:101})]);s.settings.rangeMin=500;s.settings.rangeMax=-500;expect(prepareRootSampling(s.settings).sample(()=>.5)).toEqual({new:[100.5,0]});
 });
 it('preserves complete domains through save/reload and removes stale aliases on explicit conversion',()=>{
  const s=configure([parameter('a',{domain:'COMPLEX_RECT',minRe:-11,maxRe:-9,minIm:40,maxIm:42,value:[7,8]})],'z-a');
  expect(s.settings.rangeMin).toBeUndefined();expect(s.settings.domain1).toBeUndefined();expect(parseRootParameters(parseScene(JSON.stringify(s)).settings)).toEqual(parseRootParameters(s.settings));expect(positions(parseScene(JSON.stringify(s))).positions).toEqual(positions(s).positions);
 });
 it('rejects malformed explicit models, conflicting names, invalid fields and reversed local bounds rather than reverting to globals',()=>{
  for(const raw of ['','{}','null','[',JSON.stringify([parameter('a'),parameter('a')]),JSON.stringify([parameter('pi')]),JSON.stringify([parameter('time')]),JSON.stringify([parameter('constructor')]),JSON.stringify([parameter('bad.name')]),JSON.stringify([parameter('a',{minIm:2,maxIm:1})]),JSON.stringify([{name:'a',domain:'FIXED'}])])expect(()=>parseRootParameters({rootParameters:raw})).toThrow();
  expect(()=>validateRootParameters([parameter('z')])).toThrow('变量');expect(()=>validateRootParameters([parameter('a')],'z',['a'])).toThrow('冲突');expect(()=>validateRootParameters([parameter('a',{minRe:Infinity})])).toThrow('有限');
 });
 it('does not overflow sampling or normalization for a finite interval whose difference exceeds Number.MAX_VALUE',()=>{
  const s=configure([parameter('wide',{domain:'REAL_RANGE',minRe:-1e308,maxRe:1e308})]);expect(prepareRootSampling(s.settings).sample(()=>.5).wide).toEqual([0,0]);expect(normalizeRootParameter(0,[-1e308,1e308])).toBe(.5);
 });
 it('validates explicit parameter data at the saved-document boundary and accepts no sampled factors for a fixed polynomial',()=>{
  const s=configure([]);expect(positions(parseScene(JSON.stringify(s))).stats.generated).toBe(32);s.settings.rootParameters='[{"name":"broken"}]';expect(()=>parseScene(JSON.stringify(s))).toThrow('采样域');
 });
});
describe('root parameter editor commits are atomic coefficient edits',()=>{
 it('renames symbols without touching function names, longer identifiers, or the input scene',()=>{
  const s=configure([parameter('sin',{domain:'FIXED',value:[2,0]}),parameter('sinus',{domain:'FIXED',value:[4,0]})],'z-sin-sinus-sin(pi/2)'),before=JSON.stringify(s);
  const p=parseRootParameters(s.settings);p[0].name='alpha';const next=updateRootParameters(s,p,new Map([['sin','alpha']]));expect(next.equations.polynomial).toContain('sin(pi / 2)');expect(next.equations.polynomial).toContain('sinus');expect(next.equations.polynomial).toContain('alpha');expect([...positions(next).positions.slice(0,3)]).toEqual([7,0,0]);expect(JSON.stringify(s)).toBe(before);
 });
 it('supports simultaneous swaps and refuses deletion while a coefficient references the parameter',()=>{
  const s=configure([parameter('a',{domain:'FIXED',value:[2,0]}),parameter('b',{domain:'FIXED',value:[3,0]})],'z-2*a-b'),p=parseRootParameters(s.settings);[p[0].name,p[1].name]=['b','a'];
  expect([...positions(updateRootParameters(s,p,new Map([['a','b'],['b','a']]))).positions.slice(0,3)]).toEqual([7,0,0]);expect(()=>updateRootParameters(s,[p[0]])).toThrow('未知变量');
 });
 it('explores named factors while retaining every parameter range and independent fixed value',()=>{
  const s=configure([parameter('alpha',{minRe:-2,maxRe:2}),parameter('beta',{minRe:-.6,maxRe:.6,minIm:3,maxIm:4,value:[8,9]}),parameter('unused',{domain:'FIXED',value:[20,30]})]);
  const a=exploreComplex(s,{kind:'roots',seed:99,maxDegree:10,termCount:4,parameterCount:2,parameterDomain:'MIXED',candidateCount:4,evaluationSamples:4});expect(a.status).toBe('found');expect(a.scene!.equations.polynomial).toContain('alpha');expect(a.scene!.equations.polynomial).toContain('beta');const p=parseRootParameters(a.scene!.settings);expect(p[1]).toMatchObject({name:'beta',domain:'REAL_RANGE',minRe:-.6,maxRe:.6,minIm:3,maxIm:4,value:[8,9]});expect(p[2]).toEqual(parseRootParameters(s.settings)[2]);expect(positions(a.scene!).stats.generated).toBeGreaterThan(0);
 });
});
describe('original independent-domain import',()=>{
 it('reads actual min/max, min_re/max_re/min_im/max_im and FIXED re/im without t1/t2 overwrites',()=>{
  const root_parameters={a:{domain:'REAL_RANGE',min:2,max:3},b:{domain:'COMPLEX_RECT',min_re:10,max_re:12,min_im:-4,max_im:-2},t3:{domain:'FIXED',re:.5,im:.75},last:{domain:'FIXED',re:3,im:-1}};
  const result=legacy(root_parameters,{polynomial:{variable:'z',coefficients:{1:'1',0:'-a-b-t3-last'}}});expect(result.source).toMatchObject({root_parameters});const p=new Map(result.scene.rootsMath!.parameters.map(p=>[p.name,p]));expect([...p.keys()].sort()).toEqual(['a','b','last','t3']);expect(p.get('a')).toMatchObject({minRe:2,maxRe:3});expect(p.get('b')).toMatchObject({minRe:10,maxRe:12,minIm:-4,maxIm:-2});expect(p.get('t3')!.value).toEqual([.5,.75]);expect(p.get('last')!.value).toEqual([3,-1]);
  const computation=parseScene(JSON.stringify(result.scene));expect(computation.rootsPresentation?.model).toBe('mathart-1.7.8-v1');
  // Keep the actual source-domain solver coverage in this Node test. Native
  // presentation is verified in the real-browser import/UI workflow, not by a
  // mocked GPU. This explicit local presentation choice leaves all 8 source
  // samples, parameters and coefficient expressions unchanged.
  computation.rootsPresentation={...computation.rootsPresentation!,model:'local-v1'};computation.settings.rootDensityBackend='cpu';
  const output=generateScene(computation,context);expect(output.stats.generated).toBe(8);if(output.type!=='raster')throw new Error('progressive source import');expect(output.roots).toMatchObject({attemptedSamples:8,acceptedPolynomials:8,complete:true});
 });
 it('uses source-derived domain defaults and preserves explicit zero fixed components',()=>{
  const result=legacy({a:{domain:'real_range'},b:{domain:'COMPLEX_RECT'},c:{domain:'FIXED'},t3:{domain:'FIXED',re:0,im:2},d:{}});const p=new Map(result.scene.rootsMath!.parameters.map(p=>[p.name,p]));expect(p.get('a')).toMatchObject({domain:'REAL_RANGE',minRe:-5,maxRe:5});expect(p.get('b')).toMatchObject({minRe:-1,maxRe:1,minIm:-1,maxIm:1});expect(p.get('c')!.value).toEqual([0,0]);expect(p.get('t3')!.value).toEqual([0,2]);expect(p.get('d')!.domain).toBe('UNIT_CIRCLE');
 });
 it('preserves reverse ranges and sorts only at the native sampling owner',()=>{
  const result=legacy({a:{domain:'COMPLEX_RECT',min_re:5,max_re:3,min_im:8,max_im:6}});const math=result.scene.rootsMath!;expect(math.parameters[0]).toMatchObject({minRe:5,maxRe:3,minIm:8,maxIm:6});const sampling=prepareRootsNativeSampling(math.parameters,math.sampling);expect(sampling.ok).toBe(true);if(sampling.ok){const sample=sampling.value.sampleAt(0);expect(sample.ok).toBe(true);if(sample.ok){const a=sample.value.values.get('a')!;expect(a[0]).toBeGreaterThanOrEqual(3);expect(a[0]).toBeLessThan(5);expect(a[1]).toBeGreaterThanOrEqual(6);expect(a[1]).toBeLessThan(8);}sampling.value.dispose();}expect((result.source as any).root_parameters.a.min_re).toBe(5);
 });
 it('keeps ignored value arrays and accepts source domain fallback and independent names',()=>{
  const result=legacy({a:{domain:'FIXED',re:2,im:3,value:[99,88],future:9}});expect(result.scene.rootsMath?.parameters[0].value).toEqual([2,3]);expect(result.warnings.join()).toContain('value');expect(result.warnings.join()).toContain('future');expect(legacy({a:{domain:'FUTURE'}}).scene.rootsMath?.parameters[0].domain).toBe('UNIT_CIRCLE');expect(legacy({z:{domain:'FIXED'}}).scene.rootsMath?.parameters[0].name).toBe('z');expect(legacy({a:{domain:'FIXED'}},{parameters:{a:1}}).scene.rootsMath?.parameters[0].name).toBe('a');
 });
});
