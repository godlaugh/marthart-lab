import {describe,it,expect} from 'vitest';
import {createScene,parseScene,persistentScene} from '../src/engine/document';
import {parseProjectFile} from '../src/engine/legacyImport';
import {withDomainColorVersion,withDomainIterationVersion,withDomainViewportVersion} from '../src/engine/domainAuthoring';
import {parseDomainModel} from '../src/engine/domainModel';
import {definition} from '../src/scenes';

const source=(patch:Record<string,unknown>={})=>({config_version:'1.0.0',type:'DOMAIN_COLORING',name:'Viewport import',...patch});
const read=(value:unknown)=>parseProjectFile(JSON.stringify(value));

describe('source viewport import through the actual file adapter',()=>{
 it.each([{}, {domainColoring:{}}, {domainColoring:{viewport:{}}}, {domainColoring:{viewport:{centerX:null,centerY:null,scale:null}}}])('uses runtime defaults for omission and nullable scalar defaults: %j',patch=>{
  const original=source(patch),result=read(original);
  expect(result.scene.settings).toMatchObject({centerX:0,centerY:0,scale:2.5,rotation:0,domainViewportVersion:'mathart-1.7.8-gpu'});
  expect(result.scene.provenance?.original).toEqual(original);
  expect(parseScene(JSON.stringify(result.scene)).settings).toEqual(result.scene.settings);
 });
 it.each([-.5,0,1e-12,1e-9,.5,2.5,1e20,1e308])('preserves finite authored scale %s without a local zoom conversion',scale=>{
  const original=source({domainColoring:{viewport:{centerX:.12345678901234567,centerY:-.9876543210987654,scale}}}),result=read(original);
  expect(result.scene.settings).toMatchObject({centerX:.12345678901234567,centerY:-.9876543210987654,scale});
  const before=JSON.stringify(result.scene);parseDomainModel(result.scene,0);
  expect(JSON.stringify(result.scene)).toBe(before);expect(persistentScene(result.scene).provenance?.original).toEqual(original);
 });
 it('evaluates supported viewport expressions without binding scene formula parameters',()=>{
  const result=read(source({parameters:{a:99},domainColoring:{viewport:{centerX:'1 / 8',centerY:'-1e-12',scale:'2.5'}}}));
  expect(result.scene.settings).toMatchObject({centerX:.125,centerY:-1e-12,scale:2.5});
  expect(()=>read(source({parameters:{a:99},domainColoring:{viewport:{centerX:'a'}}}))).toThrow('centerX');
 });
 it.each([null,[],false,'bad'])('rejects malformed source viewport containers: %j',viewport=>{
  expect(()=>read(source({domainColoring:{viewport}}))).toThrow('viewport');
  expect(()=>read(source({domainColoring:viewport}))).toThrow('domainColoring');
 });
 it.each([true,{},[], 'NaN','Infinity','1e999','missing_variable'])('reports the explicit finite scalar compatibility boundary: %j',scale=>{
  expect(()=>read(source({domainColoring:{viewport:{scale}}}))).toThrow('scale');
 });
 it.each([2.1, 'ignored text', {raw:'retained'}])('retains an ignored source rotation as provenance: %j',rotation=>{
  const original=source({domainColoring:{viewport:{rotation}}}),result=read(original);
  expect(result.scene.settings.rotation).toBe(0);expect(result.scene.provenance?.original).toEqual(original);
  expect(result.warnings.join()).toContain('原版运行时忽略此字段');
 });
 it.each([{render_mode:'CPU'},{isCPURender:true},{render_mode:'GPU'}])('selects source arithmetic explicitly and retains it when backend changes: %j',settings=>{
  const result=read(source({settings})).scene;
  expect(result.settings.domainViewportVersion).toBe(settings.render_mode==='GPU'?'mathart-1.7.8-gpu':'mathart-1.7.8-cpu');
  const expected=result.settings.domainViewportVersion;result.settings.domainBackend='cpu';
  const edited=withDomainIterationVersion(withDomainColorVersion(result,'local-v1'),'local-v1');
  expect(parseScene(JSON.stringify(edited)).settings.domainViewportVersion).toBe(expected);
 });
 it('retains a zero-target rotation action for omitted or empty positional arguments',()=>{
  const result=read(source({timeline:[{type:'animate',duration:2,actions:[{method:'domainRotate'}]},{type:'animate',duration:2,actions:[{method:'domainRotate',args:[]}]}]}));
  expect(result.scene.timeline.tracks.map(t=>t.actions?.[0])).toMatchObject([{method:'domainRotate',args:{speed:0}},{method:'domainRotate',args:{speed:0}}]);
  expect(result.warnings.join()).not.toContain('需要 1 个位置参数');
 });
});

describe('independent viewport rule authoring and persistence',()=>{
 it('keeps all existing source-color documents without a viewport version on the old local contract',()=>{
  const old=withDomainIterationVersion(withDomainColorVersion(createScene(definition('domain')),'mathart-1.7.8-gpu'),'mathart-1.7.8');
  old.settings.domainSourceImportPath='runtime-config';old.settings.scale=4;
  const before=JSON.stringify(old),loaded=read(old).scene;expect(JSON.stringify(loaded)).toBe(before);
  expect(loaded.settings.domainViewportVersion).toBeUndefined();
  const a=definition('domain').generate(loaded,{time:0,width:11,height:9,quality:'export'}),b=definition('domain').generate(withDomainViewportVersion(loaded,'local-v1'),{time:0,width:11,height:9,quality:'export'});
  expect(a.type).toBe('raster');if(a.type!=='raster'||b.type!=='raster')throw Error('raster required');expect(a.pixels).toEqual(b.pixels);
 });
 it('changes only the declared viewport rules through save/reload/switch back',()=>{
  const original=createScene(definition('domain'));Object.assign(original.settings,{centerX:.123456789012345,centerY:-.91,scale:.5,rotation:.75,domainBackend:'cpu'});
  const before=JSON.stringify(original);let scene=original;
  for(const version of ['mathart-1.7.8-cpu','mathart-1.7.8-gpu','local-v1']){
   scene=parseScene(JSON.stringify(withDomainViewportVersion(scene,version)));
   expect(scene.settings).toEqual({...original.settings,domainViewportVersion:version});
   expect(scene.equations).toEqual(original.equations);expect(scene.palette).toEqual(original.palette);
  }
  expect(JSON.stringify(original)).toBe(before);
 });
 it('preserves an out-of-local-range source value when switching instead of silently clamping it',()=>{
  const scene=read(source({domainColoring:{viewport:{scale:-2}}})).scene,local=withDomainViewportVersion(scene,'local-v1');
  expect(local.settings.scale).toBe(-2);expect(()=>parseDomainModel(local,0)).toThrow();
  expect(withDomainViewportVersion(parseScene(JSON.stringify(local)),'mathart-1.7.8-gpu').settings.scale).toBe(-2);
 });
 it('rejects unknown viewport versions at both file and authoring boundaries',()=>{
  const scene=createScene(definition('domain'));
  for(const value of [null,0,'mathart-1.7.8','future']){
   expect(()=>withDomainViewportVersion(scene,value)).toThrow();
   expect(()=>read({...scene,settings:{...scene.settings,domainViewportVersion:value}})).toThrow();
  }
  expect(()=>withDomainViewportVersion(createScene(definition('fractal')),'local-v1')).toThrow('仅适用于');
 });
});
