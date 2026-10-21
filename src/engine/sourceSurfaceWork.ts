/** One bounded synchronous operation. A retained owner supplies a fresh scope
 * per request; fixed reconstruction keeps one scope for its complete replay. */
export const SOURCE_SURFACE_WORK_LIMIT=20_000_000;
export class SourceSurfaceWorkError extends Error {
 readonly code='capacity';
 constructor(){super('原版曲面单次操作累计超过本地 2000 万工作单位预算');this.name='SourceSurfaceWorkError';}
}
export function sourceSurfaceWorkBudget(){
 let used=0;
 return (units:number)=>{if(!Number.isSafeInteger(units)||units<0||used+units>SOURCE_SURFACE_WORK_LIMIT)throw new SourceSurfaceWorkError();used+=units;};
}
