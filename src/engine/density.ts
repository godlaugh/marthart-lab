import type {ControlSpec, GenerateContext, Palette, SceneDocument, SceneOutput, Settings, DensityProjection, DensityBounds, DensityStats} from '../types';
export type {DensityProjection, DensityBounds, DensityStats} from '../types';
import {numberSetting} from './expression';
import {MAX_RASTER_PIXELS} from './rasterDimensions';
import {hexRGB, paletteColor, validatePalette} from './palette';
import {densityToneModel,prepareDensityNormalization,normalizedDensityValue,type DensityNormalization,type DensityNormalizationFacts} from './densityNormalization';
import {deriveSamilaNormalization,samilaDensityValue,samilaToneParameters,type SamilaNormalization,type SamilaToneFacts,type SamilaToneBranch} from './samilaTone';
import {samilaSourceIndex,validateSamilaView,type PreparedSamilaView} from './samilaCamera';

export interface DensityGrid {
  width:number;height:number;counts:Uint32Array;weights?:Float64Array;colorSums?:Float64Array;stats:DensityStats;
}
export type DensityRaster = Extract<SceneOutput,{type:'raster'}> & {density:DensityStats};
type PointArrays = {positions:Float32Array|Float64Array;colors?:Float32Array|Float64Array};
type AccumulationOptions = {projection?:DensityProjection;bounds?:DensityBounds;padding?:number;weight?:number;isCancelled?:()=>boolean};
const MAX_PIXELS=4_194_304;
const AXES:Record<DensityProjection,[number,number]>={xy:[0,1],xz:[0,2],yz:[1,2]};
const clamp=(x:number)=>Math.max(0,Math.min(1,x));
const select=(s:Settings,key:string,fallback:string,allowed:readonly string[])=>{const value=String(s[key]??fallback);if(!allowed.includes(value))throw new Error(`${key} 不支持 ${value}`);return value;};
function boolean(s:Settings,key:string,fallback:boolean):boolean {const v=s[key]??fallback;if(typeof v!=='boolean')throw new Error(`${key} 必须为布尔值`);return v;}
function dimensions(width:number,height:number):void {
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>16384||height>16384)throw new Error('密度画布边长须为 1–16384 的整数');
  if(width*height>MAX_PIXELS)throw new Error(`密度累积最多支持 ${MAX_PIXELS} 像素`);
}
function boundsValid(bounds:DensityBounds):void {
  if(![bounds.minX,bounds.maxX,bounds.minY,bounds.maxY].every(Number.isFinite)||bounds.minX>=bounds.maxX||bounds.minY>=bounds.maxY)throw new Error('密度视口边界必须有限且严格递增');
  if(!Number.isFinite(bounds.maxX-bounds.minX)||!Number.isFinite(bounds.maxY-bounds.minY))throw new Error('密度视口跨度溢出');
}
function arraysValid(points:PointArrays):void {
  if(!(points.positions instanceof Float32Array||points.positions instanceof Float64Array)||points.positions.length%3!==0)throw new Error('密度位置必须是完整的三元浮点坐标');
  if(points.colors&&(!(points.colors instanceof Float32Array||points.colors instanceof Float64Array)||points.colors.length!==points.positions.length))throw new Error('密度颜色必须逐点提供完整 RGB');
}
function autoBounds(frames:PointArrays[],width:number,height:number,projection:DensityProjection,padding:number,isCancelled?:()=>boolean):{bounds:DensityBounds;cancelled:boolean} {
  const [a,b]=AXES[projection];let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const points of frames){const p=points.positions;for(let i=0;i<p.length;i+=3){
    if(i%12288===0&&isCancelled?.())return{bounds:{minX:-1,maxX:1,minY:-1,maxY:1},cancelled:true};
    if(!Number.isFinite(p[i])||!Number.isFinite(p[i+1])||!Number.isFinite(p[i+2]))continue;
    minX=Math.min(minX,p[i+a]);maxX=Math.max(maxX,p[i+a]);minY=Math.min(minY,p[i+b]);maxY=Math.max(maxY,p[i+b]);
  }
  }
  const aspect=width/height;
  if(minX===Infinity)return{bounds:{minX:-aspect,maxX:aspect,minY:-1,maxY:1},cancelled:false};
  const cx=minX/2+maxX/2,cy=minY/2+maxY/2;
  let span=Math.max(maxY-minY,(maxX-minX)/aspect);
  if(span===0)span=Math.max(1,Math.abs(cx)*1e-6/aspect,Math.abs(cy)*1e-6);
  span*=1+2*padding;
  const bounds={minX:cx-span*aspect/2,maxX:cx+span*aspect/2,minY:cy-span/2,maxY:cy+span/2};boundsValid(bounds);
  return{bounds,cancelled:false};
}

