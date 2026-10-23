import type {SourceBouncingUpdate} from './sourceBouncingGpu';
/** Resource identity is independent of transport generation/sequence. */
export type SourceBouncingOperation=
 | {kind:'create';resource:string;particleCount:number;programBytes:number;shaders:{quad:string;update:string;vertex:string;fragment:string}}
 | {kind:'upload';resource:string;particleCount:number;programBytes:number;offset:number;particles:Float32Array}
 | {kind:'draw';resource:string;particleCount:number;programBytes:number;from:number;to:number;update:SourceBouncingUpdate}
 | {kind:'release';resource:string};
export function sourceBouncingRetainedBytes(count:number,programBytes=0):number{return Math.ceil(Math.sqrt(count))**2*32+32+programBytes;}
export function sourceBouncingProgramBytes(shaders:{vertex:string;fragment:string}):number{return (shaders.vertex.length+shaders.fragment.length)*3;}
