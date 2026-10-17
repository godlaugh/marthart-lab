import {describe,it,expect} from 'vitest';
import savedDocuments from './fixtures/domain-parameter-v1596.json';
import {parseScene,persistentScene,createScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {sceneAtTime} from '../src/engine/timeline';
import {prepareParameterOscillation} from '../src/engine/oscillation';
import {domainBackendControl,parseDomainModel} from '../src/engine/domainModel';
import {translate} from '../src/i18n';

const start=(min:number,max:number,step:number)=>({type:'animate',duration:0,easing:'LINEAR',actions:[{method:'paramStart',args:[{edgeEasing:{window:.5,floor:1,easing:'LINEAR'},parameters:{a:{min,max,step,enable:true}}}]}]});
const wait=(duration:number)=>({type:'wait',duration});
const original=(min:number,max:number,step:number,initial=0,timeline:unknown[]=[start(min,max,step),wait(4)])=>({config_version:'1.0.0',type:'DOMAIN_COLORING',name:'Raw reversed interval',parameters:{a:initial},domainColoring:{formula:'z+a'},timeline});
// These are actual saved outputs captured before the registry-model migration.
// Keep the old epoch/rate goldens; new source imports have separate contracts.
const stored=new Map(savedDocuments.records.map(record=>[JSON.stringify(record.input),record.result]));
const read=(raw:unknown)=>{
 const result=stored.get(JSON.stringify(raw));if(!result)throw new Error('Missing frozen1596 document fixture');
 return{...result,scene:parseScene(JSON.stringify(result.scene))};
};
// Independent scalar source formula with neutral edge easing, at the local
// deterministic reference clock. No source JVM or realtime-frame claim.
function expected(min:number,max:number,step:number,initial:number,seconds:number){
 min=Math.fround(min);max=Math.fround(max);step=Math.fround(step);
 const lower=Math.min(min,max),upper=Math.max(min,max);if(upper-lower<=1e-6)return lower;
 const middle=(lower+upper)*.5,radius=(upper-lower)*.5;
 const value=initial<lower||initial>upper?(step<0?upper:lower):initial;
 const a=Math.asin(Math.max(-1,Math.min(1,(value-middle)/radius))),phase=step<0?Math.PI-a:a;
 return middle+radius*Math.sin(phase+Math.abs(step)*60/radius*seconds);
}

describe('saved1596 Domain parameter range model compatibility',()=>{
 it.each([.02,-.02,0])('retains saved raw reversed endpoints and signed step %s through reload and cold/warm seek',step=>{
  const raw=original(2,-2,step),imported=read(raw),scene=imported.scene,before=JSON.stringify(scene);
  const p=scene.timeline.tracks[0].actions![0].parameters![0];expect(p).toMatchObject({model:'domain-1.7.8',min:2,max:-2,step});expect(p.phase).toBeUndefined();expect(imported.scene.provenance?.original).toEqual(raw);
  const restored=parseScene(JSON.stringify(persistentScene(scene))),ascending=read(original(-2,2,step)).scene;
  for(const t of [0,.3,4,1,.5,2,1/60]){
   const value=sceneAtTime(scene,t).parameters.a;expect(value).toBeCloseTo(expected(2,-2,step,0,t),11);
   expect(sceneAtTime(restored,t).parameters.a).toBe(value);expect(sceneAtTime(ascending,t).parameters.a).toBe(value);
   expect(value).toBeGreaterThanOrEqual(-2);expect(value).toBeLessThanOrEqual(2);
  }
  expect(JSON.stringify(scene)).toBe(before);expect(restored.timeline.tracks[0].actions![0].parameters![0]).toEqual(p);
 });
 it.each([[8,.02,-2],[-8,.02,-2],[8,-.02,2],[-8,-.02,2]] as const)('chooses the source starting endpoint for out-of-range value %s and step %s', (initial,step,endpoint)=>{
  const scene=read(original(2,-2,step,initial)).scene;expect(sceneAtTime(scene,0).parameters.a).toBeCloseTo(endpoint,12);expect(sceneAtTime(scene,1).parameters.a).toBeCloseTo(expected(2,-2,step,initial,1),11);
 });
 it('uses the lower sorted endpoint for equal and source-degenerate spans',()=>{
  for(const [min,max] of [[2,2],[2+2**-22,2],[2,2+2**-22]]){
   const scene=read(original(min,max,-.02,9)).scene;
   for(const t of [0,.5,4])expect(sceneAtTime(scene,t).parameters.a).toBe(2);
  }
 });
 it('matches independent fixed-60Hz source edge goldens for the guide demonstration ranges',()=>{
  for(const [min,max,initial,values] of [
   [2,-2,.95,[0.9499999999999996,0.4629790041682934,-1.640906324635904,-1.9243806690238712]],
   [1,3,1,[1,1.6165984510392197,2.8740137939493953,1.753900496945339]],
  ] as const){
   const raw=original(min,max,.02,initial,[{type:'animate',duration:0,easing:'LINEAR',actions:[{method:'paramStart',args:[{parameters:{a:{min,max,step:.02,enable:true}}}]}]},wait(20)]),scene=read(raw).scene;
   for(const [i,time] of [0,5,10,20].entries())expect(sceneAtTime(scene,time).parameters.a).toBeCloseTo(values[i],12);
  }
 });
 it('captures the actual value at a restarted action, freezes at stop and reproduces backward seeks',()=>{
  const stop={type:'animate',duration:0,easing:'LINEAR',actions:[{method:'paramStop',args:[]}]};
  const scene=read(original(2,-2,.02,0,[start(2,-2,.02),wait(1),stop,wait(1),start(2,-2,-.02),wait(2)])).scene;
  const held=expected(2,-2,.02,0,1);expect(sceneAtTime(scene,1).parameters.a).toBeCloseTo(held,11);expect(sceneAtTime(scene,1.9).parameters.a).toBeCloseTo(held,11);
  for(const t of [3,2,4,2.5,1,3])expect(sceneAtTime(scene,t).parameters.a).toBeCloseTo(t<2?held:expected(2,-2,-.02,held,t-2),11);
 });
 it('owns validation, does not silently migrate old ranges, and rejects another scene or a second phase interpretation',()=>{
  const scene=read(original(2,-2,.02)).scene,p=scene.timeline.tracks[0].actions![0].parameters![0];
  const old=structuredClone(scene);delete old.timeline.tracks[0].actions![0].parameters![0].model;expect(()=>parseScene(JSON.stringify(old))).toThrow('范围');
  const foreign=createScene(definition('surface'));foreign.timeline=scene.timeline;expect(()=>parseScene(JSON.stringify(foreign))).toThrow('仅适用于域着色');
  for(const bad of [{...p,phase:0},{...p,model:'future'},{...p,min:Infinity},{...p,step:NaN}])expect(()=>prepareParameterOscillation(bad as typeof p,0)).toThrow();
  expect(()=>prepareParameterOscillation({...p,min:-Number.MAX_VALUE,max:Number.MAX_VALUE},0)).toThrow('可表示');
  expect(()=>prepareParameterOscillation({...p,step:1e40},0)).toThrow('可表示');
  const rounded=prepareParameterOscillation({...p,min:100,max:100.000001,step:.02},101);expect(rounded).toMatchObject({minimum:100,maximum:100,half:0,rate:0});
  expect(prepareParameterOscillation(p,0).rate).toBe(Math.fround(.02)*60/2);
  expect(p.min).toBe(2);expect(p.max).toBe(-2);
 });
 it('forces source start/stop lifecycle endpoints for an easing whose endpoint is zero',()=>{
  const initial=start(-2,2,.0001);initial.duration=1;initial.easing='THERE_AND_BACK';
  const stop={type:'animate',duration:1,easing:'THERE_AND_BACK',actions:[{method:'paramStop',args:[]}]};
  const scene=read(original(-2,2,.0001,0,[initial,wait(1),stop,wait(2)])).scene;
  const phase=(time:number)=>Math.asin(sceneAtTime(scene,time).parameters.a/2),rate=Math.fround(.0001)*60/2;
  expect(phase(1)).toBeCloseTo(rate*.5,10);expect(phase(2)-phase(1)).toBeCloseTo(rate,10);
  expect(phase(3)).toBeCloseTo(rate*2,10);expect(phase(5)).toBe(phase(3));
 });
 it('allows source stepScale overshoot and keeps the last enabled same-clip start',()=>{
  const initial=start(-2,2,.0001);initial.duration=1;initial.easing='BACK_OUT';
  const scene=read(original(-2,2,.0001,0,[initial,wait(1)])).scene,phase=Math.asin(sceneAtTime(scene,1).parameters.a/2),rate=Math.fround(.0001)*60/2;
  const area=1-2.70158/4+1.70158/3;expect(phase/rate).toBeCloseTo(area,6);
  const phaseAt=(t:number)=>Math.asin(sceneAtTime(scene,t).parameters.a/2);
  expect(phaseAt(.8)-phaseAt(.6)).toBeGreaterThan(rate*.2);
  const raw=original(2,-2,.02),first=start(2,-2,.01).actions[0],last=start(2,-2,-.03).actions[0];
  raw.timeline=[{type:'animate',duration:0,easing:'LINEAR',actions:[first,last,{...first,enabled:false}]},wait(3)];
  const conflict=read(raw).scene;expect(sceneAtTime(conflict,2).parameters.a).toBeCloseTo(expected(2,-2,-.03,0,2),11);
 });
 it('captures one pre-update startup value for every source start in the same action group',()=>{
  const first=start(-2,2,.02).actions[0],last=start(-3,3,-.02).actions[0];
  const scene=read(original(-2,2,.02,8,[{type:'animate',duration:0,easing:'LINEAR',actions:[first,last]},wait(2)])).scene;
  for(const time of [0,1,2,1])expect(sceneAtTime(scene,time).parameters.a).toBeCloseTo(expected(-3,3,-.02,8,time),11);
  const restored=parseScene(JSON.stringify(scene));expect(sceneAtTime(restored,1).parameters.a).toBe(sceneAtTime(scene,1).parameters.a);
  // Old untagged documents retain their previous serial synthetic-start rule.
  const old=structuredClone(scene);for(const action of old.timeline.tracks[0].actions!)for(const p of action.parameters!){delete p.model;p.step=.1;}
  expect(sceneAtTime(old,0).parameters.a).toBeCloseTo(2,12);
 });
 it('retains the prior radians-per-second model arithmetic for ordinary saved tracks',()=>{
  const p={min:-2,max:2,step:.6,phase:.3};const facts=prepareParameterOscillation(p,1);
  expect(facts).toEqual({minimum:-2,maximum:2,middle:0,half:2,phase:.3,rate:.6});
  const scene=read(original(-2,2,.02)).scene;scene.timeline.tracks[0].actions![0].parameters=[{target:'parameters.a',enabled:true,...p}];
  for(const t of [0,.2,1,3])expect(sceneAtTime(scene,t).parameters.a).toBe(2*Math.sin(.3+.6*t));
 });
});

describe('Domain backend wording follows execution policy',()=>{
 it('does not call every CPU backend double precision or every multistep path a fallback',()=>{
  expect(domainBackendControl.options?.find(o=>o.value==='cpu')?.label).toBe('CPU · 按所选公式规则');
  expect(domainBackendControl.help).toContain('分阶段 float32');expect(domainBackendControl.help).toContain('原产物 GPU 公式支持 GPU 多步');
  for(const text of [domainBackendControl.help!,...domainBackendControl.options!.map(o=>o.label)])expect(translate('en',text)).not.toBe(text);
  const scene=read(original(-2,2,.02)).scene;scene.settings.domainBackend='cpu';expect(parseDomainModel(scene,0).execution.arithmetic).toBe('native-gpu');
 });
});
