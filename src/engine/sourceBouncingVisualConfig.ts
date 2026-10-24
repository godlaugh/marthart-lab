import {prepareDomainSourceScalar} from './domainSourceScalar';
import {prepareRootsSourceJsonString} from './rootsSourceOrder';
import {SOURCE_COLOR_TEXT_BUDGET,SourceConfigColorError,sourceConfigPackedColor,sourceBouncingBoundaryPackedColor} from './sourceConfigColor';
import type {SourceBouncingResult,SourceBouncingError,SourceBouncingImportOptions} from './sourceBouncingConfig';

export const SOURCE_BOUNCING_VISUAL_MODEL='bouncing-visual-1.7.8' as const;
export const SOURCE_BOUNCING_VISUAL_LIMITS=Object.freeze({paletteColors:65536,textCharacters:SOURCE_COLOR_TEXT_BUDGET});
/** BaseBouncingParticlesConfig's six entries; not ManimColors.DEFAULT_PALETTE. */
export const SOURCE_BOUNCING_DEFAULT_PALETTE:readonly number[]=Object.freeze([-236971,-31185,-12958,-8142489,-10959651,-6655316].map(value=>value>>>0));
export interface SourceBouncingTransform {scaleX:number;scaleY:number;scaleZ:number;offsetX:number;offsetY:number;offsetZ:number;}
export type SourceBouncingPalette={kind:'absent'}|{kind:'colors';colors:string[]};
export interface SourceBouncingVisualConfiguration {
 model:typeof SOURCE_BOUNCING_VISUAL_MODEL;settingsPresence:'absent'|'object';
 dotSize:number;lineWeight:number;transform:SourceBouncingTransform;backgroundColor:number;boundaryColor:string;palette:SourceBouncingPalette;
}
export interface SourceBouncingVisualImportFacts {configuration:SourceBouncingVisualConfiguration;consumedPaths:string[][];numericPaths:string[][];diagnostics:string[];}
export interface SourceBouncingDisplay {
 radius:number;speedScale:number;paletteCount:number;paletteRgb:Float32Array;
 transform:SourceBouncingTransform;backgroundColor:number;
 /** Effective stroke(R,G,B,210): source parsed alpha is discarded. */
 boundaryPackedColor:number;boundaryStrokeWeight:number;diagnostics:readonly string[];
}
/** Json Bouncing never reads these settings. Scene.showTrails alone does not
 * enable accumulation; there are no particle trail buffers in this mobject.
 * The separate native application's accumulation UI is outside JSON import. */
export const SOURCE_BOUNCING_TRAIL_FACTS=Object.freeze({showTrails:true,trailLifetime:4,fadeTrails:false,fadePoints:false,useAccumulationBuffer:false,accumulationFadeAlpha:6});
const F=Math.fround;
const object=(raw:unknown):raw is Record<string,unknown>=>raw!==null&&typeof raw==='object'&&!Array.isArray(raw);
class Failure extends Error {constructor(readonly detail:SourceBouncingError){super(detail.reason);}}
function fail(kind:SourceBouncingError['kind'],path:readonly string[],reason:string):never{throw new Failure({kind,path,reason});}
function attempt<T>(fn:()=>T):SourceBouncingResult<T>{try{return{ok:true,value:fn()};}catch(error){if(error instanceof Failure)return{ok:false,error:error.detail};throw error;}}
function fields(raw:Record<string,unknown>,keys:readonly string[],path:readonly string[]){if(Object.keys(raw).length!==keys.length||keys.some(key=>!Object.hasOwn(raw,key)))fail('input',path,'源显示配置字段缺失或包含未知字段');}
function finite(raw:unknown,path:readonly string[]):number{if(typeof raw!=='number')fail('input',path,'必须为数值');const value=F(raw);if(!Number.isFinite(value))fail('nonfinite',path,'源显示值必须为有限 Float32');return value;}
function text(raw:unknown,path:readonly string[]):string{if(typeof raw!=='string')fail('input',path,'必须为字符串');if(raw.length>SOURCE_COLOR_TEXT_BUDGET)fail('capacity',path,'颜色文本超过本地 1 MiB 预算');return raw;}
function colors(raw:unknown):string[]{if(!Array.isArray(raw))fail('input',['palette'],'源 palette 必须为数组');if(raw.length>SOURCE_BOUNCING_VISUAL_LIMITS.paletteColors)fail('capacity',['palette'],'色板超过本地 65536 色预算');let size=0;return Array.from(raw,(value,i)=>{const color=text(value,['palette',String(i)]);size+=color.length;if(size>SOURCE_COLOR_TEXT_BUDGET)fail('capacity',['palette'],'色板文本超过本地 1 MiB 预算');return color;});}
/** The display and inspector share this source recovery rule. The caller
 * retains the authored string; decoding is never a replacement serialization. */
