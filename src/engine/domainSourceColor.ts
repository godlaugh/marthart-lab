import type {RGB} from '../types';
import {prepareDomainLevelCurve,type DomainLevelMode} from './domainLevelCurve';
import {parseDomainColorVersion,prepareDomainSourcePalette,sampleDomainSourcePalette,type DomainSourceColorVersion,type DomainSourcePaletteFacts,type DomainSourcePaletteInput} from './domainSourcePalette';
export * from './domainSourcePalette';

export type DomainSourceCurveMode=DomainLevelMode;
export interface DomainSourceColorInput extends DomainSourcePaletteInput {
 curveMode?:unknown;phaseDensity?:unknown;modDensity?:unknown;phaseSharpness?:unknown;modSharpness?:unknown;
 bias?:unknown;mix?:unknown;paletteOffset?:unknown;
}
export interface DomainSourceColorFacts {
 readonly version:DomainSourceColorVersion;readonly curveMode:DomainSourceCurveMode;
 readonly phaseDensity:number;readonly modDensity:number;readonly phaseSharpness:number;readonly modSharpness:number;
 readonly bias:number;readonly mix:number;readonly paletteOffset:number;readonly palette:DomainSourcePaletteFacts;
 readonly outputQuantization:'source-cpu-float32-truncate-byte'|'source-gpu-float32-rgb';
}
export interface PreparedDomainSourceColor {readonly facts:DomainSourceColorFacts;sample(value:readonly[number,number]):RGB}
const F=Math.fround,clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
function floatInput(value:unknown,fallback:number,name:string):number {
 if(value===undefined)return F(fallback);
 if(typeof value!=='number')throw new Error(`原版域着色 ${name} 必须是数值`);
 return F(value);
}
function curve(phase:number,modulus:number,mode:DomainSourceCurveMode,gpu:boolean):number {
 if(mode==='PHASE')return phase;if(mode==='MODULUS')return modulus;if(mode==='NONE')return 1;
 return gpu?F(phase*modulus):phase*modulus;
}
function stripeCpu(value:number,density:number,sharpness:number){return Math.pow(.5+.5*Math.cos(value*Math.max(F(.0001),density)),Math.max(F(.0001),sharpness));}
function stripeGpu(value:number,density:number,sharpness:number){return F(Math.pow(F(.5+F(.5*F(Math.cos(F(value*Math.max(F(.0001),density)))))),Math.max(F(.0001),sharpness)));}
function javaByte(value:number):number{return Number.isNaN(value)?0:Math.trunc(F(clamp(value,0,1)*255));}
/** Source-specific arithmetic recipes, independently implemented from retained
 * 1.7.8 bytecode/shader facts. JS Math is not a proof of JVM/driver low-bit parity. */
export function prepareDomainSourceColor(input:DomainSourceColorInput):PreparedDomainSourceColor {
 const version=parseDomainColorVersion(input.version);if(version==='local-v1')throw new Error('原版域着色需要显式原版颜色版本');
 const offset=floatInput(input.paletteOffset,0,'paletteOffset');if(!Number.isFinite(offset))throw new Error('原版域色板偏移必须可表示为有限浮点数');
 const level=prepareDomainLevelCurve(input);
 const facts:DomainSourceColorFacts=Object.freeze({version,...level,paletteOffset:offset,palette:prepareDomainSourcePalette(input),outputQuantization:version==='mathart-1.7.8-cpu'?'source-cpu-float32-truncate-byte':'source-gpu-float32-rgb'});
 return Object.freeze({facts,sample:(value:readonly[number,number]):RGB=>{
  const gpu=facts.version==='mathart-1.7.8-gpu';let x=value[0],y=value[1],phase:number,modulus:number;
  if(gpu){
   x=F(x);y=F(y);const magSquared=F(F(x*x)+F(y*y));
   if(!(magSquared<=F(1e24))){x=F(1e6);y=0;}
   const magnitude=Math.min(F(Math.sqrt(F(F(x*x)+F(y*y)))),F(1e6));
   phase=F(Math.atan2(y,x));modulus=F(Math.log(F(magnitude+F(1e-12))));
  }else{
   let magnitude=Math.hypot(x,y);if(!Number.isFinite(magnitude))magnitude=1e6;magnitude=Math.min(magnitude,1e6);
   phase=Math.atan2(y,x);modulus=Math.log(magnitude+1e-12);
  }
  const stripe=gpu?stripeGpu:stripeCpu;
  const level=curve(stripe(phase,facts.phaseDensity,facts.phaseSharpness),stripe(modulus,facts.modDensity,facts.modSharpness),facts.curveMode,gpu);
  const coordinate=gpu?F(F(phase/F(6.28318530718))+facts.paletteOffset):phase/(Math.PI*2)+facts.paletteOffset;
  const base=sampleDomainSourcePalette(facts.palette,F(coordinate-Math.floor(coordinate)));
  if(!gpu){
   const brightness=(1-facts.mix)+facts.mix*level;
   return base.map(v=>javaByte(F(v*brightness+facts.bias))/255) as RGB;
  }
  const brightness=F(F(1-facts.mix)+F(facts.mix*level));
  const rgb=base.map(v=>clamp(F(F(v*brightness)+facts.bias),0,1)) as RGB;
  // GLSL non-finite transcendental results have no portable color. Fail visibly
  // rather than claiming a fabricated black pixel matches the source shader.
  if(!rgb.every(Number.isFinite))throw new Error('原版 GPU 颜色公式产生不可定义的非有限值');
  return rgb;
 }});
}
