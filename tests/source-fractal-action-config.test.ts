import {describe,it,expect} from 'vitest';
import fixture from './fixtures/source-fractal-actions/source.json';
import {importSourceFractalActions,parseSourceFractalFloatField,SOURCE_FRACTAL_ACTION_LIMITS} from '../src/engine/sourceFractalActionConfig';
import {prepareRootsSourceMemberOrder} from '../src/engine/rootsSourceOrder';
import {lookupSourceEasing} from '../src/engine/sourceEasing';

function parse(actions:unknown,globalEdgeEasing?:unknown){return importSourceFractalActions(actions,{globalEdgeEasing,memberOrder:path=>{
 let raw:any=actions;for(const key of path)raw=raw[key];const order=prepareRootsSourceMemberOrder(Object.keys(raw));if(!order.ok)throw Error('bad fixture order');return order.value.keys;
}});}
function canonical(native:any){
 const children=native.kind==='group'?native.children:[native],ordinary=children.find((c:any)=>c.kind==='ordinary').targets,t:any={};
 const fields:Record<string,string>={targetZoom:'zoom',targetRotation:'rotation',targetRotationRate:'rotationRate',targetIterations:'iterations',targetBailout:'bailout'};
 for(const [source,key]of Object.entries(fields))if(ordinary[source]!==null)t[key]=ordinary[source];
 if(ordinary.targetCenterX!==null)t.center=[ordinary.targetCenterX,ordinary.targetCenterY];
 if(ordinary.targetJuliaX!==null)t.julia=[ordinary.targetJuliaX,ordinary.targetJuliaY];
 if(ordinary.targetAmbientPhiRate!==null)t.ambientRates=[ordinary.targetAmbientPhiRate,ordinary.targetAmbientThetaRate,ordinary.targetAmbientGammaRate];
 const parameters=children.filter((c:any)=>c.kind==='paramStart'||c.kind==='paramStop').map((c:any)=>({kind:c.kind==='paramStart'?'start':'stop',scope:c.name===null?{kind:'all'}:{kind:'named',name:c.name},...(c.kind==='paramStart'&&c.name!==null?{configuration:{step:c.step,min:c.min,max:c.max,edgeEasing:{window:c.edge.window,floor:c.edge.floor,easing:lookupSourceEasing(c.edge.easing)}}}:{})}));
 const g=children.find((c:any)=>c.kind==='gradientStart'||c.kind==='gradientStop'),gradient=g?g.kind==='gradientStop'?{kind:'stop'}:{kind:'start',config:{mode:g.mode.toLowerCase(),interpolation:g.interpolation.toLowerCase(),speed:g.speed,affectInside:g.inside,affectOutside:g.outside}}:undefined;
 return{targets:t,parameters,...(gradient?{gradient}:{})};
}
describe('original Fractal setupTimeline action parser',()=>{
 for(const item of fixture.cases)it(item.input.id,()=>{
  const result=parse(item.input.actions,(item.input as any).globalEdgeEasing);
  if('error'in item.native||item.input.id==='nonfinite'){expect(result.ok).toBe(false);return;}
  expect(result.ok).toBe(true);if(!result.ok)return;const {targets,parameters,gradient}=result.value;
  expect({targets,parameters,...(gradient?{gradient}:{})}).toEqual(canonical(item.native));
 });
 it('owns exact consumed paths without consuming disabled aliases or extra slots',()=>{
  const actions=[{method:'ambient',args:[.1,.9],enabled:false},{method:'paramStart',args:{parameters:{'a.b':{enabled:false,step:.2,enable:true},skip:{enable:false,min:9}}}},{method:'gradientStart',args:{targetDomain:'OTHER',mode:'cross_fade',speed:40}}];
  const result=parse(actions);expect(result.ok).toBe(true);if(!result.ok)return;
  expect(result.value.numericPaths).toContainEqual(['0','args','0']);expect(result.value.numericPaths).not.toContainEqual(['0','args','1']);
  expect(result.value.consumedPaths).toContainEqual(['1','args','parameters','a.b','step']);
  expect(result.value.consumedPaths).not.toContainEqual(['1','args','parameters','a.b','enabled']);
  expect(result.value.consumedPaths).not.toContainEqual(['1','args','parameters','skip','min']);
  expect(result.value.consumedPaths).not.toContainEqual(['2','args','targetDomain']);
 });
 it('keeps global and per-action provenance separate',()=>{
  const result=parse([{method:'paramStart',args:{parameters:{a:{}}}}],{window:.75,easing:'LINEAR',extra:4});expect(result.ok).toBe(true);if(!result.ok)return;
  expect(result.value.globalConsumedPaths).toEqual([['window'],['easing']]);expect(result.value.globalNumericPaths).toEqual([['window']]);expect(result.value.parameters[0]).toMatchObject({configuration:{edgeEasing:{window:.75,floor:.25,easing:'linear'}}});
 });
 it('does not guess missing native key order',()=>{
  const actions=[{method:'paramStart',args:{parameters:{z:{},a:{}}}}];const result=importSourceFractalActions(actions);expect(result).toMatchObject({ok:false,error:{kind:'input',path:['0','args','parameters']}});
  const wrong=importSourceFractalActions(actions,{memberOrder:()=>['a','a']});expect(wrong.ok).toBe(false);
 });
 it('preserves exact unusual parameter names and caller-resolved order',()=>{
  const actions=JSON.parse('[{"method":"paramStart","args":{"parameters":{"__proto__":{},"a.b":{},"":{}}}}]');
  const result=importSourceFractalActions(actions,{memberOrder:()=>['','__proto__','a.b']});expect(result.ok).toBe(true);if(!result.ok)return;expect(result.value.parameters.map(p=>p.scope)).toEqual([{kind:'named',name:''},{kind:'named',name:'__proto__'},{kind:'named',name:'a.b'}]);
 });
 it('accepts absent actions without inventing output and rejects malformed ingress',()=>{
  expect(importSourceFractalActions(undefined)).toMatchObject({ok:true,value:{targets:{},parameters:[]}});
  for(const actions of [null,{},[null],[{method:null}]])expect(importSourceFractalActions(actions).ok).toBe(false);
 });
 it('returns bounded failures before producing an oversized action list',()=>{
  expect(importSourceFractalActions(Array(SOURCE_FRACTAL_ACTION_LIMITS.actions+1).fill({method:'stopAmbient'}))).toMatchObject({ok:false,error:{kind:'capacity'}});
  expect(parse([{method:'rotation',args:['1'.repeat(65537)]}])).toMatchObject({ok:false,error:{kind:'capacity'}});
 });
});

describe('shared Fractal getJsonFloat field boundary',()=>{
 const value=(raw:unknown,fallback=4)=>{const r=parseSourceFractalFloatField(raw,fallback);if(!r.ok)throw Error(r.error.reason);return r.value.value;};
 it('preserves nonfinite for caller-specific duration/key rules',()=>{
  expect(value('NaN')).toBeNaN();expect(value('Infinity')).toBe(Infinity);expect(value('1/0')).toBe(Infinity);
  expect(value(undefined)).toBe(4);expect(value(null)).toBe(0);expect(value('invalid')).toBe(0);
 });
 for(const [index,t]of fixture.timing.entries())it(`original target timing ${index}`,()=>{
  const input:any=t.input,duration=Math.max(Math.fround(1e-4),value(input.duration));
  const expected=t.native.duration==='NaN'?NaN:t.native.duration==='Infinity'?Infinity:t.native.duration;
  expect(duration).toBe(expected);
  let selected:any;for(const key of input.keys??[]){if(!selected||value(key.time,0)>=value(selected.time,0))selected=key;}
  expect(selected?.zoom??input.zoom).toBe(t.native.targetZoom);
 });
});
