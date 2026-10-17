import type {GenerateContext, SceneDocument, SceneOutput, Settings, Palette} from '../types';
import {finite, numberSetting, random} from '../engine/expression';
import {parseSpirographVersion,prepareSpirographProjection,prepareSpirographSourceMotion,type SpirographVersion} from '../engine/spirographModel';
import {hexRGB, hsvRGB, paletteStopsColor, paletteColor, validatePalette} from '../engine/palette';

type Point = [number, number];
export interface SpirographRotor {radius: number; mode: 'inside'|'outside';}
export interface SpirographLayer {
  id: string; name: string; statorRadius: number; statorColor: string;
  rotors: SpirographRotor[];
  penDistance: number; speed: number; showGuides: boolean; autoStopOnClosure: boolean;
  strokeColor: string; palette: string[]; colorPalette?: Palette; strokeWidth: number; visible: boolean; enabled: boolean;
  repeatGradient: boolean; phase: number; direction: 1|-1; opacity: number; turns: number;
}
export interface SpirographCompletion {
  totalSeconds: number|null;
  geometrySeconds?: number|null;
  layers: {id: string; closureTurns: number|null; drawTurns: number; startSeconds: number|null; drawSeconds: number|null; endSeconds: number|null}[];
  warnings: string[];
}
/** Absolute clear events remove earlier ink without changing the drawing clock. A restart supersedes old clear events. */
export function spirographTraceClock(settings:Settings,time:number):{elapsed:number;animated:boolean;advancing:boolean;clearElapsed:number|null} {
  finite(time,'时间');const start=numberSetting(settings,'traceStartTime',0,0,1e9),clear=settings.traceClearTime===undefined?null:numberSetting(settings,'traceClearTime',0,0,1e9),advancing=settings.animate===true;
  return{elapsed:time-start,animated:advancing&&settings.finishTrace!==true,advancing,clearElapsed:clear!==null&&clear>start&&time>=clear?clear-start:null};
}
const TAU = 2*Math.PI, FADE_SECONDS = .6, MAX_LAYERS = 32;
const clamp = (v:number,a=0,b=1)=>Math.max(a,Math.min(b,v));
function record(v:unknown,label:string):Record<string,unknown> {if(!v||typeof v!=='object'||Array.isArray(v))throw new Error(`${label} 必须是对象`);return v as Record<string,unknown>;}
function numeric(v:unknown,fallback:number,label:string,min=-1e6,max=1e6):number {if(v===undefined)return fallback;if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw new Error(`${label} 必须是 ${min} 至 ${max} 的有限数字`);return v;}
function bool(v:unknown,fallback:boolean,label:string):boolean {if(v===undefined)return fallback;if(typeof v!=='boolean')throw new Error(`${label} 必须是布尔值`);return v;}
function color(v:unknown,fallback:string):string {if(v===undefined)return fallback;if(typeof v!=='string'||!/^#[0-9a-f]{6}$/i.test(v))throw new Error('图层颜色必须是 #RRGGBB');return v;}
export function createDefaultSpirographLayer(id='layer-1'):SpirographLayer {return{id,name:'图层',statorRadius:150,statorColor:'#64748b',rotors:[{radius:55,mode:'inside'}],penDistance:70,speed:10,showGuides:true,autoStopOnClosure:true,strokeColor:'#43d9bd',palette:[],strokeWidth:1,visible:true,enabled:true,repeatGradient:false,phase:0,direction:1,opacity:1,turns:12};}
/** Original preset layer records are accepted without renaming; unrecognized fields fail at this owning boundary. */
export function parseSpirographLayers(raw:string):SpirographLayer[] {
  if(typeof raw!=='string'||raw.length>262144)throw new Error('图层 JSON 超出 256 KiB');
  let value:unknown;try{value=JSON.parse(raw);}catch{throw new Error('图层必须是有效 JSON 数组');}
  if(!Array.isArray(value)||value.length<1||value.length>MAX_LAYERS)throw new Error(`旋轮线需要 1 至 ${MAX_LAYERS} 个图层`);
  const ids=new Set<string>();
  return value.map((entry,index)=>{
    const v=record(entry,`图层 ${index+1}`),d=createDefaultSpirographLayer(`layer-${index+1}`);
    for(const key of Object.keys(v))if(!(key in d)&&key!=='colorPalette')throw new Error(`图层 ${index+1} 未支持字段 ${key}`);
    const id=v.id===undefined?d.id:String(v.id);if(!id||ids.has(id))throw new Error('图层 id 不能为空或重复');ids.add(id);
    if(v.name!==undefined&&typeof v.name!=='string')throw new Error('图层名称必须是文字');
    const rs=v.rotors??d.rotors;if(!Array.isArray(rs)||!rs.length||rs.length>8)throw new Error('每个图层需要 1 至 8 个转子');
    const rotors=rs.map((r,i)=>{const x=record(r,`转子 ${i+1}`);for(const key of Object.keys(x))if(!['radius','mode'].includes(key))throw new Error(`转子未支持字段 ${key}`);const mode=String(x.mode??'inside').toLowerCase();if(mode!=='inside'&&mode!=='outside')throw new Error('转子模式必须是 inside 或 outside');return{radius:numeric(x.radius,55,'转子半径',.001,10000),mode};});
    const palette=v.palette??[];if(!Array.isArray(palette)||palette.length>1024)throw new Error('图层色板需要至多 1024 种颜色');
    const direction=numeric(v.direction,1,'方向',-1,1);if(direction!==-1&&direction!==1)throw new Error('方向必须为 1 或 -1');
    return{id,name:String(v.name??d.name),rotors:rotors as SpirographLayer['rotors'],statorRadius:numeric(v.statorRadius,d.statorRadius,'定子半径',.001,10000),statorColor:color(v.statorColor,d.statorColor),penDistance:numeric(v.penDistance,d.penDistance,'笔距',-10000,10000),speed:numeric(v.speed,d.speed,'绘制速度',0,1000),showGuides:bool(v.showGuides,true,'辅助线'),autoStopOnClosure:bool(v.autoStopOnClosure,true,'闭合停止'),strokeColor:color(v.strokeColor,d.strokeColor),palette:palette.map(x=>color(x,'')),...(v.colorPalette===undefined?{}:{colorPalette:validatePalette(v.colorPalette)}),strokeWidth:numeric(v.strokeWidth,1,'线宽',.01,64),visible:bool(v.visible,true,'可见'),enabled:bool(v.enabled,true,'启用'),repeatGradient:bool(v.repeatGradient,false,'重复渐变'),phase:numeric(v.phase,0,'相位'),direction,opacity:numeric(v.opacity,1,'不透明度',0,1),turns:numeric(v.turns,12,'绘制周数',.001,10000)};
  });
}

export function convertSingleSpirograph(settings:Settings):{layer:SpirographLayer;warnings:string[]} {
  const layer=createDefaultSpirographLayer(),warnings:string[]=[];
  layer.statorRadius=numberSetting(settings,'statorRadius',3,.001,10000);
  layer.penDistance=numberSetting(settings,'penDistance',1.6,-10000,10000);
  layer.turns=numberSetting(settings,'turns',12,.001,10000);
  const raw=String(settings.rotors??'').trim();
  if(raw){let entries:unknown;try{entries=JSON.parse(raw);}catch{throw new Error('转子必须是有效 JSON');}if(!Array.isArray(entries))throw new Error('转子需要数组');layer.rotors=entries.map(v=>{const r=record(v,'转子');if(r.speed!==undefined&&r.speed!==1)throw new Error('旧转子 speed 不等于 1，无法无损转换；请保留单链模式或手动编辑多层');return{radius:r.radius,mode:String(r.mode).toLowerCase()} as SpirographRotor;});if(layer.rotors.length>1)warnings.push('旧多转子使用嵌套角度模型；多层使用累计齿轮频率，转换后的轨迹可能改变。');}
  else layer.rotors=[{radius:numberSetting(settings,'rotorRadius',1,.001,10000),mode:String(settings.rotorMode??'inside') as SpirographRotor['mode']}];
  layer.speed=layer.turns*6/numberSetting(settings,'drawDuration',12,.01,3600);
  layer.autoStopOnClosure=false;layer.showGuides=false;
  return{layer:parseSpirographLayers(JSON.stringify([layer]))[0],warnings};
}

type Fraction = {n:bigint;d:bigint};
function gcd(a:bigint,b:bigint):bigint {a=a<0n?-a:a;b=b<0n?-b:b;while(b){const q=a%b;a=b;b=q;}return a;}
function frac(n:bigint,d=1n):Fraction {const g=gcd(n,d);return{n:n/g,d:d/g};}
function decimal(x:number):Fraction {const [base,exponent='0']=String(x).toLowerCase().split('e'),[whole,tail='']=base.split('.'),n=BigInt(whole+tail),power=Number(exponent)-tail.length;return power<0?frac(n,10n**BigInt(-power)):frac(n*10n**BigInt(power));}
function add(a:Fraction,b:Fraction):Fraction{return frac(a.n*b.d+b.n*a.d,a.d*b.d);}
function times(a:Fraction,b:Fraction):Fraction{return frac(a.n*b.n,a.d*b.d);}
function ratio(a:number,b:number):Fraction{const x=decimal(a),y=decimal(b);return frac(x.n*y.d,x.d*y.n);}
interface Chain {centers:{radius:number;frequency:number;fraction:Fraction}[];penFrequency:number;penFraction:Fraction;bound:number;guideBound:number;}
function chain(layer:SpirographLayer):Chain {
  let parent=layer.statorRadius,previousPitch=frac(0n),previousMode='inside',direction=1,draw=frac(0n),spin=frac(0n),pen=frac(0n),bound=Math.abs(layer.penDistance),centerBound=0,guideBound=layer.statorRadius;
  const centers:Chain['centers']=[];
  for(let i=0;i<layer.rotors.length;i++){
    const r=layer.rotors[i],sign=r.mode==='inside'?-1:1,pitch=add(ratio(parent,r.radius),frac(BigInt(sign)));
    if(i>0&&previousMode==='outside')direction=-direction;
    draw=add(draw,i===0?frac(1n):previousPitch);spin=add(spin,pitch);
    const f=times(draw,frac(BigInt(direction))),radius=parent+sign*r.radius;
    centers.push({radius,frequency:Number(f.n)/Number(f.d),fraction:f});
    pen=times(spin,frac(BigInt(direction*sign)));bound+=Math.abs(radius);centerBound+=Math.abs(radius);guideBound=Math.max(guideBound,centerBound+r.radius);
    parent=r.radius;previousPitch=pitch;previousMode=r.mode;
  }
  return{centers,penFrequency:Number(pen.n)/Number(pen.d),penFraction:pen,bound,guideBound};
}
/** Native pitches are accumulated as doubles, without the legacy exact-rational reduction. */
function sourceChain(layer:SpirographLayer):Chain {
  let parent=layer.statorRadius,previousPitch=0,previousMode='inside',direction=1,draw=0,spin=0,pen=0,bound=Math.abs(layer.penDistance),centerBound=0,guideBound=layer.statorRadius;
  const centers:Chain['centers']=[];
  for(let i=0;i<layer.rotors.length;i++){
    const r=layer.rotors[i],sign=r.mode==='inside'?-1:1,pitch=parent/r.radius+sign;
    if(i>0&&previousMode==='outside')direction=-direction;
    const drawPitch=i===0?1:previousPitch,frequency=(drawPitch+draw)*direction;draw+=drawPitch;
    const spinBase=pitch+spin;spin+=pitch;pen=spinBase*direction*sign;
    const radius=parent+sign*r.radius;centers.push({radius,frequency,fraction:decimal(frequency)});
    bound+=Math.abs(radius);centerBound+=Math.abs(radius);guideBound=Math.max(guideBound,centerBound+r.radius);
    parent=r.radius;previousPitch=pitch;previousMode=r.mode;
  }
  return{centers,penFrequency:pen,penFraction:decimal(pen),bound,guideBound};
}
/** Retained continued-fraction stopping criteria; the original Java LCM is signed long. */
function sourceClosure(c:Chain):number {
  const denominator=(value:number)=>{
    const x=Math.abs(value);let previousNumerator=0n,previousDenominator=1n,numerator=1n,denominator=0n,remainder=x;
    for(;;){const a=BigInt(Math.floor(remainder)),n=a*numerator+previousNumerator,d=a*denominator+previousDenominator;if(d>10000n)break;
      const approximation=Number(n)/Number(d);previousNumerator=numerator;previousDenominator=denominator;numerator=n;denominator=d;
      if(Math.abs(approximation-x)<=1e-9)break;const fraction=remainder-Number(a);if(fraction<=1e-9)break;remainder=1/fraction;
    }
    return denominator===0n?1n:denominator;
  };
  let lcm=1n;for(const frequency of [...c.centers.map(x=>x.frequency),c.penFrequency]){const d=denominator(frequency);lcm=BigInt.asIntN(64,lcm/gcd(lcm,d)*d);}
  return Number(lcm);
}
function sample(layer:SpirographLayer,c:Chain,theta:number):{pen:Point;centers:Point[]} {
  theta=theta*layer.direction+layer.phase;let x=0,y=0;const centers:Point[]=[];
  for(const wheel of c.centers){x+=wheel.radius*Math.cos(theta*wheel.frequency);y+=wheel.radius*Math.sin(theta*wheel.frequency);centers.push([x,y]);}
  return{pen:[x+layer.penDistance*Math.cos(theta*c.penFrequency),y+layer.penDistance*Math.sin(theta*c.penFrequency)],centers};
}
/** Samples cumulative pitch mathematics, with phase in radians and independent whole-layer direction. */
export function sampleSpirographChain(layer:SpirographLayer,theta:number):{pen:Point;centers:Point[]} {finite(theta,'旋轮转角');const valid=parseSpirographLayers(JSON.stringify([layer]))[0];return sample(valid,chain(valid),theta);}
function closure(layer:SpirographLayer,c:Chain):number|null {
  const fs=c.centers.filter(x=>x.radius!==0).map(x=>x.fraction);if(layer.penDistance!==0)fs.push(c.penFraction);
  let denominator=1n;for(const f of fs){denominator=denominator/gcd(denominator,f.d)*f.d;if(denominator>10n**24n)return null;}
  let divisor=0n;for(const f of fs)divisor=gcd(divisor,f.n*(denominator/f.d));
  if(divisor===0n)return 0;
  const turns=Number(denominator)/Number(divisor);return Number.isFinite(turns)&&turns<=10000?turns:null;
}
interface Profile {base:number;duration:number;ramp:number;start:boolean;end:boolean;}
function profile(turns:number,speed:number,s:Settings):Profile|null {
  if(speed===0&&turns>0)return null;const base=turns===0?0:turns*6/speed;
  const ramp=Math.min(numberSetting(s,'easeDuration',.6,0,10),base*.45),start=s.startEaseEnabled===true,end=s.endEaseEnabled===true;
  return{base,duration:base+(Number(start)+Number(end))*ramp*2/Math.PI,ramp,start,end};
}
function phaseAt(t:number,p:Profile,turns:number):number {
  if(p.duration===0)return 0;if(t>=p.duration)return turns*TAU;t=Math.max(0,t);
  const e=p.ramp,start=p.start?e:0,end=p.end?e:0,a=1-2/Math.PI;
  let distance:number;
  if(e>0&&t<start)distance=t-e*2/Math.PI*Math.sin(Math.PI*t/(2*e));
  else if(e>0&&t>p.duration-end){const remain=p.duration-t;distance=p.base-(remain-e*2/Math.PI*Math.sin(Math.PI*remain/(2*e)));}
  else distance=start*a+t-start;
  return clamp(distance/p.base)*turns*TAU;
}
function layerTurns(layer:SpirographLayer,c:Chain):{closureTurns:number|null;drawTurns:number} {const closed=closure(layer,c);return{closureTurns:closed,drawTurns:layer.autoStopOnClosure&&closed!==null?closed:layer.turns};}
export interface PreparedSpirographLayer {
  readonly layer:SpirographLayer;readonly chain:Chain;readonly closureTurns:number|null;readonly drawTurns:number;
  readonly profile:Profile|null;readonly startSeconds:number|null;readonly drawSeconds:number|null;readonly endSeconds:number|null;readonly complexity:number;
}
export interface PreparedSpirograph {
  readonly version:SpirographVersion;readonly layers:readonly PreparedSpirographLayer[];readonly active:readonly PreparedSpirographLayer[];
  readonly bound:number;readonly weight:number;readonly warnings:readonly string[];
  readonly sourceMotion:ReturnType<typeof prepareSpirographSourceMotion>|undefined;
  readonly geometrySeconds:number|null;
  /** local-v1 retains its historical final-guide-padding wait estimate. Source timing is owned by sourceMotion. */
  readonly visualSeconds:number|null;
}
// Four structural plans retain at most four bounded layer JSON documents. Per-plan
// source replay has O(layers) state. Time, palette animation and transforms never
// enter an unbounded cache; a changed layer record/profile gets a new plan.
const preparedPlans=new Map<string,PreparedSpirograph>();
function freezePrepared(value:unknown):void {if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value))freezePrepared(child);Object.freeze(value);}}
/** A prepared layer's canonical (+sin) geometry; projection alone owns source Y. */
export function samplePreparedSpirographLayer(info:PreparedSpirographLayer,phaseRadians:number):{pen:Point;centers:Point[]} {finite(phaseRadians,'旋轮转角');return sample(info.layer,info.chain,phaseRadians);}

