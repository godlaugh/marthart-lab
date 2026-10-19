/** One synchronous operation/request, not the lifetime of a reusable producer. */
export const SOURCE_ATTRACTOR_WORK_LIMIT=20_000_000;
export class SourceAttractorWorkError extends Error {
 readonly code='capacity';
 constructor(){super('原版吸引子单次请求超过本地 2000 万工作单位预算');this.name='SourceAttractorWorkError';}
}
export function sourceAttractorWorkBudget(parent?:(units:number)=>void){
 let used=0;
 return (units:number)=>{
  if(!Number.isSafeInteger(units)||units<0||used+units>SOURCE_ATTRACTOR_WORK_LIMIT)throw new SourceAttractorWorkError();
  parent?.(units);used+=units;
 };
}
