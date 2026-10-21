import {snapshotGenerationInput} from './generationInput';
import type {SourceIteratedNavigationEvent} from './sourceIteratedNavigation';
import type {PerlinFreshRecordingPlan} from './sourcePerlinRecording';
import type { SceneDocument, SceneOutput, GenerationInput, GenerationStatus } from "../types";
import type { StableSearchOptions, StableSearchProgress, StableSearchResult } from './stableSearch';
import type { GenerationRequest, GenerationResponse, RootsPausedCaptureResult, RootsPausedCaptureSize, PerlinPausedCaptureResult, PerlinPausedCaptureSize, PausedCaptureOperation, PausedCaptureResult, PausedCaptureSize, SourceRecordingOptions, SourceRecordingHandle, SourceRecordingStart, SourceRecordingStop, SourceRecordingRaster } from './generationProtocol';
import {pausedCaptureContracts,isPausedCaptureOperation,SourceRecordingOperationError,isSourceRecordingOperation} from './generationProtocol';
import type { ComplexExploreOptions, ComplexExploreProgress, ComplexExploreResult } from './complexExplore';
import type {SpirographRecordingPlan} from './spirographFramePlan';
import type {RootsFreshRecordingPlan} from './rootsRecording';
function recordingRaster(value:unknown,family:string):value is SourceRecordingRaster {
  const v=value as SourceRecordingRaster|undefined;return !!v&&v.type==='raster'&&Number.isSafeInteger(v.width)&&v.width>0&&Number.isSafeInteger(v.height)&&v.height>0&&v.pixels instanceof Uint8ClampedArray&&v.pixels.byteLength===v.width*v.height*4&&(family==='perlin'?!!v.sourcePerlinFrame:family==='map'?!!v.mapLive:family==='symmetry'&&!!v.symmetryLive);
}
type Completed={id:number;scene:SceneDocument;output:SceneOutput};
type Pending =
  | {operation:'iterated-navigation';source:Completed;resolve:(output:SceneOutput)=>void;reject:(error:Error)=>void}
  | {operation:'iterated-parameters';source:Completed;scene:SceneDocument;resolve:()=>void;reject:(error:Error)=>void}
  | {operation:'samila-playback'|'symmetry-playback'|'map-playback';source:Completed;paused:boolean;resolve:()=>void;reject:(error:Error)=>void}
  | {operation:'source-recording-begin';source:Completed;handle:SourceRecordingHandle;resolve:(value:SourceRecordingStart)=>void;reject:(error:Error)=>void}
  | {operation:'source-recording-frame';handle:SourceRecordingHandle;family:string;displayFrame:number;resolve:(value:SourceRecordingRaster)=>void;reject:(error:Error)=>void}
  | {operation:'source-recording-finish';handle:SourceRecordingHandle;family:string;resolve:(value:SourceRecordingStop)=>void;reject:(error:Error)=>void}
  | { operation: 'generate'; scene:SceneDocument; resolve: (output: SceneOutput) => void; reject: (error: Error) => void; onProgress?: (output: SceneOutput) => void; onStatus?: (status: GenerationStatus) => void }
  | { operation:PausedCaptureOperation; source:Completed; resolve:(output:PausedCaptureResult)=>void; reject:(error:Error)=>void }
  | { operation:'perlin-recording-plan'; resolve:(output:PerlinFreshRecordingPlan)=>void; reject:(error:Error)=>void }
  | { operation:'roots-recording-plan'; resolve:(output:RootsFreshRecordingPlan)=>void; reject:(error:Error)=>void }
  | { operation:'spirograph-recording-plan'; resolve:(output:SpirographRecordingPlan)=>void; reject:(error:Error)=>void }
  | { operation: 'search-stable'; resolve: (output: StableSearchResult) => void; reject: (error: Error) => void; onProgress?: (progress: StableSearchProgress) => void }
  | { operation: 'explore-complex'; resolve: (output: ComplexExploreResult) => void; reject: (error: Error) => void; onProgress?: (progress: ComplexExploreProgress) => void };
