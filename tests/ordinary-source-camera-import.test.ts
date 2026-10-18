import {describe,expect,it} from 'vitest';
import {prepareOrdinarySourceCameraImport as prepare,ORDINARY_SOURCE_CAMERA_IMPORT_LIMITS,type OrdinarySourceCameraFamily} from '../src/engine/ordinarySourceCameraImport';
import {resolveSourceCamera} from '../src/engine/sourceCamera';
import {parseDomainSourceFloat,DOMAIN_SOURCE_SCALAR_LIMITS} from '../src/engine/domainSourceScalar';
const families=['surface','implicit','attractor','perlin'] as const;
function camera(raw:unknown,family:OrdinarySourceCameraFamily='surface',options:Parameters<typeof prepare>[2]={}){
 const result=prepare(raw,family,options);if(!result.ok)throw new Error(JSON.stringify(result.error));
 const resolved=resolveSourceCamera(result.value.camera);if(!resolved.ok||resolved.value.kind!=='known')throw new Error('Camera resolution failed');
 return{...result.value,angles:resolved.value.state.value};
}
const midpointAbove='1.0000000596046447753906250000000000000001';
describe('ordinary initial camera, retained MathArt 1.7.8 scalar contracts',()=>{
 it.each(families)('preserves absence, defaults and finite matrix-owner admission for %s',family=>{
  expect(camera(undefined,family).camera.configuration.kind).toBe('absent');
  expect(camera({},family).angles).toMatchObject({phi:Math.fround(Math.PI/2),theta:0,gamma:0});
  expect(camera({phi:null,theta:null},family).angles).toMatchObject({phi:Math.fround(Math.PI/2),theta:0});
  expect(camera({phi:'PI/3',theta:'-.2',gamma:2},family).angles).toMatchObject({phi:Math.fround(Math.PI/3),theta:Math.fround(-.2),gamma:2});
  expect(prepare(null,family)).toMatchObject({ok:false,error:{kind:'input',reason:'object-required'}});
 });
 it('separates direct Float from Double then Float at a real decimal double-round boundary',()=>{
  for(const family of families)expect(camera({phi:midpointAbove},family).angles.phi).toBe(family==='surface'||family==='implicit'?1+2**-23:1);
  // Hex has the same distinction; scientific suffixes are literals, not AST syntax.
  expect(camera({phi:'0x1.000001000000000000001p0f'}).angles.phi).toBe(1+2**-23);
  expect(camera({phi:'0x1.000001000000000000001p0f'},'perlin').angles.phi).toBe(1);
 });
 it('retains unresolved numeric toString midpoint rather than pretending raw binary64 is a source string',()=>{
  expect(prepare({phi:1+2**-24},'surface')).toMatchObject({ok:false,error:{kind:'input',reason:'source-number-text-unknown'}});
  expect(camera({phi:1+2**-24},'attractor').angles.phi).toBe(1);
  expect(camera({phi:16777217}).angles.phi).toBe(16777216);
 });
 it.each(families)('keeps invalid expression fallback zero distinct from omission for %s',family=>{
  for(const value of ['missing+1',true,{},[], '1e3+1']){
   const result=camera({phi:value},family);expect(result.angles.phi).toBe(0);expect(result.diagnostics).toHaveLength(1);
  }
  expect(camera({phi:''},family).angles.phi).toBe(0);
 });
 it('builds constants in the supplied source order, preserving double literals then float expressions',()=>{
  const parameters={b:'a+1',a:3,PI:8};
  expect(camera({theta:'b'},'surface',{parameters,memberOrder:['a','b','PI']}).angles).toMatchObject({phi:4,theta:4});
  const early=camera({theta:'b'},'implicit',{parameters,memberOrder:['b','a','PI']});expect(early.angles.theta).toBe(0);expect(early.diagnostics).toHaveLength(1);
  const values={a:'16777217',b:'a+0'};
  expect(camera({theta:'a-16777216',gamma:'b-16777216'},'surface',{parameters:values,memberOrder:['a','b']}).angles).toMatchObject({theta:1,gamma:0});
 });
 it('matches exact-case parameter lookup before builtins while function syntax keeps precedence',()=>{
  const options={parameters:{PI:8,pi:6,sin:5}};
  expect(camera({phi:'PI+pi',theta:'Pi',gamma:'sin(0)+sin'},'surface',options).angles).toMatchObject({phi:14,theta:Math.fround(Math.PI),gamma:5});
  expect(camera({phi:true,theta:false},'surface',{parameters:{true:7,false:9}}).angles).toMatchObject({phi:7,theta:9});
  expect(camera({phi:'PI',theta:'a'},'perlin',{parameters:{PI:8,a:4}}).angles).toMatchObject({phi:Math.fround(Math.PI),theta:0});
 });
 it('requires exact native order only when parameter expressions depend on construction',()=>{
  expect(camera({phi:'a'},'surface',{parameters:{a:3}}).angles.phi).toBe(3);
  expect(prepare({phi:'a'},'surface',{parameters:{a:'PI'}})).toMatchObject({ok:false,error:{kind:'input',reason:'source-order-required'}});
  for(const memberOrder of [['a','a'],['z'],[]])expect(prepare({},'surface',{parameters:{a:3},memberOrder})).toMatchObject({ok:false,error:{reason:'invalid-member-order'}});
  for(const value of [null,true,{},[]])expect(prepare({},'surface',{parameters:{a:value},memberOrder:['a']})).toMatchObject({ok:false,error:{reason:'parameter-string-required'}});
 });
 it.each(families)('rejects successful nonfinite output without converting it into fallback for %s',family=>{
  for(const phi of ['1/0','0/0','NaN','1e999',Infinity])expect(prepare({phi},family)).toMatchObject({ok:false,error:{kind:'nonfinite',path:'camera.phi'}});
 });
 it('propagates character, nesting and scope capacity instead of falling back',()=>{
  for(const family of families){
   expect(prepare({phi:'1'.repeat(DOMAIN_SOURCE_SCALAR_LIMITS.characters+1)},family)).toMatchObject({ok:false,error:{kind:'capacity',resource:'characters'}});
   expect(prepare({phi:'('.repeat(129)+'1'+')'.repeat(129)},family)).toMatchObject({ok:false,error:{kind:'capacity',resource:'depth'}});
  }
  expect(prepare({},'surface',{parameters:Object.fromEntries(Array.from({length:ORDINARY_SOURCE_CAMERA_IMPORT_LIMITS.parameters+1},(_,i)=>['p'+i,1]))})).toMatchObject({ok:false,error:{kind:'capacity',resource:'parameters'}});
 });
});
describe('direct Java Float literal rounding without binary64 intermediates',()=>{
 it.each([
  ['1.000000059604644775390625',1], [midpointAbove,1+2**-23],
  ['1.000000178813934326171875',1+2**-22],
  ['0x1p-150',0],['0x1.000000000000000001p-150',2**-149],['-0x1p-150',-0],
  ['0x1.fffffep127',(2-2**-23)*2**127],['0x1.ffffffp127',Infinity],
  ['1e99999',Infinity],['-1e-99999',-0],['0e99999',0],['+NaN',NaN],['\u0000 1f\t',1],
 ] as const)('rounds %s to the expected source Float bits',(literal,expected)=>{
  const result=parseDomainSourceFloat(literal);expect(result.ok).toBe(true);if(result.ok)expect(Object.is(result.value,expected)).toBe(true);
 });
 it.each(['0x1','1_0','NaNf','1e','\u00a01'])('does not widen direct grammar: %s',literal=>expect(parseDomainSourceFloat(literal)).toEqual({ok:false,error:{kind:'invalid-literal'}}));
});

