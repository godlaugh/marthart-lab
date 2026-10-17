import {mapDimension} from '../engine/mapDimension';
import {hasSymmetryCustom} from '../engine/symmetryCustom';
import type {ControlSpec, GenerateContext, SceneDefinition, SceneDocument, SceneOutput, Settings} from '../types';
import {compileReal, finite, numberSetting, random} from '../engine/expression';
import {vertexColors} from '../engine/palette';
import {densityControls, densityDefaults, presentPoints} from '../engine/density';
import {samilaToneControls} from '../engine/samilaTone';
import {normalizedDensityControls} from '../engine/densityNormalization';
import {generateIteratedDensity,iteratedDensityControls,iteratedDensityDefaults} from './iteratedDensity';
import {generateLayeredSpirograph,spirographTraceClock} from './spirograph';
import {parseSpirographVersion} from '../engine/spirographModel';
import {usesSpirographFrameClock} from '../engine/spirographFrameConfig';
import {sceneAtSpirographFrame} from '../engine/spirographFramePlan';
import {spirographGuideExamples} from './spirographExamples.generated';
import {SAMILA_MODES,compileSamilaMapping,resolveSamilaSelection,projectSamila} from './samila';
export {projectSamila} from './samila';
import {compileMapIterator,symmetryStep,validateSymmetryParameters,type Point3} from './iterated';
import {SYMMETRY_DEFAULT_PARAMETERS,SYMMETRY_DEFAULT_SETTINGS} from './symmetryParameters';
export {mapStep,symmetryStep} from './iterated';
import {createNoise} from './noise';
import {generateAdvancedPerlin,perlinAdvancedControls,perlinAdvancedDefaults} from './perlin';
import {generatePerlinParticles,perlinParticleControls,perlinParticleDefaults} from './perlinParticles';
export {createNoise} from './noise';
import {parseParticleTransform,type ParticleTransform} from './particleTransform';
import {createBouncingGuides,bouncingGuideControls,bouncingGuideDefaults} from './bouncingGuides';
import {generateBouncingRaster,bouncingRasterControls,bouncingRasterDefaults} from './bouncingRaster';
import {bouncingExperienceControls,bouncingExperienceDefaults} from '../engine/bouncingExperience';
import {BouncingGpu} from '../engine/bouncingGpu';
import {insideBoundary,boundaryFromSettings,prepareBilliard,bouncingElapsedTime} from './bouncing';
export {insideBoundary,advanceBilliard,type Boundary} from './bouncing';
import {BOUNCING_SHAPES,createBouncingShapeSampler,createBouncingVelocitySampler} from './bouncingShapes';

type Point = [number, number];
const TAU = Math.PI * 2;
const MAX_COORDINATE = 1e12; // Keep finite double values representable and useful in Float32 geometry.
const number = (key:string,label:string,min:number,max:number,step:number,group='几何'):ControlSpec => ({key,label,type:'number',min,max,step,group});
const select = (key:string,label:string,values:[string,string][],group='几何'):ControlSpec => ({key,label,type:'select',options:values.map(([value,label])=>({value,label})),group});
const toggle = (key:string,label:string,group='几何'):ControlSpec => ({key,label,type:'toggle',group});
const text = (key:string,label:string,help:string,group='高级'):ControlSpec => ({key,label,type:'text',help,group});
const seedControl=number('seed','随机种子',0,4294967295,1,'采样');
const colorControl=select('colorMetric','颜色依据',[['index','采样顺序'],['radius','距原点距离'],['angle','极角'],['height','高度']],'外观');
function integer(s:Settings,key:string,fallback:number,min:number,max:number):number {
  const v=numberSetting(s,key,fallback,min,max);if(!Number.isInteger(v))throw new Error(`${key} 必须是整数`);return v;
}
function mode(s:Settings,key:string,fallback:string,allowed:string[]):string {
  const v=String(s[key]??fallback);if(!allowed.includes(v))throw new Error(`${key} 不支持 ${v}`);return v;
}
function parameters(scene:SceneDocument):Record<string,number> {
  const p={...scene.parameters};for(const [k,v] of Object.entries(p))finite(v,`参数 ${k}`);return p;
}
function time(context:GenerateContext):number {return finite(context.time,'时间');}
function seed(s:Settings):number{return integer(s,'seed',1,0,4294967295);}
function inRange(p:Point):boolean{return Number.isFinite(p[0])&&Number.isFinite(p[1])&&Math.abs(p[0])<MAX_COORDINATE&&Math.abs(p[1])<MAX_COORDINATE;}
function rotate([x,y]:Point,angle:number):Point {const c=Math.cos(angle),s=Math.sin(angle);return[c*x-s*y,s*x+c*y];}
class Geometry {
  private data:Float32Array;private cursor=0;readonly transform:ParticleTransform;
  samples=0;invalid=0;warnings:string[]=[];
  constructor(vertices:number,private topology:'points'|'segments'|'lines',private scene:SceneDocument){this.data=new Float32Array(vertices*3);this.transform=parseParticleTransform(scene.settings);}
  private append(point:[number,number,number]){if(this.cursor+3>this.data.length)throw new Error('几何采样超出预先分配的预算');this.data.set(point,this.cursor);this.cursor+=3;}
  point(p:Point,z=0):void {const q=this.transform.point(...p,z);if(!q){this.invalid++;return;}this.append(q);}
  segment(a:Point,b:Point):void {const p=this.transform.point(...a),q=this.transform.point(...b);if(!p||!q){this.invalid++;return;}this.append(p);this.append(q);}
  cancelled(c:GenerateContext):boolean {if(c.isCancelled?.()){if(!this.warnings.includes('采样已取消；显示已完成的部分。'))this.warnings.push('采样已取消；显示已完成的部分。');return true;}return false;}
  finish():SceneOutput {const positions=this.data.slice(0,this.cursor),needsColors=this.scene.settings.presentation!=='density'||this.scene.settings.paletteMode==='source';return{type:'geometry',positions,...(needsColors?{colors:vertexColors(positions,this.scene.palette,String(this.scene.settings.colorMetric??'index'))}:{}),topology:this.topology,stats:{samples:this.samples,generated:this.cursor/3,invalid:this.invalid},...(this.warnings.length?{warnings:this.warnings}:{})};}
}

