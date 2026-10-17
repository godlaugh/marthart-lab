import type {ControlSpec,SceneDocument,Settings} from '../types';
import {parseRootsDensityColorVersion,parseRootsSourcePalette,usesRootsSourceDensity} from './rootsDensityColor';
const n=(key:string,label:string,min:number,max:number,step=1,help?:string):ControlSpec=>({key,label,min,max,step,help,type:'number',group:'渐进复根'});
const choice=(key:string,label:string,options:[string,string][]):ControlSpec=>({key,label,type:'select',group:'渐进复根',options:options.map(([value,label])=>({value,label}))});
export const rootsDefaults:Settings={rootsMode:'single',rootTotalSamples:15000,rootSamplesPerFrame:128,rootSamplingFps:30,rootStartTime:0,rootBatchSize:256,rootSampleFilter:'all',rootFilterParameter:'t2'};
export const rootsControls:ControlSpec[]=[
 choice('rootDensityBackend','复根密度后端',[['cpu','CPU 双精度密度'],['webgl2','GPU 累积与调色']]),
 choice('rootSplat','复根点核',[['pixel','单像素'],['soft-disc','软圆盘']]),
 n('rootSplatDiameter','软圆盘像素直径',.8,64,.1,'独立像素单位；保留 CPU 双精度求根，未等同原版世界尺寸投影。'),
 choice('rootsMode','复根采样推进',[['single','单次根图'],['progressive','渐进密度']]),
 n('rootTotalSamples','总多项式样本数',1,2147483647,1000,'完整有限采样目标；未完成时可暂停播放、取消或导出当前密度。'),
 n('rootSamplesPerFrame','每个固定步的多项式数',1,100000,1,'独立求解调度，不等同于原版根点队列批大小。'),
 n('rootSamplingFps','复根固定步频率',1,120,1),n('rootStartTime','复根 Replay 起点',0,86400,.01),
 n('rootBatchSize','根点提交阈值',1,1000000,256,'只决定根点的分块提交，不改变随机样本、总数或结果。'),
 choice('rootSampleFilter','求解前参数过滤',[['all','全部参数样本'],['parameter-imag-nonnegative','参数虚部非负']]),
 {key:'rootFilterParameter',label:'过滤参数名称',type:'text',group:'渐进复根'},
 n('rootScaleY','根 Y 坐标缩放',.001,10000,.01,'留空的旧项目沿用根坐标缩放；独立设置后分别缩放 X/Y。'),
 n('rootOffsetX','根坐标偏移 X',-1e30,1e30,.01),n('rootOffsetY','根坐标偏移 Y',-1e30,1e30,.01),n('rootOffsetZ','根坐标偏移 Z',-1e30,1e30,.01),
];
const schedule=new Set(['rootDensityBackend','rootSplat','rootSplatDiameter','rootTotalSamples','rootSamplesPerFrame','rootSamplingFps','rootStartTime','rootBatchSize']);
const localTone=new Set(['toneMap','exposure','gamma','contrast','brightness','saturation','dynamicRange','paletteMode','transparentBackground','densityToneModel']);
/** Presentation applicability only; the color owner supplies all numeric facts. */
export function rootsAppearanceControlVisible(scene:Pick<SceneDocument,'kind'|'settings'>,key:string):boolean {
 return scene.kind!=='roots'||!usesRootsSourceDensity(scene.settings)||!localTone.has(key)&&!['colorMetric','pointSize','opacity','wireframe'].includes(key);
}
/** Changing versions preserves both tone families and both palettes. */
export function withRootsDensityColorVersion(scene:SceneDocument,raw:unknown):SceneDocument {
 if(scene.kind!=='roots')throw new Error('复根密度着色规则仅适用于复根场景');
 return{...scene,settings:{...scene.settings,rootDensityColorVersion:parseRootsDensityColorVersion(raw)}};
}
/** Explicit copy of authored manual colors, not a sampled/baked rich palette. */
export function copyRootsManualColors(scene:SceneDocument):SceneDocument {
 if(scene.kind!=='roots')throw new Error('复根源色板仅适用于复根场景');
 return{...scene,rootsSourcePalette:parseRootsSourcePalette({colors:[...scene.palette.stops]})};
}
/** Filters existing definition controls, preserving shared density/tone controls. */
export function visibleRootsControls(controls:readonly ControlSpec[],s:Settings):ControlSpec[]{
 const progressive=s.rootsMode==='progressive';
 const source=usesRootsSourceDensity(s);
 return controls.filter(c=>!(source&&localTone.has(c.key))&&!(c.key==='rootSplatDiameter'&&s.rootSplat!=='soft-disc')&&!(schedule.has(c.key)&&!progressive)&&!(progressive&&['sampleCount','presentation','densityAccumulation','densityLifetime','densitySamplingFps','densitySampleRate','densityDecay'].includes(c.key))&&!(c.key==='rootFilterParameter'&&s.rootSampleFilter!=='parameter-imag-nonnegative')).map(c=>source&&c.key==='rootColor'?{...c,help:'源密度取固定采样参数 t2；缺少 t2 时为 0，根半径不除以显示范围。',options:[{value:'radius',label:'根半径 · 原始度量'},{value:'t2_real',label:'t2 实部 · 原始度量'},{value:'t2_imag',label:'t2 虚部 · 原始度量'}]}:c);
}
/** Display-only effective defaults, with omission of rootScaleY retaining the
 * historical single-scale relationship. Callers must commit only edited keys. */
export function rootsControlSettings(settings:Settings):Settings{return{...rootsDefaults,rootDensityBackend:'cpu',rootSplat:'pixel',rootSplatDiameter:3,rootScaleY:settings.rootScale??1,rootOffsetX:0,rootOffsetY:0,rootOffsetZ:0,...settings};}
