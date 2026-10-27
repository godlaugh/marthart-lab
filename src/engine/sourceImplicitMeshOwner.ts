import type {GenerateContext,SceneOutput} from '../types';
import type {ImplicitJob} from './implicitSurface';
import type {SourceImplicitField} from './sourceImplicitField';
import {generateSourceImplicitMesh} from './sourceImplicitMesh';
import {bindSourceImplicitPresentation,type SourceImplicitSlices} from './sourceImplicitPresentation';
import {IMPLICIT_WORK_BYTES,IMPLICIT_OUTPUT_BYTES} from './meshEdges';
import {outputBuffers} from './outputBuffers';
import {sameSourceRecordingValue} from './sourceRecordingValue';

type Geometry=Extract<SceneOutput,{type:'geometry'}>;
type Input={source:string;parameters:readonly (readonly [string,number])[];dimensions:readonly number[];min:readonly number[];max:readonly number[];scale:readonly number[];offset:readonly number[];iso:number;isoThreshold:number};
type Entry={revision:number;input:Input;positions:Float32Array;normals:Float32Array;repeated:number;implicit:NonNullable<Geometry['implicit']>;invalid:number;warnings?:string[];wire?:SourceImplicitSlices};
class MeshWorkCapacity extends Error {
 constructor(readonly retryWithoutCache:boolean){super('源隐式曲面留存、工作区与交付缓冲超过 256 MiB 预算');}
}
const geometryBytes=(output:SceneOutput)=>outputBuffers(output).reduce((sum,b)=>sum+b.byteLength,0);
/** Optional raw geometry owned by one numerical Mobject. Neither a completed
 * output nor its transferable buffers are retained. Source dirty/display
 * history and actual local materialization are deliberately separate. */
