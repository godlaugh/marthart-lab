import type {SceneDocument,SceneOutput,Settings} from '../types';
import {numberSetting,random} from '../engine/expression';
import {definitions} from './particles';
import {PERLIN_TEXTURES,visiblePerlinControls} from './perlin';

export type PerlinRandomIntensity='conservative'|'balanced'|'aggressive';
export interface PerlinExploration {
 seed:number;action:'random'|'deep';intensity:PerlinRandomIntensity;settings:Settings;
 changed:string[];candidates:number;metrics:{score:number;coverage:number;variation:number;samples:number};warnings:string[];
}
const ranges:Record<string,[number,number,number,boolean?]>={
 noiseScale:[.001,4,.6,true],particleSpeed:[.2,120,24,true],stepSize:[.0001,.4,.045,true],timeSpeed:[-2,2,.2],respawnRate:[0,30,1.8],
 curveNoiseScale:[.05,12,1.2,true],curveStepSize:[.05,12,2,true],curveNoiseOffset:[-2,2,0],curveAngleScale:[.1,12,4,true],curveAlpha:[.05,.8,.35],
 textureFrequency:[.1,12,1.5,true],warpAmplitude:[0,2,.1],warpFrequency:[.1,12,2,true],directionOffset:[-Math.PI*2,Math.PI*2,0],textureTimeSpeed:[-3,3,1],marchStepSize:[.0005,.08,.008,true],textureBrightness:[.2,3,1.7,true],vignettePower:[0,2,.1],fiberStrength:[.05,1,.7],
};
/** Independent constrained exploration. Random keeps the current family;
 * Deep may change families within CPU particles or texture rendering, never across them.
 * Scores are measured on bounded samples of the real production generator. */
export function explorePerlin(settings:Settings,seed:number,options:{action?:'random'|'deep';intensity?:PerlinRandomIntensity;isCancelled?:()=>boolean}={}):PerlinExploration {
 if(!Number.isInteger(seed)||seed<0||seed>0xffffffff)throw new Error('探索种子必须是 32 位非负整数');
 const action=options.action??'random',intensity=options.intensity??'balanced';if(!['random','deep'].includes(action))throw new Error('未知噪声探索动作');if(!['conservative','balanced','aggressive'].includes(intensity))throw new Error('未知噪声随机强度');
 const def=definitions.find(d=>d.kind==='perlin')!,source:Settings={...def.defaults.settings,...settings},style=String(source.style),texture=['filament','water'].includes(style),curve=style==='field-curves',continuous=style==='continuous';
 // Validate the original active controls before reducing only the probe's resource counts.
 for(const control of visiblePerlinControls(def.controls,source)){
  const value=source[control.key];if(value===undefined)continue;
  if(control.type==='number')numberSetting(source,control.key,0,control.min,control.max);
  else if(control.type==='toggle'&&typeof value!=='boolean')throw new Error(`${control.key} 必须是布尔值`);
  else if(control.type==='select'&&!control.options?.some(o=>o.value===value))throw new Error(`${control.key} 选项无效`);
 }
 for(const key of ['count','steps','octaves','curveCount','curveLength','curveNoiseOctaves','fieldCellSize','seedSpaceCircleCount','marchSteps','particleCount','simulationFps','trailStride','seed'])if(source[key]!==undefined&&!Number.isInteger(source[key]))throw new Error(`${key} 必须为整数`);
 const r=random(seed),amount={conservative:.12,balanced:.35,aggressive:.8}[intensity],attempts=action==='deep'?6:1;
 const choose=<T>(values:readonly T[])=>values[Math.floor(r()*values.length)];
 const mutate=(candidate:Settings,key:string)=>{
  const [lo,hi,fallback,log]=ranges[key],old=numberSetting(source,key,fallback),delta=(r()*2-1)*amount;
  let next=log?Math.max(lo,old)*Math.exp(delta*2.5):old+delta*(hi-lo)*.5;
  // Existing values outside the exploratory range are moved locally; exploration
  // does not silently clamp a user choice into an unrelated stylistic domain.
  const lower=Math.min(lo,old),upper=Math.max(hi,old);next=Math.max(lower,Math.min(upper,next));candidate[key]=next;
 };
 let best:PerlinExploration|undefined;
 for(let candidateIndex=0;candidateIndex<attempts;candidateIndex++){
  if(options.isCancelled?.())throw new DOMException('噪声探索已取消','AbortError');
  const candidate={...source},keys=texture?['textureFrequency','warpAmplitude','warpFrequency','directionOffset','textureTimeSpeed','marchStepSize','textureBrightness','vignettePower','fiberStrength']:curve?['curveNoiseScale','curveStepSize','curveNoiseOffset','curveAngleScale','curveAlpha']:continuous?['noiseScale','particleSpeed','timeSpeed','respawnRate']:['noiseScale','stepSize','timeSpeed'];
  keys.forEach(key=>mutate(candidate,key));
  if(texture){
   if(action==='deep'){candidate.style=choose(['filament','water']);candidate.textureStyle=choose(PERLIN_TEXTURES);if(intensity==='aggressive'&&r()<.15)candidate.marchSteps=choose([16,24,32,48,64]);}
   candidate.marchStepSize=Math.min(Number(candidate.marchStepSize),.06/(1+2*Number(candidate.warpAmplitude)));
  }else if(curve){
   candidate.curveStepSize=Math.min(Number(candidate.curveStepSize),12/(1+Number(candidate.curveNoiseScale)));
   if(action==='deep'){candidate.seed=Math.floor(r()*4294967296);candidate.curveSampling=choose(['random','jittered-grid']);candidate.curveColor=choose(['index','position','noise','seed-space']);}
  }else{
   if(action==='deep'){candidate.flow=choose(['angle','curl','swirl']);candidate.angleMap=choose(['linear','soft-power']);candidate.seed=Math.floor(r()*4294967296);}
   const frequency=Number(candidate.noiseScale);
   if(continuous)candidate.particleSpeed=Math.min(Number(candidate.particleSpeed),.4*Number(candidate.simulationFps)/Math.max(.001,frequency));
   else candidate.stepSize=Math.min(Number(candidate.stepSize),.4/Math.max(.001,frequency));
  }
  const probe:SceneDocument={version:1,id:'perlin-exploration',name:'Perlin exploration probe',kind:'perlin',equations:{},parameters:{},settings:{...candidate,perlinBackend:'cpu',count:32,steps:32,particleCount:96,particleDisplay:'heads',curveCount:32,curveLength:24,marchSteps:Math.min(8,Number(candidate.marchSteps)),presentation:'points',showTrails:false},palette:{name:'probe',mode:'linear',stops:['#101030','#ffffff'],cycles:1,offset:0},camera:{position:[0,0,10],target:[0,0,0],orthographic:true,zoom:1},timeline:{duration:1,fps:30,loop:false,tracks:[]},favorite:false};
  const output=def.generate(probe,{time:.5,width:48,height:36,quality:'export',isCancelled:options.isCancelled}),metrics=measure(output);
  if(options.isCancelled?.())throw new DOMException('噪声探索已取消','AbortError');
  if(!best||metrics.score>best.metrics.score)best={seed,action,intensity,settings:candidate,changed:Object.keys(candidate).filter(key=>candidate[key]!==source[key]),candidates:attempts,metrics,warnings:['独立约束随机；评分来自缩小采样的真实生成结果，不等同原版随机序列或审美评分。']};
 }
 if(!best||best.metrics.samples===0||!Number.isFinite(best.metrics.score))throw new Error('当前设置没有产生有效探索样本');return best;
}

