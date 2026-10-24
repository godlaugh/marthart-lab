import {validateRootsControls,rootsControlReceiptMatches,type RootsControls,type RootsControlReceipt} from './rootsControl';
import {parseRootsPresentationConfiguration,type RootsPresentationConfiguration} from './rootsPresentationConfig';
import type {GenerateContext,SceneOutput} from '../types';
import type {RootsSceneFrame} from './rootsSceneClock';
import type {RootsConcurrentStream} from './rootsConcurrentStream';
import type {RootsAutoRecordingInputs} from './rootsRecording';
import {validateSourceSceneClockRequest,type SourceSceneClockRequest} from './sourceSceneHostClock';
export interface RootsLiveContext {sessionId:string;clock:SourceSceneClockRequest;maximumWorkers:number;controls?:RootsControls;}
export interface RootsLiveFacts {
 controls?:RootsControlReceipt;presentation?:RootsPresentationConfiguration;
 sessionId:string;paused:boolean;clockSource:'worker-wall-clock'|'injected'|'render-fixed-step';renderKind:'update'|'snapshot';
 sceneTime:number;frame:RootsSceneFrame;stream:RootsConcurrentStream['facts'];
 recording?:{displayFrame:number;simulationFps:number;warmup:boolean;complete:boolean};
 autoRecording:RootsAutoRecordingInputs&{policy:'roots-worker-arrival-v1';complete:boolean};
}
export function validateRootsLiveContext(raw:unknown):RootsLiveContext {
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('复根实时上下文无效');const v=raw as Partial<RootsLiveContext>;
 if(typeof v.sessionId!=='string'||!v.sessionId.trim())throw Error('复根实时会话身份无效');
 if(typeof v.maximumWorkers!=='number'||!Number.isSafeInteger(v.maximumWorkers)||v.maximumWorkers<1)throw Error('复根实时线程预算必须为正整数');
 validateSourceSceneClockRequest(v.clock!);
 return{sessionId:v.sessionId,maximumWorkers:v.maximumWorkers,...(v.controls===undefined?{}:{controls:validateRootsControls(v.controls)}),clock:{paused:v.clock!.paused,...(v.clock!.timestampMs===undefined?{}:{timestampMs:v.clock!.timestampMs})}};
}
export function validRootsLiveOutput(output:SceneOutput,context:GenerateContext,previous?:RootsLiveFacts):boolean {
 try{
  const v=validateRootsLiveContext(context.rootsLive);
  if(output.type!=='raster'||!output.rootsLive||!output.rootsPresentation||!output.roots)return false;
  const f=output.rootsLive;
  if(v.controls){if(!rootsControlReceiptMatches(f.controls,v.controls,previous?.sessionId===v.sessionId?previous.controls:undefined))return false;const p=parseRootsPresentationConfiguration(f.presentation);if(p.mode!==output.rootsPresentation.mode||(['phi','theta','gamma','zoom'] as const).some(k=>!Object.is(p.camera[k],f.frame.camera[k])))return false;}
  else if(f.controls!==undefined)return false;
  return f.recording===undefined&&f.sessionId===v.sessionId&&f.paused===v.clock.paused&&['worker-wall-clock','injected'].includes(f.clockSource)&&['update','snapshot'].includes(f.renderKind)
   &&Number.isFinite(f.sceneTime)&&Number.isSafeInteger(f.frame.frame)&&f.frame.frame>=0&&f.stream.policy==='roots-worker-arrival-v1'&&!f.stream.failed&&!f.stream.disposed
   &&f.stream.pool.consumedSamples===output.roots.attemptedSamples&&f.stream.pending.producedPoints===output.roots.rootPoints
   &&f.frame.sceneTime===f.sceneTime
   &&f.autoRecording.policy==='roots-worker-arrival-v1'&&typeof f.autoRecording.complete==='boolean'
   &&output.rootsPresentation.clockPolicy==='source-live-clock-v1'&&output.rootsPresentation.streamPolicy==='worker-arrival'
   &&output.width===context.width&&output.height===context.height;
 }catch{return false;}
}
