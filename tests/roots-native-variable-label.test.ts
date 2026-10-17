import {describe,it,expect} from 'vitest';
import {parseProjectFile} from '../src/engine/legacyImport';
import {parseScene,persistentScene} from '../src/engine/document';
import {parseRootsMath,createRootsNativeMath} from '../src/engine/rootsMathConfig';
import {prepareRootsNativePolynomial,ROOTS_NATIVE_POLYNOMIAL_LIMITS} from '../src/engine/rootsNativePolynomial';
import {prepareRootsVariableLabel} from '../src/engine/rootsVariableLabel';
import {sceneAtTime} from '../src/engine/timeline';
const text=(value:string)=>'{"config_version":"1.0.0","type":"COMPLEX_ROOTS","name":"label","polynomial":{"variable":'+value+',"coefficients":{"1":"1","0":"-1"}},"sampling":{"sample_count":2}}';
const table=(variable:unknown)=>({...createRootsNativeMath().polynomial,variable:variable as ReturnType<typeof createRootsNativeMath>['polynomial']['variable'],coefficients:[{exponent:'1',expression:'1'}]});
describe('Lossless unresolved Roots variable labels',()=>{
 it.each(['1e309','-1e309'])('keeps source overflow token %s as its known Java string',token=>{
  const s=parseProjectFile(text(token)).scene;expect(s.rootsMath!.polynomial.variable).toBe(token);expect(parseScene(JSON.stringify(persistentScene(s))).rootsMath!.polynomial.variable).toBe(token);
 });
 it.each(['1.0','[1e309,-1e309,9007199254740993,1.0]', '{"nested":[{"x":1e309,"n":null}],"zero":-0.0}', '{"sourceJson":"1e309","sourceValue":null}'])('preserves exact JSON label %s through file save, timeline and active polynomial preparation',token=>{
  const s=parseProjectFile(text(token)).scene;expect(s.rootsMath!.polynomial.variable).toEqual({sourceJson:token});
  s.timeline.tracks=[{id:'view',type:'numeric',target:'settings.rootScale',from:1,to:2,start:0,duration:1,easing:'linear',pingPong:false,enabled:true}];
  const saved=JSON.stringify(persistentScene(s)),loaded=parseScene(saved),frame=sceneAtTime(loaded,.5);expect(frame.rootsMath!.polynomial.variable).toEqual({sourceJson:token});
  const p=prepareRootsNativePolynomial(frame.rootsMath!.polynomial);expect(p.ok).toBe(true);if(p.ok){expect(p.value.variable).toBeUndefined();expect(p.value.variableFacts.status).toBe('unknown');expect(p.value.evaluate(new Map())).toMatchObject({ok:true});p.value.dispose();}
 });
 it('binds a selected final member span without confusing objects or escaped property names',()=>{
  const s=parseProjectFile(text('{"\\u0078":1e309,"x2":[1.0]}')).scene;expect(s.rootsMath!.polynomial.variable).toEqual({sourceJson:'{"\\u0078":1e309,"x2":[1.0]}'});
  expect(()=>parseProjectFile(text('{"x":1,"x":2}'))).toThrow('duplicate-key');
 });
 it('retains old sourceValue wrappers without migrating or guessing null',()=>{
  const variable={sourceValue:1.5,numberToken:'1.5'},c=createRootsNativeMath();c.polynomial=table(variable);expect(parseRootsMath(c).polynomial.variable).toEqual(variable);expect(prepareRootsNativePolynomial(c.polynomial)).toMatchObject({ok:true});
  expect(prepareRootsVariableLabel({sourceValue:null,numberToken:'1e309'})).toMatchObject({ok:false,error:{kind:'input'}});
 });
 it('rejects ambiguous wrappers and malformed label JSON at their owner boundary',()=>{
  for(const variable of [{sourceJson:'{}',sourceValue:{}},{sourceJson:'{'},{sourceJson:1},{}])expect(prepareRootsVariableLabel(variable)).toMatchObject({ok:false,error:{kind:'input'}});
 });
 it('counts retained JSON label text before native polynomial preparation',()=>{
  const p=prepareRootsNativePolynomial(table({sourceJson:'"'+'a'.repeat(ROOTS_NATIVE_POLYNOMIAL_LIMITS.totalCharacters)+'"'}));expect(p).toMatchObject({ok:false,error:{kind:'capacity',facts:{resource:'variable label characters'}}});
  const depth=prepareRootsVariableLabel({sourceJson:'['.repeat(65)+'1'+']'.repeat(65)});expect(depth).toMatchObject({ok:false,error:{kind:'capacity',facts:{resource:'variable label depth'}}});
 });
});
