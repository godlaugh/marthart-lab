import type {SceneDocument} from '../types';
import {resolveSourceCamera,SOURCE_CAMERA_MODEL,type SourceCameraScalars} from './sourceCamera';
import {samilaCameraEnabled,parseSamilaCamera} from './samilaCamera';
import {OrdinarySourceCameraTimelineSession,resolveOrdinarySourceCameraTimeline,type OrdinarySourceCameraFrame} from './ordinarySourceCameraTimeline';
import {SourceSamilaParameterRuntime} from './sourceSamilaParameterRuntime';
export const SAMILA_SCENE_SEQUENCE='samila-scene-sequence-v1' as const;
export function usesSourceSamilaTimeline(scene:Pick<SceneDocument,'kind'|'settings'|'timeline'>):boolean {
 if(scene.timeline.schedule!==SAMILA_SCENE_SEQUENCE)return false;
 if(scene.kind!=='samila'||!samilaCameraEnabled(scene))throw Error('源 Samila 时间线需要持续批次与锚定 theta 相机');return true;
}
function initialCamera(scene:SceneDocument):SourceCameraScalars {
 const parsed=resolveSourceCamera({model:SOURCE_CAMERA_MODEL,configuration:{kind:'absent'}});
 if(!parsed.ok||parsed.value.kind!=='known')throw Error('源 Samila 相机默认值不可用');
 const theta=Math.fround(parseSamilaCamera(scene).theta);if(!Number.isFinite(theta))throw Error('源 Samila 起始 theta 超出 Float32');
 return{...parsed.value.state.value,center:[...parsed.value.state.value.center],theta};
}
export interface SourceSamilaFrame extends OrdinarySourceCameraFrame {readonly parameters:Record<string,number>;readonly parameterWrites:number;readonly parameterWriteRevision:number;}
const frames=new WeakMap<SceneDocument,SourceSamilaFrame>();
/** Transient evaluated facts never enter serialized documents or identities. */
export function sourceSamilaFrame(scene:SceneDocument):SourceSamilaFrame|undefined{return frames.get(scene);}
export function bindSourceSamilaFrame(scene:SceneDocument,frame:SourceSamilaFrame):void {frames.set(scene,frame);}
interface Owner {session:OrdinarySourceCameraTimelineSession;runtime?:SourceSamilaParameterRuntime;work:number;writesBeforeFrame:number;frameWrites:number;frameIndex:number;}
interface Owners {zero?:Owner;forward:Owner[];}
const owners=new Map<string,Owners>();
const WORK_LIMIT=2_000_000;
export function clearSourceSamilaReplayCache():void {for(const group of owners.values())for(const owner of [...group.forward,...(group.zero?[group.zero]:[])])owner.session.reset();owners.clear();}
function identity(scene:SceneDocument):string {return JSON.stringify([scene.settings.samilaCameraTheta??0,scene.parameters,scene.timeline],(_key,value)=>typeof value==='number'?{number:Object.is(value,-0)?'-0':String(value)}:value);}
function createOwner(scene:SceneDocument):Owner {
 let owner:Owner;
 const initial={...scene.parameters};
 const reserve=(units:number)=>{owner.work+=units;if(!Number.isSafeInteger(owner.work)||owner.work>WORK_LIMIT)throw Error('源 Samila 参数回放超过 200 万工作预算');};
 const session=new OrdinarySourceCameraTimelineSession(initialCamera(scene),scene.timeline.tracks,scene.timeline.fps,{particleActions:'samila',createParticles(){
  const runtime=owner.runtime=new SourceSamilaParameterRuntime(initial,reserve);owner.writesBeforeFrame=0;owner.frameWrites=0;
  return{bind(){throw Error('源 Samila 不支持粒子跟踪');},beginSamilaParameterActions:(actions,duration,easing)=>runtime.begin(actions,duration,easing),advanceSamilaParameterActions:dt=>runtime.advanceChildren(dt),update:frame=>runtime.update(frame.deltaTime),displayFrame(){const total=runtime.writeRevision;owner.frameWrites=total-owner.writesBeforeFrame;owner.writesBeforeFrame=total;}};
 }});
 owner={session,work:0,writesBeforeFrame:0,frameWrites:0,frameIndex:-1};return owner;
}
export function replaySourceSamilaTimeline(scene:SceneDocument,time:number):SourceSamilaFrame {
 if(!usesSourceSamilaTimeline(scene))throw Error('未启用源 Samila 时间线');
 const key=identity(scene),cacheable=key.length<=1_000_000,target=Math.floor(time*scene.timeline.fps+1e-9);
 const group=(cacheable?owners.get(key):undefined)??{forward:[]};
 let owner:Owner;
 // Display requests look ahead before density asks for frame zero and its next
 // batch. Keep zero separate and two bounded forward lanes, not growing frames.
 if(target===0)owner=group.zero??(group.zero=createOwner(scene));
 else{
  const candidates=group.forward.filter(value=>value.frameIndex<=target).sort((a,b)=>b.frameIndex-a.frameIndex);
  if(candidates.length)owner=candidates[0];
  else if(group.forward.length<2){owner=createOwner(scene);group.forward.push(owner);}
  else{owner=group.forward.reduce((a,b)=>a.frameIndex<b.frameIndex?a:b);owner.session.reset();owner.frameIndex=-1;}
 }
 owner.work=0;
 try{
  const frame=owner.session.evaluate(time),snapshot=owner.runtime!.snapshot();owner.frameIndex=frame.frameIndex;
  if(cacheable){owners.delete(key);owners.set(key,group);while(owners.size>4){const first=owners.keys().next().value!,old=owners.get(first)!;for(const entry of [...old.forward,...(old.zero?[old.zero]:[])])entry.session.reset();owners.delete(first);}}
  return{...frame,parameters:snapshot.parameters,parameterWrites:owner.frameWrites,parameterWriteRevision:snapshot.writeRevision};
 }catch(error){owner.session.reset();owner.frameIndex=-1;if(cacheable)owners.delete(key);throw error;}

}
export function resolveSourceSamilaTimeline(scene:SceneDocument):SceneDocument['timeline'] {
 if(!usesSourceSamilaTimeline(scene))throw Error('未启用源 Samila 时间线');
 const layout=resolveOrdinarySourceCameraTimeline(initialCamera(scene),scene.timeline.tracks,scene.timeline.fps,{particleActions:'samila'}),byId=new Map(layout.clips.map(clip=>[clip.trackId,clip]));
 return{...scene.timeline,schedule:SAMILA_SCENE_SEQUENCE,duration:Math.max(scene.timeline.duration,layout.span),tracks:scene.timeline.tracks.map(track=>{const clip=byId.get(track.id);return clip?{...track,start:clip.start,duration:clip.duration}:track;})};
}

