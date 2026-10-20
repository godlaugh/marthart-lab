import {retainsIteratedCompiler} from './iteratedIdentity';
import type {GenerationInput,SceneDocument,SceneOutput} from '../types';
import {usesRootsNativePresentation} from './rootsPresentationAuthoring';
import {rootsPresentationRequestIdentity} from './rootsPresentationRequest';
import type {RootsPausedCaptureResult,RootsPausedCaptureSize} from './generationProtocol';
import {RootsPausedCaptureError} from './generationProtocol';
import {usesSourceBouncing} from './sourceBouncingDocument';
import {usesSourcePerlin} from './sourcePerlinIdentity';
type Context=GenerationInput;
interface GeneratorPort {
  generate(scene:SceneDocument,context:Context,onProgress?:(output:SceneOutput)=>void):Promise<SceneOutput>;
  cancel():void;
  dispose():void;
  captureRootsPaused?(output:SceneOutput,size:RootsPausedCaptureSize,scale?:1|3|5):Promise<RootsPausedCaptureResult>;
}
interface Request {scene:SceneDocument;context:Context;}
/** Coalesce time changes while retaining the latest requested frame. Domain
 * native Roots and continuous Map/Symmetry edits retain their renderer instance; an
 * explicit cancel or a different document creates a new instance. */
export class GenerationQueue {
  private latest:Request|null=null;
  private running:Request|null=null;
  private timer:ReturnType<typeof setTimeout>|undefined;
  private disposed=false;
  private captureOwner?:object;
  constructor(private readonly generator:GeneratorPort,private readonly callbacks:{output:(output:SceneOutput,time:number,source:SceneDocument)=>void;error:(error:Error)=>void;busy:(value:boolean)=>void}){}
  request(scene:SceneDocument,context:Context,delayMs=0){
    if(this.disposed)return;
    const previous=this.latest?.scene,sceneChanged=previous!==scene;
    const sameIterated=!!previous&&previous.id===scene.id&&previous.kind===scene.kind&&retainsIteratedCompiler(previous)&&retainsIteratedCompiler(scene);
    const sameDomain=previous?.kind==='domain'&&scene.kind==='domain'&&previous.id===scene.id;
    const sameSourceBouncing=!!previous&&usesSourceBouncing(previous)&&usesSourceBouncing(scene)&&previous.id===scene.id;
    const sameSourcePerlin=!!previous&&usesSourcePerlin(previous)&&usesSourcePerlin(scene)&&previous.id===scene.id;
    const native=usesRootsNativePresentation(scene),nativeIdentity=native?rootsPresentationRequestIdentity(scene,context.rootsSessionId):undefined;
    const previousNative=!!previous&&usesRootsNativePresentation(previous);
    const sameNativeRoots=previousNative&&native&&rootsPresentationRequestIdentity(previous!,this.latest?.context.rootsSessionId)===nativeIdentity;
    const nativeIdentityChanged=previousNative&&native&&!sameNativeRoots;
    this.latest={scene,context:{...context,...(context.sourceBouncingView!==undefined?{sourceBouncingView:{...context.sourceBouncingView}}:{}),...(context.sourceBouncingFrame?{sourceBouncingFrame:{...context.sourceBouncingFrame}}:{}),...(context.sourcePerlinViewport?{sourcePerlinViewport:{...context.sourcePerlinViewport}}:{}),...(context.sourceViewport?{sourceViewport:{...context.sourceViewport}}:{}),...(context.rootsViewport?{rootsViewport:{...context.rootsViewport}}:{}),...(context.fractalViewport!==undefined?{fractalViewport:context.fractalViewport&&typeof context.fractalViewport==='object'&&!Array.isArray(context.fractalViewport)?{...context.fractalViewport}:context.fractalViewport}:{})}};
    if((sceneChanged&&!sameDomain&&!sameNativeRoots&&!sameSourceBouncing&&!sameSourcePerlin&&!sameIterated)||nativeIdentityChanged){this.running=null;this.generator.cancel();clearTimeout(this.timer);this.timer=undefined;}
    this.callbacks.busy(true);
    if(this.running||this.captureOwner||this.timer!==undefined)return;
    if(delayMs>0)this.timer=setTimeout(()=>{this.timer=undefined;this.start();},delayMs);
    else this.start();
  }
  private start(){
    if(this.disposed||this.running||this.captureOwner||!this.latest)return;
    const request=this.latest;this.running=request;
    const current=()=>!this.disposed&&this.running===request;
    // Source Bouncing can change only its runtime view while scene/time stay
    // identical. Retain its GPU work, but publish only the latest request.
    const publishable=()=>current()&&this.latest?.scene===request.scene&&(!usesSourceBouncing(request.scene)||this.latest===request);
    const publish=(output:SceneOutput,time=request.context.time)=>{if(publishable())this.callbacks.output(output,time,request.scene);};
    void this.generator.generate(request.scene,request.context,output=>publish(output,output.temporal?.time??request.context.time)).then(output=>publish(output)).catch((error:Error)=>{
      if(publishable()&&error.name!=='AbortError')this.callbacks.error(error);
    }).finally(()=>{
      if(!current())return;
      this.running=null;
      if(this.latest!==request)this.start();else this.callbacks.busy(false);
    });
  }
  async captureRootsPaused(output:SceneOutput,size:RootsPausedCaptureSize,scale:1|3|5=1):Promise<SceneOutput>{
    const request=this.latest;
    if(this.disposed||this.running||this.captureOwner||this.timer!==undefined||!request||!this.generator.captureRootsPaused)
      throw new Error('请等待当前复根预览完成后再保存暂停画面');
    const ticket={};this.captureOwner=ticket;this.callbacks.busy(true);
    const current=()=>!this.disposed&&this.captureOwner===ticket;
    try{
      const result=await this.generator.captureRootsPaused(output,size,scale);
      if(!current()||this.latest!==request)throw new DOMException('截图期间场景已改变','AbortError');
      // Source capture also redraws the primary destination. Publish that
      // result even if the caller has abandoned its PNG download.
      this.callbacks.output(result.preview,request.context.time,request.scene);
      return result.capture;
    }catch(error){
      if(current()&&this.latest===request&&error instanceof Error&&error.name!=='AbortError'&&!(error instanceof RootsPausedCaptureError&&error.previewRetained))this.callbacks.error(error);
      throw error;
    }finally{
      if(current()){
        this.captureOwner=undefined;
        if(this.latest!==request)this.start();else this.callbacks.busy(false);
      }
    }
  }
  /** Stop pending and active work without disposing the reusable scheduler.
   * Invalidate request ownership before cancellation rejects its promise. */
  cancel(){
    if(this.disposed)return;
    clearTimeout(this.timer);this.timer=undefined;this.latest=null;this.running=null;this.captureOwner=undefined;
    this.generator.cancel();this.callbacks.busy(false);
  }
  dispose(){this.disposed=true;clearTimeout(this.timer);this.timer=undefined;this.latest=null;this.running=null;this.captureOwner=undefined;this.generator.dispose();}
}
