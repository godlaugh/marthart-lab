import type {SourceCameraPlan} from './sourceCamera';
import {SourceProcessingContext,SourceProcessingContextError,SourceProcessingShaderContext,type SourceProcessingContextResult,type SourceProcessingContextSnapshot,type SourceProcessingContextEvent} from './sourceProcessingContext';
import {sourceProcessingSceneInitializationEvents,sourceProcessingSceneBaseEvents,sourceProcessingSceneWorldEvents,sourceProcessingOverlayEvents} from './sourceProcessingSceneContext';

type Size={readonly width:number;readonly height:number};
type Graphics=Size&{readonly context:SourceProcessingContext};
export type SourceProcessingHostEvent=
 | {kind:'begin-primary';width:number;height:number}
 | {kind:'end-primary'|'initialize-scene'|'reset-mobject'}
 | {kind:'ensure-offscreen';width:number;height:number}
 | {kind:'begin-render';plan:SourceCameraPlan}
 | {kind:'end-render';screenOverlay:boolean}
 | {kind:'preview-copy'};
const value=<T>(r:SourceProcessingContextResult<T>):T=>{if(!r.ok)throw r.error;return r.value;};
const demand=(ok:unknown,message:string):void=>{if(!ok)throw new SourceProcessingContextError('state',message);};
function size(width:number,height:number){if(![width,height].every(n=>Number.isInteger(n)&&n>0&&n<=2147483647))throw new SourceProcessingContextError('input','Processing host dimensions must be positive int32');}
function attempt<T>(run:()=>T):SourceProcessingContextResult<T>{try{return{ok:true,value:run()};}catch(error){if(error instanceof SourceProcessingContextError)return{ok:false,error};throw error;}}

/** One MathArt primary graphics lifetime, distinct from a scene, a retained
 * particle owner and the current renderBuffer slot. No frame-number guesses:
 * callers supply actual begin/update/render/end events and overlay presence.
 *
 * Processing currentPG is a selector, not a nesting stack: offscreen endDraw
 * restores primary, primary endDraw clears it. A lazily bound compute shader
 * keeps its first graphics even after ensureRenderBuffer replaces the slot.
 * This owner models one Symmetry compute shader; native GPU resources and
 * their acknowledged cleanup remain owned by the native backend. */
