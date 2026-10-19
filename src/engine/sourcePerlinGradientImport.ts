import {importSourceParticleGradient,type SourceParticleGradientImportFacts} from './sourceParticleGradientImport';
import type {SourceGradientAction} from './sourceGradientRuntime';

/** Local per-track preparation budget, not a source JSON format limit. */
export const SOURCE_PERLIN_GRADIENT_GROUP_LIMIT=64;
export class SourcePerlinGradientImportError extends Error {
 constructor(readonly code:'input'|'capacity',message:string){super(message);this.name='SourcePerlinGradientImportError';}
}
export type SourcePerlinGradientPath=readonly string[];
interface Entry {
 readonly index:number;
 /** Original input, borrowed without mutation/traversal. The import Reader
  * owns the persisted source snapshot and any numeric-token provenance. */
 readonly source:Readonly<Record<string,unknown>>;
 readonly consumedPaths:readonly SourcePerlinGradientPath[];
 readonly diagnostics:readonly string[];
}
export type SourcePerlinGradientEntry=Entry&(
 | {readonly status:'unhandled';readonly reason:'other-method'}
 | {readonly status:'skipped';readonly reason:'args-missing'|'args-null'|'args-type'|'unknown-mode';readonly facts?:SourceParticleGradientImportFacts}
 | {readonly status:'selected';readonly action:SourceGradientAction;readonly facts?:SourceParticleGradientImportFacts}
 | {readonly status:'superseded';readonly action:SourceGradientAction;readonly supersededBy:number;readonly facts?:SourceParticleGradientImportFacts}
);
export interface SourcePerlinGradientGroup {
 readonly action?:SourceGradientAction;
 readonly selectedIndex:number|null;
 readonly entries:readonly SourcePerlinGradientEntry[];
 /** Relative to actions, including constructors later superseded. Presence
  * checks do not consume ignored payload descendants or other action families. */
 readonly consumedPaths:readonly SourcePerlinGradientPath[];
 readonly diagnostics:readonly string[];
}
const object=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const has=(value:Readonly<Record<string,unknown>>,key:string)=>Object.hasOwn(value,key);

/** JsonPerlinConfig.setupTimeline PC223/364–371/457–466 retains one gradient
 * child: the last successfully built one. Params and camera belong to their
 * own compiler; this function must not claim that their actions were handled.
 * Raw missing/invalid args skip upstream of the payload defaults. */
export function importSourcePerlinGradientGroup(rawActions:unknown):SourcePerlinGradientGroup {
 if(!Array.isArray(rawActions))throw new SourcePerlinGradientImportError('input','原版 Perlin 动作组须为数组');
 if(rawActions.length>SOURCE_PERLIN_GRADIENT_GROUP_LIMIT)throw new SourcePerlinGradientImportError('capacity','原版 Perlin 动作组超过本地 64 项准备预算');
 const entries:SourcePerlinGradientEntry[]=[],consumedPaths:SourcePerlinGradientPath[]=[],diagnostics:string[]=[];
 let selectedIndex:number|null=null,selectedAction:SourceGradientAction|undefined;
 for(let index=0;index<rawActions.length;index++){
  const source:unknown=rawActions[index];
  if(!object(source))throw new SourcePerlinGradientImportError('input',`原版 Perlin 动作 ${index} 须为对象`);
  const method=has(source,'method')?source.method:undefined;
  const paths:SourcePerlinGradientPath[]=[],notes:string[]=[];
  const base={index,source,consumedPaths:paths,diagnostics:notes};
  if(method!=='gradientStart'&&method!=='gradientStop'){
   entries.push({...base,status:'unhandled',reason:'other-method'});continue;
  }
  paths.push([String(index),'method']);
  const args=has(source,'args')?source.args:undefined;
  if(!object(args)&&!Array.isArray(args)){
   const reason=!has(source,'args')?'args-missing':args===null?'args-null':'args-type';
   if(has(source,'args'))paths.push([String(index),'args']);
   notes.push(`动作 ${index} 的 args 未解析为原版数组或对象，跳过 ${method}；原值保留在 source。`);
   entries.push({...base,status:'skipped',reason});consumedPaths.push(...paths);diagnostics.push(...notes);continue;
  }
  let action:SourceGradientAction,facts:SourceParticleGradientImportFacts|undefined;
  if(method==='gradientStop'){
   action={kind:'stop'};
   // Stop does not inspect payload. Empty containers have no unread children.
   if(Object.keys(args).length===0)paths.push([String(index),'args']);
  }else{
   facts=importSourceParticleGradient(args,'perlin');
   notes.push(...facts.diagnostics.map(note=>`动作 ${index}：${note}`));
   if(facts.payloadPath!==null){
    for(const field of facts.consumedFields){
     const payload=facts.payloadPath.length?(args as unknown[])[0] as Record<string,unknown>:args as Record<string,unknown>;
     if(has(payload,field))paths.push([String(index),'args',...facts.payloadPath,field]);
    }
    if(facts.payloadEmpty)paths.push([String(index),'args',...facts.payloadPath]);
   }else if(Object.keys(args).length===0)paths.push([String(index),'args']);
   if(facts.kind==='skip'){
    // Perlin ignores targetDomain. Only unknown mode can occur for this family.
    if(facts.reason!=='unknown-mode')throw new SourcePerlinGradientImportError('input','原版 Perlin 渐变目标解析不一致');
    entries.push({...base,status:'skipped',reason:'unknown-mode',facts});consumedPaths.push(...paths);diagnostics.push(...notes);continue;
   }
   action={kind:'start',config:facts.config};
  }
  if(selectedIndex!==null){
   const previous=entries[selectedIndex];
   if(previous.status!=='selected')throw new SourcePerlinGradientImportError('input','原版 Perlin 渐变选择状态不一致');
   entries[selectedIndex]={...previous,status:'superseded',supersededBy:index};
   diagnostics.push(`动作 ${selectedIndex} 的渐变被后续有效动作 ${index} 覆盖；两个原值均保留在 source。`);
  }
  entries.push({...base,status:'selected',action,...(facts?{facts}:{})});
  selectedIndex=index;selectedAction=action;consumedPaths.push(...paths);diagnostics.push(...notes);
 }
 return{...(selectedAction?{action:selectedAction}:{}),selectedIndex,entries,consumedPaths,diagnostics};
}
