import type {SceneDocument,SpirographFrameRequest} from '../types';
import {prepareSpirograph} from '../scenes/spirograph';
import {prepareSpirographReplay,type PreparedSpirographReplay,type SpirographReplayFrame} from './spirographReplay';
import {parseSpirographFrameEvents,sourceFrameIndex,spirographFrameClips,spirographSimulationFps,usesSpirographFrameClock,type SpirographClipBinding} from './spirographFrameConfig';
import {spirographSourceRotationRate} from './spirographModel';
export interface SpirographRecordingPlan {startFrame:number;fps:number;encodedFrames:number;updates:number;firstEncodedUpdate:number|null;finished:boolean;}

/** One selected authored scene owns one replay plus at most one recording fork.
 * The worker releases this owner on session reset. Main-thread callers use a
 * separate selected-scene owner; no clock state crosses either boundary. */
export class SpirographFrameSession {
  private key='';
  private replay?:PreparedSpirographReplay;
  private recording?:PreparedSpirographReplay;
  private recordingKey='';
  private fps=60;
  private bindings:SpirographClipBinding[]=[];
  private resolved?:SceneDocument['timeline'];
  reset(){this.replay?.dispose();this.recording?.dispose();this.replay=undefined;this.recording=undefined;this.recordingKey='';this.key='';this.bindings=[];this.resolved=undefined;}
  private select(scene:SceneDocument){
    if(!usesSpirographFrameClock(scene))throw new Error('尚未选择旋轮逐帧时钟');
    const fps=spirographSimulationFps(scene);
    const key=JSON.stringify({id:scene.id,settings:scene.settings,timeline:scene.timeline,events:scene.spirographFrameEvents});
    if(this.key===key&&this.replay)return;
    const adapted=spirographFrameClips(scene),geometry=prepareSpirograph(scene.settings),events=parseSpirographFrameEvents(scene.spirographFrameEvents);
    const replay=prepareSpirographReplay({
      layers:geometry.layers.map(info=>({...info.layer,closureDegrees:info.closureTurns!*360})),
      settings:{startEaseEnabled:scene.settings.startEaseEnabled===true,endEaseEnabled:scene.settings.endEaseEnabled===true,fadeInStatorsOnStart:scene.settings.fadeInStatorsOnStart===true,fadeOutStatorsOnFinish:scene.settings.fadeOutStatorsOnFinish===true},
      clips:adapted.clips,clock:{kind:'offline-fixed',fps},initialRate:spirographSourceRotationRate(scene.settings.rotationSpeed),events,
    });
    this.reset();this.key=key;this.replay=replay;this.fps=fps;this.bindings=adapted.bindings;
  }
  sample(scene:SceneDocument,time:number,request?:SpirographFrameRequest,isCancelled?:()=>boolean):SpirographReplayFrame {
    this.select(scene);
    if(request?.recording){
      const key=JSON.stringify(request.recording);
      if(key!==this.recordingKey){
        const next=this.replay!.forkRecording(request.recording.startFrame,request.recording.fps,isCancelled);
        this.recording?.dispose();this.recording=next;this.recordingKey=key;
      }
      return this.recording!.sample(request.frame,isCancelled);
    }
    return this.replay!.sample(request?.frame??sourceFrameIndex(time,this.fps),isCancelled);
  }
  recordingPlan(scene:SceneDocument,startFrame:number,fps:number,isCancelled?:()=>boolean):SpirographRecordingPlan {
    this.sample(scene,0,{frame:0,recording:{startFrame,fps}},isCancelled);
    const result=this.recording!.schedule(86400*fps,isCancelled);
    if(!result.recordingFinished)throw new Error('旋轮录制队列在 86400 秒帧容量内尚未结束');
    return{startFrame,fps,encodedFrames:result.encodedFrames,updates:result.frame,firstEncodedUpdate:result.encodedFrames?2:null,finished:true};
  }
  timeline(scene:SceneDocument,isCancelled?:()=>boolean):SceneDocument['timeline'] {
    this.select(scene);
    if(!this.resolved){
      const nominal=scene.timeline.duration;
      if(!Number.isFinite(nominal)||nominal<=0||nominal>86400)throw new Error('时间线时长必须在 (0,86400] 秒');
      const schedule=this.replay!.schedule(86400*this.fps,isCancelled);
      if(!schedule.finished||schedule.queueCompleteFrame===null)throw new Error('旋轮源队列在 86400 秒帧容量内尚未结束；不能确认完整时间线');
      const byTrack=new Map(this.bindings.map(binding=>[binding.trackIndex,schedule.clips[binding.clipIndex]]));
      const duration=Math.max(nominal,schedule.queueCompleteFrame/this.fps);
      const {schedule:_schedule,...authored}=scene.timeline;void _schedule;
      this.resolved={...authored,duration,tracks:scene.timeline.tracks.map((track,index)=>{
        const fact=byTrack.get(index);
        return{...track,start:fact?.startFrame===null||fact?.startFrame===undefined?0:(fact.startFrame-1)/this.fps,duration:fact?.endFrame===null||fact?.endFrame===undefined||fact.startFrame===null?0:(fact.endFrame-fact.startFrame+1)/this.fps};
      })};
    }
    return{...this.resolved,tracks:this.resolved.tracks.map(track=>({...track}))};
  }
}
export const interactiveSpirographFrames=new SpirographFrameSession();

export function withSpirographReplayFrame(scene:SceneDocument,frame:SpirographReplayFrame):SceneDocument {
  return{...scene,settings:{...scene.settings},evaluatedSpirographRotationRadians:frame.rotationRadians,evaluatedSpirographFrame:frame};
}

/** Frame facts are transient. Authored degrees, source inputs and queue lengths
 * remain untouched, and the raster producer consumes these exact motion facts. */
export function sceneAtSpirographFrame(scene:SceneDocument,time:number,request?:SpirographFrameRequest,session=interactiveSpirographFrames,isCancelled?:()=>boolean):SceneDocument {
  const frame=session.sample(scene,time,request,isCancelled);
  return withSpirographReplayFrame(scene,frame);
}