export class Generator {
  private worker: Worker | null = null;
  private counter = 0;
  private sessionId = 0;
  private pending = new Map<number, Pending>();
  private currentInputId=0;
  private completed?:Completed;
  private recording?:{handle:SourceRecordingHandle;family:string;usable:boolean};
  private playbackPending(){return [...this.pending.values()].some(p=>p.operation==='iterated-navigation'||p.operation==='iterated-parameters'||p.operation==='samila-playback'||p.operation==='symmetry-playback'||p.operation==='map-playback');}
  private recordingError(message:string){const retained=!!this.recording?.usable;return new SourceRecordingOperationError(message,false,retained,retained?this.recording!.handle:undefined);}
  private invalidate(error:Error){
    this.worker?.terminate();this.worker=null;this.recording=undefined;this.completed=undefined;this.currentInputId=0;
    for(const p of this.pending.values())p.reject(error);this.pending.clear();
  }
  hasSourceRecording(handle:SourceRecordingHandle):boolean{return !!this.worker&&this.recording?.handle===handle&&this.recording.usable;}

  private ensure() {
    if (this.worker) return;
    this.sessionId++;
    this.worker = new Worker(new URL("./generate.worker.ts", import.meta.url), {
      type: "module",
    });
    const worker = this.worker;
    this.worker.onmessage = ({ data }: MessageEvent<GenerationResponse>) => {
      if (data.sessionId !== this.sessionId) return;
      const p = this.pending.get(data.id);
      if (!p) return;
      if(p.operation==='iterated-navigation'){
        if(data.operation!=='iterated-navigation'||'error' in data||data.sourceId!==p.source.id||data.id!==this.currentInputId){this.invalidate(new Error('error' in data?data.error:'迭代视口响应身份不匹配'));return;}
        const output=data.output,before=p.source.output,key=p.source.scene.kind==='map'?'mapLive':'symmetryLive';
        if(!recordingRaster(output,p.source.scene.kind)||before.type!=='raster'||!output[key]?.paused||output[key]?.sessionId!==before[key]?.sessionId||output[key]?.sceneTime!==before[key]?.sceneTime||output.sourceCameraFrame?.viewport.target!=='primary'||output.width!==before.width||output.height!==before.height){this.invalidate(new Error('迭代视口响应帧无效'));return;}
        this.pending.delete(data.id);this.completed={...p.source,id:data.id,output};p.resolve(output);return;
      }
      if(p.operation==='iterated-parameters'){
        if(data.operation!=='iterated-parameters'||'error' in data||data.sourceId!==p.source.id||data.id!==this.currentInputId){this.invalidate(new Error('error' in data?data.error:'迭代参数响应身份不匹配'));return;}
        this.pending.delete(data.id);this.completed={...p.source,scene:p.scene};p.resolve();return;
      }
      if(p.operation==='samila-playback' ||p.operation==='symmetry-playback'||p.operation==='map-playback'){
        // A control acknowledgement changes the clock, not the completed image
        // capability. Any uncertain acknowledgement retires this worker so a
        // later draw cannot silently use an unknown paused/running state.
        if((data.operation!=='samila-playback'&&data.operation!=='symmetry-playback'&&data.operation!=='map-playback')||data.operation!==p.operation||'error' in data||data.sourceId!==p.source.id||data.paused!==p.paused||data.id!==this.currentInputId){
          this.invalidate(new Error('error' in data?data.error:'实时场景后台播放响应身份不匹配'));return;
        }
        this.pending.delete(data.id);this.completed=p.source;p.resolve();return;
      }
      if(isSourceRecordingOperation(p.operation)&&'handle' in p){
        const family=p.operation==='source-recording-begin'?p.source.scene.kind:p.family;
        const matching=data.operation===p.operation&&('error' in data||('recordingId' in data&&data.recordingId===p.handle.recordingId&&(p.operation!=='source-recording-frame'||('displayFrame' in data&&data.displayFrame===p.displayFrame))));
        if(!matching){this.invalidate(new SourceRecordingOperationError('源场景后台录制响应身份不匹配',false,false));return;}
        if(!('error' in data)){
          const valid=data.operation==='source-recording-begin'?!!data.result?.scene&&!!data.result.context&&!!data.result.clock&&data.result.scene.kind===family&&recordingRaster(data.result.warmup,family)&&(family==='perlin'?data.result.warmup.sourcePerlinFrame!.frameIndex===0:data.result.warmup.iteratedRecording?.displayFrame===0&&data.result.warmup.iteratedRecording.warmup):
            data.operation==='source-recording-frame'?recordingRaster(data.output,family)&&(family==='perlin'?data.output.sourcePerlinFrame!.frameIndex===data.displayFrame:data.output.iteratedRecording?.displayFrame===data.displayFrame&&!data.output.iteratedRecording.warmup):
            data.operation==='source-recording-finish'&&!!data.result?.scene&&!!data.result.context&&data.result.scene.kind===family&&recordingRaster(data.result.preview,family);
          if(!valid){this.invalidate(new SourceRecordingOperationError('源场景后台录制结果无效',false,false));return;}
        }
        if('error' in data&&data.retainedRecordingId!==undefined&&data.retainedRecordingId!==p.handle.recordingId){this.invalidate(new SourceRecordingOperationError('源场景后台录制保留身份不匹配',false,false));return;}
        this.pending.delete(data.id);
        if('error' in data){
          const retained=data.retainedRecordingId===p.handle.recordingId;
          const previewRetained=p.operation==='source-recording-begin'&&data.retainedSourceId===p.source.id&&!retained;
          if(retained)this.recording={handle:p.handle,family,usable:true};else this.recording=undefined;
          this.completed=previewRetained&&p.operation==='source-recording-begin'?p.source:undefined;
          p.reject(new SourceRecordingOperationError(data.error,previewRetained,retained,retained?p.handle:undefined));return;
        }
        if(p.operation==='source-recording-begin'&&data.operation==='source-recording-begin'){
          this.recording={handle:p.handle,family,usable:true};this.completed=undefined;p.resolve({...data.result,handle:p.handle});return;
        }
        if(p.operation==='source-recording-frame'&&data.operation==='source-recording-frame'){p.resolve(data.output);return;}
        if(p.operation==='source-recording-finish'&&data.operation==='source-recording-finish'){
          this.recording=undefined;this.currentInputId=data.id;this.completed={id:data.id,scene:data.result.scene,output:data.result.preview};p.resolve(data.result);return;
        }
        this.invalidate(new SourceRecordingOperationError('源场景后台录制响应无效',false,false));return;
      }
      if (data.operation === 'generate-status') {
        if (p.operation === 'generate') p.onStatus?.(data.status);
        return;
      }
      if (data.operation === 'generate-progress') {
        if (p.operation === 'generate') p.onProgress?.(data.output);
        return;
      }
      if ('progress' in data) {
        if (p.operation === 'search-stable' && data.operation === 'search-stable') p.onProgress?.(data.progress);
        else if (p.operation === 'explore-complex' && data.operation === 'explore-complex') p.onProgress?.(data.progress);
        return;
      }
      this.pending.delete(data.id);
      if ('error' in data) {
        if(isPausedCaptureOperation(p.operation)&&'source' in p&&!('handle' in p)){
          const retained=data.operation===p.operation&&'retainedSourceId' in data&&data.retainedSourceId===p.source.id&&data.id===this.currentInputId;
          if(retained)this.completed=p.source;
          p.reject(new pausedCaptureContracts[p.operation].Error(data.error,retained));
        }else p.reject(new Error(data.error));
      }
      else if (p.operation === 'search-stable' && data.operation === 'search-stable') p.resolve(data.result);
      else if (p.operation === 'generate' && data.operation === 'generate') {
        if(data.id===this.currentInputId)this.completed={id:data.id,scene:p.scene,output:data.output};
        p.resolve(data.output);
      }
      else if (isPausedCaptureOperation(p.operation)&&'source' in p&&!('handle' in p)&&data.operation===p.operation&&'result' in data) {
        if(data.id===this.currentInputId)this.completed={id:data.id,scene:p.source.scene,output:data.result.preview};
        p.resolve(data.result);
      }
      else if (p.operation === 'explore-complex' && data.operation === 'explore-complex') p.resolve(data.result);
      else if (p.operation === 'perlin-recording-plan' && data.operation === 'perlin-recording-plan') p.resolve(data.result);
      else if (p.operation === 'roots-recording-plan' && data.operation === 'roots-recording-plan') p.resolve(data.result);
      else if (p.operation === 'spirograph-recording-plan' && data.operation === 'spirograph-recording-plan') p.resolve(data.result);
      else p.reject(new Error('后台任务响应与请求类型不一致'));
    };
    this.worker.onerror = (event) => {
      if (this.worker !== worker) return;
      const message=event.message||'后台计算模块加载失败，请刷新页面后重试';
      this.invalidate(this.recording?new SourceRecordingOperationError(message,false,false):new Error(message));
    };
  }
  generate(
    scene: SceneDocument,
    context: GenerationInput,
    onProgress?: (output: SceneOutput) => void,
    onStatus?: (status: GenerationStatus) => void,
  ): Promise<SceneOutput> {
    if(this.recording)return Promise.reject(this.recordingError('源场景录制期间不能生成其它场景'));
    if(this.playbackPending())return Promise.reject(new Error('实时场景播放状态切换尚未完成'));
    this.ensure();
    const id = ++this.counter;
    this.currentInputId=id;this.completed=undefined;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { operation: 'generate', scene, resolve, reject, onProgress, onStatus });
      try { const request: GenerationRequest = { operation: 'generate', sessionId: this.sessionId, id, scene, ...(onStatus?{wantsStatus:true as const}:{}), context: snapshotGenerationInput(context) };
      this.worker!.postMessage(request); } catch (error) { this.pending.delete(id); reject(error); }
    });
  }
  /** The exact completed preview is the capability. A copied, superseded or
   * partially generated frame cannot select a live worker-owned scene. */
  captureRootsPaused(output:SceneOutput,size:RootsPausedCaptureSize,scale:1|3|5=1):Promise<RootsPausedCaptureResult>{
    return this.capturePaused('roots-paused-capture',output,size,scale);
  }
  capturePerlinPaused(output:SceneOutput,size:PerlinPausedCaptureSize,scale:1|3|5=1):Promise<PerlinPausedCaptureResult>{
    return this.capturePaused('perlin-paused-capture',output,size,scale);
  }
  captureSamilaPaused(output:SceneOutput,size:PausedCaptureSize,scale:1|3|5=1):Promise<PausedCaptureResult>{
    return this.capturePaused('samila-paused-capture',output,size,scale);
  }
  captureMapPaused(output:SceneOutput,size:PausedCaptureSize,scale:1|3|5=1):Promise<PausedCaptureResult>{return this.capturePaused('map-paused-capture',output,size,scale);}
  captureSymmetryPaused(output:SceneOutput,size:PausedCaptureSize,scale:1|3|5=1):Promise<PausedCaptureResult>{return this.capturePaused('symmetry-paused-capture',output,size,scale);}
  navigateIteratedPaused(output:SceneOutput,event:SourceIteratedNavigationEvent):Promise<SceneOutput>{
    const source=this.completed;
    if(this.recording||!this.worker||this.pending.size||!source||source.output!==output||output.type!=='raster'||!['map','symmetry'].includes(source.scene.kind)||output.sourceCameraFrame?.viewport.target!=='primary')return Promise.reject(new Error('迭代视口交互需要当前已完成的主预览'));
    const id=++this.counter;this.currentInputId=id;this.completed=undefined;
    return new Promise((resolve,reject)=>{this.pending.set(id,{operation:'iterated-navigation',source,resolve,reject});try{this.worker!.postMessage({operation:'iterated-navigation',sessionId:this.sessionId,id,sourceId:source.id,event} satisfies GenerationRequest);}catch(error){this.invalidate(error instanceof Error?error:new Error(String(error)));}});
  }
  updateIteratedParameters(output:SceneOutput,scene:SceneDocument,writes:readonly (readonly [string,number])[]):Promise<void>{
    const source=this.completed;
    if(this.recording||!this.worker||this.pending.size||!source||source.output!==output||output.type!=='raster'||!['map','symmetry'].includes(source.scene.kind)||output.sourceCameraFrame?.viewport.target!=='primary')return Promise.reject(new Error('迭代参数更新需要当前已完成的主预览'));
    const id=++this.counter;this.currentInputId=id;this.completed=undefined;
    return new Promise((resolve,reject)=>{this.pending.set(id,{operation:'iterated-parameters',source,scene,resolve,reject});try{this.worker!.postMessage({operation:'iterated-parameters',sessionId:this.sessionId,id,sourceId:source.id,scene,writes} satisfies GenerationRequest);}catch(error){this.invalidate(error instanceof Error?error:new Error(String(error)));}});
  }
  setSamilaPaused(output:SceneOutput,paused:boolean):Promise<void>{return this.setLivePaused('samila-playback',output,paused);}
  setMapPaused(output:SceneOutput,paused:boolean,timestampMs?:number):Promise<void>{return this.setLivePaused('map-playback',output,paused,timestampMs);}
  setSymmetryPaused(output:SceneOutput,paused:boolean,timestampMs?:number):Promise<void>{return this.setLivePaused('symmetry-playback',output,paused,timestampMs);}
  private setLivePaused(operation:'samila-playback'|'symmetry-playback'|'map-playback',output:SceneOutput,paused:boolean,timestampMs?:number):Promise<void>{
    const source=this.completed;
    const valid=output.type==='raster'&&(operation==='samila-playback'
      ?source?.scene.kind==='samila'&&output.samilaLive?.target==='primary'&&output.samilaLive.clock==='realtime-source-queue'
      :source?.scene.kind===(operation==='map-playback'?'map':'symmetry')&&output[operation==='map-playback'?'mapLive':'symmetryLive']?.clock==='realtime-source-queue'&&output.sourceCameraFrame?.viewport.target==='primary');
    if(this.recording||!this.worker||this.pending.size||!source||source.output!==output||!valid)
      return Promise.reject(new Error('实时播放控制需要当前已完成的主预览'));
    const id=++this.counter;this.currentInputId=id;this.completed=undefined;
    return new Promise((resolve,reject)=>{
      this.pending.set(id,{operation,source,paused,resolve,reject});
      try{this.worker!.postMessage({operation,sessionId:this.sessionId,id,sourceId:source.id,paused,...(timestampMs!==undefined?{timestampMs}:{})} satisfies GenerationRequest);}
      catch(error){this.invalidate(error instanceof Error?error:new Error(String(error)));}
    });
  }
  private capturePaused(operation:PausedCaptureOperation,output:SceneOutput,size:PausedCaptureSize,scale:1|3|5):Promise<PausedCaptureResult>{
    if(this.recording)return Promise.reject(this.recordingError('源场景录制期间不能截图'));
    const source=this.completed,roots=operation==='roots-paused-capture',contract=pausedCaptureContracts[operation];
    const eligible=output.type==='raster'&&(roots?!!output.rootsPresentation:operation==='symmetry-paused-capture'||operation==='map-paused-capture'?!!output[operation==='map-paused-capture'?'mapLive':'symmetryLive']&&output.sourceCameraFrame?.viewport.target==='primary'&&source?.scene.kind===(operation==='map-paused-capture'?'map':'symmetry'):operation==='samila-paused-capture'?output.samilaLive?.target==='primary'&&source?.scene.kind==='samila':!!output.sourcePerlinFrame&&source?.scene.kind==='perlin'&&!!source.scene.perlinSource);
    if(!this.worker||this.pending.size||!source||source.output!==output||!eligible)
      return Promise.reject(new Error(`当前${contract.label}画面尚未完成或已过期，请等待预览完成后重试`));
    const id=++this.counter;this.currentInputId=id;this.completed=undefined;
    return new Promise((resolve,reject)=>{
      this.pending.set(id,{operation,source,resolve,reject});
      const request:GenerationRequest={operation,sessionId:this.sessionId,id,sourceId:source.id,size:{...size},scale};
      try{this.worker!.postMessage(request);}catch(error){
        this.pending.delete(id);
        // Preserve the established Roots synchronous-send contract. Perlin
        // retention requires an explicit acknowledgement from its live owner.
        const retained=roots&&this.currentInputId===id&&this.worker!==null;if(retained)this.completed=source;
        const message=error instanceof Error?error.message:String(error);
        reject(new contract.Error(message,retained));
      }
    });
  }
  beginSourceRecording(output:SceneOutput,options:SourceRecordingOptions):Promise<SourceRecordingStart>{
    const source=this.completed;
    if(this.recording)return Promise.reject(this.recordingError('源场景录制已开始'));
    if(!this.worker||this.pending.size||!source||source.output!==output||output.type!=='raster'||!recordingRaster(output,source.scene.kind)||(source.scene.kind==='perlin'?!source.scene.perlinSource:output.sourceCameraFrame?.viewport.target!=='primary'||(output.mapLive??output.symmetryLive)?.clock!=='realtime-source-queue'))
      return Promise.reject(new SourceRecordingOperationError('源场景录制需要当前已完成的主预览',false,false));
    const id=++this.counter,handle=Object.freeze({sessionId:this.sessionId,recordingId:id});
    this.currentInputId=id;this.completed=undefined;this.recording={handle,family:source.scene.kind,usable:false};
    return new Promise((resolve,reject)=>{
      this.pending.set(id,{operation:'source-recording-begin',source,handle,resolve,reject});
      try{this.worker!.postMessage({operation:'source-recording-begin',sessionId:this.sessionId,id,sourceId:source.id,options:{...options}} satisfies GenerationRequest);}
      catch(error){this.invalidate(new SourceRecordingOperationError(error instanceof Error?error.message:String(error),false,false));}
    });
  }
  nextSourceRecordingFrame(handle:SourceRecordingHandle,displayFrame:number):Promise<SourceRecordingRaster>{
    if(!this.hasSourceRecording(handle)||this.pending.size)return Promise.reject(this.recordingError('源场景录制身份无效或前一操作尚未完成'));
    if(!Number.isSafeInteger(displayFrame)||displayFrame<1)return Promise.reject(this.recordingError('源场景录制帧序号无效'));
    const id=++this.counter;
    return new Promise((resolve,reject)=>{
      this.pending.set(id,{operation:'source-recording-frame',handle,family:this.recording!.family,displayFrame,resolve,reject});
      try{this.worker!.postMessage({operation:'source-recording-frame',sessionId:this.sessionId,id,recordingId:handle.recordingId,displayFrame} satisfies GenerationRequest);}
      catch(error){this.invalidate(new SourceRecordingOperationError(error instanceof Error?error.message:String(error),false,false));}
    });
  }
  finishSourceRecording(handle:SourceRecordingHandle):Promise<SourceRecordingStop>{
    if(!this.hasSourceRecording(handle)||this.pending.size)return Promise.reject(this.recordingError('源场景录制身份无效或前一操作尚未完成'));
    const id=++this.counter;
    return new Promise((resolve,reject)=>{
      this.pending.set(id,{operation:'source-recording-finish',handle,family:this.recording!.family,resolve,reject});
      try{this.worker!.postMessage({operation:'source-recording-finish',sessionId:this.sessionId,id,recordingId:handle.recordingId} satisfies GenerationRequest);}
      catch(error){this.invalidate(new SourceRecordingOperationError(error instanceof Error?error.message:String(error),false,false));}
    });
  }
  searchStable(scene: SceneDocument, options: StableSearchOptions = {}, onProgress?: (progress: StableSearchProgress) => void): Promise<StableSearchResult> {
    if(this.recording)return Promise.reject(this.recordingError('源场景录制期间不能执行其它后台任务'));
    if(this.playbackPending())return Promise.reject(new Error('实时场景播放状态切换尚未完成'));
    this.ensure();
    const id = ++this.counter;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { operation: 'search-stable', resolve, reject, onProgress });
      const request: GenerationRequest = { operation: 'search-stable', sessionId: this.sessionId, id, scene, options };
      try { this.worker!.postMessage(request); } catch (error) { this.pending.delete(id); reject(error); }
    });
  }
  planSpirographRecording(scene:SceneDocument,startFrame:number,fps:number):Promise<SpirographRecordingPlan>{
    if(this.recording)return Promise.reject(this.recordingError('源场景录制期间不能执行其它后台任务'));
    if(this.playbackPending())return Promise.reject(new Error('实时场景播放状态切换尚未完成'));
    this.ensure();const id=++this.counter;
    return new Promise((resolve,reject)=>{
      this.pending.set(id,{operation:'spirograph-recording-plan',resolve,reject});
      const request:GenerationRequest={operation:'spirograph-recording-plan',sessionId:this.sessionId,id,scene,startFrame,fps};
      try{this.worker!.postMessage(request);}catch(error){this.pending.delete(id);reject(error);}
    });
  }
  planPerlinFreshRecording(scene:SceneDocument,simulationFps:number,encoderFps:number):Promise<PerlinFreshRecordingPlan>{
    if(this.recording)return Promise.reject(this.recordingError('源场景录制期间不能执行其它后台任务'));
    if(this.playbackPending())return Promise.reject(new Error('实时场景播放状态切换尚未完成'));
    this.ensure();const id=++this.counter;
    return new Promise((resolve,reject)=>{
      this.pending.set(id,{operation:'perlin-recording-plan',resolve,reject});
      const request:GenerationRequest={operation:'perlin-recording-plan',sessionId:this.sessionId,id,scene,simulationFps,encoderFps};
      try{this.worker!.postMessage(request);}catch(error){this.pending.delete(id);reject(error);}
    });
  }
  planRootsFreshRecording(scene:SceneDocument,simulationFps:number,encoderFps:number):Promise<RootsFreshRecordingPlan>{
    if(this.recording)return Promise.reject(this.recordingError('源场景录制期间不能执行其它后台任务'));
    if(this.playbackPending())return Promise.reject(new Error('实时场景播放状态切换尚未完成'));
    this.ensure();const id=++this.counter;
    return new Promise((resolve,reject)=>{
      this.pending.set(id,{operation:'roots-recording-plan',resolve,reject});
      const request:GenerationRequest={operation:'roots-recording-plan',sessionId:this.sessionId,id,scene,simulationFps,encoderFps};
      try{this.worker!.postMessage(request);}catch(error){this.pending.delete(id);reject(error);}
    });
  }
  exploreComplex(scene: SceneDocument, options: ComplexExploreOptions, onProgress?: (progress: ComplexExploreProgress) => void): Promise<ComplexExploreResult> {
    if(this.recording)return Promise.reject(this.recordingError('源场景录制期间不能执行其它后台任务'));
    if(this.playbackPending())return Promise.reject(new Error('实时场景播放状态切换尚未完成'));
    this.ensure();
    const id = ++this.counter;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { operation: 'explore-complex', resolve, reject, onProgress });
      const request: GenerationRequest = { operation: 'explore-complex', sessionId: this.sessionId, id, scene, options };
      try { this.worker!.postMessage(request); } catch (error) { this.pending.delete(id); reject(error); }
    });
  }
  cancel() {
    // A recording cancellation is an orderly finish owned by the queue.
    if(this.recording)return;
    this.completed=undefined;this.currentInputId=0;
    this.worker?.terminate();
    this.worker = null;
    for (const p of this.pending.values())
      p.reject(new DOMException("已取消", "AbortError"));
    this.pending.clear();
  }
  dispose() {
    this.invalidate(this.recording?new SourceRecordingOperationError('源场景录制后台已释放',false,false):new DOMException('已取消','AbortError'));
  }
}
