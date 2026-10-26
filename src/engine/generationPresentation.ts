import type {GenerateContext,SceneDocument,SceneOutput} from '../types';
import {usesSourceDomain} from './sourceDomainTimeline';
import {usesSourceFractal} from './sourceFractalDocument';
import {usesSourceImplicitPresentation} from './sourceImplicitPresentation';
import {formulaPresentation} from './formulas';
import {ordinarySourceCameraInitial,ordinarySourceCameraFrame,bindOrdinarySourceCamera,prepareOrdinarySourceFrame} from './ordinarySourceCamera';
import {sourceCameraMode} from './sourceCameraMode';
import {sceneAtTime,timelineWarnings} from './timeline';

/** Shared cold-generation presentation owner, independent of synchronous or
 * asynchronous pixel execution. Live sessions own their captured labels. */
export function prepareGenerationPresentation(scene:SceneDocument,context:GenerateContext){
    // A fresh source Scene constructs its labels from its input configuration,
    // before any source queue update. Deliver that same text with every pass.
    const implicitFormulas=usesSourceImplicitPresentation(scene);
    const formulas=usesSourceFractal(scene)||usesSourceDomain(scene)||implicitFormulas?formulaPresentation(scene,usesSourceFractal(scene)?context.fractalViewport:context.sourceViewport):undefined;
    ordinarySourceCameraInitial(scene);
    // Validate requested projection and paired camera before any geometry or
    // simulation allocation. Progress frames may use an earlier scene time.
    if(scene.sourceCamera){
      const state=sceneAtTime(scene,context.time);
      ordinarySourceCameraFrame(state,context);
    }
    const mode=sourceCameraMode(scene);
    const bind=(output:SceneOutput)=>{
      if(formulas){if(implicitFormulas?output.type!=='geometry':output.type!=='raster')throw Error('源标注与实际帧类型不匹配');output.formulaPresentation=structuredClone(formulas);}
      if(mode.kind==='ordinary')return bindOrdinarySourceCamera(output,sceneAtTime(scene,output.temporal?.time??context.time),context);
      if(mode.kind==='captured-density'){
        if(output.type!=='raster'||!output.cameraResolved||!output.sourceCameraFrame)throw new Error('源密度相机需要携带相机帧的已投影像素图像');
        prepareOrdinarySourceFrame(output.sourceCameraFrame);
      }
      return output;
    };
    const scoped=(scene.sourceCamera||formulas)&&context.onProgress?{...context,onProgress:(output:SceneOutput)=>context.onProgress!(bind(output))}:context;

 return{context:scoped,complete(value:SceneOutput){const output=bind(value),warnings=timelineWarnings(scene);if(warnings.length)output.warnings=[...new Set([...(output.warnings??[]),...warnings])];return output;}};
}