export class SourceImplicitMeshOwner {
 private entry?:Entry;
 private transactions:{saved?:Entry}[]=[];
 private borrowed=new Set<Entry>();
 private heldBytes=0;
 private builds=0;private hits=0;private sliceBuilds=0;private peakBytes=0;private evictions=0;
 constructor(private readonly revision:()=>number){}
 private retained(){const buffers=new Set<ArrayBufferLike>();for(const e of [this.entry,...this.transactions.map(t=>t.saved),...this.borrowed])if(e){buffers.add(e.positions.buffer);buffers.add(e.normals.buffer);if(e.wire)buffers.add(e.wire.positions.buffer);}return [...buffers].reduce((sum,b)=>sum+b.byteLength,0);}
 /** Dropping an optimization must not change source dirty or display facts.
  * Rollback cannot secretly retain an evicted buffer outside the budget. */
 evict():void {if(this.entry||this.transactions.some(t=>t.saved))this.evictions++;this.entry=undefined;for(const t of this.transactions)t.saved=undefined;}
 reset():void {this.evict();}
 diagnostics(){return{retainedBytes:this.retained(),materializedRevision:this.entry?.revision??null,meshBuilds:this.builds,meshCacheHits:this.hits,sliceBuilds:this.sliceBuilds,peakWorkingBytes:this.peakBytes,evictions:this.evictions};}
 transaction<T>(run:()=>T):T {
  const ticket={saved:this.entry};this.transactions.push(ticket);
  try{return run();}catch(error){this.entry=ticket.saved;throw error;}finally{this.transactions.pop();}
 }
 /** The paired capture output stays live while primary is produced. */
 withOutput<T>(output:SceneOutput,run:()=>T):T {
  const count=geometryBytes(output);this.heldBytes+=count;
  try{this.admit(0);return run();}finally{this.heldBytes-=count;}
 }
 private admit(localBytes:number):void {
  const base=this.heldBytes+localBytes;
  if(!Number.isSafeInteger(base)||base<0)throw new MeshWorkCapacity(false);
  if(base+this.retained()>IMPLICIT_WORK_BYTES)this.evict();
  const required=base+this.retained();
  if(required>IMPLICIT_WORK_BYTES)throw new MeshWorkCapacity(base<=IMPLICIT_WORK_BYTES&&this.borrowed.size>0);
  this.peakBytes=Math.max(this.peakBytes,required);
 }
 generate(job:ImplicitJob,field:SourceImplicitField,context:GenerateContext):Geometry {
  const started=performance.now(),check=()=>{if(context.isCancelled?.())throw new DOMException('源隐式网格显示已取消','AbortError');};check();
  const input:Input={source:job.source,parameters:Object.keys(job.scene.parameters).sort().map(name=>[name,job.scene.parameters[name]] as const),dimensions:[...field.dimensions],min:[...field.min],max:[...field.max],scale:[...field.scale],offset:[...field.offset],iso:field.iso,isoThreshold:field.isoThreshold};
  const revision=this.revision();let peak=0;
  const admit=(n:number)=>{this.admit(n);peak=Math.max(peak,this.heldBytes+n+this.retained());};
  let hit=this.entry?.revision===revision&&sameSourceRecordingValue(this.entry.input,input)?this.entry:undefined;
  const produce=(cached?:Entry):Geometry=>{
   if(cached)this.borrowed.add(cached);
   try{
    let output:Geometry;
    if(cached){
     admit(cached.positions.byteLength+cached.normals.byteLength);
     output={type:'geometry',dimension:3,topology:'mesh',backend:'cpu',positions:cached.positions.slice(),sourceImplicitMesh:{model:'mathart-1.7.8-cpu-marching-cubes-v1',normals:cached.normals.slice(),retainedRepeatedVertexTriangles:cached.repeated},implicit:{...cached.implicit,examinedCells:0,latticeSamples:0,estimatedPeakWorkingBytes:0},stats:{samples:0,generated:cached.positions.length/3,invalid:cached.invalid,elapsedMs:0},...(cached.warnings?{warnings:[...cached.warnings]}:{})};
    }else{this.builds++;output=generateSourceImplicitMesh(job,field,context,admit);}
    const raw={implicit:{...output.implicit!},invalid:output.stats.invalid,warnings:output.warnings&&[...output.warnings]};
    let wire:SourceImplicitSlices|undefined;
    bindSourceImplicitPresentation(output,job,context,field,{
     admitWorking:admit,
     slices:(retained,build)=>{
      if(cached?.wire){
       const wireBytes=cached.wire.positions.byteLength;
       if(retained+wireBytes*7/3>IMPLICIT_OUTPUT_BYTES)throw Error('源隐式切片与网格输出超过 128 MiB 预算');
       admit(retained+wireBytes*7/3);
       return wire={...cached.wire,axes:[...cached.wire.axes],positions:cached.wire.positions.slice(),samples:0,estimatedPeakWorkingBytes:retained+wireBytes*7/3};
      }
      this.sliceBuilds++;return wire=build();
     },
    });check();
    const delivered=geometryBytes(output);admit(delivered);
    // Keep the existing raw buffers on a hit. Only a newly required contour
    // needs a new copy; palette and target facts remain output-local.
    if(cached&&(!wire||cached.wire))this.entry=cached;
    else{
     const rawBytes=cached?wire!.positions.byteLength:output.positions.byteLength+output.sourceImplicitMesh!.normals.byteLength+(wire?.positions.byteLength??0);
     if(this.heldBytes+delivered+rawBytes+this.retained()>IMPLICIT_WORK_BYTES)this.evict();
     if(this.heldBytes+delivered+rawBytes+this.retained()<=IMPLICIT_WORK_BYTES){
      admit(delivered+rawBytes);
      this.entry=cached?{...cached,wire:{...wire!,axes:[...wire!.axes],positions:wire!.positions.slice()}}:{revision,input,positions:output.positions.slice(),normals:output.sourceImplicitMesh!.normals.slice(),repeated:output.sourceImplicitMesh!.retainedRepeatedVertexTriangles,...raw,...(wire?{wire:{...wire,axes:[...wire.axes],positions:wire.positions.slice()}}:{})};
     }
    }
    check();if(cached)this.hits++;
    output.implicit!.estimatedPeakWorkingBytes=Math.max(output.implicit!.estimatedPeakWorkingBytes,peak);
    output.stats.elapsedMs=performance.now()-started;return output;
   }finally{if(cached)this.borrowed.delete(cached);}
  };
  return this.transaction(()=>{try{return produce(hit);}catch(error){if(!hit||!(error instanceof MeshWorkCapacity)||!error.retryWithoutCache)throw error;hit=undefined;this.evict();return produce();}});
 }
}
