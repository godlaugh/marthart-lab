import {prepareSourceRealExpression} from './domainSourceScalar';

export interface SourceSurfaceFunctionInput {
 readonly equations:Readonly<Record<string,string>>;
 readonly parameters:Readonly<Record<string,number>>;
 readonly scales:readonly number[];
 readonly offsets:readonly number[];
}
export class SourceSurfaceFunctionError extends Error {
 constructor(readonly code:'input'|'capacity'|'arithmetic',message:string){super(message);this.name='SourceSurfaceFunctionError';}
}
export interface SourceSurfaceFunction {
 /** Changes only when this function's evaluator slots change; replacement
  * functions and old action targets have independent revision histories. */
 readonly revision:number;
 read(name:string):number;
 write(name:string,value:number):boolean;
 position(u:number,v:number,out:Float32Array,offset?:number,includeOffset?:boolean):boolean;
 /** A mode switch constructs a new function from the replay's current base
  * constants. Old functions keep separate slots but still write that base. */
 recreate():SourceSurfaceFunction;
}
/** JsonSurfaceFunction owns sorted constant slots after u/v. Every replay gets
 * its own mutable values; compiled expressions and authored input stay shared
 * and immutable. Point motion and mesh sampling must use these same facts. */
export function prepareSourceSurfaceFunction(input:SourceSurfaceFunctionInput){
 const F=Math.fround,keys=Object.keys(input.parameters).sort();
 if(keys.length>8192)throw new SourceSurfaceFunctionError('capacity','原版曲面参数超过 8192 项本地容量');
 const transform=(values:readonly number[],label:string)=>{
  if(values.length!==3||values.some(value=>typeof value!=='number'||!Number.isFinite(F(value))))throw new SourceSurfaceFunctionError('input',`原版曲面 ${label} 需要三个有限 Float32 数值`);
  return values.map(F);
 };
 const scales=transform(input.scales,'分轴缩放'),offsets=transform(input.offsets,'坐标偏移');
 const names=['u','v',...keys],initial=new Float64Array(names.length),slots=new Map(keys.map((key,i)=>[key,i+2]));
 keys.forEach((key,i)=>{const value=input.parameters[key];if(!Number.isFinite(value))throw new SourceSurfaceFunctionError('input',`原版曲面参数 ${key} 必须有限`);initial[i+2]=value;});
 const expressions=['x','y','z'].map(key=>{
  const parsed=prepareSourceRealExpression(input.equations[key],names);
  if(!parsed.ok)throw new SourceSurfaceFunctionError(parsed.error.kind==='capacity'?'capacity':'input',`原版曲面公式 ${key}：${JSON.stringify(parsed.error)}`);
  return parsed.value;
 });
 return Object.freeze({
  operations:expressions.reduce((sum,expression)=>sum+expression.operations,0),
  create():SourceSurfaceFunction {
   const constants=initial.slice();
   const instantiate=():SourceSurfaceFunction=>{
   const variables=constants.slice();let revision=0;
   return Object.freeze({
    get revision(){return revision;},
    read(name:string):number {const slot=slots.get(name);return slot===undefined?0:variables[slot];},
    write(name:string,value:number):boolean {
     const slot=slots.get(name);if(slot===undefined)return false;
     if(!Number.isFinite(value))throw new SourceSurfaceFunctionError('arithmetic',`原版曲面参数 ${name} 产生非有限值`);
     if(!Object.is(variables[slot],value))revision++;
     variables[slot]=value;constants[slot]=value;return true;
    },
    /** Float conversion precedes scale and offset independently. Mesh seam
     * closure probes intentionally omit offsets; rendered/shift samples include
     * them. Do not repair nonfinite samples here: each consumer owns whether
     * they mean an invalid head, skipped quad, or a trail break. */
    position(u:number,v:number,out:Float32Array,offset=0,includeOffset=true):boolean {
     // calculate(FF...) receives floats before widening into evaluator slots.
     variables[0]=F(u);variables[1]=F(v);let finite=true;
     for(let axis=0;axis<3;axis++){
      const scaled=F(F(expressions[axis].evaluate(variables))*scales[axis]);
      const value=includeOffset?F(scaled+offsets[axis]):scaled;
      out[offset+axis]=value;finite&&=Number.isFinite(value);
     }
     return finite;
    },
    recreate:instantiate,
   });
   };
   return instantiate();
  },
 });
}
export type PreparedSourceSurfaceFunction=ReturnType<typeof prepareSourceSurfaceFunction>;
