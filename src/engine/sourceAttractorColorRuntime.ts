import {sourceColorLerp,type DomainSourceInterpolation} from './domainSourcePalette';
import {prepareSourceAttractorInitialColors,type SourceAttractorPalette} from './sourceAttractorVisualConfig';
import {writeSourcePackedColor} from './sourceProcessingGeometry';
import {SourceGradientRuntime,type SourceGradientAction,type SourceGradientFrame,type SourceGradientSnapshot} from './sourceGradientRuntime';
import type {SourceSurfaceGradientMode} from './sourceSurfaceGradient';

const F=Math.fround,MAX_WORK=20_000_000;
type PaletteState={primary:number;secondary:number;blend:number};
const constrain=(v:number,lo:number,hi:number)=>v<lo?lo:v>hi?hi:v;
const integer=(v:number)=>Number.isNaN(v)?0:Math.max(-2147483648,Math.min(2147483647,Math.trunc(v)));
const phase=(v:number)=>F(v-F(integer(Math.floor(v))));
function softGap(a:number,b:number,maximum:number){
 const delta=F(Math.abs(F(phase(a)-phase(b)))),gap=Math.min(delta,F(1-delta));
 const u=F(constrain(gap,0,F(.5))/F(.5));
 return constrain(F(F(F(u*u)*F(3-F(2*u)))*maximum),0,maximum);
}
function target(frame:SourceGradientFrame,mode:SourceSurfaceGradientMode):PaletteState {
 const p=F(frame.palette),i=F(frame.inside),o=F(frame.outside),average=F(F(.5)*F(i+o));
 if(mode==='hue_rotate')return{primary:p,secondary:p,blend:0};
 if(mode==='offset_cycle')return{primary:average,secondary:average,blend:0};
 return{primary:mode==='cross_fade'?average:p,secondary:o,blend:softGap(i,o,F(mode==='cross_fade'?.38:.30))};
}
function shifted(palette:readonly number[],coordinate:number,offset:number,running:boolean):number {
 if(palette.length===1)return palette[0];
 const u=phase(F(coordinate+phase(offset))),position=F(u*F(running?palette.length:palette.length-1));
 const index=Math.min(integer(position),palette.length-(running?1:2)),fraction=F(position-F(index));
 if(index<0||index>=palette.length||!Number.isFinite(fraction))throw new Error('原版吸引子色板采样超出可表示范围');
 // StrangeAttractor.sampleShiftedPalette's cyclic branch calls ManimColors.lerp
 // directly, even when the selected cross-palette interpolation is not RGB.
 return sourceColorLerp(palette[index],palette[running?(index+1)%palette.length:index+1],fraction,'rgb');
}
export class SourceAttractorColorError extends Error {
 constructor(readonly code:'input'|'capacity'|'cancelled',message:string){super(message);this.name=code==='cancelled'?'AbortError':'SourceAttractorColorError';}
}
export interface SourceAttractorColorOptions {
 readonly count:number;readonly nativeBackend:'cpu'|'gpu';readonly showTrails:boolean;
 readonly palette?:SourceAttractorPalette;readonly reserve?:(units:number)=>void;readonly isCancelled?:()=>boolean;
}
export interface SourceAttractorColorSnapshot {
 readonly packed:Uint32Array;readonly colors:Float32Array;readonly alphas:Float32Array;
 readonly gradient:SourceGradientSnapshot;readonly state:Readonly<PaletteState>;
 readonly diagnostics:readonly string[];readonly workUnits:number;
}
/** StrangeAttractor's current per-slot col/baseCol owner. Borrowed arrays below
 * keep their identity for the particle/trail owner; consumers must only read
 * them and must not transfer them. snapshot() publishes detached copies.
 * CPU trails gate is fixed for this source object's configuration lifetime.
 * Historical trails read current packed colors, never Surface age sampling. */
