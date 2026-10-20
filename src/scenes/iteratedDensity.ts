import {SourceSamilaSamplingSession,usesSourceSamilaSampling,validateSourceSamilaSampling,prepareSourceSamilaSamplingBatch,sourceSamilaSample,type SourceSamilaSamplingFacts} from '../engine/sourceSamilaSampling';
import {SOURCE_SAMILA_PRESENTATION_MODEL,usesSourceSamilaPresentation,sourceSamilaDisplayTransform,validateSourceSamilaPresentation} from '../engine/sourceSamilaPresentation';
import {usesSourceSamilaSplat,prepareSourceSamilaSplat,sourceSamilaFloat,sourceSamilaUsesPaletteLut,validateSourceSamilaSplat,sourceSamilaFallbackColor,sourceSamilaDecay,sourceSamilaPointDiameter,sourceSamilaSplatMass,sourceSamilaPaletteLut,sourceSamilaPaletteCoordinate,sampleSourceSamilaPalette,type SourceSamilaSplatFacts} from '../engine/sourceSamilaSplat';
import {usesSourceSamilaTimeline,sourceSamilaFrame} from '../engine/sourceSamilaReplay';
import {usesSourceSamilaMath,resolveSourceSamilaSelection,prepareSourceSamilaRange,sourceSamilaMapProject,type SourceSamilaMathModel} from '../engine/sourceSamilaMath';
import {prepareSourceSamilaExpressions,type PreparedSourceSamilaExpressions} from '../engine/sourceSamilaExpression';
import {usesSamilaSourceProjection,prepareSamilaNdcProjection,samilaNdcParticleTransform,samilaNdcPosition,samilaNdcSamplingRotation,samilaNdcDensityViewport,SAMILA_SOURCE_DORMANT_CONTROLS,type SamilaNdcProjection} from '../engine/samilaProjection';
import {CAPTURED_DENSITY_CAMERA_MODEL,usesCapturedDensityCamera} from '../engine/sourceCameraMode';
import {ordinarySourceCameraFrame,prepareOrdinarySourceFrame} from '../engine/ordinarySourceCamera';
import {prepareCapturedDensityCamera,prepareCapturedDensityView,projectCapturedDensityPoint,type CapturedDensityAnchor,type PreparedDensityCameraFrame} from '../engine/sourceDensityCamera';
import {GenerationCleanupState} from '../engine/generationCleanup';
import {inputScene,identity,retainsIteratedCompiler} from '../engine/iteratedIdentity';
import {applySamilaViewport,samilaViewportTransform,type PreparedSamilaViewport} from '../engine/samilaViewport';
import {samilaCameraEnabled,samilaCameraFrame,prepareSamilaView,parseSamilaCamera,samilaSamplingRotation} from '../engine/samilaCamera';
import {mapDimension} from '../engine/mapDimension';
import {hasSymmetryCustom,readSymmetryCustomSource,prepareSymmetryCustomSource,bindSymmetryCustomParameters,symmetryCustomCompileDegree,symmetryCustomParameterNameError,type PreparedSymmetryCustomSource} from '../engine/symmetryCustom';
import type {ControlSpec,DensityBounds,DensityProjection,GenerateContext,SceneDocument,SceneKind,SceneOutput,Settings,Palette,SamilaViewportTransform} from '../types';
import {compileReal,finite,numberSetting,existingParameterNameError,type RealEvaluator} from '../engine/expression';
import {paletteColor,validatePalette} from '../engine/palette';
import {parseDensityViewport,prepareDensityTone,toneDensityRgbaPrepared,type DensityToneJob} from '../engine/density';
import {normalizedDensityControls,deriveDensityNormalization,NORMALIZED_DENSITY_NOTICE} from '../engine/densityNormalization';
import {samilaToneControls,deriveSamilaNormalization,type SamilaToneFacts} from '../engine/samilaTone';
import {rasterDimensions,exactRasterDimensions} from '../engine/rasterDimensions';
import {compileMapIterator,symmetryStep,validateSymmetryParameters,builtInIterationResult,type IteratedStep,type Point3,type SymmetryParameters} from './iterated';
import {SYMMETRY_DEFAULT_PARAMETERS,SYMMETRY_DEFAULT_SETTINGS} from './symmetryParameters';
import {compileSamilaMapping,projectSamila,resolveSamilaSelection} from './samila';
import {parseParticleTransform,type ParticleTransform} from './particleTransform';
import {createNoise} from './noise';
import {IteratedDensityGpu,iteratedGpuBytes} from '../engine/iteratedDensityGpu';
import {uniform,initialPoint} from '../engine/iteratedSeed';
import {samilaHistoryModel,prepareSamilaHistoryFrame,copySamilaHistory,type SamilaHistoryModel,type SamilaHistoryFrame,type SamilaHistoryState} from '../engine/samilaHistory';
export {iteratedUniform,iteratedInitialChunk} from '../engine/iteratedSeed';

export type IteratedKind='map'|'symmetry'|'samila';
const MAX_BATCH=8_000_000,MAX_LIVE_BYTES=768*1024*1024,MAX_REQUEST_STEPS=2_000_000_000,MAX_PIXEL_TESTS=2_000_000_000;
const AXES:Record<DensityProjection,[number,number]>={xy:[0,1],xz:[0,2],yz:[1,2]};
const clamp=(v:number)=>Math.max(0,Math.min(1,v));
const int=(s:Settings,k:string,d:number,min:number,max:number)=>{const v=numberSetting(s,k,d,min,max);if(!Number.isInteger(v))throw new Error(`${k} 必须为整数`);return v;};
const option=(s:Settings,k:string,d:string,values:readonly string[])=>{const v=String(s[k]??d);if(!values.includes(v))throw new Error(`${k} 不支持 ${v}`);return v;};
const bool=(s:Settings,k:string,d:boolean)=>{const v=s[k]??d;if(typeof v!=='boolean')throw new Error(`${k} 必须为布尔值`);return v;};
const cancelled=(c:GenerateContext)=>{if(c.isCancelled?.())throw new DOMException('持续密度已取消','AbortError');};