function budget(requested:number,limit:number,g:Geometry,label:string):number {if(requested>limit)g.warnings.push(`${label}请求 ${requested}，本次资源预算为 ${limit}；已生成前 ${limit} 个样本。`);return Math.min(requested,limit);}

function generateMap(scene:SceneDocument,c:GenerateContext):SceneOutput {
  if(scene.settings.iteratedMode==='continuous')return generateIteratedDensity(scene,c);
  const s=scene.settings,requested=integer(s,'count',60000,1,1000000),limit=c.quality==='export'?500000:120000;
  const g=new Geometry(Math.min(requested,limit),'points',scene),count=budget(requested,limit,g,'映射点数'),dimension=mapDimension(s);
  const burn=integer(s,'burnIn',100,0,100000),r=random(seed(s)),step=compileMapIterator({x:scene.equations.x??'sin(a*y)+c*cos(a*x)',y:scene.equations.y??'sin(b*x)+d*cos(b*y)',z:scene.equations.z},parameters(scene),dimension,time(c));
  const initial=numberSetting(s,'initialRange',.1,0,100),initialMode=mode(s,'initialMode','range',['range','box']),escape=numberSetting(s,'escapeRadius',100,1,MAX_COORDINATE);
  const bounds=['X','Y','Z'].map(axis=>initialMode==='range'?[-initial,initial]:[numberSetting(s,'initial'+axis+'Min',-1,-1e6,1e6),numberSetting(s,'initial'+axis+'Max',1,-1e6,1e6)]);
  for(const [lo,hi]of bounds)if(hi<lo)throw new Error('初始盒上限必须大于或等于下限');
  const start=():Point3=>[bounds[0][0]+r()*(bounds[0][1]-bounds[0][0]),bounds[1][0]+r()*(bounds[1][1]-bounds[1][0]),dimension===3?bounds[2][0]+r()*(bounds[2][1]-bounds[2][0]):0];
  let point=start();
  for(let i=0;i<count+burn;i++){
    if((i&255)===0&&g.cancelled(c))break;
    const next=step(point);g.samples++;
    if(!next.every(Number.isFinite)||Math.hypot(...next)>escape){g.invalid++;point=start();continue;}
    point=next;if(i>=burn)g.point([point[0],point[1]],point[2]);
  }
  if(g.invalid)g.warnings.push(`${g.invalid} 次迭代发散，已从种子确定的初始盒重新开始。`);
  return{...g.finish(),dimension};
}

function generateSymmetry(scene:SceneDocument,c:GenerateContext):SceneOutput {
  if(scene.settings.iteratedMode==='continuous')return generateIteratedDensity(scene,c);
  if(hasSymmetryCustom(scene))throw new Error('自定义 Symmetry GLSL 仅支持持续批次密度；单次采样不可用。');
  const s=scene.settings,requested=integer(s,'count',80000,1,1000000),limit=c.quality==='export'?500000:120000;
  const g=new Geometry(Math.min(requested,limit),'points',scene),count=budget(requested,limit,g,'对称混沌点数');
  time(c);const params=parameters(scene),defaults=SYMMETRY_DEFAULT_PARAMETERS,p=validateSymmetryParameters({lambda:params.lambda??defaults.lambda,alpha:params.alpha??defaults.alpha,beta:params.beta??defaults.beta,gamma:params.gamma??defaults.gamma,omega:params.omega??defaults.omega,n:integer(s,'degree',SYMMETRY_DEFAULT_SETTINGS.degree,2,50),template:mode(s,'template',SYMMETRY_DEFAULT_SETTINGS.template,['standard','modified']) as 'standard'|'modified',delta:params.delta??defaults.delta,deltaPower:integer(s,'deltaPower',SYMMETRY_DEFAULT_SETTINGS.deltaPower,1,6)});
  const burn=integer(s,'burnIn',200,0,100000),r=random(seed(s));let x=.01+r()*.1,y=.01+r()*.1;
  for(let i=0;i<count+burn;i++){if((i&255)===0&&g.cancelled(c))break;const next=symmetryStep(x,y,p);g.samples++;if(!inRange(next)||Math.hypot(...next)>10){g.invalid++;x=.01+r()*.1;y=.01+r()*.1;continue;}[x,y]=next;if(i>=burn)g.point(next);}
  if(g.invalid)g.warnings.push(`${g.invalid} 次迭代发散；已保留有效采样并重置发散轨迹。`);return g.finish();
}