/** One point contributes exactly one count to a closed viewport; y increases upward.
 * RGB sums are in the supplied display-color space, not a radiometric simulation. */
export function accumulateDensity(points:PointArrays,width:number,height:number,options:AccumulationOptions={}):DensityGrid {
  arraysValid(points);dimensions(width,height);
  const projection=options.projection??'xy';if(!Object.hasOwn(AXES,projection))throw new Error('不支持密度坐标投影');
  const padding=options.padding??.05;if(!Number.isFinite(padding)||padding<0||padding>1)throw new Error('密度边距须在 0–1 之间');
  let bounds:DensityBounds,cancelled=false;
  if(options.bounds){bounds={...options.bounds};boundsValid(bounds);}else({bounds,cancelled}=autoBounds([points],width,height,projection,padding,options.isCancelled));
  const counts=new Uint32Array(width*height),colorSums=points.colors?new Float64Array(width*height*3):undefined;
  const stats:DensityStats={projection,bounds,inputPoints:0,examined:0,accepted:0,clipped:0,invalid:0,occupiedPixels:0,maxCount:0,cancelled};
  const grid={width,height,counts,colorSums,stats};
  return accumulateDensityInto(grid,points,options.isCancelled,options.weight);
}

/** Adds another frame to an already fixed lattice without allocating another image. */
export function accumulateDensityInto(grid:DensityGrid,points:PointArrays,isCancelled?:()=>boolean,weight=1):DensityGrid {
  arraysValid(points);dimensions(grid.width,grid.height);boundsValid(grid.stats.bounds);
  if(!Number.isFinite(weight)||weight<0||weight>1)throw new Error('密度样本权重必须在 0–1 之间');
  if(!(grid.counts instanceof Uint32Array)||grid.counts.length!==grid.width*grid.height||Boolean(grid.colorSums)!==Boolean(points.colors))throw new Error('密度累积缓冲格式不一致');
  if(grid.colorSums&&grid.colorSums.length!==grid.width*grid.height*3)throw new Error('密度颜色累积缓冲长度不一致');
  if(grid.weights&&(!(grid.weights instanceof Float64Array)||grid.weights.length!==grid.counts.length))throw new Error('密度权重缓冲长度不一致');
  if(!Object.hasOwn(AXES,grid.stats.projection))throw new Error('不支持密度坐标投影');
  if(weight!==1&&!grid.weights)grid.weights=Float64Array.from(grid.counts);
  const {width,height,counts,colorSums,stats}=grid,{bounds,projection}=stats;
  stats.inputPoints+=points.positions.length/3;if(stats.cancelled)return grid;
  const [a,b]=AXES[projection],p=points.positions,colors=points.colors,spanX=bounds.maxX-bounds.minX,spanY=bounds.maxY-bounds.minY;
  for(let i=0;i<p.length;i+=3){
    if(i%12288===0&&isCancelled?.()){stats.cancelled=true;break;}
    stats.examined++;
    if(!Number.isFinite(p[i])||!Number.isFinite(p[i+1])||!Number.isFinite(p[i+2])){stats.invalid++;continue;}
    const x=p[i+a],y=p[i+b];if(x<bounds.minX||x>bounds.maxX||y<bounds.minY||y>bounds.maxY){stats.clipped++;continue;}
    const px=Math.min(width-1,Math.floor((x-bounds.minX)/spanX*width));
    const py=Math.min(height-1,Math.floor((bounds.maxY-y)/spanY*height)),index=py*width+px;
    if(counts[index]===0xffffffff)throw new Error('单像素点计数超出 Uint32 范围');
    if(colors&&colorSums){
      for(let k=0;k<3;k++){const v=colors[i+k];if(!Number.isFinite(v)||v<0||v>1)throw new Error(`第 ${i/3} 点颜色必须为 0–1 的有限 RGB`);}
      for(let k=0;k<3;k++)colorSums[index*3+k]+=colors[i+k]*weight;
    }
    if(counts[index]===0)stats.occupiedPixels++;
    counts[index]++;if(grid.weights)grid.weights[index]+=weight;stats.accepted++;stats.maxCount=Math.max(stats.maxCount,counts[index]);
  }
  return grid;
}

