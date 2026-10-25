import type {IteratedField,IteratedFrameJob} from '../scenes/iteratedDensity';

export interface SourceIteratedAdvance {
 readonly phase:'warmup'|'update'|'frame';
 readonly field:IteratedField;
 readonly steps:number;
 readonly serial:number;
 readonly resetCounter:boolean;
}
export interface SourceIteratedAdvancePlan {
 readonly resetParticles:boolean;
 readonly warmupSteps:number;
 readonly iterationSteps:number;
 readonly advances:readonly SourceIteratedAdvance[];
 readonly publishState:boolean;
 readonly reportInvalid:boolean;
}
const checked=(condition:unknown,message:string)=>{if(!condition)throw Error(message);};
/** Lower an already prepared Map/Symmetry frame into ordered compute calls.
 * The frame producer owns source event/replay semantics; this owner only splits
 * admitted work into GPU calls and assigns their counter/random-address facts.
 * Fields are borrowed from the caller's prepared frame (the async Session owns
 * its detached snapshot). No shader compilation, clock read or GPU mutation.
 * Resetting canonical seeds is distinct from clearing per-display counters:
 * a reset with no advances still restores seeds and valid metadata.
 */
export function prepareSourceIteratedAdvancePlan(job:IteratedFrameJob,resetParticles:boolean):SourceIteratedAdvancePlan {
 checked((job.kind==='map'||job.kind==='symmetry')&&typeof resetParticles==='boolean','GPU 迭代推进类型无效');
 const cfg=job.config,frame=job.iterationFrame,fields=job.iterationUpdates;
 checked(Number.isSafeInteger(cfg.burn)&&cfg.burn>=0&&cfg.burn<=100000&&Number.isSafeInteger(cfg.iterations)&&cfg.iterations>=1&&cfg.iterations<=16,'GPU 迭代推进步数无效');
 const warmup=frame?.warmupSteps??(resetParticles?cfg.burn:0),iterations=frame?.iterationSteps??cfg.iterations;
 if(frame)checked(frame.model===`${job.kind}-frame-1.7.8`&&Number.isSafeInteger(warmup)&&warmup>=0&&warmup<=cfg.burn&&(frame.phase==='replay'?frame.objectUpdates===0&&(iterations===0||iterations===cfg.iterations):frame.phase===undefined&&Number.isInteger(frame.objectUpdates)&&frame.objectUpdates>=0&&frame.objectUpdates<=2&&iterations===frame.objectUpdates*cfg.iterations&&(!warmup||frame.objectUpdates>0)),'GPU 迭代更新计划无效');
 if(fields!==undefined)checked(Array.isArray(fields)&&!!frame&&frame.phase===undefined&&fields.length===frame.objectUpdates&&Array.from(fields).every(field=>field&&field.kind===job.field.kind),'GPU 迭代有序更新字段无效');
 if(frame?.objectUpdates===2)checked(fields?.length===2,'GPU 迭代两次更新需要各自字段');
 checked(Number.isSafeInteger(job.frame)&&job.frame>=0&&cfg.burn+1+job.frame*(frame?32:16)+Math.max(iterations,cfg.iterations)<=0xffffffff,'GPU 随机序号超出 32 位');
 const advances:SourceIteratedAdvance[]=[];
 for(let offset=0;offset<warmup;offset+=256)advances.push({phase:'warmup',field:fields?.[0]??job.field,steps:Math.min(256,warmup-offset),serial:offset+1,resetCounter:offset===0});
 if(fields!==undefined)for(let i=0;i<fields.length;i++)advances.push({phase:'update',field:fields[i],steps:cfg.iterations,serial:cfg.burn+1+job.frame*32+i*cfg.iterations,resetCounter:i===0&&!resetParticles&&warmup===0});
 else if(iterations>0)advances.push({phase:'frame',field:job.field,steps:iterations,serial:cfg.burn+1+job.frame*16,resetCounter:!resetParticles&&warmup===0});
 return{resetParticles,warmupSteps:warmup,iterationSteps:iterations,advances,publishState:resetParticles||warmup>0||iterations>0,reportInvalid:!frame||frame.objectUpdates>0||frame.phase==='replay'&&(warmup>0||iterations>0)};
}
