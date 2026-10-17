import {describe,expect,it} from 'vitest';
import {parseProjectFile} from '../src/engine/legacyImport';

const native=(extra:Record<string,unknown>)=>({config_version:'1.0.0',type:'DOMAIN_COLORING',name:'Exact source paths',domainColoring:{formula:'z'},...extra});

describe('imported field identity is separate from a displayed dotted path',()=>{
 it.each([
  ['domainColoring.formula',{}],
  ['timeline.0.duration',{timeline:[{type:'wait',duration:1}]}],
 ] as const)('does not consume the literal root key %s when a nested field was read',(key,extra)=>{
  const source=native({...extra,[key]:'unmapped literal key'}),result=parseProjectFile(JSON.stringify(source));
  expect(result.scene.equations.f).toBe('z');
  expect(result.scene.provenance?.original).toEqual(source);
  expect(result.warnings.filter(w=>w.includes('尚未映射')).join()).toContain('['+JSON.stringify(key)+']');
 });
 it('acknowledges a literal parameter key without swallowing a separate root key with the same old display path',()=>{
  const parameters=Object.fromEntries([['a.b',1],['a_b',2],['aB',3],['__proto__',4]]);
  const source=native({parameters,'parameters.a.b':'retained unknown'}),result=parseProjectFile(JSON.stringify(source));
  expect(result.scene.parameters).toEqual(parameters);
  expect(Object.hasOwn(result.scene.parameters,'__proto__')).toBe(true);
  expect(Object.getPrototypeOf(result.scene.parameters)).toBe(Object.prototype);
  const remaining=result.warnings.filter(w=>w.includes('尚未映射')).join();
  expect(remaining).toContain('["parameters.a.b"]');
  expect(remaining).not.toContain('parameters["a.b"]');
  expect(result.warnings.some(w=>w.startsWith('别名冲突'))).toBe(false);
 });
});
