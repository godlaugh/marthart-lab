import {sourceColorLerp,type DomainSourceInterpolation} from './domainSourcePalette';
import {SourceGradientRuntime,type SourceGradientAction,type SourceGradientSnapshot} from './sourceGradientRuntime';
import {sourceGradientPaletteState,type SourceGradientPaletteState} from './sourceGradientPaletteState';
import {parseSourceParticleGradientConfiguration} from './sourceParticleGradientConfig';
import {sourceManimGradientColor} from './sourceManimGradient';

const F=Math.fround;
const integer=(v:number)=>Math.max(-2147483648,Math.min(2147483647,Math.trunc(v)));
const phase=(v:number)=>F(v-F(integer(Math.floor(v))));
const constrain=(v:number,lo:number,hi:number)=>v<lo?lo:v>hi?hi:v;
/** Local retained palette budget (256 KiB packed), not a source color limit. */
export const SOURCE_PERLIN_COLOR_LIMIT=65_536;
/** Local maximum initial packed output: 4 MiB. Scene particle/work owners may
 * impose a smaller count; this is not a source palette or particle limit. */
export const SOURCE_PERLIN_INITIAL_COLOR_LIMIT=1_048_576;
/** ManimColors.DEFAULT_PALETTE used by PerlinNoiseField.cachePalette. */
export const SOURCE_PERLIN_DEFAULT_PALETTE=Object.freeze([0xfffc6255,0xffff862f,0xffffcd62,0xff83c167,0xff58c4dd,0xff9a72ac]);
export class SourcePerlinColorError extends Error {
 constructor(readonly code:'input'|'capacity'|'cancelled',message:string){super(message);this.name=code==='cancelled'?'AbortError':'SourcePerlinColorError';}
}
export interface SourcePerlinColorSampling {
 readonly state:Readonly<SourceGradientPaletteState>;
 readonly running:boolean;
 readonly interpolation:DomainSourceInterpolation;
}
export interface SourcePerlinColorSnapshot {
 readonly state:Readonly<SourceGradientPaletteState>;
 readonly gradient:SourceGradientSnapshot;
 readonly revision:number;
 readonly refreshed?:SourcePerlinColorSampling;
 readonly textureDirty:boolean;
 readonly textureBuilds:number;
}
export interface SourcePerlinColorOptions {
 /** Already decoded unsigned ARGB. Missing/empty uses cachePalette's default. */
 readonly palette?:readonly number[];
 readonly isCancelled?:()=>boolean;
 /** Synchronous CPU particle/curve refresh. Initial particle colors are owned
  * by initParticles/ManimColors.gradient, so construction does not call this.
  * Capture geometry and seed-space blobs separately; they are not regenerated. */
 readonly onRefresh?:(sample:(coordinate:number)=>number,revision:number)=>void;
}

/** Direct source sampler. Empty-white is a defensive method branch; a field's
 * cachePalette normally replaces empty input by DEFAULT_PALETTE beforehand. */
function shifted(palette:ArrayLike<number>,coordinate:number,offset:number,running:boolean,space:DomainSourceInterpolation):number {
 if(!palette.length)return 0xffffffff;
 if(palette.length===1)return palette[0];
 const u=phase(F(coordinate+phase(offset))),position=F(u*F(running?palette.length:palette.length-1));
 const index=Math.min(integer(position),palette.length-(running?1:2)),fraction=F(position-F(index));
 if(index<0||index>=palette.length||!Number.isFinite(fraction))throw new SourcePerlinColorError('input','原版 Perlin 色板采样超出可表示范围');
 return sourceColorLerp(palette[index],palette[running?(index+1)%palette.length:index+1],fraction,running?space:'rgb');
}
function sample(palette:ArrayLike<number>,recipe:SourcePerlinColorSampling,coordinate:number):number {
 if(!Number.isFinite(F(coordinate)))throw new SourcePerlinColorError('input','原版 Perlin 颜色坐标须为有限单精度数值');
 const {state,running,interpolation}=recipe,space=running?interpolation:'rgb';
 const primary=shifted(palette,F(coordinate),state.primary,running,space);
 return state.blend<=0?primary:sourceColorLerp(primary,shifted(palette,F(coordinate),state.secondary,running,space),state.blend,space);
}

