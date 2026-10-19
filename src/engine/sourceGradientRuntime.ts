import type {DomainSourceInterpolation} from './domainSourcePalette';
import type {SourceSurfaceGradientMode} from './sourceSurfaceGradient';

/** Shared native arithmetic for targets whose three starting offset getters
 * all return their primary offset (Roots, Surface and Attractor). Target application and
 * scene update scheduling remain with those owners. */
export interface SourceGradientConfiguration {readonly mode:SourceSurfaceGradientMode;readonly interpolation:DomainSourceInterpolation;readonly speed:number;}
export interface SourceGradientFrame {readonly palette:number;readonly inside:number;readonly outside:number;}
export interface SourceGradientSnapshot {
 readonly running:boolean;readonly progress:number;readonly speedScale:number;readonly targetSpeed:number;readonly base:number;
 readonly config?:SourceGradientConfiguration;
}
export const sourceGradientWrap=(value:number)=>{const r=value%1;return r<0?r+1:r;};
function shape(value:number,interpolation:DomainSourceInterpolation):number {
 const u=sourceGradientWrap(value);if(interpolation==='linear')return u;if(u<=0)return 0;if(u>=1)return 1;
 return interpolation==='oklch'?((u*u)*u)*(u*(u*6-15)+10):(u*u)*(3-2*u);
}
const wave=(p:number,f:number,phase:number)=>Math.sin((p*f+phase)*6.283185307179586);
export function sourceGradientFrame(base:number,config:SourceGradientConfiguration,progress:number):SourceGradientFrame {
 let palette=base,inside=base,outside=base;
 const shaped=shape(config.mode==='offset_cycle'?sourceGradientWrap(progress):progress,config.interpolation);
 if(config.mode==='hue_rotate')palette=base+shaped;
 else if(config.mode==='offset_cycle'){
  const d=wave(progress,.5,0)*.05;inside=(base+shaped)+d;outside=(base+shaped)-d*.5;
 }else if(config.mode==='cross_fade'){
  const d=(.5+.5*wave(progress,1,.25))*.08;inside=(base+shaped)-d;outside=(base+shaped)+d;palette=base+shaped;
 }else{
  const d=wave(progress,.75,.35)*.06;inside=(base+shaped)-d;outside=(base+shaped)+d;palette=base+shaped;
 }
 return{palette,inside,outside};
}
export function sourceGradientFrameAtAge(snapshot:SourceGradientSnapshot,age:number):SourceGradientFrame {
 if(!snapshot.config)throw new Error('源渐变没有可采样的运行配置');
 const p=!snapshot.running||age<=0?snapshot.progress:sourceGradientWrap(snapshot.progress-((snapshot.targetSpeed*snapshot.speedScale)*age)/360);
 if(!Number.isFinite(p))throw new Error('源渐变历史进度产生非有限值');
 return sourceGradientFrame(snapshot.base,snapshot.config,p);
}
export type SourceGradientAction={readonly kind:'start';readonly config:SourceGradientConfiguration}|{readonly kind:'stop'};
interface Child {action:SourceGradientAction;finished:boolean;startScale:number;}
export class SourceGradientRuntime {
 private active=false;private progress=0;private speedScale=0;private targetSpeed=0;private base=0;
 private configuration?:SourceGradientConfiguration;private children:Child[]=[];
 constructor(private readonly readBase:()=>number,private readonly apply:(frame:SourceGradientFrame,config:SourceGradientConfiguration)=>void){}
 get running(){return this.active;}
 get config(){return this.configuration;}
 snapshot():SourceGradientSnapshot{return Object.freeze({running:this.active,progress:this.progress,speedScale:this.speedScale,targetSpeed:this.targetSpeed,base:this.base,config:this.configuration});}
 private applyFrame(){if(this.active)this.apply(sourceGradientFrame(this.base,this.configuration!,this.progress),this.configuration!);}
 private scale(value:number){
  if(!Number.isFinite(value))throw new Error('源渐变速度倍率产生非有限值');
  this.speedScale=value<0?0:value;this.applyFrame();
 }
 begin(actions:readonly SourceGradientAction[]):void {
  // AnimationGroup starts ALL children before updating any. Callback count
  // matters because Surface smooths every applied frame, even unchanged phases.
  this.children=actions.map(action=>{
   if(action.kind==='stop')return{action,finished:!this.active,startScale:this.speedScale};
   this.base=this.readBase();this.configuration=Object.freeze({...action.config});this.progress=0;this.active=true;this.speedScale=0;this.targetSpeed=action.config.speed;
   this.applyFrame();this.scale(0);return{action,finished:false,startScale:0};
  });
 }
 interpolate(eased:number,finish:boolean):void {
  for(const child of this.children){
   if(child.finished)continue;
   this.scale(child.action.kind==='start'?eased:child.startScale*(1-eased));
   if(finish){
    if(child.action.kind==='start')this.scale(1);
    else{this.scale(0);this.active=false;this.targetSpeed=0;this.speedScale=0;}
    child.finished=true;
   }
  }
 }
 update(dt:number):void {
  if(!this.active)return;
  if(dt>0){const progress=this.progress+((this.targetSpeed*this.speedScale)*dt)/360;if(!Number.isFinite(progress))throw new Error('源渐变进度产生非有限值');this.progress=sourceGradientWrap(progress);}
  this.applyFrame();
 }
 frameAtAge(age:number):SourceGradientFrame {
  return sourceGradientFrameAtAge(this.snapshot(),age);
 }
}
