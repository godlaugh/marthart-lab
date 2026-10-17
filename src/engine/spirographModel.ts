import type {SceneDocument,Settings} from '../types';
import {finite,numberSetting} from './expression';
import {sourceEase} from './sourceEasing';

export type SpirographVersion='local-v1'|'mathart-1.7.8-v1';
/** Omission is the saved 1803 contract, never an implicit migration. */
export function parseSpirographVersion(raw:unknown):SpirographVersion {
  if(raw===undefined||raw==='local-v1')return 'local-v1';
  if(raw==='mathart-1.7.8-v1')return raw;
  throw new Error('未知旋轮行为版本');
}
// Native setters own a float rate; direct generation and timeline evaluation
// must round this input before multiplying by time.
export function spirographSourceRotationRate(raw:unknown):number {return finite(Math.fround(Number(raw??0)),'旋轮角速度');}
export type SpirographPoint=readonly [number,number];
export interface SpirographProjection {
  readonly version:SpirographVersion;
  readonly unit:number;
  readonly strokeScale:number;
  readonly project:(point:SpirographPoint)=>[number,number];
}
/** Canonical chains use +sin. The source circlePoint's -sin is applied once here.
 * Source display: center, viewport, offset, static rotation, runtime rotation, scale.
 * Native pixel units are the default. fit/fixed and axis scales are local extensions;
 * this is not a reproduction of Processing's complete float matrix/raster pipeline. */
export function prepareSpirographProjection(scene:Pick<SceneDocument,'settings'|'evaluatedSpirographRotationRadians'>,time:number,width:number,height:number,bound:number):SpirographProjection {
  finite(time,'时间');const s=scene.settings,version=parseSpirographVersion(s.spirographVersion),source=version!=='local-v1';
  const view=String(s.spiroView??(source?'native':'fit'));
  if(!['fit','fixed',...(source?['native']:[])].includes(view))throw new Error('旋轮视图必须是 fit 或 fixed（源版本另支持 native）');
  const span=view==='fixed'?numberSetting(s,'spiroSpan',bound*2.2,.001,1e9):bound*2.2;
  const unit=view==='native'?1:Math.min(width,height)/span,cx=numberSetting(s,'spiroCenterX',0),cy=numberSetting(s,'spiroCenterY',0),scale=numberSetting(s,'scale',1),axisX=numberSetting(s,'scaleX',1),axisY=numberSetting(s,'scaleY',1),ox=numberSetting(s,'offsetX',0),oy=numberSetting(s,'offsetY',0),rotation=numberSetting(s,'rotation',0),extra=numberSetting(s,'rotateZ',0),rate=numberSetting(s,'rotationSpeed',0);
  if(!source){
    const sx=scale*axisX,sy=scale*axisY,angle=rotation+extra+time*rate,co=Math.cos(angle),si=Math.sin(angle);
    return{version,unit,strokeScale:1,project:([x,y])=>{x*=sx;y*=sy;return[width/2+(x*co-y*si+ox-cx)*unit,height/2-(x*si+y*co+oy-cy)*unit];}};
  }
  const runtime=scene.evaluatedSpirographRotationRadians??time*spirographSourceRotationRate(rate);
  finite(runtime,'旋轮运行时旋转');
  const staticAngle=Math.fround(rotation*Math.PI/180),dynamicAngle=Math.fround(runtime),factor=Math.fround(scale),offsetX=Math.fround(ox),offsetY=Math.fround(oy);
  if(![staticAngle,dynamicAngle,factor,offsetX,offsetY].every(Number.isFinite))throw new Error('旋轮源变换超出 float 范围');
  const c=Math.cos(staticAngle),sn=Math.sin(staticAngle),dc=Math.cos(dynamicAngle+extra),ds=Math.sin(dynamicAngle+extra);
  return{version,unit,strokeScale:Math.abs(factor)*unit,project:([x,y])=>{
    x=Math.fround(x)*factor*axisX;y=-Math.fround(y)*factor*axisY;
    const dx=x*dc-y*ds,dy=x*ds+y*dc;
    return[width/2+(dx*c-dy*sn+offsetX-cx)*unit,height/2+(dx*sn+dy*c+offsetY-cy)*unit];
  }};
}

