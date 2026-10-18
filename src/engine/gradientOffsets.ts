import {usesSourceSurfaceGeometry} from './sourceSurfaceIdentity';
import {SOURCE_SURFACE_GRADIENT_DEFAULT} from './sourceSurfaceGradientConfig';
import type {GradientAnimation,SceneDocument} from '../types';
import {validatePalette} from './palette';
import {parseDomainColorVersion} from './domainSourceColor';
import {usesRootsSourceDensity} from './rootsDensityColor';
import {authoredFractalSourceColor,usesFractalSourceColor} from './fractalSourceColorAuthoring';

export interface GradientOffsets {palette:number;inside:number;outside:number;}
const finite=(n:unknown):number=>{if(typeof n!=='number'||!Number.isFinite(n))throw new Error('渐变偏移与时间必须为有限数值');return n;};
const wrap=(n:number)=>n-Math.floor(n);
export function supportsGradientOffsets(scene:Pick<SceneDocument,'kind'|'settings'>):boolean{return scene.kind==='domain'||scene.kind==='fractal'&&scene.settings.formula!=='mandelbulb_3d'&&(scene.settings.fractalColorVersion===2||usesFractalSourceColor(scene));}
/** The selected color producer owns which palette an animation can affect.
 * Omitted legacy gradient models still mean the local palette; only newly
 * authored source-color actions receive the source offset default. */
export function gradientAnimationCapabilities(scene:Pick<SceneDocument,'kind'|'settings'>){
 const sourceSurface=usesSourceSurfaceGeometry(scene),sourceRoots=scene.kind==='roots'&&usesRootsSourceDensity(scene.settings),sourceFractal=usesFractalSourceColor(scene),localPalette=!sourceSurface&&!sourceRoots&&!sourceFractal&&(scene.kind!=='domain'||parseDomainColorVersion(scene.settings.domainColorVersion)==='local-v1');
 const defaultAnimation:GradientAnimation=sourceSurface?{...SOURCE_SURFACE_GRADIENT_DEFAULT}:localPalette||sourceRoots?{mode:'offset_cycle',speed:.1,interpolation:'rgb'}:{model:'offsets',mode:'hue_rotate',speed:60,interpolation:'oklab',affectInside:true,affectOutside:true};
 return{localPalette,offsets:sourceSurface||supportsGradientOffsets(scene),defaultAnimation,paletteOffsetTarget:sourceRoots?'settings.rootSourcePaletteOffset':sourceFractal?'fractalColor.paletteOffset':localPalette?'palette.offset':'settings.paletteOffset',
  retainedPaletteWarning:localPalette?undefined:sourceSurface?'原版曲面使用独立色板与渐变时间线；本地色板动画不参与执行。':sourceRoots?'复根源密度不消费本地色板动画；相关片段保留时间安排，可用数值动画修改原版复根色板偏移。':sourceFractal?'原版分形着色使用独立色板；本地色板动画保留，请使用内部与外部偏移动画。':'当前源着色不消费本地色板动画或 palette.offset / palette.cycles；相关动画已保留，但不会执行。请改用域偏移与循环采样。'};
}
export function isLocalPaletteAnimationTarget(target:string):boolean{return target==='palette.offset'||target==='palette.cycles';}
export function validateGradientConfig(config:GradientAnimation):void{
 if(!config||typeof config!=='object'||!['offset_cycle','hue_rotate','palette_morph','cross_fade'].includes(config.mode)||!['rgb','linear','oklab','oklch'].includes(config.interpolation))throw new Error('渐变配置无效');
 finite(config.speed);
 if(config.model!==undefined&&!['palette','offsets'].includes(config.model))throw new Error('渐变模型无效');
 for(const flag of [config.affectInside,config.affectOutside])if(flag!==undefined&&typeof flag!=='boolean')throw new Error('渐变作用区域必须为布尔值');
 if(config.model==='offsets'&&config.speed<0)throw new Error('渐变偏移速度必须非负');
}
export function readGradientOffsets(scene:SceneDocument):GradientOffsets{
 if(scene.kind==='domain'){const offset=finite(scene.settings.paletteOffset??0);return{palette:offset,inside:offset,outside:offset};}
 if(usesFractalSourceColor(scene)){const color=authoredFractalSourceColor(scene);return{palette:finite(color.palette.offset),inside:finite(color.inside.offset),outside:finite(color.outside.offset)};}
 return{palette:finite(scene.palette.offset),inside:finite(scene.settings.insideGradientOffset??scene.settings.gradientOffset??0),outside:finite(scene.settings.outsideGradientOffset??scene.settings.gradientOffset??0)};
}
/** Derived from GradientRuntimeState.buildFrameAtProgress and advance in the
 * supplied 1.7.8 classfile. The named interpolation selects a phase curve;
 * it does not interpolate RGB stops. No original runtime comparison is implied. */