export interface DensityTone {
  toneMap:'linear'|'log';exposure:number;gamma:number;contrast:number;brightness:number;
  saturation:number;dynamicRange:number;paletteMode:'density'|'source';transparentBackground:boolean;background:string;
}
export const densityDefaults:Settings={presentation:'points',densityAccumulation:'frame',densityLifetime:1,densitySampleRate:10,densityDecay:1,densityProjection:'xy',densityView:'auto',densityCenterX:0,densityCenterY:0,densitySpan:6,densityPadding:.05,toneMap:'log',exposure:0,gamma:2.2,contrast:1,brightness:0,saturation:1,dynamicRange:32,paletteMode:'density',transparentBackground:false};
function toneSettings(s:Settings):DensityTone {
  const background=String(s.background??'#0a0c14');if(!/^#[0-9a-f]{6}$/i.test(background))throw new Error('密度背景必须为 #RRGGBB');
  return{toneMap:select(s,'toneMap','log',['linear','log']) as DensityTone['toneMap'],exposure:numberSetting(s,'exposure',0,-16,16),gamma:numberSetting(s,'gamma',2.2,.1,8),contrast:numberSetting(s,'contrast',1,0,8),brightness:numberSetting(s,'brightness',0,-1,1),saturation:numberSetting(s,'saturation',1,0,4),dynamicRange:numberSetting(s,'dynamicRange',32,.001,1e9),paletteMode:select(s,'paletteMode','density',['density','source']) as DensityTone['paletteMode'],transparentBackground:boolean(s,'transparentBackground',false),background};
}
/** Sole validated presentation input shared by CPU and GPU backends. */
interface DensityToneBase {tone:DensityTone;palette:Palette;background:[number,number,number];gain:number;inverseGamma:number;logWhite:number;}
export type DensityToneJob=DensityToneBase&({model:'white-point-v1'}|{model:'normalized-v2';normalization:DensityNormalization}|{model:'samila-normalized-v2';normalization:SamilaNormalization;branch:SamilaToneBranch});
export function prepareDensityTone(palette:Palette,settings:Settings={},facts?:DensityNormalizationFacts|SamilaToneFacts):DensityToneJob {
 const model=densityToneModel(settings);
 if(model==='samila-normalized-v2'){
  if(!facts||facts.kind!=='samila')throw new Error('Samila 归一调色需要持续累积器提供真实批次事实');
  const parsed=samilaToneParameters(settings),normalization=deriveSamilaNormalization(facts),background=String(settings.background??'#0a0c14');
  if(!/^#[0-9a-f]{6}$/i.test(background))throw new Error('密度背景必须为 #RRGGBB');
  const {branch,...values}=parsed,tone:DensityTone={...values,toneMap:'log',exposure:0,paletteMode:'source',background,transparentBackground:boolean(settings,'transparentBackground',false)};
  return{model,normalization,branch,tone,palette:validatePalette(palette),background:hexRGB(background),gain:1,inverseGamma:1/tone.gamma,logWhite:Math.log(1000)};
 }
 if(model==='normalized-v2'){
  if(!facts||facts.kind==='samila')throw new Error('归一调色需要持续累积器提供真实批次事实');
  const normalization=prepareDensityNormalization(settings,facts),map=facts.kind==='map',background=String(settings.background??'#0a0c14');
  if(!/^#[0-9a-f]{6}$/i.test(background))throw new Error('密度背景必须为 #RRGGBB');
  const tone:DensityTone={toneMap:'log',exposure:0,paletteMode:'source',background,transparentBackground:boolean(settings,'transparentBackground',false),brightness:numberSetting(settings,'normalizedBrightness',map?.3:.5,-.5,1.5),contrast:numberSetting(settings,'normalizedContrast',1,.1,2),gamma:numberSetting(settings,'normalizedGamma',2.2,.1,10),dynamicRange:numberSetting(settings,'normalizedDynamicRange',map?.2:.5,.1,1),saturation:numberSetting(settings,'normalizedSaturation',.8,0,1)};
  return{model,normalization,tone,palette:validatePalette(palette),background:hexRGB(background),gain:1,inverseGamma:1/tone.gamma,logWhite:Math.log(1000)};
 }
 const tone=toneSettings(settings);return{model,tone,palette:validatePalette(palette),background:hexRGB(tone.background),gain:2**tone.exposure,inverseGamma:1/tone.gamma,logWhite:Math.log1p(tone.dynamicRange)};
}
function baseTone(count:number,job:DensityToneJob):number {return job.tone.toneMap==='log'?Math.log1p(count)/job.logWhite:count/job.tone.dynamicRange;}
/** White-point density is measured in points/pixel, so both transfer modes preserve
 * count changes. Empty pixels stay empty even with positive brightness. */
export function toneDensity(grid:DensityGrid,palette:Palette,settings:Settings={}):Uint8ClampedArray {
  return toneDensityPrepared(grid,prepareDensityTone(palette,settings));
}
function toneDensityPrepared(grid:DensityGrid,job:DensityToneJob):Uint8ClampedArray {
  dimensions(grid.width,grid.height);const length=grid.width*grid.height;
  if(!(grid.counts instanceof Uint32Array)||grid.counts.length!==length||grid.weights&&grid.weights.length!==length||grid.colorSums&&grid.colorSums.length!==length*3)throw new Error('密度网格长度不匹配');
  return mapDensity(grid.width,grid.height,job,i=>grid.weights?.[i]??grid.counts[i],grid.colorSums?(i,k)=>grid.colorSums![i*3+k]:undefined);
}

/** Shared presentation boundary for floating accumulation owners. RGB entries are
 * sums, A is nonnegative mass; the returned bytes use straight alpha. */
export function toneDensityRgba(width:number,height:number,rgba:Float32Array|Float64Array,palette:Palette,settings:Settings={},isCancelled?:()=>boolean):Uint8ClampedArray {
  return toneDensityRgbaPrepared(width,height,rgba,prepareDensityTone(palette,settings),isCancelled);
}
export function toneDensityRgbaPrepared(width:number,height:number,rgba:Float32Array|Float64Array,job:DensityToneJob,isCancelled?:()=>boolean,destination?:Uint8ClampedArray,view?:PreparedSamilaView):Uint8ClampedArray {
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>16384||height>16384||width*height>MAX_RASTER_PIXELS)throw new Error('密度输出超过 128 MiB 图像预算或尺寸无效');
  if(!(rgba instanceof Float32Array||rgba instanceof Float64Array)||rgba.length!==width*height*4)throw new Error('浮点密度缓冲长度或类型无效');
  if(destination&&(!(destination instanceof Uint8ClampedArray)||destination.length!==width*height*4))throw new Error('调色目标缓冲长度或类型无效');
  if(view){
    validateSamilaView(view,width,height);
    // Validate the owned source, including texels outside the presented view.
    // A rotation must never hide malformed ink from its producer's consumer.
    for(let i=0;i<rgba.length;i+=4){
      if(i%65536===0&&isCancelled?.())throw new DOMException('密度映射已取消','AbortError');
      if(!Number.isFinite(rgba[i+3])||rgba[i+3]<0)throw new Error('密度权重必须是非负有限数值');
      if(!Number.isFinite(rgba[i])||!Number.isFinite(rgba[i+1])||!Number.isFinite(rgba[i+2]))throw new Error('密度 RGB 累积包含非有限值');
    }
  }
  return mapDensity(width,height,job,i=>rgba[i*4+3],(i,k)=>rgba[i*4+k],isCancelled,destination,view);
}
function mapDensity(width:number,height:number,job:DensityToneJob,mass:(i:number)=>number,colorSum?:((i:number,k:number)=>number),isCancelled?:()=>boolean,destination?:Uint8ClampedArray,view?:PreparedSamilaView):Uint8ClampedArray {
  const {tone,palette,background:bg,gain}=job;if(tone.paletteMode==='source'&&!colorSum)throw new Error('原采样颜色模式需要 RGB 累积');
  const pixels=destination??new Uint8ClampedArray(width*height*4);if(destination)pixels.fill(0);
  for(let i=0;i<width*height;i++){
    if(i%16384===0&&isCancelled?.())throw new DOMException('密度映射已取消','AbortError');
    const source=view?samilaSourceIndex(view,i%width,Math.floor(i/width)):i,count=source<0?0:mass(source),offset=i*4;
    if(!Number.isFinite(count)||count<0)throw new Error('密度权重必须是非负有限数值');
    if(source>=0&&job.model==='samila-normalized-v2'&&![colorSum!(source,0),colorSum!(source,1),colorSum!(source,2)].every(Number.isFinite))throw new Error('密度 RGB 累积包含非有限值');
    if(!count||job.model!=='white-point-v1'&&count<=1e-12){if(!tone.transparentBackground){for(let k=0;k<3;k++)pixels[offset+k]=Math.round(bg[k]*255);pixels[offset+3]=255;}continue;}
    if(job.model==='samila-normalized-v2'){
      const value=samilaDensityValue(Math.log(count)-Math.log(job.normalization.scale),tone.contrast,tone.brightness,tone.dynamicRange),rgb=[colorSum!(source,0)/count,colorSum!(source,1)/count,colorSum!(source,2)/count];
      if(!rgb.every(Number.isFinite))throw new Error('密度 RGB 累积包含非有限值');
      let color:number[],alpha=clamp(1/(1+.02*job.normalization.scale/count));
      if(job.branch==='palette-average'){
        const mixed=rgb.map((v,k)=>bg[k]*(1-value)+v*value);
        if(mixed.some(v=>v<0))throw new Error('Samila 色板均值产生负伽马输入');
        const corrected=mixed.map(v=>v**job.inverseGamma),y=.299*corrected[0]+.587*corrected[1]+.114*corrected[2];
        color=corrected.map(v=>y+(v-y)*tone.saturation);alpha=1-value*(1-alpha);
      }else{
        const y=.299*rgb[0]+.587*rgb[1]+.114*rgb[2],chroma=tone.saturation*value*(1-value)*4,u=.493*(rgb[2]-y)*chroma,v=.877*(rgb[0]-y)*chroma;
        color=[value+v/.877,value-.39393*u-.58081*v,value+u/.493].map(v=>clamp(v)**job.inverseGamma);
      }
      if(!color.every(Number.isFinite))throw new Error('Samila 调色结果超出有限范围');
      for(let k=0;k<3;k++)pixels[offset+k]=Math.round(255*clamp(tone.transparentBackground?color[k]:color[k]*alpha+bg[k]*(1-alpha)));
      pixels[offset+3]=tone.transparentBackground?Math.round(255*alpha):255;continue;
    }
    if(job.model==='normalized-v2'){
      const norm=job.normalization,logDensity=Math.log(count)-Math.log(norm.scale),value=normalizedDensityValue(logDensity,tone.contrast,tone.brightness,tone.dynamicRange);
      const rgb=norm.kind==='map'&&count<=1e-6?[0,0,0]:[colorSum!(source,0)/count,colorSum!(source,1)/count,colorSum!(source,2)/count];
      if(!rgb.every(Number.isFinite))throw new Error('密度 RGB 累积包含非有限值');
      const y=.299*rgb[0]+.587*rgb[1]+.114*rgb[2],chroma=tone.saturation*value*(1-value)*4,u=.493*(rgb[2]-y)*chroma,v=.877*(rgb[0]-y)*chroma;
      const color=[value+v/.877,value-.39393*u-.58081*v,value+u/.493];
      const alpha=clamp(1/(1+.02*norm.scale/count));
      for(let k=0;k<3;k++){const channel=clamp(color[k])**job.inverseGamma;pixels[offset+k]=Math.round(255*(tone.transparentBackground?channel:channel*alpha+bg[k]*(1-alpha)));}
      pixels[offset+3]=tone.transparentBackground?Math.round(255*alpha):255;continue;
    }
    const base=baseTone(count,job),level=clamp((base*gain-.5)*tone.contrast+.5+tone.brightness)**job.inverseGamma;
    const color=tone.paletteMode==='source'?[colorSum!(source,0)/count,colorSum!(source,1)/count,colorSum!(source,2)/count]:paletteColor(palette,Math.min(1-Number.EPSILON,clamp(base)));
    if(!color.every(Number.isFinite))throw new Error('密度 RGB 累积包含非有限值');
    const luminance=.2126*color[0]+.7152*color[1]+.0722*color[2];
    for(let k=0;k<3;k++){const channel=clamp(luminance+(color[k]-luminance)*tone.saturation);pixels[offset+k]=Math.round(255*(tone.transparentBackground?(level?channel:0):channel*level+bg[k]*(1-level)));}
    pixels[offset+3]=tone.transparentBackground?Math.round(255*level):255;
  }
  return pixels;
}

/** Render an actual point cloud, retaining mathematical sample statistics separately
 * from image occupancy. Output dimensions are bounded with an explicit warning. */
export function presentPoints(output:SceneOutput,scene:SceneDocument,context:GenerateContext):SceneOutput|DensityRaster {
  const presentation=select(scene.settings,'presentation','points',['points','density']);if(presentation==='points')return output;
  return presentPointFrames([output],scene,context);
}

/** Parses projection, viewport, raster budget and tone at the shared owning boundary. */
export function parseDensityPresentation(scene:SceneDocument,context:GenerateContext) {
  const s=scene.settings,warnings:string[]=[];
  // A continuous-only model remains authored but dormant when the user returns
  // to the single-batch path. Its visible legacy tone controls are authoritative.
  const dormant=s.iteratedMode!=='continuous'&&((scene.kind==='map'||scene.kind==='symmetry')&&s.densityToneModel==='normalized-v2'||scene.kind==='samila'&&s.densityToneModel==='samila-normalized-v2');
  const settings=dormant?{...s,densityToneModel:'white-point-v1'}:s;
  const toneJob=prepareDensityTone(scene.palette,settings);
  if(!Number.isInteger(context.width)||!Number.isInteger(context.height)||context.width<1||context.height<1||context.width>16384||context.height>16384)throw new Error('密度画布边长须为 1–16384 的整数');
  const budget=context.quality==='export'?MAX_PIXELS:1_048_576,factor=Math.min(1,Math.sqrt(budget/(context.width*context.height)));
  const width=Math.max(1,Math.floor(context.width*factor)),height=Math.max(1,Math.floor(context.height*factor));
  if(width!==context.width||height!==context.height)warnings.push(`CPU 密度图按像素预算计算为 ${width} × ${height}（请求 ${context.width} × ${context.height}）；未减少传入采样点。`);
  return{width,height,...parseDensityViewport(scene,width,height),tone:toneJob.tone,toneJob,warnings};
}
/** Resolves view and tone once, independently of each renderer's resource budget. */
export function parseDensityViewport(scene:SceneDocument,width:number,height:number) {
  const geometry=parseDensityViewportGeometry(scene,width,height),s=scene.settings;
  // Existing consumers rely on early v1 validation here. Other color contracts
  // consume geometry directly and validate their own presentation parameters.
  return{...geometry,...(densityToneModel(s)==='white-point-v1'?{tone:toneSettings(s)}:{})};
}

export function parseDensityViewportGeometry(scene:SceneDocument,width:number,height:number) {
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>16384||height>16384)throw new Error('密度画布边长须为 1–16384 的整数');
  const s=scene.settings;
  const projection=select(s,'densityProjection','xy',['xy','xz','yz']) as DensityProjection,view=select(s,'densityView','auto',['auto','manual']);
  const padding=numberSetting(s,'densityPadding',.05,0,1);let bounds:DensityBounds|undefined;
  if(view==='manual'){
    const x=numberSetting(s,'densityCenterX',0,-1e30,1e30),y=numberSetting(s,'densityCenterY',0,-1e30,1e30),span=numberSetting(s,'densitySpan',6,1e-12,1e30),aspect=width/height;
    bounds={minX:x-span*aspect/2,maxX:x+span*aspect/2,minY:y-span/2,maxY:y+span/2};boundsValid(bounds);
  }
  return{projection,padding,bounds};
}

/** Frames share one viewport chosen over the whole time window. Retains exact
 * integer counts and RGB sums until a single final tone-map pass. */
export function presentPointFrames(outputs:SceneOutput[],scene:SceneDocument,context:GenerateContext,weights?:number[]):DensityRaster {
  if(!outputs.length)throw new Error('密度累积至少需要一个采样帧');
  if(weights&&(weights.length!==outputs.length||weights.some(w=>!Number.isFinite(w)||w<0||w>1)))throw new Error('密度帧权重数量或范围无效');
  const started=performance.now(),config=parseDensityPresentation(scene,context);
  const frames:PointArrays[]=outputs.map(output=>{
    if(output.type!=='geometry'||output.topology!=='points')throw new Error('密度渲染需要真实点几何');
    if(config.tone.paletteMode==='source'&&!output.colors)throw new Error('原采样颜色模式需要 RGB 累积');
    const frame={positions:output.positions,...(config.tone.paletteMode==='source'?{colors:output.colors}:{})};arraysValid(frame);return frame;
  });
  const fitted=config.bounds?{bounds:config.bounds,cancelled:false}:autoBounds(frames,config.width,config.height,config.projection,config.padding,context.isCancelled);
  const grid=accumulateDensity(frames[0],config.width,config.height,{projection:config.projection,bounds:fitted.bounds,isCancelled:context.isCancelled,weight:weights?.[0]});
  for(let i=1;i<frames.length;i++)accumulateDensityInto(grid,frames[i],context.isCancelled,weights?.[i]);
  grid.stats.cancelled ||= fitted.cancelled;
  const warnings=[...new Set([...outputs.flatMap(o=>o.warnings??[]),...config.warnings])];
  if(grid.stats.cancelled)warnings.push(`密度累积已取消；完成 ${grid.stats.examined} / ${grid.stats.inputPoints} 个点。`);
  if(grid.stats.clipped)warnings.push(`${grid.stats.clipped} 个有限点位于密度视口之外；未计入图像。`);
  if(grid.stats.invalid)warnings.push(`${grid.stats.invalid} 个点含非有限坐标；未计入图像。`);
  warnings.push(outputs.length>1?`CPU 时间窗口累积 ${outputs.length} 帧真实点计数；统一视口和颜色映射。`:'CPU 当前帧点计数密度图；每个点贡献一个像素。');
  const pixels=toneDensityPrepared(grid,config.toneJob);
  return{type:'raster',dimension:2,backend:'cpu',width:config.width,height:config.height,pixels,density:grid.stats,stats:{samples:outputs.reduce((n,o)=>n+o.stats.samples,0),generated:grid.stats.accepted,invalid:outputs.reduce((n,o)=>n+o.stats.invalid,0)+grid.stats.invalid,elapsedMs:performance.now()-started},warnings};
}

const numeric=(key:string,label:string,min:number,max:number,step:number,help?:string):ControlSpec=>({key,label,group:'密度渲染',type:'number',min,max,step,help});
const choice=(key:string,label:string,options:[string,string][]):ControlSpec=>({key,label,group:'密度渲染',type:'select',options:options.map(([value,label])=>({value,label}))});
export const densityControls:ControlSpec[]=[
  choice('presentation','呈现方式',[['points','采样点'],['density','CPU 密度图']]),
  choice('densityAccumulation','时间累积',[['frame','当前帧'],['window','历史时间窗口']]),
  numeric('densityDecay','每采样帧保留率',0,1,.01,'1保留窗口内全部密度；0仅保留当前帧；按真实点权重衰减后统一映射。'),
  numeric('densityLifetime','累积时长 · 秒',.001,60,.1),numeric('densitySampleRate','累积采样 · 帧/秒',1,120,1),
  choice('densityProjection','累积坐标平面',[['xy','X / Y'],['xz','X / Z'],['yz','Y / Z']]),
  choice('densityView','密度视口',[['auto','按采样范围适配'],['manual','固定中心与跨度']]),
  numeric('densityCenterX','视口中心 · 横坐标',-1e12,1e12,.1),numeric('densityCenterY','视口中心 · 纵坐标',-1e12,1e12,.1),numeric('densitySpan','视口纵向跨度',1e-12,1e12,.1),numeric('densityPadding','自动视口边距',0,1,.01),
  choice('toneMap','密度映射',[['log','对数'],['linear','线性']]),
  choice('paletteMode','着色依据',[['density','像素点密度'],['source','保留采样颜色平均值']]),
  numeric('dynamicRange','白点密度 · 点/像素',.001,1e9,1,'达到此点数的像素映射到白点；曝光与伽马仍可调节。'),
  numeric('exposure','曝光 · 档',-16,16,.1),numeric('gamma','伽马',.1,8,.05),numeric('contrast','对比度',0,8,.05),numeric('brightness','亮度偏移',-1,1,.02),numeric('saturation','饱和度',0,4,.05),
  {key:'transparentBackground',label:'透明背景',group:'密度渲染',type:'toggle'},
];
