import {describe,expect,it} from 'vitest';
import {createScene,parseScene,persistentScene,serializeScene} from '../src/engine/document';
import {parseProjectFile} from '../src/engine/legacyImport';
import {parseProjectResolution,prepareProjectResolution,prepareSourceProjectResolution,sameProjectResolution} from '../src/engine/projectResolution';
import {definition} from '../src/scenes';
import type {SceneDocument,SceneKind} from '../src/types';

// Source-derived expectations: ProjectState.fromJson initializes 0/0, catches
// malformed resolution containers, uses getInt(key,0), and commits the pair
// only at 64..8192 inclusive. Long.intValue and Double.intValue are distinct.
// No source app/JVM is executed and no renderer sizing claim is made here.
const families:[string,SceneKind,Record<string,unknown>][]=[
 ['SURFACE','surface',{equations:{x:'u',y:'v',z:'0'}}],
 ['ATTRACTOR','attractor',{equations:{dx:'y',dy:'z',dz:'-x'}}],
 ['MAP_ATTRACTOR','map',{equations:{x_next:'y',y_next:'x'}}],
 ['IMPLICIT','implicit',{equation:{f:'x*x+y*y+z*z-1'}}],
 ['FRACTAL','fractal',{fractal:{formula_id:'mandelbrot'}}],
 ['DOMAIN_COLORING','domain',{domainColoring:{formula:'z'}}],
 ['SYMMETRY_CHAOS','symmetry',{}],['PERLIN','perlin',{}],
 ['SPIROGRAPH','spirograph',{}],['BOUNCING_PARTICLES','bouncing',{}],
 ['SAMILA','samila',{equations:{f1:'x',f2:'y'}}],['COMPLEX_ROOTS','roots',{}],
];
const source=(extra:Record<string,unknown>={})=>({config_version:'1.0.0',type:'DOMAIN_COLORING',name:'Project dimensions',domainColoring:{formula:'z'},...extra});
const literal=(resolution:string)=>parseProjectFile(`{"config_version":"1.0.0","type":"DOMAIN_COLORING","name":"Dimensions","domainColoring":{"formula":"z"},"resolution":${resolution}}`);
const reopen=(scene:SceneDocument)=>parseProjectFile(serializeScene(scene)).scene;

describe('global ProjectState resolution public import and persistence',()=>{
 it.each(families)('imports and reopens dimensions for %s without granting Roots-only fields', (type,kind,extra)=>{
  const input={config_version:'1.0.0',type,name:'Global dimensions',...extra,resolution:{width:720,height:1280}};
  const result=parseProjectFile(JSON.stringify(input));
  expect(result.scene.kind).toBe(kind);
  expect(result.scene.projectResolution).toEqual({width:720,height:1280});
  expect(result.scene.provenance!.sourceNumberTokens).toEqual(expect.arrayContaining([
   {path:['resolution','width'],token:'720'},{path:['resolution','height'],token:'1280'},
  ]));
  expect(reopen(result.scene).projectResolution).toEqual(result.scene.projectResolution);
  expect(reopen(result.scene).provenance).toEqual(result.scene.provenance);
  expect(result.scene.provenance!.original).toEqual(input);
 });

 it('preserves omission, including an old inert resolution property and source provenance',()=>{
  const imported=parseProjectFile(JSON.stringify(source())).scene;
  expect(imported).not.toHaveProperty('projectResolution');
  expect(reopen(imported)).not.toHaveProperty('projectResolution');
  for(const [,kind] of families){
   const scene=createScene(definition(kind));
   const old={...scene,resolution:{width:800,height:600},provenance:{kind:'MathArt Studio',original:{resolution:{width:800,height:600}},warnings:[]}};
   const loaded=parseProjectFile(JSON.stringify(old)).scene;
   expect(loaded).not.toHaveProperty('projectResolution');
   expect(reopen(loaded)).not.toHaveProperty('projectResolution');
  }
 });

 it.each([null,[],true,720,'720x540',{}, {width:720}, {height:540}, {width:63,height:540}, {width:720,height:8193}, {width:null,height:540}, {width:{value:720},height:540}].map(resolution=>({resolution})))('ignores invalid source pair $resolution atomically and preserves input',({resolution})=>{
  const input=source({resolution}),result=parseProjectFile(JSON.stringify(input));
  expect(result.scene).not.toHaveProperty('projectResolution');
  expect(result.warnings.join('\n')).toContain('resolution 未同时');
  expect(result.scene.provenance!.original).toEqual(input);
  const reloaded=reopen(result.scene);
  expect(reloaded).not.toHaveProperty('projectResolution');
  expect(reloaded.provenance).toEqual(result.scene.provenance);
 });

 it.each([
  ['{"width":64,"height":8192}',{width:64,height:8192}],
  ['{"width":8192,"height":64}',{width:8192,height:64}],
  ['{"width":64.9,"height":8192.9}',{width:64,height:8192}],
  ['{"width":"+64","height":"８１９２"}',{width:64,height:8192}],
  ['{"width":4294967360,"height":4294975488}',{width:64,height:8192}],
  ['{"width":4294967360.0,"height":720}',undefined],
  ['{"width":7.20e2,"height":1.28e3}',{width:720,height:1280}],
  ['{"width":"1e3","height":720}',undefined],
  ['{"width":" 720 ","height":720}',undefined],
  ['{"width":"720.0","height":720}',undefined],
  ['{"width":"2*360","height":720}',undefined],
  ['{"width":-0,"height":720}',undefined],
  ['{"width":9223372036854775808,"height":720}',undefined],
  ['{"width":1e999,"height":720}',undefined],
 ] as const)('uses source Number class and integer parsing for %s', (raw,expected)=>{
  const result=literal(raw),reloaded=reopen(result.scene);
  expect(result.scene.projectResolution).toEqual(expected);
  expect(reloaded.projectResolution).toEqual(expected);
  expect(reloaded.provenance!.sourceNumberTokens).toEqual(result.scene.provenance!.sourceNumberTokens);
 });

 it('retains both exact overflow/negative-zero lexemes through JSON-safe saving',()=>{
  const scene=literal('{"width":1e999,"height":-0}').scene;
  expect((scene.provenance!.original as {resolution:{width:number}}).resolution.width).toBe(Infinity);
  const reloaded=reopen(scene);
  expect(reloaded).not.toHaveProperty('projectResolution');
  expect((reloaded.provenance!.original as {resolution:{width:unknown}}).resolution.width).toBeNull();
  expect(reloaded.provenance!.sourceNumberTokens).toEqual([
   {path:['resolution','width'],token:'1e999'},{path:['resolution','height'],token:'-0'},
  ]);
 });

 it('consumes only exact width/height leaves, preserving extras and unregistered aliases',()=>{
  const result=parseProjectFile(JSON.stringify(source({resolution:{width:720,height:540,future:7},Resolution:{width:800,height:600},'resolution.width':900})));
  expect(result.scene.projectResolution).toEqual({width:720,height:540});
  expect(result.warnings.join('\n')).toContain('resolution.future');
  expect(result.warnings.join('\n')).toContain('Resolution.width');
  expect(result.warnings.join('\n')).toContain('["resolution.width"]');
  expect(parseProjectFile(JSON.stringify(source({Resolution:{width:720,height:540}}))).scene).not.toHaveProperty('projectResolution');
 });
});

