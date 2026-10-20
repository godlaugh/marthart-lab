import {SourcePerlinFlowTexture,type SourcePerlinFlowStyle} from './sourcePerlinFlowTexture';
import {sourcePerlinSeed} from './sourcePerlinSeed';
import {SourceProcessingNoiseState,SOURCE_PROCESSING_NOISE_TABLE_BYTES,type SourceProcessingNoise} from './sourceProcessingNoise';

export type SourcePerlinFlowSize=512|1024|2048;
export interface SourcePerlinFlowChannel{
 readonly size:SourcePerlinFlowSize;
 readonly style:SourcePerlinFlowStyle;
 /** Borrowed pixels; do not mutate or retain beyond a different-size prepare
  * or dispose. GPU copies are owned and accounted for by the drawing host. */
 readonly pixels:Uint32Array;
}
export interface SourcePerlinFlowResourcesOptions{
 readonly seed:string|number;
 readonly isCancelled?:()=>boolean;
}
export class SourcePerlinFlowResourcesError extends Error{
 constructor(readonly code:'input'|'capacity'|'cancelled'|'failed'|'disposed',message:string){super(message);this.name=code==='cancelled'?'AbortError':'SourcePerlinFlowResourcesError';}
}
/** Six maximum-size ARGB images need 96 MiB. This CPU resource budget excludes
 * the host's GPU copies, framebuffers and readbacks; it never reduces size. */
export const SOURCE_PERLIN_FLOW_RESOURCE_LIMITS=Object.freeze({maxBufferBytes:128*1024*1024,channelCount:6,maxSize:2048});
export function sourcePerlinFlowResourceLayout(size:SourcePerlinFlowSize){
 if(size!==512&&size!==1024&&size!==2048)throw new SourcePerlinFlowResourcesError('input','Perlin flow resources require source size 512, 1024 or 2048.');
 const channelBytes=size*size*Uint32Array.BYTES_PER_ELEMENT,retainedBytes=6*channelBytes+SOURCE_PROCESSING_NOISE_TABLE_BYTES;
 // During one reseed: the shared old/new tables and the standalone formula
 // producer's private table can coexist. Completed image buffers are reused.
 const peakBuildBytes=retainedBytes+2*SOURCE_PROCESSING_NOISE_TABLE_BYTES;
 if(peakBuildBytes>SOURCE_PERLIN_FLOW_RESOURCE_LIMITS.maxBufferBytes)throw new SourcePerlinFlowResourcesError('capacity','Perlin flow resources exceed 128 MiB local capacity.');
 return{size,channelBytes,retainedBytes,peakBuildBytes};
}

/** Fixed-JAR rebuildFlowTextures: build all six styles in order on one PApplet
 * noise state. Only prepare/channel (an actual GPU draw request) builds images;
 * constructing or sampling the shared noise never does. Same-size calls reuse
 * the exact channels; changing a bucket releases our old channels before build.
 * No partial result escapes. A build failure retires noise and images together,
 * so a CPU model borrowing this noise must be recreated by its host. */
export class SourcePerlinFlowResources{
 readonly noise:Pick<SourceProcessingNoise,'sample'>;
 private readonly shared:SourceProcessingNoiseState;
 private readonly seed:string;
 private readonly isCancelled?:()=>boolean;
 private channels?:readonly SourcePerlinFlowChannel[];
 private size?:SourcePerlinFlowSize;
 private builds=0;
 private generatedChannels=0;
 private status:'idle'|'building'|'ready'|'failed'|'disposed'='idle';
 constructor(options:SourcePerlinFlowResourcesOptions){
  if(!options||typeof options!=='object'||options.isCancelled!==undefined&&typeof options.isCancelled!=='function')throw new SourcePerlinFlowResourcesError('input','Invalid Perlin flow resource options.');
  const parsed=sourcePerlinSeed(options.seed);this.seed=parsed.originalSeed.toString();this.isCancelled=options.isCancelled;
  if(this.isCancelled?.())throw new SourcePerlinFlowResourcesError('cancelled','Perlin flow resource creation cancelled.');
  this.shared=new SourceProcessingNoiseState(BigInt(parsed.textureSeed));
  this.noise=Object.freeze({sample:(x:number,y?:number,z?:number)=>this.shared.sample(x,y,z)});
 }
 private checkState(){
  if(this.status==='disposed')throw new SourcePerlinFlowResourcesError('disposed','Perlin flow resources are disposed.');
  if(this.status==='failed')throw new SourcePerlinFlowResourcesError('failed','Perlin flow resources failed; recreate their scene owner.');
 }
 private check(){
  this.checkState();
  if(this.isCancelled?.())throw new SourcePerlinFlowResourcesError('cancelled','Perlin flow texture build cancelled.');
  this.checkState();
 }
 private fail(){
  this.channels=undefined;this.size=undefined;this.shared.dispose();
  if(this.status!=='disposed')this.status='failed';
 }
 prepare(size:SourcePerlinFlowSize):readonly SourcePerlinFlowChannel[]{
  this.check();sourcePerlinFlowResourceLayout(size);
  if(this.status==='building')throw new SourcePerlinFlowResourcesError('input','Perlin flow resource build is not reentrant.');
  if(this.channels&&this.size===size)return this.channels;
  this.channels=undefined;this.size=undefined;this.status='building';
  try{
   const next:SourcePerlinFlowChannel[]=[];
   for(let style=0;style<6;style++){
    this.check();
    const flow=new SourcePerlinFlowTexture({seed:this.seed,style:style as SourcePerlinFlowStyle,size,isCancelled:()=>{this.check();return false;}});
    const pixels=flow.generateWithNoise(this.shared);this.generatedChannels++;
    next.push(Object.freeze({size,style:style as SourcePerlinFlowStyle,pixels}));
   }
   this.check();this.channels=Object.freeze(next);this.size=size;this.builds++;this.status='ready';return this.channels;
  }catch(error){this.fail();throw error;}
 }
 channel(style:SourcePerlinFlowStyle,size:SourcePerlinFlowSize):SourcePerlinFlowChannel{
  if(!Number.isInteger(style)||style<0||style>5)throw new SourcePerlinFlowResourcesError('input','Perlin flow channel style must be 0 through 5.');
  return this.prepare(size)[style];
 }
 diagnostics(){
  const noise=this.shared.diagnostics();
  return{state:this.status,size:this.size,builds:this.builds,generatedChannels:this.generatedChannels,retainedBytes:(this.channels?.reduce((n,c)=>n+c.pixels.byteLength,0)??0)+noise.retainedBytes,noiseSeed:noise.seed,noiseReseeds:noise.reseeds};
 }
 dispose():void{this.channels=undefined;this.size=undefined;this.shared.dispose();this.status='disposed';}
}