/** Perlin's color state, independent of geometry and frame scheduling.
 * CPU refreshes synchronously on scalar changes; GPU rebuilds lazily using the
 * then-current running state. Stopping alone invalidates neither consumer.
 * A failed consumer callback invalidates this owner rather than publishing a
 * partially refreshed scene. Caller disposes/replays that scene on failure. */
export class SourcePerlinColorRuntime {
 private palette:Uint32Array;
 private readonly options:SourcePerlinColorOptions;
 private readonly gradient:SourceGradientRuntime;
 private state:SourceGradientPaletteState={primary:0,secondary:0,blend:0};
 private refreshed?:SourcePerlinColorSampling;
 private revision=0;private dirty=true;private builds=0;private texture?:Uint32Array;
 private failed=false;private failure:unknown;
 constructor(options:SourcePerlinColorOptions={}) {
  this.options={isCancelled:options.isCancelled,onRefresh:options.onRefresh};this.check();
  const palette=this.prepare(options.palette??[]);
  this.palette=palette.length?palette:Uint32Array.from(SOURCE_PERLIN_DEFAULT_PALETTE);
  this.gradient=new SourceGradientRuntime(()=>this.state.primary,(frame,config)=>this.apply(sourceGradientPaletteState(frame,config.mode)));
 }
 private check(){if(this.failed)throw this.failure;if(this.options.isCancelled?.())throw new SourcePerlinColorError('cancelled','原版 Perlin 颜色更新已取消');}
 private guarded<T>(run:()=>T):T{try{this.check();const value=run();this.check();return value;}catch(error){this.failed=true;this.failure=error;throw error;}}
 private prepare(input:readonly number[]):Uint32Array {
  if(!Array.isArray(input))throw new SourcePerlinColorError('input','原版 Perlin 色板须为 ARGB 数组');
  if(input.length>SOURCE_PERLIN_COLOR_LIMIT)throw new SourcePerlinColorError('capacity','原版 Perlin 色板超过本地 65536 色准备预算');
  return Uint32Array.from(input,(value,i)=>{
   if((i&255)===0)this.check();
   if(!Number.isInteger(value)||value<0||value>0xffffffff)throw new SourcePerlinColorError('input','原版 Perlin 色板须包含无符号 32 位 ARGB');
   return value;
  });
 }
 private recipe():SourcePerlinColorSampling {
  return Object.freeze({state:Object.freeze({...this.state}),running:this.gradient.running,interpolation:this.gradient.running?this.gradient.config!.interpolation:'rgb'});
 }
 private refresh(){
  const recipe=this.recipe(),palette=this.palette;
  this.refreshed=recipe;this.revision++;
  this.options.onRefresh?.(coordinate=>{this.check();return sample(palette,recipe,coordinate);},this.revision);
  this.dirty=true;
 }
 private apply(value:SourceGradientPaletteState){
  const next={primary:Number.isFinite(value.primary)?value.primary:this.state.primary,secondary:Number.isFinite(value.secondary)?value.secondary:this.state.secondary,blend:Number.isFinite(value.blend)?constrain(value.blend,0,1):this.state.blend};
  if(next.primary===this.state.primary&&next.secondary===this.state.secondary&&next.blend===this.state.blend)return;
  this.state=next;this.refresh();
 }
 /** Nonempty applyPalette refreshes colors even when scalar offsets did not
  * change. Existing seed-space blob colors remain with their geometry owner. */
 replacePalette(input:readonly number[]):void {this.guarded(()=>{
  const palette=this.prepare(input);if(!palette.length)return;
  this.palette=palette;this.dirty=true;this.refresh();
 });}
 beginGradientActions(actions:readonly SourceGradientAction[]):void {this.guarded(()=>{
  if(!Array.isArray(actions))throw new SourcePerlinColorError('input','原版 Perlin 渐变动作须为数组');
  if(actions.length>64)throw new SourcePerlinColorError('capacity','原版 Perlin 每组渐变动作超过本地 64 项预算');
  const parsed=Array.from(actions,(action):SourceGradientAction=>{
   if(!action||!['start','stop'].includes(action.kind))throw new SourcePerlinColorError('input','原版 Perlin 渐变动作无效');
   return action.kind==='stop'?{kind:'stop'}:{kind:'start',config:parseSourceParticleGradientConfiguration(action.config)};
  });
  this.gradient.begin(parsed);
 });}
 interpolateGradientActions(eased:number,finished:boolean):void {this.guarded(()=>{
  // The source setter retains nonfinite easing until finish repairs its scale.
  if(typeof eased!=='number'||typeof finished!=='boolean')throw new SourcePerlinColorError('input','原版 Perlin 渐变进度无效');
  this.gradient.interpolate(F(eased),finished);
 });}
 update(dt:number):void {this.guarded(()=>{
  if(!Number.isFinite(F(dt))||dt<0)throw new SourcePerlinColorError('input','原版 Perlin 渐变帧时长无效');
  this.gradient.update(F(dt));
 });}
 sampleCurrent(coordinate:number):number {return this.guarded(()=>sample(this.palette,this.recipe(),coordinate));}
 /** Detached ManimColors.gradient output from this owner's effective palette.
  * Construction uses this once; later CPU refreshes use the captured sampler. */
 initialParticleColors(count:number):Uint32Array {return this.guarded(()=>{
  if(!Number.isInteger(count)||count<0||count>2147483647)throw new SourcePerlinColorError('input','原版 Perlin 初始颜色数量须为非负 Java int');
  if(count>SOURCE_PERLIN_INITIAL_COLOR_LIMIT)throw new SourcePerlinColorError('capacity','原版 Perlin 初始颜色超过本地 4 MiB 输出预算');
  const result=new Uint32Array(count);
  for(let i=0;i<count;i++){if((i&255)===0)this.check();result[i]=sourceManimGradientColor(this.palette,count,i);}
  return result;
 });}
 /** Direct source sampleShiftedPalette; seed-space construction supplies zero
  * offset and fixes the returned blob color independently of later gradients. */
 sampleShifted(coordinate:number,offset:number):number {return this.guarded(()=>{
  if(!Number.isFinite(F(coordinate))||!Number.isFinite(F(offset)))throw new SourcePerlinColorError('input','原版 Perlin 颜色坐标须为有限单精度数值');
  const recipe=this.recipe();return shifted(this.palette,F(coordinate),F(offset),recipe.running,recipe.interpolation);
 });}
 /** Undefined before the first refresh: do not replace initial particle colors
  * with the shifted sampler's wrapped endpoint. */
 sampleRefreshed(coordinate:number):number|undefined {return this.guarded(()=>this.refreshed?sample(this.palette,this.refreshed,coordinate):undefined);}
 /** Detached packed PImage pixels. Upload bytes as ARGB-derived RGBA without
  * applying Processing tint interpretation to these image pixels. */
 paletteTexture():Uint32Array {return this.guarded(()=>{
  if(this.dirty||!this.texture){
   const next=new Uint32Array(256),recipe=this.recipe();
   for(let i=0;i<next.length;i++){if((i&31)===0)this.check();next[i]=sample(this.palette,recipe,F(F(i)/F(next.length-1)));}
   this.texture=next;this.dirty=false;this.builds++;
  }
  return this.texture.slice();
 });}
 snapshot():SourcePerlinColorSnapshot {return this.guarded(()=>Object.freeze({state:Object.freeze({...this.state}),gradient:this.gradient.snapshot(),revision:this.revision,refreshed:this.refreshed,textureDirty:this.dirty,textureBuilds:this.builds}));}
}
