import {validateFrameFormulas} from './formulaConfig';
import type {SceneOutput,GenerationInput} from '../types';
/** Playback acknowledgements change the runtime clock without repainting the
 * completed image. Its presentation remains valid against the same viewport. */
export function validSourceSurfacePresentation(output:SceneOutput,input:GenerationInput,recording=false):output is Extract<SceneOutput,{type:'geometry'}> {
 const expected=input.surfaceLive;
 if(!expected||output.type!=='geometry'||!output.surfaceLive)return false;
 try{output.formulaPresentation=validateFrameFormulas(output.formulaPresentation,input.sourceViewport);}catch{return false;}
 const live=output.surfaceLive,frame=live.frame,a=output.sourceCameraFrame?.camera,b=frame?.camera,v=output.sourceCameraFrame?.viewport,w=input.sourceViewport;
 const alpha=frame?.surfaceTransition?.overlayAlpha??0,presentation=output.formulaPresentation;
 const deferred=presentation.layout==='source-surface-centered-v1'?presentation.finalBlackOverlayAlpha:undefined;
 const expectedDeferred=alpha>0&&presentation.layout==='source-surface-centered-v1'&&presentation.labels.length>0;
 if(!Number.isInteger(alpha)||alpha<0||alpha>255||(expectedDeferred?(deferred!==alpha||output.sourceSurfaceOverlayAlpha!==undefined):(deferred!==undefined||(output.sourceSurfaceOverlayAlpha??0)!==alpha)))return false;
 return live.sessionId===expected.sessionId&&live.revision===expected.revision&&typeof live.paused==='boolean'&&['update','snapshot'].includes(live.renderKind)&&(recording?live.clockSource==='fixed-step':['worker-wall-clock','injected'].includes(live.clockSource))&&Number.isSafeInteger(live.constructions)&&live.constructions>0&&!!frame&&Number.isSafeInteger(frame.frameIndex)&&frame.frameIndex>=0&&Number.isFinite(frame.time)&&Number.isFinite(frame.sceneTime)&&Number.isFinite(frame.rawDt)&&Number.isFinite(frame.activeDt)&&Number.isSafeInteger(frame.queueIndex)&&frame.queueIndex>=0&&typeof frame.queueComplete==='boolean'&&output.temporal?.time===frame.time&&output.sourceCameraFrame?.time===frame.time&&output.sourceCameraFrame?.frameIndex===frame.frameIndex&&!!a&&!!b&&[a.phi,a.theta,a.gamma,a.zoom,a.focalDistance,...(Array.isArray(a.center)?a.center:[])].every(Number.isFinite)&&a.phi===b.phi&&a.theta===b.theta&&a.gamma===b.gamma&&a.zoom===b.zoom&&a.focalDistance===b.focalDistance&&Array.isArray(a.center)&&Array.isArray(b.center)&&a.center.length===3&&b.center.length===3&&a.center.every((x,i)=>x===b.center[i])&&!!v&&!!w&&v.logicalWidth===w.logicalWidth&&v.logicalHeight===w.logicalHeight&&v.referenceLogicalHeight===w.referenceLogicalHeight&&v.target===w.target&&v.projectionPass===w.projectionPass;
}

export function validSourceSurfaceOutput(output:SceneOutput,input:GenerationInput,recording=false):output is Extract<SceneOutput,{type:'geometry'}> {
 return validSourceSurfacePresentation(output,input,recording)&&output.surfaceLive!.paused===input.surfaceLive?.clock?.paused;
}