/** An owned source queue shared by fixed replay and explicit real-dt sessions.
 * Display is separate; parameter constructors and drift retain their lifetime. */
export class SourceSamilaTimelineSession {
 private owner:Owner;
 constructor(scene:SceneDocument,private readonly live=false){this.owner=createOwner(scene);if(live)this.owner.session.snapshot();}
 private facts(frame:OrdinarySourceCameraFrame):SourceSamilaFrame {const snapshot=this.owner.runtime!.snapshot();return{...frame,parameters:snapshot.parameters,parameterWrites:this.owner.frameWrites,parameterWriteRevision:snapshot.writeRevision};}
 evaluate(time:number):SourceSamilaFrame {this.owner.work=0;return this.facts(this.owner.session.evaluate(time));}
 snapshot():SourceSamilaFrame {return this.facts(this.owner.session.snapshot());}
 step(dt:number,paused:boolean):SourceSamilaFrame {this.owner.work=0;return this.facts(this.owner.session.step(dt,{paused}));}
 reconstruct(time:number):SourceSamilaFrame {this.owner.work=0;return this.facts(this.owner.session.reconstruct(time));}
 writeParameter(name:string,value:number):void {if(!this.owner.runtime){if(this.live)this.snapshot();else this.evaluate(0);}this.owner.runtime!.write(name,value);}
 writeTheta(theta:number):void {this.writeAngles({theta});}
 writeAngles(angles:Partial<Pick<SourceCameraScalars,'phi'|'theta'|'gamma'>>):void {if(!this.owner.runtime){if(this.live)this.snapshot();else this.evaluate(0);}this.owner.session.writeAngles(angles);}
 reset():void{this.owner.session.reset();this.owner.runtime=undefined;this.owner.work=0;this.owner.frameWrites=0;this.owner.writesBeforeFrame=0;}
}

/** Queue layout shares the ordinary source clock; it does not draw or consume seeds. */
export function sourceSamilaRecordingLayout(scene:SceneDocument,fps:number){if(!usesSourceSamilaTimeline(scene))throw Error('Samila 录制需要源队列');return resolveOrdinarySourceCameraTimeline(initialCamera(scene),scene.timeline.tracks,fps,{particleActions:'samila'});}
