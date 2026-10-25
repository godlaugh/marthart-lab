import {describe,expect,it} from 'vitest';
import {bindSymmetryCustomParameters,prepareSymmetryCustomSource,prepareSymmetryCustomInput,MAX_SYMMETRY_CUSTOM_SOURCE_LENGTH} from '../src/engine/symmetryCustom';
import {prepareSourceSymmetryCustomProgram,SOURCE_SYMMETRY_CUSTOM_DIALECT} from '../src/engine/sourceSymmetryCustom';

describe('source custom fragment format boundary',()=>{
 it('shares original placeholder and narrow binding facts without ES policy rewriting',()=>{
  const raw='#define LIMIT {N_MINUS_2}\n// uniform float commented;\nuniform float steps;uniform float dimension;uniform float oldState;uniform highp float qualified;uniform float first,second;\nvoid calculate_next(in vec3 pos,out vec3 nextPos,out float metric){nextPos=pos;for(int i=0;i<LIMIT;i++)nextPos.x+=steps;metric=float({N});}\n';
  const input=prepareSymmetryCustomInput(raw,7),native=prepareSourceSymmetryCustomProgram(raw,7);
  expect(native.rawSource).toBe(raw);expect(native.expandedSource).toBe(input.expandedSource);expect(native.bindingNames).toEqual(['commented','steps','dimension','oldState']);
  expect(native.dialect).toBe(SOURCE_SYMMETRY_CUSTOM_DIALECT);expect(native.expandedSource).toContain('#define LIMIT 5');expect(native.fragment).toContain(input.expandedSource);expect(native.fragment).not.toContain('rea_customLoopTick');
  expect(bindSymmetryCustomParameters(native,{steps:2,dimension:3,oldState:5,qualified:9})).toEqual({commented:0,steps:2,dimension:3,oldState:5});
  expect(()=>prepareSymmetryCustomSource(raw,7)).toThrow('预处理');
 });
 it('keeps native fragment globals and ordinary uniforms distinct from TF or ES host names',()=>{
  const raw='uniform float rea_gain;void calculate_next(in vec3 pos,out vec3 nextPos,out float metric){nextPos=texture(stateTex,texCoord).xyz+gl_FragCoord.xyz*rea_gain;metric=float(iterations);}';
  const native=prepareSourceSymmetryCustomProgram(raw,5);expect(native.bindingNames).toEqual(['rea_gain']);expect(native.fragment).toContain(raw);expect(()=>prepareSymmetryCustomSource(raw,5)).toThrow('前缀');
  expect(bindSymmetryCustomParameters(native,{rea_gain:1e300})).toEqual({rea_gain:0});
 });
 it('retains the common source text and expansion budgets before native assembly',()=>{
  expect(()=>prepareSourceSymmetryCustomProgram('a'.repeat(MAX_SYMMETRY_CUSTOM_SOURCE_LENGTH+1),5)).toThrow('64 Ki');
  expect(()=>prepareSourceSymmetryCustomProgram('{N}'.repeat(20000),2147483647)).toThrow('96 Ki');
  expect(()=>prepareSourceSymmetryCustomProgram(' ',5)).toThrow('为空');
  expect(()=>prepareSourceSymmetryCustomProgram('validity belongs to the GL compiler',1)).toThrow('阶数');
 });
});
