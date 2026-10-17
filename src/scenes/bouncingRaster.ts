import {parse} from 'mathjs';
import type {ControlSpec,GenerateContext,SceneDocument,SceneOutput,Settings} from '../types';
import {numberSetting,random} from '../engine/expression';
import {paletteColor,hexRGB,validatePalette} from '../engine/palette';
import {sceneAtTime} from '../engine/timeline';
import {rasterDimensions} from '../engine/rasterDimensions';
import {BouncingRasterGpu,type BouncingRasterView,type BouncingRasterFrame} from '../engine/bouncingRasterGpu';
import {boundaryFromSettings,prepareBilliard,insideBoundary,bouncingElapsedTime,type Point} from './bouncing';
import {createBouncingShapeSampler,createBouncingVelocitySampler} from './bouncingShapes';
import {normalizeBouncingFormula} from './bouncingFormula';
import {parseParticleTransform} from './particleTransform';
import {bouncingBoundarySegments,createBouncingGuides} from './bouncingGuides';
const MAX_WORK=1_000_000_000,MAX_SPLAT_WORK=8_000_000_000,MAX_MEMORY=1024*1024*1024;
const integer=(s:Settings,k:string,f:number,min:number,max:number)=>{const n=numberSetting(s,k,f,min,max);if(!Number.isInteger(n))throw new Error(`${k} 必须是整数`);return n;};
const cancelled=(c:GenerateContext)=>{if(c.isCancelled?.())throw new DOMException('弹跳图像已取消','AbortError');};
const clamp=(x:number)=>Math.max(0,Math.min(1,x));
const number=(key:string,label:string,min:number,max:number,step:number):ControlSpec=>({key,label,type:'number',min,max,step,group:'粒子图像'});
export const bouncingRasterControls:ControlSpec[]=[{key:'bouncingPresentation',label:'弹跳显示方式',type:'select',group:'外观',options:[{value:'geometry',label:'点云 / 线段轨迹'},{value:'raster',label:'直接图像 / 历史累积'}]},number('bouncingHistoryFps','图像历史采样率',1,120,1),{key:'bouncingHistoryFade',label:'历史图像按年龄淡出',type:'toggle',group:'粒子图像'},number('bouncingExposure','粒子图像曝光',.00001,100,.01),{key:'bouncingView',label:'粒子图像视口',type:'select',group:'粒子图像',options:[{value:'fit',label:'适配当前边界'},{value:'fixed',label:'固定世界坐标'}]},number('bouncingViewWidth','图像视口宽度',.000001,1e12,.1),number('bouncingViewCenterX','图像视口中心 X',-1e12,1e12,.1),number('bouncingViewCenterY','图像视口中心 Y',-1e12,1e12,.1)];
export const bouncingRasterDefaults:Settings={bouncingPresentation:'geometry',bouncingHistoryFps:30,bouncingHistoryFade:true,bouncingExposure:.04,bouncingView:'fit',bouncingViewWidth:8,bouncingViewCenterX:0,bouncingViewCenterY:0};
/** Fixed grid plus an exact-time head. History is bounded, independently replayable, and never inherited from preview frame rate. */
export function bouncingRasterTimes(time:number,lifetime:number,fps:number,trails:boolean):number[]{
 if(!Number.isFinite(time)||time<0||time>86400)throw new Error('弹跳历史时间必须在 0–86400 秒');if(!Number.isFinite(lifetime)||lifetime<=0||lifetime>60||!Number.isInteger(fps)||fps<1||fps>120)throw new Error('弹跳历史寿命/采样率无效');if(!trails)return[time];
 const first=Math.max(0,Math.ceil(Math.max(0,time-lifetime)*fps-1e-9)),last=Math.floor(time*fps+1e-9),times=Array.from({length:last-first+1},(_,i)=>(first+i)/fps);if(!times.length||Math.abs(times.at(-1)!-time)>1e-10)times.push(time);return times;
}
export function bouncingRasterView(scene:SceneDocument,width:number,height:number):BouncingRasterView {
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1)throw new Error('图像视口尺寸无效');const s=scene.settings,mode=String(s.bouncingView??'fit');
 if(mode==='fixed'){const spanX=numberSetting(s,'bouncingViewWidth',8,.000001,1e12);return{centerX:numberSetting(s,'bouncingViewCenterX',0,-1e12,1e12),centerY:numberSetting(s,'bouncingViewCenterY',0,-1e12,1e12),spanX,spanY:spanX*height/width};}if(mode!=='fit')throw new Error('未知粒子图像视口');
 const transform=parseParticleTransform(s),bx=numberSetting(s,'boundaryCenterX',0,-1e6,1e6),by=numberSetting(s,'boundaryCenterY',0,-1e6,1e6),points=bouncingBoundarySegments(boundaryFromSettings(s),512);let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
 for(let i=0;i<points.length;i+=2){const p=transform.point(points[i]+bx,points[i+1]+by);if(!p)throw new Error('边界变换超出可表示范围');minX=Math.min(minX,p[0]);maxX=Math.max(maxX,p[0]);minY=Math.min(minY,p[1]);maxY=Math.max(maxY,p[1]);}
 const spanX=Math.max(maxX-minX,(maxY-minY)*width/height,1e-6)*1.1;return{centerX:(maxX+minX)/2,centerY:(maxY+minY)/2,spanX,spanY:spanX*height/width};
}
interface Initial {key:string;states:Float64Array;count:number;samples:number;invalid:number;warnings:string[];}
function initial(scene:InitialRequest,c:GenerateContext):Initial {
 const {time,key}=scene;
 const s=scene.settings,count=integer(s,'count',1800,1,5_000_000),billiard=prepareBilliard(boundaryFromSettings(s),numberSetting(s,'collisionRadius',0,0,1000)),bx=numberSetting(s,'boundaryCenterX',0,-1e6,1e6),by=numberSetting(s,'boundaryCenterY',0,-1e6,1e6),rng=random(integer(s,'seed',2,0,0xffffffff)),sample=createBouncingShapeSampler(String(s.shape??'ring'),s,scene.equations.mask,{isCancelled:c.isCancelled}),velocity=createBouncingVelocitySampler(s),scope={...scene.parameters,t:time};
 for(const [k,v]of Object.entries(scope))if(!Number.isFinite(v))throw new Error(`参数 ${k} 非有限`);
 const states=new Float64Array(count*4);let samples=0,invalid=0,accepted=0;const budget=Math.max(1_000_000,count*32),warnings:string[]=[];
 for(let i=0;i<count;i++){if((i&1023)===0)cancelled(c);if(samples>=budget)break;let p:Point|null=null;for(let j=0;j<256&&samples<budget;j++){samples++;const q=sample(rng,scope);if(q&&insideBoundary([q[0]-bx,q[1]-by],billiard.boundary)){p=q;break;}invalid++;}if(!p)continue;const v=velocity(p,rng);states.set([p[0]-bx,p[1]-by,...v],accepted++*4);}
 warnings.push(...(sample.diagnostics?.().warnings??[]));if(accepted<count)warnings.push(`请求 ${count} 个粒子，${samples} 次候选采样仅接受 ${accepted} 个；未补造初始位置。`);if(invalid)warnings.push(`${invalid} 个初始候选位于碰撞边界外或不满足公式。`);return{key,states,count:accepted,samples,invalid,warnings};
}
// The request is the single initial-state input boundary: both cache identity and sampler
// consume this restricted object. Display, mathematical time, palette and viewport never
// leak back through a retained source scene into initialization.
const INITIAL_SETTINGS=['count','seed','boundary','radius','ellipseY','sides','polygon','collisionRadius','boundaryCenterX','boundaryCenterY','shape','initialRadius','shapeCenterX','shapeCenterY','shapeInnerRatio','shapeTurns','shapeTightness','shapeLineWidth','shapeDegree','shapeLissajousA','shapeLissajousB','shapeLissajousDelta','shapeRoseK','shapeSuperellipseN','shapeK','shapeBoxBounds','boxMinX','boxMaxX','boxMinY','boxMaxY','fill','formulaDomain','formulaCoordinates','formulaResolution','velocity','speed','angle','spread','velocityNoise','velocityCenterX','velocityCenterY'] as const;
interface InitialRequest {settings:Settings;equations:Record<string,string>;parameters:Record<string,number>;time:number;key:string;}
function initialRequest(scene:SceneDocument,time:number):InitialRequest {
 const settings:Settings={};for(const key of INITIAL_SETTINGS)if(Object.hasOwn(scene.settings,key))settings[key]=scene.settings[key];
 const equations:Record<string,string>={},parameters:Record<string,number>={};let formulaTime=0;
 if(settings.shape==='formula'){
  const formula=scene.equations.mask??'sin(8*x)*sin(8*y)>0.5';equations.mask=formula;
  parse(normalizeBouncingFormula(formula)).traverse(node=>{if(node.type!=='SymbolNode')return;const name=(node as unknown as {name:string}).name;if(name==='t')formulaTime=time;else if(name!=='x'&&name!=='y'&&Object.hasOwn(scene.parameters,name)){const v=scene.parameters[name];if(!Number.isFinite(v))throw new Error(`参数 ${name} 非有限`);parameters[name]=v;}});
 }
 const input={settings,equations,parameters,time:formulaTime};return{...input,key:JSON.stringify(input)};
}