const clamp=(x:number,a=0,b=1)=>Math.max(a,Math.min(b,x));
export const SPIROGRAPH_SOURCE_FPS=60;
// Matches the maximum saved timeline duration. No full-closure replay is required
// to answer a bounded finish-wait query. State is O(layer count), not O(frames).
export const SPIROGRAPH_SOURCE_MAX_SECONDS=86400;
const DT=Math.fround(1/SPIROGRAPH_SOURCE_FPS),FADE=.6;
export interface SpirographSourceMotionLayer {readonly visible:boolean;readonly enabled:boolean;readonly showGuides:boolean;readonly autoStopOnClosure:boolean;readonly speed:number;readonly closureDegrees:number;}
export interface SpirographSourceProfile {readonly duration:number;readonly endWindow:number;}
export function prepareSpirographSourceProfile(speed:number,closure:number):SpirographSourceProfile {
  const s=Math.max(1e-9,speed),v=s*60,q=s/1.65;
  const adaptive=q>=1?clamp(.85*(1+.2*Math.log(q)),.6,clamp(1+.6*Math.log(q),1,3)):clamp(.85*(1+.75*Math.log(1/q)),.6,1);
  const duration=Math.min(adaptive,Math.max(0,.45*closure/v));
  return{duration,endWindow:Math.min(closure,v*duration*.3633802276324186)};
}
// The complete native easing owner preserves the same float stages as the
// original three SINE transcriptions. Call-site clamp order stays unchanged.
const sineIn=(x:number)=>sourceEase('sine-in',x);
const sineOut=(x:number)=>sourceEase('sine-out',x);
const sineInOut=(x:number)=>sourceEase('sine-in-out',x);
/** Phase arithmetic shared by both explicit clocks. This function does not own
 * queue timing, layer selection, elapsed-state commits or guide fades. In the
 * native frame clock the closing branch does not commit the new elapsed value. */
export function advanceSpirographSourcePhase(layer:SpirographSourceMotionLayer,profile:SpirographSourceProfile,phase:number,elapsed:number,dt:number,startEase:boolean,endEase:boolean):{phase:number;elapsed:number;closed:boolean} {
  const nextElapsed=elapsed+dt;
  const startScale=startEase&&profile.duration>1e-9?sineIn(clamp(nextElapsed/profile.duration)):1;
  const delta=(layer.speed*60)*dt*startScale;let nextPhase=phase+delta;
  if(layer.autoStopOnClosure){
    const remaining=layer.closureDegrees-nextPhase;
    const endScale=!endEase||profile.endWindow<=1e-9||remaining>=profile.endWindow?1:Math.max(.05,1-sineOut(clamp(1-remaining/profile.endWindow)));
    if(endScale<1)nextPhase=phase+delta*endScale;
    nextPhase=Math.min(layer.closureDegrees,nextPhase);
  }
  return{phase:nextPhase,elapsed:nextElapsed,closed:layer.autoStopOnClosure&&nextPhase>=layer.closureDegrees};
}
export interface SpirographSourceFrame {
  readonly frame:number;
  readonly phases:readonly number[];
  readonly startSeconds:readonly (number|null)[];
  readonly endSeconds:readonly (number|null)[];
  readonly geometrySeconds:number|null;
  readonly visualSeconds:number|null;
  readonly guideOpacity:number;
}
interface MotionState {frame:number;phases:number[];elapsed:number[];closed:boolean[];startSeconds:(number|null)[];endSeconds:(number|null)[];active:number;fade:number;finishApplied:boolean;geometrySeconds:number|null;visualSeconds:number|null;}
/** Fixed 60 Hz replay of the retained update algorithm. The original app uses
 * live float dt; this explicit deterministic clock does not claim live-frame parity.
 * Checkpoints contain only whole frames; backward seeks start at the same initial state. */
