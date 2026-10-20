import type {PerlinFreshRecordingPlan} from './sourcePerlinRecording';
import type { SceneDocument, SceneOutput, GenerationInput, GenerationStatus } from "../types";
import type { StableSearchOptions, StableSearchProgress, StableSearchResult } from './stableSearch';
import type { GenerationRequest, GenerationResponse, RootsPausedCaptureResult, RootsPausedCaptureSize, PerlinPausedCaptureResult, PerlinPausedCaptureSize, PausedCaptureOperation, PausedCaptureResult, PausedCaptureSize, PerlinRecordingOptions, PerlinRecordingHandle, PerlinRecordingStart, PerlinRecordingStop, PerlinRecordingRaster } from './generationProtocol';
import {RootsPausedCaptureError,PerlinPausedCaptureError,isPausedCaptureOperation,PerlinRecordingOperationError,isPerlinRecordingOperation} from './generationProtocol';
import type { ComplexExploreOptions, ComplexExploreProgress, ComplexExploreResult } from './complexExplore';
import type {SpirographRecordingPlan} from './spirographFramePlan';
import type {RootsFreshRecordingPlan} from './rootsRecording';
function recordingRaster(value:unknown):value is PerlinRecordingRaster {
  const v=value as PerlinRecordingRaster|undefined;return !!v&&v.type==='raster'&&Number.isSafeInteger(v.width)&&v.width>0&&Number.isSafeInteger(v.height)&&v.height>0&&v.pixels instanceof Uint8ClampedArray&&v.pixels.byteLength===v.width*v.height*4&&!!v.sourcePerlinFrame;
}
type Completed={id:number;scene:SceneDocument;output:SceneOutput};
type Pending =
  | {operation:'perlin-recording-begin';source:Completed;handle:PerlinRecordingHandle;resolve:(value:PerlinRecordingStart)=>void;reject:(error:Error)=>void}
  | {operation:'perlin-recording-frame';handle:PerlinRecordingHandle;displayFrame:number;resolve:(value:PerlinRecordingRaster)=>void;reject:(error:Error)=>void}
  | {operation:'perlin-recording-finish';handle:PerlinRecordingHandle;resolve:(value:PerlinRecordingStop)=>void;reject:(error:Error)=>void}
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
  private recording?:{handle:PerlinRecordingHandle;usable:boolean};
  private recordingError(message:string){const retained=!!this.recording?.usable;return new PerlinRecordingOperationError(message,false,retained,retained?this.recording!.handle:undefined);}
  private invalidate(error:Error){
    this.worker?.terminate();this.worker=null;this.recording=undefined;this.completed=undefined;this.currentInputId=0;
    for(const p of this.pending.values())p.reject(error);this.pending.clear();
  }
  hasPerlinRecording(handle:PerlinRecordingHandle):boolean{return !!this.worker&&this.recording?.handle===handle&&this.recording.usable;}

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
      if(isPerlinRecordingOperation(p.operation)&&'handle' in p){
        const matching=data.operation===p.operation&&('error' in data||('recordingId' in data&&data.recordingId===p.handle.recordingId&&(p.operation!=='perlin-recording-frame'||('displayFrame' in data&&data.displayFrame===p.displayFrame))));
        if(!matching){this.invalidate(new PerlinRecordingOperationError('Perlin 后台录制响应身份不匹配',false,false));return;}
        if(!('error' in data)){
          const valid=data.operation==='perlin-recording-begin'?!!data.result?.scene&&!!data.result.context&&!!data.result.clock&&recordingRaster(data.result.warmup)&&data.result.warmup.sourcePerlinFrame!.frameIndex===0:
            data.operation==='perlin-recording-frame'?recordingRaster(data.output)&&data.output.sourcePerlinFrame!.frameIndex===data.displayFrame:
            data.operation==='perlin-recording-finish'&&!!data.result?.scene&&!!data.result.context&&recordingRaster(data.result.preview);
          if(!valid){this.invalidate(new PerlinRecordingOperationError('Perlin 后台录制结果无效',false,false));return;}
        }
        if('error' in data&&data.retainedRecordingId!==undefined&&data.retainedRecordingId!==p.handle.recordingId){this.invalidate(new PerlinRecordingOperationError('Perlin 后台录制保留身份不匹配',false,false));return;}
        this.pending.delete(data.id);
        if('error' in data){
          const retained=data.retainedRecordingId===p.handle.recordingId;
          const previewRetained=p.operation==='perlin-recording-begin'&&data.retainedSourceId===p.source.id&&!retained;
          if(retained)this.recording={handle:p.handle,usable:true};else this.recording=undefined;
          this.completed=previewRetained&&p.operation==='perlin-recording-begin'?p.source:undefined;
          p.reject(new PerlinRecordingOperationError(data.error,previewRetained,retained,retained?p.handle:undefined));return;
        }
        if(p.operation==='perlin-recording-begin'&&data.operation==='perlin-recording-begin'){
          this.recording={handle:p.handle,usable:true};this.completed=undefined;p.resolve({...data.result,handle:p.handle});return;
        }
        if(p.operation==='perlin-recording-frame'&&data.operation==='perlin-recording-frame'){p.resolve(data.output);return;}
        if(p.operation==='perlin-recording-finish'&&data.operation==='perlin-recording-finish'){
          this.recording=undefined;this.currentInputId=data.id;this.completed={id:data.id,scene:data.result.scene,output:data.result.preview};p.resolve(data.result);return;
        }
        this.invalidate(new PerlinRecordingOperationError('Perlin 后台录制响应无效',false,false));return;
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
          p.reject(p.operation==='roots-paused-capture'?new RootsPausedCaptureError(data.error,retained):new PerlinPausedCaptureError(data.error,retained));
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
      this.invalidate(this.recording?new PerlinRecordingOperationError(message,false,false):new Error(message));
    };
  }
  generate(
    scene: SceneDocument,
    context: GenerationInput,
    onProgress?: (output: SceneOutput) => void,
    onStatus?: (status: GenerationStatus) => void,
  ): Promise<SceneOutput> {
    if(this.recording)return Promise.reject(this.recordingError('Perlin 录制期间不能生成其它场景'));
    this.ensure();
    const id = ++this.counter;
    this.currentInputId=id;this.completed=undefined;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { operation: 'generate', scene, resolve, reject, onProgress, onStatus });
      const request: GenerationRequest = { operation: 'generate', sessionId: this.sessionId, id, scene, ...(onStatus?{wantsStatus:true as const}:{}), context: { time: context.time, width: context.width, height: context.height, quality: context.quality, ...(context.sourceBouncingView!==undefined?{sourceBouncingView:{...context.sourceBouncingView}}:{}),...(context.sourceBouncingFrame!==undefined?{sourceBouncingFrame:context.sourceBouncingFrame}:{}),...(context.spirographFrame?{spirographFrame:context.spirographFrame}:{}),...(context.sourcePerlinViewport?{sourcePerlinViewport:{...context.sourcePerlinViewport}}:{}),...(context.sourceViewport?{sourceViewport:{...context.sourceViewport}}:{}),...(context.sourcePointPixelDensity!==undefined?{sourcePointPixelDensity:context.sourcePointPixelDensity}:{}),...(context.rootsViewport?{rootsViewport:{...context.rootsViewport}}:{}),...(context.fractalViewport!==undefined?{fractalViewport:context.fractalViewport&&typeof context.fractalViewport==='object'&&!Array.isArray(context.fractalViewport)?{...context.fractalViewport}:context.fractalViewport}:{}),...(context.rootsSessionId!==undefined?{rootsSessionId:context.rootsSessionId}:{}) } };
      try { this.worker!.postMessage(request); } catch (error) { this.pending.delete(id); reject(error); }
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
  private capturePaused(operation:PausedCaptureOperation,output:SceneOutput,size:PausedCaptureSize,scale:1|3|5):Promise<PausedCaptureResult>{
    if(this.recording)return Promise.reject(this.recordingError('Perlin 录制期间不能截图'));
    const source=this.completed,roots=operation==='roots-paused-capture';
    const eligible=output.type==='raster'&&(roots?!!output.rootsPresentation:!!output.sourcePerlinFrame&&source?.scene.kind==='perlin'&&!!source.scene.perlinSource);
    if(!this.worker||this.pending.size||!source||source.output!==output||!eligible)
      return Promise.reject(new Error(`当前${roots?'复根':'Perlin'}画面尚未完成或已过期，请等待预览完成后重试`));
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
        reject(roots?new RootsPausedCaptureError(message,retained):new PerlinPausedCaptureError(message,retained));
      }
    });
  }
  beginPerlinRecording(output:SceneOutput,options:PerlinRecordingOptions):Promise<PerlinRecordingStart>{
    const source=this.completed;
    if(this.recording)return Promise.reject(this.recordingError('Perlin 录制已开始'));
    if(!this.worker||this.pending.size||!source||source.output!==output||output.type!=='raster'||!output.sourcePerlinFrame||source.scene.kind!=='perlin'||!source.scene.perlinSource)
      return Promise.reject(new PerlinRecordingOperationError('Perlin 录制需要当前已完成的主预览',false,false));
    const id=++this.counter,handle=Object.freeze({sessionId:this.sessionId,recordingId:id});
    this.currentInputId=id;this.completed=undefined;this.recording={handle,usable:false};
    return new Promise((resolve,reject)=>{
      this.pending.set(id,{operation:'perlin-recording-begin',source,handle,resolve,reject});
      try{this.worker!.postMessage({operation:'perlin-recording-begin',sessionId:this.sessionId,id,sourceId:source.id,options:{...options}} satisfies GenerationRequest);}
      catch(error){this.invalidate(new PerlinRecordingOperationError(error instanceof Error?error.message:String(error),false,false));}
    });
  }
  nextPerlinRecordingFrame(handle:PerlinRecordingHandle,displayFrame:number):Promise<PerlinRecordingRaster>{
    if(!this.hasPerlinRecording(handle)||this.pending.size)return Promise.reject(this.recordingError('Perlin 录制身份无效或前一操作尚未完成'));
    if(!Number.isSafeInteger(displayFrame)||displayFrame<1)return Promise.reject(this.recordingError('Perlin 录制帧序号无效'));
    const id=++this.counter;
    return new Promise((resolve,reject)=>{
      this.pending.set(id,{operation:'perlin-recording-frame',handle,displayFrame,resolve,reject});
      try{this.worker!.postMessage({operation:'perlin-recording-frame',sessionId:this.sessionId,id,recordingId:handle.recordingId,displayFrame} satisfies GenerationRequest);}
      catch(error){this.invalidate(new PerlinRecordingOperationError(error instanceof Error?error.message:String(error),false,false));}
    });
  }
  finishPerlinRecording(handle:PerlinRecordingHandle):Promise<PerlinRecordingStop>{
    if(!this.hasPerlinRecording(handle)||this.pending.size)return Promise.reject(this.recordingError('Perlin 录制身份无效或前一操作尚未完成'));
    const id=++this.counter;
    return new Promise((resolve,reject)=>{
      this.pending.set(id,{operation:'perlin-recording-finish',handle,resolve,reject});
      try{this.worker!.postMessage({operation:'perlin-recording-finish',sessionId:this.sessionId,id,recordingId:handle.recordingId} satisfies GenerationRequest);}
      catch(error){this.invalidate(new PerlinRecordingOperationError(error instanceof Error?error.message:String(error),false,false));}
    });
  }
  searchStable(scene: SceneDocument, options: StableSearchOptions = {}, onProgress?: (progress: StableSearchProgress) => void): Promise<StableSearchResult> {
    if(this.recording)return Promise.reject(this.recordingError('Perlin 录制期间不能执行其它后台任务'));
    this.ensure();
    const id = ++this.counter;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { operation: 'search-stable', resolve, reject, onProgress });
      const request: GenerationRequest = { operation: 'search-stable', sessionId: this.sessionId, id, scene, options };
      try { this.worker!.postMessage(request); } catch (error) { this.pending.delete(id); reject(error); }
    });
  }
  planSpirographRecording(scene:SceneDocument,startFrame:number,fps:number):Promise<SpirographRecordingPlan>{
    if(this.recording)return Promise.reject(this.recordingError('Perlin 录制期间不能执行其它后台任务'));
    this.ensure();const id=++this.counter;
    return new Promise((resolve,reject)=>{
      this.pending.set(id,{operation:'spirograph-recording-plan',resolve,reject});
      const request:GenerationRequest={operation:'spirograph-recording-plan',sessionId:this.sessionId,id,scene,startFrame,fps};
      try{this.worker!.postMessage(request);}catch(error){this.pending.delete(id);reject(error);}
    });
  }
  planPerlinFreshRecording(scene:SceneDocument,simulationFps:number,encoderFps:number):Promise<PerlinFreshRecordingPlan>{
    if(this.recording)return Promise.reject(this.recordingError('Perlin 录制期间不能执行其它后台任务'));
    this.ensure();const id=++this.counter;
    return new Promise((resolve,reject)=>{
      this.pending.set(id,{operation:'perlin-recording-plan',resolve,reject});
      const request:GenerationRequest={operation:'perlin-recording-plan',sessionId:this.sessionId,id,scene,simulationFps,encoderFps};
      try{this.worker!.postMessage(request);}catch(error){this.pending.delete(id);reject(error);}
    });
  }
  planRootsFreshRecording(scene:SceneDocument,simulationFps:number,encoderFps:number):Promise<RootsFreshRecordingPlan>{
    if(this.recording)return Promise.reject(this.recordingError('Perlin 录制期间不能执行其它后台任务'));
    this.ensure();const id=++this.counter;
    return new Promise((resolve,reject)=>{
      this.pending.set(id,{operation:'roots-recording-plan',resolve,reject});
      const request:GenerationRequest={operation:'roots-recording-plan',sessionId:this.sessionId,id,scene,simulationFps,encoderFps};
      try{this.worker!.postMessage(request);}catch(error){this.pending.delete(id);reject(error);}
    });
  }
  exploreComplex(scene: SceneDocument, options: ComplexExploreOptions, onProgress?: (progress: ComplexExploreProgress) => void): Promise<ComplexExploreResult> {
    if(this.recording)return Promise.reject(this.recordingError('Perlin 录制期间不能执行其它后台任务'));
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
    this.invalidate(this.recording?new PerlinRecordingOperationError('Perlin 录制后台已释放',false,false):new DOMException('已取消','AbortError'));
  }
}