export function normalizeStepMetric(metric:number,min:number,max:number,mode:'clamp'|'robust'):number {
 if(![metric,min,max].every(Number.isFinite)||min<0||max-min<.001||!['clamp','robust'].includes(mode))throw new Error('步长度量必须有限，且上限至少大于下限 0.001');
 return metricValue(metric,min,max,mode);
}
function metricValue(metric:number,min:number,max:number,mode:'clamp'|'robust'):number {const delta=Math.max(0,metric-min),range=max-min;return mode==='robust'?(delta===0?0:1/(1+range/delta)):Math.min(1,delta/range);
}
export interface IteratedConfig {sourcePaletteLut?:boolean;sampleSeed?:number;samilaHistoryModel?:SamilaHistoryModel;count:number;fps:number;startTime:number;seed:number;burn:number;iterations:number;dimension:2|3;escape:number;bounds:[number,number][];decay:number;alpha:number;record:boolean;pointSize:number;metricMin:number;metricMax:number;metricMode:'clamp'|'robust';color:string;colorSpeed:number;colorPhase:number;}
function config(scene:SceneDocument):IteratedConfig {
 const s=scene.settings,kind=scene.kind,sourceSplat=usesSourceSamilaSplat(scene),dimension=kind==='map'?mapDimension(s):2,range=numberSetting(s,'initialRange',.1,0,100),initial=option(s,'initialMode',kind==='symmetry'?'box':'range',['range','box']);
 const bounds:[number,number][]=['X','Y','Z'].map((axis):[number,number]=>initial==='range'?[-range,range]:[numberSetting(s,'initial'+axis+'Min',kind==='symmetry'?.001:-1,-1e6,1e6),numberSetting(s,'initial'+axis+'Max',kind==='symmetry'?.002:1,-1e6,1e6)]);
 for(const [lo,hi]of bounds)if(hi<lo)throw new Error('初始盒上限必须不小于下限');
 const fps=usesSourceSamilaTimeline(scene)?numberSetting({fps:scene.timeline.fps},'fps',60,1,120):int(s,'iteratedFps',60,1,120),metricMin=numberSetting(s,'stepMetricMin',0,0,1e12),metricMax=numberSetting(s,'stepMetricMax',2,.001,1e12),metricMode=option(s,'stepMetricNormalize','clamp',['clamp','robust']) as 'clamp'|'robust';normalizeStepMetric(0,metricMin,metricMax,metricMode);
 let decay=sourceSplat?sourceSamilaDecay(s):numberSetting(s,'accumulationDecay',1,0,1);if(!sourceSplat&&kind==='samila'&&bool(s,'showTrails',true))decay*=Math.pow(.01,1/(fps*numberSetting(s,'trailLifetime',4,.001,3600)));
 return{...(sourceSplat?{sourcePaletteLut:sourceSamilaUsesPaletteLut(s,scene.palette)}:{}),...(kind==='samila'?{samilaHistoryModel:samilaHistoryModel(s)}:{}),count:int(s,'batchSize',4096,1,MAX_BATCH),fps,startTime:numberSetting(s,'iteratedStartTime',0,0,86400),seed:usesSourceSamilaSampling(scene)?0:int(s,'seed',1,0,0xffffffff),burn:kind==='samila'?0:int(s,'burnIn',kind==='map'?100:200,0,100000),iterations:kind==='samila'?1:int(s,'iterationsPerFrame',1,1,16),dimension,escape:numberSetting(s,'escapeRadius',kind==='symmetry'?10:100,.001,1e12),bounds,decay,alpha:sourceSplat?sourceSamilaFloat(s,'alpha',.1):kind==='samila'?numberSetting(s,'alpha',.1,0,1):1,record:usesSourceSamilaSampling(scene)?true:bool(s,'recordTrails',true),pointSize:sourceSplat?1:numberSetting(s,'pointSize',1,.1,32),metricMin,metricMax,metricMode,color:sourceSplat?'noise':option(s,'iteratedColor',kind==='samila'?'noise':'step',['step','noise','index','radius','angle','height']),colorSpeed:sourceSplat?0:numberSetting(s,'colorSpeed',.22,.001,100),colorPhase:sourceSplat?sourceSamilaFloat(s,'colorPhase',180):numberSetting(s,'colorPhase',0,-1e9,1e9)};
}
export type IteratedField =
 | {kind:'map';equations:{x:string;y:string;z?:string};parameters:Record<string,number>;dimension:2|3;time:number}
 | {kind:'symmetry';parameters:SymmetryParameters;time:number}
 | {kind:'symmetry-custom';plan:PreparedSymmetryCustomSource;uniforms:Readonly<Record<string,number>>;parameters:Readonly<Record<string,number>>;time:number}
 | {kind:'samila';mathModel?:SourceSamilaMathModel;equations:{f1:string;f2:string};parameters:Record<string,number>;mapping:string;projection:string;lo:number;hi:number;rotation:number;time:number};
export interface IteratedFrameJob {samilaSampling?:SourceSamilaSamplingFacts;samilaSplat?:SourceSamilaSplatFacts;samilaProjection?:SamilaNdcProjection;sourceCamera?:PreparedDensityCameraFrame;history?:SamilaHistoryFrame;kind:IteratedKind;frame:number;time:number;config:IteratedConfig;field:IteratedField;transform:ParticleTransform;palette:Palette;fieldKey:string;structuralKey:string;}
function parseField(scene:SceneDocument,cfg:IteratedConfig,time:number,authored:SceneDocument):IteratedField {
 const p={...scene.parameters};for(const [key,v]of Object.entries(p))finite(v,`参数 ${key}`);
 if(scene.kind==='symmetry'){
  // A template switch retains authored custom uniforms. Their names obey the
  // document's structural rule, not MathJS reserved symbols; the fixed formula
  // below only consumes its named coefficients and ignores retained extras.
  for(const key of Object.keys(p)){const error=symmetryCustomParameterNameError(key);if(error)throw new Error(error);}
  const raw=readSymmetryCustomSource(scene.equations.glsl);
  if(raw!==undefined){
   // The native text substitutions are authored configuration, while named
   // scalar uniforms are this frame's runtime parameter values. GLSL names do
   // not inherit the real-expression coordinate/function reserved-name rules.
   const plan=prepareSymmetryCustomSource(raw,symmetryCustomCompileDegree(authored));
   return{kind:'symmetry-custom',plan,uniforms:bindSymmetryCustomParameters(plan,p),parameters:p,time};
  }
 }
 if(scene.kind!=='symmetry'&&!usesSourceSamilaMath(scene))for(const key of Object.keys(p)){const error=existingParameterNameError(key,scene.kind);if(error)throw new Error(error);}
 if(scene.kind==='map')return{kind:'map',equations:{x:scene.equations.x??'sin(a*y)+c*cos(a*x)',y:scene.equations.y??'sin(b*x)+d*cos(b*y)',z:scene.equations.z},parameters:p,dimension:cfg.dimension,time};
 if(scene.kind==='symmetry'){const s=scene.settings,defaults=SYMMETRY_DEFAULT_PARAMETERS,q=validateSymmetryParameters({lambda:p.lambda??defaults.lambda,alpha:p.alpha??defaults.alpha,beta:p.beta??defaults.beta,gamma:p.gamma??defaults.gamma,omega:p.omega??defaults.omega,n:int(s,'degree',SYMMETRY_DEFAULT_SETTINGS.degree,2,50),template:option(s,'template',SYMMETRY_DEFAULT_SETTINGS.template,['standard','modified']) as 'standard'|'modified',delta:p.delta??defaults.delta,deltaPower:int(s,'deltaPower',SYMMETRY_DEFAULT_SETTINGS.deltaPower,1,6)});return{kind:'symmetry',parameters:q,time};}
 const s=scene.settings,sourceMath=usesSourceSamilaMath(scene),range=sourceMath?prepareSourceSamilaRange(numberSetting(s,'start',-Math.PI),numberSetting(s,'stop',Math.PI),usesSourceSamilaSampling(scene)?'source-pcg':'legacy-finite-span'):{lo:numberSetting(s,'start',-Math.PI,-1000,1000),hi:numberSetting(s,'stop',Math.PI,-1000,1000)}, {lo,hi}=range;if(!sourceMath&&hi<=lo)throw new Error('Samila 采样上限必须大于下限');
 const selection=sourceMath?resolveSourceSamilaSelection(String(s.mapping??'f2_f1'),String(s.projection??'cartesian')):resolveSamilaSelection(String(s.mapping??'f1_f2'),String(s.projection??'polar'),cfg.seed),rotation=(usesSamilaSourceProjection(scene)?numberSetting(s,'rotation',0):numberSetting(s,'rotation',0,-10000,10000))+time*numberSetting(s,'rotationSpeed',0,-100,100);
 if(sourceMath&&(typeof scene.equations.f1!=='string'||typeof scene.equations.f2!=='string'))throw Error('源 Samila 数学需要显式 f1/f2 公式');
 return{kind:'samila',...(sourceMath?{mathModel:'mathart-1.7.8' as const}:{}),equations:{f1:scene.equations.f1??'sin(a*x*y)+cos(b*x^2)',f2:scene.equations.f2??'cos(c*x+y)+sin(d*y^4)'},parameters:p,...selection,lo,hi,rotation,time};
}
/** The sole normalized mathematical/render frame consumed by CPU and GPU owners.
 * Raw settings never enter a backend; time sampling and replay decisions belong
 * to IteratedDensitySession, not the GPU adapter. */
