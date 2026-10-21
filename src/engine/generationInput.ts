import type {GenerationInput} from '../types';
/** One exhaustive transport boundary shared by queued and direct generation.
 * New GenerateContext inputs must be deliberately registered here. Callbacks
 * and other local-only context fields must never cross the Worker boundary. */
const fields:{[K in keyof GenerationInput]-?:true}={
 time:true,quality:true,width:true,height:true,
 sourceBouncingFrame:true,sourceBouncingView:true,spirographFrame:true,
 rootsViewport:true,sourceViewport:true,sourcePointPixelDensity:true,
 samilaPrimaryPixelHeight:true,samilaLive:true,sourcePerlinViewport:true,fractalViewport:true,rootsSessionId:true,
};
export function snapshotGenerationInput(context:GenerationInput):GenerationInput {
 const result:Partial<GenerationInput>={};
 for(const key of Object.keys(fields) as (keyof GenerationInput)[]){
  const value=context[key];
  // Preserve malformed-but-present inputs for the owning worker's validator.
  // Deep-copy nested viewport facts so later callers cannot mutate a request.
  if(value!==undefined)Object.assign(result,{[key]:typeof value==='object'&&value!==null?structuredClone(value):value});
 }
 return result as GenerationInput;
}
