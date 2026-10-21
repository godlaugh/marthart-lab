import {JavaSourceRandom48} from './javaSourceRandom';
/** Seed identity is owned here, independent of CPU/GPU implementations. */
export interface IteratedSeedConfig {count:number;sourceInitialSeed?:string;seed:number;dimension:2|3;bounds:[number,number][];}
type Point3=[number,number,number];
const MAX_BATCH=8_000_000;
/** Independent counter PRNG: sample identity does not depend on traversal/chunk size.
 * This is intentionally not the reference application's system frame RNG. */
export function iteratedUniform(seed:number,index:number,frame:number,channel:number):number {
 for(const [v,max]of [[seed,0xffffffff],[index,MAX_BATCH],[frame,Number.MAX_SAFE_INTEGER],[channel,255]])if(!Number.isSafeInteger(v)||v<0||v>max)throw new Error('持续采样随机地址无效');
 return uniform(seed,index,frame,channel);
}
export function uniform(seed:number,index:number,frame:number,channel:number):number {
 let x=(seed^Math.imul(index+1,0x9e3779b1)^Math.imul(frame>>>0,0x85ebca77)^Math.imul(Math.floor(frame/4294967296),0xc2b2ae3d)^Math.imul(channel+1,0x27d4eb2d))>>>0;
 x=Math.imul(x^(x>>>16),0x7feb352d);x=Math.imul(x^(x>>>15),0x846ca68b);return((x^(x>>>16))>>>0)/4294967296;
}
export const initialPoint=(cfg:IteratedSeedConfig,index:number,serial:number):Point3=>cfg.bounds.map(([lo,hi],axis)=>axis===2&&cfg.dimension===2?0:lo+(hi-lo)*uniform(cfg.seed,index,serial,axis)) as Point3;
/** Bounded, canonical initial seeds for GPU upload. Only initialization runs on
 * CPU; backend recurrence/burn-in and accumulation remain GPU operations. */
export function iteratedInitialChunk(cfg:IteratedSeedConfig,offset:number,count:number):Float32Array {return seedChunk(cfg,offset,count,0);}
/** Canonical fresh plane samples for one Samila batch, before its GPU formulas. */
export function iteratedSamilaSeedChunk(cfg:Pick<IteratedSeedConfig,'seed'|'count'>,frame:number,lo:number,hi:number,offset:number,count:number,allowEqual=false):Float32Array {
 if(!Number.isSafeInteger(frame)||frame<0||!Number.isFinite(lo)||!Number.isFinite(hi)||(allowEqual?hi<lo:hi<=lo))throw new Error('Samila 随机批次边界无效');
 return seedChunk({...cfg,dimension:2,bounds:[[lo,hi],[lo,hi],[0,0]]},offset,count,frame);
}
function seedChunk(cfg:IteratedSeedConfig,offset:number,count:number,serial:number):Float32Array {
 if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(count)||offset<0||count<0||count>65536||offset+count>cfg.count||!Number.isSafeInteger(cfg.count)||cfg.count<1||cfg.count>MAX_BATCH||![2,3].includes(cfg.dimension)||!Number.isInteger(cfg.seed)||cfg.seed<0||cfg.seed>0xffffffff||cfg.bounds.length!==3||cfg.bounds.some(b=>b.length!==2||!b.every(Number.isFinite)||b[1]<b[0]))throw new Error('持续粒子初始块边界无效');
 if(cfg.sourceInitialSeed!==undefined){
  if(serial!==0||!/^[-]?[0-9]{1,19}$/.test(cfg.sourceInitialSeed))throw Error('源初态随机地址无效');
  const rng=new JavaSourceRandom48(BigInt(cfg.sourceInitialSeed));
  const axes=cfg.bounds.slice(0,2).map(([lo,hi])=>[Math.fround(lo),Math.fround(hi)]);
  if(axes.flat().some(v=>!Number.isFinite(v)))throw Error('源初始盒超出 float32');
  rng.skipFloatDraws(offset*(axes.filter(([lo,hi])=>hi>lo).length+(cfg.dimension===3?1:0)));
  const out=new Float32Array(count*4);
  for(let j=0;j<count;j++){
   for(let axis=0;axis<2;axis++){const [lo,hi]=axes[axis];out[j*4+axis]=hi<=lo?lo:Math.fround(lo+Math.fround(rng.nextFloat()*Math.fround(hi-lo)));}
   // Native 3D Map always draws Z in [-1,1], independently of X/Y collapse.
   if(cfg.dimension===3)out[j*4+2]=Math.fround(Math.fround(rng.nextFloat()*2)-1);
  }
  return out;
 }
 const out=new Float32Array(count*4);
 for(let axis=0;axis<cfg.dimension;axis++){const [lo,hi]=cfg.bounds[axis],span=hi-lo;for(let j=0;j<count;j++){const value=lo+span*uniform(cfg.seed,offset+j,serial,axis);if(!Number.isFinite(Math.fround(value)))throw new Error('初始粒子超出 GPU float32');out[j*4+axis]=value;}}
 return out;
}
