import {numberSetting,random} from './expression';
import type {Settings} from '../types';
export const MAX_ATTRACTOR_GPU_PARTICLES=2_000_000;
export const ATTRACTOR_SEED_CHUNK=65536;
export interface AttractorInitialConfig {
 count:number;seed:number;spread:number;burn:number;staggerMin:number;staggerMax:number;
 initial:[number,number,number];min:[number,number,number];max:[number,number,number];bounds:boolean;variableTimeStep:boolean;
}
const integer=(s:Settings,key:string,fallback:number,min:number,max:number)=>{const n=numberSetting(s,key,fallback,min,max);if(!Number.isInteger(n))throw new Error(`${key} 必须是整数`);return n;};
/** One initialization interpretation. CPU/GPU capacity admission is separate from
 * the seed configuration, so a fallback cannot silently change particle count. */
export function parseAttractorInitial(s:Settings):AttractorInitialConfig {
 const count=integer(s,'particleCount',1,1,MAX_ATTRACTOR_GPU_PARTICLES),seed=integer(s,'seed',42,0,0xffffffff),spread=numberSetting(s,'initialSpread',.01,0,1e6),burn=integer(s,'burnIn',500,0,100000),staggerMin=integer(s,'staggerMin',0,0,100000),staggerMax=integer(s,'staggerMax',0,0,100000);
 if(staggerMax<staggerMin)throw new Error('随机预热上限必须不小于下限');
 const initial=['X','Y','Z'].map(axis=>numberSetting(s,`initial${axis}`,axis==='X'?.1:0))as [number,number,number],min=['X','Y','Z'].map(axis=>numberSetting(s,`initialMin${axis}`,-.1))as [number,number,number],max=['X','Y','Z'].map(axis=>numberSetting(s,`initialMax${axis}`,.1))as [number,number,number];
 if(max.some((value,i)=>value<min[i]))throw new Error('初始坐标上限必须不小于下限');
 return{count,seed,spread,burn,staggerMin,staggerMax,initial,min,max,bounds:s.useInitialBounds===true,variableTimeStep:s.variableTimeStep===true};
}
export type AttractorSeedVisitor=(id:number,x:number,y:number,z:number,dtFraction:number,warmup:number)=>void;
/** Sequential canonical PRNG ownership. Chunking preserves the established CPU
 * sequence including count=1, optional bounds, dt randomness and stagger draws. */
export class AttractorSeedStream {
 private readonly rng:()=>number;private offset=0;private failed=false;
 constructor(readonly config:AttractorInitialConfig){this.rng=random(config.seed);}
 get nextIndex(){return this.offset;}
 read(count:number,visit:AttractorSeedVisitor,isCancelled?:()=>boolean):void {
  if(this.failed)throw new Error('吸引子种子流已失败；请从原始种子重建');
  if(!Number.isInteger(count)||count<0||this.offset+count>this.config.count)throw new Error('吸引子种子分块范围无效');
  const c=this.config,end=this.offset+count;
  try{for(;this.offset<end;this.offset++){
   if((this.offset&1023)===0&&isCancelled?.())throw new DOMException('吸引子初始化已取消','AbortError');
   const axis=(i:number)=>c.bounds?c.min[i]+this.rng()*(c.max[i]-c.min[i]):c.initial[i]+(c.count>1?(this.rng()*2-1)*c.spread:0);
   const x=axis(0),y=axis(1),z=axis(2),dt=c.variableTimeStep?this.rng():random((c.seed^Math.imul(this.offset+1,2654435761))>>>0)(),warmup=c.burn+(c.staggerMax>0?c.staggerMin+Math.floor(this.rng()*(c.staggerMax-c.staggerMin+1)):0);
   visit(this.offset,x,y,z,dt,warmup);
  }}catch(error){this.failed=true;throw error;}
 }
 chunk(count:number,isCancelled?:()=>boolean):{offset:number;positions:Float32Array;initial:Float32Array}{
  if(!Number.isInteger(count)||count<1||count>ATTRACTOR_SEED_CHUNK||this.offset+count>this.config.count)throw new Error('吸引子 GPU 种子分块须为 1–65536 且不超总数');
  const offset=this.offset,positions=new Float32Array(count*4),initial=new Float32Array(count*2);
  this.read(count,(id,x,y,z,dt,warmup)=>{const i=id-offset;if(![x,y,z].every(v=>Number.isFinite(Math.fround(v))))throw new Error('吸引子初始位置超出 GPU float32 范围');positions[i*4]=x;positions[i*4+1]=y;positions[i*4+2]=z;initial[i*2]=dt;initial[i*2+1]=warmup;},isCancelled);
  return{offset,positions,initial};
 }
}