export function prepareSpirographSourceMotion(layers:readonly SpirographSourceMotionLayer[],settings:Settings):{sample:(seconds:number,isCancelled?:()=>boolean)=>SpirographSourceFrame} {
  const traceStart=numberSetting(settings,'traceStartTime',0,0,1e9),rawFinish=settings.traceFinishTime===undefined?undefined:numberSetting(settings,'traceFinishTime',0,0,1e9),finishAt=rawFinish!==undefined&&rawFinish>=traceStart?rawFinish-traceStart:undefined;
  const profiles=layers.map(l=>prepareSpirographSourceProfile(l.speed,l.closureDegrees)),startEase=settings.startEaseEnabled===true,endEase=settings.endEaseEnabled===true,fadeIn=settings.fadeInStatorsOnStart===true,fadeOut=settings.fadeOutStatorsOnFinish===true&&layers.some(l=>l.visible&&l.showGuides);
  const runnable=(i:number)=>layers[i].visible&&layers[i].enabled;
  const next=(state:MotionState,i:number)=>{while(i<layers.length&&(!runnable(i)||state.closed[i]))i++;return i;};
  const initial=():MotionState=>{const s:MotionState={frame:0,phases:layers.map(()=>0),elapsed:layers.map(()=>0),closed:layers.map(()=>false),startSeconds:layers.map(()=>null),endSeconds:layers.map(()=>null),active:0,fade:0,finishApplied:false,geometrySeconds:null,visualSeconds:null};s.active=next(s,0);if(s.active===layers.length){s.geometrySeconds=0;if(!fadeOut)s.visualSeconds=0;}return s;};
  const finish=(state:MotionState)=>{
    for(let i=state.active;i<layers.length;i++)if(runnable(i)&&layers[i].autoStopOnClosure&&!state.closed[i]){state.phases[i]=layers[i].closureDegrees;state.closed[i]=true;state.startSeconds[i]??=finishAt!;state.endSeconds[i]=finishAt!;}
    // The original parks activeIndex even when an infinite layer remains unclosed.
    // isGeometryFinished scans all layers separately; a wait still needs its deadline.
    state.active=layers.length;state.fade=0;state.finishApplied=true;
    state.geometrySeconds=next(state,0)===layers.length?finishAt!:null;
    state.visualSeconds=state.geometrySeconds!==null&&!fadeOut?finishAt!:null;
  };
  let checkpoint=initial();
  const clone=(state:MotionState):MotionState=>({...state,phases:[...state.phases],elapsed:[...state.elapsed],closed:[...state.closed],startSeconds:[...state.startSeconds],endSeconds:[...state.endSeconds]});
  // A renderer asks for current time and an older fixed clear event. Keep four
  // whole-frame queries plus the high-water checkpoint so an old query cannot
  // turn every following frame into a replay from the start. Partial finish-event
  // views are never cached as if their event preceded the whole-frame boundary.
  const snapshots=new Map<number,MotionState>();
  return{sample:(seconds,isCancelled)=>{
    if(isCancelled?.()){const e=new Error('旋轮源回放已取消');e.name='AbortError';throw e;}
    finite(seconds,'旋轮回放时间');if(seconds>SPIROGRAPH_SOURCE_MAX_SECONDS)throw new Error('旋轮源回放超过文档 86400 秒容量');
    const target=Math.floor(Math.max(0,seconds)*SPIROGRAPH_SOURCE_FPS);
    let state=checkpoint;
    if(target<checkpoint.frame){
      let nearest:MotionState|undefined;for(const saved of snapshots.values())if(saved.frame<=target&&(!nearest||saved.frame>nearest.frame))nearest=saved;
      state=nearest?clone(nearest):initial();
    }
    while(state.frame<target){
      if((state.frame&255)===0&&isCancelled?.()){const e=new Error('旋轮源回放已取消');e.name='AbortError';throw e;}
      if(state.visualSeconds!==null&&state.frame*DT>=FADE){
        if(finishAt===undefined||state.finishApplied||finishAt>target/SPIROGRAPH_SOURCE_FPS){state.frame=target;break;}
        state.frame=Math.max(state.frame,Math.min(target,Math.floor(finishAt*SPIROGRAPH_SOURCE_FPS)));if(state.frame===target)break;
      }
      const at=(state.frame+1)/SPIROGRAPH_SOURCE_FPS;
      if(finishAt!==undefined&&!state.finishApplied&&finishAt<at)finish(state);
      state.frame++;
      if(state.active<layers.length){
        const i=state.active,l=layers[i],p=profiles[i];if(state.startSeconds[i]===null)state.startSeconds[i]=(state.frame-1)/SPIROGRAPH_SOURCE_FPS;
        const advanced=advanceSpirographSourcePhase(l,p,state.phases[i],state.elapsed[i],DT,startEase,endEase);
        if(advanced.closed){state.closed[i]=true;state.endSeconds[i]=at;state.active=next(state,i+1);if(state.active===layers.length)state.geometrySeconds=at;}
        state.phases[i]=advanced.phase;state.elapsed[i]=advanced.elapsed;
      }
      // The native update includes this frame's dt when the last layer closes.
      if(state.active===layers.length){
        if(fadeOut)state.fade=Math.min(FADE,state.fade+DT);
        if(state.geometrySeconds!==null&&state.visualSeconds===null&&(!fadeOut||state.fade>=FADE))state.visualSeconds=at;
      }
    }
    if(state.frame>=checkpoint.frame)checkpoint=state;
    snapshots.delete(state.frame);snapshots.set(state.frame,clone(state));while(snapshots.size>4)snapshots.delete(snapshots.keys().next().value!);
    if(finishAt!==undefined&&!state.finishApplied&&seconds>=finishAt){state=clone(state);finish(state);}
    const inputOpacity=fadeIn?sineInOut(Math.min(FADE,state.frame*DT)/FADE):1;
    const outputOpacity=fadeOut?Math.fround(1-sineInOut(state.fade/FADE)):1;
    return{frame:state.frame,phases:[...state.phases],startSeconds:[...state.startSeconds],endSeconds:[...state.endSeconds],geometrySeconds:state.geometrySeconds,visualSeconds:state.visualSeconds,guideOpacity:Math.fround(inputOpacity*outputOpacity)};
  }};
}