export function prepareIteratedFrame(scene:SceneDocument,time:number,frame:number,authored:SceneDocument=scene):IteratedFrameJob {
 if(!['map','symmetry','samila'].includes(scene.kind))throw new Error('持续批次帧类型无效');finite(time,'持续帧时间');if(!Number.isSafeInteger(frame)||frame<0)throw new Error('持续帧索引无效');
 const cfg=config(scene),field=parseField(scene,cfg,time,authored),samilaProjection=prepareSamilaNdcProjection(scene),transform=samilaProjection?samilaNdcParticleTransform(samilaProjection):parseParticleTransform(scene.settings);
 const {time:ignored,...fieldIdentity}=field;
 // Parsed source has several retained representations. Its program identity
 // already owns their derivation; do not serialize all of them into each frame
 // key. Keep every original runtime parameter for accumulation invalidation.
 const mathematicalIdentity=field.kind==='symmetry-custom'?{kind:field.kind,programKey:field.plan.programKey,parameters:field.parameters}:fieldIdentity;
 // In v2 parameters have their own acknowledged-snapshot boundary. Other
 // mathematics still clears history immediately, without six-pass compensation.
 const identity=cfg.samilaHistoryModel==='bounded-v2'?{...mathematicalIdentity,parameters:undefined,...(samilaProjection?{samilaProjection}:{}),...(samilaCameraEnabled(scene)?{transform:[transform.sx,transform.sy,transform.sz,transform.ox,transform.oy,transform.oz,transform.co,transform.si]}:{})}:mathematicalIdentity;
 return{...(samilaProjection?{samilaProjection}:{}),kind:scene.kind as IteratedKind,frame,time,config:cfg,field,transform,palette:validatePalette(scene.palette),fieldKey:JSON.stringify(identity),structuralKey:structure(cfg)};
}
interface Field {step?:(point:Point3)=>IteratedStep;sample?:(index:number,frame:number,sampleOffset?:number)=>Point3;}
interface SamilaPrograms {readonly f1?:RealEvaluator;readonly f2?:RealEvaluator;readonly source?:PreparedSourceSamilaExpressions;readonly key:string;readonly source1:string;readonly source2:string;}
function compileField(job:IteratedFrameJob,programs?:SamilaPrograms):Field {
 const f=job.field,cfg=job.config;
 if(f.kind==='map'){const step=compileMapIterator(f.equations,f.parameters,f.dimension,f.time);return{step:point=>builtInIterationResult(point,step(point),cfg.escape)};}
 if(f.kind==='symmetry')return{step:point=>builtInIterationResult(point,[...symmetryStep(point[0],point[1],f.parameters),0],cfg.escape)};
 if(f.kind==='symmetry-custom')throw new Error('自定义 Symmetry GLSL 仅支持 GPU 持续密度；不能使用 CPU 内建方程替代。');
 if(!programs)throw new Error('Samila CPU 公式尚未编译');
 // Mapping closes over a/b/c/d, and scope/time/rotation belong to this frame.
 // Only the immutable arithmetic evaluators can outlive the frame binding.
 if(f.mathModel){if(!programs.source)throw Error('源 Samila 公式缓存版本不匹配');const bound=programs.source.bind(f.parameters),selection=resolveSourceSamilaSelection(f.mapping,f.projection),input={...selection,parameters:f.parameters},co=Math.cos(f.rotation),si=Math.sin(f.rotation);return{sample:(index,frame,sampleOffset=0)=>{const [x,y]=job.samilaSampling?sourceSamilaSample(job.samilaSampling.frameSeed,index+sampleOffset,f.lo,f.hi):[Math.fround(f.lo+(f.hi-f.lo)*uniform(cfg.sampleSeed??cfg.seed,index,frame,0)),Math.fround(f.lo+(f.hi-f.lo)*uniform(cfg.sampleSeed??cfg.seed,index,frame,1))],[v1,v2]=bound.evaluate(x,y),point=sourceSamilaMapProject(input,x,y,v1,v2);return[Math.fround(point[0]*co-point[1]*si),Math.fround(point[0]*si+point[1]*co),0];}};}
 const mapping=compileSamilaMapping(f.mapping,f.parameters),f1=programs.f1!,f2=programs.f2!,scope={...f.parameters,x:0,y:0,t:f.time,time:f.time},co=Math.cos(f.rotation),si=Math.sin(f.rotation);
 return{sample:(index,frame)=>{scope.x=f.lo+(f.hi-f.lo)*uniform(cfg.sampleSeed??cfg.seed,index,frame,0);scope.y=f.lo+(f.hi-f.lo)*uniform(cfg.sampleSeed??cfg.seed,index,frame,1);const point=projectSamila(...mapping(scope.x,scope.y,f1(scope),f2(scope)),f.projection);return[point[0]*co-point[1]*si,point[0]*si+point[1]*co,0];}};
}

function samilaToneFacts(cfg:IteratedConfig,width:number,height:number,completedPasses:number,splat?:SourceSamilaSplatFacts):SamilaToneFacts {return{kind:'samila',historyModel:'bounded-v2',width,height,completedPasses,baseBatchSize:cfg.count,alpha:cfg.alpha,combinedDecay:cfg.decay,splat:splat?{model:splat.model,nominalRadius:splat.nominalRadius}:{model:'local-feathered-disc-v1',radiusPixels:cfg.pointSize/2}};}
interface State {samilaSampling?:SourceSamilaSamplingFacts;samilaSplat?:SourceSamilaSplatFacts;sourceCameraAnchor?:CapturedDensityAnchor;samilaGeometry?:SamilaViewportTransform;samilaAnchor?:number;completedSamila?:SamilaToneFacts;history?:SamilaHistoryState;lastFramePasses:number;lastFrameSamples:number;frame:number;positions?:Float64Array;metrics?:Float64Array;valid?:Uint8Array;ink:Float64Array;bounds:DensityBounds;fieldKey:string;structuralKey:string;steps:number;invalid:number;deposited:number;accepted:number;clipped:number;sampleInvalid:number;replays:number;clears:number;recordedPasses:number;lastBatchSize:number;}
const stateBytes=(s:State)=>s.ink.byteLength+(s.positions?.byteLength??0)+(s.metrics?.byteLength??0)+(s.valid?.byteLength??0);
const structure=(c:IteratedConfig)=>JSON.stringify([c.count,c.seed,c.dimension,c.burn,c.bounds]);
function clearInk(s:State){s.ink.fill(0);s.accepted=0;s.clipped=0;s.deposited=0;s.sampleInvalid=0;s.recordedPasses=0;s.clears++;}

/** One worker/session owns continuous particles and floating RGB/mass. No output
 * aliases that state. A cancelled or failed operation discards incomplete state. */