function generatePerlin(scene:SceneDocument,c:GenerateContext):SceneOutput {
  if(scene.settings.style==='continuous')return generatePerlinParticles(scene,c);
  if(['field-curves','filament','water'].includes(String(scene.settings.style)))return generateAdvancedPerlin(scene,c);
  const s=scene.settings,n=integer(s,'count',280,1,10000),steps=integer(s,'steps',180,1,1000),limit=c.quality==='export'?400000:130000;
  const style=mode(s,'style','streams',['streams','particles']),requested=n*steps;
  const g=new Geometry(Math.min(requested,limit)*(style==='streams'?2:1),'segments',scene),total=budget(requested,limit,g,'噪声积分步数');
  const seedValue=seed(s),r=random(seedValue),noise=createNoise(seedValue),scale=numberSetting(s,'noiseScale',.6,.001,100),span=numberSetting(s,'span',8,.01,1000),dt=numberSetting(s,'stepSize',.045,.00001,5),z=time(c)*numberSetting(s,'timeSpeed',.2,-10,10)+numberSetting(s,'noiseOffset',0,-10000,10000);
  const angleMap=mode(s,'angleMap','linear',['linear','soft-power']),field=mode(s,'flow','angle',['angle','curl','swirl']),octaves=integer(s,'octaves',3,1,8),persistence=numberSetting(s,'persistence',.5,0,1);
  const sample=(x:number,y:number)=>{let amp=1,freq=scale,v=0,sum=0;for(let i=0;i<octaves;i++){v+=amp*noise(x*freq,y*freq,z);sum+=amp;amp*=persistence;freq*=2;}return v/sum;};
  let processed=0;
  outer:for(let i=0;i<n;i++){
    let x=(r()-.5)*span,y=(r()-.5)*span;
    for(let j=0;j<steps;j++){
      if(processed>=total)break outer;if((processed&255)===0&&g.cancelled(c))break outer;
      let dx:number,dy:number;
      if(field==='curl'){const h=.001;dx=(sample(x,y+h)-sample(x,y-h))/(2*h);dy=-(sample(x+h,y)-sample(x-h,y))/(2*h);const norm=Math.hypot(dx,dy)||1;dx/=norm;dy/=norm;}
      else {const value=sample(x,y),mapped=angleMap==='soft-power'?Math.sign(value)*Math.abs(value)**1.5:value,angle=TAU*mapped+(field==='swirl'?Math.atan2(y,x)+Math.PI/2:0);dx=Math.cos(angle);dy=Math.sin(angle);}
      const next:Point=[x+dx*dt,y+dy*dt];g.samples++;processed++;
      if(style==='streams')g.segment([x,y],next);else g.point(next);
      [x,y]=next;if(Math.abs(x)>span/2||Math.abs(y)>span/2){x=(r()-.5)*span;y=(r()-.5)*span;}
    }
  }
  const result=g.finish();if(result.type==='geometry'&&style==='particles')result.topology='points';return result;
}

export interface Rotor {radius:number;mode:'inside'|'outside';speed?:number;}
function validateRotors(rotors:Rotor[]):void {if(!Array.isArray(rotors)||rotors.length<1||rotors.length>8)throw new Error('转子链需要 1 至 8 个转子');for(const r of rotors){if(!r||!Number.isFinite(r.radius)||r.radius<=0||r.radius>1000||!['inside','outside'].includes(r.mode)||!Number.isFinite(r.speed??1)||Math.abs(r.speed??1)>100)throw new Error('转子半径、模式或速度无效');}}
export function spirographPoint(theta:number,stator:number,rotors:Rotor[],pen:number):Point {
  finite(theta,'转角');finite(pen,'笔尖距离');if(!Number.isFinite(stator)||stator<=0)throw new Error('定子半径必须大于 0');validateRotors(rotors);
  return spirographPointUnchecked(theta,stator,rotors,pen);
}
function spirographPointUnchecked(theta:number,stator:number,rotors:Rotor[],pen:number):Point {
  let x=0,y=0,angle=0,parentRadius=stator;
  for(const rotor of rotors){const sign=rotor.mode==='inside'?-1:1,d=parentRadius+sign*rotor.radius,a=theta*(rotor.speed??1);x+=d*Math.cos(angle+a);y+=d*Math.sin(angle+a);angle+=sign*d/rotor.radius*a;parentRadius=rotor.radius;}
  return[x+pen*Math.cos(angle),y+pen*Math.sin(angle)];
}
function parseRotors(s:Settings):Rotor[] {
  const raw=String(s.rotors??'').trim();
  if(raw){if(raw.length>4096)throw new Error('转子 JSON 过长');let values:unknown;try{values=JSON.parse(raw);}catch{throw new Error('转子链必须是 JSON 数组');}if(!Array.isArray(values))throw new Error('转子链必须是数组');const rs=values.map(v=>({radius:Number(v?.radius),mode:String(v?.mode).toLowerCase() as Rotor['mode'],speed:Number(v?.speed??1)}));validateRotors(rs);return rs;}
  return[{radius:numberSetting(s,'rotorRadius',1,.001,1000),mode:mode(s,'rotorMode','inside',['inside','outside']) as Rotor['mode']}];
}
function generateSpirograph(scene:SceneDocument,c:GenerateContext):SceneOutput {
  if(usesSpirographFrameClock(scene)){
    const evaluated=scene.evaluatedSpirographFrame?scene:sceneAtSpirographFrame(scene,c.time,c.spirographFrame,undefined,c.isCancelled);
    const output=generateLayeredSpirograph(evaluated,c);output.spirographFrame=evaluated.evaluatedSpirographFrame;return output;
  }
  if(parseSpirographVersion(scene.settings.spirographVersion)!=='local-v1'||String(scene.settings.layers??'').trim())return generateLayeredSpirograph(scene,c);
  const s=scene.settings,requested=integer(s,'count',18000,2,1000000),limit=c.quality==='export'?500000:100000;
  const g=new Geometry(Math.min(requested,limit)*2,'segments',scene),count=budget(requested,limit,g,'旋轮线采样数');
  const R=numberSetting(s,'statorRadius',3,.001,1000),pen=numberSetting(s,'penDistance',1.6,-1000,1000),rotors=parseRotors(s),turns=numberSetting(s,'turns',12,.001,1000),duration=numberSetting(s,'drawDuration',12,.01,3600),t=time(c),clock=spirographTraceClock(s,t),progress=clock.animated?Math.min(1,Math.max(0,clock.elapsed/duration)):1,clearProgress=clock.clearElapsed===null?0:clock.advancing?Math.min(1,Math.max(0,clock.clearElapsed/duration)):1;
  const rotation=numberSetting(s,'rotation',0,-10000,10000)+t*numberSetting(s,'rotationSpeed',0,-100,100);
  if(s.showTrace===false||progress<=clearProgress)return g.finish();
  let previous=rotate(spirographPointUnchecked(TAU*turns*clearProgress,R,rotors,pen),rotation);
  for(let i=1;i<=count;i++){if(((i-1)&255)===0&&g.cancelled(c))break;const p=rotate(spirographPointUnchecked(TAU*turns*(clearProgress+(progress-clearProgress)*i/count),R,rotors,pen),rotation);g.samples++;g.segment(previous,p);previous=p;}
  if(progress===0)g.warnings.push('绘制动画位于起点；播放或移动时间线以展开曲线。');return g.finish();
}

