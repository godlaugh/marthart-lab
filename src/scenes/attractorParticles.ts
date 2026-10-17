import type {GenerateContext,GeometryOutput,SceneDocument,SceneOutput,ParticleCameraRequest,ParticleCameraSample} from '../types';
import {prepareAttractorFrame} from './geometry';
import {AttractorGpu} from '../engine/attractorGpu';
import {parseAttractorInitial} from '../engine/attractorSeeds';
import {numberSetting} from '../engine/expression';
import {sceneAtTime} from '../engine/timeline';
import {paletteColor,validatePalette,vertexColors} from '../engine/palette';
import {ParticleCameraCache,attractorParticleId} from '../engine/particleCamera';
import {simulationTime} from '../engine/simulationClock';

const MAX_VECTOR_EVALUATIONS=2_000_000_000,MAX_FRAME_DISPATCHES=100_000,MAX_KNOWN_BYTES=512*1024*1024;
const cancelled=(c:GenerateContext)=>{if(c.isCancelled?.())throw new DOMException('吸引子 GPU 计算已取消','AbortError');};
function fpsOf(scene:SceneDocument){const fps=numberSetting(scene.settings,'simulationFps',30,1,120);if(!Number.isInteger(fps))throw new Error('simulationFps 必须为整数');return fps;}
function backendOf(scene:SceneDocument){const v=String(scene.settings.attractorBackend??'cpu');if(!['cpu','auto','gpu'].includes(v))throw new Error('attractorBackend 必须为 cpu/auto/gpu');return v;}
function initialIdentity(scene:SceneDocument){const {variableTimeStep:_variable,...identity}=parseAttractorInitial(scene.settings);return JSON.stringify(identity);}
export interface AttractorGpuAttempt {output?:SceneOutput;warnings:string[];trackingSamples?:Map<string,ParticleCameraSample>;}
/** Owns the fixed clock, canonical initialization and all GPU lifetime. The kernel
 * receives parsed jobs only; no viewport renderer interprets integration state. */