export class IteratedDensitySession {
 private readonly sampling:SourceSamilaSamplingSession;private samplingKey='';
 constructor(options:{samilaSeedProvider?:()=>number}={}){this.sampling=new SourceSamilaSamplingSession({nextSeed:options.samilaSeedProvider});}
 private samplingBytes():number{return this.sampling.retainedBytes+this.samplingKey.length*2;}
 private key='';private state?:State;private hits=0;private gpu?:IteratedDensityGpu;private fallback?:{key:string;reason:string};
 private samilaPrograms?:SamilaPrograms;
 private gpuScope?:string;
 private readonly cleanup=new GenerationCleanupState();
 /** Authored edits invalidate orbit/ink, but not a healthy same-document GPU
  * compiler. The next frame carries resetParticles and overwrites seed state,
  * counters and ink before publishing anything. Shader keys own recompilation. */
 private clearReplay(){this.key='';this.state=undefined;this.hits=0;this.fallback=undefined;}
 private resetSimulation(){this.gpu?.dispose();this.gpu=undefined;this.gpuScope=undefined;this.clearReplay();}
 private resetRuntime(failures:readonly unknown[]=[],keepSampling=false){this.cleanup.reset(()=>{this.resetSimulation();this.samilaPrograms=undefined;if(!keepSampling){this.sampling.reset();this.samplingKey='';}},failures);}
 reset(failures:readonly unknown[]=[]){this.resetRuntime(failures);}
 /** Legacy Samila retains unrestricted own-scope symbol lookup and lazy branches.
  * Source Samila owns fixed AST slots, so its cache also includes parameter names
  * and math version. Install only after both source parsers/emitters succeed. */
 private programs(field:Extract<IteratedField,{kind:'samila'}>):SamilaPrograms {
  const equations=field.equations,key=JSON.stringify([field.mathModel,field.mathModel?Object.keys(field.parameters).sort():undefined]),current=this.samilaPrograms;
  if(current?.key===key&&current.source1===equations.f1&&current.source2===equations.f2)return current;
  if(field.mathModel)return this.samilaPrograms={source:prepareSourceSamilaExpressions(equations,Object.keys(field.parameters)),key,source1:equations.f1,source2:equations.f2};
  const f1=compileReal(equations.f1),f2=compileReal(equations.f2);
  return this.samilaPrograms={f1,f2,key,source1:equations.f1,source2:equations.f2};
 }
 diagnostics(){return{samilaSampling:this.sampling.diagnostics(),retainedBytes:this.samplingBytes()+(this.state?.samilaSplat?256*256*4:0)+(this.state?stateBytes(this.state)+this.key.length*2:0)+(this.gpu?.diagnostics().retainedBytes??0),samilaCompiledExpressions:this.samilaPrograms?2:0,gpu:this.gpu?.diagnostics(),backend:this.gpu?'webgl2':'cpu',frame:this.state?.frame??null,cacheHits:this.hits,steps:this.state?.steps??0,deposited:this.state?.deposited??0,recordedPasses:this.state?.recordedPasses??0,lastBatchSize:this.state?.lastBatchSize??null,lastFramePasses:this.state?.lastFramePasses??0,lastFrameSamples:this.state?.lastFrameSamples??0,replays:this.state?.replays??0,clears:this.state?.clears??0,sourceCameraAnchor:this.state?.sourceCameraAnchor?structuredClone(this.state.sourceCameraAnchor):undefined,samilaAnchor:this.state?.samilaAnchor,bounds:this.state?{...this.state.bounds}:undefined};}
 /** Explicit copied raw-ink diagnostic; never a per-frame presentation copy. */
 snapshotInk():Float32Array|Float64Array {if(this.gpu)return this.gpu.readback();const state=this.state;if(!state)return new Float64Array();if(stateBytes(state)+state.ink.byteLength+this.samplingBytes()+(state.samilaSplat?256*256*4:0)>MAX_LIVE_BYTES)throw new Error('持续密度诊断复制超过 768 MiB');return state.ink.slice();}
 generate(baseScene:SceneDocument,c:GenerateContext):SceneOutput {
  this.cleanup.prepare();validateSourceSamilaSampling(baseScene);validateSourceSamilaPresentation(baseScene);validateSourceSamilaSplat(baseScene);const started=performance.now();
  try {
   const runtime=applySamilaViewport(baseScene,c.time);baseScene=runtime.scene;
   const current=runtime.atTime(c.time);
   // Reject invalid presentation input before GPU admission or any orbit work.
   // Actual completed counts and raster dimensions are bound after simulation.
   const baseline=config(runtime.atTime(Number(baseScene.settings.iteratedStartTime??0)));
   const tone=prepareDensityTone(current.palette,current.settings,baseScene.kind==='samila'&&baseline.samilaHistoryModel==='bounded-v2'?samilaToneFacts(baseline,c.width,c.height,0,prepareSourceSamilaSplat(current,{width:c.width,height:c.height,primaryPixelHeight:c.samilaPrimaryPixelHeight,path:'points'})):baseScene.kind==='map'||baseScene.kind==='symmetry'?{kind:baseScene.kind,width:c.width,height:c.height,recordedPasses:0,batchSize:1}:undefined);
   const requested=option(baseScene.settings,'iteratedBackend','auto',['auto','cpu','gpu']),custom=hasSymmetryCustom(baseScene);
   if(custom&&requested==='cpu')throw new Error('自定义 Symmetry GLSL 仅支持 GPU 持续密度；不能使用 CPU 内建方程替代。');
   const wantsGpu=custom||requested==='gpu'||requested==='auto'&&(usesSourceSamilaSplat(baseScene)||Number(baseScene.settings.batchSize??4096)>=50000);
   const attemptKey=identity(inputScene(baseScene),c.width,c.height)+(runtime.key??'')+JSON.stringify([c.sourceViewport,c.samilaPrimaryPixelHeight]),prior=this.fallback?.key===attemptKey?this.fallback:undefined;
   let reason=prior?.reason;
   if(wantsGpu&&!prior){try{return this.run(baseScene,c,'webgl2',current,tone,runtime);}catch(error){this.resetRuntime([error],true);if(error instanceof DOMException&&error.name==='AbortError')throw error;reason=error instanceof Error?error.message:String(error);if(custom)throw new Error(`自定义 Symmetry GLSL 无法在 GPU 上执行；未使用内建方程替代：${reason}`);}}
   const output=this.run(baseScene,c,'cpu',current,tone,runtime);
   if(wantsGpu&&reason){this.fallback={key:attemptKey,reason};output.warnings=[...(output.warnings??[]),`GPU 持续密度不可用，已完整重放 CPU：${reason}`];}
   output.stats.elapsedMs=performance.now()-started;return output;
  }catch(error){this.resetRuntime([error],true);throw error;}
 }
 private run(baseScene:SceneDocument,c:GenerateContext,backend:'cpu'|'webgl2',current:SceneDocument,preparedTone:DensityToneJob,runtime:PreparedSamilaViewport):SceneOutput {
  const started=performance.now();if(!['map','symmetry','samila'].includes(baseScene.kind))throw new Error('持续批次密度仅支持 Map、Symmetry 和 Samila');
  if(!Number.isFinite(c.time)||c.time<0||c.time>86400)throw new Error('持续密度时间须为 0–86400 秒');cancelled(c);
  const base=inputScene(baseScene),zero=runtime.atTime(Number(base.settings.iteratedStartTime??0)),initial=config(zero),target=Math.max(-1,Math.floor((c.time-initial.startTime)*initial.fps+1e-9)),warnings:string[]=[];
  if(target<0)backend='cpu';
  warnings.push(...parseSamilaCamera(baseScene).warnings);
  const [width,height]=usesSourceSamilaSplat(base)?exactRasterDimensions(c):rasterDimensions(c,1,backend,warnings),view=usesSamilaSourceProjection(current)?samilaNdcDensityViewport():parseDensityViewport(current,width,height),bytes=backend==='webgl2'?iteratedGpuBytes(initial.count,width,height,2048,initial.samilaHistoryModel==='bounded-v2',hasSymmetryCustom(base),usesSourceSamilaSplat(base),Boolean(preparedTone.sourcePresentation))+width*height*4:(usesSourceSamilaSplat(base)?256*256*4+1024*3*4:0)+(base.kind==='samila'?0:initial.count*33)+width*height*36;
  const captured=usesCapturedDensityCamera(baseScene);
  if(captured){view.projection='xy';view.bounds={minX:-1,maxX:1,minY:-1,maxY:1};}
  else if(runtime.bounds&&!usesSamilaSourceProjection(current))view.bounds=runtime.bounds;
  const sourceSampling=usesSourceSamilaSampling(baseScene),samplingKey=sourceSampling?JSON.stringify([base.id,identity(base,width,height),runtime.key,c.samilaPrimaryPixelHeight]):'';if(samplingKey!==this.samplingKey){this.sampling.reset();this.samplingKey=samplingKey;}
  if(bytes+this.samplingBytes()>MAX_LIVE_BYTES)throw new Error('持续密度已知工作缓冲超过 768 MiB；请减少批次粒子数或画布尺寸');
  validatePalette(current.palette);
  const reusableCompiler=backend==='webgl2'&&retainsIteratedCompiler(base),scope=JSON.stringify([base.id,base.kind]);
  const key=backend+identity(base,width,height)+JSON.stringify({projection:view.projection,bounds:view.bounds,padding:view.padding,samilaViewport:runtime.key,sourceViewport:captured?c.sourceViewport:undefined,samilaPrimaryPixelHeight:usesSourceSamilaSplat(base)?c.samilaPrimaryPixelHeight:undefined});
  if(key!==this.key||this.gpu&&this.gpuScope!==scope){
   if(reusableCompiler&&this.gpu&&this.gpuScope===scope)this.clearReplay();else this.resetSimulation();
   this.key=key;this.gpuScope=scope;
  }
  if(base.kind!=='samila'||backend!=='cpu')this.samilaPrograms=undefined;
  let state=this.state;this.hits=state&&state.frame<=target?1:0;if(state&&state.frame>target){state=undefined;if(!reusableCompiler)this.gpu?.reset();}
  let work=0,pixelTests=0;
  const preflight=(steps:number)=>{work+=steps;if(!Number.isSafeInteger(work)||work>MAX_REQUEST_STEPS)throw new Error('持续密度单次重放超过 20 亿次数学求值；请缩短时间、减少预热或批次');};
  if(!state){state={completedSamila:initial.samilaHistoryModel==='bounded-v2'?samilaToneFacts(initial,width,height,0,prepareSourceSamilaSplat(current,{width,height,primaryPixelHeight:c.samilaPrimaryPixelHeight,path:'points'})):undefined,lastFramePasses:0,lastFrameSamples:0,frame:-1,ink:new Float64Array(backend==='webgl2'?0:width*height*4),bounds:view.bounds??{minX:-width/height,maxX:width/height,minY:-1,maxY:1},fieldKey:'',structuralKey:'',steps:0,invalid:0,deposited:0,accepted:0,clipped:0,sampleInvalid:0,replays:0,clears:0,recordedPasses:0,lastBatchSize:initial.count};}
  const s=state;let newFrames=0;
  // Reject the minimum required work before allocating potentially huge states.
  // Samila may have disabled-record spans in its timeline. Only the parsed
  // per-frame job can establish whether any formula evaluations are required.
  if(base.kind!=='samila')preflight((target-s.frame)*initial.count*initial.iterations+(s.structuralKey===''?initial.count*initial.burn:0));work=0;
  for(let frame=s.frame+1;frame<=target;frame++){
   cancelled(c);const at=initial.startTime+frame/initial.fps,snapshot=runtime.atTime(at),job=prepareIteratedFrame(snapshot,at,frame,baseScene),cfg=job.config;
   job.samilaSplat=prepareSourceSamilaSplat(snapshot,{width,height,primaryPixelHeight:c.samilaPrimaryPixelHeight,path:'points'});
   if(captured){
    const plan=prepareOrdinarySourceFrame(ordinarySourceCameraFrame(snapshot,c));
    job.sourceCamera=prepareCapturedDensityCamera(base.kind as 'map'|'symmetry',plan,s.sourceCameraAnchor);
    s.sourceCameraAnchor=job.sourceCamera.anchor;
   }
   if(runtime.revision!==undefined&&!sourceSampling)cfg.sampleSeed=Math.floor(uniform(cfg.seed,0,runtime.revision,251)*4294967296);
   if(base.kind==='samila'){const projection=job.samilaProjection;s.samilaGeometry=projection?{scaleX:projection.scaleX,scaleY:projection.scaleY,offsetX:projection.offsetX,offsetY:projection.offsetY}:samilaViewportTransform(snapshot);}
   if(cfg.fps!==initial.fps||cfg.startTime!==initial.startTime)throw new Error('持续采样时钟和 Replay 起点不能在运行中动画改变');
   if(cfg.samilaHistoryModel==='bounded-v2'){if(job.field.kind!=='samila')throw new Error('Samila 历史场类型不匹配');job.history=prepareSamilaHistoryFrame({parameters:job.field.parameters,fieldKey:job.fieldKey,frame,count:cfg.count,record:cfg.record},s.history,s.structuralKey!==job.structuralKey||(sourceSamilaFrame(snapshot)?.parameterWrites??0)>0);}
   // Clear ownership is resolved on the unanchored field. Camera theta never
   // changes that key, compensation, PRNG addresses or parameter acknowledgement.
   const camera=samilaCameraFrame(snapshot);
   if(camera){if(!job.history||job.field.kind!=='samila')throw new Error('Samila 相机缺少限幅历史帧');if(job.history.clear||s.samilaAnchor===undefined)s.samilaAnchor=camera.theta;job.field={...job.field,rotation:job.samilaProjection?samilaNdcSamplingRotation(job.field.rotation,s.samilaAnchor):samilaSamplingRotation(job.field.rotation,s.samilaAnchor)};}
   const passes=job.history?.passes??(cfg.record?1:0),samples=job.history?.samples??(cfg.record?cfg.count:0),randomFrames=job.history?.randomFrames??[frame];
   // Compensation is charged before backend allocation, copying or sampling.
   if(job.history){preflight(samples);pixelTests+=samples*(Math.ceil(job.samilaSplat?Math.max(sourceSamilaPointDiameter(job.samilaSplat),Math.max(Math.fround(job.samilaSplat.radius*Math.fround(.6)),Math.fround(.8))):cfg.pointSize)+2)**2;if(!Number.isSafeInteger(pixelTests)||pixelTests>MAX_PIXEL_TESTS)throw new Error('Samila 历史补采超过 20 亿次像素测试；请减少点尺寸、批次或时间');}
   const frameBytes=backend==='webgl2'?iteratedGpuBytes(cfg.count,width,height,2048,cfg.samilaHistoryModel==='bounded-v2',job.field.kind==='symmetry-custom',Boolean(job.samilaSplat),Boolean(preparedTone.sourcePresentation))+width*height*4:(job.samilaSplat?256*256*4+1024*3*4:0)+(base.kind==='samila'?0:cfg.count*33)+width*height*36;if(frameBytes+(sourceSampling?this.sampling.projectedBytes(frame)+this.samplingKey.length*2:this.samplingBytes())>MAX_LIVE_BYTES)throw new Error('持续密度动画状态超过 768 MiB 工作预算');
   if(sourceSampling)job.samilaSampling=prepareSourceSamilaSamplingBatch(this.sampling,frame,cfg.count,passes);
   if(backend==='webgl2'){
    const resetParticles=s.structuralKey!==job.structuralKey,clear=(job.history?.clear??(resetParticles||s.fieldKey!==job.fieldKey))||job.sourceCamera?.clearInk===true;
    if(!job.history)preflight(base.kind==='samila'?samples:cfg.count*(cfg.iterations+(resetParticles?cfg.burn:0)));
    if(cfg.record&&!job.history){pixelTests+=cfg.count*(Math.ceil(job.samilaSplat?Math.max(sourceSamilaPointDiameter(job.samilaSplat),Math.max(Math.fround(job.samilaSplat.radius*Math.fround(.6)),Math.fround(.8))):cfg.pointSize)+2)**2;if(pixelTests>MAX_PIXEL_TESTS)throw new Error('GPU 持续密度单次累积像素测试上界超过 20 亿；请减少点尺寸、批次或时间');}
    if(clear)clearInk(s);if(resetParticles)s.replays++;
    // GPU float states and ink never coexist with CPU orbit state. A failed
    // frame invalidates the entire trajectory and generate() restarts on CPU.
    this.gpu??=new IteratedDensityGpu();
    const facts=this.gpu.step(job,{resetParticles,clearInk:clear,width,height,projection:view.projection,padding:view.padding,bounds:view.bounds??(frame===0?undefined:s.bounds),isCancelled:c.isCancelled});
    s.structuralKey=job.structuralKey;s.fieldKey=job.fieldKey;s.bounds=facts.bounds;s.steps+=facts.steps;s.invalid+=facts.invalid;s.accepted+=facts.accepted;s.clipped+=facts.clipped;s.sampleInvalid+=facts.sampleInvalid;s.deposited+=samples;s.recordedPasses+=passes;s.lastFramePasses=passes;s.lastFrameSamples=samples;s.history=job.history?.next;s.lastBatchSize=cfg.count;if(job.history)s.completedSamila=samilaToneFacts(cfg,width,height,s.recordedPasses,job.samilaSplat);s.samilaSplat=job.samilaSplat;s.samilaSampling=job.samilaSampling;s.frame=frame;newFrames++;continue;
   }
   const f=compileField(job,job.field.kind==='samila'?this.programs(job.field):undefined),structuralKey=job.structuralKey,transform=job.transform,palette=job.palette,noise=job.samilaSplat?undefined:createNoise(cfg.seed),[axisX,axisY]=AXES[view.projection];
   if(s.structuralKey!==structuralKey){
    clearInk(s);s.structuralKey=structuralKey;s.replays++;s.fieldKey=job.fieldKey;
    if(base.kind!=='samila'){
     preflight(cfg.count*cfg.burn);s.positions=undefined;s.metrics=undefined;s.valid=undefined;s.positions=new Float64Array(cfg.count*3);s.metrics=new Float64Array(cfg.count);s.valid=new Uint8Array(cfg.count);
     for(let i=0;i<cfg.count;i++){if((i&255)===0)cancelled(c);let point=initialPoint(cfg,i,0);for(let step=0;step<cfg.burn;step++){const next=f.step!(point);s.steps++;if(next.valid)point=next.position;else{s.invalid++;point=initialPoint(cfg,i,step+1);}}s.positions.set(point,i*3);}
    }
   }else if((job.history?.clear??(s.fieldKey!==job.fieldKey))||job.sourceCamera?.clearInk){clearInk(s);s.fieldKey=job.fieldKey;}
   // Decay applies once per fixed sampling frame, independent of display requests.
   if(job.history)copySamilaHistory(s.ink,cfg.decay,job.history.densityCeiling,c.isCancelled);
   else if(cfg.decay!==1)for(let i=0;i<s.ink.length;i++){if((i&65535)===0)cancelled(c);s.ink[i]*=cfg.decay;}
   if(!job.history)preflight(base.kind==='samila'?samples:cfg.count*cfg.iterations);
   if(base.kind!=='samila')for(let i=0;i<cfg.count;i++){
    if((i&255)===0)cancelled(c);let point:Point3=[s.positions![i*3],s.positions![i*3+1],s.positions![i*3+2]],metric=0,valid=true;
    for(let j=0;j<cfg.iterations;j++){const next=f.step!(point);s.steps++;valid=next.valid;if(valid){metric=next.metric;point=next.position;}else{s.invalid++;point=initialPoint(cfg,i,cfg.burn+1+frame*16+j);}}
    s.positions!.set(point,i*3);s.metrics![i]=metric;s.valid![i]=valid?1:0;
   }
   const visit=(callback:(point:Point3,index:number,metric:number)=>void,countStats:boolean,randomFrame=frame,sampleOffset=0)=>{for(let i=0;i<cfg.count;i++){if((i&255)===0)cancelled(c);let point:Point3;if(base.kind==='samila'){point=f.sample!(i,randomFrame,sampleOffset);if(countStats)s.steps++;}else{if(!s.valid![i]){if(countStats)s.sampleInvalid++;continue;}point=[s.positions![i*3],s.positions![i*3+1],s.positions![i*3+2]];}const transformed=transform.point(...point);if(!transformed){if(countStats){s.invalid++;s.sampleInvalid++;}continue;}callback(transformed,i,s.metrics?.[i]??0);}};
   // Fit only the first real batch. Later batches never remap earlier pixels.
   if(frame===0&&!view.bounds&&(base.kind!=='samila'||cfg.record)){let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;visit(point=>{minX=Math.min(minX,point[axisX]);maxX=Math.max(maxX,point[axisX]);minY=Math.min(minY,point[axisY]);maxY=Math.max(maxY,point[axisY]);},false);if(minX!==Infinity){const cx=(minX+maxX)/2,cy=(minY+maxY)/2,aspect=width/height;let span=Math.max(maxY-minY,(maxX-minX)/aspect);if(span===0)span=Math.max(1,Math.abs(cx)*1e-6/aspect,Math.abs(cy)*1e-6);span*=1+view.padding*2;s.bounds={minX:cx-span*aspect/2,maxX:cx+span*aspect/2,minY:cy-span/2,maxY:cy+span/2};}}
   if(cfg.record){s.deposited+=samples;const bounds=s.bounds,spanX=bounds.maxX-bounds.minX,spanY=bounds.maxY-bounds.minY,radius=cfg.pointSize/2,splat=job.samilaSplat,sourcePalette=splat?sourceSamilaPaletteLut(palette):undefined;
    for(let pass=0;pass<passes;pass++){const randomFrame=job.samilaSampling?frame:randomFrames[pass];visit((point,index,metric)=>{
     const projected=job.sourceCamera?projectCapturedDensityPoint(job.sourceCamera.anchor,point,width,height):undefined;
     // Let the footprint clip at the side edges; a center outside XY may still
     // cover a pixel. Near/far and nonpositive W reject the entire source quad.
     if(projected&&(!projected.clip.every(Number.isFinite)||projected.clip[3]<=0||Math.abs(projected.clip[2])>projected.clip[3])){s.clipped++;return;}
     const ndc=job.samilaProjection?samilaNdcPosition(job.samilaProjection,point,width,height):undefined;
     if(ndc&&!ndc.every(Number.isFinite)){s.invalid++;s.sampleInvalid++;return;}
     if(splat?.path==='points'&&ndc!.some(v=>Math.abs(v)>1)){s.clipped++;return;}
     const px=ndc?(ndc[0]+1)*width/2-.5:projected?projected.pixel[0]-.5:(point[axisX]-bounds.minX)/spanX*width-.5,py=ndc?(1-ndc[1])*height/2-.5:projected?projected.pixel[1]-.5:(bounds.maxY-point[axisY])/spanY*height-.5;
     const extent=splat?sourceSamilaPointDiameter(splat)/2:radius+.5;
     const left=Math.max(0,Math.ceil(px-extent)),right=Math.min(width-1,Math.floor(px+extent)),top=Math.max(0,Math.ceil(py-extent)),bottom=Math.min(height-1,Math.floor(py+extent));
     if(left>right||top>bottom){s.clipped++;return;}s.accepted++;
     if(!job.history)pixelTests+=(right-left+1)*(bottom-top+1);if(pixelTests>MAX_PIXEL_TESTS)throw new Error('持续密度单次累积超过 20 亿次像素测试；请减少点尺寸、批次或时间');
     let u=0;if(!splat){if(cfg.color==='step')u=metricValue(metric,cfg.metricMin,cfg.metricMax,cfg.metricMode);else if(cfg.color==='index')u=index/Math.max(1,cfg.count-1);else if(cfg.color==='radius')u=Math.hypot(...point);else if(cfg.color==='height')u=point[1];else if(cfg.color==='angle')u=(Math.atan2(point[1],point[0])+Math.PI)/(2*Math.PI);else u=clamp((noise!(point[0]*.1,point[1]*.1,point[2]*.1)+1)/2);}
     const coordinate=splat?sourceSamilaPaletteCoordinate(ndc![0],ndc![1]):0;
     const rgb=splat?(cfg.sourcePaletteLut?sampleSourceSamilaPalette(sourcePalette!,coordinate):sourceSamilaFallbackColor(coordinate,cfg.colorPhase)):paletteColor(palette,u*cfg.colorSpeed+cfg.colorPhase/360);
     for(let y=top;y<=bottom;y++)for(let x=left;x<=right;x++){const coverage=splat?sourceSamilaSplatMass(splat,(x-px)/extent,(y-py)/extent,cfg.alpha):clamp(radius+.5-Math.hypot(x-px,y-py))*cfg.alpha;if(!coverage)continue;const at=(y*width+x)*4;for(let k=0;k<3;k++)s.ink[at+k]+=rgb[k]*coverage;s.ink[at+3]+=coverage;}
    },true,randomFrame,job.samilaSampling?pass*cfg.count:0);}
   }
   s.recordedPasses+=passes;s.lastFramePasses=passes;s.lastFrameSamples=samples;s.history=job.history?.next;s.lastBatchSize=cfg.count;if(job.history)s.completedSamila=samilaToneFacts(cfg,width,height,s.recordedPasses,job.samilaSplat);s.samilaSplat=job.samilaSplat;s.samilaSampling=job.samilaSampling;s.frame=frame;newFrames++;
  }
  cancelled(c);const tone:DensityToneJob=preparedTone.model==='normalized-v2'?{...preparedTone,normalization:deriveDensityNormalization({kind:preparedTone.normalization.kind,width,height,recordedPasses:s.recordedPasses,batchSize:s.lastBatchSize},preparedTone.normalization)}:preparedTone.model==='samila-normalized-v2'?{...preparedTone,normalization:deriveSamilaNormalization(s.completedSamila!)}:preparedTone;let pixels:Uint8ClampedArray,occupied=0,maxCount=0,toneBackend:'cpu'|'webgl2'='cpu';
  const camera=samilaCameraFrame(current),samilaView=camera?prepareSamilaView(camera,s.samilaAnchor??samilaCameraFrame(zero)?.theta??camera.theta,width,height,c.time):undefined;
  const shownTime=initial.startTime+Math.max(0,target)/initial.fps,sourceFrame=captured?ordinarySourceCameraFrame(runtime.atTime(Math.min(c.time,shownTime)),c):undefined;
  const sourceAnchor=sourceFrame?(s.sourceCameraAnchor??prepareCapturedDensityCamera(base.kind as 'map'|'symmetry',prepareOrdinarySourceFrame(sourceFrame)).anchor):undefined;
  if(samilaView&&tone.sourcePresentation){const {delta}=sourceSamilaDisplayTransform(samilaView,width,height);samilaView.delta=delta;samilaView.cos=Math.cos(delta);samilaView.sin=Math.sin(delta);}
  const densityView=sourceFrame&&sourceAnchor?prepareCapturedDensityView(sourceAnchor,sourceFrame.camera,width,height):samilaView;
  if(backend==='webgl2'){const shown=this.gpu!.present(tone,c.isCancelled,densityView);pixels=shown.pixels;occupied=shown.occupiedPixels;maxCount=shown.maxCount;toneBackend=shown.toneBackend;warnings.push(...shown.warnings);}
  else{pixels=toneDensityRgbaPrepared(width,height,s.ink,tone,c.isCancelled,undefined,densityView);for(let i=3;i<s.ink.length;i+=4){if((i&65535)===3)cancelled(c);if(s.ink[i]>0)occupied++;maxCount=Math.max(maxCount,s.ink[i]);}}
  this.state=s;
  if(usesSourceSamilaMath(baseScene)&&backend==='cpu')warnings.push('源 Samila CPU 为源表达式双精度求值与 Float32 数学的派生实现；原版使用 GPU，三角函数、幂、极点及未定义输入可能明显不同，不能视为原版 GPU 等效结果。');
  warnings.push(`固定 ${initial.fps} Hz 的独立持续批次；本次推进 ${newFrames} 帧，累计数学求值 ${s.steps} 次。`);
  if(captured)warnings.push('源相机在密度采样前投影；Map 变化重拍锚点，Symmetry 保留角度历史。编辑、尺寸和导出使用本地确定性重放；点覆盖、随机序列及原版整图仍未对照。');
  if(tone.model==='normalized-v2')warnings.push(NORMALIZED_DENSITY_NOTICE);
  if(tone.sourcePresentation&&toneBackend==='cpu')warnings.push('源 Samila 呈现采用 CPU float32 派生近似；JS 三角函数、幂函数和最近邻采样不保证与原 GPU 像素一致。');
  if(s.samilaSampling)warnings.push('源 Samila PCG 使用运行时随机 frameSeed；同时间请求复用本地固定帧及临时种子记录，新 Worker 或导出会重新取随机值；原版每次 display/暂停截图再抽样尚未接入，不等同原版未知 ThreadLocalRandom 流。');
  if(s.samilaSampling&&backend==='cpu')warnings.push('源 Samila CPU 采样采用逐步 float32 派生算术，不能保证与 GPU 融合乘加逐位相同。');
  if(s.samilaSampling&&backend==='webgl2')warnings.push('源 Samila GPU 采样遵循 PCG 整数与连续编号规则；已观测浮点舍入与原 shader 不同，不承诺坐标或整图逐位等同。');
  if(s.samilaSplat){warnings.push(s.samilaSampling?'源 Samila splat 使用固定二维 Simplex LUT、源色板与点覆盖；CPU 栅格化为派生近似，未声明原版整图一致。':'源 Samila splat 使用固定二维 Simplex LUT、源色板与点覆盖；随机点流仍为本地确定性流，CPU 栅格化为派生近似，未声明原版整图一致。');if(s.samilaSplat.referenceKind==='local-output')warnings.push('未提供主画布物理高度；本地显式使用输出高度作为点尺寸参考，不能当作原版主画布证据。');}
  if(backend==='webgl2'&&!s.samilaSplat)warnings.push('GPU 使用 float32 持久粒子与浮点密度、4097 点色板插值；混沌轨迹和颜色可能与 CPU 双精度不同，不承诺原版像素一致。');
  if(view.projection!=='xy')warnings.push(`当前密度投影为 ${view.projection.toUpperCase()}；三维坐标先做空间变换再投影。`);
  if(s.invalid)warnings.push(base.kind==='samila'?`${s.invalid} 次无效 Samila 数学采样已跳过。`:`${s.invalid} 次无效数学结果已显式跳过；迭代粒子从确定的初始盒重生。`);
  if(s.clipped)warnings.push(`${s.clipped} 个样本完全位于密度视口之外。`);
  return{type:'raster',cameraResolved:true,...(s.samilaSampling?{samilaSampling:{...s.samilaSampling}}:{}),...(tone.sourcePresentation?{sourceSamilaPresentation:{model:SOURCE_SAMILA_PRESENTATION_MODEL,stage:'present-target-rgba8' as const,display:'opaque-rgb-copy' as const,backend:toneBackend==='webgl2'?'webgl2' as const:'cpu-derived' as const}}:{}),...(s.samilaSplat?{samilaSplat:{...s.samilaSplat}}:{}),...(sourceFrame?{sourceCameraFrame:sourceFrame}:{}),...(samilaView?{samilaView,samilaViewportTransform:s.samilaGeometry??samilaViewportTransform(current)}:{}),dimension:2,backend,width,height,pixels,density:{projection:view.projection,bounds:{...s.bounds},inputPoints:s.deposited,examined:s.deposited,accepted:s.accepted,clipped:s.clipped,invalid:s.sampleInvalid,occupiedPixels:occupied,maxCount,toneBackend,cancelled:false},temporal:{time:Math.min(c.time,shownTime),windowStart:initial.startTime,frames:Math.max(0,target+1),samplingFps:initial.fps,recordedPoints:s.deposited,cacheHits:this.hits},stats:{samples:s.steps,generated:s.accepted,invalid:s.invalid,elapsedMs:performance.now()-started},warnings};
 }
}
export function generateIteratedDensity(scene:SceneDocument,context:GenerateContext,session?:IteratedDensitySession):SceneOutput {if(session)return session.generate(scene,context);const owner=new IteratedDensitySession();try{return owner.generate(scene,context);}finally{owner.reset();}}
const n=(key:string,label:string,min:number,max:number,step:number,help?:string):ControlSpec=>({key,label,type:'number',min,max,step,help,group:'持续密度'});
const select=(key:string,label:string,values:[string,string][]):ControlSpec=>({key,label,type:'select',options:values.map(([value,label])=>({value,label})),group:'持续密度'});
export const iteratedDensityDefaults:Settings={iteratedMode:'single',iteratedBackend:'auto',batchSize:4096,iterationsPerFrame:1,iteratedFps:60,iteratedStartTime:0,accumulationDecay:1,alpha:.1,showTrails:true,trailLifetime:4,recordTrails:true,stepMetricMin:0,stepMetricMax:2,stepMetricNormalize:'clamp',colorSpeed:.22,colorPhase:0,iteratedColor:'step'};
export const iteratedDensityControls:ControlSpec[]=[
 select('iteratedMode','采样推进',[['single','单次采样'],['continuous','持续批次密度']]),
 select('iteratedBackend','持续计算后端',[['auto','自动选择'],['cpu','CPU 双精度'],['gpu','GPU 浮点状态']]),
 {...select('samilaHistoryModel','Samila 历史模型',[['legacy-v1','原有累积'],['bounded-v2','限幅与参数补采']]),help:'时间线参数变化后清空历史并补采六批；直接编辑参数会从一批重新计算。'},
 n('batchSize','每批粒子数',1,MAX_BATCH,1024,'Map/Symmetry 保留每个粒子的状态；Samila 每批生成新的确定随机样本。'),
 n('iterationsPerFrame','每采样帧迭代',1,16,1,'每个粒子推进指定次数，只累积最后一个位置。'),n('iteratedFps','持续采样帧率',1,120,1),n('iteratedStartTime','Replay 起始时间',0,86400,.01),n('accumulationDecay','持续密度保留率',0,1,.001),
 n('alpha','每样本密度权重',0,1,.01),{key:'showTrails',label:'按寿命衰减',type:'toggle',group:'持续密度'},n('trailLifetime','密度衰减至 1% · 秒',.001,3600,.1),{key:'recordTrails',label:'记录新批次',type:'toggle',group:'持续密度'},
 select('iteratedColor','持续样本配色',[['step','最后一步距离'],['noise','空间噪声'],['index','粒子序号'],['radius','距原点距离'],['angle','极角'],['height','高度']]),
 n('stepMetricMin','步长度量下限',0,1e12,.01),n('stepMetricMax','步长度量上限',.001,1e12,.01),select('stepMetricNormalize','步长归一化',[['clamp','截断'],['robust','稳健压缩']]),n('colorSpeed','样本颜色频率',.001,100,.01),n('colorPhase','样本颜色相位 · 度',-1e9,1e9,1),
];
export function visibleIteratedControls(kind:SceneKind,settings:Settings,controls:ControlSpec[],timeline?:SceneDocument['timeline'],palette?:Pick<Palette,'mode'>):ControlSpec[] {
 if(!['map','symmetry','samila'].includes(kind))return controls;
 const sourceSampling=usesSourceSamilaSampling({kind,settings}),sourceSplat=usesSourceSamilaSplat({kind,settings}),sourceMath=usesSourceSamilaMath({kind,settings}),active=settings.iteratedMode==='continuous',normalized=active&&((kind!=='samila'&&settings.densityToneModel==='normalized-v2')||(kind==='samila'&&settings.densityToneModel==='samila-normalized-v2')),own=new Set(iteratedDensityControls.map(c=>c.key)),hidden=new Set<string>();
 if(kind!=='samila')hidden.add('samilaHistoryModel');
 if(timeline&&usesSourceSamilaTimeline({kind,settings,timeline}))hidden.add('iteratedFps');
 if(sourceMath)hidden.add('iteratedMode');
 if(usesSourceSamilaPresentation({kind,settings}))hidden.add('transparentBackground');
 if(sourceSplat){for(const key of ['pointSize','iteratedColor','colorSpeed','stepMetricMin','stepMetricMax','stepMetricNormalize','samilaToneBranch','samilaHistoryModel'])hidden.add(key);if(sourceSamilaUsesPaletteLut(settings,palette??{mode:'linear'}))hidden.add('colorPhase');}
 if(usesSamilaSourceProjection({kind,settings}))for(const key of SAMILA_SOURCE_DORMANT_CONTROLS)hidden.add(key);
 if((kind==='map'||kind==='symmetry')&&settings.iteratedCameraModel===CAPTURED_DENSITY_CAMERA_MODEL)for(const key of ['iteratedMode','densityProjection','densityView','densityCenterX','densityCenterY','densitySpan','densityPadding'])hidden.add(key);
 if(!normalized)for(const c of [...normalizedDensityControls,...samilaToneControls])hidden.add(c.key);
 else for(const k of ['toneMap','paletteMode','dynamicRange','exposure','gamma','contrast','brightness','saturation'])hidden.add(k);
 if(!active){for(const k of own)if(k!=='iteratedMode')hidden.add(k);if(kind==='symmetry')for(const axis of ['X','Y'])for(const edge of ['Min','Max'])hidden.add('initial'+axis+edge);}
 else {for(const k of ['count','colorMetric','presentation','densityAccumulation','densityLifetime','densitySampleRate','densityDecay'])hidden.add(k);if(kind==='samila'){hidden.add('iterationsPerFrame');hidden.add('burnIn');}else for(const k of ['alpha','showTrails','trailLifetime'])hidden.add(k);if(settings.showTrails===false)hidden.add('trailLifetime');if(settings.paletteMode!=='source'&&!normalized){for(const k of ['iteratedColor','colorSpeed','colorPhase','stepMetricMin','stepMetricMax','stepMetricNormalize'])hidden.add(k);}else if(settings.iteratedColor!=='step')for(const k of ['stepMetricMin','stepMetricMax','stepMetricNormalize'])hidden.add(k);}
 if(sourceSampling)for(const key of ['seed','funcSeed','recordTrails'])hidden.add(key);
 return [...controls,...(sourceSplat?[{key:'samilaSpotSize',label:'源斑点尺寸',type:'number' as const,step:.001,group:'持续密度',help:'源 spot_size，经主画布物理高度换算；不等同像素半径。'}]:[])].filter(c=>!hidden.has(c.key)).map(c=>{if(sourceSampling&&c.key==='batchSize')return{...c,help:'使用运行时随机样本；参数改变时，采样量增至六倍。'};if(kind==='samila'&&c.key==='iteratedColor')return{...c,options:c.options?.filter(o=>o.value!=='step')};
  if(sourceSplat&&['alpha','trailLifetime','accumulationDecay','normalizedBrightness','normalizedContrast','normalizedGamma','normalizedDynamicRange','normalizedSaturation','colorPhase'].includes(c.key))return{...c,min:undefined,max:undefined,...(c.key==='colorPhase'?{label:'源余弦相位 · 弧度'}:{})};
  if(sourceMath&&(c.key==='start'||c.key==='stop'))return{...c,label:c.key==='start'?'源采样边界 A':'源采样边界 B',min:undefined,max:undefined,help:'原版先排序再转 Float32；允许相等边界，超出有限 Float32 范围会明确报错。'};
  if(sourceMath&&c.key==='funcSeed')return{...c,min:-2147483648,max:2147483647,label:'源函数种子（保留值）',help:'原版数学采样不消费此字段；本地随机探索属于独立工具。'};
  if(sourceMath&&c.key==='seed')return{...c,label:'本地重放随机种子',help:'用于可重放的本地采样，不是原版每帧 ThreadLocalRandom 随机流。'};
  if(sourceMath&&(c.key==='mapping'||c.key==='projection'))return{...c,options:c.options?.map(o=>o.value==='random'?{...o,label:c.key==='mapping'?'源 RANDOM · 等同 F1_VS_F2':'源 RANDOM · 等同直角投影'}:o)};
  return c;});
}
