import type {RootNativeParameter,RootsMathConfiguration,SceneDocument} from '../types';
import {parseRootsSignedLongText} from './rootsSourceOrder';
import {prepareRootsVariableLabel} from './rootsVariableLabel';
export type {RootNativeParameter,RootsMathConfiguration} from '../types';
export const ROOTS_NATIVE_MATH_MODEL='mathart-1.7.8-v1' as const;
export const ROOTS_MATH_MODELS=['local-v1',ROOTS_NATIVE_MATH_MODEL] as const;
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const integer=(v:unknown):v is number=>finite(v)&&Number.isSafeInteger(v)&&v>=1&&v<=2147483647;
/** This boundary validates stored shapes, not coefficient syntax or native
 * workspace capacity. Dormant tables remain editable and round-trip verbatim. */
export function parseRootsMath(raw:unknown):RootsMathConfiguration {
 if(!record(raw)||!ROOTS_MATH_MODELS.includes(raw.model as RootsMathConfiguration['model']))throw new Error('复根数学规则无效');
 const {polynomial,parameters,solver,sampling}=raw;
 if(!record(polynomial)||!Array.isArray(polynomial.coefficients))throw new Error('复根源多项式必须包含变量名称和有序系数表');
 const parsedVariable=prepareRootsVariableLabel(polynomial.variable);if(!parsedVariable.ok)throw parsedVariable.error;const variable=parsedVariable.value.authored;
 const coefficients=polynomial.coefficients.map(row=>{if(!record(row)||typeof row.exponent!=='string'||typeof row.expression!=='string')throw new Error('复根源系数必须保留字符串次数和表达式');return{exponent:row.exponent,expression:row.expression};});
 if(!Array.isArray(parameters))throw new Error('复根源参数必须是有序数组');
 const parsedParameters:RootNativeParameter[]=parameters.map(row=>{
  if(!record(row)||typeof row.name!=='string'||!['UNIT_CIRCLE','REAL_RANGE','COMPLEX_RECT','FIXED'].includes(String(row.domain))||!['minRe','maxRe','minIm','maxIm'].every(k=>finite(row[k]))||!Array.isArray(row.value)||row.value.length!==2||!row.value.every(finite))throw new Error('复根源参数必须保留名称、采样域和有限数值');
  return{name:row.name,domain:row.domain as RootNativeParameter['domain'],minRe:row.minRe as number,maxRe:row.maxRe as number,minIm:row.minIm as number,maxIm:row.maxIm as number,value:[row.value[0],row.value[1]]};
 });
 if(!record(solver)||!integer(solver.maxIterations)||!finite(solver.tolerance)||solver.tolerance<=0)throw new Error('复根源求解参数无效');
 if(!record(sampling)||!['sampleCount','batchSize','workerCount'].every(k=>integer(sampling[k]))||typeof sampling.filter!=='string'||typeof sampling.seed!=='string')throw new Error('复根源采样参数或整数种子无效');
 const seed=parseRootsSignedLongText(sampling.seed);
 if(!seed.ok)throw new Error(seed.error.kind==='capacity'?'复根源种子超出文本容量':'复根源种子必须在有符号 64 位整数范围内');
 return{model:raw.model as RootsMathConfiguration['model'],polynomial:{variable:typeof variable==='string'?variable:structuredClone(variable),coefficients},parameters:parsedParameters,solver:{maxIterations:solver.maxIterations,tolerance:solver.tolerance},sampling:{sampleCount:sampling.sampleCount as number,batchSize:sampling.batchSize as number,workerCount:sampling.workerCount as number,seed:sampling.seed,filter:sampling.filter}};
}
export function usesRootsNativeMath(scene:Pick<SceneDocument,'kind'|'rootsMath'>):boolean{return scene.kind==='roots'&&scene.rootsMath?.model===ROOTS_NATIVE_MATH_MODEL;}
export function defaultRootNativeParameter(name:string):RootNativeParameter{return{name,domain:'UNIT_CIRCLE',minRe:-5,maxRe:5,minIm:-1,maxIm:1,value:[0,0]};}
/** The original worker default depends on its machine. This explicit local
 * completion uses one logical worker until the author selects a count. */
export function createRootsNativeMath(workerCount=1):RootsMathConfiguration {
 return parseRootsMath({model:ROOTS_NATIVE_MATH_MODEL,polynomial:{variable:'x',coefficients:[{exponent:'18',expression:'10'},{exponent:'17',expression:'-10'},{exponent:'8',expression:'3200*t2^6 -4800*t2^4 +1800*t2^2 -100'},{exponent:'7',expression:'200*t1^2 -100'},{exponent:'1',expression:'-10'},{exponent:'0',expression:'10'}]},parameters:[defaultRootNativeParameter('t1'),defaultRootNativeParameter('t2')],solver:{maxIterations:180,tolerance:1e-9},sampling:{sampleCount:15000,batchSize:256,workerCount,seed:'0',filter:''}});
}
export function withRootsMathModel(scene:SceneDocument,model:RootsMathConfiguration['model']):SceneDocument {
 if(scene.kind!=='roots')throw new Error('复根数学规则仅适用于复根场景');
 if(!ROOTS_MATH_MODELS.includes(model))throw new Error('复根数学规则无效');
 if(!scene.rootsMath&&model==='local-v1')return scene;
 return{...scene,rootsMath:parseRootsMath({...scene.rootsMath??createRootsNativeMath(),model})};
}
const legacyMathControls=new Set(['variable','seed','sampleCount','rootTotalSamples','rootBatchSize','rootIterations','rootTolerance','rootSampleFilter','rootFilterParameter','rootParameters','rootDisplayParameter','rangeMin','rangeMax',...[1,2,3].flatMap(i=>['domain'+i,'fixed'+i+'Real','fixed'+i+'Imag'])]);
export function rootMathControlVisible(scene:Pick<SceneDocument,'kind'|'rootsMath'>,key:string):boolean{return!usesRootsNativeMath(scene)||!legacyMathControls.has(key);}

/** Old math targets keep their authored tracks but do not address the native
 * coefficient/sampling payload. Rendering, tone and replay controls stay active. */
export function rootMathAnimationTargetEnabled(scene:Pick<SceneDocument,'kind'|'rootsMath'>,target:string):boolean {
 return !usesRootsNativeMath(scene)||!target.startsWith('parameters.')&&(!target.startsWith('settings.')||rootMathControlVisible(scene,target.slice('settings.'.length)));
}