function measure(output:SceneOutput):PerlinExploration['metrics'] {
 if(output.type==='raster'){
  const bins=new Uint32Array(32);let mean=0,squared=0,lit=0;const count=output.width*output.height;
  for(let i=0;i<count;i++){const k=i*4,l=(.2126*output.pixels[k]+.7152*output.pixels[k+1]+.0722*output.pixels[k+2])/255;mean+=l;squared+=l*l;if(l>.03&&output.pixels[k+3])lit++;bins[Math.min(31,Math.floor(l*32))]++;}
  const variation=Math.sqrt(Math.max(0,squared/count-(mean/count)**2));let entropy=0;for(const n of bins)if(n){const p=n/count;entropy-=p*Math.log2(p);}
  return{coverage:lit/count,variation,score:variation*(.2+.8*entropy/5),samples:output.stats.samples};
 }
 const count=output.positions.length/3,min=[Infinity,Infinity],max=[-Infinity,-Infinity];
 for(let i=0;i<count;i++)for(let a=0;a<2;a++){const v=output.positions[i*3+a];if(!Number.isFinite(v))throw new Error('探索生成非有限坐标');min[a]=Math.min(min[a],v);max[a]=Math.max(max[a],v);}
 const spans=max.map((v,i)=>v-min[i]),cells=new Set<number>();for(let i=0;i<count;i++){const x=Math.min(15,Math.floor((output.positions[i*3]-min[0])/(spans[0]||1)*16)),y=Math.min(15,Math.floor((output.positions[i*3+1]-min[1])/(spans[1]||1)*16));cells.add(x+16*y);}
 const variation=Math.max(...spans)>0?Math.min(...spans)/Math.max(...spans):0,coverage=cells.size/256;return{coverage,variation,score:coverage*Math.sqrt(variation),samples:output.stats.samples};
}