export class SourceAttractorColorRuntime {
 readonly packed:Uint32Array;readonly colors:Float32Array;readonly alphas:Float32Array;
 readonly diagnostics:readonly string[];
 private readonly options:SourceAttractorColorOptions;private readonly palette:readonly number[];
 private readonly gradient:SourceGradientRuntime;private readonly admitted:boolean;
 private readonly rgba=new Float32Array(4);private state:PaletteState={primary:0,secondary:0,blend:0};
 private used=0;private failed=false;private failure:unknown;
 constructor(options:SourceAttractorColorOptions){
  this.options={...options};const {count,nativeBackend,showTrails,palette}=this.options;
  if(!Number.isSafeInteger(count)||count<0||count>2147483647||!['cpu','gpu'].includes(nativeBackend)||typeof showTrails!=='boolean')throw new SourceAttractorColorError('input','原版吸引子颜色配置无效');
  const prepared=prepareSourceAttractorInitialColors(palette??{kind:'absent'},count);
  if(!prepared.ok)throw new SourceAttractorColorError(prepared.error.kind==='capacity'?'capacity':'input',prepared.error.reason);
  this.palette=prepared.value.packedPalette;this.diagnostics=prepared.value.diagnostics;
  this.admitted=nativeBackend==='cpu'&&showTrails;
  this.reserve(count*5+this.palette.length);
  this.packed=new Uint32Array(count);this.colors=new Float32Array(count*3);this.alphas=new Float32Array(count);
  for(let i=0;i<count;i++){
   if((i&255)===0)this.check();const color=prepared.value.colorAt(i);
   if(!color.ok)throw new SourceAttractorColorError('input',color.error.reason);
   this.write(i,color.value);
  }
  this.gradient=new SourceGradientRuntime(()=>this.state.primary,(frame,config)=>this.apply(target(frame,config.mode)));
 }
 private check(){if(this.failed)throw this.failure;if(this.options.isCancelled?.())throw new SourceAttractorColorError('cancelled','原版吸引子颜色更新已取消');}
 private reserve(n:number){this.check();if(!Number.isSafeInteger(n)||n<0||this.used+n>MAX_WORK)throw new SourceAttractorColorError('capacity','原版吸引子颜色超过本地 2000 万工作单位预算');this.used+=n;this.options.reserve?.(n);}
 private guarded<T>(run:()=>T):T{try{this.check();return run();}catch(error){this.failed=true;this.failure=error;throw error;}}
 private write(index:number,color:number){
  this.packed[index]=color;writeSourcePackedColor(color,this.rgba,0);
  this.colors.set(this.rgba.subarray(0,3),index*3);this.alphas[index]=this.rgba[3];
 }
 private apply(value:PaletteState){
  const next={primary:Number.isFinite(value.primary)?value.primary:this.state.primary,secondary:Number.isFinite(value.secondary)?value.secondary:this.state.secondary,blend:Number.isFinite(value.blend)?constrain(value.blend,0,1):this.state.blend};
  if(next.primary===this.state.primary&&next.secondary===this.state.secondary&&next.blend===this.state.blend)return;
  this.reserve(this.packed.length*(next.blend>0?128:32));this.state=next;
  const running=this.gradient.running,interpolation:DomainSourceInterpolation=running?this.gradient.config!.interpolation:'rgb';
  for(let i=0;i<this.packed.length;i++){
   if((i&255)===0)this.check();const coordinate=this.packed.length<=1?0:F(F(i)/F(this.packed.length-1));
   const a=shifted(this.palette,coordinate,next.primary,running);
   this.write(i,next.blend<=0?a:sourceColorLerp(a,shifted(this.palette,coordinate,next.secondary,running),next.blend,interpolation));
  }
 }
 beginGradientActions(actions:readonly SourceGradientAction[]):void{this.guarded(()=>{
  if(!this.admitted)return;
  if(!Array.isArray(actions)||actions.length>64)throw new SourceAttractorColorError('capacity','原版吸引子每组渐变动作最多 64 项');
  for(const action of actions)if(!action||!['start','stop'].includes(action.kind)||action.kind==='start'&&(!action.config||!['hue_rotate','offset_cycle','cross_fade','palette_morph'].includes(action.config.mode)||!['rgb','linear','oklab','oklch'].includes(action.config.interpolation)||!Number.isFinite(action.config.speed)))throw new SourceAttractorColorError('input','原版吸引子渐变动作无效');
  this.reserve(actions.length);this.gradient.begin(actions.map(action=>action.kind==='stop'?{kind:'stop'}:{kind:'start',config:{...action.config}}));
 });}
 interpolateGradientActions(eased:number,finished:boolean):void{this.guarded(()=>{
  if(!this.admitted)return;
  if(!Number.isFinite(F(eased))||typeof finished!=='boolean')throw new SourceAttractorColorError('input','原版吸引子渐变进度无效');
  this.reserve(1);this.gradient.interpolate(F(eased),finished);
 });}
 update(dt:number):void{this.guarded(()=>{
  if(!this.admitted)return;
  if(!Number.isFinite(F(dt))||dt<0)throw new SourceAttractorColorError('input','原版吸引子渐变帧时长无效');
  this.reserve(1);this.gradient.update(F(dt));
 });}
 snapshot():SourceAttractorColorSnapshot{return this.guarded(()=>{
  this.reserve(this.packed.length*5);
  return{packed:this.packed.slice(),colors:this.colors.slice(),alphas:this.alphas.slice(),gradient:this.gradient.snapshot(),state:{...this.state},diagnostics:[...this.diagnostics],workUnits:this.used};
 });}
}