export function prepareSpirograph(settings:Settings):PreparedSpirograph {
  const version=parseSpirographVersion(settings.spirographVersion),raw=String(settings.layers??'');
  if(!raw.trim())throw new Error('旋轮多层行为需要非空图层 JSON');
  const key=JSON.stringify([version,raw,settings.startEaseEnabled,settings.endEaseEnabled,settings.easeDuration,settings.fadeInStatorsOnStart,settings.fadeOutStatorsOnFinish,settings.traceStartTime,settings.traceFinishTime]);
  const found=preparedPlans.get(key);if(found){preparedPlans.delete(key);preparedPlans.set(key,found);return found;}
  const source=version!=='local-v1',layers=parseSpirographLayers(raw),warnings:string[]=[],infos:PreparedSpirographLayer[]=[];let total:number|null=0;
  for(const layer of layers){
    const c=source?sourceChain(layer):chain(layer),closed=source?sourceClosure(c):closure(layer,c),turns=layer.autoStopOnClosure&&closed!==null?closed:layer.turns,p=source?null:profile(turns,layer.speed,settings),runnable=layer.enabled&&layer.visible;
    const duration=!layer.autoStopOnClosure||!p||closed===null?null:p.duration,start=runnable?total:null;
    if(runnable){
      if(closed===null)warnings.push(`${layer.name}：10000 周内无法证明闭合，使用显式周数 ${layer.turns}。`);
      if(layer.speed===0&&turns>0)warnings.push(`${layer.name}：速度为 0，当前图层暂停且没有有限完成时间。`);
      if(!layer.autoStopOnClosure)warnings.push(`${layer.name}：关闭闭合停止；动画持续绘制，完成等待没有有限终点。`);
      total=total===null||duration===null?null:total+duration;
    }
    infos.push({layer,chain:c,closureTurns:closed,drawTurns:turns,profile:p,startSeconds:source?null:start,drawSeconds:source?null:runnable?duration:null,endSeconds:source?null:runnable?total:null,complexity:Math.max(1,turns*Math.max(...c.centers.map(x=>Math.abs(x.frequency)),Math.abs(c.penFrequency)))});
  }
  const active=infos.filter(x=>x.layer.visible&&x.layer.enabled),bound=Math.max(1,...infos.filter(x=>x.layer.visible&&(source||x.layer.enabled)).map(x=>Math.max(x.chain.bound,x.layer.showGuides?x.chain.guideBound:0)));
  const sourceMotion=source?prepareSpirographSourceMotion(infos.map(x=>({...x.layer,closureDegrees:x.closureTurns!*360})),settings):undefined;
  const result:PreparedSpirograph={version,layers:infos,active,bound,weight:active.reduce((n,x)=>n+x.complexity,0),warnings,sourceMotion,geometrySeconds:source?null:total,visualSeconds:source?null:total===null?null:total+(settings.fadeOutStatorsOnFinish===true&&active.some(x=>x.layer.showGuides)?FADE_SECONDS:0)};
  freezePrepared(result);preparedPlans.set(key,result);while(preparedPlans.size>4)preparedPlans.delete(preparedPlans.keys().next().value!);return result;
}
/** Returns a real completion within the requested horizon, or null when still
 * drawing/fading. It never demands that an unbounded trajectory finish first. */
