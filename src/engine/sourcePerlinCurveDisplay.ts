import {SourcePerlinCpuTarget,type SourcePerlinCpuFrame,type SourcePerlinCpuPrimitive} from './sourcePerlinCpuTarget';
import {prepareSourcePerlinCpuDisplay,type SourcePerlinCpuDisplayInput,type SourcePerlinCpuDisplay} from './sourcePerlinDisplay';
import {sourceProcessingOpenStrokeBuffers,type SourceProcessingOpenStrokeBuffers} from './sourceProcessingStroke';

const F=Math.fround;
export class SourcePerlinCurveDisplayError extends Error{
 constructor(readonly code:'input'|'capacity'|'cancelled'|'failed'|'disposed',message:string){super(message);this.name=code==='cancelled'?'AbortError':'SourcePerlinCurveDisplayError';}
}
/** The curve owner supplies its current fixed-order coordinates and current
 * per-curve colors. A snapshot is requested only when a draw/rebuild needs it. */
export interface SourcePerlinCurveDrawingData{
 readonly count:number;readonly length:number;
 readonly xs:Float32Array;readonly ys:Float32Array;readonly colors:Uint32Array;
}
export interface SourcePerlinCurveDrawingSource{
 readonly count:number;
 /** True only when the owning field actually rebuilt geometry. */
 rebuildIfNeeded():boolean;
 snapshot():SourcePerlinCurveDrawingData;
}
export interface SourcePerlinCurveDrawFrame{
 readonly target:SourcePerlinCpuTarget;
 readonly display:SourcePerlinCpuDisplayInput;
 readonly curves:SourcePerlinCurveDrawingSource;
 /** isFieldCurveAnimating, supplied by the parameter owner. */
 readonly animating:boolean;readonly curveAlpha:number;
 readonly background:SourcePerlinCpuFrame['background'];readonly accumulation:boolean;
}
function check(cancelled?:()=>boolean){
 if(cancelled!==undefined&&typeof cancelled!=='function')throw new SourcePerlinCurveDisplayError('input','Perlin curve cancellation must be a function.');
 if(cancelled?.())throw new SourcePerlinCurveDisplayError('cancelled','Perlin curve display cancelled.');
}
function alphaByte(value:number){
 if(typeof value!=='number'||!Number.isFinite(F(value)))throw new SourcePerlinCurveDisplayError('input','Perlin curve alpha requires a finite source float.');
 const alpha255=F(Math.max(F(.01),Math.min(1,F(value)))*255);
 return Math.trunc(F(255*F(alpha255/255)));
}
/** RGB arguments of stroke(r,g,b,a), not packed-color colorCalc(int). */
export function sourcePerlinCurveRgba(packed:number,alpha:number):readonly[number,number,number,number]{
 if(!Number.isInteger(packed)||packed<0||packed>0xffffffff)throw new SourcePerlinCurveDisplayError('input','Perlin curve color requires unsigned ARGB.');
 const channel=(byte:number)=>F(Math.trunc(F(255*F(byte/255)))/255);
 return [channel((packed>>>16)&255),channel((packed>>>8)&255),channel(packed&255),F(alphaByte(alpha)/255)];
}
/** Shared static/direct stroke preparation. It preserves the original
 * beginShape(POLYGON) per-curve boundaries, including two-point no-draw shapes. */
export function sourcePerlinCurveStrokeBuffers(data:SourcePerlinCurveDrawingData,display:SourcePerlinCpuDisplay,alpha:number,cancelled?:()=>boolean):SourceProcessingOpenStrokeBuffers{
 check(cancelled);
 if(!data||!Number.isSafeInteger(data.count)||data.count<0||!Number.isSafeInteger(data.length)||data.length<2||!(data.xs instanceof Float32Array)||!(data.ys instanceof Float32Array)||data.xs.length!==data.count*data.length||data.ys.length!==data.xs.length||!(data.colors instanceof Uint32Array)||data.colors.length!==data.count)throw new SourcePerlinCurveDisplayError('input','Invalid Perlin curve drawing snapshot.');
 // Bound the simultaneously retained snapshot and converted vertex inputs
 // before allocating them. Stroke expansion has its own complete 256 MiB gate.
 const n=data.xs.length,inputBytes=data.xs.byteLength+data.ys.byteLength+data.colors.byteLength+n*28+(data.count+1)*4;
 if(inputBytes>64*1024*1024)throw new SourcePerlinCurveDisplayError('capacity','Perlin curve snapshot and stroke inputs exceed 64 MiB.');
 alphaByte(alpha);
 const positions=new Float32Array(n*3),colors=new Float32Array(n*4),polygonOffsets=new Uint32Array(data.count+1);
 for(let c=0;c<data.count;c++){
  check(cancelled);const rgba=sourcePerlinCurveRgba(data.colors[c],alpha);
  polygonOffsets[c]=c*data.length;
  for(let j=0;j<data.length;j++){
   const i=c*data.length+j;if((i&1023)===0)check(cancelled);
   positions[i*3]=data.xs[i];positions[i*3+1]=data.ys[i];
   colors.set(rgba,i*4);
  }
 }
 polygonOffsets[data.count]=n;
 return sourceProcessingOpenStrokeBuffers({positions,colors,polygonOffsets,rowMajor:display.modelView.rowMajor,lineWidth:display.lineWidth,isCancelled:cancelled});
}
/** Source cache key deliberately excludes output identity, density, background
 * and animation flags. A reuse must not advance the cached scale checkpoint. */
