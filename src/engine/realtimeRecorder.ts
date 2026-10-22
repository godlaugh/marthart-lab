import type {FormulaPresentation} from '../types';
import {formulaPresentation,formulaPlacement} from './formulas';
import type {PresentedFrame} from './presentedFrame';
import {recordingDurationError} from './recordingContract';
export interface RecordingFrame extends PresentedFrame {canvas:HTMLCanvasElement;}
export interface RecordingResult {blob:Blob;extension:string;duration:number;frames:number;frameVersions:number;sceneStart:number;sceneEnd:number;width:number;height:number;}
/** A recording owns one composition canvas, one stream and its encoded chunks. */
export class RealtimeRecorder {
  private recorder:MediaRecorder|null=null;
  private stream:MediaStream|null=null;
  private animation=0;
  private timer:ReturnType<typeof setTimeout>|undefined;
  private cancelled=false;
  private stopping=false;
  private encoded:Blob[]=[];
  private bytes=0;
  private frames=0;
  private images=new Map<string,{image:HTMLImageElement;width:number;height:number}>();
  private finish:((value:RecordingResult)=>void)|null=null;
  private reject:((error:Error)=>void)|null=null;
  private started=0;
  private stoppedAt:number|undefined;
  private stopPlayback:(()=>void)|undefined;
  private failure:Error|null=null;
  private used=false;
  static supported(){return typeof MediaRecorder!=='undefined'&&typeof HTMLCanvasElement.prototype.captureStream==='function';}
  async record(getFrame:(initial?:boolean)=>RecordingFrame|null,fps:number,maxDuration:number,onProgress:(seconds:number,frames:number,frameVersions:number)=>void,onStarted?:(frame:RecordingFrame,startedAt:number)=>void,onStopped?:()=>void):Promise<RecordingResult>{
    if(!RealtimeRecorder.supported())throw new Error('此浏览器不支持实时录制，请使用逐帧导出。');
    if(this.used||this.stopping)throw new Error('录制会话已使用');this.used=true;
    if(!Number.isInteger(fps)||fps<1||fps>120)throw new Error('录制帧率或时长无效');
    const durationError=recordingDurationError(maxDuration);if(durationError)throw new Error(durationError);
    const available=getFrame(true);if(!available)throw new Error('画布尚未生成，请稍后再试');
    const initial={...available};
    let lastRevision=initial.revision,frameVersions=1,sceneEnd=initial.sceneTime;
    const canvas=document.createElement('canvas');canvas.width=initial.canvas.width;canvas.height=initial.canvas.height;
    if(!canvas.width||!canvas.height||canvas.width*canvas.height>7680*4320)throw new Error('当前画布尺寸超出录制范围');
    const context=canvas.getContext('2d');if(!context)throw new Error('无法创建录制画布');
    const mime=['video/mp4','video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'].find(type=>MediaRecorder.isTypeSupported(type));
    if(!mime)throw new Error('浏览器没有可用的录制编码器');
    // captureStream emits an initial frame even at rate zero. Complete its
    // formula layer before creating the stream, so that frame is not partial.
    try{context.drawImage(initial.canvas,0,0,canvas.width,canvas.height);await this.formulas(context,initial,canvas.width,canvas.height);if(this.stopping)throw new DOMException('录制已取消','AbortError');if(getFrame()?.source!==initial.source)throw new Error('录制期间场景已更改，请重新开始录制。');}catch(error){this.cleanup();throw error;}
    const stream=canvas.captureStream(0);this.stream=stream;
    const track=stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
    if(typeof track?.requestFrame!=='function'){this.cleanup();throw new Error('此浏览器不支持逐帧提交画布，请使用逐帧导出。');}
    let recorder:MediaRecorder;
    try{recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:Math.min(40_000_000,Math.max(2_000_000,canvas.width*canvas.height*fps*.12))});}catch(error){this.cleanup();throw error;}
    this.recorder=recorder;
    this.stopPlayback=onStopped;
    return new Promise((resolve,reject)=>{
      this.finish=resolve;this.reject=reject;
      recorder.ondataavailable=event=>{if(this.cancelled||this.failure)return;if(event.data.size){this.bytes+=event.data.size;if(this.bytes>512*1024*1024){this.failure=new Error('实时录制超过 512 MiB 内存上限，请缩短时长或使用逐帧导出。');this.encoded=[];this.stop();return;}this.encoded.push(event.data);}};
      recorder.onerror=()=>{this.failure=new Error('浏览器视频编码失败');this.stop();};
      recorder.onstop=()=>{
        this.endPlayback();
        const duration=Math.max(0,(this.stoppedAt!-this.started)/1000),blob=new Blob(this.encoded,{type:recorder.mimeType}),result={blob,extension:recorder.mimeType.includes('mp4')?'mp4':'webm',duration,frames:this.frames,frameVersions,sceneStart:initial.sceneTime,sceneEnd,width:canvas.width,height:canvas.height};
        const fail=this.failure??(this.cancelled?new DOMException('录制已取消','AbortError'):this.frames===0?new Error('录制尚未提交完整帧，请增加录制时长或降低计算负载。'):blob.size===0?new Error('录制没有生成视频帧'):null);
        const finish=this.finish,reject=this.reject;this.cleanup();if(fail)reject?.(fail);else finish?.(result);
      };
      this.started=performance.now();let nextFrame=this.started;
      const tick=async(now:number)=>{
        if(this.stopping)return;
        if(now>=nextFrame){
          nextFrame=this.started+(Math.floor((now-this.started)*fps/1000)+1)*1000/fps;
          try{
            const available=getFrame();if(!available)throw new Error('录制期间画布不可用');
            const frame={...available};
            if(frame.source!==initial.source)throw new Error('录制期间场景已更改，请重新开始录制。');
            context.clearRect(0,0,canvas.width,canvas.height);context.drawImage(frame.canvas,0,0,canvas.width,canvas.height);
            await this.formulas(context,frame,canvas.width,canvas.height);
            if(this.stopping)return;
            track.requestFrame();this.frames++;if(frame.revision!==lastRevision){frameVersions++;lastRevision=frame.revision;}sceneEnd=frame.sceneTime;onProgress((performance.now()-this.started)/1000,this.frames,frameVersions);
          }catch(error){this.failure=error instanceof Error?error:new Error(String(error));this.stop();return;}
        }
        this.animation=requestAnimationFrame(tick);
      };
      try{recorder.start(1000);onStarted?.(initial,this.started);this.timer=setTimeout(()=>this.stop(),maxDuration*1000);this.animation=requestAnimationFrame(tick);}catch(error){this.cleanup();reject(error);}
    });
  }
  private async formulas(context:CanvasRenderingContext2D,frame:PresentedFrame,width:number,height:number){
    const presentation:FormulaPresentation=frame.formulaPresentation??formulaPresentation(frame.scene),labels=presentation.labels;if(!labels.length){this.images.clear();return;}
    const {renderFormulaSvg}=await import('./formulaSvg');
    const retained=new Map<string,{image:HTMLImageElement;width:number;height:number}>();let pixels=0;
    for(const label of labels){
      if(this.stopping)return;
      const key=JSON.stringify([label.latex,label.color]);let rendered=this.images.get(key);
      if(!rendered){
        const svg=renderFormulaSvg(label.latex,label.color);pixels+=Math.ceil(svg.width)*Math.ceil(svg.height);if(pixels>16_000_000)throw new Error('公式图像超出实时录制缓存预算');
        const url=URL.createObjectURL(new Blob([svg.source],{type:'image/svg+xml'})),image=new Image();
        try{image.src=url;await image.decode();rendered={image,width:svg.width,height:svg.height};}finally{URL.revokeObjectURL(url);}
      }else{pixels+=Math.ceil(rendered.width)*Math.ceil(rendered.height);if(pixels>16_000_000)throw new Error('公式图像超出实时录制缓存预算');}
      retained.set(key,rendered);const p=formulaPlacement(presentation,label,width,height,rendered);context.drawImage(rendered.image,p.x,p.y,rendered.width*p.scale,rendered.height*p.scale);
    }
    if(!this.stopping)this.images=retained;
  }
  stop(){
    if(this.stopping)return;this.stopping=true;this.endPlayback();cancelAnimationFrame(this.animation);clearTimeout(this.timer);
    try{if(this.recorder?.state!=='inactive')this.recorder?.stop();}
    catch(error){const reject=this.reject;this.cleanup();reject?.(error instanceof Error?error:new Error(String(error)));}
  }
  cancel(){this.cancelled=true;this.stop();}
  private endPlayback(){if(this.stoppedAt===undefined)this.stoppedAt=performance.now();const callback=this.stopPlayback;this.stopPlayback=undefined;try{callback?.();}catch(error){this.failure=error instanceof Error?error:new Error(String(error));}}
  private cleanup(){if(this.stopPlayback)this.endPlayback();cancelAnimationFrame(this.animation);clearTimeout(this.timer);this.stream?.getTracks().forEach(track=>track.stop());this.stream=null;this.images.clear();this.encoded=[];if(this.recorder){this.recorder.onstop=null;this.recorder.ondataavailable=null;this.recorder.onerror=null;}this.recorder=null;this.finish=null;this.reject=null;}
}
