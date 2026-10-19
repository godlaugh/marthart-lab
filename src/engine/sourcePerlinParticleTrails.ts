import {SourceParticleTrailHistory} from './sourceParticleTrails';
import type {SourcePerlinParticleMotion} from './sourcePerlinParticleMotion';
const F=Math.fround;
export class SourcePerlinParticleTrailError extends Error{
 constructor(readonly code:'input'|'capacity'|'cancelled'|'failed',message:string){super(message);this.name=code==='cancelled'?'AbortError':'SourcePerlinParticleTrailError';}
}
export interface SourcePerlinParticleTrailOptions{
 readonly motion:Pick<SourcePerlinParticleMotion,'count'|'visitParticles'>;
 /** Borrowed from the current-color owner; never historical per-point colors. */
 readonly packedColors:Uint32Array;readonly lifetime:number;readonly fade:boolean;readonly accumulation:boolean;
 readonly isCancelled?:()=>boolean;
}
export interface SourcePerlinTrailPolygons{
 readonly positions:Float32Array;readonly colors:Float32Array;readonly alphas:Float32Array;
 /** Each [offset[i],offset[i+1]) is one OPEN POLYGON, at least three vertices. */
 readonly polygonOffsets:Uint32Array;readonly particleIds:Uint32Array;
 readonly records:number;readonly discardedShortShapes:number;
}
/** Dot3D retention stays in SourceParticleTrailHistory. This consumer owns the
 * Perlin sampling rule and OPEN POLYGON drawing topology, not tessellation. */