describe('canonical dimensions and metadata boundaries',()=>{
 it('validates canonical facts once and clones them for independent authoring',()=>{
  const input={width:8192,height:8192},parsed=parseProjectResolution(input);
  expect(parsed).toEqual(input);expect(parsed).not.toBe(input);
  // Source dimension admission is independent of the smaller execution budget.
  const scene={...createScene(definition('domain')),projectResolution:parsed};
  expect(parseScene(serializeScene(scene)).projectResolution).toEqual(input);
  expect(persistentScene(scene).projectResolution).toBe(parsed);
  expect(sameProjectResolution(undefined,undefined)).toBe(true);
  expect(sameProjectResolution(parsed,{width:8192,height:8192})).toBe(true);
  expect(sameProjectResolution(parsed,undefined)).toBe(false);
  expect(sameProjectResolution(undefined,parsed)).toBe(false);
  expect(sameProjectResolution(parsed,{width:8192,height:8191})).toBe(false);
 });

 it.each([null,[],{}, {width:'720',height:540}, {width:720.5,height:540}, {width:0,height:540}, {width:8193,height:540}, {width:720,height:null}].map(raw=>({raw})))('rejects malformed canonical dimensions without source fallback: $raw',({raw})=>{
  expect(prepareProjectResolution(raw).ok).toBe(false);
  const scene={...createScene(definition('domain')),projectResolution:raw};
  expect(()=>parseProjectFile(JSON.stringify(scene))).toThrow('项目');
 });

 it('does not hide stale/missing lexical metadata behind source fallback',()=>{
  expect(prepareSourceProjectResolution({width:4294967360,height:720})).toMatchObject({ok:false,error:{kind:'source-integer',field:'width',cause:{kind:'number-token-required'}}});
  expect(prepareSourceProjectResolution({width:720,height:540},{width:'721'})).toMatchObject({ok:false,error:{field:'width',cause:{kind:'invalid-number-token'}}});
 });

 it.each([
  ['camera','phi'],['settings','background_color'],['sampling','seed'],
  ['timeline','0','duration'],['resolution','Width'],['Resolution','width'],['resolution.width'],['resolution','depth'],
 ])('rejects unregistered or Roots-only token path %j on non-Roots documents',(...path)=>{
  const scene=literal('{"width":720,"height":540}').scene;
  scene.provenance!.sourceNumberTokens=[{path,token:'1'}];
  expect(()=>parseScene(serializeScene(scene))).toThrow('字段路径');
 });

 it('rejects duplicate dimension tokens and does not use the new fields to expand old Roots static limits',()=>{
  const scene=literal('{"width":720,"height":540}').scene;
  scene.provenance!.sourceNumberTokens=[{path:['resolution','width'],token:'720'},{path:['resolution','width'],token:'721'}];
  expect(()=>parseScene(serializeScene(scene))).toThrow('重复');
  const root=parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'COMPLEX_ROOTS',name:'Roots',resolution:{width:720,height:540}})).scene;
  root.provenance!.sourceNumberTokens=[...root.provenance!.sourceNumberTokens!,...Array.from({length:16},()=>({path:['camera','phi'],token:'1'}))];
  expect(()=>parseScene(serializeScene(root))).toThrow('源静态数字词法');
 });
});
