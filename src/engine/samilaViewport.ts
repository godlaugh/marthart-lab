import {usesSamilaSourceProjection,prepareSamilaNdcProjection,SAMILA_SOURCE_PROJECTION_MODEL,samilaNdcDensityViewport} from './samilaProjection';
import type {SceneDocument,RuntimeSamilaViewport,DensityBounds,SceneOutput,SamilaViewportTransform} from '../types';
import {samilaCameraEnabled} from './samilaCamera';
import {iteratedBaselineKey,identity,inputScene} from './iteratedIdentity';
import {numberSetting} from './expression';
import {sceneAtTime} from './timeline';

export const SAMILA_VIEWPORT_MODEL='samila-runtime-viewport-v1' as const;
export type SamilaViewportCommit=(expected:SceneDocument,view:RuntimeSamilaViewport,begin:boolean)=>SceneDocument|undefined;
/** The editor accepts only the document that started/continued this gesture.
 * A delayed pointer event cannot overwrite a new formula, project or undo. */
export function commitSamilaViewport(current:SceneDocument,expected:SceneDocument,view:RuntimeSamilaViewport):SceneDocument|undefined {
 if(current!==expected)return;
 const next={...current,runtimeSamilaViewport:view};
 if(!readSamilaViewport(next))return;
 return next;
}
/** Saving may assign a new artwork ID, but does not end the current temporary
 * view. Transfer only after checking that persistence kept all sampled inputs. */
export function retainSamilaViewportOnSave(source:SceneDocument,saved:SceneDocument):SceneDocument {
 const view=readSamilaViewport(source);
 if(!view||identity(inputScene(source),0,0)!==identity(inputScene(saved),0,0))return saved;
 return{...saved,runtimeSamilaViewport:{...view,baselineKey:iteratedBaselineKey(saved)}};
}
const finite=(n:number)=>Number.isFinite(n);
function bounds(value:DensityBounds):DensityBounds {
 if(!value||![value.minX,value.maxX,value.minY,value.maxY].every(finite)||value.maxX<=value.minX||value.maxY<=value.minY||!finite(value.maxX-value.minX)||!finite(value.maxY-value.minY))throw Error('Samila 临时视图边界无效');
 return {...value};
}
/** Runtime ownership is checked against the same sampled input owner as the
 * accumulator. Tone-only edits retain the view; mathematical edits invalidate it.
 * Object identity is never used as proof across the worker boundary. */
export function readSamilaViewport(scene:SceneDocument):RuntimeSamilaViewport|undefined {
 const value=scene.runtimeSamilaViewport;if(!value)return;
 if(value.model!==SAMILA_VIEWPORT_MODEL||typeof value.baselineKey!=='string'||!Number.isSafeInteger(value.revision)||value.revision<1||value.revision>0xffffffff||![value.at,value.scaleX,value.scaleY,value.offsetX,value.offsetY].every(finite)||value.at<0||value.at>86400)throw Error('Samila 临时视图无效');
 if(value.projectionModel!==undefined&&value.projectionModel!==SAMILA_SOURCE_PROJECTION_MODEL)throw Error('Samila 临时视图投影模型无效');
 const source=usesSamilaSourceProjection(scene);
 if(value.projectionModel!==(source?SAMILA_SOURCE_PROJECTION_MODEL:undefined))return;
 const view={...value,bounds:source?samilaNdcDensityViewport().bounds:bounds(value.bounds)};
 if(!samilaCameraEnabled(scene)||value.baselineKey!==iteratedBaselineKey(scene))return;
 return view;
}
/** Snapshot of one delivered mathematical image. UI interaction must also bind
 * the source document identity before accepting this snapshot. */
export function captureSamilaViewport(scene:SceneDocument,output:SceneOutput):Omit<RuntimeSamilaViewport,'revision'> {
 if(!samilaCameraEnabled(scene)||output.type!=='raster'||!output.samilaView||!output.samilaViewportTransform||!output.density)throw Error('请等待 Samila 相机画面完成后再调整视图');
 const transform=output.samilaViewportTransform,source=usesSamilaSourceProjection(scene);
 if(source&&(output.density.bounds.minX!==-1||output.density.bounds.maxX!==1||output.density.bounds.minY!==-1||output.density.bounds.maxY!==1))throw Error('源 Samila 画面尚未使用固定 NDC 视口');
 return{model:SAMILA_VIEWPORT_MODEL,baselineKey:iteratedBaselineKey(scene),at:output.samilaView.time,
  ...transform,...(source?{projectionModel:SAMILA_SOURCE_PROJECTION_MODEL}:{}),bounds:bounds(output.density.bounds)};
}
export function samilaViewportTransform(scene:SceneDocument):SamilaViewportTransform {const source=prepareSamilaNdcProjection(scene);if(source){const{scaleX,scaleY,offsetX,offsetY}=source;return{scaleX,scaleY,offsetX,offsetY};}const s=scene.settings;return{scaleX:numberSetting(s,'scaleX',1),scaleY:numberSetting(s,'scaleY',1),offsetX:numberSetting(s,'offsetX',0),offsetY:numberSetting(s,'offsetY',0)};}
export type SamilaViewportGesture={kind:'pan';dx:number;dy:number;width:number;height:number}|{kind:'zoom';wheelCount:number};
/** Pan has screen-aligned offsets; zoom multiplies both axes around the origin.
 * The browser adapter normalizes wheel units to counts. It is not pointer zoom.
 * Finite validation is local protection, not a claim about native float overflow. */
