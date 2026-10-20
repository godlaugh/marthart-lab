import {describe,it,expect} from 'vitest';
import {parseLegacyScene,parseProjectFile} from '../src/engine/legacyImport';
import {parseScene,serializeScene} from '../src/engine/document';
import {IteratedDensitySession} from '../src/scenes/iteratedDensity';
import {parseSourceNumberTokens} from '../src/engine/sourceNumberTokens';
const raw=(patch:Record<string,unknown>={})=>({config_version:'1.0.0',type:'SAMILA',name:'Source mathematics',settings:{batch_size:8,render_mode:'CPU'},...patch});
const parse=(patch:Record<string,unknown>={})=>parseLegacyScene(JSON.stringify(raw(patch)));
describe('source Samila configuration ownership',()=>{
 it('uses the fixed native formula and math defaults with an empty parameter map',()=>{
  const {scene}=parse();expect(scene.equations).toEqual({f1:'sin(x*y)',f2:'cos(x-y)'});expect(scene.parameters).toEqual({});
  expect(scene.settings).toMatchObject({samilaMathModel:'mathart-1.7.8',mapping:'f2_f1',projection:'polar',start:-Math.PI,stop:Math.PI,seed:0,funcSeed:0});
  expect(parse({equations:{f1:' \t',f2:null}}).scene.equations).toEqual({f1:'0.0',f2:'cos(x-y)'});
 });
 it('selects root samila as a complete block and leaves ignored settings untouched in provenance',()=>{
  const value=raw({samila:{start:5},settings:{batch_size:8,start:-99,stop:99,generate_mode:'f2_vs_f1',projection:'hammer',seed:'bad',func_seed:{unused:true}}}),result=parseLegacyScene(JSON.stringify(value));
  expect(result.scene.settings).toMatchObject({start:5,stop:Math.PI,mapping:'f2_f1',projection:'polar',seed:0,funcSeed:0});expect(result.source).toEqual(value);
  expect(result.sourceNumberTokens?.map(v=>v.path)).toEqual([['samila','start']]);
  expect(parse({samila:{}}).scene.settings.start).toBe(-Math.PI);
 });
 it('uses source literal getters rather than mathematical expressions',()=>{
  const result=parse({equations:{f1:2},parameters:{a:'1e2',b:'PI',c:null,d:'0x1p-2'},samila:{start:'1/2',stop:'0x1p2',seed:' 3',func_seed:-1,generate_mode:42,projection:true}});
  expect(result.scene.equations).toEqual({f1:'2',f2:'cos(x-y)'});expect(result.scene.parameters).toEqual({a:100,b:0,c:0,d:.25});
  expect(result.scene.settings).toMatchObject({start:-Math.PI,stop:4,seed:0,funcSeed:-1,mapping:'f2_f1',projection:'cartesian'});
  expect(()=>parse({parameters:{a:'Infinity'}})).toThrow('非有限');expect(()=>parse({samila:{start:'NaN'}})).toThrow('非有限');
 });
 it('retains number-class narrowing and exact tokens for source integer seeds',()=>{
  const text=JSON.stringify(raw({samila:{seed:4294967295,func_seed:0},parameters:{a:.3}})).replace('"func_seed":0','"func_seed":4294967295.0').replace('"a":0.3','"a":0.30000000000000000001');
  const parsed=parseProjectFile(text);expect(parsed.scene.settings.seed).toBe(4294967295);expect(parsed.scene.settings.funcSeed).toBe(2147483647);
  expect(parsed.scene.provenance?.sourceNumberTokens).toContainEqual({path:['parameters','a'],token:'0.30000000000000000001'});expect(parsed.warnings.join(' ')).toContain('同一 32 位模式');
  expect(parseScene(serializeScene(parsed.scene)).provenance).toEqual(parsed.scene.provenance);
 });
 it('distinguishes integer negative zero from double and string negative zero',()=>{
  const parsed=parseLegacyScene('{"config_version":"1.0.0","name":"Signed zero","type":"SAMILA","parameters":{"a":-0,"b":-0.0,"c":-0e0,"d":"-0"},"samila":{"start":-0,"stop":-0.0}}');
  expect(Object.is(parsed.scene.parameters.a,0)).toBe(true);
  for(const key of ['b','c','d'])expect(Object.is(parsed.scene.parameters[key],-0)).toBe(true);
  expect(Object.is(parsed.scene.settings.start,0)).toBe(true);expect(Object.is(parsed.scene.settings.stop,-0)).toBe(true);
  expect(parsed.sourceNumberTokens).toContainEqual({path:['parameters','a'],token:'-0'});
 });
 it('preserves source RANDOM identifiers but does not change old saved math profiles',()=>{
  const value=raw({equations:{f1:'x',f2:'y'},settings:{batch_size:8,generate_mode:'random',projection:'random'}}),fresh=parseLegacyScene(JSON.stringify(value)).scene,old=parseLegacyScene(JSON.stringify(value),{samilaMath:'legacy-v1'}).scene;
  expect(fresh.settings).toMatchObject({mapping:'random',projection:'random',samilaMathModel:'mathart-1.7.8'});expect(old.settings.samilaMathModel).toBeUndefined();expect(old.settings.samilaProjectionModel).toBe('source-ndc-v1');
  expect(parseProjectFile(serializeScene(old)).scene.settings).toEqual(old.settings);
 });
 it('rejects malformed selected sections, duplicate members, and contradictory retained source paths',()=>{
  for(const key of ['samila','equations','parameters'])for(const value of [null,[],3])expect(()=>parse({[key]:value})).toThrow();
  const text=JSON.stringify(raw({samila:{start:1}})).replace('"start":1','"start":1,"start":2');expect(()=>parseLegacyScene(text)).toThrow();
  expect(()=>parseSourceNumberTokens([{path:['samila','start'],token:'1'},{path:['settings','stop'],token:'2'}],'samila')).toThrow('已选');
 });
 it('uses raw reversed and float-collapsed bounds through public production generation',()=>{
  for(const [start,stop] of [[2,-1],[1,1],[1,1+1e-10],[1001,1002]]){
   const {scene}=parse({equations:{f1:'0.2',f2:'0.3'},samila:{start,stop,generate_mode:'f2_vs_f1',projection:'rectilinear'}}),owner=new IteratedDensitySession();
   try{expect(owner.generate(scene,{time:0,width:40,height:24,quality:'export'}).type).toBe('raster');expect(scene.settings.start).toBe(start);expect(scene.settings.stop).toBe(stop);}finally{owner.reset();}
  }
 });
});
