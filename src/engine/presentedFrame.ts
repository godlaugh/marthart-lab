import type {SceneDocument} from '../types';
/** Identity is the immutable request document object, not its user-visible id.
 * A revision denotes one successful presentation (including camera/resize),
 * not a new mathematical sample, a new pixel image, or an encoded video frame. */
export interface PresentedFrame {
 source:SceneDocument;scene:SceneDocument;sceneTime:number;revision:number;
}
const cameraAnimated=(scene:SceneDocument)=>scene.timeline.tracks.some(track=>track.enabled&&track.target.startsWith('camera.'));
/** Keep fitted/manual views during ordinary generation, but consume completed
 * same-id camera edits and restore the base camera when camera actions vanish. */
export function applyPresentedCamera(previous:PresentedFrame|null,source:SceneDocument,hasCameraFrame:boolean,resolved:boolean):boolean{
 if(resolved)return false;
 if(hasCameraFrame||cameraAnimated(source))return true;
 if(!previous||previous.source.id!==source.id)return !source.camera.autoFit;
 if(cameraAnimated(previous.source))return true;
 const before=previous.source.camera,after=source.camera;
 return before.zoom!==after.zoom||before.orthographic!==after.orthographic||before.position.some((n,i)=>n!==after.position[i])||before.target.some((n,i)=>n!==after.target[i]);
}
export class PresentedFrameOwner {
 private value:PresentedFrame|null=null;
 private revision=0;
 present(source:SceneDocument,scene:SceneDocument,sceneTime:number){
  if(!Number.isFinite(sceneTime)||sceneTime<0)throw new Error('已呈现帧时间无效');
  this.value={source,scene,sceneTime,revision:++this.revision};
 }
 appearance(scene?:SceneDocument){if(this.value)this.value={...this.value,scene:scene??this.value.scene,revision:++this.revision};}
 clear(){this.value=null;}
 read(){return this.value;}
}
