import type {SourceBouncingResult} from './sourceBouncingConfig';
export const SOURCE_BOUNCING_GPU_LIMITS=Object.freeze({bytes:256*1024*1024,passes:10000,collisionEdgeWork:1_000_000_000,pointFragments:1_000_000_000});
export class SourceBouncingGpuError extends Error {
 constructor(readonly code:'input'|'capacity'|'capability'|'context'|'shader'|'render'|'cancelled'|'disposed',message:string){super(message);this.name=code==='cancelled'?'AbortError':'SourceBouncingGpuError';}
}
const F=Math.fround;
export function sourceBouncingFloat32(value:unknown):number{if(typeof value!=='number'||!Number.isFinite(value)||!Number.isFinite(F(value)))throw new SourceBouncingGpuError('input','源弹跳 uniform 需要有限 Float32');return F(value);}

export function requireSourceBouncing<T>(result:SourceBouncingResult<T>):T {
 if(!result.ok)throw new SourceBouncingGpuError(result.error.kind==='cancelled'?'cancelled':result.error.kind==='capacity'?'capacity':'input',`${result.error.path.join('.')}：${result.error.reason}`);
 return result.value;
}
