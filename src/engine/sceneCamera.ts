import {usesSourceSurfaceParticles} from './sourceSurfaceParticles';
import {ordinarySourceCameraGeometry} from './ordinarySourceCamera';
import {samilaCameraEnabled,initializeSamilaCameraFrame,refreshSamilaCameraSetting} from './samilaCamera';
import type {CameraState,EvaluatedCamera,SceneDocument,Settings,SceneOutput} from '../types';
import {numberSetting} from './expression';
export const isRaymarchScene=(scene:Pick<SceneDocument,'kind'|'settings'>)=>scene.kind==='fractal'&&scene.settings.formula==='mandelbulb_3d'&&scene.settings.bulbPresentation!=='points';
export const hasContinuousDensity=(scene:Pick<SceneDocument,'kind'|'settings'>)=>['map','symmetry','samila'].includes(scene.kind)&&scene.settings.iteratedMode==='continuous';
export const hasProgressiveRoots=(scene:Pick<SceneDocument,'kind'|'settings'>)=>scene.kind==='roots'&&scene.settings.rootsMode==='progressive';
export const hasMathematicalPlane=(scene:Pick<SceneDocument,'kind'|'settings'>)=>scene.kind==='domain'||scene.kind==='fractal'&&scene.settings.formula!=='mandelbulb_3d'||scene.kind==='bouncing'&&scene.settings.bouncingPresentation==='raster'||hasContinuousDensity(scene)||hasProgressiveRoots(scene);
type CameraCapabilities=Pick<SceneDocument,'kind'|'settings'>&Partial<Pick<SceneDocument,'sourceCamera'>>;
/** Explicit authored marker; never infer source semantics from a scene family. */
export const usesOrdinarySourceCamera=(scene:CameraCapabilities)=>scene.sourceCamera!==undefined;
const ordinaryMethods=new Set(['rotateTheta','rotatePhi','rotateGamma','rotateTo','zoom','focal','ambient','stopAmbient','stopTracking']);
export const supportsCameraActions=(scene:CameraCapabilities)=>usesOrdinarySourceCamera(scene)?ordinarySourceCameraGeometry(scene):!hasMathematicalPlane(scene);
/** Scalar-camera families opt into specific components, never the full orbit. */
export const supportsCameraAction=(scene:CameraCapabilities,method:string)=>usesOrdinarySourceCamera(scene)?ordinarySourceCameraGeometry(scene)&&(ordinaryMethods.has(method)||method==='track'&&supportsParticleTracking(scene)):supportsCameraActions(scene)||samilaCameraEnabled(scene)&&['rotateTheta','rotateTo','ambient','stopAmbient'].includes(method);
export const supportsCameraComponent=(scene:CameraCapabilities,axis:string)=>usesOrdinarySourceCamera(scene)?ordinarySourceCameraGeometry(scene)&&['phi','theta','gamma'].includes(axis):supportsCameraActions(scene)||samilaCameraEnabled(scene)&&axis==='theta';
export const supportsCameraTarget=(scene:CameraCapabilities,target:string)=>!target.startsWith('camera.')||!usesOrdinarySourceCamera(scene)&&(supportsCameraActions(scene)||samilaCameraEnabled(scene)&&target==='camera.theta');
/** Indexed targets use mathematical identities, never compacted display indices
 * or coordinates inferred from a projected density image. */
export const supportsParticleTracking=(scene:CameraCapabilities)=>usesOrdinarySourceCamera(scene)?usesSourceSurfaceParticles(scene): (scene.kind==='surface'||scene.kind==='attractor'&&scene.settings.simulationMode==='continuous'&&scene.settings.presentation!=='density');
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
const finite=(v:number,name:string)=>{if(!Number.isFinite(v))throw new Error(`${name} 必须有限`);return v;};
const copy=(c:CameraState):CameraState=>({...c,position:[...c.position],target:[...c.target]});
/** Editable orbit settings own the baseline; evaluated camera owns a frame after
 * timeline actions. Neither is inferred from the carrier plane's camera. */
