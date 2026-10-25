import type {SceneDocument} from '../types';
import type {prepareFractalRender} from '../scenes/complex';
import type {PreparedFractalSourceColor} from './fractalSourceColor';
import type {FractalSourceNativePrecisionInput,FractalSourcePrecision} from './fractalSourcePrecision';

export type SourceFractalDisplayMethod='one-pass'|'guessing'|'multi-pass';
export interface SourceFractalDisplayInput {
 readonly native:FractalSourceNativePrecisionInput;
 readonly color:PreparedFractalSourceColor;
 readonly method:SourceFractalDisplayMethod;
 readonly precision:FractalSourcePrecision;
 readonly logicalSize:readonly[number,number];
 readonly parametersRunning:boolean;
}
export interface SourceFractalDisplayFacts {
 readonly profile:'mathart-1.7.8-display-v1';
 readonly ordinal:number;readonly stateHash:number;readonly stateReset:boolean;
 readonly method:SourceFractalDisplayMethod;readonly parametersRunning:boolean;
 readonly passIndexBefore:number;readonly passIndexAfter:number;
 readonly previewScale:number;
 /** PShader consumes the previous display's queued size at the first bind. */
 readonly gradientSize:0|1024;
 /** This display queues its size after the first bind, for the next display. */
 readonly requestedGradientSize:0|1024;
 /** Texture binding is immediate, independent of delayed gradientSize. */
 readonly useGradientTexture:boolean;
 readonly needsAnotherDisplay:boolean;
}
const ownedDisplays=new WeakSet<object>();
export function validateSourceFractalDisplayFacts(facts:SourceFractalDisplayFacts):void {
 if(!facts||!ownedDisplays.has(facts))throw Error('分形显示事实不属于当前 worker 的显示实例');
}
const floats=new DataView(new ArrayBuffer(8));
function floatBits(value:number):number {if(Number.isNaN(value))return 0x7fc00000;floats.setFloat32(0,value);return floats.getInt32(0);}
function doubleHash(value:number):number {if(Number.isNaN(value))return 0x7ff80000;floats.setFloat64(0,value);return floats.getInt32(0)^floats.getInt32(4);}
const methodOrdinal:Record<SourceFractalDisplayMethod,number>={'one-pass':2,'guessing':0,'multi-pass':1};
const precisionOrdinal:Record<FractalSourcePrecision,number>={low:0,medium:1,high:2,ultra:3};
const formulaOrdinal={mandelbrot:0,julia:1,newton:2,nova:3} as const;
/** Exact ComplexFractalMobject.computeRenderState int32 rolling hash. View
 * center/zoom/rotation/time/dynamic slots and algorithm IDs are absent in the
 * shipped method, so they must not be added as convenient invalidation keys. */
export function sourceFractalRenderState(input:SourceFractalDisplayInput):number {
 const n=input.native.native,c=input.color,p=c.fallback;let hash=17;
 const word=(v:number)=>{hash=(Math.imul(hash,31)+(v|0))|0;},f=(v:number)=>word(floatBits(v));
 word(n.fractalType==='julia'?1:0);word(n.power);f(p.offset);f(p.gamma);word(p.space);
 word(methodOrdinal[input.method]);word(precisionOrdinal[input.precision]);word(0);word(formulaOrdinal[input.native.formula]);
 n.formulaParams.forEach(f);
 for(const side of [c.inside,c.outside]){f(side.density);word(side.transferId);f(side.offset);word(side.repeat?1:0);word(side.solidArgb);}
 word(input.native.iterations);f(n.bailout);word(doubleHash(n.julia[0]));word(doubleHash(n.julia[1]));
 word(p.useCosine?1:0);p.packedColors.forEach(word);for(const values of [p.cosine.a,p.cosine.b,p.cosine.c,p.cosine.d])values.forEach(f);
 f(input.logicalSize[0]);f(input.logicalSize[1]);return hash;
}
export function sourceFractalDisplayInput(prepared:ReturnType<typeof prepareFractalRender>,scene:SceneDocument):SourceFractalDisplayInput {
 if(!prepared.source||!prepared.sourcePlan||!prepared.colorPlan||!scene.evaluatedFractalScene)throw Error('原版分形显示需要完整数值、颜色与场景求值事实');
 const method=prepared.method;if(method!=='one-pass'&&method!=='guessing'&&method!=='multi-pass')throw Error('原版分形显示方法无效');
 return{native:prepared.source,color:prepared.colorPlan,method,precision:prepared.sourcePlan.perturbation.precision,logicalSize:prepared.sourcePlan.logicalSize,parametersRunning:scene.evaluatedFractalScene.parameters.running};
}
const scales:Record<SourceFractalDisplayMethod,readonly number[]>={'one-pass':[1],guessing:[Math.fround(.33),1],'multi-pass':[.25,.5,1]};
/** One original Mobject/PShader incarnation owns one pass index and one queued
 * uniform. It has no per-target image cache. A changed logical size resets the
 * shared pass index; returning to the previous size resets it again. */