const bouncingGpu=new BouncingGpu();
function generateBouncing(scene:SceneDocument,c:GenerateContext):SceneOutput {
  if(scene.settings.bouncingPresentation==='raster')return generateBouncingRaster(scene,c);
  const s=scene.settings,count=integer(s,'count',1800,1,5000000),trailSteps=integer(s,'trailSteps',16,1,128),trails=!!s.trails,limit=c.quality==='export'?500000:150000;
  const backend=mode(s,'bouncingBackend','auto',['auto','cpu','gpu']),requested=count*(trails?trailSteps*2:1),g=new Geometry(Math.min(requested,limit),trails?'segments':'points',scene),actualCount=budget(count,Math.floor(limit/(trails?trailSteps*2:1)),g,'弹跳粒子数');
  const outerBoundary=boundaryFromSettings(s),billiard=prepareBilliard(outerBoundary,numberSetting(s,'collisionRadius',0,0,1000)),b=billiard.boundary,r=random(seed(s)),p={...parameters(scene),t:time(c)},t=bouncingElapsedTime(s,time(c)),trailDuration=numberSetting(s,'trailDuration',1,.001,60),bx=numberSetting(s,'boundaryCenterX',0,-1e6,1e6),by=numberSetting(s,'boundaryCenterY',0,-1e6,1e6),toWorld=(p:Point):Point=>[p[0]+bx,p[1]+by];
  const velocity=createBouncingVelocitySampler(s),shape=mode(s,'shape','ring',[...BOUNCING_SHAPES]),sample=createBouncingShapeSampler(shape,s,scene.equations.mask,{isCancelled:c.isCancelled}),initial=new Float64Array(actualCount*4),candidateBudget=c.quality==='export'?12000000:4000000;let accepted=0,gpuUsed=false;
  for(let i=0;i<actualCount;i++){
    if((i&63)===0&&g.cancelled(c))break;if(g.samples>=candidateBudget){g.warnings.push(`初始分布达到 ${candidateBudget} 次候选采样预算；仅返回已接受的 ${accepted} 个粒子。`);break;}let point:Point|null=null;
    for(let attempt=0;attempt<256&&g.samples<candidateBudget;attempt++){g.samples++;const candidate=sample(r,p);if(candidate&&insideBoundary([candidate[0]-bx,candidate[1]-by],b)){point=candidate;break;}g.invalid++;}
    if(!point)continue;const v=velocity(point,r);initial.set([point[0]-bx,point[1]-by,...v],accepted++*4);
  }
  const state=initial.subarray(0,accepted*4),gpuWanted=backend==='gpu'||backend==='auto'&&accepted>=4096;
  const solve=(duration:number):Float32Array|undefined=>{
    if(!gpuWanted||accepted===0||c.isCancelled?.())return;
    const result=bouncingGpu.advance({initial:state,boundary:b,time:duration});if(result.warning){if(!g.warnings.includes(result.warning))g.warnings.push(result.warning);return;}
    if(result.states){
      gpuUsed=gpuUsed||(result.unsafe?.length??0)<accepted;
      for(const i of result.unsafe??[]){const q=billiard.advance([state[i*4],state[i*4+1]],[state[i*4+2],state[i*4+3]],duration);result.states.set([...q.position,...q.velocity],i*4);}
      if(result.unsafe?.length)g.warnings.push(`GPU 弹跳的 ${result.unsafe.length} 个浮点精度/碰撞次数边界粒子已用 CPU 精确解重算。`);
      return result.states;
    }
  };
  if(!trails){const gpu=solve(t);for(let i=0;i<accepted;i++){if((i&255)===0&&g.cancelled(c))break;const position:Point=gpu?[gpu[i*4],gpu[i*4+1]]:billiard.advance([state[i*4],state[i*4+1]],[state[i*4+2],state[i*4+3]],t).position;g.point(toWorld(position));}}
  else {
    const start=bouncingElapsedTime(s,Math.max(0,time(c)-trailDuration)),dt=(t-start)/trailSteps,first=solve(start);
    // Keep the existing particle-major segment order and source color identity. GPU accelerates only
    // each initial long flight; short trail flights remain exact CPU computations, with an honest notice.
    if(first&&gpuUsed)g.warnings.push('轨迹模式由 GPU 计算起始弹道，后续有限段轨迹使用 CPU 精确反射；未声明 GPU 长期图像累积。');
    for(let i=0;i<accepted;i++){
      if((i&63)===0&&g.cancelled(c))break;let current=first?{position:[first[i*4],first[i*4+1]] as Point,velocity:[first[i*4+2],first[i*4+3]] as Point}:billiard.advance([state[i*4],state[i*4+1]],[state[i*4+2],state[i*4+3]],start);
      // Quantized GPU boundary coordinates are unsuitable as a strict CPU starting state; retry their
      // original initial state instead of projecting it to an invented trajectory.
      if(!insideBoundary(current.position,b))current=billiard.advance([state[i*4],state[i*4+1]],[state[i*4+2],state[i*4+3]],start);
      for(let j=0;j<trailSteps;j++){const next=billiard.advance(current.position,current.velocity,dt);g.segment(toWorld(current.position),toWorld(next.position));current=next;}
    }
  }
  g.warnings.push(...(sample.diagnostics?.().warnings??[]));
  if(g.invalid)g.warnings.push(`初始分布有 ${g.invalid} 个候选点位于碰撞边界外或不满足公式，已重新采样；${actualCount-accepted} 个粒子未找到有效起点。`);
  if(gpuUsed&&b.kind==='ellipse')g.warnings.push('椭圆 GPU 弹道使用 float32；长时间轨道可能放大舍入误差，CPU 模式使用双精度精确碰撞解。');
  const guides=c.isCancelled?.()?{overlays:[],warnings:[]}:createBouncingGuides(scene,time(c),{boundary:outerBoundary,collisionBoundary:b,shape:sample,transform:g.transform,isCancelled:c.isCancelled});
  for(const warning of guides.warnings)if(!g.warnings.includes(warning))g.warnings.push(warning);
  const output=g.finish();if(output.type==='geometry'&&guides.overlays.length)output.lineOverlays=guides.overlays;
  return{...output,dimension:2,backend:gpuUsed?'webgl2':'cpu'};
}

