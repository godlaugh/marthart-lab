import {compileReal,finite,random} from '../engine/expression';
import {readSymmetryCustomSource} from '../engine/symmetryCustom';
export type Point3=[number,number,number];
/** A field owns both its step metric and validity. Consumers must not infer
 * validity from the sign of a metric: custom shaders may return negative values. */
export interface IteratedStep {position:Point3;metric:number;valid:boolean;}
/** Built-in fields retain their original distance metric and escape ordering. */
export function builtInIterationResult(previous:Point3,position:Point3,escape:number):IteratedStep {
  const valid=position.every(Number.isFinite)&&Math.hypot(...position)<=escape;
  const metric=valid?Math.hypot(position[0]-previous[0],position[1]-previous[1],position[2]-previous[2]):0;
  return {position,metric,valid:valid&&Number.isFinite(metric)};
}
type Evaluate=(scope:Record<string,number>)=>number;
const MAP_RESERVED=['x','y','z','t','time','nx','ny','nz','x_next','y_next','z_next'];
function validateParameters(parameters:Record<string,number>):void {for(const [k,v]of Object.entries(parameters)){if(MAP_RESERVED.includes(k)||['constructor','prototype','__proto__'].includes(k))throw new Error(`参数 ${k} 是映射保留变量`);finite(v,`参数 ${k}`);}}
/** Old coordinates are immutable within a step; only explicit nx/x_next and ny/y_next aliases cascade. */
export function mapStep(x:number,y:number,equations:{x:Evaluate;y:Evaluate},scope:Record<string,number>):[number,number] {
  finite(x,'x');finite(y,'y');const old={...scope,x,y};const nx=equations.x(old),ny=equations.y({...old,nx,x_next:nx});return[nx,ny];
}
export function compileMapIterator(equations:{x:string;y:string;z?:string},parameters:Record<string,number>,dimension:2|3,time=0):(point:Point3)=>Point3 {
  if(dimension!==2&&dimension!==3)throw new Error('映射维度必须为 2 或 3');finite(time,'映射时间');validateParameters(parameters);
  const fx=compileReal(equations.x),fy=compileReal(equations.y),fz=dimension===3?compileReal(equations.z?.trim()||'z'):undefined;
  const base={...parameters,t:time,time},xs:Record<string,number>={...base},ys:Record<string,number>={...base},zs:Record<string,number>={...base};
  return([x,y,z])=>{
    if(![x,y,z].every(Number.isFinite))throw new Error('映射输入坐标必须有限');
    for(const s of [xs,ys,zs]){s.x=x;s.y=y;s.z=dimension===2?0:z;}
    const nx=fx(xs);ys.nx=ys.x_next=nx;
    const ny=fy(ys);zs.nx=zs.x_next=nx;zs.ny=zs.y_next=ny;
    return[nx,ny,fz?fz(zs):0];
  };
}
export interface SymmetryParameters {lambda:number;alpha:number;beta:number;gamma:number;omega:number;n:number;template?:'standard'|'modified';delta?:number;deltaPower?:number;}
export function symmetryStep(x:number,y:number,p:SymmetryParameters):[number,number] {
  const radius=Math.hypot(x,y),theta=Math.atan2(y,x),rn=radius**p.n,rprev=radius**(p.n-1);
  const gain=p.lambda+p.alpha*radius*radius+p.beta*rn*Math.cos(p.n*theta)+(p.template==='modified'?(p.delta??0)*radius*Math.cos(p.n*(p.deltaPower??1)*theta):0);
  return[gain*x+p.gamma*rprev*Math.cos((p.n-1)*theta)-p.omega*y,gain*y-p.gamma*rprev*Math.sin((p.n-1)*theta)+p.omega*x];
}
export function validateSymmetryParameters(p:SymmetryParameters):SymmetryParameters {
  if(!p||!Object.values(p).filter(v=>typeof v==='number').every(Number.isFinite))throw new Error('对称参数必须有限');
  if(!['lambda','alpha','beta','gamma','omega'].every(k=>typeof p[k as keyof SymmetryParameters]==='number'))throw new Error('对称参数缺失');
  if(!Number.isInteger(p.n)||p.n<2||p.n>50)throw new Error('对称阶数必须是 2 至 50 的整数');
  if(p.template!==undefined&&!['standard','modified'].includes(p.template))throw new Error('未知对称方程模板');
  if(p.delta!==undefined&&typeof p.delta!=='number')throw new Error('修正系数必须是有限数字');
  if(p.deltaPower!==undefined&&(!Number.isInteger(p.deltaPower)||p.deltaPower<1||p.deltaPower>6))throw new Error('修正幂次必须是 1 至 6 的整数');
  return{...p,template:p.template??'standard',delta:p.delta??0,deltaPower:p.deltaPower??1};
}
export const SYMMETRY_PROFILES=['any','shield','cloak','sector','pinwheel','ribbed','binary'] as const;
export type SymmetryProfile=typeof SYMMETRY_PROFILES[number];
type Range=[number,number];
interface Profile {ranges:[Range,Range,Range,Range,Range];degree:Range;minAbs:[number,number,number];modified?:boolean;}
// Parameter domain facts from shipped profile metadata; sampling/scoring below is independent.
const PROFILES:Record<SymmetryProfile,Profile>={
 any:{ranges:[[-3,3],[-3,3],[-1.4,1.4],[-1,1],[-1,1]],degree:[2,10],minAbs:[0,0,0]},
 shield:{ranges:[[.9,3],[-3,-.45],[-1,1],[-1,1],[-.2,.2]],degree:[3,12],minAbs:[.1,.25,0]},
 cloak:{ranges:[[-3,-.8],[.45,3],[-.9,.9],[-.9,.9],[-.35,.35]],degree:[5,16],minAbs:[.08,.18,0]},
 sector:{ranges:[[.8,3],[-3,-.5],[-1.4,1.4],[-1,1],[-.18,.18]],degree:[3,14],minAbs:[.6,.25,0]},
 pinwheel:{ranges:[[.8,3],[-3,-.45],[-1.1,1.1],[-1,1],[-.95,.95]],degree:[3,12],minAbs:[.1,.2,.25]},
 ribbed:{ranges:[[.9,3],[-3,-.45],[-1,1],[-1,1],[-.2,.2]],degree:[3,12],minAbs:[.1,.2,0],modified:true},
 binary:{ranges:[[-2.5,2.5],[-2.5,2.5],[-1.1,1.1],[-1,1],[-.5,.5]],degree:[2,2],minAbs:[.1,.2,0]},
};
export interface OrbitMetrics {score:number;finiteRatio:number;occupied:number;span:[number,number,number];center:Point3;bounds:{min:Point3;max:Point3};}
function orbitMetrics(points:Point3[],expected:number,dimension:2|3):OrbitMetrics|null {
  if(points.length<expected*.98)return null;
  const min:Point3=[Infinity,Infinity,Infinity],max:Point3=[-Infinity,-Infinity,-Infinity];
  for(const p of points)for(let a=0;a<3;a++){min[a]=Math.min(min[a],p[a]);max[a]=Math.max(max[a],p[a]);}
  const span=min.map((v,i)=>max[i]-v) as Point3,center=min.map((v,i)=>(v+max[i])/2) as Point3;
  if(span[0]<1e-4||span[1]<1e-4||dimension===3&&span[2]<1e-4)return null;
  const n=dimension===3?10:24,bins=new Uint16Array(n**dimension);let occupied=0,entropy=0;
  for(const p of points){const cell=p.map((v,a)=>Math.min(n-1,Math.floor((v-min[a])/(span[a]||1)*n)));const idx=cell[0]+cell[1]*n+(dimension===3?cell[2]*n*n:0);bins[idx]++;}
  for(const count of bins)if(count){occupied++;const f=count/points.length;entropy-=f*Math.log2(f);}
  if(occupied<8)return null;
  const lengths=span.slice(0,dimension),balance=Math.sqrt(Math.min(...lengths)/Math.max(...lengths)),score=entropy/Math.log2(bins.length)*Math.sqrt(occupied/bins.length)*balance;
  return{score,finiteRatio:points.length/expected,occupied,span,center,bounds:{min,max}};
}
function seedValue(seed:number){if(!Number.isInteger(seed)||seed<0||seed>0xffffffff)throw new Error('探索种子必须是 32 位非负整数');return seed;}
export interface SymmetryExploration {seed:number;profile:SymmetryProfile;parameters:Record<string,number>;settings:{degree:number;template:'standard'|'modified';deltaPower:number};metrics:OrbitMetrics;candidates:number;acceptedCandidates:number;}
export function exploreSymmetry(seed:number,options:{profile?:SymmetryProfile;degree?:number;template?:'standard'|'modified';candidates?:number;isCancelled?:()=>boolean;customGlsl?:unknown}={}):SymmetryExploration {
  if(readSymmetryCustomSource(options.customGlsl)!==undefined)throw new Error('自定义 Symmetry GLSL 不支持内建模板探索；请先显式选择标准或径向修正模板。');
  const r=random(seedValue(seed)),profile=options.profile??'any',spec=PROFILES[profile];if(!spec)throw new Error('未知对称探索类型');
  const candidates=options.candidates??180;if(!Number.isInteger(candidates)||candidates<1||candidates>1000)throw new Error('探索候选数必须是 1 至 1000 的整数');
  if(options.degree!==undefined&&(!Number.isInteger(options.degree)||options.degree<2||options.degree>50))throw new Error('锁定阶数必须是 2 至 50 的整数');
  if(options.template!==undefined&&!['standard','modified'].includes(options.template))throw new Error('未知对称方程模板');
  const ranged=([lo,hi]:Range)=>lo+r()*(hi-lo),sampleRange=(range:Range,minAbs:number)=>{let v=ranged(range);if(Math.abs(v)<minAbs)v=(v<0?-1:1)*(minAbs+r()*(Math.max(Math.abs(range[0]),Math.abs(range[1]))-minAbs));return v;};
  let best:SymmetryExploration|undefined,acceptedCandidates=0;
  for(let attempt=0;attempt<candidates;attempt++){
    if(options.isCancelled?.())throw new Error('对称探索已取消');
    const [lambda,alpha,beta,gamma,omega]=spec.ranges.map((range,i)=>sampleRange(range,i>1?spec.minAbs[i-2]:0));
    const template=spec.modified?'modified':options.template??'standard',n=options.degree??Math.floor(ranged([spec.degree[0],spec.degree[1]+1])),delta=template==='modified'?sampleRange([-1,1],spec.modified?.25:0):0,deltaPower=template==='modified'?2+Math.floor(r()*5):1;
    const p:SymmetryParameters={lambda,alpha,beta,gamma,omega,n,template,delta,deltaPower};let x=.01+r()*.1,y=.01+r()*.1;const points:Point3[]=[];let diverged=false;
    for(let i=0;i<2280;i++){[x,y]=symmetryStep(x,y,p);if(!Number.isFinite(x)||!Number.isFinite(y)||Math.hypot(x,y)>10){diverged=true;break;}if(i>=80)points.push([x,y,0]);}
    if(diverged)continue;const metrics=orbitMetrics(points,2200,2);if(!metrics)continue;acceptedCandidates++;
    if(!best||metrics.score>best.metrics.score)best={seed,profile,parameters:{lambda,alpha,beta,gamma,omega,delta},settings:{degree:n,template,deltaPower},metrics,candidates,acceptedCandidates};
  }
  if(!best)throw new Error('本次搜索未找到稳定且非退化的对称轨迹；请更换种子或增加候选数');
  return{...best,acceptedCandidates};
}
export interface MapExploration {seed:number;parameters:Record<string,number>;metrics:OrbitMetrics;candidates:number;acceptedCandidates:number;}
export function exploreMap(seed:number,equations:{x:string;y:string;z?:string},parameters:Record<string,number>,options:{dimension?:2|3;ranges?:Record<string,Range>;candidates?:number;isCancelled?:()=>boolean}={}):MapExploration {
  const r=random(seedValue(seed)),dimension=options.dimension??2,candidates=options.candidates??100;
  if(!Number.isInteger(candidates)||candidates<1||candidates>1000)throw new Error('探索候选数必须是 1 至 1000 的整数');validateParameters(parameters);
  for(const [name,range]of Object.entries(options.ranges??{})){if(!Object.hasOwn(parameters,name)||!Array.isArray(range)||range.length!==2||!range.every(Number.isFinite)||range[1]<range[0])throw new Error(`参数 ${name} 探索范围无效`);}
  let best:MapExploration|undefined,acceptedCandidates=0;
  for(let attempt=0;attempt<candidates;attempt++){
    if(options.isCancelled?.())throw new Error('映射探索已取消');
    const p:Record<string,number>={};for(const k of Object.keys(parameters)){const range=options.ranges?.[k]??[-3,3];p[k]=range[0]+r()*(range[1]-range[0]);}
    const step=compileMapIterator(equations,p,dimension);let point:Point3=[(r()-.5)*.2,(r()-.5)*.2,dimension===3?(r()-.5)*.2:0],diverged=false;const points:Point3[]=[];
    for(let i=0;i<2280;i++){point=step(point);if(!point.every(Number.isFinite)||Math.hypot(...point)>100){diverged=true;break;}if(i>=80)points.push(point);}
    if(diverged)continue;const metrics=orbitMetrics(points,2200,dimension);if(!metrics)continue;acceptedCandidates++;if(!best||metrics.score>best.metrics.score)best={seed,parameters:p,metrics,candidates,acceptedCandidates};
  }
  if(!best)throw new Error('本次搜索未找到稳定且非退化的映射轨迹；请调整范围或种子');return{...best,acceptedCandidates};
}
