import {describe,it,expect,vi} from 'vitest';
import {SourcePerlinFlowResources,sourcePerlinFlowResourceLayout,SOURCE_PERLIN_FLOW_RESOURCE_LIMITS,type SourcePerlinFlowSize} from '../src/engine/sourcePerlinFlowResources';
import {SourcePerlinFlowTexture,type SourcePerlinFlowStyle} from '../src/engine/sourcePerlinFlowTexture';
import {SourceProcessingNoise,SourceProcessingNoiseState,SOURCE_PROCESSING_NOISE_TABLE_BYTES} from '../src/engine/sourceProcessingNoise';
import lifecycle from './fixtures/source-perlin/flow-resources.json';
import textures from './fixtures/source-perlin/flow-textures.json';
const samples=(noise:Pick<SourceProcessingNoise,'sample'>)=>lifecycle.coordinates.map(([x,y,z])=>noise.sample(x,y,z));
const argb=(gray:number)=>(0xff000000|gray<<16|gray<<8|gray)>>>0;

describe('source Perlin shared noise and six flow-resource lifecycle',()=>{
 it('uses independent fixed-artifact evidence without claiming native execution',()=>{
  expect(lifecycle.provenance.nativeExecution).toBe(false);
  expect(lifecycle.provenance.jarSha256).toBe(textures.provenance.jarSha256);
  expect(lifecycle.provenance.classSha256).toBe(textures.provenance.classes.PerlinNoiseField);
 });
 it('initializes only source noise for signed and mixed long seeds, without creating channels',()=>{
  for(const c of lifecycle.cases){
   const owner=new SourcePerlinFlowResources({seed:c.seed});
   expect(samples(owner.noise)).toEqual(c.steps[0].samples);
   expect(owner.diagnostics()).toMatchObject({state:'idle',builds:0,generatedChannels:0,retainedBytes:SOURCE_PROCESSING_NOISE_TABLE_BYTES,noiseSeed:c.steps[0].noiseSeed,noiseReseeds:1});
   owner.dispose();expect(owner.diagnostics().retainedBytes).toBe(0);
   expect(()=>owner.noise.sample(0)).toThrow(expect.objectContaining({code:'disposed'}));
  }
 });
 it('reuses the texture math owner for all six shared-noise images and leaves its last seed',()=>{
  for(const c of textures.cases){
   const flow=new SourcePerlinFlowTexture({seed:c.seed,style:c.style as SourcePerlinFlowStyle,size:8});
   const shared=new SourceProcessingNoiseState(123n),pixels=flow.generateWithNoise(shared);
   expect([...pixels]).toEqual([...Buffer.from(c.small8GrayHex,'hex')].map(argb));
   expect(shared.diagnostics().seed).toBe(String(flow.noiseSeed));
   expect(samples(shared)).toEqual(samples(new SourceProcessingNoise(BigInt(flow.noiseSeed))));
   // The independent existing producer stays unaffected by shared reseeding.
   shared.reseed(-55n);expect([...flow.generate()]).toEqual([...pixels]);
   shared.dispose();
  }
 });
 it('builds 0..5 only on actual new-size preparation and matches independent source-sized pixels and noise history',()=>{
  const c=lifecycle.cases[0];let owner:SourcePerlinFlowResources|undefined,lastSeed:string|undefined;
  let observedSeeds:string[]=[];
  owner=new SourcePerlinFlowResources({seed:c.seed,isCancelled:()=>{
   const d=owner?.diagnostics();
   if(d?.state==='building'&&d.noiseSeed!==lastSeed){lastSeed=d.noiseSeed;observedSeeds.push(lastSeed!);}
   return false;
  }});
  for(const step of c.steps){
   observedSeeds=[];lastSeed=owner.diagnostics().noiseSeed;
   if(step.event.type==='prepare'){
    const size=step.event.size as SourcePerlinFlowSize,channels=owner.prepare(size);
    expect(channels).toHaveLength(6);expect(Object.isFrozen(channels)).toBe(true);
    const snapshot=owner.diagnostics();
    expect(owner.prepare(size)).toBe(channels);expect(owner.channel(4,size)).toBe(channels[4]);
    expect(owner.diagnostics()).toEqual(snapshot);
    for(const [style,channel] of channels.entries()){
     expect(channel).toMatchObject({size,style});expect(channel.pixels.length).toBe(size*size);
     const golden=textures.cases.find(row=>row.seed===c.seed&&row.style===style)!.samples.find(row=>row.size===size)!;
     expect(golden.points.map(([x,y])=>channel.pixels[y*size+x])).toEqual(golden.gray.map(argb));
    }
    expect(snapshot.retainedBytes).toBe(sourcePerlinFlowResourceLayout(size).retainedBytes);
   }
   // Backend selection itself does not call prepare or touch shared noise.
   expect(observedSeeds).toEqual(step.buildStyleSeeds.map(String));
   expect(samples(owner.noise)).toEqual(step.samples);
   expect(owner.diagnostics()).toMatchObject({builds:step.builds,generatedChannels:step.builds*6,noiseSeed:step.noiseSeed,size:step.size??undefined});
  }
  owner.dispose();owner.dispose();expect(owner.diagnostics()).toMatchObject({state:'disposed',retainedBytes:0});
  expect(()=>owner.prepare(512)).toThrow(expect.objectContaining({code:'disposed'}));
 },30_000);
 it('accounts for six 2048² channels and reseed work without silently choosing a smaller bucket',()=>{
  const layout=sourcePerlinFlowResourceLayout(2048);
  expect(layout.channelBytes).toBe(16*1024*1024);
  expect(layout.retainedBytes).toBe(96*1024*1024+SOURCE_PROCESSING_NOISE_TABLE_BYTES);
  expect(layout.peakBuildBytes).toBe(layout.retainedBytes+2*SOURCE_PROCESSING_NOISE_TABLE_BYTES);
  expect(layout.peakBuildBytes).toBeLessThan(SOURCE_PERLIN_FLOW_RESOURCE_LIMITS.maxBufferBytes);
  const owner=new SourcePerlinFlowResources({seed:'0'});
  for(const size of [0,8,513,2049,NaN,Infinity])expect(()=>owner.prepare(size as SourcePerlinFlowSize)).toThrow(expect.objectContaining({code:'input'}));
  for(const style of [-1,6,.5,NaN])expect(()=>owner.channel(style as SourcePerlinFlowStyle,512)).toThrow(expect.objectContaining({code:'input'}));
  expect(owner.diagnostics()).toMatchObject({state:'idle',generatedChannels:0,noiseReseeds:1});owner.dispose();
 });
 it('rejects cancellation before allocation and poisons shared state on a partial six-image build',()=>{
  expect(()=>new SourcePerlinFlowResources({seed:0,isCancelled:()=>true})).toThrow(expect.objectContaining({code:'cancelled',name:'AbortError'}));
  let owner:SourcePerlinFlowResources|undefined;
  const cancelledSeed=String(textures.seedCases.find(c=>c.seed==='0')!.styleSeeds[2]);
  owner=new SourcePerlinFlowResources({seed:0,isCancelled:()=>owner?.diagnostics().noiseSeed===cancelledSeed});
  expect(()=>owner!.prepare(512)).toThrow(expect.objectContaining({code:'cancelled',name:'AbortError'}));
  expect(owner.diagnostics()).toMatchObject({state:'failed',builds:0,generatedChannels:2,retainedBytes:0});
  expect(()=>owner!.prepare(512)).toThrow(expect.objectContaining({code:'failed'}));
  expect(()=>owner!.noise.sample(0)).toThrow(expect.objectContaining({code:'disposed'}));owner.dispose();
 },15_000);
 it('propagates a failed image producer, exposes no partial result and releases the shared table',()=>{
  const failure=new Error('image producer failed'),owner=new SourcePerlinFlowResources({seed:0});
  const spy=vi.spyOn(SourcePerlinFlowTexture.prototype,'generateWithNoise').mockImplementationOnce(()=>{throw failure;});
  try{expect(()=>owner.prepare(512)).toThrow(failure);}finally{spy.mockRestore();}
  expect(owner.diagnostics()).toMatchObject({state:'failed',builds:0,retainedBytes:0});owner.dispose();
 });
 it('keeps immutable tables stable and retires every borrowed mutable sampler at disposal',()=>{
  const immutable=new SourceProcessingNoise(0n),before=samples(immutable),mutable=new SourceProcessingNoiseState(0n);
  mutable.reseed(-123n);expect(samples(immutable)).toEqual(before);expect(samples(mutable)).toEqual(samples(new SourceProcessingNoise(-123n)));
  mutable.reseed(0n);expect(samples(mutable)).toEqual(before);expect(mutable.diagnostics()).toMatchObject({reseeds:3,retainedBytes:16384});
  for(const bad of [1n<<63n,-(1n<<63n)-1n])expect(()=>mutable.reseed(bad)).toThrow(expect.objectContaining({code:'input'}));
  expect(samples(mutable)).toEqual(before);
  mutable.dispose();mutable.dispose();expect(()=>mutable.reseed(1n)).toThrow(expect.objectContaining({code:'disposed'}));
 });
});
