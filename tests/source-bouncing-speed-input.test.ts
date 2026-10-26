import {describe,it,expect} from 'vitest';
import native from './fixtures/source-bouncing-speed-input/native.json';
import {parseProjectFile} from '../src/engine/legacyImport';
import {parseScene,serializeScene} from '../src/engine/document';
import {editSourceBouncingInitialSpeed,importSourceBouncingDocument,parseSourceBouncingDocument,sourceBouncingInitialSpeedInput,sourceBouncingInitializationKey} from '../src/engine/sourceBouncingDocument';
import {parseSourceNumberInput,bouncingNumberRules,SOURCE_FLOAT_MAX} from '../src/components/sourceBouncingNumbers';
import {generateSourceBouncingSeeds} from '../src/engine/sourceBouncingSeeds';

const bits=(value:number)=>new Uint32Array(new Float32Array([value]).buffer)[0].toString(16).padStart(8,'0');
const imported=(settings:Record<string,unknown>={})=>parseProjectFile(JSON.stringify({config_version:'1.0',type:'BOUNCING_PARTICLES',name:'Speed input',settings:{particle_count:4,...settings}})).scene;

describe('source Bouncing author speed and effective simulation speed',()=>{
 it('matches eight original parse/Float-wrapper/config results through local edit, public save and reopen',()=>{
  const rows=native.cases.filter(row=>row.kind==='original-helper-and-float-wrapper-to-diagnostic-json-sink');expect(rows).toHaveLength(8);
  for(const row of rows){
   const scene=imported(),parsed=parseSourceNumberInput(row.inputText!,bouncingNumberRules.initialSpeed);
   expect(parsed,row.inputText).not.toBeUndefined();
   const edited=editSourceBouncingInitialSpeed(scene.bouncingSource!,Math.fround(parsed!));if(!edited.ok)throw Error(edited.error.reason);
   scene.bouncingSource=edited.value;
   const reopened=parseScene(serializeScene(scene));
   expect(bits(sourceBouncingInitialSpeedInput(reopened.bouncingSource!)),row.inputText).toBe(row.callbackFloat!.bits);
   expect(bits(reopened.bouncingSource!.configuration.initialSpeed),row.inputText).toBe(row.canonicalInitialSpeed.bits);
   expect(reopened.bouncingSource).toEqual(scene.bouncingSource);
  }
 });
 it('keeps direct JsonConfig import semantics and finite pre-clamp input without re-reading provenance',()=>{
  const rows=native.cases.filter(row=>row.kind!=='original-helper-and-float-wrapper-to-diagnostic-json-sink');expect(rows).toHaveLength(8);
  for(const row of rows){
   const original=JSON.parse(row.authoredJson),scene=imported(original.settings),reopened=parseScene(serializeScene(scene));
   expect(bits(reopened.bouncingSource!.configuration.initialSpeed)).toBe(row.canonicalInitialSpeed.bits);
   if(row.authoredFloat)expect(bits(sourceBouncingInitialSpeedInput(reopened.bouncingSource!))).toBe(row.authoredFloat.bits);
   expect((reopened.provenance!.original as {settings:{initial_speed:unknown}}).settings.initial_speed).toEqual(original.settings.initial_speed);
  }
  // This is the established direct-render import route, not ProjectState's
  // getFloat(default) route, which would treat an expression as a literal error.
  expect(sourceBouncingInitialSpeedInput(imported({initial_speed:'100+1'}).bouncingSource!)).toBe(101);
  for(const initial_speed of ['1/0','1e100']){
   const result=importSourceBouncingDocument({settings:{initial_speed}});expect(result.ok).toBe(true);
   if(result.ok){expect(result.value.payload.configuration.initialSpeed).toBe(100);expect(result.value.payload.authoring).toBeUndefined();}
  }
 });
 it('resets identity for 101→102 while rendering exactly the effective speed100 seeds',()=>{
  const a=imported({initial_speed:101}).bouncingSource!,b=imported({initial_speed:102}).bouncingSource!,hundred=imported({initial_speed:100}).bouncingSource!;
  expect(sourceBouncingInitializationKey(a)).not.toBe(sourceBouncingInitializationKey(b));
  const seed=generateSourceBouncingSeeds(hundred.configuration);expect(seed.ok).toBe(true);
  for(const payload of [a,b])expect(generateSourceBouncingSeeds(payload.configuration)).toEqual(seed);
  expect(sourceBouncingInitializationKey({...a,visual:{...a.visual,dotSize:9},camera:{phi:1,theta:2,gamma:3},recordDuration:20})).toBe(sourceBouncingInitializationKey(a));
  expect(sourceBouncingInitializationKey({...hundred,authoring:{initialSpeed:100}})).toBe(sourceBouncingInitializationKey(hundred));
 });
 it('rejects inconsistent/nonfinite author data, and keeps legacy payloads and edits below100 valid',()=>{
  const old=imported({initial_speed:100}).bouncingSource!;
  for(const authoring of [null,undefined,{},[],{initialSpeed:101,extra:1},{initialSpeed:-1},{initialSpeed:NaN},{initialSpeed:Infinity},{initialSpeed:1e100},{initialSpeed:99}]){
   expect(parseSourceBouncingDocument({...old,authoring}).ok).toBe(false);
  }
  expect(parseSourceBouncingDocument(old)).toEqual({ok:true,value:old});
  const huge=editSourceBouncingInitialSpeed(old,SOURCE_FLOAT_MAX);if(!huge.ok)throw Error('huge');
  expect(sourceBouncingInitialSpeedInput(huge.value)).toBe(SOURCE_FLOAT_MAX);expect(huge.value.configuration.initialSpeed).toBe(100);
  const small=editSourceBouncingInitialSpeed(huge.value,.05);if(!small.ok)throw Error('small');
  expect(small.value.authoring).toBeUndefined();expect(small.value.configuration.initialSpeed).toBe(Math.fround(.05));
  for(const bad of [NaN,Infinity,'101',1e100])expect(editSourceBouncingInitialSpeed(huge.value,bad).ok).toBe(false);
  expect(huge.value.authoring).toEqual({initialSpeed:SOURCE_FLOAT_MAX});
 });
});
