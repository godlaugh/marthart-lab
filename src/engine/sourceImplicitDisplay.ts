import type {GenerateContext} from '../types';
import {parseSourceDrawingViewport,type SourceDrawingViewport} from './sourceDrawingViewport';

/** A planned source display on one numerical Mobject. This is not a native
 * render acknowledgement. Consumers replay its viewport without consuming
 * the numerical owner's dirty state a second time. */
export interface SourceImplicitDisplay {
 readonly model:'mathart-1.7.8-mesh-display-v1';
 readonly instance:string;
 readonly displayIndex:number;
 readonly meshRevision:number;
 readonly rebuilt:boolean;
 readonly viewport:SourceDrawingViewport;
}
type Size=readonly [number,number];
type DisplayContext=Pick<GenerateContext,'width'|'height'|'sourceViewport'|'sourcePointPixelDensity'>&{sourceImplicitPrimarySize?:Size};
function size(value:unknown,label:string):Size {
 if(!Array.isArray(value)||value.length!==2||value.some(v=>!Number.isSafeInteger(v)||v<=0||v>16384))throw Error(`隐式 ${label} 需要已知的正整数物理尺寸`);
 return Object.freeze([value[0],value[1]]) as Size;
}
/** Primary dimensions are actual logical PGraphics dimensions times density,
 * never the reduced preview-generation width or an export aspect ratio. */
export function sourceImplicitPrimarySize(context:DisplayContext):Size {
 if(context.sourceViewport?.target==='primary'){
  const density=context.sourcePointPixelDensity;
  if(!Number.isSafeInteger(density)||density!<=0)throw Error('隐式主视口缺少整数像素密度');
  return size([context.sourceViewport.logicalWidth*density!,context.sourceViewport.logicalHeight*density!],'主视口');
 }
 return size(context.sourceImplicitPrimarySize,'离屏显示的主视口');
}
function targetSize(context:DisplayContext):Size {
 if(context.sourceViewport?.target==='primary')return sourceImplicitPrimarySize(context);
 if(context.sourceViewport?.target!=='offscreen')throw Error('隐式显示缺少明确目标');
 return size([context.width,context.height],'离屏目标');
}
export function sourceImplicitDisplayViewport(context:DisplayContext,rebuilt:boolean):SourceDrawingViewport {
 const [width,height]=rebuilt?sourceImplicitPrimarySize(context):targetSize(context);
 const parsed=parseSourceDrawingViewport([0,0,width,height]);if(!parsed.ok)throw Error(parsed.error.reason);return parsed.value;
}
export function validateSourceImplicitDisplay(value:unknown,context?:DisplayContext):SourceImplicitDisplay {
 const v=value as SourceImplicitDisplay|undefined;
 if(!v||v.model!=='mathart-1.7.8-mesh-display-v1'||typeof v.instance!=='string'||!v.instance||!Number.isSafeInteger(v.displayIndex)||v.displayIndex<1||!Number.isSafeInteger(v.meshRevision)||v.meshRevision<1||typeof v.rebuilt!=='boolean')throw Error('隐式显示事实无效');
 const parsed=parseSourceDrawingViewport(v.viewport);if(!parsed.ok||parsed.value[0]!==0||parsed.value[1]!==0)throw Error('隐式绘制视口无效');
 size(parsed.value.slice(2),'绘制视口');
 if(context&&sourceImplicitDisplayViewport(context,v.rebuilt).some((n,i)=>n!==v.viewport[i]))throw Error('隐式显示事实与当前目标不匹配');
 return v;
}
/** Constructor's eager build is followed by GenericScene.construct's setter,
 * which makes even a same-mode object dirty again. A successful registered
 * parameter write dirties it even when the numerical value is unchanged. */
export class SourceImplicitDisplayOwner {
 readonly instance=crypto.randomUUID();
 private revision=1;private index=0;private dirty=true;
 private pending?:SourceImplicitDisplay;
 markDirty():void {
  if(this.pending)throw Error('隐式显示准备后不能写入网格');
  if(!Number.isSafeInteger(this.revision+1))throw Error('隐式网格版本超出安全整数');
  this.revision++;this.dirty=true;
 }
 /** Existing queue hook consumes only historical replay displays. The final
  * display is committed after its real geometry producer succeeds. */
 consumeHistoricalDisplay():void {
  if(this.pending)throw Error('隐式历史显示不能覆盖待提交显示');
  if(!Number.isSafeInteger(this.index+1))throw Error('隐式显示序号超出安全整数');
  this.index++;this.dirty=false;
 }
 prepare(context:DisplayContext):SourceImplicitDisplay {
  const viewport=sourceImplicitDisplayViewport(context,this.dirty);
  if(this.pending){
   if(this.pending.viewport.some((n,i)=>n!==viewport[i]))throw Error('隐式显示重试不能更换绘制视口');
   return this.pending;
  }
  if(!Number.isSafeInteger(this.index+1))throw Error('隐式显示序号超出安全整数');
  return this.pending=Object.freeze({model:'mathart-1.7.8-mesh-display-v1',instance:this.instance,displayIndex:this.index+1,meshRevision:this.revision,rebuilt:this.dirty,viewport});
 }
 commit(display:SourceImplicitDisplay):void {
  if(display!==this.pending)throw Error('隐式显示不属于当前待提交事务');
  this.index=display.displayIndex;this.dirty=false;this.pending=undefined;
 }
 /** Stop may abandon a failed offscreen materialization and display the same
  * numerical frame on primary. No successful display was consumed. */
 abandonPreparedDisplay():void {this.pending=undefined;}
 /** Capture and paired primary publication form one synchronous producer
  * transaction. A failed second geometry production cannot half-consume it. */
 transaction<T>(run:()=>T):T {
  const before={revision:this.revision,index:this.index,dirty:this.dirty,pending:this.pending};
  try{return run();}catch(error){this.revision=before.revision;this.index=before.index;this.dirty=before.dirty;this.pending=before.pending;throw error;}
 }
}
