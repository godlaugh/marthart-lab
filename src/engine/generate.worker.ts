import { definition } from "../scenes";
import { generateScene, TemporalGenerationSession } from './temporal';
import { searchStableAttractor } from './stableSearch';
import { exploreComplex } from './complexExplore';
import type { GenerationRequest, GenerationPayload } from './generationProtocol';
import {outputBuffers} from './outputBuffers';
import {planRootsFreshRecording} from './rootsRecording';
import type {GenerationInput,SceneDocument} from '../types';
import {enhanceRootsPausedImage,rootsPausedImageBytes} from './rootsPausedImage';
import {prepareRootsPausedUpscale,upscaleRootsPausedImage} from './rootsPausedUpscale';
import {validateRasterRequest} from './rasterDimensions';
const temporalSession = new TemporalGenerationSession();
let owner: number | undefined;
let completed:{id:number;scene:SceneDocument;context:GenerationInput}|undefined;
self.onmessage = (
  event: MessageEvent<GenerationRequest>,
) => {
  const { id, operation, sessionId } = event.data;
  if (owner !== sessionId) { temporalSession.reset(); owner = sessionId; completed=undefined; }
  const send = (payload: GenerationPayload, transfer: Transferable[] = []) => self.postMessage({ ...payload, sessionId }, { transfer });
  const start = performance.now();
  let captureSource:typeof completed;
  let captureRendered=false;
  try {
    if(event.data.operation==='roots-paused-capture'){
      const source=captureSource=completed;
      if(!source||source.id!==event.data.sourceId)throw new Error('暂停截图对应的预览已过期');
      const {width,height}=event.data.size;
      const scale=event.data.scale;
      if(scale!==1&&scale!==3&&scale!==5)throw new Error('暂停 PNG 放大倍率须为 1、3 或 5');
      const upscale=scale===1?undefined:prepareRootsPausedUpscale(width,height,scale);
      if(upscale)validateRasterRequest({time:0,quality:'export',width:upscale.width,height:upscale.height});
      const additionalBytes=rootsPausedImageBytes(width,height)-width*height*4+(upscale?upscale.peakBytes-upscale.inputBytes:0);
      // Use the worker's retained document and context. The capture request
      // carries no redundant scene bytes that could replace this instance.
      completed=undefined;
      const result=temporalSession.rootsNative.capturePaused(source.scene,{...source.context,quality:'export',width,height,rootsViewport:{logicalWidth:width,logicalHeight:height,referenceLogicalHeight:source.context.rootsViewport?.referenceLogicalHeight??source.context.height,target:'offscreen'}},{additionalBytes});
      captureRendered=true;
      if(result.capture.type!=='raster'||result.preview.type!=='raster')throw new Error('复根暂停截图没有生成图像');
      const enhanced=enhanceRootsPausedImage(result.capture.pixels,width,height);
      result.capture.pixels=scale===1?enhanced:upscaleRootsPausedImage(enhanced,width,height,scale);
      result.capture.width=upscale?.width??width;result.capture.height=upscale?.height??height;
      result.capture.rootsPausedImage={enhancement:'mathart-1.7.8-scale1',baseSize:[width,height],scale,resampling:upscale?'openjdk21-software-bicubic':'none',originalRuntimeCompared:false};
      completed={...source,id};
      send({operation:'roots-paused-capture',id,result:{capture:result.capture,preview:result.preview}},[...new Set([...outputBuffers(result.capture),...outputBuffers(result.preview)])]);
      return;
    }
    const {scene}=event.data;
    if(event.data.operation==='roots-recording-plan'){
      const result=planRootsFreshRecording(scene,{simulationFps:event.data.simulationFps,encoderFps:event.data.encoderFps});
      send({operation:'roots-recording-plan',id,result});return;
    }
    if(event.data.operation==='spirograph-recording-plan'){
      const result=temporalSession.spirograph.recordingPlan(scene,event.data.startFrame,event.data.fps);
      send({operation:'spirograph-recording-plan',id,result});return;
    }
    if (event.data.operation === 'explore-complex') {
      const result = exploreComplex(scene, event.data.options, {
        onProgress: progress => send({ operation: 'explore-complex', id, progress }),
      });
      send({ operation: 'explore-complex', id, result });
      return;
    }
    if (event.data.operation === 'search-stable') {
      const result = searchStableAttractor(scene, event.data.options, {
        onProgress: progress => send({ operation: 'search-stable', id, progress }),
      });
      send({ operation: 'search-stable', id, result });
      return;
    }
    const { context } = event.data;
    completed=undefined;
    const output = generateScene(scene, { ...context, onStatus: event.data.wantsStatus ? status => send({operation:'generate-status',id,status}) : undefined, onProgress: output => {
      output.dimension ??= definition(scene.kind).dimension;
      send({ operation: 'generate-progress', id, output }, outputBuffers(output));
    } }, temporalSession);
    output.dimension ??= definition(scene.kind).dimension;
    output.stats.elapsedMs = performance.now() - start;
    completed={id,scene,context};
    send({ operation: 'generate', id, output }, outputBuffers(output));
  } catch (error) {
    const message=error instanceof Error?error.message:String(error);
    if(operation==='roots-paused-capture'){
      // Check the session owner, not an error category: a late capacity or
      // readback failure may already have changed/retired shared density ink.
      const retained=!captureRendered&&!!captureSource&&temporalSession.rootsNative.matchesCompletedPrimary(captureSource.scene,captureSource.context);
      completed=retained?captureSource:undefined;
      send({id,operation,error:message,...(retained?{retainedSourceId:captureSource!.id}:{})});
    }else send({id,operation,error:message});
  }
};
