import {importSourceMapFloat} from './sourceMapScalar';
import type {Settings} from '../types';
export interface SourceMapRuntimeColors {readonly colorSpeed:number;readonly colorPhase:number;}
const ranges={colorSpeed:[Math.fround(.1),2,Math.fround(.22)],colorPhase:[0,360,180]} as const;
export function isSourceMapColorTarget(name:string):name is keyof SourceMapRuntimeColors{return name==='colorSpeed'||name==='colorPhase';}
/** MapMobject's scalar target dispatch precedes the formula parameter map.
 * These Float32 setters never write same-named GLSL uniforms or seed inputs. */
export function sourceMapColorValue(name:keyof SourceMapRuntimeColors,value:number):number {
 if(!Number.isFinite(value))throw Error('源 Map 着色参数需要有限数值');
 const [min,max]=ranges[name];return Math.max(min,Math.min(max,Math.fround(value)));
}
export function sourceMapRuntimeColors(settings:Settings):SourceMapRuntimeColors {
 const read=(key:keyof SourceMapRuntimeColors)=>{const raw=settings[key]??ranges[key][2];if(typeof raw!=='number')throw Error('源 Map 着色参数需要数值');return sourceMapColorValue(key,raw);};
 return Object.freeze({colorSpeed:read('colorSpeed'),colorPhase:read('colorPhase')});
}

/** ProjectState reads Java float literals; direct JsonMap config additionally
 * accepts ConfigUtils expressions. Keep these entry points distinct. */
export function importSourceMapColor(name:keyof SourceMapRuntimeColors,raw:unknown,entry:'project'|'runtime-config',numberToken?:string):{ok:true;value:number}|{ok:false;reason:string}{
 const parsed=importSourceMapFloat(raw,ranges[name][2],entry,numberToken);if(!parsed.ok)return parsed;const value=parsed.value;
 if(Number.isNaN(value))return{ok:false,reason:'源 Map 着色标量为 NaN，不能保存'};
 const [min,max]=ranges[name];return{ok:true,value:Math.max(min,Math.min(max,value))};
}
