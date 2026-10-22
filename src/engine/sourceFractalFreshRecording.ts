import type {GenerateContext,SceneDocument,SceneOutput} from '../types';
import {generateFractal,prepareFractalRender} from '../scenes/complex';
import {snapshotGenerationInput} from './generationInput';
import {validateRasterRequest} from './rasterDimensions';
import {SourceFractalDisplay,sourceFractalDisplayInput} from './sourceFractalDisplay';
import {SourceFractalPlaybackSession} from './sourceFractalPlayback';
import {SourceFractalSceneRuntime} from './sourceFractalSceneRuntime';
import {bindSourceFractalFrame,prepareSourceFractalScene} from './sourceFractalTimeline';
import {fractalRecordingFrameFacts,SourceFractalRecordingError,validateFractalRecordingFrameInput} from './sourceFractalRecording';

const WORK_LIMIT=2_000_000;
/** Fixed recording is time-addressable local reconstruction, not a retained
 * live host. One numerical instance and one display owner advance together.
 * Skipped displays require state transitions but no pixel buffers: the source
 * clears the whole target on every draw and has no accumulated image history. */
export class SourceFractalFreshRecordingSession {
 private key='';private next=0;private playback?:SourceFractalPlaybackSession;private runtime?:SourceFractalSceneRuntime;
 private display=new SourceFractalDisplay();private author?:SceneDocument;private work=0;private cancelled?:()=>boolean;private busy=false;
 constructor(private readonly render:(scene:SceneDocument,context:GenerateContext,prepared?:ReturnType<typeof prepareFractalRender>)=>SceneOutput=generateFractal){}
 reset():void {if(this.busy)throw new SourceFractalRecordingError('state','分形录制重建期间不能重置');this.clear();}
 private clear():void {this.key='';this.next=0;this.playback=undefined;this.runtime=undefined;this.author=undefined;this.display=new SourceFractalDisplay();}
 private check():void {if(this.cancelled?.())throw new SourceFractalRecordingError('cancelled','分形录制显示重建已取消');}
 private reserve=(units:number):void=>{
  this.check();if(!Number.isSafeInteger(units)||units<0||units>WORK_LIMIT-this.work)throw new SourceFractalRecordingError('capacity','分形录制显示重建、队列与参数循环超过共享 200 万工作预算');this.work+=units;
 };
 generate(scene:SceneDocument,context:GenerateContext):SceneOutput {
  if(this.busy)throw new SourceFractalRecordingError('state','分形录制显示重建不能重入');
  this.busy=true;this.work=0;this.cancelled=context.isCancelled;
  try{
   this.check();const request=validateFractalRecordingFrameInput(context.fractalRecording);
   if(request.simulationFps!==scene.timeline.fps)throw new SourceFractalRecordingError('input','分形录制模拟帧率与场景不一致');
   if(context.fractalLive!==undefined||context.fractalDisplay!==undefined)throw new SourceFractalRecordingError('input','独立录制不能借用实时分形显示实例');
   validateRasterRequest(context);
   const identity=snapshotGenerationInput(context);delete identity.fractalRecording;
   // Seconds do not select an explicitly requested display ordinal. Every
   // other caller-selected generation input remains part of the identity.
   identity.time=0;
   const author=structuredClone(scene);delete author.evaluatedFractalScene;delete author.evaluatedFractalGradient;
   const key=JSON.stringify({scene:author,context:identity},(_k,v:unknown)=>typeof v==='number'&&Object.is(v,-0)?{negativeZero:true}:v);
   if(!this.playback||this.key!==key||request.displayFrame===0||request.displayFrame<this.next){
    const configuration=prepareSourceFractalScene(author);
    this.clear();this.key=key;this.author=author;
    this.playback=new SourceFractalPlaybackSession({fps:request.simulationFps,reserve:this.reserve,isCancelled:()=>this.cancelled?.()??false,createScene:()=>{this.runtime=new SourceFractalSceneRuntime(configuration,{reserve:this.reserve});return this.runtime.clock;}});
   }
   let output:SceneOutput|undefined;
   while(this.next<=request.displayFrame){
    const ordinal=this.next;this.check();this.playback.evaluateFrame(ordinal);
    const current=structuredClone(this.author!),frame={...this.runtime!.snapshot(),displayFrame:ordinal,simulationFps:request.simulationFps};bindSourceFractalFrame(current,frame);
    // Preparing a source color owns one 1024-entry LUT plus all palette inputs.
    // Account for that work during random-access history reconstruction too.
    this.reserve(1024+(current.fractalSourceColor?.palette.colors.length??0));
    const prepared=prepareFractalRender(current,context);
    const renderRequested=(display?:import('./sourceFractalDisplay').SourceFractalDisplayFacts)=>{
     if(ordinal!==request.displayFrame)return;
     const result=this.render(current,{...context,time:frame.scene.sceneTime,fractalDisplay:display},prepared);
     this.check();if(result.type!=='raster')throw new SourceFractalRecordingError('state','分形录制没有生成像素画面');
     result.fractalRecording=fractalRecordingFrameFacts(frame,request);output=result;
    };
    // Arithmetic-only source documents retain their previous local colors and
    // schedule; only the complete source profile owns native display facts.
    if(prepared.colorPlan)this.display.display(sourceFractalDisplayInput(prepared,current),renderRequested);
    else renderRequested();
    this.next++;
   }
   if(!output)throw new SourceFractalRecordingError('state','分形录制没有生成请求的显示帧');
   return output;
  }catch(error){this.clear();throw error;}
  finally{this.busy=false;this.cancelled=undefined;}
 }
}