export class SourcePerlinParticleTrails{
 private readonly history?:SourceParticleTrailHistory;private failed=false;
 private readonly scratch={x:0,y:0,z:0,time:0};
 private readonly options:SourcePerlinParticleTrailOptions;
 constructor(options:SourcePerlinParticleTrailOptions){
  this.options=Object.freeze({...options});
  const count=options.motion.count;
  if(!Number.isSafeInteger(count)||count<0||count>250000||!(options.packedColors instanceof Uint32Array)||options.packedColors.length!==count||typeof options.fade!=='boolean'||typeof options.accumulation!=='boolean'||typeof options.lifetime!=='number'||!Number.isFinite(F(options.lifetime)))throw new SourcePerlinParticleTrailError('input','Invalid Perlin particle trail configuration.');
  this.check();
  if(!options.accumulation){
   this.history=new SourceParticleTrailHistory(count,F(options.lifetime),options.fade,options.packedColors,()=>this.check(),()=>{throw new SourcePerlinParticleTrailError('capacity','Perlin trails exceed one million retained records.');});
   // Native initialization records time zero even when showTrails is false.
   options.motion.visitParticles((i,x,y)=>this.history!.add(i,x,y,0,0));
  }
 }
 private check(){if(this.failed)throw new SourcePerlinParticleTrailError('failed','Perlin trail update failed; rebuild before use.');if(this.options.isCancelled?.())throw new SourcePerlinParticleTrailError('cancelled','Perlin trail update cancelled.');}
 /** Must follow one successful motion update; color/parameter update is external. */
 afterMotion(time:number,showTrails:boolean):void{
  this.check();try{
   if(typeof time!=='number'||!Number.isFinite(F(time))||typeof showTrails!=='boolean')throw new SourcePerlinParticleTrailError('input','Perlin trail update requires finite time and a boolean display flag.');time=F(time);
   const h=this.history;if(!h)return;
   this.options.motion.visitParticles((i,x,y,_vx,_vy,step,flags)=>{
    this.check();if(!showTrails)return;
    if(flags&3)h.add(i,NaN,NaN,NaN,time);
    const previous=h.readLast(i,this.scratch),threshold=Math.max(F(.15),F(step*F(1.25))),dx=F(x-this.scratch.x),dy=F(y-this.scratch.y);
    if(!previous||Number.isNaN(this.scratch.x)||Number.isNaN(this.scratch.y)||F(F(dx*dx)+F(dy*dy))>=F(threshold*threshold))h.add(i,x,y,0,time);
   });
   // Expiration runs after all motion, including hidden trails.
   for(let i=0;i<this.options.motion.count;i++){if((i&255)===0)this.check();h.expire(i,time);}
  }catch(error){this.failed=true;throw error;}
 }
 diagnostics(){this.check();return{records:this.history?.recordCount??0,retainedBytes:this.history?.retainedBytes??0};}
 /** Read-only semantic records, including NaN separators; useful to downstream
  * lifecycle verification without exposing the pooled storage representation. */
 visitRecords(slot:number,visit:(x:number,y:number,z:number,time:number,ordinal:number,count:number)=>void){this.check();if(!Number.isInteger(slot)||slot<0||slot>=this.options.motion.count)throw new RangeError('Invalid Perlin particle slot.');this.history?.visitRecords(slot,visit);}
 snapshotPolygons(width:number,height:number):SourcePerlinTrailPolygons{
  this.check();for(const n of [width,height])if(typeof n!=='number'||!Number.isFinite(F(n)))throw new SourcePerlinParticleTrailError('input','Perlin trail display needs finite original viewport dimensions.');
  // Uses actual PApplet dimensions, never the simulation's joint 800 fallback.
  const distance=F(F(Math.max(width,height))*F(.55)),limit=F(distance*distance),h=this.history;
  if(!h)return{positions:new Float32Array(),colors:new Float32Array(),alphas:new Float32Array(),particleIds:new Uint32Array(),polygonOffsets:new Uint32Array(1),records:0,discardedShortShapes:0};
  let vertices=0,polygons=0,discarded=0;
  const pending=new Float32Array(6);
  const traverse=(point?:(slot:number,x:number,y:number,ordinal:number,count:number)=>void,close?:()=>void)=>{
   for(let slot=0;slot<this.options.motion.count;slot++){
    if((slot&255)===0)this.check();let size=0,px=0,py=0;
    const finish=()=>{if(size>=3)close?.();else if(size>0&&!point)discarded++;size=0;};
    h?.visitRecords(slot,(x,y,_z,_time,ordinal,count)=>{
     if(Number.isNaN(x)||Number.isNaN(y)){finish();return;}
     const dx=F(x-px),dy=F(y-py);if(size>0&&F(F(dx*dx)+F(dy*dy))>limit)finish();
     if(size<2){pending[size*3]=x;pending[size*3+1]=y;pending[size*3+2]=ordinal;}
     size++;
     if(size===3){
      if(point){for(let k=0;k<2;k++)point(slot,pending[k*3],pending[k*3+1],pending[k*3+2],count);point(slot,x,y,ordinal,count);}
      else{vertices+=3;polygons++;}
     }else if(size>3){if(point)point(slot,x,y,ordinal,count);else vertices++;}
     px=x;py=y;
    });finish();
   }
  };
  traverse();
  const positions=new Float32Array(vertices*3),colors=new Float32Array(vertices*3),alphas=new Float32Array(vertices),particleIds=new Uint32Array(vertices),polygonOffsets=new Uint32Array(polygons+1);
  let vertex=0,polygon=0;
  traverse((slot,x,y,ordinal,count)=>{
   const color=this.options.packedColors[slot],at=vertex*3;positions[at]=x;positions[at+1]=y;colors[at]=((color>>>16)&255)/255;colors[at+1]=((color>>>8)&255)/255;colors[at+2]=(color&255)/255;
   const alpha=this.options.fade?F(255*F(ordinal/Math.max(1,count-1))):255;
   alphas[vertex]=F(Math.trunc(F(255*F(alpha/255)))/255);particleIds[vertex++]=slot;
  },()=>{polygonOffsets[++polygon]=vertex;});
  this.check();return{positions,colors,alphas,particleIds,polygonOffsets,records:h?.recordCount??0,discardedShortShapes:discarded};
 }
}
