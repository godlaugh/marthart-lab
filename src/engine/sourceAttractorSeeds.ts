import {JavaSourceRandom48} from './javaSourceRandom';
import {parseSourceAttractorConfiguration,type SourceAttractorConfiguration,type SourceAttractorError,type SourceAttractorResult} from './sourceAttractorConfig';
export type SourceAttractorVec3=readonly [number,number,number];
export interface SourceAttractorSeed {
 readonly index:number;readonly raw:SourceAttractorVec3;readonly position:SourceAttractorVec3;readonly dt:number;
 /** CPU integration count, including nonpositive Java int overflow results.
  * GPU CPU-side camera references are not warmed up and report 0 here. */
 readonly warmupSteps:number;
}
export interface SourceAttractorSeedStream {
 readonly count:number;readonly variableDt:boolean;
 /** New detached facts per call. A failed stream keeps its first failure. */
 next():SourceAttractorResult<SourceAttractorSeed|null>;
}
const F=Math.fround;
/** StrangeAttractor.initParticles uses Random(12345).nextFloat in XYZ then dt
 * order. warmup uses an independent Random(12345).nextInt, precomputed in slot
 * order before parallel integration. This stream describes initial facts only;
 * it does not integrate, allocate particle arrays, compact or respawn slots. */
export function createSourceAttractorSeedStream(input:SourceAttractorConfiguration):SourceAttractorResult<SourceAttractorSeedStream>{
 const parsed=parseSourceAttractorConfiguration(input);if(!parsed.ok)return parsed;
 const configuration=parsed.value,count=configuration.nativeBackend==='cpu'?configuration.particleCountCPU:configuration.particleCountGPU;
 if(count<0)return{ok:false,error:{kind:'input',path:[configuration.nativeBackend==='cpu'?'particleCountCPU':'particleCountGPU'],reason:'源负粒子数不能分配数组'}};
 const rng=new JavaSourceRandom48(12345n),warmupRng=new JavaSourceRandom48(12345n);
 const b=configuration.bounds,t=configuration.transform;
 const minimum=[F(b.minX),F(b.minY),F(b.minZ)],maximum=[F(b.maxX),F(b.maxY),F(b.maxZ)];
 const width=minimum.map((value,i)=>F(maximum[i]-value));
 const scale=[F(t.scaleX),F(t.scaleY),F(t.scaleZ)],offset=[F(t.offsetX),F(t.offsetY),F(t.offsetZ)];
 let dtMin=F(configuration.dtRange.min),dtMax=F(configuration.dtRange.max);
 if(dtMin>dtMax)[dtMin,dtMax]=[dtMax,dtMin];
 const span=F(dtMax-dtMin),variableDt=span>0;
 if(!Number.isFinite(span)||width.some(value=>!Number.isFinite(value)))return{ok:false,error:{kind:'nonfinite',path:[],reason:'源 Float32 初始化范围相减溢出'}};
 const staggerMax=Math.max(0,configuration.warmup.staggerMax),staggerMin=Math.min(staggerMax,Math.max(0,configuration.warmup.staggerMin));
 // Source int addition intentionally overflows; a nonpositive bound skips RNG.
 const staggerRange=staggerMax>0?(staggerMax-staggerMin+1)|0:0;
 let index=0,failure:SourceAttractorError|undefined;
 return{ok:true,value:{count,variableDt,next(){
  if(failure)return{ok:false,error:failure};
  if(index===count)return{ok:true,value:null};
  const raw=minimum.map((min,i)=>F(min+F(rng.nextFloat()*width[i]))) as [number,number,number];
  const dt=variableDt?F(dtMin+F(rng.nextFloat()*span)):dtMin;
  const position=raw.map((value,i)=>F(F(value*scale[i])+offset[i])) as [number,number,number];
  if(!Number.isFinite(dt)||raw.some(value=>!Number.isFinite(value))||position.some(value=>!Number.isFinite(value))){failure={kind:'nonfinite',path:['particles',String(index)],reason:'源 Float32 初始粒子或显示位置非有限；不替换或跳过该粒子'};return{ok:false,error:failure};}
  const warmupSteps=configuration.nativeBackend==='gpu'?0:(configuration.warmup.steps+(staggerRange>0?staggerMin+warmupRng.nextInt(staggerRange):0))|0;
  return{ok:true,value:Object.freeze({index:index++,raw:Object.freeze(raw),position:Object.freeze(position),dt,warmupSteps})};
 }}};
}
