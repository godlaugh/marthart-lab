import {domainPaletteRuntimeScene} from './domainPaletteEditing';
import type {GenerationInput} from '../types';
import {validateImplicitPaletteControls} from './implicitPaletteControl';
import {validateRootsControls} from './rootsControl';
/** One exhaustive transport boundary shared by queued and direct generation.
 * New GenerateContext inputs must be deliberately registered here. Callbacks
 * and other local-only context fields must never cross the Worker boundary. */
const fields:{[K in keyof GenerationInput]-?:true}={
 time:true,quality:true,width:true,height:true,
 sourceBouncingFrame:true,sourceBouncingView:true,spirographFrame:true,
 rootsPixelDensity:true,rootsViewport:true,sourceViewport:true,sourcePointPixelDensity:true,
 samilaPrimaryPixelHeight:true,sourceMapToneReference:true,sourceSymmetryToneReference:true,perlinLive:true,samilaLive:true,mapLive:true,symmetryLive:true,fractalLive:true,domainLive:true,implicitLive:true,implicitControls:true,surfaceLive:true,domainTarget:true,fractalPixelDensity:true,sourcePerlinViewport:true,fractalViewport:true,fractalRecording:true,rootsSessionId:true,rootsLive:true,
};
export function snapshotGenerationInput(context:GenerationInput):GenerationInput {
 const result:Partial<GenerationInput>={};
 for(const key of Object.keys(fields) as (keyof GenerationInput)[]){
  let value=context[key];
  // Explicit command batches can retain complete Apply documents. Admit their
  // representation before allocating a transport copy; use the same protocol
  // parser as the worker, rather than a second main-thread interpretation.
  if(key==='implicitControls'&&context.implicitControls!==undefined){const {sessionId,...controls}=context.implicitControls;if(typeof sessionId!=='string'||!sessionId.trim())throw Error('Implicit controls require a session identity');validateImplicitPaletteControls(controls);}
  if(key==='rootsLive'&&context.rootsLive?.controls!==undefined)validateRootsControls(context.rootsLive.controls);
  if(key==='domainLive'&&context.domainLive?.configuration){value={...context.domainLive,configuration:domainPaletteRuntimeScene(context.domainLive.configuration)};}
  // Preserve malformed-but-present inputs for the owning worker's validator.
  // Deep-copy nested viewport facts so later callers cannot mutate a request.
  if(value!==undefined)Object.assign(result,{[key]:typeof value==='object'&&value!==null?structuredClone(value):value});
 }
 return result as GenerationInput;
}
