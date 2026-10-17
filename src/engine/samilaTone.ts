import type {ControlSpec,Settings} from '../types';
import {numberSetting} from './expression';

/** Completed accumulator facts, never reconstructed from UI time or mass. */
export interface SamilaToneFacts {
 kind:'samila';historyModel:'bounded-v2';width:number;height:number;
 completedPasses:number;baseBatchSize:number;alpha:number;combinedDecay:number;
 splat:{model:'local-feathered-disc-v1';radiusPixels:number};
}
export interface SamilaNormalization extends SamilaToneFacts {nominalRadius:number;scale:number;}
export type SamilaToneBranch='palette-average'|'yuv-average';
/** Local new-work defaults follow the base constructor; JSON settings-object
 * defaults are a distinct import rule owned by samilaToneImport. */
export const samilaToneParameterSpecs={
 brightness:{key:'normalizedBrightness',fallback:.5,min:-.5,max:1.5,label:'归一亮度'},
 contrast:{key:'normalizedContrast',fallback:1,min:.1,max:2,label:'归一对比度'},
 gamma:{key:'normalizedGamma',fallback:2.2,min:.1,max:10,label:'归一伽马'},
 dynamicRange:{key:'normalizedDynamicRange',fallback:.5,min:.1,max:1,label:'平滑限制形状'},
 saturation:{key:'normalizedSaturation',fallback:.8,min:0,max:1,label:'归一饱和度'},
} as const;
const defaults:Settings={...Object.fromEntries(Object.values(samilaToneParameterSpecs).map(p=>[p.key,p.fallback])),samilaToneBranch:'palette-average'};
/** Switching back to v1 restores its authored controls; no live radius copy or
 * ambient reference viewport is persisted. History/tone opt-in is atomic. */
export function initializeSamilaTone(settings:Settings):Settings {
 if(settings.iteratedMode!=='continuous')throw new Error('Samila 归一调色需要持续批次密度');
 return{...defaults,...settings,samilaHistoryModel:'bounded-v2',densityToneModel:'samila-normalized-v2'};
}
export function samilaToneControlSettings(settings:Settings):Settings {
 return settings.densityToneModel==='samila-normalized-v2'?{...defaults,...settings}:settings;
}
export function parseSamilaToneBranch(settings:Settings):SamilaToneBranch {
 const branch=settings.samilaToneBranch??'palette-average';
 if(branch!=='palette-average'&&branch!=='yuv-average')throw new Error('Samila 调色分支无效');
 return branch;
}
const dimension=(n:number)=>Number.isInteger(n)&&n>=1&&n<=16384;
/** Source scale uses nominal r, not an independently sampled current mass. Our
 * nominal radius is explicitly adapted from the local disc's actual pixel
 * radius; native point/quad edge kernels are not claimed to be equivalent. */
export function deriveSamilaNormalization(facts:SamilaToneFacts):SamilaNormalization {
 if(facts.kind!=='samila'||facts.historyModel!=='bounded-v2'||facts.splat?.model!=='local-feathered-disc-v1')throw new Error('Samila 归一调色需要 bounded-v2 累积事实');
 if(!dimension(facts.width)||!dimension(facts.height)||!Number.isSafeInteger(facts.completedPasses)||facts.completedPasses<0||!Number.isSafeInteger(facts.baseBatchSize)||facts.baseBatchSize<1)throw new Error('Samila 归一调色批次或尺寸事实无效');
 if(![facts.alpha,facts.combinedDecay].every(v=>Number.isFinite(v)&&v>=0&&v<=1)||!Number.isFinite(facts.splat.radiusPixels)||facts.splat.radiusPixels<=0)throw new Error('Samila 归一调色权重、衰减或点半径无效');
 const nominalRadius=facts.splat.radiusPixels*1080/facts.height;
 const b=facts.baseBatchSize*facts.alpha*Math.PI*nominalRadius*nominalRadius/(facts.width*facts.height);
 let scale=b*Math.sqrt(Math.max(1,facts.completedPasses)*60);
 // This threshold is the retained source float constant; the independent
 // calculation otherwise uses double and GPU consumes the single parsed scale.
 if(facts.combinedDecay<Math.fround(.999))scale=Math.min(scale,Math.min(b/Math.max(1-facts.combinedDecay,1e-10),300)/8);
 if(!Number.isFinite(scale)||!Number.isFinite(nominalRadius))throw new Error('Samila 归一调色尺度超出有限范围');
 return{...facts,splat:{...facts.splat},nominalRadius,scale:Math.max(scale,1e-8)};
}
/** Positive source Samila limit. Map/Symmetry intentionally retain their own
 * complemented curve. Softplus avoids overflow for extreme finite densities. */
export function samilaDensityValue(logDensity:number,contrast:number,brightness:number,shape:number):number {
 const q=2*(contrast*logDensity/Math.log(1000)+brightness)-1;
 if(q===0)return .5;
 const k=Math.max(shape,.01),x=-Math.log(Math.abs(q))/k;
 const limited=Math.exp(-k*(Math.max(x,0)+Math.log1p(Math.exp(-Math.abs(x)))));
 return .5+.5*Math.sign(q)*limited;
}
export function samilaToneParameters(settings:Settings){
 if(settings.samilaHistoryModel!=='bounded-v2')throw new Error('Samila 归一调色需要先启用 bounded-v2 历史');
 const read=(name:keyof typeof samilaToneParameterSpecs)=>{const p=samilaToneParameterSpecs[name];return numberSetting(settings,p.key,p.fallback,p.min,p.max);};
 return{branch:parseSamilaToneBranch(settings),brightness:read('brightness'),contrast:read('contrast'),gamma:read('gamma'),dynamicRange:read('dynamicRange'),saturation:read('saturation')};
}
const n=(key:string,label:string,min:number,max:number,step:number,help?:string):ControlSpec=>({key,label,type:'number',min,max,step,help,group:'Samila 归一调色'});
export const samilaToneControls:ControlSpec[]=[
 {key:'samilaToneBranch',label:'Samila 调色分支',type:'select',options:[{value:'palette-average',label:'色板均值 · 背景混合'},{value:'yuv-average',label:'YUV 均值 · 密度亮度'}],group:'Samila 归一调色',help:'两种分支都使用实际累积的颜色；此选择不改变样本配色或历史。'},
 ...Object.values(samilaToneParameterSpecs).map(p=>n(p.key,p.label,p.min,p.max,.01)),
];
