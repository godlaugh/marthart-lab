import type {Settings} from '../types';
import type {Complex} from './complexMath';
import {parseRootParameters} from './rootParameters';
const TAU=2*Math.PI;
/** Shared sampling owner for both the scene and candidate screening. */
export function prepareRootSampling(s:Settings,scalarNames:readonly string[]=[]){
 const parameters=parseRootParameters(s,String(s.variable??'z'),scalarNames),names=parameters.map(p=>p.name);
 const between=(lo:number,hi:number,u:number)=>Number.isFinite(hi-lo)?lo+u*(hi-lo):lo*(1-u)+hi*u;
 return {parameters,names,sample(rng:()=>number):Record<string,Complex>{
  return Object.fromEntries(parameters.map(p=>{let value:Complex;
   if(p.domain==='FIXED')value=[...p.value];
   else if(p.domain==='UNIT_CIRCLE'){const a=rng()*TAU;value=[Math.cos(a),Math.sin(a)];}
   else value=[between(p.minRe,p.maxRe,rng()),p.domain==='REAL_RANGE'?0:between(p.minIm,p.maxIm,rng())];
   return[p.name,value];
  }));
 }};
}
