import type {GradientAnimation} from '../types';

export interface SourceParticleGradientConfiguration extends GradientAnimation {
 readonly model:'offsets';
 readonly affectInside:true;
 readonly affectOutside:true;
}
export class SourceParticleGradientConfigurationError extends Error {
 constructor(readonly code:'input'|'capacity',message:string){super(message);this.name='SourceParticleGradientConfigurationError';}
}
export const SOURCE_PARTICLE_GRADIENT_MODES=Object.freeze(['hue_rotate','offset_cycle','palette_morph','cross_fade'] as const);
export const SOURCE_PARTICLE_GRADIENT_INTERPOLATIONS=Object.freeze(['rgb','linear','oklab','oklch'] as const);
export const SOURCE_PARTICLE_GRADIENT_DEFAULT:SourceParticleGradientConfiguration=Object.freeze({model:'offsets',mode:'hue_rotate',interpolation:'oklab',speed:60,affectInside:true,affectOutside:true});
const modes:readonly string[]=SOURCE_PARTICLE_GRADIENT_MODES,interpolations:readonly string[]=SOURCE_PARTICLE_GRADIENT_INTERPOLATIONS;
const object=(raw:unknown):raw is Record<string,unknown>=>raw!==null&&typeof raw==='object'&&!Array.isArray(raw);
const own=(raw:Readonly<Record<string,unknown>>,key:string):unknown=>Object.hasOwn(raw,key)?raw[key]:undefined;
const fail=(message:string):never=>{throw new SourceParticleGradientConfigurationError('input',message);};

/** Saved configuration never acquires source defaults. Optional GradientAnimation
 * markers are normalized, but conflicting models/flags and unrelated fields fail. */
export function parseSourceParticleGradientConfiguration(raw:unknown):SourceParticleGradientConfiguration {
 if(!object(raw))return fail('粒子渐变配置必须为对象');
 if(Object.keys(raw).some(key=>!['model','mode','interpolation','speed','affectInside','affectOutside'].includes(key)))return fail('粒子渐变配置含未知字段');
 const mode=own(raw,'mode'),interpolation=own(raw,'interpolation'),speed=own(raw,'speed');
 if(typeof mode!=='string'||!modes.includes(mode)||typeof interpolation!=='string'||!interpolations.includes(interpolation))return fail('粒子渐变模式或插值无效');
 if(typeof speed!=='number'||!Number.isFinite(speed)||speed<0)return fail('粒子渐变速度必须为有限非负数值');
 if(own(raw,'model')!==undefined&&own(raw,'model')!=='offsets')return fail('粒子源渐变只接受 offsets 模型');
 if(own(raw,'affectInside')!==undefined&&own(raw,'affectInside')!==true||own(raw,'affectOutside')!==undefined&&own(raw,'affectOutside')!==true)return fail('粒子源渐变始终同时作用于两侧');
 return {model:'offsets',mode:mode as GradientAnimation['mode'],interpolation:interpolation as GradientAnimation['interpolation'],speed,affectInside:true,affectOutside:true};
}
