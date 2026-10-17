import type {ControlSpec,SceneKind,Settings} from '../types';
import {numberSetting} from './expression';

export type NormalizedDensityKind='map'|'symmetry';
/** Facts belong to the accumulator, including the last completed batch size.
 * Presentation time and accepted pixel mass cannot reconstruct these values. */
export interface DensityNormalizationFacts {kind:NormalizedDensityKind;width:number;height:number;recordedPasses:number;batchSize:number;}
export interface DensityNormalization extends DensityNormalizationFacts {referenceWidth:number;referenceHeight:number;scale:number;}
export const NORMALIZED_DENSITY_NOTICE='归一调色使用已记录批次和保存的参考画布尺寸；保留本地采样、色板和点形状，不保证原版像素一致。';
const family=(kind:SceneKind):NormalizedDensityKind=>{if(kind!=='map'&&kind!=='symmetry')throw new Error('归一调色仅支持持续 Map 和 Symmetry');return kind;};
const dimension=(value:number)=>{if(!Number.isInteger(value)||value<1||value>16384)throw new Error('归一调色参考与输出边长须为 1–16384 的整数');return value;};
const defaults=(kind:NormalizedDensityKind):Settings=>({normalizedBrightness:kind==='map'?.3:.5,normalizedContrast:1,normalizedGamma:2.2,normalizedDynamicRange:kind==='map'?.2:.5,normalizedSaturation:.8});

/** Explicit opt-in only. Authored v1 tone fields stay intact so switching back
 * restores their meaning; the supplied actual render size is persisted. */
export function initializeNormalizedDensity(kind:SceneKind,settings:Settings,width:number,height:number):Settings {
 const selected=family(kind);dimension(width);dimension(height);
 if(settings.iteratedMode!=='continuous')throw new Error('归一调色需要持续批次密度');
 return{...defaults(selected),...settings,densityReferenceWidth:settings.densityReferenceWidth??width,densityReferenceHeight:settings.densityReferenceHeight??height,densityToneModel:'normalized-v2'};
}
/** UI display values only; this function never persists inferred defaults. */
export function densityToneControlSettings(kind:SceneKind,settings:Settings):Settings {
 if(kind!=='map'&&kind!=='symmetry'||settings.densityToneModel!=='normalized-v2')return settings;
 return{...defaults(kind),...settings};
}
export function densityToneModel(settings:Settings):'white-point-v1'|'normalized-v2'|'samila-normalized-v2' {
 const model=settings.densityToneModel??'white-point-v1';
 if(model!=='white-point-v1'&&model!=='normalized-v2'&&model!=='samila-normalized-v2')throw new Error('密度调色模型无效');
 return model;
}
export function prepareDensityNormalization(settings:Settings,facts:DensityNormalizationFacts):DensityNormalization {
 // Reference dimensions are required authored data, never an ambient viewport.
 const referenceWidth=dimension(numberSetting(settings,'densityReferenceWidth',NaN,1,16384));
 const referenceHeight=dimension(numberSetting(settings,'densityReferenceHeight',NaN,1,16384));
 return deriveDensityNormalization(facts,{referenceWidth,referenceHeight});
}
/** Binds completed accumulator facts to an already parsed reference. No settings
 * are reinterpreted after potentially expensive orbit generation. */
export function deriveDensityNormalization(facts:DensityNormalizationFacts,reference:Pick<DensityNormalization,'referenceWidth'|'referenceHeight'>):DensityNormalization {
 family(facts.kind);dimension(facts.width);dimension(facts.height);
 if(!Number.isSafeInteger(facts.recordedPasses)||facts.recordedPasses<0||!Number.isSafeInteger(facts.batchSize)||facts.batchSize<1)throw new Error('归一调色批次事实无效');
 const referenceWidth=dimension(reference.referenceWidth),referenceHeight=dimension(reference.referenceHeight);
 const area=facts.width*facts.height,factor=area/(referenceWidth*referenceHeight);
 const scale=Math.max(1,facts.recordedPasses)*facts.batchSize/area*Math.max(factor,1e-6);
 if(!Number.isFinite(scale)||scale<=0)throw new Error('归一调色尺度无效');
 return{...facts,referenceWidth,referenceHeight,scale:Math.max(scale,1e-8)};
}
/** Stable complement of the source-derived smooth limiting curve. The softplus
 * form avoids overflow in abs(q)^(1/k) without altering its finite mathematics. */
export function normalizedDensityValue(logDensity:number,contrast:number,brightness:number,shape:number):number {
 const q=2*(contrast*logDensity/Math.log(1000)+brightness)-1;
 if(q===0)return .5;
 const x=-Math.log(Math.abs(q))/shape;
 const limited=Math.exp(-shape*(Math.max(x,0)+Math.log1p(Math.exp(-Math.abs(x)))));
 return .5-.5*Math.sign(q)*limited;
}
const n=(key:string,label:string,min:number,max:number,step:number,help?:string):ControlSpec=>({key,label,type:'number',min,max,step,help,group:'归一调色'});
export const normalizedDensityControls:ControlSpec[]=[
 n('densityReferenceWidth','参考画布宽度',1,16384,1,'保存在项目中的物理像素宽度；导出与预览共用，不随窗口自动改变。'),
 n('densityReferenceHeight','参考画布高度',1,16384,1,'保存在项目中的物理像素高度；此尺寸不代表原应用的未知窗口尺寸。'),
 n('normalizedBrightness','归一亮度',-.5,1.5,.01),n('normalizedContrast','归一对比度',.1,2,.01),n('normalizedGamma','归一伽马',.1,10,.01),
 n('normalizedDynamicRange','平滑限制形状',.1,1,.01,'控制归一对数密度的平滑限制曲线；与白点密度是不同参数。'),n('normalizedSaturation','归一饱和度',0,1,.01),
];
