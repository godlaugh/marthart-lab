import type {SceneDocument,Settings} from '../types';
const ownKeys=['iteratedMode','iteratedCameraModel','sourceCameraProjection','samilaCameraModel','samilaCameraTheta','samilaHistoryModel','batchSize','iterationsPerFrame','iteratedFps','iteratedStartTime','accumulationDecay','alpha','showTrails','trailLifetime','recordTrails','stepMetricMin','stepMetricMax','stepMetricNormalize','colorSpeed','colorPhase','iteratedColor','seed','burnIn','dimension','initialMode','initialRange','initialXMin','initialXMax','initialYMin','initialYMax','initialZMin','initialZMax','escapeRadius','degree','template','deltaPower','start','stop','mapping','projection','rotation','rotationSpeed','scale','scaleX','scaleY','scaleZ','offsetX','offsetY','offsetZ','rotateZ','pointSize','densityProjection','densityView','densityCenterX','densityCenterY','densitySpan','densityPadding'] as const;
/** All state-affecting settings consumed by this owner enter its replay identity.
 * Tone and metadata are evaluated only at presentation, and cannot mutate ink. */
export function inputScene(scene:SceneDocument):SceneDocument {const settings:Settings={};for(const k of ownKeys)if(scene.settings[k]!==undefined)settings[k]=scene.settings[k];return{...scene,settings};}
function facts(scene:SceneDocument,width:number,height:number){return{kind:scene.kind,equations:scene.equations,parameters:scene.parameters,settings:scene.settings,palette:scene.palette,timeline:scene.timeline,sourceCamera:scene.sourceCamera,width,height};}
export function identity(scene:SceneDocument,width:number,height:number){return JSON.stringify(facts(scene,width,height));}

export function iteratedBaselineKey(scene:SceneDocument):string{return JSON.stringify({id:scene.id,input:facts(inputScene(scene),0,0)});}


/** These continuous families can replay new authored values while their GPU
 * owner retains programs keyed by shader source. Samila has a separate lifetime. */
export function retainsIteratedCompiler(scene:Pick<SceneDocument,'kind'|'settings'>):boolean {return(scene.kind==='map'||scene.kind==='symmetry')&&scene.settings.iteratedMode==='continuous';}