function generateSamila(scene:SceneDocument,c:GenerateContext):SceneOutput {
  if(scene.settings.iteratedMode==='continuous')return generateIteratedDensity(scene,c);
  const s=scene.settings,requested=integer(s,'count',70000,1,1000000),limit=c.quality==='export'?500000:150000;
  const g=new Geometry(Math.min(requested,limit),'points',scene),count=budget(requested,limit,g,'Samila 采样数');
  const r=random(seed(s)),lo=numberSetting(s,'start',-Math.PI,-1000,1000),hi=numberSetting(s,'stop',Math.PI,-1000,1000);if(hi<=lo)throw new Error('采样上限必须大于下限');
  const f1=compileReal(scene.equations.f1??'sin(a*x*y)+cos(b*x^2)'),f2=compileReal(scene.equations.f2??'cos(c*x+y)+sin(d*y^4)'),p={...parameters(scene),t:time(c)},selection=resolveSamilaSelection(String(s.mapping??'f1_f2'),String(s.projection??'polar'),seed(s)),mapping=compileSamilaMapping(selection.mapping,p),projection=selection.projection;
  const rotation=numberSetting(s,'rotation',0,-10000,10000)+time(c)*numberSetting(s,'rotationSpeed',0,-100,100);
  for(let i=0;i<count;i++){
    if((i&255)===0&&g.cancelled(c))break;const x=lo+r()*(hi-lo),y=lo+r()*(hi-lo),scope={...p,x,y},a=f1(scope),b=f2(scope);g.samples++;
    const point=projectSamila(...mapping(x,y,a,b),projection);g.point(rotate(point,rotation));
  }
  if(g.invalid)g.warnings.push(`${g.invalid} 个采样落在公式奇点或投影奇点，已略过。`);return g.finish();
}

