import type {SceneDocument} from '../types';
import type {Complex} from './complexMath';
import {numberSetting} from './expression';
import {rootParameterBounds,normalizeRootParameter} from './rootParameters';
import {rootsMetricValue,type RootsMetricColorPlan,type RootsMetricKind} from './rootsDensityColor';
import {prepareRootsMathJob,type RootsMathJob} from './rootsMathJob';
export {prepareRootSampling} from './rootsParameterSampling';
export type RootPointAdmission={kind:'point';point:[number,number,number]}|{kind:'filtered'}|{kind:'invalid';reason:'nonfinite-root'|'nonfinite-transform'};
/** Native worker appendRoots admits finite double roots, then narrows raw XYZ
 * and metric to float. It does not apply the legacy half-filter, depth/scale or
 * rotation. Float overflow remains raw evidence: density and custom point-cloud
 * have different downstream admission rules. Borrowed root/sample are not kept. */
export function prepareRootsNativeArrival(metric:RootsMetricKind){
 return(root:Complex,sample:Readonly<Record<string,Complex>>):{kind:'point';values:readonly[number,number,number,number]}|{kind:'invalid';reason:'nonfinite-root'}=>{
  if(!root.every(Number.isFinite))return{kind:'invalid',reason:'nonfinite-root'};
  const t2=Object.hasOwn(sample,'t2')?sample.t2:undefined;
  return{kind:'point',values:[Math.fround(root[0]),Math.fround(root[1]),Math.fround(t2?.[1]??0),Math.fround(rootsMetricValue(metric,root,sample))]};
 };
}
/** Presentation consumes the mathematical owner's prepared parameter facts.
 * A caller-supplied math job is borrowed; otherwise this result owns it. */
export function prepareRootGeneration(scene:SceneDocument,color?:Pick<RootsMetricColorPlan,'kind'|'metric'>|{kind:'rgb-sum'},prepared?:RootsMathJob){
 const math=prepared??prepareRootsMathJob(scene);
 try{
 const s=scene.settings,native=math.model==='mathart-1.7.8-v1';
 const option=(key:string,fallback:string,values:string[])=>{const v=String(s[key]??fallback);if(!values.includes(v))throw new Error(`${key} 不支持 ${v}`);return v;};
 const source=color?.kind==='metric-sum',filter=option('filter','ALL',['ALL','UPPER_HALF']),render=option('rootRender','FLAT',['FLAT','DEPTH']),metric=source?color.metric:option('rootColor','radius',['radius','t2_real','t2_imag']);
 const displayName=native?'t2':String(s.rootDisplayParameter??'t2'),displayParameter=math.parameters.find(p=>p.name===displayName);
 if(!native&&(render==='DEPTH'||!source&&metric!=='radius')&&!displayParameter)throw new Error('颜色/深度采样参数不存在：'+displayName+'；请在采样参数面板选择');
 const rotation=numberSetting(s,'rotation',0,-1e12,1e12),co=Math.cos(rotation),si=Math.sin(rotation),scaleX=numberSetting(s,'rootScale',1,.001,10000),scaleY=numberSetting(s,'rootScaleY',scaleX,.001,10000),depth=numberSetting(s,'depthScale',1,0,10000);
 const offsets=['rootOffsetX','rootOffsetY','rootOffsetZ'].map(key=>numberSetting(s,key,0,-1e30,1e30));
 return{math,render,dispose(){if(!prepared)math.dispose();},
  project(root:Complex,sample:Readonly<Record<string,Complex>>):RootPointAdmission{
   if(!root.every(Number.isFinite))return{kind:'invalid',reason:'nonfinite-root'};
   if(filter==='UPPER_HALF'&&root[1]<0)return{kind:'filtered'};
   const x=root[0]*scaleX,y=root[1]*scaleY,z=render==='DEPTH'?(sample[displayName]?.[1]??0)*depth:0;
   const p:[number,number,number]=[x*co-y*si+offsets[0],x*si+y*co+offsets[1],z+offsets[2]];
   return p.every(Number.isFinite)?{kind:'point',point:p}:{kind:'invalid',reason:'nonfinite-transform'};
  },
  metric(root:Complex,sample:Readonly<Record<string,Complex>>){return source?rootsMetricValue(color.metric,root,sample):metric==='radius'?Math.hypot(...root)/3:displayParameter?normalizeRootParameter(sample[displayName]?.[metric==='t2_real'?0:1]??0,rootParameterBounds(displayParameter,metric==='t2_real'?0:1)):0;}
 };
 }catch(error){if(!prepared)math.dispose();throw error;}
}
