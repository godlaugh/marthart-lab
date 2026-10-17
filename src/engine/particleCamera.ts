import type {ParticleCameraRequest,ParticleCameraSample} from '../types';

// At most 16,384 facts; charged conservatively at 256 bytes per retained entry.
// JS engine bookkeeping is implementation-dependent, not an exact RSS claim.
export const MAX_CAMERA_SAMPLES=16384;
export const particleCameraKey=(request:ParticleCameraRequest)=>`${request.time}:${request.index}`;
/** Source Attractor parses a float then casts to Java int, and rejects invalid
 * array indices. Surface has a different, separately owned clamp contract. */
export function attractorParticleId(index:number,count:number):number|undefined{
 if(!Number.isFinite(index)||!Number.isInteger(count)||count<1)throw new Error('吸引子跟踪索引或粒子数无效');
 const id=Math.max(-2147483648,Math.min(2147483647,Math.trunc(Math.fround(index))));
 return id>=0&&id<count?id===0?0:id:undefined;
}
export class ParticleCameraCache{
 private values=new Map<string,ParticleCameraSample>();
 get(request:ParticleCameraRequest){const key=particleCameraKey(request),value=this.values.get(key);if(value){this.values.delete(key);this.values.set(key,value);}return value;}
 has(request:ParticleCameraRequest){return this.values.has(particleCameraKey(request));}
 put(request:ParticleCameraRequest,value:ParticleCameraSample){const key=particleCameraKey(request);this.values.delete(key);this.values.set(key,value);while(this.values.size>MAX_CAMERA_SAMPLES)this.values.delete(this.values.keys().next().value!);}
 reset(){this.values.clear();}
 diagnostics(){return{entries:this.values.size,estimatedRetainedBytes:this.values.size*256};}
 collect(requests:readonly ParticleCameraRequest[]){return new Map(requests.map(request=>{const value=this.get(request);if(!value)throw new Error('相机跟踪生产者缺少请求的位置事实');return[particleCameraKey(request),value] as const;}));}
}