export function spirographVisualCompletion(settings:Settings,throughSeconds:number):number|null {
  finite(throughSeconds,'旋轮等待期限');const version=parseSpirographVersion(settings.spirographVersion);
  if(version==='local-v1')return estimateSpirographCompletion(settings).totalSeconds;
  const plan=prepareSpirograph(settings);
  // These are existing local preview overrides, not the native finish event.
  if(settings.finishTrace===true||settings.animate!==true)return 0;
  return plan.sourceMotion!.sample(Math.max(0,throughSeconds)).visualSeconds;
}
export function estimateSpirographCompletion(settings:Settings,throughSeconds=1200):SpirographCompletion {
  const version=parseSpirographVersion(settings.spirographVersion);
  if(!String(settings.layers??'').trim()&&version==='local-v1')return{totalSeconds:numberSetting(settings,'drawDuration',12,.01,3600),layers:[],warnings:[]};
  const plan=prepareSpirograph(settings),frame=plan.sourceMotion?.sample(throughSeconds),warnings=[...plan.warnings];
  if(frame&&frame.visualSeconds===null&&settings.animate===true&&settings.finishTrace!==true)warnings.push(`源规则在 ${throughSeconds} 秒回放范围内尚未视觉结束；完成等待仍可使用其最大期限。`);
  return{totalSeconds:frame?(settings.finishTrace===true||settings.animate!==true?0:frame.visualSeconds):plan.visualSeconds,...(frame?{geometrySeconds:frame.geometrySeconds}:{}),layers:plan.active.map(x=>{const i=plan.layers.indexOf(x),start=frame?frame.startSeconds[i]:x.startSeconds,end=frame?frame.endSeconds[i]:x.endSeconds;return{id:x.layer.id,closureTurns:x.closureTurns,drawTurns:x.drawTurns,startSeconds:start,drawSeconds:frame?(start!==null&&end!==null?end-start:null):x.drawSeconds,endSeconds:end};}),warnings};
}

