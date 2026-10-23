import type {SceneDocument} from '../types';
import {parseRootsPresentationConfiguration,type RootsPresentationConfiguration} from './rootsPresentationConfig';
import {withRootsMathModel} from './rootsMathConfig';

export function usesRootsNativePresentation(scene:Pick<SceneDocument,'kind'|'rootsPresentation'>):boolean {
 return scene.kind==='roots'&&scene.rootsPresentation?.model==='mathart-1.7.8-v1';
}
/** Explicit authoring action. Enabling spatial presentation selects its source
 * math and color contracts together; dormant local formulas/palette survive. */
export function withRootsPresentation(scene:SceneDocument,configuration:RootsPresentationConfiguration):SceneDocument {
 if(scene.kind!=='roots')throw new Error('Roots presentation requires a Roots scene');
 const rootsPresentation=parseRootsPresentationConfiguration(configuration);
 if(rootsPresentation.model==='local-v1')return{...scene,rootsPresentation};
 const source=withRootsMathModel(scene,'mathart-1.7.8-v1');
 return{...source,rootsPresentation,settings:{...source.settings,rootsMode:'progressive',rootDensityColorVersion:'mathart-1.7.8-metric-v1'}};
}
/** These local plane controls are dormant under the explicit spatial profile. */
const legacyControls=new Set(['rootsMode','rootDensityBackend','rootSplat','rootSplatDiameter','rootScale','rootScaleY','rootOffsetX','rootOffsetY','rootOffsetZ','depthScale','rotation','rootRender','rootDisplayParameter','filter','densityView','densityCenterX','densityCenterY','densitySpan','densityProjection','densityPadding','densityAccumulation','densityLifetime','densitySamplingFps','densitySampleRate','densityDecay']);
export function rootsPresentationControlVisible(scene:Pick<SceneDocument,'kind'|'rootsPresentation'>,key:string):boolean {
 if(scene.rootsPresentation?.previewMode==='live-worker-arrival-v1'&&['rootSamplesPerFrame','rootSamplingFps','rootStartTime'].includes(key))return false;
 return !usesRootsNativePresentation(scene)||!legacyControls.has(key);
}
export type RootsPresentationCommit=(expected:SceneDocument,next:RootsPresentationConfiguration,begin:boolean)=>SceneDocument|undefined;
/** Local pointer mapping into the source camera's authored radians/zoom. This
 * does not claim the native host's mouse acceleration or event granularity. */
export function navigateRootsPresentation(configuration:RootsPresentationConfiguration,action:{kind:'rotate';dx:number;dy:number;width:number;height:number}|{kind:'zoom';deltaPixels:number}):RootsPresentationConfiguration {
 const next=parseRootsPresentationConfiguration(configuration);
 if(action.kind==='rotate'){
  if(![action.dx,action.dy,action.width,action.height].every(Number.isFinite)||action.width<=0||action.height<=0)throw new Error('Invalid Roots pointer dimensions');
  next.camera.theta-=action.dx/action.width*Math.PI*2;
  next.camera.phi+=action.dy/action.height*Math.PI;
 }else{
  if(!Number.isFinite(action.deltaPixels))throw new Error('Invalid Roots wheel delta');
  next.camera.zoom*=Math.exp(-action.deltaPixels*.001);
 }
 return parseRootsPresentationConfiguration(next);
}