export function parseBulbCameraSettings(settings:Settings):{yaw:number;pitch:number;zoom:number}{return{yaw:numberSetting(settings,'bulbCameraYaw',0,-1e6,1e6),pitch:numberSetting(settings,'bulbCameraPitch',.78,-1.55,1.55),zoom:clamp(numberSetting(settings,'zoom',1,1e-6,1e28),.05,12)};}
export function initialBulbCamera(settings:Settings,time:number):EvaluatedCamera{
 finite(time,'时间');const view=parseBulbCameraSettings(settings),speed=numberSetting(settings,'bulbRotationSpeed',.05,-100,100),rotation=numberSetting(settings,'rotation',0,-1e6,1e6),yaw=finite(view.yaw+time*speed*.45+rotation*.35,'相机方位')%(2*Math.PI),radius=numberSetting(settings,'bulbCameraRadius',3.2,.01,1000);
 return{model:'mandelbulb',time,camera:{position:[radius*Math.cos(yaw)*Math.cos(view.pitch),radius*Math.sin(view.pitch),radius*Math.sin(yaw)*Math.cos(view.pitch)],target:[0,0,0],zoom:view.zoom,orthographic:false,autoFit:false},roll:numberSetting(settings,'cameraGamma',0,-1e6,1e6),focalLength:numberSetting(settings,'cameraFocalLength',35,.000001,1e6),rayScale:numberSetting(settings,'bulbRayScale',3,.1,10)};
}
export function validateEvaluatedCamera(value:EvaluatedCamera):EvaluatedCamera{
 if(!value||value.model!=='mandelbulb'||!Number.isFinite(value.time))throw new Error('数学摄影机帧无效');const c=value.camera;
 if(!c||!Array.isArray(c.position)||!Array.isArray(c.target)||c.position.length!==3||c.target.length!==3||![...c.position,...c.target].every(Number.isFinite))throw new Error('数学摄影机坐标无效');
 if(!Number.isFinite(c.zoom)||c.zoom<=0||!Number.isFinite(value.roll)||!Number.isFinite(value.focalLength)||value.focalLength<=0||value.focalLength>1e6||!Number.isFinite(value.rayScale)||value.rayScale<.1||value.rayScale>10)throw new Error('数学摄影机光学参数无效');
 if(Math.hypot(...c.position.map((v,i)=>v-c.target[i]))<1e-12)throw new Error('摄影机位置不能与焦点重合');return value;
}
export function initializeEvaluatedCamera(scene:SceneDocument,time:number){delete scene.evaluatedCamera;initializeSamilaCameraFrame(scene,time);if(isRaymarchScene(scene))scene.evaluatedCamera=initialBulbCamera(scene.settings,time);}
export function cloneEvaluatedCamera(frame:EvaluatedCamera):EvaluatedCamera{return{...frame,camera:copy(frame.camera)};}
/** Later camera-setting writes replace the orbit baseline at the same sample
 * time, exactly as later camera actions replace earlier component values. */
export function refreshCameraSetting(scene:SceneDocument,key:string){
 refreshSamilaCameraSetting(scene,key);
 if(!isRaymarchScene(scene))return;
 if(['bulbCameraYaw','bulbCameraPitch','bulbCameraRadius','bulbRayScale','bulbRotationSpeed','rotation','zoom','cameraGamma','cameraFocalLength'].includes(key))scene.evaluatedCamera=initialBulbCamera(scene.settings,scene.evaluatedCamera?.time??0);
}
export function sceneCamera(scene:SceneDocument):{camera:CameraState;roll:number;focalLength:number}{
 if(isRaymarchScene(scene)){const frame=validateEvaluatedCamera(scene.evaluatedCamera??initialBulbCamera(scene.settings,0));return{camera:frame.camera,roll:frame.roll,focalLength:frame.focalLength};}
 return{camera:scene.camera,roll:numberSetting(scene.settings,'cameraGamma',0),focalLength:numberSetting(scene.settings,'cameraFocalLength',35,.000001,1e6)};
}
/** Consumers use the camera paired with the delivered mathematical frame, even
 * while the UI clock is already requesting a later frame. */
export function outputCamera(scene:SceneDocument,output?:SceneOutput|null):{camera:CameraState;roll:number;focalLength:number}{
 return output?.cameraFrame??sceneCamera(scene);
}
export function writableSceneCamera(scene:SceneDocument):CameraState{if(isRaymarchScene(scene)){scene.evaluatedCamera??=initialBulbCamera(scene.settings,0);return scene.evaluatedCamera.camera;}return scene.camera;}
export function writeCameraOptics(scene:SceneDocument,key:'gamma'|'focalLength',value:number){finite(value,key);if(key==='focalLength'&&(value<=0||value>1e6))throw new Error('焦距必须在 0–1000000 内');if(isRaymarchScene(scene)){scene.evaluatedCamera??=initialBulbCamera(scene.settings,0);if(key==='gamma')scene.evaluatedCamera.roll=value;else scene.evaluatedCamera.focalLength=value;}else scene.settings[key==='gamma'?'cameraGamma':'cameraFocalLength']=value;}