/** CPU distance-to-segment rasterization. RGBA is straight alpha, with real subpixel stroke coverage. */
export function generateLayeredSpirograph(scene:SceneDocument,context:GenerateContext):SceneOutput {
  const started=performance.now(),s=scene.settings,plan=prepareSpirograph(s),source=plan.version!=='local-v1',warnings=[...plan.warnings];
  const width=context.width,height=context.height;
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>16384||height>16384||width*height>16777216)throw new Error('旋轮位图尺寸必须为正整数且不超过 16777216 像素');
  const requested=numberSetting(s,'count',18000,2,1000000);if(!Number.isInteger(requested))throw new Error('曲线采样必须是整数');
  const budget=context.quality==='export'?500000:100000,count=Math.min(requested,budget);if(count!==requested)warnings.push(`曲线采样请求 ${requested}，本次预算 ${budget}。`);
  const pixels=new Uint8ClampedArray(width*height*4),transparent=s.transparentBackground===true,bg=hexRGB(color(s.background??s.backgroundColor,'#080b12'));
  if(!transparent)for(let i=0;i<pixels.length;i+=4){pixels[i]=Math.round(bg[0]*255);pixels[i+1]=Math.round(bg[1]*255);pixels[i+2]=Math.round(bg[2]*255);pixels[i+3]=255;}
  const frameClock=s.spirographClock==='source-frame-v1';
  if(frameClock&&!scene.evaluatedSpirographFrame)throw new Error('旋轮逐帧生成需要共享帧回放结果，请通过 generateScene 生成');
  const clock=spirographTraceClock(s,context.time),t=frameClock?scene.evaluatedSpirographFrame!.sceneTime:clock.elapsed,animated=frameClock||clock.animated;
  const {unit,project,strokeScale}=prepareSpirographProjection(scene,context.time,width,height,plan.bound);
  const frame=frameClock?scene.evaluatedSpirographFrame:source?plan.sourceMotion!.sample(Math.max(0,t),context.isCancelled):undefined;
  const clearFrame=!frameClock&&source&&clock.clearElapsed!==null?plan.sourceMotion!.sample(clock.clearElapsed,context.isCancelled):undefined;
  let samples=0,segments=0,pixelVisits=0,cancelled=false;
  const abort=()=>{if(context.isCancelled?.()){cancelled=true;return true;}return false;};
  const line=(from:Point,to:Point,rgb:number[],stroke:number,opacity:number)=>{
    if(opacity<=0)return;const a=project(from),b=project(to),r=stroke*strokeScale/2,dx=b[0]-a[0],dy=b[1]-a[1],length2=dx*dx+dy*dy;
    if(![...a,...b,length2].every(Number.isFinite))throw new Error('空间变换使旋轮坐标超出有限范围');
    const x0=Math.max(0,Math.floor(Math.min(a[0],b[0])-r-.5)),x1=Math.min(width-1,Math.ceil(Math.max(a[0],b[0])+r+.5)),y0=Math.max(0,Math.floor(Math.min(a[1],b[1])-r-.5)),y1=Math.min(height-1,Math.ceil(Math.max(a[1],b[1])+r+.5));
    pixelVisits+=Math.max(0,x1-x0+1)*Math.max(0,y1-y0+1);if(pixelVisits>120000000)throw new Error('旋轮 CPU 栅格工作超过 1.2 亿像素测试；请降低线宽、采样或导出尺寸');
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const f=length2===0?0:clamp(((x+.5-a[0])*dx+(y+.5-a[1])*dy)/length2),distance=Math.hypot(x+.5-a[0]-f*dx,y+.5-a[1]-f*dy),alpha=clamp(r+.5-distance,0,Math.min(1,stroke*strokeScale))*opacity;if(alpha<=0)continue;const i=(y*width+x)*4,old=pixels[i+3]/255,out=alpha+old*(1-alpha);for(let k=0;k<3;k++)pixels[i+k]=Math.round((rgb[k]*alpha+(pixels[i+k]/255)*old*(1-alpha))/out*255);pixels[i+3]=Math.round(out*255);}
    segments++;
  };
  const circle=(center:Point,radius:number,rgb:number[],opacity:number)=>{const n=Math.max(32,Math.min(512,Math.ceil(TAU*radius*unit/3)));let old:Point=[center[0]+radius,center[1]];for(let j=1;j<=n;j++){const p:Point=[center[0]+radius*Math.cos(TAU*j/n),center[1]+radius*Math.sin(TAU*j/n)];line(old,p,rgb,.65,opacity);old=p;}};
  const drawLayerGuides=(l:SpirographLayer,c:Chain,phase:number,opacity:number)=>{const guide=hexRGB(l.statorColor),state=sample(l,c,phase);circle([0,0],l.statorRadius,guide,opacity);let prior:Point=[0,0];for(let i=0;i<state.centers.length;i++){const center=state.centers[i];circle(center,l.rotors[i].radius,guide,opacity);line(prior,center,guide,.65,opacity);prior=center;}line(prior,state.pen,hexRGB(l.strokeColor),.8,opacity);};
  const active=source?plan.layers.filter(x=>x.layer.visible):plan.active,weight=plan.weight;
  const sourceGuides:(()=>void)[]=[];
  for(const info of active){
    const {layer:l,chain:c,profile:p,drawTurns,closureTurns,complexity}=info,turns={drawTurns,closureTurns};
    const index=plan.layers.indexOf(info),startSeconds=source?(frame!.startSeconds[index]??Infinity):(info.startSeconds??Infinity),local=t-startSeconds;
    if(abort())break;
    const finiteStop=l.autoStopOnClosure&&turns.closureTurns!==null&&p!==null;
    const atTime=(localTime:number)=>localTime<0?0:finiteStop?phaseAt(localTime,p!,turns.drawTurns):Math.max(0,localTime)*l.speed*Math.PI/3;
    const phase=source&&!l.enabled?0:animated?(source?frame!.phases[index]*Math.PI/180:atTime(local)):turns.drawTurns*TAU,clearPhase=frameClock?scene.evaluatedSpirographFrame!.clearedPhases[index]*Math.PI/180:clock.clearElapsed===null?0:clock.advancing?(source?clearFrame!.phases[index]*Math.PI/180:atTime(clock.clearElapsed-startSeconds)):turns.drawTurns*TAU;
    if(!Number.isFinite(phase))throw new Error('旋轮时间或速度超出有限范围');
    if(source){
      if(l.showGuides&&(!animated||t>=0)&&(frameClock||s.finishTrace!==true))sourceGuides.push(()=>drawLayerGuides(l,c,phase,l.opacity*(animated?frame!.guideOpacity:1)));
      if(!l.enabled||s.showTrace===false||phase<=clearPhase||phase<=0)continue;
    }
    const fullPhase=Math.max(turns.drawTurns*TAU,phase),n=Math.max(2,Math.floor(count*complexity/Math.max(1,weight))),step=fullPhase/n;
    if(fullPhase*Math.max(...c.centers.map(x=>Math.abs(x.frequency)),Math.abs(c.penFrequency))/n>Math.PI/12)warnings.push(`${l.name}：采样间隔超过最高频率的 15°，增加曲线采样可减少折线。`);
    const path:Point[]=[],lengths:number[]=[];let length=0;
    for(let j=0;j<=n;j++){if((j&255)===0&&abort())break;const q=sample(l,c,j*step).pen;samples++;if(j>0)length+=Math.hypot(q[0]-path[j-1][0],q[1]-path[j-1][1]);path.push(q);lengths.push(length);}
    if(cancelled)break;
    const palette=l.palette.length>1?l.palette:[l.palette[0]??l.strokeColor,l.palette[0]??l.strokeColor];
    // Full palettes own their interpolation/offset/cycles. Legacy stop arrays retain their closed-domain behavior.
    const traceColor=(u:number)=>l.colorPalette?paletteColor(l.colorPalette,u):paletteStopsColor(palette,u);
    if(s.showTrace!==false&&!source&&(!animated||local>=0)&&turns.drawTurns===0&&(clock.clearElapsed===null||clock.advancing&&clock.clearElapsed<startSeconds))line(path[0],path[0],traceColor(0),l.strokeWidth,l.opacity);
    if(s.showTrace!==false&&(!animated||local>=0)&&phase>clearPhase){const visibleSteps=Math.min(n,Math.ceil(phase/step)),firstStep=Math.max(1,Math.floor(clearPhase/step)+1);for(let j=firstStep;j<=visibleSteps;j++){if((j&255)===0&&abort())break;const begin=Math.max((j-1)*step,clearPhase),end=Math.min(j*step,phase),fromFraction=clamp((begin-(j-1)*step)/step),fraction=clamp((end-(j-1)*step)/step),from=fromFraction>0?sample(l,c,begin).pen:path[j-1],to=fraction<1?sample(l,c,end).pen:path[j],at=(lengths[j-1]+(lengths[j]-lengths[j-1])*(fromFraction+fraction)*.5)/Math.max(length,1e-15),u=l.repeatGradient?(at*Math.max(1,turns.drawTurns))%1:at;if(!source||from[0]!==to[0]||from[1]!==to[1])line(from,to,traceColor(u),l.strokeWidth,l.opacity);}}
    if(cancelled)break;
    const done=finiteStop&&local>=p!.duration,fadeIn=s.fadeInStatorsOnStart===true?clamp(local/FADE_SECONDS):1,fadeOut=s.fadeOutStatorsOnFinish===true&&done?clamp(1-(local-p!.duration)/FADE_SECONDS):1;
    if(!source&&l.showGuides&&(!animated||local>=0)&&s.finishTrace!==true)drawLayerGuides(l,c,phase,l.opacity*(animated?fadeIn*fadeOut:1));
  }
  if(!cancelled)for(const drawGuide of sourceGuides)drawGuide();
  if(cancelled)warnings.push('旋轮绘制已取消；显示已完成的图层。');
  return{type:'raster',dimension:2,width,height,pixels,stats:{samples,generated:segments,invalid:0,elapsedMs:performance.now()-started},...(warnings.length?{warnings:[...new Set(warnings)]}:{})};
}


