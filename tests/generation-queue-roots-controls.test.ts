import {describe,expect,it,vi} from 'vitest';
import {GenerationQueue} from '../src/engine/generationQueue';
import {RootsControlJournal} from '../src/engine/rootsControlJournal';
import type {RootsControlReceipt} from '../src/engine/rootsControl';
import {createScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {defaultRootsPendingConfiguration,defaultRootsPresentationConfiguration} from '../src/engine/rootsPresentationConfig';
import {withRootsPresentation} from '../src/engine/rootsPresentationAuthoring';
import {withRootsSceneTimeline} from '../src/engine/rootsCameraTimeline';
import {RootsSceneClock} from '../src/engine/rootsSceneClock';
import {assertRootsLiveRecordingFrame} from '../src/engine/sourceRootsRecordingLease';
import {validRootsLiveOutput} from '../src/engine/rootsLive';
import type {GenerationInput,SceneOutput,SceneDocument} from '../src/types';
import type {SourceRecordingHandle,SourceRecordingStart,SourceRecordingStop} from '../src/engine/generationProtocol';

const flush=async()=>{for(let index=0;index<20;index++)await Promise.resolve();};
const clock={simulationFps:24,warmupUpdates:1 as const,completionReason:'observed-roots-display' as const};
const options={width:2,height:2,simulationFps:24};
type Raster=Extract<SceneOutput,{type:'raster'}>;
function scene(){
 const value=withRootsSceneTimeline(withRootsPresentation(createScene(definition('roots')),{...defaultRootsPresentationConfiguration(),pending:defaultRootsPendingConfiguration(),previewMode:'live-worker-arrival-v1'}),true);
 value.timeline.tracks=[];return value;
}
const input=(journal:RootsControlJournal):GenerationInput=>({width:2,height:2,time:0,quality:'preview',rootsPixelDensity:1,rootsLive:{sessionId:journal.sessionId,maximumWorkers:1,clock:{paused:false,timestampMs:1000},controls:journal.request()}});

/** Controlled transport double, not GPU evidence. Its terminal warmup uses the
 * actual Roots observed-display clock and is checked by the production Roots
 * recording validator before exercising the queue's cleanup race. */
function raster(sessionId:string,controls:RootsControlReceipt,recording=false):Raster {
 const presentation={...defaultRootsPresentationConfiguration(),pending:defaultRootsPendingConfiguration()},frame=new RootsSceneClock(presentation.camera,[]).step(Math.fround(1/Math.fround(clock.simulationFps)));
 return{
  type:'raster',width:2,height:2,pixels:new Uint8ClampedArray(16),stats:{samples:1,generated:0,invalid:0,elapsedMs:0},
  formulaPresentation:{referenceWidth:2,referenceHeight:2,labels:[]},
  roots:{totalSamples:1,attemptedSamples:1,acceptedPolynomials:1,filteredSamples:0,invalidSamples:0,nonconvergentSamples:0,rootPoints:0,solverIterations:0,solverWork:0,maxResidual:null,complete:true},
  rootsPresentation:{model:'mathart-1.7.8-v1',mode:'density',clockPolicy:'source-live-clock-v1',streamPolicy:'worker-arrival',presentationAlpha:'preserved-framebuffer-rgba',instance:controls.resetRevision,restartReason:null,attemptedSamples:1,newSamples:0,newRawPoints:0,totalRawPoints:0,physicalSize:[2,2],logicalSize:[2,2],referenceLogicalHeight:2,target:recording?'offscreen':'primary'},
  rootsLive:{sessionId,controls,presentation,paused:false,clockSource:recording?'render-fixed-step':'worker-wall-clock',renderKind:recording?'update':'snapshot',sceneTime:frame.sceneTime,frame,
   ...(recording?{recording:{displayFrame:0,simulationFps:24,warmup:true,complete:true}}:{}),
   autoRecording:{policy:'roots-worker-arrival-v1',complete:true,queueComplete:true,hasAnimations:false,mode:'density',finishedWorkers:1,workerCount:1,queueSize:0,pendingPoints:0},
   stream:{policy:'roots-worker-arrival-v1',invalidRoots:0,reservedBytes:0,disposed:false,failed:false,canFinishAfterDisplay:true,
    pool:{state:'complete',workerCount:1,queueCapacity:1,queuedBatches:0,waitingBatches:0,producerSamplesObserved:1,consumedSamples:1,consumedTerminals:1,offers:1,taken:1,retainedPointBytes:0,reservedBytes:0,ownedWorkers:0,computationComplete:true,drawingComplete:null},
    pending:{storage:'points',queueCapacity:1,queuedBatches:0,queuedPoints:0,queueFull:false,pendingBatches:0,pendingPoints:0,finishedWorkers:1,workerCount:1,builders:0,builderPoints:0,blockedWorkers:0,blockedPoints:0,finishWaitingWorkers:0,producedPoints:0,publishedPoints:0,drainedPoints:0,consumedPoints:0,retainedBytes:0,peakBytes:0,failed:false,disposed:false},
   },
  },
 };
}
async function fixture(){
 const author=scene(),journal=new RootsControlJournal('roots-old',author),handle=Object.freeze({sessionId:1,recordingId:1});let retained=false;
 const warmup=raster(journal.sessionId,{revision:1,applyRevision:1,resetRevision:2},true);
 assertRootsLiveRecordingFrame(warmup,clock,0);
 const recordingInput={...input(journal),time:warmup.rootsLive!.sceneTime,rootsLive:{...input(journal).rootsLive!,clock:{paused:false},controls:{acknowledgedRevision:1,commands:[]}}};
 const start:SourceRecordingStart={handle,scene:author,context:{...recordingInput,time:0},clock,warmup};
 const stop:SourceRecordingStop={scene:author,context:recordingInput,preview:raster(journal.sessionId,{revision:1,applyRevision:1,resetRevision:2})};
 const callbacks={output:vi.fn(),error:vi.fn(),busy:vi.fn(),recordingStopped:vi.fn(),rootsControlAcknowledged:vi.fn((sessionId:string,receipt:RootsControlReceipt)=>{journal.acknowledge(sessionId,receipt);})};
 const port={
  generate:vi.fn(async(_scene:SceneDocument,context:GenerationInput)=>raster(context.rootsLive!.sessionId,{revision:context.rootsLive!.controls!.commands.at(-1)?.revision??context.rootsLive!.controls!.acknowledgedRevision,applyRevision:1,resetRevision:1})),
  cancel:vi.fn(),dispose:vi.fn(),
  beginSourceRecording:vi.fn(async()=>{retained=true;return start;}),
  nextSourceRecordingFrame:vi.fn(async()=>{throw Error('The terminal Roots warmup must not request another frame');}),
  finishSourceRecording:vi.fn(async(_handle:SourceRecordingHandle)=>{retained=false;return stop;}),
  hasSourceRecording:vi.fn((token:SourceRecordingHandle)=>retained&&token===handle),
 };
 const queue=new GenerationQueue(port,callbacks);queue.request(author,input(journal));await flush();
 const preview=callbacks.output.mock.calls.at(-1)![0] as Raster;expect(validRootsLiveOutput(preview,input(journal))).toBe(true);
 callbacks.output.mockClear();callbacks.error.mockClear();port.cancel.mockClear();
 return{author,journal,start,stop,handle,preview,callbacks,port,queue};
}

describe('Roots queue command acknowledgement lifecycle',()=>{
 it.each(['new-document','same-document-reference'] as const)('keeps the new session opened by stop acknowledgement (%s)',async identity=>{
  const f=await fixture(),replacement=identity==='new-document'?{...f.author,id:'replacement',name:'new document'}:f.author,nextJournal=new RootsControlJournal('roots-new',replacement);let opened=false;
  f.callbacks.rootsControlAcknowledged.mockImplementation((sessionId,receipt)=>{
   if(sessionId===nextJournal.sessionId){nextJournal.acknowledge(sessionId,receipt);return;}
   f.journal.acknowledge(sessionId,receipt);
   if(!opened&&f.port.finishSourceRecording.mock.calls.length){opened=true;f.queue.request(replacement,input(nextJournal));}
  });
  const consumer={frame:vi.fn(),complete:vi.fn()};
  try{
   await f.queue.recordSource(f.preview,options,consumer);await flush();
   expect(opened).toBe(true);expect(consumer.frame).not.toHaveBeenCalled();expect(consumer.complete).toHaveBeenCalledWith(f.start,{reason:'queue-complete',encodedFrames:0,lastDisplayFrame:0});
   expect(f.port.finishSourceRecording).toHaveBeenCalledExactlyOnceWith(f.handle);expect(f.port.hasSourceRecording(f.handle)).toBe(false);
   expect(f.callbacks.recordingStopped).not.toHaveBeenCalled();
   expect(f.callbacks.output).toHaveBeenCalledOnce();expect(f.callbacks.output.mock.calls[0][0].rootsLive.sessionId).toBe(nextJournal.sessionId);
   expect(f.port.generate).toHaveBeenCalledTimes(2);expect(f.port.generate.mock.calls[1][0]).toBe(replacement);expect(f.port.generate.mock.calls[1][1].rootsLive?.sessionId).toBe(nextJournal.sessionId);
   expect(nextJournal.pendingCount).toBe(0);expect(f.callbacks.error).not.toHaveBeenCalled();
  }finally{f.queue.dispose();}
 });

 it('keeps an explicitly rejected receipt pending so a retry delivers the same command',async()=>{
  const f=await fixture(),error=new Error('journal rejected receipt'),edited={...f.author,rootsSourcePalette:{colors:['#ff0000']}};
  const command=f.journal.enqueue({kind:'palette',palette:edited.rootsSourcePalette});
  f.callbacks.rootsControlAcknowledged.mockImplementationOnce(()=>{throw error;});
  try{
   f.queue.request(edited,input(f.journal));await flush();
   expect(f.callbacks.error).toHaveBeenCalledExactlyOnceWith(error);expect(f.callbacks.output).not.toHaveBeenCalled();
   expect(f.journal.request()).toEqual({acknowledgedRevision:1,commands:[command]});
   f.queue.request(edited,input(f.journal));await flush();
   expect(f.port.generate).toHaveBeenCalledTimes(3);
   for(const call of f.port.generate.mock.calls.slice(1))expect(call[1].rootsLive?.controls).toEqual({acknowledgedRevision:1,commands:[command]});
   expect(f.callbacks.output).toHaveBeenCalledOnce();expect(f.journal.pendingCount).toBe(0);expect(f.journal.receipt).toEqual({revision:2,applyRevision:1,resetRevision:1});
  }finally{f.queue.dispose();}
 });
});
