import {createHash} from 'node:crypto';
import {describe,expect,it} from 'vitest';
import original from './fixtures/source-map-native-warmup/Clifford_deJong_2D_4-20261026.json';
import {parseProjectFile} from '../src/engine/legacyImport';
import {iteratedInitialChunk} from '../src/engine/iteratedSeed';
import {prepareSourceIteratedAdvancePlan} from '../src/engine/sourceIteratedAdvancePlan';
import {SourceIteratedSession} from '../src/engine/sourceIteratedSession';
import type {SourceIteratedReplayAsyncBackend} from '../src/engine/sourceIteratedReplayBackend';
import {prepareIteratedFrame,type IteratedFrameJob} from '../src/scenes/iteratedDensity';
import type {GenerateContext} from '../src/types';

const sha256=(bytes:string|Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const scene=()=>parseProjectFile(original.source.json).scene;

describe('Map original first-display warmup evidence',()=>{
 it('dispatches the observed 16 + 16 + 16 passes once, retaining authored burn 200',async()=>{
  // Real parser, timeline, live/replay owners and advance producer. Only the
  // asynchronous execution boundary is recorded: this does not render pixels.
  const calls:{job:IteratedFrameJob;plan:ReturnType<typeof prepareSourceIteratedAdvancePlan>}[]=[];
  let width=0,height=0,disposed=0,presents=0;
  const backend:SourceIteratedReplayAsyncBackend={
   async step(job,options){
    if(!options.bounds)throw Error('Source display must own its captured bounds');
    width=options.width;height=options.height;
    const plan=prepareSourceIteratedAdvancePlan(job,options.resetParticles);calls.push({job,plan});
    return{bounds:options.bounds,steps:job.config.count*(plan.warmupSteps+plan.iterationSteps),invalid:0,accepted:job.config.record?job.config.count:0,clipped:0,sampleInvalid:0};
   },
   async resizeAccumulation(w,h){width=w;height=h;},
   async present(){presents++;return{pixels:new Uint8ClampedArray(width*height*4),occupiedPixels:0,maxCount:0,toneBackend:'native',warnings:[]};},
   validateAccumulationCapture(){},diagnostics(){return{retainedBytes:0};},async dispose(){disposed++;},
  };
  const source=scene(),owner=new SourceIteratedSession('map',{hostClock:{now:()=>1000,source:'page-wall-clock'},asyncBackend:()=>backend});
  let totalIterations=0;
  try{
   for(const frame of original.expected.frames){
    const context:GenerateContext={...original.context as GenerateContext,mapLive:{sessionId:'captured-map-warmup',renderFps:60,replayRevision:0,clock:{paused:false,timestampMs:frame.timestampMs}}};
    const output=await owner.generateAsync(source,context);
    expect(calls).toHaveLength(frame.index+1);
    const {job,plan}=calls[frame.index];
    expect(job.config.burn).toBe(original.expected.authoredBurnIn);
    expect(job.config.count).toBe(original.expected.batchSize);
    expect(job.config.sourceInitialSeed).toBe(original.expected.initialStateSeed);
    expect(job.iterationUpdates).toHaveLength(2);
    expect(plan.advances.map(({steps},ordinal)=>({ordinal,iterations:steps,dimension:job.config.dimension}))).toEqual(frame.updatePasses);
    expect(plan.advances.map(v=>v.phase)).toEqual(frame.index===0?['warmup','update','update']:['update','update']);
    expect(plan.warmupSteps+plan.iterationSteps).toBe(frame.totalIterations);
    expect(plan.resetParticles).toBe(frame.index===0);
    expect(output.mapLive).toMatchObject({objectUpdates:2,display:{passes:1,accumulationPasses:frame.accumulationSampleCount,warmupApplied:frame.warmupApplied,remainingBurnInSteps:0,remainingReplaySteps:0}});
    totalIterations+=frame.totalIterations;
    expect(output.stats.samples).toBe(original.expected.batchSize*totalIterations);
   }
   expect(presents).toBe(original.expected.frames.length);
  }finally{await owner.resetAsync();}
  expect(disposed).toBe(1);
 });

 it('reproduces every active initial particle word captured before the original first update',()=>{
  // The fixture pins the complete raw source and the original active-buffer
  // digest. Texture padding is excluded; no expected intermediate state is fed
  // into the producer and no captured buffer is needed to run this regression.
  expect(sha256(original.source.json)).toBe(original.source.sha256);
  const {config}=prepareIteratedFrame(scene(),0,0);
  expect(config.sourceInitialSeed).toBe(original.expected.initialStateSeed);
  const seed=iteratedInitialChunk(config,0,original.expected.batchSize);
  expect(seed.length).toBe(original.expected.initialActiveWordCount);
  // Serialize explicitly as little endian so the captured digest is portable.
  const bytes=Buffer.alloc(seed.byteLength);
  for(let i=0;i<seed.length;i++)bytes.writeFloatLE(seed[i],i*4);
  expect(sha256(bytes)).toBe(original.expected.initialActiveSha256);
 });
});