export function sourcePerlinCurveCacheNeedsRebuild(cached:{width:number;height:number;lineScale:number}|undefined,width:number,height:number,lineScale:number,dirty:boolean):boolean{
 return !cached||cached.width!==width||cached.height!==height||dirty||Math.abs(F(cached.lineScale-lineScale))>F(.0001);
}
/** One source Perlin object's single transparent image cache. Target lifetime
 * and Scene background history belong to the caller; this owns only the cache.
 * Targets used by the same object must belong to one shared graphics device. */
export class SourcePerlinCurveDisplay{
 private cache?:SourcePerlinCpuTarget;
 private cached?:{width:number;height:number;lineScale:number};
 private dirty=true;private failed=false;private disposed=false;
 private builds=0;private directDraws=0;private imageDraws=0;
 constructor(private readonly cacheSamples:0|2|4|8){
  if(![0,2,4,8].includes(cacheSamples))throw new SourcePerlinCurveDisplayError('input','Invalid actual curve-cache MSAA count.');
 }
 private check(cancelled?:()=>boolean){
  if(this.disposed)throw new SourcePerlinCurveDisplayError('disposed','Perlin curve display is disposed.');
  if(this.failed)throw new SourcePerlinCurveDisplayError('failed','Perlin curve display failed; rebuild its owner.');
  check(cancelled);
 }
 /** Call only for source palette/gradient scalar refresh or geometry rebuild,
  * not merely because gradient running/interpolation changed. */
 invalidate(){this.check();this.dirty=true;}
 draw(frame:SourcePerlinCurveDrawFrame,cancelled?:()=>boolean):void{
  try{
   this.check(cancelled);
   if(!frame||!(frame.target instanceof SourcePerlinCpuTarget)||!frame.curves||!Number.isSafeInteger(frame.curves.count)||frame.curves.count<0||typeof frame.curves.rebuildIfNeeded!=='function'||typeof frame.curves.snapshot!=='function'||typeof frame.animating!=='boolean')throw new SourcePerlinCurveDisplayError('input','Invalid Perlin curve display frame.');
   const {target,curves}=frame,dimensions=target.diagnostics();
   if(!frame.display||frame.display.width!==dimensions.width||frame.display.height!==dimensions.height)throw new SourcePerlinCurveDisplayError('input','Perlin curve display dimensions differ from the target.');
   // Static null/empty source curves return before rebuildFieldCurvesIfNeeded.
   // Scene clear/fade still happens even when this field emits no geometry.
   if(!frame.animating&&curves.count===0){target.draw({projection:new Float32Array(16),background:frame.background,accumulation:frame.accumulation,primitives:[]},cancelled);return;}
   if(curves.rebuildIfNeeded())this.dirty=true;
   const display=prepareSourcePerlinCpuDisplay(frame.display);
   const prepare=():SourcePerlinCpuPrimitive=>{
    const snapshot=curves.snapshot();
    if(!snapshot||snapshot.count!==curves.count)throw new SourcePerlinCurveDisplayError('input','Perlin curve snapshot count differs from its owner.');
    return{kind:'lines',buffers:sourcePerlinCurveStrokeBuffers(snapshot,display,frame.curveAlpha,cancelled)};
   };
   if(frame.animating){
    target.draw({projection:display.projection.columnMajor,background:frame.background,accumulation:frame.accumulation,primitives:[prepare()]},cancelled);
    this.directDraws++;return;
   }
   const {width,height}=dimensions;
   if(sourcePerlinCurveCacheNeedsRebuild(this.cached,width,height,display.lineScale,this.dirty)){
    const primitive=prepare();
    if(!this.cache||this.cached?.width!==width||this.cached?.height!==height){
     // Release superseded attachments before allocation; a failure poisons this
     // owner, so a stale partial cache can never be published or retried.
     this.cache?.dispose();this.cache=undefined;
     this.cache=target.createSibling({width,height,density:frame.display.sourcePixelDensity,samples:this.cacheSamples,initialColor:[0,0,0,0]});
    }
    this.cache.draw({projection:display.projection.columnMajor,background:[0,0,0,0],accumulation:false,primitives:[primitive]},cancelled);
    this.cached={width,height,lineScale:display.lineScale};this.dirty=false;this.builds++;
   }
   target.draw({projection:display.projection.columnMajor,background:frame.background,accumulation:frame.accumulation,primitives:[],images:[this.cache!]},cancelled);
   this.imageDraws++;
  }catch(error){this.failed=true;this.cache?.dispose();this.cache=undefined;throw error;}
 }
 diagnostics(){this.check();return{builds:this.builds,directDraws:this.directDraws,imageDraws:this.imageDraws,dirty:this.dirty,cached:this.cached?{...this.cached}:undefined,cache:this.cache?.diagnostics()};}
 dispose(){if(this.disposed)return;this.cache?.dispose();this.cache=undefined;this.disposed=true;}
}