export function navigateSamilaViewport(captured:Omit<RuntimeSamilaViewport,'revision'>,gesture:SamilaViewportGesture,revision:number):RuntimeSamilaViewport {
 const source=captured.projectionModel===SAMILA_SOURCE_PROJECTION_MODEL;
 if(captured.projectionModel!==undefined&&!source)throw Error('Samila 临时视图投影模型无效');
 let {scaleX,scaleY,offsetX,offsetY}=captured;const b=source?samilaNdcDensityViewport().bounds:bounds(captured.bounds),F=Math.fround;
 if(source){scaleX=F(scaleX);scaleY=F(scaleY);offsetX=F(offsetX);offsetY=F(offsetY);}
 if(gesture.kind==='pan'){
  if(![gesture.dx,gesture.dy,gesture.width,gesture.height].every(finite)||gesture.width<=0||gesture.height<=0)throw Error('Samila 手势尺寸或位移无效');
  if(source){
   // addViewportScreenDelta(DDFF): double delta / float logical size,
   // multiply by two, then float delta and float accumulator addition.
   offsetX=F(offsetX+F(gesture.dx/F(gesture.width)*2));offsetY=F(offsetY+F(-gesture.dy/F(gesture.height)*2));
  }else{offsetX+=gesture.dx/gesture.width*(b.maxX-b.minX);offsetY-=gesture.dy/gesture.height*(b.maxY-b.minY);}
 }else{
  if(!finite(gesture.wheelCount))throw Error('Samila 滚轮输入无效');
  const factor=Math.pow(F(1.05),-(source?F(gesture.wheelCount):gesture.wheelCount));
  if(source){scaleX=F(scaleX*F(factor));scaleY=F(scaleY*F(factor));}else{scaleX*=factor;scaleY*=factor;}
 }
 if(![scaleX,scaleY,offsetX,offsetY].every(finite)||!Number.isInteger(revision)||revision<1||revision>0xffffffff)throw Error('Samila 临时视图超出数值范围');
 return{...captured,bounds:b,revision,scaleX,scaleY,offsetX,offsetY};
}
/** Build a one-time effective input for the existing CPU/GPU producer. The
 * authored seed, start time and geometry are never mutated. A new hot epoch
 * clears at the delivered time and samples one batch (or zero with record off).
 * Seeking before it reconstructs at the requested time, never future-labeled ink.
 * Saving strips runtime facts; image export can pass this exact captured scene. */
export interface PreparedSamilaViewport {scene:SceneDocument;key?:string;revision?:number;bounds?:DensityBounds;atTime:(time:number)=>SceneDocument;}
export function applySamilaViewport(scene:SceneDocument,time:number):PreparedSamilaViewport {
 const view=readSamilaViewport(scene);if(!view)return{scene,atTime:at=>sceneAtTime(scene,at)};
 if(!finite(time)||time<0||time>86400)throw Error('Samila 临时视图时间无效');
 const s=scene.settings,start=Math.max(numberSetting(s,'iteratedStartTime',0,0,86400),Math.min(view.at,time));
 const effective={...scene,settings:{...s,iteratedStartTime:start}};
 // Source geometry is a temporary absolute override. Local geometry tracks
 // resume on reset; they cannot silently overwrite a mouse gesture. Mutating
 // this fresh evaluated snapshot preserves the timeline's camera facts.
 const key=JSON.stringify([view.revision,view.at,view.scaleX,view.scaleY,view.offsetX,view.offsetY,view.bounds,view.projectionModel]);
 return{scene:effective,key,revision:view.revision,bounds:view.bounds,atTime:at=>{const frame=sceneAtTime(effective,at);Object.assign(frame.settings,{scaleX:view.scaleX,scaleY:view.scaleY,offsetX:view.offsetX,offsetY:view.offsetY});return frame;}};
}