export interface SpirographExploration {layer:SpirographLayer;seed:number;score:number;closureTurns:number;bound:number;candidates:number;acceptedCandidates:number;}
/** Searches finite rational gear chains and measures actual sampled coverage inside the requested viewport. */
export function exploreSpirograph(seed:number,options:{width?:number;height?:number;candidates?:number;rotorCount?:number;isCancelled?:()=>boolean}={}):SpirographExploration {
  if(!Number.isInteger(seed)||seed<0||seed>4294967295)throw new Error('探索种子必须是 32 位非负整数');
  const width=numeric(options.width,800,'视口宽度',16,16384),height=numeric(options.height,600,'视口高度',16,16384),candidates=numeric(options.candidates,32,'候选数',1,128),rotorCount=options.rotorCount;
  if(!Number.isInteger(candidates)||rotorCount!==undefined&&(!Number.isInteger(rotorCount)||rotorCount<1||rotorCount>3))throw new Error('候选数必须是整数，探索转子数支持 1 至 3');
  const r=random(seed),toHex=(rgb:number[])=>'#'+rgb.map(v=>Math.round(clamp(v)*255).toString(16).padStart(2,'0')).join('');
  let best:SpirographExploration|undefined,acceptedCandidates=0;
  for(let attempt=0;attempt<candidates;attempt++){
    if(options.isCancelled?.())throw new Error('旋轮探索已取消');
    const layer=createDefaultSpirographLayer(`explored-${seed}`);layer.name='探索图层';layer.statorRadius=24+Math.floor(r()*49);layer.rotors=[];
    let parent=layer.statorRadius;const count=rotorCount??1+Math.floor(r()*3);
    for(let i=0;i<count;i++){const radius=Math.max(1,Math.round(parent*(.15+r()*.65)*2)/2);layer.rotors.push({radius,mode:r()<.75?'inside':'outside'});parent=radius;}
    layer.penDistance=Math.round(parent*(.3+r()*1.2)*2)/2;layer.phase=r()*TAU;layer.direction=r()<.5?-1:1;layer.showGuides=false;
    let c=chain(layer);const turns=closure(layer,c);if(turns===null||turns===0||turns>128)continue;
    // A common power-of-two scale preserves exact finite decimal ratios while fitting both viewport axes.
    const ratio=(Math.min(width,height)*.44)/Math.max(c.bound,layer.statorRadius),factor=2**Math.floor(Math.log2(ratio));
    layer.statorRadius*=factor;layer.penDistance*=factor;layer.rotors=layer.rotors.map(v=>({...v,radius:v.radius*factor}));
    if(layer.rotors.some(v=>v.radius<.001)||layer.statorRadius>10000)continue;
    c=chain(layer);const bins=new Uint16Array(32*24);let length=0,previous:Point|undefined;
    for(let i=0;i<768;i++){const p=sample(layer,c,TAU*turns*i/767).pen;if(previous)length+=Math.hypot(p[0]-previous[0],p[1]-previous[1]);previous=p;const x=Math.floor((p[0]/width+.5)*32),y=Math.floor((p[1]/height+.5)*24);if(x>=0&&x<32&&y>=0&&y<24)bins[y*32+x]++;}
    let entropy=0,occupied=0;for(const n of bins)if(n){const p=n/768;entropy-=p*Math.log2(p);occupied++;}
    const score=(entropy/Math.log2(768))*Math.sqrt(occupied/768)*Math.min(1,length/(Math.min(width,height)*20));if(score<.01)continue;
    acceptedCandidates++;layer.turns=turns;layer.speed=Math.max(1,Math.min(100,6*turns/12));
    const hue=r();layer.palette=[toHex(hsvRGB(hue,.7,.9)),toHex(hsvRGB(hue+.18,.45,1))];layer.strokeColor=layer.palette[0];
    if(!best||score>best.score)best={layer,seed,score,closureTurns:turns,bound:c.bound,candidates,acceptedCandidates};
  }
  if(!best)throw new Error('本次旋轮探索没有通过闭合与视口覆盖检查的链，请增加候选数或更换种子');
  return{...best,acceptedCandidates};
}