const particleDefinitions:SceneDefinition[]=[
 {kind:'map',name:'映射吸引子',englishName:'Map attractors',description:'二维或三维离散映射；nx / ny 可显式引用本步先计算的新坐标。',dimension:2,equations:[{key:'x',label:'xₙ₊₁'},{key:'y',label:'yₙ₊₁（可引用 nx）'},{key:'z',label:'zₙ₊₁（仅 3D；可引用 nx、ny）'}],controls:[{...select('dimension','维度',[['2','二维'],['3','三维']]),help:'切换到二维会清空 z 方程；切换回三维会设为 z。可撤销。'},select('initialMode','初始分布',[['range','原点对称范围'],['box','逐轴初始盒']]),...['X','Y','Z'].flatMap(a=>[number('initial'+a+'Min',a+' 初始下限',-1e6,1e6,.01,'采样'),number('initial'+a+'Max',a+' 初始上限',-1e6,1e6,.01,'采样')]),number('count','迭代点数',1,1000000,1000,'采样'),number('burnIn','预热步数',0,100000,10,'采样'),number('initialRange','初始范围',0,100,.01,'采样'),number('escapeRadius','发散半径',1,100000,.1,'采样'),seedControl,colorControl],defaults:{equations:{x:'sin(a*y)+c*cos(a*x)',y:'sin(b*x)+d*cos(b*y)',z:'z'},parameters:{a:-1.4,b:1.6,c:1,d:.7},settings:{dimension:2,initialMode:'range',initialXMin:-1,initialXMax:1,initialYMin:-1,initialYMax:1,initialZMin:-1,initialZMax:1,count:60000,burnIn:100,initialRange:.1,escapeRadius:100,seed:1,colorMetric:'index'}},presets:[{id:'clifford',name:'Clifford',equations:{x:'sin(a*y)+c*cos(a*x)',y:'sin(b*x)+d*cos(b*y)'},parameters:{a:-1.4,b:1.6,c:1,d:.7}},{id:'de-jong',name:'Peter de Jong',equations:{x:'sin(a*y)-cos(b*x)',y:'sin(c*x)-cos(d*y)'},parameters:{a:1.4,b:-2.3,c:2.4,d:-2.1}},{id:'henon',name:'Hénon',equations:{x:'1-a*x^2+y',y:'b*x'},parameters:{a:1.4,b:.3}},{id:'gingerbread',name:'Gingerbread',equations:{x:'1-y+abs(x)',y:'x'},parameters:{},settings:{initialRange:2.3}},{id:'clifford-3d',name:'空间 Clifford',equations:{x:'sin(a*y)+c*cos(a*x)',y:'sin(b*x)+d*cos(b*y)',z:'sin(e*nx)+f*cos(e*z)'},parameters:{a:-1.4,b:1.6,c:1,d:.7,e:1.3,f:.8},settings:{dimension:3,initialMode:'box'}}],generate:generateMap},
 {kind:'symmetry',name:'对称混沌',englishName:'Symmetric chaos',description:'带复共轭项的迭代映射生成 n 重旋转对称图案。',dimension:2,equations:[],controls:[select('template','方程模板',[['standard','标准'],['modified','径向修正']]),number('deltaPower','修正幂次',1,6,1),select('explorationProfile','探索类型',[['any','任意'],['shield','盾形'],['cloak','披风'],['sector','扇刃'],['pinwheel','风车'],['ribbed','肋星'],['binary','双翼']],'探索'),toggle('lockDegree','探索锁定阶数','探索'),number('explorationSeed','探索种子',0,4294967295,1,'探索'),number('degree','对称阶数',2,50,1),number('count','迭代点数',1,1000000,1000,'采样'),number('burnIn','预热步数',0,100000,10,'采样'),seedControl,colorControl],defaults:{equations:{},parameters:{...SYMMETRY_DEFAULT_PARAMETERS},settings:{...SYMMETRY_DEFAULT_SETTINGS,explorationProfile:'any',explorationSeed:1,lockDegree:false,count:80000,burnIn:200,seed:1,colorMetric:'angle'}},presets:[{id:'cloak',name:'五重花冠',parameters:{lambda:-2.34,alpha:2,beta:.2,gamma:.2,omega:0,delta:0},settings:{template:'standard',deltaPower:1,explorationProfile:'any',explorationSeed:1,lockDegree:false,degree:5}},{id:'sixfold',name:'六重对称',parameters:{lambda:-2.5,alpha:5,beta:-1.9,gamma:1,omega:0},settings:{degree:6}},{id:'rotating',name:'旋转扰动',parameters:{lambda:-2.34,alpha:2,beta:.2,gamma:.2,omega:.02},settings:{degree:5}}],generate:generateSymmetry},
 {kind:'perlin',name:'噪声流场',englishName:'Perlin flow fields',description:'种子控制的三维梯度噪声驱动流线、旋流与无散度流场。',dimension:2,equations:[],controls:[select('flow','流场',[['angle','噪声角度'],['curl','旋度流场'],['swirl','旋涡']]),select('style','绘制方式',[['streams','连续流线'],['particles','采样粒子'],['continuous','持续粒子'],['field-curves','双向场曲线'],['filament','纤维纹理'],['water','水流纹理']]),number('count','轨迹数量',1,10000,10,'采样'),number('steps','每条积分步数',1,1000,10,'采样'),number('span','区域宽度',.01,1000,.1),number('noiseScale','噪声频率',.001,100,.01),number('octaves','噪声层数',1,8,1),number('persistence','振幅衰减',0,1,.01),number('stepSize','积分步长',.00001,5,.005),number('timeSpeed','演化速度',-10,10,.01,'动画'),seedControl,colorControl,...perlinAdvancedControls,...perlinParticleControls],defaults:{equations:{},parameters:{},settings:{...perlinAdvancedDefaults,...perlinParticleDefaults,flow:'angle',style:'streams',count:280,steps:180,span:8,noiseScale:.6,octaves:3,persistence:.5,stepSize:.045,timeSpeed:.2,seed:42,colorMetric:'index'}},presets:[{id:'rivers',name:'丝绸流线',settings:{flow:'angle',noiseScale:.6,octaves:3}},{id:'curl',name:'旋度流场',settings:{flow:'curl',noiseScale:.45,octaves:2}},{id:'swirl',name:'星云旋涡',settings:{flow:'swirl',noiseScale:.3,octaves:3}},{id:'continuous-flow',name:'持续累积流场',settings:{style:'continuous',noiseScale:.01,particleSpeed:24,particleCount:1500}},{id:'soft-flow',name:'Soft Flow · 长拖尾',settings:{style:'continuous',particleDisplay:'trails',particleCount:8000,particleSpeed:24,noiseScale:.008,flow:'angle',angleMap:'soft-power',timeSpeed:.2,trailLifetime:120,trailStride:60,fadeTrails:true}},{id:'vector-drift',name:'Vector Drift · 长拖尾',settings:{style:'continuous',particleDisplay:'trails',particleCount:9000,particleSpeed:21,noiseScale:.012,flow:'curl',angleMap:'linear',timeSpeed:.12,trailLifetime:90,trailStride:60,fadeTrails:true}},{id:'swirl-vortex',name:'Swirl Vortex · 长拖尾',settings:{style:'continuous',particleDisplay:'trails',particleCount:6500,particleSpeed:27,noiseScale:.01,flow:'swirl',angleMap:'linear',timeSpeed:.18,trailLifetime:110,trailStride:60,fadeTrails:true}},{id:'field-curves',name:'空间配色曲线',settings:{style:'field-curves'}},{id:'noise-filament',name:'丝绸纹理',settings:{style:'filament',textureStyle:'silk'}},{id:'noise-water',name:'水流纹理',settings:{style:'water',textureStyle:'water'}}],generate:generatePerlin},
 {kind:'spirograph',name:'旋轮线',englishName:'Spirograph',description:'内外滚动圆组成转子链，笔尖记录精确参数曲线。',dimension:2,equations:[],controls:[text('layers','多图层 JSON','非空启用顺序绘制的多层位图；图层可独立设置转子、颜色、线宽、闭合停止。'),toggle('startEaseEnabled','起始缓动','动画'),toggle('endEaseEnabled','结束缓动','动画'),number('easeDuration','缓动秒数',0,10,.05,'动画'),toggle('fadeInStatorsOnStart','辅助线淡入','动画'),toggle('fadeOutStatorsOnFinish','辅助线淡出','动画'),toggle('showTrace','显示轨迹','外观'),toggle('finishTrace','立即完成轨迹','动画'),number('traceStartTime','轨迹开始时间',0,1e9,.1,'动画'),toggle('transparentBackground','透明背景','外观'),select('spiroView','旋轮视图',[['fit','按完整图案适配'],['fixed','固定范围']]),number('spiroSpan','固定视图跨度',.001,1e9,.1),number('spiroCenterX','视图中心 X',-1e6,1e6,.1),number('spiroCenterY','视图中心 Y',-1e6,1e6,.1),number('statorRadius','定子半径',.001,1000,.05),number('rotorRadius','转子半径',.001,1000,.05),select('rotorMode','滚动方式',[['inside','内滚'],['outside','外滚']]),number('penDistance','笔尖距离',-1000,1000,.05),number('turns','轨道周数',.001,1000,.1),number('count','曲线采样',2,1000000,500,'采样'),text('rotors','多转子链 JSON','留空使用上方单转子；例如 [{"radius":1,"mode":"inside","speed":1}]'),toggle('animate','逐步绘制','动画'),number('drawDuration','绘制时长',.01,3600,.1,'动画'),number('rotation','整体旋转',-10000,10000,.05,'动画'),number('rotationSpeed','旋转速度',-100,100,.01,'动画'),colorControl],defaults:{equations:{},parameters:{},settings:{layers:'',startEaseEnabled:false,endEaseEnabled:false,easeDuration:.6,fadeInStatorsOnStart:false,fadeOutStatorsOnFinish:false,showTrace:true,finishTrace:false,traceStartTime:0,transparentBackground:false,spiroView:'fit',spiroSpan:400,spiroCenterX:0,spiroCenterY:0,statorRadius:3,rotorRadius:1,rotorMode:'inside',penDistance:1.6,turns:12,count:18000,rotors:'',animate:false,drawDuration:12,rotation:0,rotationSpeed:0,colorMetric:'index'}},presets:[...spirographGuideExamples,{id:'hypotrochoid',name:'三叶内旋',settings:{layers:'',startEaseEnabled:false,endEaseEnabled:false,easeDuration:.6,fadeInStatorsOnStart:false,fadeOutStatorsOnFinish:false,showTrace:true,finishTrace:false,traceStartTime:0,transparentBackground:false,spiroView:'fit',spiroSpan:400,spiroCenterX:0,spiroCenterY:0,statorRadius:3,rotorRadius:1,penDistance:1.6,rotorMode:'inside',turns:1,rotors:''}},{id:'rose-wheel',name:'七瓣齿轮',settings:{statorRadius:3.5,rotorRadius:1,penDistance:1.6,rotorMode:'inside',turns:2,rotors:''}},{id:'epitrochoid',name:'外旋花环',settings:{statorRadius:3,rotorRadius:1.1,penDistance:.9,rotorMode:'outside',turns:11,rotors:''}},{id:'chain',name:'转子交响',settings:{statorRadius:3,penDistance:.45,turns:12,rotors:'[{"radius":1,"mode":"inside"},{"radius":0.4,"mode":"outside"}]'}}],generate:generateSpirograph},
 {kind:'bouncing',name:'弹跳粒子',englishName:'Billiard particles',description:'圆、椭圆和简单多边形内的镜面反射粒子，保持速度大小。',dimension:2,equations:[{key:'mask',label:'初始区域公式（选择公式形状时生效）'}],controls:[...bouncingExperienceControls,...bouncingRasterControls,...bouncingGuideControls,select('bouncingBackend','弹道计算',[['auto','自动 GPU'],['cpu','CPU 精确解'],['gpu','GPU（失败时明确回退）']]),number('collisionRadius','碰撞半径（物理单位）',0,1000,.001),select('bouncingClock','仿真时钟',[['seconds','真实秒'],['fixed-step','固定帧步长']]),number('bouncingTimeStep','每仿真帧物理步长',.0001,.25,.001,'动画'),number('bouncingFps','每秒仿真帧数',1,240,1,'动画'),select('formulaDomain','公式采样域',[['square','方形'],['disc','圆盘']]),select('formulaCoordinates','公式坐标',[['local','形状局部'],['world','世界坐标']]),number('formulaResolution','公式轮廓网格',16,1024,16,'采样'),select('boundary','封闭边界',[['circle','圆'],['ellipse','椭圆'],['polygon','多边形']]),number('radius','边界半径 / X 半轴',.01,1000,.05),number('ellipseY','椭圆 Y 半轴',.01,1000,.05),number('sides','正多边形边数',3,64,1),text('polygon','自定义多边形 JSON','留空使用正多边形；例如 [[-3,-2],[3,-2],[0,3]]'),select('shape','初始分布',BOUNCING_SHAPES.map(x=>[x,({box:'方形',circle:'圆盘',ring:'圆环',spiral:'螺旋',archimedean:'阿基米德螺旋',star:'星形',heart:'心形',lissajous:'利萨如',rose:'玫瑰',infinity:'双纽线',superellipse:'超椭圆',hypocycloid:'内摆线',epicycloid:'外摆线',formula:'公式区域'} as Record<string,string>)[x]])),number('initialRadius','分布半径',0,1000,.05),number('shapeCenterX','形状中心 X',-1e6,1e6,.05),number('shapeCenterY','形状中心 Y',-1e6,1e6,.05),number('shapeInnerRatio','环 / 星形内径比',0,1,.01),number('shapeTurns','螺旋圈数',.01,100,.1),number('shapeTightness','螺旋紧密度',0,100,.01),number('shapeLineWidth','轮廓分布半宽',0,1000,.01),number('shapeLissajousA','利萨如 X 频率',1,64,1),number('shapeLissajousB','利萨如 Y 频率',1,64,1),number('shapeLissajousDelta','利萨如相位 · 弧度',-10000,10000,.05),number('shapeRoseK','玫瑰阶数',1,64,1),number('shapeSuperellipseN','超椭圆指数',.1,100,.1),number('shapeK','摆线阶数',2,64,1),toggle('shapeBoxBounds','矩形使用独立边界'),...['X','Y'].flatMap(a=>[number('boxMin'+a,'矩形 '+a+' 下限',-1e6,1e6,.05),number('boxMax'+a,'矩形 '+a+' 上限',-1e6,1e6,.05)]),number('boundaryCenterX','边界中心 X',-1e6,1e6,.05),number('boundaryCenterY','边界中心 Y',-1e6,1e6,.05),number('velocityCenterX','速度中心 X',-1e6,1e6,.05),number('velocityCenterY','速度中心 Y',-1e6,1e6,.05),number('velocityNoise','初始速度噪声',0,1,.01),number('shapeDegree','星形角数',2,64,1),toggle('fill','填充形状'),select('velocity','初始速度方向',[['uniform','统一方向'],['random','随机方向'],['out','径向向外'],['in','径向向内'],['cw','顺时针切向'],['ccw','逆时针切向']]),number('speed','速度',0,100,.05),number('angle','统一方向角',-10000,10000,.05),number('spread','角度扩散',0,TAU,.05),number('count','粒子数',1,5000000,100,'采样'),toggle('trails','显示运动轨迹','外观'),number('trailSteps','轨迹采样数',1,128,1,'采样'),number('trailDuration','轨迹时长',.001,60,.1,'动画'),seedControl,colorControl],defaults:{equations:{mask:'sin(8*x)*sin(8*y)>0.5'},parameters:{},settings:{...bouncingExperienceDefaults,...bouncingRasterDefaults,...bouncingGuideDefaults,bouncingBackend:'auto',collisionRadius:0,bouncingClock:'seconds',bouncingTimeStep:.012,bouncingFps:60,formulaDomain:'square',formulaCoordinates:'local',formulaResolution:128,shapeCenterX:0,shapeCenterY:0,shapeInnerRatio:.4,shapeTurns:5,shapeTightness:0,shapeLineWidth:0,shapeLissajousA:3,shapeLissajousB:4,shapeLissajousDelta:Math.PI/2,shapeRoseK:5,shapeSuperellipseN:4,shapeK:4,shapeBoxBounds:false,boxMinX:-1,boxMaxX:1,boxMinY:-1,boxMaxY:1,boundaryCenterX:0,boundaryCenterY:0,velocityCenterX:0,velocityCenterY:0,velocityNoise:0,boundary:'circle',radius:3,ellipseY:2,sides:6,polygon:'',shape:'ring',initialRadius:2,shapeDegree:5,fill:false,velocity:'uniform',speed:1,angle:Math.PI/2,spread:0,count:1800,trails:false,trailSteps:16,trailDuration:1,seed:2,colorMetric:'index'}},presets:[{id:'ring',name:'圆环反射',settings:{boundary:'circle',shape:'ring',velocity:'uniform'}},{id:'heart',name:'心形粒子',settings:{boundary:'circle',shape:'heart',velocity:'out'}},{id:'ellipse',name:'椭圆台球',settings:{boundary:'ellipse',shape:'circle',initialRadius:1.5,velocity:'random'}},{id:'polygon',name:'六边形台球',settings:{boundary:'polygon',shape:'star',sides:6,velocity:'out'}},{id:'mask',name:'公式格点',settings:{boundary:'circle',shape:'formula',velocity:'uniform'}}],generate:generateBouncing},
 {kind:'samila',name:'Samila 生成艺术',englishName:'Samila generative art',description:'两个实函数映射随机样本，并在平面或地图投影中展现结构。',dimension:2,equations:[{key:'f1',label:'f₁(x, y, t)'},{key:'f2',label:'f₂(x, y, t)'}],controls:[select('mapping','函数组合',SAMILA_MODES.map(v=>[v,v==='random'?'随机组合（按种子）':v.replaceAll('_',' · ').replace('product','f₁×f₂')])),select('projection','投影',[['cartesian','直角坐标'],['polar','极坐标'],['aitoff','Aitoff'],['hammer','Hammer'],['lambert','Lambert'],['mollweide','Mollweide'],['random','随机投影（按种子）']]),number('funcSeed','方程探索种子',0,4294967295,1,'探索'),number('start','输入下限',-1000,1000,.1,'采样'),number('stop','输入上限',-1000,1000,.1,'采样'),number('count','采样点数',1,1000000,1000,'采样'),number('rotation','画面旋转',-10000,10000,.05),number('rotationSpeed','旋转速度',-100,100,.01,'动画'),seedControl,colorControl],defaults:{equations:{f1:'sin(a*x*y)+cos(b*x^2)',f2:'cos(c*x+y)+sin(d*y^4)'},parameters:{a:2.1,b:1,c:1.1,d:.49},settings:{samilaHistoryModel:'legacy-v1',mapping:'f1_f2',projection:'polar',funcSeed:1,start:-Math.PI,stop:Math.PI,count:70000,rotation:0,rotationSpeed:0,seed:2121,colorMetric:'index'}},presets:[{id:'vortex',name:'极坐标漩涡',equations:{f1:'sin(a*x*y)+cos(b*x^2)',f2:'cos(c*x+y)+sin(d*y^4)'},parameters:{a:2.1,b:1,c:1.1,d:.49},settings:{mapping:'f1_f2',projection:'polar'}},{id:'web',name:'神经网络',equations:{f1:'a*tanh(x*y)+b*sin(x^2+y^2)',f2:'c*cos(x-y)+d*log(abs(x*y)+1)'},parameters:{a:-.958,b:1.243,c:.865,d:-.266},settings:{mapping:'f1_f2',projection:'cartesian'}},{id:'bloom',name:'投影花瓣',equations:{f1:'a*sin(x*y)+b*atan(y^2)-c*cos(x^3)',f2:'d*cos(x+y)+e*sqrt(abs(x*y))+f*sin(y^3)'},parameters:{a:.437,b:-.73,c:-.986,d:.355,e:.855,f:.748},settings:{mapping:'f1_f2',projection:'aitoff'}}],generate:generateSamila},
];