export function gradientOffsetFrame(base:GradientOffsets,config:GradientAnimation,seconds:number):GradientOffsets{
 validateGradientConfig(config);Object.values(base).forEach(finite);finite(seconds);
 const progress=wrap(finite(seconds*config.speed/360)),u=wrap(progress);
 const shaped=config.interpolation==='linear'?u:config.interpolation==='oklch'?u*u*u*(u*(u*6-15)+10):u*u*(3-2*u);
 const wave=(frequency:number,phase:number)=>Math.sin((progress*frequency+phase)*2*Math.PI);
 const inside=config.affectInside??true,outside=config.affectOutside??true,both=inside&&outside;
 let p=base.palette,i=base.inside,o=base.outside;
 if(config.mode==='hue_rotate'){
  if(both)p+=shaped;else{if(inside)i+=shaped;if(outside)o+=shaped;}
 }else if(config.mode==='offset_cycle'){
  const drift=wave(.5,0)*.05;if(inside)i+=shaped+drift;if(outside)o+=shaped-drift*.5;
 }else{
  const spread=config.mode==='cross_fade'?(.5+.5*wave(1,.25))*.08:wave(.75,.35)*.06;
  if(inside)i+=shaped-spread;if(outside)o+=shaped+spread;if(both)p+=shaped;
 }
 return{palette:finite(p),inside:finite(i),outside:finite(o)};
}
/** Own parsing of optional regional palettes once per compiled timeline. A
 * global offset also moves a region with its own palette, while its local
 * offset and dormant color-stop data remain independent. */
export function compileGradientOffsets(base:SceneDocument,config:GradientAnimation):(out:SceneDocument,seconds:number)=>void{
 if(!supportsGradientOffsets(base))throw new Error('渐变偏移动画需要二维分形的独立内部与外部着色或域着色');
 validateGradientConfig(config);const initial=readGradientOffsets(base);
 // The source Domain target exposes the same value through three getters but
 // consumes only frame.palette. Its phase offset precedes palette.cycles.
 if(base.kind==='domain')return(out,seconds)=>{out.settings.paletteOffset=gradientOffsetFrame(initial,config,seconds).palette;};
 if(usesFractalSourceColor(base))return(out,seconds)=>{
  const frame=gradientOffsetFrame(initial,config,seconds),color=out.fractalSourceColor??=structuredClone(authoredFractalSourceColor(base));
  color.palette.offset=frame.palette;color.inside.offset=frame.inside;color.outside.offset=frame.outside;
 };
 const regional=(['inside','outside'] as const).flatMap(side=>{const encoded=base.settings[side+'Palette'];if(encoded===undefined)return[];if(typeof encoded!=='string'||encoded.length>262144)throw new Error('区域色板格式无效');return[{side,palette:validatePalette(JSON.parse(encoded))}];});
 return(out,seconds)=>{
  const frame=gradientOffsetFrame(initial,config,seconds);out.palette.offset=frame.palette;out.settings.insideGradientOffset=frame.inside;out.settings.outsideGradientOffset=frame.outside;
  for(const {side,palette}of regional)out.settings[side+'Palette']=JSON.stringify({...palette,offset:palette.offset+frame.palette-initial.palette});
 };
}
