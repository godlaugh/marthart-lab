import type {IteratedFrameJob,IteratedField} from '../scenes/iteratedDensity';
import {iteratedGpuFieldSource,sourceIteratedGpuPrograms,type SourceIteratedGpuProgramSource} from './iteratedDensityGpuPrograms';
import {prepareSourceIteratedAdvancePlan} from './sourceIteratedAdvancePlan';
import {sourceIteratedPrefixWork} from './sourceIteratedWork';
import {sourceProcessingAutomaticSetters} from './sourceProcessingAutomaticBindings';
import {SOURCE_SYMMETRY_CUSTOM_DIALECT,type SourceSymmetryCustomProgram} from './sourceSymmetryCustom';
import {sourceIteratedNativeSourceProgramBytes,sourceIteratedNativeProgramBytes,sourceIteratedNativeResidentBytes,sourceSymmetryNativeResidentBytes,type SourceIteratedNativeOperation} from './sourceIteratedNativeProtocol';
import {SourceNativeError} from './sourceNativeError';

export type SourceIteratedNativeProgram=
 | {profile:undefined;source:SourceIteratedGpuProgramSource}
 | {profile:'source-fragment';source:Pick<SourceSymmetryCustomProgram,'vertex'|'fragment'|'bindingNames'>};
type Advance=Extract<SourceIteratedNativeOperation,{kind:'advance'|'advance-processing-fragment'}>;
export type SourceIteratedNativeAdvance=Advance extends infer A?A extends Advance?Omit<A,'resource'|'expectedIndex'|'expectedCount'>:never:never;
function demand(ok:unknown,message:string):asserts ok {if(!ok)throw new SourceNativeError('input',message);}
export function sameSourceIteratedNativeProgram(a:SourceIteratedNativeProgram,b:SourceIteratedNativeProgram):boolean {
 if(a.profile!==b.profile)return false;
 if(a.profile==='source-fragment'&&b.profile==='source-fragment')return a.source.vertex===b.source.vertex&&a.source.fragment===b.source.fragment&&a.source.bindingNames.length===b.source.bindingNames.length&&a.source.bindingNames.every((n,i)=>n===b.source.bindingNames[i]);
 if(a.profile===undefined&&b.profile===undefined)return(['vertex','fragment','diagnosticVertex','diagnosticFragment'] as const).every(k=>a.source[k]===b.source[k]);
 return false;
}
function program(field:IteratedField):SourceIteratedNativeProgram {
 if(field.kind==='symmetry-custom'){
  demand(field.plan.dialect===SOURCE_SYMMETRY_CUSTOM_DIALECT,'原生自定义 Symmetry 必须由原生 GLSL 生产边界准备');
  return{profile:'source-fragment',source:Object.freeze({vertex:field.plan.vertex,fragment:field.plan.fragment,bindingNames:Object.freeze([...field.plan.bindingNames])})};
 }
 const source=iteratedGpuFieldSource(field,'native-gl41');demand(source.sourceCalculateNext&&source.stage!=='fragment','原生迭代后端需要源 calculate_next 模型');
 return{profile:undefined,source:sourceIteratedGpuPrograms(source)};
}
function workPlan(job:IteratedFrameJob,resetParticles:boolean){
 const plan=prepareSourceIteratedAdvancePlan(job,resetParticles),count=job.config.count,fragment=job.field.kind==='symmetry-custom';
 demand(Number.isSafeInteger(count)&&count>0&&count<=8_000_000,'源原生迭代粒子数无效');
 const stateWidth=fragment?Math.ceil(Math.sqrt(count)):Math.min(2048,count);
 const work=fragment?stateWidth**2*(plan.advances.reduce((n,a)=>n+a.steps+1,0)+(!plan.advances.length&&plan.resetParticles?1:0)):count*(plan.advances.reduce((n,a)=>n+sourceIteratedPrefixWork(a.steps,resetParticles||a.resetCounter),0)+(!plan.advances.length&&plan.resetParticles?sourceIteratedPrefixWork(0,true):0));
 return{plan,work,stateWidth};
}
/** Admission does not rebuild source programs or allocate automatic uniforms. */
export function estimateSourceIteratedNativeWork(job:IteratedFrameJob,resetParticles:boolean):number{return workPlan(job,resetParticles).work;}
/** Lower source calls without translating a budgeted ES program to GL41.
 * A fragment pass preserves its entire square texture and classifies only the
 * completed state. Prefix execution retains its per-iteration diagnostics.
 * Context snapshots must come from the host graphics owner, never state size.
 */
export function prepareSourceIteratedNativeFrame(job:IteratedFrameJob,resetParticles:boolean){
 const {plan,work,stateWidth}=workPlan(job,resetParticles),selected=program(job.field),count=job.config.count;
 demand((job.kind==='map'||job.kind==='symmetry')&&(job.config.dimension===2||job.kind==='map'&&job.config.dimension===3),'原生迭代后端支持二维源 Symmetry 和二维/三维源 Map');
 let automatic:Extract<Advance,{kind:'advance-processing-fragment'}>['automatic']|undefined;
 if(selected.profile==='source-fragment'){
  demand(job.kind==='symmetry'&&job.processingContext,'自定义 Symmetry 缺少宿主提供的 Processing graphics 上下文');
  const prepared=sourceProcessingAutomaticSetters(job.processingContext);if(!prepared.ok)throw new SourceNativeError('input',prepared.error.message);automatic=prepared.value;
 }
 const advance=(field:IteratedField,steps:number,reset:boolean,resetCounter:boolean):SourceIteratedNativeAdvance=>{
  demand(sameSourceIteratedNativeProgram(selected,program(field)),'一次原生迭代更新不能切换计算程序');
  if(selected.profile==='source-fragment'){
   demand(field.kind==='symmetry-custom','原生自定义 Symmetry 参数类型无效');
   return{kind:'advance-processing-fragment',steps,reset,resetCounter,automatic:automatic!,parameters:field.plan.bindingNames.map(name=>({name,value:field.uniforms[name]}))};
  }
  return{kind:'advance',steps,reset,resetCounter,dimension:job.config.dimension,uniforms:Object.entries(iteratedGpuFieldSource(field,'native-gl41').uniforms).map(([name,value])=>({name,value}))};
 };
 const advances=plan.advances.map((a,i)=>{const reset=plan.resetParticles&&i===0;return advance(a.field,a.steps,reset,reset||a.resetCounter);});
 if(!advances.length&&plan.resetParticles)advances.push(advance(job.field,0,true,true));
 // Work is a scheduling estimate, not a wall-time/termination bound on an
 // arbitrary author's calculate_next body. Charge padding and classification.
 const bytes=selected.profile==='source-fragment'?sourceSymmetryNativeResidentBytes(count,sourceIteratedNativeProgramBytes(selected.source),selected.source.bindingNames):sourceIteratedNativeResidentBytes(count,sourceIteratedNativeSourceProgramBytes(selected.source));
 return{plan,program:selected,advances,work,bytes,stateWidth};
}