export function sourceBouncingPaletteColor(raw:string):{packed:number;valid:boolean}{
 try{return{packed:sourceConfigPackedColor(raw),valid:true};}catch(error){if(!(error instanceof SourceConfigColorError))throw error;return{packed:0xffffffff,valid:false};}
}
function packed(raw:string,path:string,diagnostics:string[]):number{const result=sourceBouncingPaletteColor(raw);if(!result.valid)diagnostics.push(`${path}: 源颜色解析失败，采用白色；调用者保留原文。`);return result.packed;}
function defaults():SourceBouncingVisualConfiguration{return{model:SOURCE_BOUNCING_VISUAL_MODEL,settingsPresence:'absent',dotSize:1.25,lineWeight:1,transform:{scaleX:360,scaleY:360,scaleZ:1,offsetX:0,offsetY:0,offsetZ:0},backgroundColor:0xff000000,boundaryColor:'#FFFFFF',palette:{kind:'absent'}};}
const transforms={scaleX:'scale_x',scaleY:'scale_y',scaleZ:'scale_z',offsetX:'offset_x',offsetY:'offset_y',offsetZ:'offset_z'} as const;
/** Visual projection only. Palette is parsed before settings, matching the
 * native superclass call; initialization and camera remain separate owners. */
export function importSourceBouncingVisualConfig(rawRoot:unknown,options:SourceBouncingImportOptions={}):SourceBouncingResult<SourceBouncingVisualImportFacts>{return attempt(()=>{
 if(!object(rawRoot))fail('input',[],'源配置必须为对象');
 const configuration=defaults(),consumedPaths:string[][]=[],numericPaths:string[][]=[],diagnostics:string[]=[];
 if(Object.hasOwn(rawRoot,'palette')){configuration.palette={kind:'colors',colors:colors(rawRoot.palette)};consumedPaths.push(['palette']);for(let i=0;i<configuration.palette.colors.length;i++)packed(configuration.palette.colors[i],`palette.${i}`,diagnostics);}
 if(!Object.hasOwn(rawRoot,'settings'))return{configuration,consumedPaths,numericPaths,diagnostics};
 if(!object(rawRoot.settings))fail('input',['settings'],'源 settings 必须为对象');const raw=rawRoot.settings;configuration.settingsPresence='object';if(!Object.keys(raw).length)consumedPaths.push(['settings']);
 const read=(key:string)=>{if(Object.hasOwn(raw,key)){consumedPaths.push(['settings',key]);if(typeof raw[key]==='number')numericPaths.push(['settings',key]);}return raw[key];};
 const scalar=(key:string,fallback:number)=>{const value=read(key);if(value===undefined||value===null)return fallback;const parsed=prepareDomainSourceScalar(value,{fallback:0,precision:'float32'});if(!parsed.ok)fail('capacity',['settings',key],JSON.stringify(parsed.error));if(parsed.facts.route==='fallback')diagnostics.push(`settings.${key}: 源表达式解析失败，返回 0。`);return finite(parsed.facts.value,['settings',key]);};
 const string=(key:string,fallback:string)=>{const path=['settings',key],parsed=prepareRootsSourceJsonString(read(key),fallback,options.numberToken?.(path));if(!parsed.ok)fail(parsed.error.kind==='capacity'?'capacity':'input',path,JSON.stringify(parsed.error));if(parsed.value.status!=='known')fail('input',path,'源 Java 字符串转换尚无法确定：'+parsed.value.reason);return text(parsed.value.value,path);};
 configuration.dotSize=scalar('dot_size',configuration.dotSize);configuration.lineWeight=scalar('line_weight',configuration.lineWeight);
 for(const key of Object.keys(transforms) as (keyof SourceBouncingTransform)[])configuration.transform[key]=scalar(transforms[key],configuration.transform[key]);
 configuration.backgroundColor=packed(string('background_color','#000000'),'settings.background_color',diagnostics);
 configuration.boundaryColor=string('boundary_color',configuration.boundaryColor);
 return{configuration,consumedPaths,numericPaths,diagnostics};
});}
export function parseSourceBouncingVisualConfiguration(raw:unknown):SourceBouncingResult<SourceBouncingVisualConfiguration>{return attempt(()=>{
 if(!object(raw))fail('input',[],'源显示配置必须为对象');fields(raw,['model','settingsPresence','dotSize','lineWeight','transform','backgroundColor','boundaryColor','palette'],[]);
 if(raw.model!==SOURCE_BOUNCING_VISUAL_MODEL)fail('input',['model'],'未知显示版本');if(raw.settingsPresence!=='absent'&&raw.settingsPresence!=='object')fail('input',['settingsPresence'],'未知 settings 状态');
 if(!object(raw.transform))fail('input',['transform'],'必须为对象');fields(raw.transform,Object.keys(transforms),['transform']);const transform={...defaults().transform};for(const key of Object.keys(transforms) as (keyof SourceBouncingTransform)[])transform[key]=finite(raw.transform[key],['transform',key]);
 if(typeof raw.backgroundColor!=='number'||!Number.isInteger(raw.backgroundColor)||raw.backgroundColor<0||raw.backgroundColor>0xffffffff)fail('input',['backgroundColor'],'必须为 uint32 ARGB');
 if(!object(raw.palette))fail('input',['palette'],'必须为色板对象');let palette:SourceBouncingPalette;
 if(raw.palette.kind==='absent'){fields(raw.palette,['kind'],['palette']);palette={kind:'absent'};}else if(raw.palette.kind==='colors'){fields(raw.palette,['kind','colors'],['palette']);palette={kind:'colors',colors:colors(raw.palette.colors)};}else fail('input',['palette','kind'],'未知色板状态');
 return{model:SOURCE_BOUNCING_VISUAL_MODEL,settingsPresence:raw.settingsPresence,dotSize:finite(raw.dotSize,['dotSize']),lineWeight:finite(raw.lineWeight,['lineWeight']),transform,backgroundColor:raw.backgroundColor,boundaryColor:text(raw.boundaryColor,['boundaryColor']),palette};
});}
/** Sole conversion from canonical display settings into native uniform facts.
 * displayScale is the source viewport-height ratio, not pixel density. Radius
 * below 1 remains here because the vertex shader applies its own second max. */
