import {SourceProcessingContextError,type SourceProcessingContextResult,type SourceProcessingContextSnapshot} from './sourceProcessingContext';
import {SOURCE_SYMMETRY_BINDING_TYPES,sourceSymmetryNativeBooleanType,type SourceSymmetryNativeBinding} from './sourceSymmetryNativeBindings';

/** Facts from a linked-program reflection owner. It normalizes terminal [0]
 * once. This consumer never guesses activity or type by scanning GLSL text. */
export interface SourceProcessingUniformReflection {readonly name:string;readonly type:number;readonly size:number;}
const booleanVectorTypes=new Map([[35664,35671],[35665,35672],[35666,35673]]);
export interface SourceProcessingAutomaticPlan {
 readonly bindings:readonly SourceSymmetryNativeBinding[];
 /** Source GL rejects these setters without changing the linked value. Keep
  * that fact while allowing the later source matched-float phase to execute. */
 readonly rejectedSetters:readonly {readonly name:string;readonly setterType:number;readonly linkedType:number;readonly reason:'incompatible-setter'}[];
}
/** Processing's automatic phase only. The source wrapper and matched scalar
 * parameter phase run afterwards. Unselected names retain linked values. */
export function sourceProcessingAutomaticBindings(active:readonly SourceProcessingUniformReflection[],context:SourceProcessingContextSnapshot):SourceProcessingContextResult<SourceProcessingAutomaticPlan> {
 try{
  const demand=(ok:unknown,message:string)=>{if(!ok)throw new SourceProcessingContextError('input',message);};
  demand(Array.isArray(active)&&active.length<=65536,'Processing reflected uniform collection invalid');const byName=new Map<string,SourceProcessingUniformReflection>();
  for(const value of active){demand(value&&typeof value.name==='string'&&value.name.length>0&&!byName.has(value.name)&&Number.isInteger(value.type)&&Number.isInteger(value.size)&&value.size>0,'Processing reflected uniform fact invalid');byName.set(value.name,value);}
  demand(context&&context.lightCount===0,'Processing context lighting is not established for this path');
  for(const [name,width] of Object.entries({viewport:4,projection:16,modelview:16,transform:16,normalMatrix:9,scale:3})){
   const value=context[name as 'viewport'];demand(Array.isArray(value)&&value.length===width&&value.every(n=>typeof n==='number'&&Number.isFinite(Math.fround(n))),'Processing context field invalid: '+name);
  }
  demand(context.perspective===0||context.perspective===1,'Processing perspective flag invalid');
  const out:SourceSymmetryNativeBinding[]=[];
  const rejected:SourceProcessingAutomaticPlan['rejectedSetters'][number][]=[];
  function bind(names:readonly string[],type:SourceSymmetryNativeBinding['type'],values:readonly number[]){
   const selected=names.find(name=>byName.has(name));if(!selected)return;
   const reflected=byName.get(selected)!.type,integerSetter=type===5124||type===35678;
   // An unfamiliar linked type may accept this setter (other sampler types,
   // for example). Do not mislabel unknown compatibility as a rejected write.
   if(!Object.hasOwn(SOURCE_SYMMETRY_BINDING_TYPES,reflected))throw new SourceProcessingContextError('unsupported','Processing automatic linked type is not modeled: '+selected);
   const boolVector=booleanVectorTypes.get(type)===reflected;
   if(!(integerSetter?[5124,35670,35678].includes(reflected):reflected===type||boolVector)){
    rejected.push(Object.freeze({name:selected,setterType:type,linkedType:reflected,reason:'incompatible-setter'}));return;
   }
   demand(Array.isArray(values)&&values.every(n=>typeof n==='number'&&Number.isFinite(Math.fround(n))),'Processing automatic values invalid: '+selected);
   out.push(Object.freeze({name:selected,type:reflected as SourceSymmetryNativeBinding['type'],values:Object.freeze(sourceSymmetryNativeBooleanType(reflected)?values.map(n=>Math.fround(n)===0?0:1):[...values])}));
  }
  bind(['transform','transformMatrix'],35676,context.transform);bind(['modelview','modelviewMatrix'],35676,context.modelview);bind(['projection','projectionMatrix'],35676,context.projection);
  bind(['viewport'],35666,context.viewport);bind(['resolution'],35664,context.viewport.slice(2,4));
  // Fresh updateShader has no PShader.set textures. ppixels uses unit 0, which
  // the source runUpdatePass subsequently binds to its own state texture.
  bind(['ppixels'],35678,[0]);bind(['normalMatrix'],35675,context.normalMatrix);bind(['lightCount'],5124,[0]);
  bind(['perspective'],5124,[context.perspective]);bind(['scale'],35665,context.scale);
  return{ok:true,value:Object.freeze({bindings:Object.freeze(out),rejectedSetters:Object.freeze(rejected)})};
 }catch(error){if(error instanceof SourceProcessingContextError)return{ok:false,error};throw error;}
}
