const F=Math.fround;
export interface SourceParticleTrails {
 readonly positions:Float32Array;readonly colors:Float32Array;readonly alphas:Float32Array;readonly indices:Uint32Array;
 readonly particleIds:Uint32Array;readonly records:number;readonly oldestTime:number;
}
const TRAIL_RECORDS=1_000_000,TRAIL_BLOCK=4096;
/** Source Dot3D FIFO semantics with pooled typed storage. Native per-dot
 * retention is preserved; lazy blocks replace thousands of mostly empty arrays.
 * The 1M aggregate record bound includes NaN separators and precedes allocation.
 * Known storage: <=20MB pool + 12 bytes/particle metadata, <=40MB snapshot;
 * renderer instance buffers have their own owner budgets. Colors are now
 * produced here; scene consumers must not reconstruct them from current heads. */
export class SourceParticleTrailHistory {
 private readonly heads:Uint32Array;private readonly tails:Uint32Array;private readonly counts:Uint32Array;
 private readonly blocks:{values:Float32Array;next:Uint32Array}[]=[];
 private readonly maximum:number;
 private free=0;private fresh=1;private total=0;
 constructor(particles:number,private readonly lifetime:number,private readonly fade:boolean,private readonly packed:Uint32Array,private readonly check:()=>void,private readonly capacityError:()=>never){
  this.heads=new Uint32Array(particles);this.tails=new Uint32Array(particles);this.counts=new Uint32Array(particles);
  const product=F(lifetime*60),integer=Math.max(-2147483648,Math.min(2147483647,Math.trunc(product)));
  this.maximum=Math.max(0,(integer+120)|0); // JVM f2i then signed iadd.
 }
 get retainedBytes():number{return this.heads.byteLength+this.tails.byteLength+this.counts.byteLength+this.blocks.reduce((n,b)=>n+b.values.byteLength+b.next.byteLength,0);}
 get recordCount():number{return this.total;}
 private block(id:number){return this.blocks[Math.floor((id-1)/TRAIL_BLOCK)];}
 private index(id:number){return(id-1)%TRAIL_BLOCK;}
 private next(id:number){return this.block(id).next[this.index(id)];}
 private link(id:number,next:number){this.block(id).next[this.index(id)]=next;}
 private remove(slot:number){
  const id=this.heads[slot];this.heads[slot]=this.next(id);if(--this.counts[slot]===0)this.tails[slot]=0;
  this.link(id,this.free);this.free=id;this.total--;
 }
 add(slot:number,x:number,y:number,z:number,time:number){
  if(!this.maximum)return;
  if(this.counts[slot]===this.maximum)this.remove(slot);
  let id=this.free;
  if(id)this.free=this.next(id);
  else{
   if(this.fresh>TRAIL_RECORDS)this.capacityError();
   id=this.fresh++;
   if(this.index(id)===0){this.check();const size=Math.min(TRAIL_BLOCK,TRAIL_RECORDS-id+1);this.blocks.push({values:new Float32Array(size*4),next:new Uint32Array(size)});}
  }
  const block=this.block(id),i=this.index(id),at=i*4;block.values[at]=x;block.values[at+1]=y;block.values[at+2]=z;block.values[at+3]=time;block.next[i]=0;
  if(this.tails[slot])this.link(this.tails[slot],id);else this.heads[slot]=id;
  this.tails[slot]=id;this.counts[slot]++;this.total++;
 }
 expire(slot:number,time:number){
  let removed=0;
  while(this.heads[slot]){if((removed++&1023)===0)this.check();const id=this.heads[slot];if(!(F(time-this.block(id).values[this.index(id)*4+3])>this.lifetime))break;this.remove(slot);}
 }
 snapshot(dynamicColor?:(particleId:number,recordTime:number,baseColor:number)=>number):SourceParticleTrails {
  let vertices=0,segments=0,oldestTime=Infinity;
  const finite=(data:Float32Array,i:number)=>Number.isFinite(data[i])&&Number.isFinite(data[i+1])&&Number.isFinite(data[i+2]);
  for(let slot=0;slot<this.heads.length;slot++){
   if((slot&255)===0)this.check();let previous=false,visited=0;
   for(let id=this.heads[slot];id;id=this.next(id)){
    if((visited++&1023)===0)this.check();
    const data=this.block(id).values,i=this.index(id)*4,valid=finite(data,i);oldestTime=Math.min(oldestTime,data[i+3]);
    if(valid){vertices++;if(previous)segments++;}previous=valid;
   }
  }
  // Both counts are bounded by retained records. Finite points are compacted
  // only after edge identity and original ordinal fade are known.
  const positions=new Float32Array(vertices*3),colors=new Float32Array(vertices*3),alphas=new Float32Array(vertices),particleIds=new Uint32Array(vertices),indices=new Uint32Array(segments*2);
  const writeColor=(vertex:number,color:number)=>{colors[vertex*3]=((color>>>16)&255)/255;colors[vertex*3+1]=((color>>>8)&255)/255;colors[vertex*3+2]=(color&255)/255;};
  let vertex=0,edge=0;
  for(let slot=0;slot<this.heads.length;slot++){
   if((slot&255)===0)this.check();let previous=-1,ordinal=0,previousTime=0,previousColor=0,hasPreviousColor=false;const denominator=Math.max(1,this.counts[slot]-1);
   for(let id=this.heads[slot];id;id=this.next(id),ordinal++){
    if((ordinal&1023)===0)this.check();
    const data=this.block(id).values,i=this.index(id)*4;if(!finite(data,i)){previous=-1;hasPreviousColor=false;continue;}
    positions[vertex*3]=data[i];positions[vertex*3+1]=data[i+1];positions[vertex*3+2]=data[i+2];particleIds[vertex]=slot;
    // PGraphics RGB/255: source stroke(alpha) normalizes and packs to an 8-bit
    // channel before its GL vertex consumer. Separators count in the denominator.
    const baseAlpha=dynamicColor?255:(this.packed[slot]>>>24)||255; // Native trail fallback for zero alpha.
    const stroke=this.fade?F(baseAlpha*F(ordinal/denominator)):baseAlpha;
    alphas[vertex]=F(Math.trunc(F(255*F(stroke/255)))/255);
    writeColor(vertex,this.packed[slot]);
    if(previous>=0){
     if(dynamicColor){
      // Only drawn segment endpoints enter native age/color caches. A
      // contiguous segment reuses the preceding endpoint's sampled color.
      if(!hasPreviousColor)previousColor=dynamicColor(slot,previousTime,this.packed[slot]);
      writeColor(previous,previousColor);previousColor=dynamicColor(slot,data[i+3],this.packed[slot]);
      writeColor(vertex,previousColor);hasPreviousColor=true;
     }
     indices[edge++]=previous;indices[edge++]=vertex;
    }
    previous=vertex++;previousTime=data[i+3];
   }
  }
  return{positions,colors,alphas,indices,particleIds,records:this.total,oldestTime:Number.isFinite(oldestTime)?oldestTime:0};
 }
}
