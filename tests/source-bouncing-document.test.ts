import {describe,it,expect} from 'vitest';
import {importSourceBouncingDocument,parseSourceBouncingDocument,prepareSourceBouncingScene,sourceBouncingCameraInput,usesSourceBouncing,type SourceBouncingDocumentPayload} from '../src/engine/sourceBouncingDocument';
import {resolveSourceCamera} from '../src/engine/sourceCamera';
const F=Math.fround;
function imported(raw:unknown={}){const r=importSourceBouncingDocument(raw);if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;}
const scene=(bouncingSource:SourceBouncingDocumentPayload=imported().payload)=>({kind:'bouncing',bouncingSource,settings:{},equations:{},parameters:{},timeline:{duration:10,fps:30,tracks:[]}});

describe('source Bouncing document boundary',()=>{
 it('composes existing owners with all-zero native camera and10second default, without activating timeline',()=>{
  const r=imported({timeline:[{type:'param',duration:null,args:{bad:1}}],animations:'ignored',parameters:{a:'bad'}});
  expect(r.payload).toMatchObject({configuration:{particleCount:200000,seed:'1'},visual:{dotSize:1.25},camera:{phi:0,theta:0,gamma:0},recordDuration:10});
  expect(r.consumedPaths).toEqual([]);expect(r.numericPaths).toEqual([]);expect(r.diagnostics).toEqual([]);
  expect(parseSourceBouncingDocument(r.payload)).toEqual({ok:true,value:r.payload});
 });
 it('does not inspect any camera value when settings is absent, but uses strict camera containers when present',()=>{
  for(const camera of [null,[],false,5,'x',{phi:'1/0'}])expect(imported({camera}).payload.camera).toEqual({phi:0,theta:0,gamma:0});
  for(const camera of [null,[],false,5,'x'])expect(importSourceBouncingDocument({settings:{},camera})).toMatchObject({ok:false,error:{kind:'input',path:['camera']}});
  const empty=imported({settings:{},camera:{}});expect(empty.consumedPaths).toEqual([['settings'],['camera']]);
 });
 it('uses empty-scope ConfigUtils float expressions for only the three angles and preserves signed zero',()=>{
  const r=imported({settings:{},parameters:{p:2},camera:{phi:'PI/4',theta:'p',gamma:-0,zoom:'1/0',focal:0,center:[NaN],track:'bad'}});
  expect(r.payload.camera.phi).toBe(F(Math.PI/4));expect(r.payload.camera.theta).toBe(0);expect(Object.is(r.payload.camera.gamma,-0)).toBe(true);
  expect(r.consumedPaths).toEqual([['settings'],['camera','phi'],['camera','theta'],['camera','gamma']]);expect(r.numericPaths).toEqual([['camera','gamma']]);expect(r.diagnostics).toHaveLength(1);
  expect(imported({settings:{},camera:{phi:null,theta:true}}).payload.camera).toEqual({phi:0,theta:0,gamma:0});
 });
 it('clamps record duration at native Float32 .1 without adding a product maximum',()=>{
  for(const record_duration of [-2,0,'-1/0','garbage'])expect(imported({settings:{record_duration}}).payload.recordDuration).toBe(F(.1));
  expect(imported({settings:{record_duration:'1/3'}}).payload.recordDuration).toBe(F(1/3));
  expect(imported({settings:{record_duration:100000}}).payload.recordDuration).toBe(100000);
  expect(imported({settings:{record_duration:null}}).payload.recordDuration).toBe(10);
  for(const record_duration of ['1/0','0/0'])expect(importSourceBouncingDocument({settings:{record_duration}})).toMatchObject({ok:false,error:{kind:'nonfinite',path:['settings','record_duration']}});
 });
 it('preserves native owner errors, numeric token identity, consumed metadata, and palette-before-settings validation',()=>{
  const raw={palette:['#123456'],settings:{seed:Number('9223372036854775807'),record_duration:2},camera:{theta:.25}};
  expect(importSourceBouncingDocument(raw)).toMatchObject({ok:false,error:{path:['settings','seed']}});
  const r=importSourceBouncingDocument(raw,{numberToken:path=>path.join('.')==='settings.seed'?'9223372036854775807':undefined});if(!r.ok)throw Error('token');expect(r.value.payload.configuration.seed).toBe('9223372036854775807');
  for(const path of [['palette'],['settings','seed'],['settings','record_duration'],['camera','theta']])expect(r.value.consumedPaths).toContainEqual(path);
  expect(new Set(r.value.consumedPaths.map(path=>JSON.stringify(path))).size).toBe(r.value.consumedPaths.length);
  expect(importSourceBouncingDocument({palette:[3],settings:null})).toMatchObject({ok:false,error:{path:['palette','0']}});
  expect(importSourceBouncingDocument({settings:{},camera:{theta:'x'.repeat(65537)}})).toMatchObject({ok:false,error:{kind:'capacity',path:['camera','theta']}});
 });
 it('strictly copies canonical payloads, fails mismatched owner presence, and does not replay provenance over edits',()=>{
  const p=imported().payload;
  const changed={...p,camera:{phi:1,theta:2,gamma:3},recordDuration:2};
  const parsed=parseSourceBouncingDocument(changed);expect(parsed.ok).toBe(true);if(!parsed.ok)throw Error('parse');changed.camera.phi=10;changed.configuration.polygonVertices[0]=99;expect(parsed.value.camera.phi).toBe(1);expect(parsed.value.configuration.polygonVertices[0]).not.toBe(99);
  for(const bad of [null,{...p,extra:1},{...p,camera:{phi:0,theta:0}},{...p,camera:{phi:0,theta:0,gamma:0,zoom:1}},{...p,camera:{phi:NaN,theta:0,gamma:0}},{...p,recordDuration:0},{...p,recordDuration:Infinity},{...p,visual:{...p.visual,settingsPresence:'object'}}])expect(parseSourceBouncingDocument(bad).ok).toBe(false);
  expect(parseSourceBouncingDocument({...p,configuration:{...p.configuration,particleCount:0}})).toMatchObject({ok:false,error:{path:['configuration','particleCount']}});
 });
 it('supplies complete Bouncing baseline to the shared camera math without borrowing another family default',()=>{
  const p=imported({settings:{},camera:{phi:'PI',gamma:.5}}).payload,input=sourceBouncingCameraInput(p),r=resolveSourceCamera(input);
  expect(input.configuration).toEqual({kind:'absent'});expect(input.frame).toEqual({phi:F(Math.PI),theta:0,gamma:.5,center:[0,0,0],zoom:1,focalDistance:20});
  expect(r.ok&&r.value.kind==='known'&&r.value.state.value).toMatchObject({phi:F(Math.PI),theta:0,gamma:.5});
  p.camera.phi=7;expect(input.frame?.phi).toBe(F(Math.PI));
 });
 it('separates owned identity from validity and rejects mixed local/ordinary execution before generation',()=>{
  expect(usesSourceBouncing({kind:'bouncing',bouncingSource:null})).toBe(true);expect(usesSourceBouncing({kind:'bouncing'})).toBe(false);expect(usesSourceBouncing({kind:'surface',bouncingSource:{}})).toBe(false);
  const s=scene();expect(prepareSourceBouncingScene(s)).toEqual({ok:true,value:s.bouncingSource});
  for(const mixed of [{...s,bouncingSource:null},{...s,sourceCamera:{}},{...s,timeline:{...s.timeline,tracks:[{type:'wait',duration:1}]}},{...s,timeline:{...s.timeline,schedule:'ordinary-camera-sequence-v1'}},{...s,settings:{count:100}},{...s,equations:{mask:'x>0'}},{...s,parameters:{a:1}},{...s,settings:[]},{...s,kind:'surface'}])expect(prepareSourceBouncingScene(mixed).ok).toBe(false);
 });
});
