import {parseFractalDistanceVersion,normalizeFractalDistancePower,fractalDistanceColorIndex} from './fractalDistance';
import type {ControlSpec, Palette, RGB, SceneDocument, Settings} from '../types';
import type {FractalConfig, FractalOrbit, Complex} from '../scenes/complex';
import {convergenceColorIndex} from './fractalConvergence';
import {hexRGB,hsvRGB,paletteColor,validatePalette} from './palette';

export const FRACTAL_COLOR_ALGORITHMS=['none','basic','smooth_mandelbrot','decomposition','binary_decomposition','distance_estimator','direct_domain','direct_orbit_trap','direct_normalized_z','orbit_trap_index'] as const;
export const FRACTAL_TRANSFERS=['none','linear','sqr','sqrt','cube','cuberoot','log','exp','sin','arctan'] as const;
export type FractalColorSide='inside'|'outside';
export interface FractalColorStyle {
 side:FractalColorSide;algorithm:string;palette:Palette;trapLut:Float32Array;density:number;offset:number;transfer:string;repeat:boolean;solid:RGB;
 metric:string;binary:string;smoothSource:string;smoothPower:number;smoothReal:number;smoothImag:number;smoothBailout:number;distancePower:number;
 scale:number;gamma:number;saturation:number;mix:number;merge:number;threshold:number;shape:string;radius:number;center:Complex;rotation:number;aspect:number;
}
export interface FractalColors {version:1|2;inside:FractalColorStyle;outside:FractalColorStyle;}
const cap=(s:string)=>s[0].toUpperCase()+s.slice(1);
export const fractalColorKey=(side:FractalColorSide,key:string)=>side+cap(key);
const clamp=(x:number)=>Math.max(0,Math.min(1,x)),fract=(x:number)=>x-Math.floor(x);
const positive=(s:Settings,k:string,d:number,min=-1e12,max=1e12)=>{const v=s[k]??d;if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw new Error(`${k}: finite value in [${min}, ${max}] required`);return v;};
export function parseFractalColors(scene:Pick<SceneDocument,'settings'|'palette'>):FractalColors {
 const sourceDistance=parseFractalDistanceVersion(scene.settings.fractalDistanceVersion)!==undefined;
 const s=scene.settings,version=s.fractalColorVersion??1;if(version!==1&&version!==2)throw new Error('Unsupported fractal color model version');
 if(sourceDistance&&version!==2)throw new Error('Source distance estimation requires fractalColorVersion 2');
 function side(domain:FractalColorSide):FractalColorStyle {
  const setting=(key:string,legacy:string|undefined,d:number|string|boolean)=>s[fractalColorKey(domain,key)]??(legacy?s[legacy]:undefined)??d;
  const n=(key:string,legacy:string|undefined,d:number,min=-1e12,max=1e12)=>positive({v:setting(key,legacy,d)},'v',d,min,max);
  const e=(key:string,legacy:string|undefined,d:string,values:readonly string[])=>{const v=setting(key,legacy,d);if(typeof v!=='string'||!values.includes(v))throw new Error(`${domain}.${key}: invalid option`);return v;};
  const b=(key:string,legacy:string|undefined,d:boolean)=>{const v=setting(key,legacy,d);if(typeof v!=='boolean')throw new Error(`${domain}.${key}: boolean required`);return v;};
  const encoded=s[domain+'Palette'];let palette=scene.palette;
  if(encoded!==undefined){if(typeof encoded!=='string'||encoded.length>262144)throw new Error(`${domain}Palette: invalid JSON size`);try{palette=validatePalette(JSON.parse(encoded));}catch(error){throw new Error(`${domain}Palette: ${String(error)}`);}}
  const solid=String(setting('solidColor','solidColor','#070913'));if(!/^#[\da-f]{6}$/i.test(solid))throw new Error(`${domain}.solidColor: #RRGGBB required`);
  const trapLut=new Float32Array(1025*3);for(let i=0;i<=1024;i++)trapLut.set(paletteColor(palette,i/1024),i*3);
  return {side:domain,trapLut,algorithm:e('coloring',undefined,domain==='inside'?'none':'smooth_mandelbrot',FRACTAL_COLOR_ALGORITHMS),palette,
   density:n('colorDensity','colorDensity',3,0,100),offset:n('gradientOffset','gradientOffset',0),transfer:e('transfer','transfer','linear',FRACTAL_TRANSFERS),repeat:b('repeatGradient','repeatGradient',true),solid:hexRGB(solid),
   metric:e('metric','metric','iteration',['iteration','real','imaginary','sum']),binary:e('binaryAxis','binaryAxis','imaginary',['real','imaginary','quadrants','phase']),
   smoothSource:e('smoothSource',undefined,'formula',['formula','power','complex']),smoothPower:n('smoothPower',undefined,2,1.000001,100),smoothReal:n('smoothReal',undefined,2),smoothImag:n('smoothImag',undefined,0),smoothBailout:n('smoothBailout',undefined,0,0,1e12),distancePower:sourceDistance?normalizeFractalDistancePower(n('distancePower',undefined,2,-Infinity,Infinity)):n('distancePower',undefined,2,2,100),
   scale:n('directScale','directScale',1,0,100),gamma:n('directGamma','directGamma',1,1e-6,100),saturation:n('directSaturation','directSaturation',.8,0,1),mix:n('directMix','directMix',0,0,1),merge:n('trapMerge',undefined,.2,0,1),threshold:n('trapThreshold',undefined,.25,1e-6,1e12),
   shape:e('trapShape','trapShape','point',['point','ring','cross']),radius:n('trapRadius','trapRadius',.5,0,1e12),center:[n('trapReal','trapReal',0),n('trapImag','trapImag',0)],rotation:n('trapRotation','trapRotation',0),aspect:n('trapAspect','trapAspect',1,1e-6,1e6)};
 }
 return {version,inside:side('inside'),outside:side('outside')};
}
export interface FractalTrapSample {minimum:number;color:RGB;}
export interface FractalTrapState {inside:FractalTrapSample;outside:FractalTrapSample;}
export const createFractalTrapState=():FractalTrapState=>({inside:{minimum:Infinity,color:[0,0,0]},outside:{minimum:Infinity,color:[0,0,0]}});
export const usesFractalTrap=(style:FractalColorStyle)=>style.algorithm==='direct_orbit_trap'||style.algorithm==='orbit_trap_index';
export function trapDistance(z:Complex,s:FractalColorStyle):number {
 const x=z[0]-s.center[0],y=z[1]-s.center[1],co=Math.cos(s.rotation),si=Math.sin(s.rotation),a=x*co-y*si,b=(x*si+y*co)*s.aspect;
 return s.shape==='cross'?Math.min(Math.abs(a),Math.abs(b)):s.shape==='ring'?Math.abs(Math.hypot(a,b)-s.radius):Math.hypot(a,b);
}
const directHSV=(z:Complex,value:number,s:FractalColorStyle):RGB=>hsvRGB(fract(Math.atan2(z[1],z[0])/(2*Math.PI)+.5),s.saturation,clamp(value)).map(v=>v**(1/s.gamma)) as RGB;
export function sampleFractalTrapPalette(s:FractalColorStyle,t:number):RGB {const x=clamp(t)*1024,i=Math.min(1023,Math.floor(x)),f=x-i;return [0,1,2].map(k=>s.trapLut[i*3+k]*(1-f)+s.trapLut[(i+1)*3+k]*f) as RGB;}
export function observeFractalTraps(z:Complex,colors:FractalColors,state:FractalTrapState):void {
 for(const side of ['inside','outside'] as const){const s=colors[side];if(!usesFractalTrap(s))continue;const distance=trapDistance(z,s);if(!Number.isFinite(distance))continue;
  const sample=state[side];sample.minimum=Math.min(sample.minimum,distance);
  if(s.algorithm!=='direct_orbit_trap'||distance>=s.threshold)continue;
  const value=1-distance/s.threshold,direct=directHSV(z,value,s),gradient=sampleFractalTrapPalette(s,value),alpha=value*s.merge;
  for(let k=0;k<3;k++)sample.color[k]+=(direct[k]*(1-s.mix)+gradient[k]*s.mix-sample.color[k])*alpha;
 }
}
export function colorTransfer(value:number,name:string):number {
 const x=Math.max(0,value);switch(name){case 'sqr':return x*x;case 'sqrt':return Math.sqrt(x);case 'cube':return x*x*x;case 'cuberoot':return Math.cbrt(x);case 'log':return Math.log(Math.max(x,1e-6));case 'exp':return Math.exp(Math.min(x,700));case 'sin':return .5+.5*Math.sin(x);case 'arctan':return Math.atan(x)*2/Math.PI;default:return x;}
}
export function shadeFractalOrbit(o:FractalOrbit,c:FractalConfig,colors:FractalColors,traps?:FractalTrapState):RGB|undefined {
 if(o.invalid)return;const s=colors[o.inside?'inside':'outside'],r=Math.hypot(...o.z),angle=fract(Math.atan2(o.z[1],o.z[0])/(2*Math.PI));let index=0,color:RGB|undefined;
 switch(s.algorithm){
  case 'none':return s.solid;
  case 'basic':index=s.metric==='iteration'?.01*(o.convergence?.iteration??o.colorIteration??o.count):.05*(4+(s.metric==='real'?o.z[0]:s.metric==='imaginary'?o.z[1]:o.z[0]+o.z[1]));break;
  case 'smooth_mandelbrot':{
   if(o.convergence){index=convergenceColorIndex(o.convergence);break;}
   const power=s.smoothSource==='power'?s.smoothPower:s.smoothSource==='complex'?Math.hypot(s.smoothReal,s.smoothImag):Math.hypot(...c.power),bailout=s.smoothBailout||c.bailout;
   index=o.inside?.01*(o.colorIteration??o.count):.05*((o.colorIteration??o.count)+1+(Math.log(Math.max(Math.log(Math.max(bailout,1.000001)),1e-12))-Math.log(Math.max(Math.log(Math.max(r,1.000001)),1e-12)))/Math.log(Math.max(power,1.000001)));break;
  }
  case 'decomposition':index=angle;break;
  case 'binary_decomposition':index=(s.binary==='quadrants'?o.z[0]*o.z[1]>=0:s.binary==='phase'?Math.atan2(o.z[1],o.z[0])>0:(s.binary==='real'?o.z[0]:o.z[1])>=0)?.5:0;break;
  case 'distance_estimator':
   if(c.distance){if(!o.distance)throw new Error('Source distance estimation requires producer facts');index=fractalDistanceColorIndex(o.distance,s.distancePower);}
   else index=o.inside?0:Math.max(0,r*Math.log(Math.max(r,1))/Math.max(Math.hypot(...o.derivative),1e-30))**(1/s.distancePower);
   break;
  case 'direct_domain':color=directHSV(o.z,fract(Math.log(Math.max(r,1e-6))*s.scale),s);break;
  case 'direct_normalized_z':color=directHSV(o.z,clamp(Math.log(Math.max(r,1e-6))/Math.log(Math.max(c.bailout,1.000001))*s.scale),s);break;
  case 'direct_orbit_trap':color=traps?.[s.side].color;if(!color)throw new Error('Orbit trap history is required');break;
  case 'orbit_trap_index':{const d=traps?.[s.side].minimum;if(d===undefined)throw new Error('Orbit trap history is required');index=Number.isFinite(d)?d/s.threshold:1;break;}
 }
 if(!color){const t=colorTransfer(index*s.density,s.transfer)+s.offset;color=!s.repeat&&(t<0||t>1)?s.solid:paletteColor(s.palette,t);}
 return color.every(Number.isFinite)?color:undefined;
}
const num=(key:string,label:string,min:number,max:number|undefined,step=.01):ControlSpec=>({key,label,group:'着色参数',type:'number',min,max,step});
const choice=(key:string,label:string,options:readonly string[]):ControlSpec=>({key,label,group:'着色参数',type:'select',options:options.map(value=>({value,label:value}))});
export function fractalColorControls(s:FractalColorStyle,stepConvergence=false,sourceDistance=false):ControlSpec[]{
 const specs:ControlSpec[]=[choice('coloring','着色算法',FRACTAL_COLOR_ALGORITHMS)];
 if(s.algorithm==='none')specs.push({key:'solidColor',label:'固定颜色（HEX）',group:'着色参数',type:'text'});
 else if(!s.algorithm.startsWith('direct_'))specs.push(num('colorDensity','颜色密度',0,100),choice('transfer','传递函数',FRACTAL_TRANSFERS),num('gradientOffset','渐变偏移',-100,100),{key:'repeatGradient',label:'循环渐变',group:'着色参数',type:'toggle'},...(!s.repeat?[{key:'solidColor',label:'超出范围固定颜色（HEX）',group:'着色参数',type:'text'} as ControlSpec]:[]));
 if(s.algorithm==='basic')specs.push(choice('metric','Basic 度量',['iteration','real','imaginary','sum']));
 if(s.algorithm==='binary_decomposition')specs.push(choice('binaryAxis','二值分解轴',['real','imaginary','quadrants','phase']));
 if(s.algorithm==='smooth_mandelbrot'&&s.side==='outside'&&!stepConvergence)specs.push(choice('smoothSource','平滑指数来源',['formula','power','complex']),...(s.smoothSource==='power'?[num('smoothPower','平滑幂次',1.000001,100)]:s.smoothSource==='complex'?[num('smoothReal','平滑指数实部',-100,100),num('smoothImag','平滑指数虚部',-100,100)]:[]),num('smoothBailout','平滑逃逸半径（0 跟随公式）',0,1e12));
 if(s.algorithm==='distance_estimator')specs.push(num('distancePower','距离着色幂次',2,sourceDistance?undefined:100));
 if(s.algorithm==='direct_domain'||s.algorithm==='direct_normalized_z')specs.push(num('directScale','直接颜色缩放',0,100));
 if(s.algorithm.startsWith('direct_'))specs.push(num('directGamma','直接颜色伽马',.000001,100),num('directSaturation','直接颜色饱和度',0,1));
 if(usesFractalTrap(s))specs.push(choice('trapShape','轨道陷阱',['point','ring','cross']),...(s.shape==='ring'?[num('trapRadius','陷阱半径',0,100)]:[]),num('trapReal','陷阱中心 X',-100,100),num('trapImag','陷阱中心 Y',-100,100),num('trapRotation','陷阱旋转（弧度）',-100,100),num('trapAspect','陷阱纵横比',.000001,1e6),num('trapThreshold','陷阱阈值',.000001,1e12));
 if(s.algorithm==='direct_orbit_trap')specs.push(num('directMix','陷阱颜色混合',0,1),num('trapMerge','轨道合并不透明度',0,1));
 return specs.map(spec=>({...spec,key:fractalColorKey(s.side,spec.key)}));
}
export function fractalColorSettings(s:FractalColorStyle):Settings {
 const values:Settings={coloring:s.algorithm,colorDensity:s.density,gradientOffset:s.offset,transfer:s.transfer,repeatGradient:s.repeat,solidColor:'#'+s.solid.map(v=>Math.round(v*255).toString(16).padStart(2,'0')).join(''),metric:s.metric,binaryAxis:s.binary,smoothSource:s.smoothSource,smoothPower:s.smoothPower,smoothReal:s.smoothReal,smoothImag:s.smoothImag,smoothBailout:s.smoothBailout,distancePower:s.distancePower,directScale:s.scale,directGamma:s.gamma,directSaturation:s.saturation,directMix:s.mix,trapMerge:s.merge,trapThreshold:s.threshold,trapShape:s.shape,trapRadius:s.radius,trapReal:s.center[0],trapImag:s.center[1],trapRotation:s.rotation,trapAspect:s.aspect};
 return Object.fromEntries(Object.entries(values).map(([k,v])=>[fractalColorKey(s.side,k),v]));
}
