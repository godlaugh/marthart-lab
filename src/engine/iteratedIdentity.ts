import {usesSourceMapParameters} from './sourceMapParameterIdentity';
import {sourceMapInitialSeed} from './sourceMapInitialSeed';
import {usesSourceMapMath} from './sourceMapMath';
import {usesSourceSymmetryGradient} from './sourceSymmetryGradient';
import {sourceSymmetryInitialSeed} from './sourceSymmetryConfig';
import {usesSourceSymmetryMath,usesSourceSymmetryGpu,SOURCE_SYMMETRY_GPU_DORMANT_COLOR} from './sourceSymmetryMath';
import {usesSourceSamilaSampling} from './sourceSamilaSampling';
import {usesSourceSamilaTimeline} from './sourceSamilaReplay';
import {usesSamilaSourceProjection,SAMILA_SOURCE_DORMANT_CONTROLS} from './samilaProjection';
import type {SceneDocument,Settings} from '../types';
const ownKeys=['iteratedMode','iteratedCameraModel','sourceCameraProjection','samilaMathModel','symmetryMathModel','mapMathModel','mapParameterModel','symmetryGradientModel','symmetryParameterModel','samilaSamplingModel','samilaSplatModel','samilaSpotSize','samilaUsePaletteLut','samilaProjectionModel','samilaCameraModel','samilaCameraTheta','samilaHistoryModel','batchSize','iterationsPerFrame','iteratedFps','iteratedStartTime','accumulationDecay','alpha','showTrails','trailLifetime','recordTrails','stepMetricMin','stepMetricMax','stepMetricNormalize','colorSpeed','colorPhase','iteratedColor','seed','burnIn','dimension','initialMode','initialRange','initialXMin','initialXMax','initialYMin','initialYMax','initialZMin','initialZMax','escapeRadius','degree','template','deltaPower','start','stop','mapping','projection','rotation','rotationSpeed','scale','scaleX','scaleY','scaleZ','offsetX','offsetY','offsetZ','rotateZ','pointSize','densityProjection','densityView','densityCenterX','densityCenterY','densitySpan','densityPadding'] as const;
/** All state-affecting settings consumed by this owner enter its replay identity.
 * Tone and metadata are evaluated only at presentation, and cannot mutate ink. */
export function inputScene(scene:SceneDocument):SceneDocument {const settings:Settings={},sourceMath=usesSourceSymmetryMath(scene)||usesSourceMapMath(scene),sourceSymmetryGpu=usesSourceSymmetryGpu(scene),source=usesSamilaSourceProjection(scene),sourceClock=usesSourceSamilaTimeline(scene)||usesSourceSymmetryGradient(scene)||usesSourceMapParameters(scene),sourceSampling=usesSourceSamilaSampling(scene);for(const k of ownKeys)if(scene.settings[k]!==undefined&&(!scene.mapSource||!['seed','initialRange','initialZMin','initialZMax'].includes(k))&&(!sourceMath||k!=='escapeRadius')&&(!sourceSymmetryGpu||!(SOURCE_SYMMETRY_GPU_DORMANT_COLOR as readonly string[]).includes(k))&&(!sourceSampling||!['seed','recordTrails'].includes(k))&&(!sourceClock||k!=='iteratedFps')&&(!source||!SAMILA_SOURCE_DORMANT_CONTROLS.includes(k)||['iteratedMode','samilaHistoryModel','densityProjection'].includes(k)))settings[k]=scene.settings[k];return{...scene,settings};}
function facts(scene:SceneDocument,width:number,height:number){return{kind:scene.kind,equations:scene.equations,parameters:scene.parameters,settings:scene.settings,palette:scene.palette,timeline:scene.timeline,sourceCamera:scene.sourceCamera,mapSource:scene.mapSource,mapInitialSeed:scene.mapSource?sourceMapInitialSeed(scene.mapSource):undefined,symmetrySource:scene.symmetrySource,symmetryInitialSeed:scene.symmetrySource?sourceSymmetryInitialSeed(scene.symmetrySource):undefined,width,height};}
export function identity(scene:SceneDocument,width:number,height:number){return JSON.stringify(facts(scene,width,height));}

export function iteratedBaselineKey(scene:SceneDocument):string{return JSON.stringify({id:scene.id,input:facts(inputScene(scene),0,0)});}


/** These continuous families can replay new authored values while their GPU
 * owner retains programs keyed by shader source. Samila has a separate lifetime. */
export function retainsIteratedCompiler(scene:Pick<SceneDocument,'kind'|'settings'>):boolean {return(scene.kind==='map'||scene.kind==='symmetry')&&scene.settings.iteratedMode==='continuous';}