export class AttractorParticleSession {
 private gpu?:AttractorGpu;private key='';private frame=0;private fallbackKey='';private fallbackReason='';
 private colorKey='';private indexColors?:Float32Array;private hits=0;
 private tracking=new ParticleCameraCache();
 reset(){this.gpu?.dispose();this.gpu=undefined;this.key='';this.frame=0;this.fallbackKey='';this.fallbackReason='';this.colorKey='';this.indexColors=undefined;this.hits=0;this.tracking.reset();}
 diagnostics(){return{retainedBytes:(this.gpu?.diagnostics().retainedBytes??0)+(this.indexColors?.byteLength??0)+(this.key.length+this.colorKey.length+this.fallbackKey.length+this.fallbackReason.length)*2+this.tracking.diagnostics().estimatedRetainedBytes,frame:this.gpu?this.frame:null,cacheHits:this.hits,gpu:this.gpu?.diagnostics(),tracking:this.tracking.diagnostics()};}
 generate(base:SceneDocument,c:GenerateContext,requests:readonly ParticleCameraRequest[]=[]):AttractorGpuAttempt {
  if(!Number.isFinite(c.time)||c.time<0||c.time>86400)throw new Error('吸引子时间必须在 0–86400 秒');
  const atZero=sceneAtTime(base,0),current=sceneAtTime(base,c.time),initial=parseAttractorInitial(atZero.settings),choice=backendOf(current),fps=fpsOf(atZero);
  if(choice==='cpu'||choice==='auto'&&initial.count<10000){this.reset();return{warnings:[]};}
  if(current.settings.showTrails===true||current.settings.presentation==='density'&&current.settings.densityAccumulation==='window'){this.reset();if(initial.count>10000)throw new Error('GPU 吸引子不保存历史拖尾；当前拖尾请求超过 CPU 的 10000 粒子预算，请关闭拖尾或减少粒子数。');return{warnings:['GPU 吸引子不保存历史拖尾；本次使用 CPU 历史积分。']};}
  const first=prepareAttractorFrame(atZero),key=JSON.stringify({initial,field:first.field,dt:first.dt,dtMin:first.dtMin,dtMax:first.dtMax,variableTimeStep:first.variableTimeStep,subSteps:first.subSteps,limit:first.limit,method:first.method,fps,timeline:base.timeline,...(requests.length?{trackingScene:base}:{})});
  const failureKey=key+'@'+c.time;if(failureKey===this.fallbackKey)return this.fallback(initial.count,this.fallbackReason);
  try{const output=this.run(base,c,key,atZero,current,fps,requests);return{output,warnings:[],...(requests.length?{trackingSamples:this.tracking.collect(requests)}:{})};}
  catch(error){this.reset();if(error instanceof DOMException&&error.name==='AbortError')throw error;const reason=error instanceof Error?error.message:String(error);this.fallbackKey=failureKey;this.fallbackReason=reason;return this.fallback(initial.count,reason);}
 }
 private fallback(count:number,reason:string):AttractorGpuAttempt {
  if(count>10000)throw new Error(`GPU 吸引子不可用：${reason}；保留 ${count} 粒子请求，CPU 的 10000 粒子预算不能完整回退。`);
  return{warnings:[`吸引子 GPU 回退 CPU：${reason}`]};
 }
 private run(base:SceneDocument,c:GenerateContext,key:string,zero:SceneDocument,current:SceneDocument,fps:number,requests:readonly ParticleCameraRequest[]):SceneOutput {
  const started=performance.now(),initial=parseAttractorInitial(zero.settings),first=prepareAttractorFrame(zero),last=simulationTime(c.time,fps).frame;
  if(fpsOf(current)!==fps)throw new Error('连续模拟期间不能动画修改模拟帧率');
  // Includes GPU buffers, snapshot, returned/compacted heads, index colors and
  // metric scratch. Driver and main-thread renderer allocations are separate.
  if(initial.count*196+65536*24>MAX_KNOWN_BYTES)throw new Error('GPU 吸引子已知工作集超过 512 MiB');
  let cost=0;
  const missingPast=requests.some(request=>!this.tracking.has(request)&&simulationTime(request.time,fps).frame<this.frame);
  const reusable=this.gpu&&this.key===key&&this.frame<=last&&!missingPast;
  const replayFrames=last-(reusable?this.frame:0);if(replayFrames>MAX_FRAME_DISPATCHES)throw new Error('GPU 吸引子单次重放超过 100000 个时间帧；请分段推进或降低模拟帧率。');
  const charge=(steps:number,method:'euler'|'rk4')=>{cost+=initial.count*steps*(method==='rk4'?4:1);if(cost>MAX_VECTOR_EVALUATIONS)throw new Error('GPU 吸引子本次超过 20 亿次导数向量求值；请减少预热、时间、子步或粒子数。');};
  cancelled(c);this.hits=reusable?1:0;
  if(!reusable){
   this.reset();this.key=key;charge(initial.burn+initial.staggerMax,first.method);this.gpu=new AttractorGpu();this.gpu.initialize(initial,c.isCancelled);this.gpu.warmup(first,c.isCancelled);this.frame=0;
  }
  const identity=initialIdentity(zero);
  const advanceTo=(time:number)=>{
  const clock=simulationTime(time,fps),frameEnd=clock.frame;
  for(;this.frame<frameEnd;this.frame++){
   cancelled(c);
   const scene=sceneAtTime(base,this.frame/fps);
   if(fpsOf(scene)!==fps||initialIdentity(scene)!==identity)throw new Error('连续模拟期间不能动画修改粒子初始条件、数量、随机种子或模拟帧率');
   const job=prepareAttractorFrame(scene);charge(job.subSteps,job.method);this.gpu!.advance(job,job.subSteps,1,true,c.isCancelled);
  }
  if(clock.fraction>0){const job=prepareAttractorFrame(sceneAtTime(base,clock.gridTime));charge(job.subSteps,job.method);this.gpu!.advance(job,job.subSteps,clock.fraction,false,c.isCancelled);}else this.gpu!.advance(first,0,1,true,c.isCancelled);
  };
  const capture=(time:number,batch:readonly ParticleCameraRequest[])=>{
   const valid=batch.map(request=>({request,id:attractorParticleId(request.index,initial.count)}));
   for(const {request,id}of valid)if(id===undefined)this.tracking.put(request,{status:'out-of-range'});
   const finite=valid.filter((v):v is {request:ParticleCameraRequest;id:number}=>v.id!==undefined);if(!finite.length)return;
   const raw=this.gpu!.particleStates(finite.map(v=>v.id),c.isCancelled),transform=prepareAttractorFrame(sceneAtTime(base,time)).transform,point=new Float32Array(3);
   finite.forEach(({request,id},i)=>{const at=i*4,available=raw[at+3]>=0&&transform.write(raw[at],raw[at+1],raw[at+2],point,0);this.tracking.put(request,available?{status:'available',particleId:id,position:[point[0],point[1],point[2]]}:{status:'unavailable',particleId:id});});
  };
  const pending=requests.filter(request=>!this.tracking.get(request)),groups=new Map<number,ParticleCameraRequest[]>();
  for(const request of pending){const group=groups.get(request.time)??[];group.push(request);groups.set(request.time,group);}
  for(const [time,batch]of [...groups].sort((a,b)=>a[0]-b[0]))if(time<c.time){advanceTo(time);capture(time,batch);}
  if(initialIdentity(current)!==identity)throw new Error('连续模拟期间不能动画修改粒子初始条件、数量、随机种子或模拟帧率');
  advanceTo(c.time);if(groups.has(c.time))capture(c.time,groups.get(c.time)!);
  const snapshot=this.gpu!.snapshot(c.isCancelled),positions=new Float32Array(initial.count*3),ids=new Uint32Array(initial.count),transform=prepareAttractorFrame(current).transform;let n=0,samples=0,stopped=0,transformInvalid=0;
  for(let i=0;i<initial.count;i++){
   if((i&4095)===0)cancelled(c);samples+=snapshot.steps[i*2]+snapshot.steps[i*2+1]*4294967296;
   if(snapshot.positionsAndTime[i*4+3]<0){stopped++;continue;}
   if(!transform.write(snapshot.positionsAndTime[i*4],snapshot.positionsAndTime[i*4+1],snapshot.positionsAndTime[i*4+2],positions,n*3)){transformInvalid++;continue;}
   ids[n++]=i;
  }
  if(!Number.isSafeInteger(samples))throw new Error('GPU 吸引子累计积分计数超出安全整数范围');
  const values=n===initial.count?positions:positions.slice(0,n*3),particleIds=n===initial.count?ids:ids.slice(0,n),palette=validatePalette(current.palette),metric=String(current.settings.colorMetric??'index');let colors:Float32Array;
  if(metric==='index'){
   const colorKey=JSON.stringify({count:initial.count,palette});if(colorKey!==this.colorKey){this.indexColors=new Float32Array(initial.count*3);for(let id=0;id<initial.count;id++){if((id&4095)===0)cancelled(c);this.indexColors.set(paletteColor(palette,id/Math.max(1,initial.count-1)),id*3);}this.colorKey=colorKey;}
   colors=new Float32Array(n*3);for(let i=0;i<n;i++){const at=particleIds[i]*3;colors[i*3]=this.indexColors![at];colors[i*3+1]=this.indexColors![at+1];colors[i*3+2]=this.indexColors![at+2];}
  }else colors=vertexColors(values,palette,metric);
  cancelled(c);const invalid=stopped+transformInvalid,warnings=['GPU 使用 float32 持久吸引子积分；与 CPU 双精度混沌轨迹及原版随机序列不保证一致。'];if(stopped)warnings.push(`${stopped} 个发散或无效粒子已停止；不自动重生。`);if(transformInvalid)warnings.push(`${transformInvalid} 个粒子的显示变换超出 float32 范围，本帧隐藏；积分状态仍然保留。`);
  const out:GeometryOutput&SceneOutput={type:'geometry',topology:'points',backend:'webgl2',dimension:3,positions:values,particleIds,colors,stats:{samples,generated:n,invalid,elapsedMs:performance.now()-started},temporal:{time:c.time,windowStart:c.time,frames:1,samplingFps:fps,recordedPoints:0,cacheHits:this.hits},warnings};return out;
 }
}
