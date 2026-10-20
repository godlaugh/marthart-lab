import type {PerlinFreshRecordingPlan} from './sourcePerlinRecording';
import type { SceneDocument, SceneOutput, GenerationInput, GenerationStatus } from "../types";
import type { StableSearchOptions, StableSearchProgress, StableSearchResult } from './stableSearch';
import type { GenerationRequest, GenerationResponse, RootsPausedCaptureResult, RootsPausedCaptureSize, PerlinPausedCaptureResult, PerlinPausedCaptureSize, PausedCaptureOperation, PausedCaptureResult, PausedCaptureSize } from './generationProtocol';
import {RootsPausedCaptureError,PerlinPausedCaptureError,isPausedCaptureOperation} from './generationProtocol';
import type { ComplexExploreOptions, ComplexExploreProgress, ComplexExploreResult } from './complexExplore';
import type {SpirographRecordingPlan} from './spirographFramePlan';
import type {RootsFreshRecordingPlan} from './rootsRecording';
type Completed={id:number;scene:SceneDocument;output:SceneOutput};
type Pending = { operation: 'generate'; scene:SceneDocument; resolve: (output: SceneOutput) => void; reject: (error: Error) => void; onProgress?: (output: SceneOutput) => void; onStatus?: (status: GenerationStatus) => void }
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
        if(isPausedCaptureOperation(p.operation)&&'source' in p){
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
      else if (isPausedCaptureOperation(p.operation)&&'source' in p&&data.operation===p.operation&&'result' in data) {
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
      for (const p of this.pending.values()) p.reject(new Error(event.message || '后台计算模块加载失败，请刷新页面后重试'));
      this.pending.clear();
      this.completed=undefined;
      worker.terminate();
      this.worker = null;
    };
  }
  generate(
    scene: SceneDocument,
    context: GenerationInput,
    onProgress?: (output: SceneOutput) => void,
    onStatus?: (status: GenerationStatus) => void,
  ): Promise<SceneOutput> {
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
  searchStable(scene: SceneDocument, options: StableSearchOptions = {}, onProgress?: (progress: StableSearchProgress) => void): Promise<StableSearchResult> {
    this.ensure();
    const id = ++this.counter;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { operation: 'search-stable', resolve, reject, onProgress });
      const request: GenerationRequest = { operation: 'search-stable', sessionId: this.sessionId, id, scene, options };
      try { this.worker!.postMessage(request); } catch (error) { this.pending.delete(id); reject(error); }
    });
  }
  planSpirographRecording(scene:SceneDocument,startFrame:number,fps:number):Promise<SpirographRecordingPlan>{
    this.ensure();const id=++this.counter;
    return new Promise((resolve,reject)=>{
      this.pending.set(id,{operation:'spirograph-recording-plan',resolve,reject});
      const request:GenerationRequest={operation:'spirograph-recording-plan',sessionId:this.sessionId,id,scene,startFrame,fps};
      try{this.worker!.postMessage(request);}catch(error){this.pending.delete(id);reject(error);}
    });
  }
  planPerlinFreshRecording(scene:SceneDocument,simulationFps:number,encoderFps:number):Promise<PerlinFreshRecordingPlan>{
    this.ensure();const id=++this.counter;
    return new Promise((resolve,reject)=>{
      this.pending.set(id,{operation:'perlin-recording-plan',resolve,reject});
      const request:GenerationRequest={operation:'perlin-recording-plan',sessionId:this.sessionId,id,scene,simulationFps,encoderFps};
      try{this.worker!.postMessage(request);}catch(error){this.pending.delete(id);reject(error);}
    });
  }
  planRootsFreshRecording(scene:SceneDocument,simulationFps:number,encoderFps:number):Promise<RootsFreshRecordingPlan>{
    this.ensure();const id=++this.counter;
    return new Promise((resolve,reject)=>{
      this.pending.set(id,{operation:'roots-recording-plan',resolve,reject});
      const request:GenerationRequest={operation:'roots-recording-plan',sessionId:this.sessionId,id,scene,simulationFps,encoderFps};
      try{this.worker!.postMessage(request);}catch(error){this.pending.delete(id);reject(error);}
    });
  }
  exploreComplex(scene: SceneDocument, options: ComplexExploreOptions, onProgress?: (progress: ComplexExploreProgress) => void): Promise<ComplexExploreResult> {
    this.ensure();
    const id = ++this.counter;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { operation: 'explore-complex', resolve, reject, onProgress });
      const request: GenerationRequest = { operation: 'explore-complex', sessionId: this.sessionId, id, scene, options };
      try { this.worker!.postMessage(request); } catch (error) { this.pending.delete(id); reject(error); }
    });
  }
  cancel() {
    this.completed=undefined;this.currentInputId=0;
    this.worker?.terminate();
    this.worker = null;
    for (const p of this.pending.values())
      p.reject(new DOMException("已取消", "AbortError"));
    this.pending.clear();
  }
  dispose() {
    this.cancel();
  }
}
