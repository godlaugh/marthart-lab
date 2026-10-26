import {prepareSourceRealExpression,type SourceRealExpression} from './domainSourceScalar';

export type SourceAttractorEquationResult<T>={ok:true;value:T}|{ok:false;error:{kind:'input'|'capacity';path:readonly string[];reason:string}};
export interface SourceAttractorEquation {
 /** Source computes all three derivatives from the same input before Euler
  * mutates any axis. Nonfinite results remain part of the numeric state. */
 compute(x:number,y:number,z:number,out:Float32Array):void;
}
export interface SourceAttractorEquationSource {readonly equations:Readonly<Record<'dx'|'dy'|'dz',string>>;readonly parameters:Readonly<Record<string,number>>;}
export interface PreparedSourceAttractorEquation {
 /** Compiler-owned serializable input; every warmup lane compiles its own variables/scratch. */
 readonly source?:SourceAttractorEquationSource;
 readonly operations:number;
 create():SourceAttractorEquation;
}
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
/** Shared slot identity for numeric evaluation and the symbolic source label. */
export const sourceAttractorVariableNames=(parameters:Readonly<Record<string,unknown>>):string[]=>['x','y','z',...Object.keys(parameters).sort()];
/** JsonAttractorConfig.createGenericEquation and GenericDifferentialEquation.
 * Parameters are a construction-time double snapshot, including names which
 * shadow x/y/z. Sorting only chooses local slot layout; it does not reorder
 * expression arithmetic or change the source's last-write name binding. */
export function prepareSourceAttractorEquation(input:unknown):SourceAttractorEquationResult<PreparedSourceAttractorEquation>{
 const bad=(kind:'input'|'capacity',path:readonly string[],reason:string):SourceAttractorEquationResult<never>=>({ok:false,error:{kind,path,reason}});
 if(!object(input)||!object(input.equations)||!object(input.parameters))return bad('input',[],'原版吸引子需要公式与参数对象');
 const names=sourceAttractorVariableNames(input.parameters),keys=names.slice(3);
 if(names.length>8194)return bad('capacity',['parameters'],'原版吸引子变量槽超过本地 8194 项容量');
 const initial=new Float64Array(names.length);
 for(let i=0;i<keys.length;i++){
  const key=keys[i],value=input.parameters[key];
  if(typeof value!=='number'||!Number.isFinite(value))return bad('input',['parameters',key],'原版吸引子参数需要有限 double 数值');
  initial[i+3]=value;
 }
 const compiled:SourceRealExpression[]=[];
 for(const axis of ['dx','dy','dz']){
  const parsed=prepareSourceRealExpression(input.equations[axis],names);
  if(!parsed.ok)return bad(parsed.error.kind,['equations',axis],JSON.stringify(parsed.error));
  compiled.push(parsed.value);
 }
 const F=Math.fround;
 const equations=input.equations,parameters=input.parameters;
 const source:SourceAttractorEquationSource=Object.freeze({equations:Object.freeze(Object.fromEntries(['dx','dy','dz'].map(axis=>[axis,equations[axis]]))) as SourceAttractorEquationSource['equations'],parameters:Object.freeze(Object.fromEntries(keys.map(key=>[key,parameters[key]]))) as Readonly<Record<string,number>>});
 return{ok:true,value:Object.freeze({source,operations:compiled.reduce((n,e)=>n+e.operations,0),create(){
  const variables=initial.slice();
  return Object.freeze({compute(x:number,y:number,z:number,out:Float32Array){
   variables[0]=F(x);variables[1]=F(y);variables[2]=F(z);
   for(let axis=0;axis<3;axis++)out[axis]=F(compiled[axis].evaluate(variables));
  }});
 }})};
}

/** EulerIntegrator.step: d2f each derivative, then separate fmul and fadd.
 * No divergence cutoff, coordinate replacement, RK4 or hidden substeps. */
export function sourceAttractorEulerStep(equation:SourceAttractorEquation,raw:Float32Array,offset:number,dt:number,scratch:Float32Array):void {
 equation.compute(raw[offset],raw[offset+1],raw[offset+2],scratch);
 for(let axis=0;axis<3;axis++)raw[offset+axis]=Math.fround(raw[offset+axis]+Math.fround(scratch[axis]*dt));
}