export class SourceFractalDisplay {
 private passIndex=0;private lastState?:number;private lastMethod?:SourceFractalDisplayMethod;
 private pendingGradientSize:0|1024=0;private ordinal=0;private busy=false;
 /** applyConfig resets the pass, but keeps the same PShader's pending uniform. */
 applyConfiguration():void {if(this.busy)throw Error('分形显示期间不能替换配置');this.passIndex=0;}
 private begin(input:SourceFractalDisplayInput):SourceFractalDisplayFacts {
  if(this.busy)throw Error('分形显示不能重入');
  const stateHash=sourceFractalRenderState(input),stateReset=stateHash!==this.lastState||input.method!==this.lastMethod;
  const passIndexBefore=stateReset?0:this.passIndex,passes=scales[input.method],full=input.method==='one-pass'||input.parametersRunning;
  const previewScale=full?1:passes[Math.min(passIndexBefore,passes.length-1)],useGradientTexture=previewScale>=Math.fround(.999);
  const passIndexAfter=input.method==='one-pass'?passIndexBefore:Math.min(full?passes.length-1:passIndexBefore+1,passes.length-1);
  const requestedGradientSize=useGradientTexture?1024:0;
  const nextScale=full?1:passes[passIndexAfter];
  const facts:SourceFractalDisplayFacts=Object.freeze({profile:'mathart-1.7.8-display-v1',ordinal:this.ordinal,stateHash,stateReset,method:input.method,parametersRunning:input.parametersRunning,passIndexBefore,passIndexAfter,previewScale,gradientSize:this.pendingGradientSize,requestedGradientSize,useGradientTexture,needsAnotherDisplay:nextScale!==previewScale||this.pendingGradientSize!==requestedGradientSize});
  ownedDisplays.add(facts);
  this.busy=true;
  return facts;
 }
 private commit(facts:SourceFractalDisplayFacts):void {
  this.passIndex=facts.passIndexAfter;this.lastState=facts.stateHash;this.lastMethod=facts.method;this.pendingGradientSize=facts.requestedGradientSize;this.ordinal=facts.ordinal+1;
 }
 display<T>(input:SourceFractalDisplayInput,render:(facts:SourceFractalDisplayFacts)=>T):T {
  const facts=this.begin(input);
  try{
   const output=render(facts);
   if(output!==null&&(typeof output==='object'||typeof output==='function')&&typeof (output as {then?:unknown}).then==='function')throw Error('同步分形显示不能返回 thenable；请使用 displayAsync');
   this.commit(facts);return output;
  }
  finally{this.busy=false;}
 }
 /** A display commits only after its actual render acknowledgement. The same
  * transition owns sync and async paths; rejected work leaves all progress at
  * its last successful display, including the shader's queued uniform. */
 async displayAsync<T>(input:SourceFractalDisplayInput,render:(facts:SourceFractalDisplayFacts)=>T|PromiseLike<T>):Promise<T> {
  const facts=this.begin(input);
  try{const output=await render(facts);this.commit(facts);return output;}
  finally{this.busy=false;}
 }
}