import floatOracle from './fixtures/source-camera/scalars.json';
it('matches 42 independent rational-lattice fixtures across normal/subnormal/overflow-adjacent float bins',()=>{
 const view=new DataView(new ArrayBuffer(4));
 for(const fixture of floatOracle.cases){
  const result=parseDomainSourceFloat(fixture.literal);expect(result.ok,fixture.literal).toBe(true);
  if(result.ok){view.setFloat32(0,result.value);expect(view.getUint32(0),fixture.literal).toBe(fixture.expectedBits);}
 }
});

import {prepareOrdinarySourceScalarScope} from '../src/engine/ordinarySourceCameraImport';
it('prepared scalar owner distinguishes three native overloads without rebuilding scope',()=>{
 const result=prepareOrdinarySourceScalarScope('surface',{parameters:{a:3,b:'a+1'},memberOrder:['a','b']});expect(result.ok).toBe(true);if(!result.ok)return;
 const scope=result.value;expect(scope.parameterValues).toEqual({a:3,b:4});
 expect(scope.argument(midpointAbove,'arg')).toMatchObject({ok:true,value:{value:1+2**-23}});
 expect(scope.argument(1+2**-24,'arg')).toMatchObject({ok:true,value:{value:1}});
 expect(scope.field(midpointAbove,'duration',1,true)).toMatchObject({ok:true,value:{value:1}});
 expect(scope.field('b','duration',1,true)).toMatchObject({ok:true,value:{value:4}});
 expect(scope.field(null,'duration',1,true)).toMatchObject({ok:false,error:{reason:'field-string-required'}});
 expect(scope.argument(true,'arg')).toMatchObject({ok:true,value:{value:0}});
 expect(scope.field('('.repeat(129)+'1'+')'.repeat(129),'duration',1,true)).toMatchObject({ok:false,error:{kind:'capacity'}});
 const attractor=prepareOrdinarySourceScalarScope('attractor');if(!attractor.ok)throw Error();
 expect(attractor.value.field('bad','duration',1,true)).toMatchObject({ok:true,value:{value:1}});expect(attractor.value.argument('bad','arg')).toMatchObject({ok:true,value:{value:0}});
});
