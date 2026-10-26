import {describe,it,expect} from 'vitest';
import {definition} from '../src/scenes';
import {createScene,parseScene,persistentScene} from '../src/engine/document';
import {parseProjectFile} from '../src/engine/legacyImport';
import {parseDomainModel,domainEvaluator} from '../src/engine/domainModel';
import {sceneAtTime} from '../src/engine/timeline';
import recipes from '../src/scenes/domainExamples.recipes.json';
import type {SceneDocument} from '../src/types';
const def=definition('domain');
const preset=(n:number)=>def.presets.find(p=>p.id===`guide-domain-${n}`)!;
function persistentContent(scene:SceneDocument){
 const copy=structuredClone(persistentScene(scene));delete copy.provenance?.reference;
 copy.provenance!.warnings=copy.provenance!.warnings.filter(w=>!recipes.some(r=>r.reference.assumptions.some(a=>a===w)));
 copy.timeline.tracks.forEach((track,i)=>{track.id=`track-${i}`;track.actions?.forEach((a,j)=>{a.id=`action-${j}`;});});
 const {id,name,description,kind,favorite,...content}=copy;void id;void name;void description;void kind;void favorite;return content;
}
describe('complete guide Domain examples',()=>{
 it('exposes eight distinct guide recipes while retaining all six local preset identities',()=>{
  expect(def.presets.filter(p=>p.id.startsWith('guide-domain-')).map(p=>p.id)).toEqual(Array.from({length:8},(_,i)=>`guide-domain-${i+1}`));
  expect(def.presets.filter(p=>!p.id.startsWith('guide-domain-')).map(p=>p.id)).toEqual(['cubic','sine-ratio','complex-power','newton-domain','sine-iteration','essential']);
 });
 it.each(recipes)('binds generated $id to the current production import owner and preserves every persistent authored field',recipe=>{
  const actual=createScene(def,def.presets.find(p=>p.id===recipe.id)),expected=parseProjectFile(JSON.stringify(recipe.config)).scene;
  expect(persistentContent(actual)).toEqual(persistentContent(expected));
  expect(actual.provenance?.original).toEqual(recipe.config);
  expect(actual.provenance?.reference).toEqual(recipe.reference);
  expect(parseScene(JSON.stringify(actual))).toEqual(actual);
 });
 it.each([
  [1,'z^3 - 1',.8,20,17],[2,'sin(z-i)/sin(z+i)',.3,4,16],[3,'sin(z-1)/sin(z+t i)',.6,4.5,13.5],
  [4,'z^(a+3i)',2.6,4.5,13.5],[5,'z',.5,13,7],[6,'z',.5,10,6],[7,'z',1.2000000476837158,9,5],
  [8,'((z^2 - 1)(z - 2 - i)^2) / (z^2 + 2 + 2i)',.3,5,18],
 ] as const)('retains independently transcribed guide input %i', (n,f,scale,phase,mod)=>{
  const scene=createScene(def,preset(n));expect(scene.equations.f).toBe(f);expect(scene.settings).toMatchObject({scale,phaseDensity:phase,modDensity:mod,domainIterationVersion:'mathart-1.7.8-gpu',domainViewportVersion:'mathart-1.7.8-gpu',domainColorVersion:'mathart-1.7.8-gpu'});
  if([1,2,3,4,8].includes(n)){expect(scene.equations.next).toBe('');expect(scene.settings.iterationEnabled).toBe(false);}
 });
 it('uses the source project seven-color default without inventing t/a parameters or a dormant next',()=>{
  const s=createScene(def,preset(1));expect(s.parameters).toEqual({});expect(s.equations.next).toBe('');expect(s.domainSourcePalette?.colors).toEqual(['#FC6255','#FF862F','#FFFF00','#59743E','#83C167','#1D4A81','#9A72AC']);
  const cpu={...s,settings:{...s.settings,domainIterationVersion:'mathart-1.7.8-cpu'}};
  const value=domainEvaluator(parseDomainModel(cpu,0))([2,0]);expect(value[0]).toBeCloseTo(7,12);expect(value[1]).toBeCloseTo(0,12);
 });
 it('keeps the published Newton-labelled map and the real packaged seed/step fields',()=>{
  const fifth=createScene(def,preset(5)),sixth=createScene(def,preset(6)),seventh=createScene(def,preset(7));
  expect(fifth.equations.next).toBe('(w^3-1)/(3*w^2) + c');expect(fifth.description).toContain('不是标准牛顿');
  expect(fifth.settings).toMatchObject({seedMode:'CONSTANT_C',iterationSteps:8});
  expect(sixth.equations.next).toBe('sin(w)cos(w)/(1+w)');expect(sixth.settings).toMatchObject({seedMode:'PIXEL_Z',iterationSteps:45,centerX:-.5,bailout:64});
  expect(seventh.equations.next).toBe('sin(w +z^2)');expect(seventh.settings).toMatchObject({seedMode:'ZERO',iterationSteps:27,bailout:1024});
  expect([fifth,sixth,seventh].map(s=>s.domainSourcePalette?.colors.length)).toEqual([16,7,7]);
 });
 it.each([[3,'t',.95,2,-2],[4,'a',1,1,3]] as const)('retains raw oscillator endpoints and animates example %i', (n,key,initial,min,max)=>{
  const scene=createScene(def,preset(n));expect(scene.parameters[key]).toBe(initial);
  const parameter=scene.timeline.tracks[0].actions![0].domainParameters![0];expect(parameter).toMatchObject({model:'domain-registry-1.7.8',scope:{kind:'named',name:key},configuration:{min,max,step:.02}});
  expect(scene.timeline.duration).toBe(20);const later=sceneAtTime(scene,2);expect(later.parameters[key]).not.toBe(initial);expect(later.parameters[key]).toBeGreaterThanOrEqual(Math.min(min,max));expect(later.parameters[key]).toBeLessThanOrEqual(Math.max(min,max));
  expect(sceneAtTime(parseScene(JSON.stringify(scene)),2)).toEqual(later);
 });
 it('isolates full document templates from each draft and rejects mixed initialization ownership',()=>{
  const p=preset(5),first=createScene(def,p),other=createScene(def,p);first.parameters.a=100;first.domainSourcePalette!.colors[0]='#ffffff';first.timeline.tracks[0].duration=42;first.provenance!.warnings.push('changed');
  expect(createScene(def,p)).toEqual(other);expect(()=>createScene(def,{...p,parameters:{a:1}})).toThrow('完整示例不能');
 });
});