function paletteLut(scene:SceneDocument){validatePalette(scene.palette);const result=new Float32Array(4096*4);for(let i=0;i<4096;i++){result.set(paletteColor(scene.palette,i/4095),i*4);result[i*4+3]=1;}return result;}
function frame(scene:SceneDocument,time:number,state:Initial,view:BouncingRasterView,weight:number,c:GenerateContext):BouncingRasterFrame {
 const s=scene.settings,t=parseParticleTransform(s),bx=numberSetting(s,'boundaryCenterX',0,-1e6,1e6),by=numberSetting(s,'boundaryCenterY',0,-1e6,1e6),b=prepareBilliard(boundaryFromSettings(s),numberSetting(s,'collisionRadius',0,0,1000)),elapsed=bouncingElapsedTime(s,time),metric=['index','radius','angle','height'].indexOf(String(s.colorMetric??'index'));if(metric<0)throw new Error('未知弹跳颜色依据');
 const matrix:[number,number,number,number,number,number]=[t.sx*t.co,-t.sy*t.si,t.sx*t.si,t.sy*t.co,t.ox+bx*t.sx*t.co-by*t.sy*t.si,t.oy+bx*t.sx*t.si+by*t.sy*t.co];if(!matrix.every(Number.isFinite))throw new Error('弹跳图像变换溢出');
 return{initial:state.states,count:state.count,boundary:b.boundary,time:elapsed,weight,diameter:numberSetting(s,'pointSize',1,.01,100),matrix,view,palette:paletteLut(scene),metric,repair:i=>b.advance([state.states[i*4],state.states[i*4+1]],[state.states[i*4+2],state.states[i*4+3]],elapsed).position,cancel:()=>cancelled(c)};
}
function depositCPU(values:Float64Array,width:number,height:number,job:BouncingRasterFrame){
 const {matrix:m,view:v}=job,r=job.diameter/2,sub=Math.min(1,4*r*r);let splats=0;
 for(let i=0;i<job.count;i++){if((i&1023)===0)job.cancel?.();const p=job.repair(i),wx=m[0]*p[0]+m[1]*p[1]+m[4],wy=m[2]*p[0]+m[3]*p[1]+m[5],x=(wx-v.centerX)/v.spanX*width+width/2,y=height/2-(wy-v.centerY)/v.spanY*height;
  if(!Number.isFinite(x)||!Number.isFinite(y))throw new Error('粒子图像坐标溢出');const t=job.metric===0?i/Math.max(1,job.count-1):job.metric===1?Math.hypot((wx-v.centerX)/(v.spanX/2),(wy-v.centerY)/(v.spanY/2)):job.metric===2?Math.atan2(wy-v.centerY,wx-v.centerX)/(Math.PI*2)+.5:(wy-v.centerY)/v.spanY+.5,at=Math.round(clamp(t)*4095)*4;
  const left=Math.max(0,Math.ceil(x-r-1)),right=Math.min(width-1,Math.floor(x+r)),top=Math.max(0,Math.ceil(y-r-1)),bottom=Math.min(height-1,Math.floor(y+r));
  for(let py=top;py<=bottom;py++)for(let px=left;px<=right;px++){if(++splats>2_000_000_000)throw new Error('CPU 粒子光栅像素工作超过 20 亿次，请减少点尺寸或样本');const mass=clamp(r+.5-Math.hypot(px+.5-x,py+.5-y))*sub*job.weight;if(mass<=0)continue;const o=(py*width+px)*4;for(let k=0;k<3;k++)values[o+k]+=job.palette[at+k]*mass;values[o+3]+=mass;}
 }
}
function toneCPU(values:Float64Array,exposure:number,bg:[number,number,number],transparent:boolean,c:GenerateContext){const pixels=new Uint8ClampedArray(values.length);for(let i=0;i<values.length;i+=4){if((i&16383)===0)cancelled(c);const mass=values[i+3],alpha=-Math.expm1(-mass*exposure);for(let k=0;k<3;k++){const rgb=mass>0?clamp(values[i+k]/mass):0;pixels[i+k]=Math.round(255*(transparent?rgb:rgb*alpha+bg[k]*(1-alpha)));}pixels[i+3]=transparent?Math.round(alpha*255):255;}return pixels;}
function overlay(pixels:Uint8ClampedArray,width:number,height:number,scene:SceneDocument,time:number,view:BouncingRasterView,c:GenerateContext,warnings:string[]){
 const guides=createBouncingGuides(scene,time,{isCancelled:c.isCancelled});warnings.push(...guides.warnings);let work=0;
 for(const guide of guides.overlays){const rgb=hexRGB(guide.color),p=guide.positions;for(let i=0;i<p.length;i+=6){if((i&255)===0)cancelled(c);const ax=(p[i]-view.centerX)/view.spanX*width+width/2,ay=height/2-(p[i+1]-view.centerY)/view.spanY*height,bx=(p[i+3]-view.centerX)/view.spanX*width+width/2,by=height/2-(p[i+4]-view.centerY)/view.spanY*height,dx=bx-ax,dy=by-ay,l=dx*dx+dy*dy,r=guide.width/2;
  const minX=Math.max(0,Math.floor(Math.min(ax,bx)-r-1)),maxX=Math.min(width-1,Math.ceil(Math.max(ax,bx)+r)),minY=Math.max(0,Math.floor(Math.min(ay,by)-r-1)),maxY=Math.min(height-1,Math.ceil(Math.max(ay,by)+r));
  for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){if(++work>50_000_000)throw new Error('轮廓光栅超过 5000 万像素工作，请减小线宽或分辨率');const u=l?clamp(((x+.5-ax)*dx+(y+.5-ay)*dy)/l):0,a=clamp(r+.5-Math.hypot(x+.5-ax-u*dx,y+.5-ay-u*dy))*guide.opacity;if(a<=0)continue;const at=(y*width+x)*4,old=pixels[at+3]/255,total=a+old*(1-a);for(let k=0;k<3;k++)pixels[at+k]=Math.round((rgb[k]*a+pixels[at+k]/255*old*(1-a))/total*255);pixels[at+3]=Math.round(total*255);}
 }}
}
/** A single worker owns a bounded seed cache and GPU programs. Output buffers are newly allocated and transferable. */
export class BouncingRasterSession {
 private state?:Initial;private gpu=new BouncingRasterGpu();private hits=0;
 reset(){this.state=undefined;this.hits=0;this.gpu.dispose();}
 diagnostics(){return{retainedBytes:(this.state?.states.byteLength??0)+(this.state?.key.length??0)*2,particles:this.state?.count??0,cacheHits:this.hits};}
 generate(base:SceneDocument,c:GenerateContext):SceneOutput {try{return this.run(base,c);}catch(e){this.reset();throw e;}finally{this.gpu.end();}}
 private run(base:SceneDocument,c:GenerateContext):SceneOutput {
  const started=performance.now();if(base.kind!=='bouncing')throw new Error('直接弹跳图像需要 bouncing 场景');cancelled(c);this.hits=0;
  const current=sceneAtTime(base,c.time),s=current.settings,count=integer(s,'count',1800,1,5_000_000),fps=integer(s,'bouncingHistoryFps',30,1,120),lifetime=numberSetting(s,'trailDuration',1,.001,60),times=bouncingRasterTimes(c.time,lifetime,fps,s.trails===true),backend=String(s.bouncingBackend??'auto'),warnings:string[]=[];if(!['auto','cpu','gpu'].includes(backend))throw new Error('未知弹跳后端');
  if(count*times.length>MAX_WORK)throw new Error('粒子 × 历史采样超过 10 亿次工作预算，请降低数量、历史寿命或采样率');
  let plannedWork=0,plannedSplats=0;for(const at of times){const snapshot=sceneAtTime(base,at),n=integer(snapshot.settings,'count',1800,1,5_000_000),diameter=numberSetting(snapshot.settings,'pointSize',1,.01,100);plannedWork+=n;plannedSplats+=n*Math.ceil(diameter+1)**2;}if(plannedWork>MAX_WORK||plannedSplats>MAX_SPLAT_WORK)throw new Error('动画粒子或点尺寸展开超过 10 亿弹道 / 80 亿像素测试预算，请减少粒子、点尺寸或历史采样');
  let gpu=backend!=='cpu';const [width,height]=rasterDimensions(c,1,gpu?'webgl2':'cpu',warnings);if(count*32+width*height*(gpu?28:36)+8*1024*1024>MAX_MEMORY)throw new Error('弹跳初始状态和图像超过 1 GiB 显式工作内存预算');
  const view=bouncingRasterView(current,width,height),background=String(s.background??'#080b12');if(!/^#[\da-f]{6}$/i.test(background))throw new Error('图像背景须为 #RRGGBB');const bg=hexRGB(background),transparent=s.transparentBackground===true,exposure=numberSetting(s,'bouncingExposure',.04,.00001,100);
  let values:Float64Array|undefined,pixels:Uint8ClampedArray|undefined,samples=0,invalid=0,recorded=0,repairs=0,totalWork=0;
  if(gpu)try{this.gpu.begin(width,height);}catch(e){gpu=false;this.gpu.dispose();warnings.push(`GPU 直接图像回退 CPU：${e instanceof Error?e.message:String(e)}`);}
  // A GPU failure invalidates the whole accumulated image; CPU replays all frames, never mixes partial results.
  const render=()=>{samples=0;invalid=0;recorded=0;repairs=0;totalWork=0;if(!gpu){if(count*32+width*height*36+8*1024*1024>MAX_MEMORY)throw new Error('CPU 双精度图像和初始状态超过 1 GiB 工作内存预算');values=new Float64Array(width*height*4);}
   for(const at of times){cancelled(c);const snapshot=sceneAtTime(base,at),n=integer(snapshot.settings,'count',1800,1,5_000_000);totalWork+=n;if(totalWork>MAX_WORK||n*32+width*height*(gpu?28:36)+8*1024*1024>MAX_MEMORY)throw new Error('动画历史实际超过粒子工作或内存预算');
    const request=initialRequest(snapshot,at);if(this.state?.key===request.key)this.hits++;else{this.state=undefined;this.state=initial(request,c);}const state=this.state;samples+=state.samples;invalid+=state.invalid;for(const warning of state.warnings)if(!warnings.includes(warning))warnings.push(warning);const weight=s.trails===true&&s.bouncingHistoryFade!==false?clamp(1-(c.time-at)/lifetime):1;if(weight===0||s.trails===true&&snapshot.settings.recordTrails===false)continue;
    const job=frame(snapshot,at,state,view,weight,c);recorded+=state.count;if(!state.count)continue;if(gpu)repairs+=this.gpu.frame(job);else depositCPU(values!,width,height,job);
   }
  };
  try{render();if(gpu)pixels=this.gpu.finish(exposure,bg,transparent);}catch(e){if(!gpu||(e instanceof DOMException&&e.name==='AbortError'))throw e;this.gpu.dispose();gpu=false;warnings.push(`GPU 直接图像失败，整帧 CPU 重算：${e instanceof Error?e.message:String(e)}`);render();}
  if(!pixels)pixels=toneCPU(values!,exposure,bg,transparent,c);cancelled(c);overlay(pixels,width,height,current,c.time,view,c,warnings);
  if(gpu)warnings.push('GPU 浮点累积不保证跨上下文逐字节一致；需要严格像素重放时请选择 CPU。');
  if(repairs)warnings.push(`${repairs} 个 GPU 精度/碰撞边界样本已用 CPU 双精度重算。`);if(gpu&&s.boundary==='ellipse')warnings.push('椭圆 GPU 使用 float32，长时间轨道可能放大误差；CPU 使用双精度。');if(s.colorMetric!=='index')warnings.push('图像颜色使用固定视口归一化，避免历史帧按粒子极值改变颜色。');if(s.trails===true)warnings.push(`有限历史以 ${fps} Hz 从原场景重放；缓存初始采样，不声称无限时长累积或每帧实时。`);
  return{type:'raster',cameraResolved:true,dimension:2,backend:gpu?'webgl2':'cpu',width,height,pixels,stats:{samples,generated:recorded,invalid,elapsedMs:performance.now()-started},temporal:{time:c.time,windowStart:times[0],frames:times.length,samplingFps:fps,recordedPoints:recorded,cacheHits:this.hits},warnings};
 }
}
export function generateBouncingRaster(scene:SceneDocument,context:GenerateContext,session?:BouncingRasterSession):SceneOutput {if(session)return session.generate(scene,context);const owned=new BouncingRasterSession();try{return owned.generate(scene,context);}finally{owned.reset();}}
