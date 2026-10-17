import type {ControlSpec,GenerateContext,Palette,SceneDocument,SceneOutput,Settings} from '../types';
import {numberSetting} from '../engine/expression';
import {hexRGB,paletteColor,validatePalette} from '../engine/palette';
import {sceneAtTime} from '../engine/timeline';
import {createNoise} from './noise';

// CPU admission counts actual particle advances plus gradient-noise evaluations.
// 1 billion units admits the measured 8000×120s×60Hz curl replay (748.8M)
// while rejecting extreme day-long jobs. This is a work policy, not a time estimate.
export const PERLIN_REPLAY_WORK_LIMIT=1_000_000_000;
const PROGRESS_INTERVAL_MS=500,MAX_SPLATS=50_000_000,MAX_HISTORY=1_000_000,MAX_CACHE=32*1024*1024,MAX_PIXELS=4_194_304,TAU=2*Math.PI;
const clamp=(x:number,lo=0,hi=1)=>Math.max(lo,Math.min(hi,x)),wrap=(x:number,size:number)=>((x%size)+size)%size;
function int(s:Settings,k:string,f:number,min:number,max:number){const n=numberSetting(s,k,f,min,max);if(!Number.isInteger(n))throw new Error(`${k} 必须为整数`);return n;}
function bool(s:Settings,k:string,f:boolean){const v=s[k]??f;if(typeof v!=='boolean')throw new Error(`${k} 必须是布尔值`);return v;}
function option(s:Settings,k:string,f:string,allowed:readonly string[]){const v=String(s[k]??f);if(!allowed.includes(v))throw new Error(`${k} 不支持 ${v}`);return v;}
function cancelled(c:GenerateContext){if(c.isCancelled?.())throw new DOMException('持续噪声模拟已取消','AbortError');}
/** Counter-addressed randomness makes partial seeks independent of call order and warm cache history. */
function uniform(seed:number,particle:number,frame:number,channel:number){let v=(seed^Math.imul(particle+1,0x9e3779b1)^Math.imul(frame+2,0x85ebca77)^Math.imul(channel+1,0xc2b2ae3d))>>>0;v=Math.imul(v^(v>>>16),0x7feb352d);v=Math.imul(v^(v>>>15),0x846ca68b);return((v^(v>>>16))>>>0)/4294967296;}
const n=(key:string,label:string,min:number,max:number,step:number):ControlSpec=>({key,label,type:'number',min,max,step,group:'持续粒子'});
const select=(key:string,label:string,values:[string,string][]):ControlSpec=>({key,label,type:'select',options:values.map(([value,label])=>({value,label})),group:'持续粒子'});
export const perlinParticleControls:ControlSpec[]=[select('particleDisplay','持续粒子显示',[['heads','粒子头部'],['trails','有限寿命拖尾'],['accumulation','持续累积缓冲']]),n('particleCount','持续粒子数',1,20000,100),n('simulationFps','固定模拟帧率',1,120,1),n('particleDomainWidth','模拟区域宽度',1,10000,10),n('particleDomainHeight','模拟区域高度',1,10000,10),n('particleSpeed','移动速度 · 单位/秒',0,1000,.5),n('respawnRate','重生强度 · 次/秒',0,4096,.01),{key:'respawnEveryStep',label:'每步重生',type:'toggle',group:'持续粒子'},select('particleBoundary','越界处理',[['wrap','环绕并断开拖尾'],['respawn','重生']]),n('trailLifetime','拖尾寿命 · 秒',.001,3600,.1),n('trailStride','每 N 模拟步记录拖尾',1,120,1),{key:'fadeTrails',label:'拖尾随年龄淡出',type:'toggle',group:'持续粒子'},{key:'recordTrails',label:'记录拖尾 / 累积',type:'toggle',group:'持续粒子'},n('accumulationFade','累积消退 · 0–255/60Hz',0,255,1),n('particleRadius','累积点半径 · 像素',0,8,.1),n('particleExposure','累积曝光',.001,10,.05)];
export const perlinParticleDefaults:Settings={particleDisplay:'accumulation',particleCount:3000,simulationFps:60,particleDomainWidth:800,particleDomainHeight:800,particleSpeed:24,respawnRate:1.8,respawnEveryStep:false,particleBoundary:'wrap',trailLifetime:5,trailStride:5,fadeTrails:true,recordTrails:true,accumulationFade:18,particleRadius:.6,particleExposure:.4};
interface Config {count:number;fps:number;seed:number;width:number;height:number;speed:number;rate:number;always:boolean;boundary:string;display:string;lifetime:number;trailStride:number;fade:boolean;record:boolean;decay:number;radius:number;exposure:number;flow:string;angleMap:string;frequency:number;octaves:number;persistence:number;noiseOffset:number;timeSpeed:number;}
function config(scene:SceneDocument):Config {const s=scene.settings;return{count:int(s,'particleCount',3000,1,20000),fps:int(s,'simulationFps',60,1,120),seed:int(s,'seed',42,0,0xffffffff),width:numberSetting(s,'particleDomainWidth',800,1,10000),height:numberSetting(s,'particleDomainHeight',800,1,10000),speed:numberSetting(s,'particleSpeed',24,0,1000),rate:numberSetting(s,'respawnRate',1.8,0,4096),always:bool(s,'respawnEveryStep',false),boundary:option(s,'particleBoundary','wrap',['wrap','respawn']),display:option(s,'particleDisplay','accumulation',['heads','trails','accumulation']),lifetime:numberSetting(s,'trailLifetime',5,.001,3600),trailStride:int(s,'trailStride',5,1,120),fade:bool(s,'fadeTrails',true),record:bool(s,'recordTrails',true),decay:numberSetting(s,'accumulationFade',18,0,255),radius:numberSetting(s,'particleRadius',.6,0,8),exposure:numberSetting(s,'particleExposure',.4,.001,10),flow:option(s,'flow','angle',['angle','curl','swirl']),angleMap:option(s,'angleMap','linear',['linear','soft-power']),frequency:numberSetting(s,'noiseScale',.01,0,100),octaves:int(s,'octaves',3,1,8),persistence:numberSetting(s,'persistence',.5,0,1),noiseOffset:numberSetting(s,'noiseOffset',0,-10000,10000),timeSpeed:numberSetting(s,'timeSpeed',.2,-10,10)};}
/** Spatially constant fields are sampled once per frame; stopped particles need no field. */
export function perlinAdvanceWork(cfg:Pick<Config,'count'|'speed'|'frequency'|'flow'|'octaves'>){
 const noiseSamples=cfg.speed===0?0:cfg.frequency===0?(cfg.flow==='curl'?0:cfg.octaves):cfg.count*cfg.octaves*(cfg.flow==='curl'?4:1);
 return{updates:cfg.count,noiseSamples,units:cfg.count+noiseSamples};
}
interface Frame {time:number;positions:Float64Array;ids:Uint32Array;palette:Palette;record:boolean;}
interface Ink {width:number;height:number;values:Float32Array;lastLog:Float64Array;epochs:Uint32Array;epoch:number;log:number;deposited:number;clipped:number;}
interface State {frame:number;positions:Float64Array;ids:Uint32Array;nextId:number;integrated:number;respawned:number;wrapped:number;frames:(Frame|undefined)[];historyFloor:number;historyHead:number;historyBytes:number;ink?:Ink;}
function bytes(s:State){return s.positions.byteLength+s.ids.byteLength+s.historyBytes+(s.ink?s.ink.values.byteLength+s.ink.lastLog.byteLength+s.ink.epochs.byteLength:0);}
function clonePartial(s:State):State{return{...s,positions:s.positions.slice(),ids:s.ids.slice(),frames:[...s.frames],...(s.ink?{ink:{...s.ink,values:s.ink.values.slice(),lastLog:s.ink.lastLog.slice(),epochs:s.ink.epochs.slice()}}:{})};}
function transformer(scene:SceneDocument):(x:number,y:number)=>[number,number,number]{const s=scene.settings,scale=numberSetting(s,'scale',1),sx=numberSetting(s,'scaleX',1)*scale,sy=numberSetting(s,'scaleY',1)*scale,angle=numberSetting(s,'rotateZ',0),co=Math.cos(angle),si=Math.sin(angle),ox=numberSetting(s,'offsetX',0),oy=numberSetting(s,'offsetY',0),oz=numberSetting(s,'offsetZ',0);return(x,y)=>{const out:[number,number,number]=[x*sx*co-y*sy*si+ox,x*sx*si+y*sy*co+oy,oz];if(!out.every(v=>Number.isFinite(Math.fround(v))))throw new Error('粒子空间变换超出有限单精度范围');return out;};}
function outputGeometry(state:State,current:SceneDocument,time:number,cfg:Config,c:GenerateContext):SceneOutput {
 const transform=transformer(current),positions=new Float32Array(cfg.count*3),colors=new Float32Array(cfg.count*3),ids=state.ids.slice();for(let i=0;i<cfg.count;i++){if((i&1023)===0)cancelled(c);positions.set(transform(state.positions[i*2],state.positions[i*2+1]),i*3);colors.set(paletteColor(current.palette,i/Math.max(1,cfg.count-1)),i*3);}
 const output:SceneOutput={type:'geometry',topology:'points',dimension:2,backend:'cpu',positions,colors,particleIds:ids,stats:{samples:state.integrated,generated:cfg.count,invalid:0}};
 if(cfg.display==='trails'&&current.settings.showTrails!==false){
  const selected=state.frames.filter((f):f is Frame=>!!f&&f.time>=Math.max(0,time-cfg.lifetime)-1e-10);if(!selected.length||Math.abs(selected[selected.length-1].time-time)>1e-10)selected.push({time,positions:state.positions,ids:state.ids,palette:current.palette,record:cfg.record});if(selected.length*cfg.count>MAX_HISTORY)throw new Error('持续拖尾超过 100 万顶点；请减少粒子数、帧率或寿命');
  // Count real identity-preserving segments before allocating. No growing boxed
  // number[] or pessimistic maximum-size buffer survives in a transferred output.
  let segments=0;
  for(let j=1;j<selected.length;j++){const f=selected[j],previous=selected[j-1];if(f.record&&previous.record)for(let i=0;i<cfg.count;i++){if((i&1023)===0)cancelled(c);if(f.ids[i]===previous.ids[i])segments++;}}
  const p=new Float32Array(selected.length*cfg.count*3),rgb=new Float32Array(p.length),alphas=new Float32Array(selected.length*cfg.count),indices=new Uint32Array(segments*2);let cursor=0;
  for(let j=0;j<selected.length;j++){const f=selected[j],previous=selected[j-1],alpha=cfg.fade?clamp(1-(time-f.time)/cfg.lifetime):1;for(let i=0;i<cfg.count;i++){if((i&1023)===0)cancelled(c);const at=j*cfg.count+i;p.set(transform(f.positions[i*2],f.positions[i*2+1]),at*3);rgb.set(paletteColor(f.palette,i/Math.max(1,cfg.count-1)),at*3);alphas[at]=alpha;if(f.record&&previous?.record&&f.ids[i]===previous.ids[i]){indices[cursor++]=at-cfg.count;indices[cursor++]=at;}}}
  output.trails={positions:p,colors:rgb,alphas,indices};
 }
 return output;
}
function outputInk(state:State,current:SceneDocument,cfg:Config,c:GenerateContext):SceneOutput {
 const ink=state.ink!,pixels=new Uint8ClampedArray(ink.width*ink.height*4),color=String(current.settings.background??'#080b12');if(!/^#[\da-f]{6}$/i.test(color))throw new Error('累积背景颜色须为 #RRGGBB');const bg=hexRGB(color),transparent=current.settings.transparentBackground===true;let occupied=0;
 for(let i=0;i<ink.width*ink.height;i++){
  if((i&4095)===0)cancelled(c);const factor=ink.epochs[i]===ink.epoch?Math.exp(ink.log-ink.lastLog[i]):0,mass=ink.values[i*4]*factor,alpha=-Math.expm1(-mass*cfg.exposure);if(mass>1e-12)occupied++;
  for(let k=0;k<3;k++){const rgb=mass>0?clamp(ink.values[i*4+k+1]*factor/mass):0;pixels[i*4+k]=Math.round((transparent?rgb:rgb*alpha+bg[k]*(1-alpha))*255);}pixels[i*4+3]=transparent?Math.round(alpha*255):255;
 }
 return{type:'raster',dimension:2,backend:'cpu',width:ink.width,height:ink.height,pixels,stats:{samples:state.integrated,generated:occupied,invalid:0}};
}

/** A single generation session owns state, history, and accumulation. Responses never expose retained buffers. */
export class PerlinParticleSession {
 private key='';private state?:State;private hits=0;private workUnits=0;private noiseSamples=0;
 reset(){this.key='';this.state=undefined;this.hits=0;this.workUnits=0;this.noiseSamples=0;}
 diagnostics(){return{workUnits:this.workUnits,noiseSamples:this.noiseSamples,retainedBytes:(this.state?bytes(this.state):0)+this.key.length*2,frame:this.state?.frame??null,cacheHits:this.hits,integrated:this.state?.integrated??0,respawned:this.state?.respawned??0,wrapped:this.state?.wrapped??0,deposited:this.state?.ink?.deposited??0,clipped:this.state?.ink?.clipped??0};}
 generate(scene:SceneDocument,context:GenerateContext):SceneOutput {
  const started=performance.now();try{return this.run(scene,context,started);}catch(error){this.reset();throw error;}
 }
 private run(scene:SceneDocument,c:GenerateContext,started:number):SceneOutput {
  if(scene.kind!=='perlin')throw new Error('持续噪声模拟仅支持 Perlin 场景');if(scene.settings.presentation==='density')throw new Error('持续噪声使用 particleDisplay=accumulation 进行真实推进累积，不能叠加通用密度窗口');if(!Number.isFinite(c.time)||c.time<0||c.time>86400)throw new Error('模拟时间必须为 0–86400 秒');cancelled(c);
  const zero=sceneAtTime(scene,0),initial=config(zero),current=sceneAtTime(scene,c.time),now=config(current),lastFrame=Math.floor(c.time*initial.fps+1e-9),fraction=Math.max(0,c.time*initial.fps-lastFrame),isInk=initial.display==='accumulation';validatePalette(zero.palette);validatePalette(current.palette);
  if(initial.display!==now.display)throw new Error('模拟中不能动画改变粒子显示模式');if(initial.display==='trails'&&initial.count*(Math.ceil(Math.min(c.time,now.lifetime)*initial.fps/now.trailStride)+2)>MAX_HISTORY)throw new Error('持续拖尾超过 100 万顶点；请减少粒子数、帧率或寿命');
  if(isInk&&(!Number.isInteger(c.width)||!Number.isInteger(c.height)||c.width<1||c.height<1||c.width*c.height>MAX_PIXELS))throw new Error('累积图像须为正整数尺寸且不超过 4194304 像素');
  const key=JSON.stringify({scene,width:c.width,height:c.height});if(key!==this.key){this.reset();this.key=key;}this.hits=0;
  let state=this.state;if(state&&initial.display==='trails'&&Math.max(0,c.time-now.lifetime)<=state.historyFloor+1e-10)state=undefined;if(state&&state.frame<=lastFrame)this.hits=1;else state=undefined;
  // A cold/backward replay no longer owns the superseded cache while allocating a new history.
  this.state=state;
  const remainingFrames=lastFrame-(state?.frame??0)+(fraction>1e-10?1:0);
  if(remainingFrames*initial.count>PERLIN_REPLAY_WORK_LIMIT)throw workError();
  const noise=createNoise(initial.seed);let splats=0,work=0,noiseSamples=0,lastProgress=started;
  function workError(){return new Error('持续粒子本次重放超过 10 亿 CPU 工作单元（粒子推进 + 实际噪声采样）；请减少粒子数、时间、八度或模拟帧率');}
  function progress(s:State,snapshot:SceneDocument,cfg:Config,time:number){
   if(!c.onProgress||time>=c.time||performance.now()-lastProgress<PROGRESS_INTERVAL_MS)return;
   const output=outputGeometry(s,snapshot,time,{...cfg,display:'heads'},c);
   output.temporal={time,windowStart:time,frames:s.frame+1,samplingFps:initial.fps,recordedPoints:0,cacheHits:thisHits};
   output.stats.elapsedMs=performance.now()-started;
   output.warnings=[`尚未完成：正在完整重放至 ${c.time} 秒，目前 ${time.toFixed(2)} 秒；临时仅显示粒子头部，可取消计算。`];
   c.onProgress(output);cancelled(c);lastProgress=performance.now();
  }
  const thisHits=this.hits;
  const immutable=(cfg:Config)=>{for(const k of ['count','fps','seed','width','height','display'] as const)if(cfg[k]!==initial[k])throw new Error('模拟期间不能动画改变粒子数、种子、帧率、区域或显示模式');};immutable(now);
  if(!state){
   state={frame:0,positions:new Float64Array(initial.count*2),ids:Uint32Array.from({length:initial.count},(_,i)=>i),nextId:initial.count,integrated:0,respawned:0,wrapped:0,frames:[],historyFloor:-1,historyHead:0,historyBytes:0};
   for(let i=0;i<initial.count;i++){state.positions[i*2]=(uniform(initial.seed,i,-1,0)-.5)*initial.width;state.positions[i*2+1]=(uniform(initial.seed,i,-1,1)-.5)*initial.height;}
   if(isInk)state.ink={width:c.width,height:c.height,values:new Float32Array(c.width*c.height*4),lastLog:new Float64Array(c.width*c.height),epochs:new Uint32Array(c.width*c.height),epoch:0,log:0,deposited:0,clipped:0};
   record(state,zero,initial,0);if(isInk&&initial.record)deposit(state,zero,initial,1);
  }
  let stepScene=sceneAtTime(scene,state.frame/initial.fps),stepConfig=config(stepScene);immutable(stepConfig);
  for(let frame=state.frame;frame<lastFrame;frame++){
   cancelled(c);const at=frame/initial.fps;advance(state,stepConfig,frame,1/initial.fps,at);
   state.frame=frame+1;const atEnd=state.frame/initial.fps;stepScene=sceneAtTime(scene,atEnd);stepConfig=config(stepScene);immutable(stepConfig);fade(state,stepConfig,1/initial.fps);if(isInk&&stepConfig.record)deposit(state,stepScene,stepConfig,1);record(state,stepScene,stepConfig,atEnd);progress(state,stepScene,stepConfig,atEnd);
  }
  let displayed=state;
  if(fraction>1e-10){displayed=clonePartial(state);const at=lastFrame/initial.fps;advance(displayed,stepConfig,lastFrame,fraction/initial.fps,at);fade(displayed,now,fraction/initial.fps);if(isInk&&now.record)deposit(displayed,current,now,fraction);record(displayed,current,now,c.time);}
  cancelled(c);const output=isInk&&current.settings.showTrails!==false?outputInk(displayed,current,now,c):outputGeometry(displayed,current,c.time,now,c);
  const retained=bytes(state)+this.key.length*2;this.state=retained<=MAX_CACHE?state:undefined;if(!this.state)this.key='';
  output.temporal={time:c.time,windowStart:isInk?0:Math.max(0,c.time-now.lifetime),frames:lastFrame+1+(fraction>1e-10?1:0),samplingFps:initial.fps,recordedPoints:isInk?displayed.ink!.deposited:(displayed.frames.length-displayed.historyHead)*initial.count,cacheHits:this.hits};
  output.stats.elapsedMs=performance.now()-started;this.workUnits=work;this.noiseSamples=noiseSamples;output.warnings=[`固定 ${initial.fps} Hz 独立 CPU 持续模拟；已重生 ${displayed.respawned} 次、环绕 ${displayed.wrapped} 次。`];if(retained>MAX_CACHE)output.warnings.push('此持续状态超过 32 MiB 缓存预算；结果已生成，下次从种子重放。');if(displayed.ink?.clipped)output.warnings.push(`${displayed.ink.clipped} 个累积样本完全位于当前视口之外。`);
  return output;

  function record(s:State,snapshot:SceneDocument,cfg:Config,time:number){
   if(cfg.display!=='trails')return;const frame=time*cfg.fps;if(Math.abs(frame-Math.round(frame))<1e-8&&Math.round(frame)%cfg.trailStride!==0)return;
   const first=Math.max(0,time-now.lifetime-1/cfg.fps);
   // Release old frame ownership before allocating the next sample. A cursor
   // avoids shifting a potentially large history array on every simulation step.
   while(s.historyHead<s.frames.length&&s.frames[s.historyHead]!.time<first){const old=s.frames[s.historyHead]!;s.historyFloor=old.time;s.historyBytes-=frameBytes(old);s.frames[s.historyHead++]=undefined;}
   if(s.historyHead>1024&&s.historyHead*2>s.frames.length){s.frames=s.frames.slice(s.historyHead);s.historyHead=0;}
   if((s.frames.length-s.historyHead+1)*cfg.count>MAX_HISTORY)throw new Error('历史拖尾实际记录超过 100 万顶点；请增加记录间隔');
   const palette=validatePalette(snapshot.palette),size=cfg.count*20+JSON.stringify(palette).length*2+128;
   if(s.historyBytes+size+s.positions.byteLength+s.ids.byteLength+key.length*2>MAX_CACHE)throw new Error('拖尾及逐帧色板超过 32 MiB 历史预算；请增加记录间隔或减少粒子数/寿命');
   s.frames.push({time,positions:s.positions.slice(),ids:s.ids.slice(),palette,record:cfg.record});s.historyBytes+=size;
  }
  function frameBytes(f:Frame){return f.positions.byteLength+f.ids.byteLength+JSON.stringify(f.palette).length*2+128;}
  function newIdentity(s:State,i:number){if(s.nextId>0xffffffff)throw new Error('粒子历史标识超出 Uint32 范围');s.ids[i]=s.nextId++;}
  function advance(s:State,cfg:Config,frame:number,dt:number,at:number){
   const cost=perlinAdvanceWork(cfg);if(work+cost.units>PERLIN_REPLAY_WORK_LIMIT)throw workError();work+=cost.units;noiseSamples+=cost.noiseSamples;
   const probability=cfg.always?1:-Math.expm1(-cfg.rate*dt),fieldNoise=(x:number,y:number)=>{let value=0,amplitude=1,weight=0,freq=cfg.frequency;for(let j=0;j<cfg.octaves;j++){value+=amplitude*noise(x*freq,y*freq,at*cfg.timeSpeed+cfg.noiseOffset);weight+=amplitude;amplitude*=cfg.persistence;freq*=2;}return value/weight;};
   const constantValue=cfg.speed!==0&&cfg.frequency===0&&cfg.flow!=='curl'?fieldNoise(0,0):undefined;
   for(let i=0;i<cfg.count;i++){
    if((i&1023)===0)cancelled(c);let x=s.positions[i*2],y=s.positions[i*2+1];
    if(uniform(cfg.seed,i,frame,0)<probability){x=(uniform(cfg.seed,i,frame,1)-.5)*cfg.width;y=(uniform(cfg.seed,i,frame,2)-.5)*cfg.height;newIdentity(s,i);s.respawned++;}
    let dx:number,dy:number;if(cfg.speed===0){dx=0;dy=0;}else if(cfg.flow==='curl'&&cfg.frequency===0){dx=1;dy=0;}else if(cfg.flow==='curl'){const h=.01;dx=(fieldNoise(x,y+h)-fieldNoise(x,y-h))/(2*h);dy=-(fieldNoise(x+h,y)-fieldNoise(x-h,y))/(2*h);const norm=Math.hypot(dx,dy);if(norm>1e-12){dx/=norm;dy/=norm;}else{dx=1;dy=0;}}
    else{const value=constantValue??fieldNoise(x,y),mapped=cfg.angleMap==='soft-power'?Math.sign(value)*Math.abs(value)**1.5:value,a=TAU*mapped+(cfg.flow==='swirl'?Math.atan2(y,x)+Math.PI/2:0);dx=Math.cos(a);dy=Math.sin(a);}
    x+=dx*cfg.speed*dt;y+=dy*cfg.speed*dt;
    if(x< -cfg.width/2||x>=cfg.width/2||y< -cfg.height/2||y>=cfg.height/2){if(cfg.boundary==='wrap'){x=wrap(x+cfg.width/2,cfg.width)-cfg.width/2;y=wrap(y+cfg.height/2,cfg.height)-cfg.height/2;s.wrapped++;}else{x=(uniform(cfg.seed,i,frame,3)-.5)*cfg.width;y=(uniform(cfg.seed,i,frame,4)-.5)*cfg.height;s.respawned++;}newIdentity(s,i);}
    s.positions[i*2]=x;s.positions[i*2+1]=y;s.integrated++;
   }
  }
  function fade(s:State,cfg:Config,dt:number){if(!s.ink)return;if(cfg.decay===255){s.ink.epoch++;s.ink.log=0;}else s.ink.log+=Math.log1p(-cfg.decay/255)*60*dt;}
  function deposit(s:State,snapshot:SceneDocument,cfg:Config,weight:number){
   if(cfg.radius===0)return;
   const ink=s.ink!,transform=transformer(snapshot),unit=Math.min(ink.width/cfg.width,ink.height/cfg.height);
   for(let i=0;i<cfg.count;i++){
    if((i&1023)===0)cancelled(c);const p=transform(s.positions[i*2],s.positions[i*2+1]),x=ink.width/2+p[0]*unit,y=ink.height/2-p[1]*unit,r=cfg.radius,rgb=paletteColor(snapshot.palette,i/Math.max(1,cfg.count-1)),entries:[number,number][]=[];let sum=0;
    for(let py=Math.ceil(y-r-1.25);py<=Math.floor(y+r+.25);py++)for(let px=Math.ceil(x-r-1.25);px<=Math.floor(x+r+.25);px++){
     if(++splats>MAX_SPLATS)throw new Error('持续累积本次超过 5000 万像素测试；请减少粒子、半径或时间');const w=clamp(r+.75-Math.hypot(px+.5-x,py+.5-y));if(w<=0)continue;sum+=w;if(px>=0&&py>=0&&px<ink.width&&py<ink.height)entries.push([py*ink.width+px,w]);
    }
    if(entries.length===0){ink.clipped++;continue;}
    for(const [index,w]of entries){const offset=index*4,decay=ink.epochs[index]===ink.epoch?Math.exp(ink.log-ink.lastLog[index]):0;for(let k=0;k<4;k++)ink.values[offset+k]*=decay;const mass=weight*w/sum;ink.values[offset]+=mass;for(let k=0;k<3;k++)ink.values[offset+k+1]+=rgb[k]*mass;ink.lastLog[index]=ink.log;ink.epochs[index]=ink.epoch;}
    ink.deposited+=weight;
   }
  }
 }
}
export function generatePerlinParticles(scene:SceneDocument,context:GenerateContext,session=new PerlinParticleSession()):SceneOutput{return session.generate(scene,context);}
