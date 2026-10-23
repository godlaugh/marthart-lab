import {ArtRenderer} from './renderer';
const retired=new Set<SourceDrawingResources>();
/** Owns only canvases/contexts created here. Failed cleanup stays reachable and
 * blocks a replacement until the unfinished release stages can be retried. */
export function retrySourceDrawingCleanup():void {
 const errors:unknown[]=[];for(const owner of retired)try{owner.dispose();}catch(error){errors.push(error);}
 if(errors.length)throw new AggregateError(errors,'源绘图资源清理未完成');
}
export function sourceDrawingCleanupCount():number{return retired.size;}
export class SourceDrawingResources {
 private canvas?:HTMLCanvasElement;
 private art?:ArtRenderer;
 private graphicsDisposed=false;private contextReleased=false;
 constructor(){
  retrySourceDrawingCleanup();
  this.canvas=document.createElement('canvas');
  try{this.art=new ArtRenderer(this.canvas,'source-offscreen-export');}
  catch(error){this.canvas.width=this.canvas.height=0;this.canvas=undefined;throw error;}
 }
 get renderer():ArtRenderer {if(!this.art||this.graphicsDisposed||this.contextReleased)throw Error('源绘图实例已释放');return this.art;}
 dispose():void {
  if(!this.art)return;const errors:unknown[]=[];
  if(!this.graphicsDisposed)try{this.art.dispose();this.graphicsDisposed=true;}catch(error){errors.push(error);}
  if(!this.contextReleased)try{this.art.renderer.forceContextLoss();this.contextReleased=true;}catch(error){errors.push(error);}
  if(errors.length){retired.add(this);throw new AggregateError(errors,'源绘图资源释放失败，保留以便重试');}
  if(this.canvas)this.canvas.width=this.canvas.height=0;
  this.art=undefined;this.canvas=undefined;retired.delete(this);
 }
}
