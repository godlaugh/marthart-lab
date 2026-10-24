import {describe,it,expect} from 'vitest';
import original from './fixtures/source-bouncing-number-controls/native.json';
import {bouncingNumberRules,formatSourceNumber,parseSourceNumberInput,type SourceNumberRules} from '../src/components/sourceBouncingNumbers';
const doubleBits=(value:number)=>{const bytes=new DataView(new ArrayBuffer(8));bytes.setFloat64(0,value);return bytes.getBigUint64(0).toString(16).padStart(16,'0');};
const floatBits=(value:number)=>{const bytes=new DataView(new ArrayBuffer(4));bytes.setFloat32(0,value);return bytes.getUint32(0).toString(16).padStart(8,'0');};
describe('original JVM numeric helper records',()=>{
 it('matches all 33 format samples without changing the input precision',()=>{
  for(const row of original.cases.filter(r=>r.kind==='format'))expect(formatSourceNumber(Number(row.input.value!.text),row.input.precision!,row.input.isInteger),row.id).toBe(row.output.text);
 });
 it('matches 48 bounded parse samples before and after the Float callback conversion',()=>{
  for(const row of original.cases.filter(r=>r.kind==='parse')){
   const result=parseSourceNumberInput(row.input.text!,{integer:row.input.isInteger,min:Number(row.input.low!.text),max:Number(row.input.high!.text),precision:3,step:1});
   if(row.output.isNull)expect(result,row.id).toBeUndefined();
   else{expect(doubleBits(result!),row.id).toBe(row.output.double!.bits);expect(floatBits(result!),row.id).toBe(row.output.float32!.bits);}
  }
 });
 it('matches the ten original resolved steps used by these seven controls',()=>{
  const field:Record<string,SourceNumberRules>={particles:bouncingNumberRules.particleCount,'time-step':bouncingNumberRules.timeStep,speed:bouncingNumberRules.initialSpeed,direction:bouncingNumberRules.initialAngle,spread:bouncingNumberRules.initialAngleSpread,'lissajous-delta':bouncingNumberRules.shapeLissajousDelta};
  for(const row of original.cases.filter(r=>r.kind==='step')){const rule=row.id.startsWith('step-substeps-')?bouncingNumberRules.subSteps:field[row.id.slice(5)],step=typeof rule.step==='function'?rule.step(Number(row.input.value!.text)):rule.step;expect(doubleBits(step),row.id).toBe(row.output.double!.bits);}
 });
 it('rejects unsupported nonfinite or malformed input without replacing it with zero',()=>{
  for(const input of ['Infinity','NaN','1/0','0/0','nope',''])expect(parseSourceNumberInput(input,bouncingNumberRules.initialSpeed),input).toBeUndefined();
 });
});