const transformControls:ControlSpec[]=[number('scale','整体缩放',-1000,1000,.1,'空间变换'),...['X','Y','Z'].flatMap(axis=>[number('scale'+axis,axis+' 轴缩放',-1000,1000,.1,'空间变换'),number('offset'+axis,axis+' 轴偏移',-1e6,1e6,.1,'空间变换')]),number('rotateZ','平面旋转 · 弧度',-1000,1000,.05,'空间变换')];
export const definitions:SceneDefinition[]=particleDefinitions.map(def=>{
  const hasDensity=['map','symmetry','samila'].includes(def.kind);
  return{...def,controls:[...def.controls,...(hasDensity?iteratedDensityControls:[]),...(def.kind==='symmetry'?['X','Y'].flatMap(a=>[number('initial'+a+'Min',a+' 初始下限',-1e6,1e6,.001,'采样'),number('initial'+a+'Max',a+' 初始上限',-1e6,1e6,.001,'采样')]):[]),...transformControls,...(hasDensity?densityControls:[]),...(['map','symmetry'].includes(def.kind)?normalizedDensityControls:[]),...(def.kind==='samila'?samilaToneControls:[])],defaults:{...def.defaults,settings:{scale:1,scaleX:1,scaleY:1,scaleZ:1,offsetX:0,offsetY:0,offsetZ:0,rotateZ:0,...(hasDensity?densityDefaults:{}),...(hasDensity?{...iteratedDensityDefaults,iteratedColor:def.kind==='samila'?'noise':'step',...(def.kind==='symmetry'?{initialMode:'box',initialXMin:.001,initialXMax:.002,initialYMin:.001,initialYMax:.002}:{})}:{}),...def.defaults.settings}},
    generate:hasDensity?(scene,context)=>{const started=performance.now(),output=def.generate(scene,context);output.stats.elapsedMs=performance.now()-started;return output.type==='raster'?output:presentPoints(output,scene,context);}:def.generate};
});
