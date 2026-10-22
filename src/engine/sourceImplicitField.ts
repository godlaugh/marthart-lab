import type {ImplicitJob} from './implicitSurface';
import {prepareSourceRealExpression} from './domainSourceScalar';
const F=Math.fround;
export type ImplicitVec3=readonly [number,number,number];
export interface SourceImplicitField {
 readonly dimensions:ImplicitVec3;readonly min:ImplicitVec3;readonly max:ImplicitVec3;
 readonly step:ImplicitVec3;readonly scale:ImplicitVec3;readonly offset:ImplicitVec3;
 readonly iso:number;readonly isoThreshold:number;
 coordinate:(axis:number,index:number)=>number;
 evaluate:(x:number,y:number,z:number)=>number;
 world:(point:readonly number[])=>number[];
}
const triple=(values:readonly number[],label:string):ImplicitVec3=>{
 const v=values.map(F);if(v.length!==3||!v.every(Number.isFinite))throw Error(`源隐式曲面 ${label} 必须为有限 Float32 三元组`);return v as unknown as ImplicitVec3;
};
/** JsonImplicitFunction widens F32 coordinates to a reusable double[] followed
 * by sorted parameter doubles, evaluates FastExpression, then narrows to F32.
 * Mesh and slice owners share these parsed facts but retain their DIFFERENT
 * nonfinite substitutions: isoThreshold*10 versus isoLevel*10 (or 1 at zero). */
export function prepareSourceImplicitField(job:ImplicitJob):SourceImplicitField {
 const s=job.scene.settings,dimensions=job.dimensions,min=triple(job.min,'min'),max=triple(job.max,'max');
 if(!min.every((v,i)=>max[i]>v))throw Error('源隐式曲面坐标域在 Float32 中不可表示');
 if(Number(s.scale??1)!==1||['X','Y','Z'].some(a=>Number(s['rotate'+a]??0)!==0)||job.sign!==1)throw Error('源隐式曲面暂不支持附加的本地整体缩放、旋转或 inside=above');
 const scale=triple(['X','Y','Z'].map(a=>Number(s['scale'+a]??1)),'scale'),offset=triple(['X','Y','Z'].map(a=>Number(s['offset'+a]??0)),'offset'),step=triple(min.map((v,i)=>F(F(max[i]-v)/dimensions[i])),'step');
 const iso=F(job.iso),isoThreshold=Math.max(F(1e-5),F(Number(s.sourceImplicitIsoThreshold??.06)));
 if(!Number.isFinite(iso)||!Number.isFinite(isoThreshold)||step.some(v=>v<=0))throw Error('源隐式曲面阈值或格点步长无效');
 const keys=Object.keys(job.scene.parameters).sort(),parsed=prepareSourceRealExpression(job.source,['x','y','z',...keys]);if(!parsed.ok)throw Error('源隐式曲面公式无效：'+JSON.stringify(parsed.error));
 const variables=new Float64Array([0,0,0,...keys.map(k=>job.scene.parameters[k])]);
 return{dimensions,min,max,scale,offset,step,iso,isoThreshold,coordinate:(axis,index)=>F(min[axis]+F(index*step[axis])),evaluate:(x,y,z)=>{variables[0]=F(x);variables[1]=F(y);variables[2]=F(z);return F(parsed.value.evaluate(variables));},world:point=>point.map((v,i)=>F(F(v*scale[i])+offset[i]))};
}