export function prepareSourceBouncingDisplay(visual:SourceBouncingVisualConfiguration,initial:{initialSpeed:number},displayScale=1):SourceBouncingResult<SourceBouncingDisplay>{return attempt(()=>{
 const parsed=parseSourceBouncingVisualConfiguration(visual);if(!parsed.ok)fail(parsed.error.kind,parsed.error.path,parsed.error.reason);const c=parsed.value;
 const speed=finite(initial.initialSpeed,['initialSpeed']),scale=finite(displayScale,['displayScale']),diagnostics:string[]=[];
 const effective=c.palette.kind==='absent'?SOURCE_BOUNCING_DEFAULT_PALETTE:c.palette.colors.slice(0,25).map((color,i)=>packed(color,`palette.${i}`,diagnostics));
 const paletteCount=Math.max(1,Math.min(25,effective.length)),paletteRgb=new Float32Array(75);
 for(let i=0;i<25;i++){const color=effective.length?effective[Math.min(i,effective.length-1)]:0xffffffff;paletteRgb[i*3]=F(((color>>>16)&255)/255);paletteRgb[i*3+1]=F(((color>>>8)&255)/255);paletteRgb[i*3+2]=F((color&255)/255);}
 // Preserve native derived infinity (e.g. reciprocal of the least positive
 // Float32); the shader or renderer capability boundary owns its admission.
 const radius=F(Math.max(1,c.dotSize)*scale),speedScale=speed<=0?1:F(1/speed);
 const boundaryStrokeWeight=Math.max(1,F(c.lineWeight*F(1.6)));
 return{radius,speedScale,paletteCount,paletteRgb,transform:c.transform,backgroundColor:c.backgroundColor,boundaryPackedColor:((sourceBouncingBoundaryPackedColor(c.boundaryColor)&0xffffff)|0xd2000000)>>>0,boundaryStrokeWeight,diagnostics};
});}
