import {compileReal,random} from '../engine/expression';
import {sampleParameterRange,type ParameterSamplingRanges} from '../engine/parameterEditing';
type Point=[number,number];
export const SAMILA_MODES=['f1_f2','f2_f1','f1_x','f2_x','f1_y','f2_y','x_f1','x_f2','y_f1','y_f2','product_f1','product_f2','f1_product','f2_product','kaleidoscope_x','x_kaleidoscope','swirl_x','x_swirl','warp_x','x_warp','cosmod_x','x_cosmod','radial_x','x_radial','fold_x','x_fold','random'] as const;
export const SAMILA_PROJECTIONS=['cartesian','polar','aitoff','hammer','lambert','mollweide','random'] as const;
export type SamilaMode=typeof SAMILA_MODES[number];
export type SamilaProjection=typeof SAMILA_PROJECTIONS[number];
const TAU=Math.PI*2;
function seed32(seed:number):number {if(!Number.isInteger(seed)||seed<0||seed>4294967295)throw new Error('Samila 种子必须是 0 至 4294967295 的整数');return seed;}
function modulo(x:number,period:number):number{return x-period*Math.floor(x/period);}
/** Random chooses one actual mathematical mapping/projection for the whole seeded scene, never a fallback per point. */
export function resolveSamilaSelection(mapping:string,projection:string,seed:number):{mapping:Exclude<SamilaMode,'random'>;projection:Exclude<SamilaProjection,'random'>} {
  seed32(seed);if(!(SAMILA_MODES as readonly string[]).includes(mapping))throw new Error(`不支持 Samila 映射 ${mapping}`);if(!(SAMILA_PROJECTIONS as readonly string[]).includes(projection))throw new Error(`不支持 Samila 投影 ${projection}`);
  const r=random(seed^0x51ed270b),m=mapping==='random'?SAMILA_MODES[Math.floor(r()*(SAMILA_MODES.length-1))]:mapping,p=projection==='random'?SAMILA_PROJECTIONS[Math.floor(r()*(SAMILA_PROJECTIONS.length-1))]:projection;
  return{mapping:m as Exclude<SamilaMode,'random'>,projection:p as Exclude<SamilaProjection,'random'>};
}
/** The first fourteen names retain the project's X_Y convention. Extended transforms follow the documented mathematics. */
export function compileSamilaMapping(mode:string,parameters:Record<string,number>={}):(x:number,y:number,f1:number,f2:number)=>Point {
  if(mode==='random')throw new Error('随机映射必须先按场景种子解析');
  if(!(SAMILA_MODES as readonly string[]).includes(mode))throw new Error(`不支持 Samila 映射 ${mode}`);
  const {a=1,b=1,c=1,d=1}=parameters;if(![a,b,c,d].every(Number.isFinite))throw new Error('Samila 映射参数必须有限');
  const pairs:Record<string,[number,number]>={f1_f2:[2,3],f2_f1:[3,2],f1_x:[2,0],f2_x:[3,0],f1_y:[2,1],f2_y:[3,1],x_f1:[0,2],x_f2:[0,3],y_f1:[1,2],y_f2:[1,3],product_f1:[4,2],product_f2:[4,3],f1_product:[2,4],f2_product:[3,4]};
  const pair=pairs[mode];if(pair)return(x,y,v1,v2)=>{const values=[x,y,v1,v2,v1*v2];return[values[pair[0]],values[pair[1]]];};
  const vertical=mode.startsWith('x_'),family=vertical?mode.slice(2):mode.slice(0,-2);
  const select=(value:number,x:number):Point=>vertical?[x,value]:[value,x];
  if(family==='kaleidoscope'){const period=TAU/Math.max(2,Math.round(a));return(x,_y,v1,v2)=>{const radius=Math.hypot(v1,v2),angle=Math.abs(modulo(Math.atan2(v2,v1)+period/2,period)-period/2);return select(radius*(vertical?Math.sin(angle):Math.cos(angle)),x);};}
  if(family==='swirl')return(x,_y,v1,v2)=>{const radius=Math.hypot(v1,v2),angle=Math.atan2(v2,v1)+a*radius;return select(radius*(vertical?Math.sin(angle):Math.cos(angle)),x);};
  if(family==='warp')return(x,_y,v1,v2)=>select(v1+(vertical?c:a)*Math.sin((vertical?d:b)*v2),x);
  if(family==='cosmod')return(x,_y,v1,v2)=>select(Math.sin(a*v1+b)*Math.cos(c*v2+d),x);
  if(family==='radial')return(x,_y,v1,v2)=>select((v1*v1+v2*v2+1e-10)**(a/2),x);
  const half=Math.abs(a)/2+.001;return(x,_y,v1)=>select(Math.abs(modulo(v1+half,2*half)-half),x);
}
export function projectSamila(x:number,y:number,projection:string):Point {
  if(!Number.isFinite(x)||!Number.isFinite(y))return[NaN,NaN];
  if(projection==='cartesian')return[x,y];if(projection==='polar')return[y*Math.cos(x),y*Math.sin(x)];
  if(projection==='random')throw new Error('随机投影必须先按场景种子解析');
  const lon=modulo(x+Math.PI,TAU)-Math.PI,lat=Math.asin(Math.sin(y));
  if(projection==='aitoff'){const alpha=Math.acos(Math.min(1,Math.max(-1,Math.cos(lat)*Math.cos(lon/2)))),sinc=alpha===0?1:Math.sin(alpha)/alpha;return[2*Math.cos(lat)*Math.sin(lon/2)/sinc,Math.sin(lat)/sinc];}
  if(projection==='hammer'){const denominator=Math.sqrt(1+Math.cos(lat)*Math.cos(lon/2));return[2*Math.SQRT2*Math.cos(lat)*Math.sin(lon/2)/denominator,Math.SQRT2*Math.sin(lat)/denominator];}
  if(projection==='lambert'){const denominator=1+Math.cos(lat)*Math.cos(lon);if(denominator<1e-12)return[NaN,NaN];const k=Math.sqrt(2/denominator);return[k*Math.cos(lat)*Math.sin(lon),k*Math.sin(lat)];}
  if(projection==='mollweide'){let theta=lat;if(Math.abs(Math.abs(lat)-Math.PI/2)<1e-10)theta=Math.sign(lat)*Math.PI/2;else for(let i=0;i<16;i++){const step=(2*theta+Math.sin(2*theta)-Math.PI*Math.sin(lat))/(2+2*Math.cos(2*theta));theta-=step;if(Math.abs(step)<1e-12)break;}return[2*Math.SQRT2/Math.PI*lon*Math.cos(theta),Math.SQRT2*Math.sin(theta)];}
  throw new Error(`不支持投影 ${projection}`);
}
export interface SamilaExploration {
  seed:number; equations:{f1:string;f2:string};parameters:Record<string,number>;
  mapping:Exclude<SamilaMode,'random'>;projection:Exclude<SamilaProjection,'random'>;
  bounds:{minX:number;maxX:number;minY:number;maxY:number};score:number;candidates:number;acceptedCandidates:number;
}
export function randomizeSamilaParameters(parameters:Record<string,number>,seed:number,ranges?:ParameterSamplingRanges):Record<string,number>{const r=random(seed32(seed)),out:Record<string,number>={};for(const [key,value]of Object.entries(parameters)){if(!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key)||['constructor','prototype'].includes(key)||!Number.isFinite(value))throw new Error('参数名称或数值无效');const u=r(),bounds=ranges&&Object.hasOwn(ranges,key)?ranges[key]:undefined;out[key]=bounds?sampleParameterRange(bounds,u):Math.round((.1+u*2.4)*10000)/10000;}return out;}
/** Independent bounded search: explicit formulas, finite-output validation, spatial coverage and entropy score. */
export function exploreSamila(seed:number,options:{candidates?:number;start?:number;stop?:number;isCancelled?:()=>boolean}={}):SamilaExploration {
  seed32(seed);const candidates=options.candidates??16,start=options.start??-Math.PI,stop=options.stop??Math.PI;
  if(!Number.isInteger(candidates)||candidates<1||candidates>64)throw new Error('探索候选数必须是 1 至 64 的整数');
  if(!Number.isFinite(start)||!Number.isFinite(stop)||stop<=start||start< -1000||stop>1000)throw new Error('探索采样范围无效');
  const r=random(seed),functions=[...Array(7).fill('sin'),...Array(7).fill('cos'),'tanh','atan','log','sqrt'];
  const wrap=(input:string)=>{const fn=functions[Math.floor(r()*functions.length)];return fn==='log'?`log(1+abs(${input}))`:fn==='sqrt'?`sqrt(abs(${input}))`:`${fn}(${input})`;};
  let best:SamilaExploration|undefined,acceptedCandidates=0;
  for(let candidate=0;candidate<candidates;candidate++){
    if(options.isCancelled?.())throw new Error('Samila 方程探索已取消');
    const parameters=randomizeSamilaParameters({a:1,b:1,c:1,d:1,e:1,f:1},Math.floor(r()*4294967296));
    const equations={f1:`a*sin(b*x*y)+c*${wrap(r()<.5?'d*x^2+e*y':'d*x+e*y^2')}`,f2:`d*cos(e*x-f*y)+a*${wrap('b*y^2')}+c*sin(${r()<.5?'x+y':'x^2-y'})`};
    const mapping=SAMILA_MODES[Math.floor(r()*26)],projection=SAMILA_PROJECTIONS[Math.floor(r()*6)],transform=compileSamilaMapping(mapping,parameters),f1=compileReal(equations.f1),f2=compileReal(equations.f2),points:Point[]=[];
    let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
    for(let i=0;i<256;i++){const x=start+r()*(stop-start),y=start+r()*(stop-start),scope={...parameters,x,y,t:0},point=projectSamila(...transform(x,y,f1(scope),f2(scope)),projection);if(!point.every(Number.isFinite)||point.some(v=>Math.abs(v)>1000))continue;points.push(point);minX=Math.min(minX,point[0]);maxX=Math.max(maxX,point[0]);minY=Math.min(minY,point[1]);maxY=Math.max(maxY,point[1]);}
    const dx=maxX-minX,dy=maxY-minY;if(points.length<250||dx<1e-4||dy<1e-4)continue;
    const bins=new Uint16Array(256);for(const [x,y]of points){const ix=Math.min(15,Math.floor((x-minX)/dx*16)),iy=Math.min(15,Math.floor((y-minY)/dy*16));bins[iy*16+ix]++;}
    let entropy=0,occupied=0;for(const n of bins)if(n){const p=n/points.length;entropy-=p*Math.log2(p);occupied++;}
    const score=(entropy/8)*Math.sqrt(occupied/256)*Math.sqrt(Math.min(dx,dy)/Math.max(dx,dy));acceptedCandidates++;
    if(!best||score>best.score)best={seed,equations,parameters,mapping:mapping as SamilaExploration['mapping'],projection:projection as SamilaExploration['projection'],bounds:{minX,maxX,minY,maxY},score,candidates,acceptedCandidates};
  }
  if(!best)throw new Error('本次探索没有通过有限性与非退化检查的方程，请更换函数种子或采样范围');
  return{...best,acceptedCandidates};
}