export class SourceProcessingHost {
 private primary:Graphics;private offscreen?:Graphics;private retired?:Graphics;
 private current?:Graphics;private render?:Graphics;private drawing=false;private disposed=false;private failed=false;private changed=false;
 private shader=new SourceProcessingShaderContext();
 private constructor(width:number,height:number){this.primary=this.create(width,height);}
 static create(width:number,height:number):SourceProcessingContextResult<SourceProcessingHost>{return attempt(()=>{size(width,height);return new SourceProcessingHost(width,height);});}
 private create(width:number,height:number):Graphics{return{width,height,context:value(SourceProcessingContext.create(width,height))};}
 private check(){demand(!this.disposed&&!this.failed,'Processing host disposed or failed');}
 private events(graphics:Graphics,events:readonly SourceProcessingContextEvent[]){for(const event of events){this.changed=true;value(graphics.context.apply(event));}}
 private resetMobject(){this.shader.dispose();this.shader=new SourceProcessingShaderContext();this.retired?.context.dispose();this.retired=undefined;}
 private ensureOffscreen(width:number,height:number){
  size(width,height);if(this.offscreen?.width===width&&this.offscreen.height===height)return;
  const next=this.create(width,height),old=this.offscreen;
  // MathArt.ensureRenderBuffer initializes a fresh object with a background
  // draw before using it. It does not dispose the replaced graphics object.
  try{this.events(next,[{kind:'begin-draw'},{kind:'end-draw'}]);}catch(error){next.context.dispose();throw error;}
  if(old){if(this.shader.usesGraphics(old.context))this.retired=old;else old.context.dispose();}
  this.offscreen=next;this.current=this.primary;
 }
 apply(event:SourceProcessingHostEvent):SourceProcessingContextResult<void>{this.changed=false;let succeeded=false;try{const result=attempt(()=>{
  this.check();if(!event||typeof event!=='object')throw new SourceProcessingContextError('input','Processing host event required');
  switch(event.kind){
   case 'begin-primary':{
    size(event.width,event.height);demand(!this.drawing&&!this.render,'Processing primary frame already active');
    if(this.primary.width!==event.width||this.primary.height!==event.height){this.events(this.primary,[{kind:'resize',width:event.width,height:event.height}]);this.primary={...this.primary,width:event.width,height:event.height};}
    this.events(this.primary,[{kind:'begin-draw'}]);this.current=this.primary;this.drawing=true;return;
   }
   case 'end-primary':demand(this.drawing&&!this.render&&this.current===this.primary,'Processing primary frame cannot end during target rendering');this.events(this.primary,[{kind:'end-draw'}]);this.current=undefined;this.drawing=false;return;
   case 'reset-mobject':demand(!this.render,'Processing mobject reset during render');this.resetMobject();return;
   case 'initialize-scene':demand(this.drawing&&!this.render&&this.current===this.primary,'Processing scene initialization requires primary frame');this.events(this.primary,sourceProcessingSceneInitializationEvents());return;
   case 'ensure-offscreen':demand(this.drawing&&!this.render,'Processing offscreen allocation requires primary frame outside render');this.ensureOffscreen(event.width,event.height);return;
   case 'begin-render':{
    demand(this.drawing&&!this.render&&this.current===this.primary,'Processing target render requires active primary frame');
    const plan=event.plan;if(!plan||!plan.viewport||!['primary','offscreen'].includes(plan.viewport.target))throw new SourceProcessingContextError('input','Processing render needs a prepared camera plan');
    const {logicalWidth:width,logicalHeight:height,target}=plan.viewport;size(width,height);
    if(target==='primary')demand(width===this.primary.width&&height===this.primary.height,'Processing primary camera size does not match graphics owner');
    else this.ensureOffscreen(width,height);
    const graphics=target==='primary'?this.primary:this.offscreen!;
    if(target==='offscreen'){this.events(graphics,[{kind:'begin-draw'}]);this.current=graphics;}
    this.render=graphics;this.events(graphics,sourceProcessingSceneBaseEvents(plan));
    if(plan.viewport.projectionPass==='scene-fade-orthographic')this.events(graphics,sourceProcessingOverlayEvents());
    this.events(graphics,sourceProcessingSceneWorldEvents(plan));return;
   }
   case 'end-render':{
    demand(this.drawing&&this.render===this.current&&!!this.render,'Processing render is not active');
    if(typeof event.screenOverlay!=='boolean')throw new SourceProcessingContextError('input','Processing screen overlay presence must be explicit');
    const graphics=this.render!;this.events(graphics,[{kind:'pop-matrix'}]);if(event.screenOverlay)this.events(graphics,sourceProcessingOverlayEvents());
    if(graphics!==this.primary){this.events(graphics,[{kind:'end-draw'}]);this.current=this.primary;}
    this.render=undefined;return;
   }
   case 'preview-copy':demand(this.drawing&&!this.render&&this.current===this.primary,'Processing preview copy requires primary outside render');this.events(this.primary,sourceProcessingOverlayEvents());return;
   default:throw new SourceProcessingContextError('input','Unknown Processing host event');
  }
 });succeeded=result.ok;return result;}finally{if(!succeeded&&this.changed)this.failed=true;}}
 /** Call at lazy initialization AND each compute bind, including zero-update
  * paused display. The first caller determines identity, not target dimensions. */
 bindCompute():SourceProcessingContextResult<SourceProcessingContextSnapshot>{return attempt(()=>{this.check();return value(this.shader.bind(this.current?.context));});}
 snapshot(target:'primary'|'current'):SourceProcessingContextResult<SourceProcessingContextSnapshot>{return attempt(()=>{this.check();const graphics=target==='primary'?this.primary:this.current;demand(!!graphics,'Processing current graphics is absent');return value(graphics!.context.snapshot());});}
 diagnostics(){return{failed:this.failed,drawing:this.drawing,rendering:!!this.render,current:this.current===this.primary?'primary':this.current?'offscreen':'none',shaderOwner:this.shader.usesGraphics(this.primary.context)?'primary':this.offscreen&&this.shader.usesGraphics(this.offscreen.context)?'offscreen':this.retired?'retired-offscreen':'unbound',primary:{width:this.primary.width,height:this.primary.height},offscreen:this.offscreen?{width:this.offscreen.width,height:this.offscreen.height}:undefined,retainedGraphics:this.disposed?0:1+Number(!!this.offscreen)+Number(!!this.retired)};}
 dispose():void{this.shader.dispose();this.primary.context.dispose();this.offscreen?.context.dispose();this.retired?.context.dispose();this.current=undefined;this.render=undefined;this.offscreen=undefined;this.retired=undefined;this.drawing=false;this.disposed=true;}
}
