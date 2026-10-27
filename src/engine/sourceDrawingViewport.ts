import type {SourceDrawingResult} from './sourceDrawingSnapshot';
/** Physical GL viewport, independent of target allocation and readback dimensions.
 * Zero extent is legal GL state. Hardware limits are checked by the receiver. */
export type SourceDrawingViewport=readonly [x:number,y:number,width:number,height:number];
export const SOURCE_DRAWING_VIEWPORT_ENVELOPE_BYTES=20;
export function isSourceDrawingViewport(value:unknown):value is SourceDrawingViewport {
 return Array.isArray(value)&&value.length===4&&[0,1,2,3].every(i=>{const n=value[i];return Number.isInteger(n)&&n>=(i<2?-0x80000000:0)&&n<=0x7fffffff;});
}
/** Own a validated immutable copy before asynchronous work or storing facts. */
export function parseSourceDrawingViewport(value:unknown):SourceDrawingResult<SourceDrawingViewport> {
 if(!isSourceDrawingViewport(value))return {ok:false,error:{kind:'input',path:['viewport'],reason:'物理 viewport 必须为 int32 原点和非负 GLsizei 尺寸'}};
 return {ok:true,value:Object.freeze([...value]) as SourceDrawingViewport};
}
