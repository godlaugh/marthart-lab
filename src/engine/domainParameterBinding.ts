import type {SceneDocument} from '../types';
import {DOMAIN_LEVEL_DEFAULTS,domainLevelValue,prepareDomainLevelCurve,writeDomainLevelValue,type DomainLevelKey} from './domainLevelCurve';
import {isJavaBlank} from './domainSourceIteration';
export type DomainParameterBinding={readonly kind:'blank'}|{readonly kind:'scale'}|{readonly kind:'curve';readonly key:DomainLevelKey}|{readonly kind:'parameter';readonly name:string};
/** Identity is the exact source string. UI labels and dotted numeric targets
 * are not accepted as a serialization of this binding. */
export function domainParameterBinding(name:string):DomainParameterBinding {
 if(isJavaBlank(name))return{kind:'blank'};
 if(name==='scale')return{kind:'scale'};
 if(Object.hasOwn(DOMAIN_LEVEL_DEFAULTS,name))return{kind:'curve',key:name as DomainLevelKey};
 return{kind:'parameter',name};
}
export function readDomainParameterBinding(scene:SceneDocument,binding:DomainParameterBinding):number|undefined {
 if(binding.kind==='blank')return undefined;
 if(binding.kind==='curve')return domainLevelValue(scene.settings[binding.key],binding.key);
 if(binding.kind==='scale'){
  const value=Number(scene.settings.scale??2.5);if(!Number.isFinite(value))throw new Error('源域参数缩放必须有限');
  return Math.max(1e-9,value);
 }
 return Object.hasOwn(scene.parameters,binding.name)?scene.parameters[binding.name]:undefined;
}
export function readDomainParameterScalar(scene:SceneDocument,name:string):number|undefined{return readDomainParameterBinding(scene,domainParameterBinding(name));}
export function normalizedDomainParameterValue(binding:DomainParameterBinding,value:number,previous:number|undefined):number|undefined {
 if(binding.kind==='blank')return undefined;
 if(binding.kind==='curve')return writeDomainLevelValue(value,previous??DOMAIN_LEVEL_DEFAULTS[binding.key],binding.key);
 if(!Number.isFinite(value))throw new Error('源域参数动画产生非有限值');
 return binding.kind==='scale'?Math.max(1e-9,value):value;
}
/** Already-normalized evaluated scalar; never parse a target or normalize twice. */
export function applyDomainParameterBinding(scene:SceneDocument,binding:DomainParameterBinding,value:number):void {
 if(binding.kind==='blank')return;
 if(binding.kind==='parameter')Object.defineProperty(scene.parameters,binding.name,{value,writable:true,configurable:true,enumerable:true});
 else if(binding.kind==='scale')scene.settings.scale=value;
 else {
  // The source constructs and normalizes the whole LevelCurveParams object.
  const level=prepareDomainLevelCurve({...scene.settings,bias:scene.settings.curveBias,mix:scene.settings.curveMix});
  for(const key of Object.keys(DOMAIN_LEVEL_DEFAULTS) as DomainLevelKey[])scene.settings[key]=level[key];
  scene.settings.curveMode=level.curveMode;scene.settings.curveBias=level.bias;scene.settings.curveMix=level.mix;
  scene.settings[binding.key]=value;
 }
}
