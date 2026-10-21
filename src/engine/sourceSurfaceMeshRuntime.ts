import {sourceSurfaceParameterFrameRate,type SourceSurfaceUpdateFrame} from './sourceSurfaceFrame';
import type {SourceSurfaceGpuFunction} from './sourceSurfaceGpuFunction';
import type {SourceSurfaceGpuMeshFrame} from './sourceSurfaceGpuMesh';
import type {OrdinaryCameraTargetBinding,OrdinaryCameraTargetRequest,OrdinarySourceCameraParticles} from './ordinarySourceCameraTimeline';
import {parseSourceSurfaceMeshConfiguration,type SourceSurfaceMeshConfiguration} from './sourceSurfaceMeshConfig';
import type {SourceSurfaceFunction} from './sourceSurfaceFunction';
import {createSourceSurfaceMeshGeometry,type SourceSurfaceMeshGeometry,type SourceSurfaceMeshGeometryFrame,type SourceSurfaceGpuMeshGeometryFrame,type SourceMeshVector} from './sourceSurfaceMeshGeometry';
import {createSourceSurfaceMeshWireframe,type SourceSurfaceMeshWireframeFrame} from './sourceSurfaceMeshWireframe';
import {prepareSourceSurfaceColors,refreshSourceSurfaceColors,type PreparedSourceSurfaceColors,type SourceSurfacePalette} from './sourceSurfaceColor';
import {INITIAL_SOURCE_SURFACE_PALETTE_STATE,smoothSourceSurfacePalette,sourceSurfacePaletteTarget,type SourceSurfacePaletteState} from './sourceSurfaceGradient';
import {SourceGradientRuntime,type SourceGradientAction,type SourceGradientSnapshot} from './sourceGradientRuntime';
import {SourceSurfaceParameterRuntime,type SourceSurfaceParameterAction,type SourceSurfaceParameterConfiguration} from './sourceSurfaceParameterRuntime';

const F=Math.fround,MAX_WORK=20_000_000;
export class SourceSurfaceMeshRuntimeError extends Error {
 constructor(readonly code:'input'|'unsupported'|'capacity'|'cancelled',message:string){super(message);this.name=code==='cancelled'?'AbortError':'SourceSurfaceMeshRuntimeError';}
}
function fail(code:SourceSurfaceMeshRuntimeError['code'],message:string):never{throw new SourceSurfaceMeshRuntimeError(code,message);}
export interface SourceSurfaceMeshRuntimeOptions {
 /** mode is the authored initial selection. This factory explicitly creates a
  * MeshSurface even when a later host transition starts from mode:'points'. */
 configuration:SourceSurfaceMeshConfiguration;
 /** Exact function object created for this native MeshSurface lifetime. A host
  * mode switch passes recreate(), leaving old animation bindings attached here. */
 surfaceFunction:SourceSurfaceFunction;
 gpuFunction?:SourceSurfaceGpuFunction;
 operationsPerPosition:number;
 frameRate:number;
 palette?:SourceSurfacePalette;
 reserve?:(units:number)=>void;
 isCancelled?:()=>boolean;
 /** Camera-only queries retain particle identity and update order without
  * generating unobserved display geometry. They cannot publish mesh snapshots. */
 coverage?:'all'|'tracked';
}
export interface SourceSurfaceMeshRuntimeSnapshot {
 frameIndex:number;animationTime:number;geometry?:SourceSurfaceMeshGeometryFrame;gpuMesh?:SourceSurfaceGpuMeshFrame;
 /** Preserve native packed color through the renderer's PGraphics fill(int)
  * interpretation; early RGB conversion loses its low-byte grayscale branch. */
 packedColors:Uint32Array;fillEnabled:boolean;fillOpacity:number;
 wireframe?:SourceSurfaceMeshWireframeFrame;
 gradient:SourceGradientSnapshot;paletteState:SourceSurfacePaletteState;
 tracked:{index:number;u:number;v:number;speedU:number;speedV:number;position:SourceMeshVector};
 diagnostics:readonly string[];workUnits:number;
}

/** One source MeshSurface, not a mode-switch host. update and display are separate
 * native lifecycle events: queue completion stops update but never display.
 * There is no gradient.update call in MeshSurface.update. */
export class SourceSurfaceMeshRuntime implements OrdinarySourceCameraParticles {
 private readonly options:SourceSurfaceMeshRuntimeOptions;
 private readonly configuration:SourceSurfaceMeshConfiguration;
 private readonly numU:number;private readonly numV:number;private readonly count:number;
 private initialUv:Float32Array;private initialPositions:Float32Array;
 private readonly geometry:SourceSurfaceMeshGeometry;
 private readonly wireframe?:ReturnType<typeof createSourceSurfaceMeshWireframe>;
 private color?:PreparedSourceSurfaceColors;
 private readonly gradient:SourceGradientRuntime;
 private readonly parameters:SourceSurfaceParameterRuntime;
 private paletteState:SourceSurfacePaletteState=INITIAL_SOURCE_SURFACE_PALETTE_STATE;
 private readonly ignoredNames=new Set<string>();
 private readonly trackingPosition=new Float32Array(3);
 private readonly tracking=new Float32Array(4);
 private trackingIndex=0;private animationTime=0;private lastUpdate=-1;private lastDisplay=-1;
 private retired=false;
 private used=0;private failed=false;private failure:unknown;
 private rendered?:SourceSurfaceMeshRuntimeSnapshot;
 private colorRevision=0;
 private gpuShapeRevision=-1;private gpuShapeGeneration=0;private gpuShapeFunctionRevision=0;
 private gpuShape?:SourceSurfaceGpuMeshGeometryFrame;private gpuShapeColors?:Uint32Array;
 private gpuSeamsCache?:{revision:number;seams:ReturnType<SourceSurfaceMeshGeometry['sampleSeams']>};
 private geometryCache?:{revision:number;frame:SourceSurfaceMeshGeometryFrame};
 private wireCache?:{revision:number;frame:SourceSurfaceMeshWireframeFrame};
 private mappedColorCache?:{revision:number;colorRevision:number;packed:Uint32Array};
 constructor(options:SourceSurfaceMeshRuntimeOptions){
  this.options={...options};
  const parsed=parseSourceSurfaceMeshConfiguration(options.configuration);
  if(!parsed.ok)fail(parsed.error.kind==='capacity'?'capacity':'input',`原版网格配置无效：${parsed.error.path.join('.')} ${parsed.error.reason}`);
  this.configuration=parsed.value;
  if((this.configuration.nativeBackend==='gpu')!==!!options.gpuFunction)fail('input','GPU 网格与编译函数必须匹配');
  if(!Number.isFinite(options.frameRate)||options.frameRate<1||options.frameRate>120)fail('input','原版网格帧率必须在 1–120');
  if(!Number.isInteger(options.operationsPerPosition)||options.operationsPerPosition<0)fail('input','原版网格公式工作量无效');
  this.numU=this.configuration.mesh.uSegments;this.numV=this.configuration.mesh.vSegments;this.count=this.numU*this.numV;
  if(![this.numU,this.numV].every(n=>Number.isInteger(n)&&n>=1&&n<=512))fail('capacity','原版网格每轴采样数必须在 1–512');
  this.reserve(this.count*9);
  this.initialUv=new Float32Array(this.count*2);this.initialPositions=new Float32Array(this.count*3);
  const {domain:d,mesh:m}=this.configuration;
  const scratch=new Float32Array(3);
  this.geometry=createSourceSurfaceMeshGeometry({numU:this.numU,numV:this.numV,uMin:d.uMin,uMax:d.uMax,vMin:d.vMin,vMax:d.vMax,meshWrapU:m.wrapU,meshWrapV:m.wrapV,meshWrapThreshold:m.wrapThreshold,
   sample:(u,v,includeOffset)=>{this.position(u,v,scratch,0,includeOffset);return scratch as unknown as SourceMeshVector;},reserve:n=>this.reserve(n)});
  if(this.configuration.nativeBackend==='cpu')this.wireframe=createSourceSurfaceMeshWireframe({numU:this.numU,numV:this.numV,uMin:d.uMin,uMax:d.uMax,vMin:d.vMin,vMax:d.vMax,
   sample:(u,v,includeOffset)=>{this.position(u,v,scratch,0,includeOffset);return scratch as unknown as SourceMeshVector;},reserve:n=>this.reserve(n),parameterNormal:(u,v)=>this.geometry.sampleParameterNormal(u,v),
   ...this.configuration.transform,wireframeUSegments:m.wireframeDecoupled?m.wireframeUSegments:-1,wireframeVSegments:m.wireframeDecoupled?m.wireframeVSegments:-1,fillEnabled:m.fillEnabled,lineWeight:m.lineWeight,packedColor:m.wireframeColor});
  // initDots uses half-open U-major particles and zero mesh particle speeds;
  // the separate tracked dot inherits configured speeds. The inclusive render
  // grid belongs to geometry, not to these particle positions.
  const stepU=F(F(F(d.uMax)-F(d.uMin))/F(this.numU)),stepV=F(F(F(d.vMax)-F(d.vMin))/F(this.numV));
  for(let i=0;i<this.numU;i++)for(let j=0;j<this.numV;j++){
   const id=i*this.numV+j,u=F(F(d.uMin)+F(F(i)*stepU)),v=F(F(d.vMin)+F(F(j)*stepV));
   this.initialUv[id*2]=u;this.initialUv[id*2+1]=v;this.position(u,v,this.initialPositions,id*3);
  }
  this.select(Math.floor(this.count/2));
  // applyPalette runs after initDots, using Mesh's closure override and three
  // cyclic smoothing passes. Static colors do not refresh on parameter edits.
  this.reserve(this.numU*128+this.count*4);
  this.color=prepareSourceSurfaceColors(options.palette,this.numU,this.numV,this.geometry.cyclicPaletteU(),3);
  this.gradient=new SourceGradientRuntime(()=>this.paletteState.primary,(frame,configuration)=>{
   this.reserve(64);const next=smoothSourceSurfacePalette(this.paletteState,sourceSurfacePaletteTarget(frame,configuration.mode));
   if(!next.changed)return;this.paletteState=next.state;
   if(this.retired)return;
   this.reserve(this.numU*128+this.count*4);
   // Source evaluates closure first even while a running gradient forces cyclic.
   const cyclic=this.geometry.cyclicPaletteU()||this.gradient.running;
   refreshSourceSurfaceColors(this.color!,this.numU,this.numV,this.paletteState,configuration.mode,configuration.interpolation,cyclic,()=>this.check(),3);
   this.colorRevision++;
  });
  this.parameters=new SourceSurfaceParameterRuntime({read:name=>this.options.surfaceFunction.read(name),write:(name,value)=>{if(!this.options.surfaceFunction.write(name,value))this.ignoredNames.add(name);},reserve:n=>this.reserve(n)});
 }
 private check(){if(this.failed)throw this.failure;if(this.options.isCancelled?.())fail('cancelled','原版曲面网格回放已取消');}
 private guarded<T>(run:()=>T):T{try{this.check();return run();}catch(error){this.failed=true;this.failure=error;this.rendered=undefined;this.geometryCache=undefined;this.wireCache=undefined;this.mappedColorCache=undefined;this.gpuShape=undefined;this.gpuShapeColors=undefined;this.gpuSeamsCache=undefined;throw error;}}
 private reserve(units:number){this.check();this.used+=units;if(this.used>MAX_WORK)fail('capacity','原版曲面网格超过本地 2000 万工作单位预算');this.options.reserve?.(units);}
 private position(u:number,v:number,out:Float32Array,offset=0,includeOffset=true){this.reserve(this.options.operationsPerPosition+12);return this.options.surfaceFunction.position(u,v,out,offset,includeOffset);}
 private select(index:number){
  this.reserve(1);this.trackingIndex=index;this.tracking[0]=this.initialUv[index*2];this.tracking[1]=this.initialUv[index*2+1];
  this.tracking[2]=F(this.configuration.tracking.speedU);this.tracking[3]=F(this.configuration.tracking.speedV);
  this.trackingPosition.set(this.initialPositions.subarray(index*3,index*3+3));
 }
 bind(request:OrdinaryCameraTargetRequest):OrdinaryCameraTargetBinding{return this.guarded(()=>{
  if(this.retired||this.lastUpdate>=0||this.lastDisplay>=0)fail('input','原版网格目标必须在首次播放前绑定');
  const raw=request.action.args?.index;if(typeof raw!=='number'||!Number.isFinite(raw))fail('input','原版网格跟踪索引必须有限');
  this.select(Math.max(0,Math.min(this.count-1,Math.trunc(F(raw)))));
  // Every binding captures this SAME mutable trackingPosition object. Later
  // build-time setTrackedDot calls overwrite the target of all earlier actions.
  return{kind:'bound',readPosition:()=>this.guarded(()=>[this.trackingPosition[0],this.trackingPosition[1],this.trackingPosition[2]])};
 });}
 /** Keep the separate tracking vector and initial action/function identity;
  * detach display data when the host replaces the native main object. */
 retire():void{this.guarded(()=>{this.retired=true;this.initialUv=new Float32Array();this.initialPositions=new Float32Array();this.color=undefined;this.rendered=undefined;this.geometryCache=undefined;this.wireCache=undefined;this.mappedColorCache=undefined;this.gpuShape=undefined;this.gpuShapeColors=undefined;this.gpuSeamsCache=undefined;});}
 setRecordingTrails(enabled:boolean):void{this.guarded(()=>{if(typeof enabled!=='boolean')fail('input','原版网格拖尾开关需要布尔值');});}
 beginGradientActions(actions:readonly SourceGradientAction[]):void{this.guarded(()=>this.gradient.begin(actions));}
 interpolateGradientActions(eased:number,finished:boolean):void{this.guarded(()=>this.gradient.interpolate(eased,finished));}
 beginParameterActions(actions:readonly SourceSurfaceParameterAction[]):void{this.guarded(()=>this.parameters.begin(actions));}
 interpolateParameterActions(eased:number,finished:boolean):void{this.guarded(()=>this.parameters.interpolate(eased,finished));}
 beginParameterClip(parameters:readonly ({name:string}&SourceSurfaceParameterConfiguration)[]):void{this.guarded(()=>this.parameters.replace(parameters));}
 finishParameterClip():void{this.guarded(()=>this.parameters.stop());}
 update(frame:SourceSurfaceUpdateFrame):void{this.guarded(()=>{
  if(this.retired)fail('input','已移出的网格不再执行更新');
  if(!Number.isInteger(frame.frameIndex)||frame.frameIndex<0||this.lastUpdate>this.lastDisplay||this.lastUpdate>=0&&frame.frameIndex!==this.lastUpdate+1||frame.frameIndex<=this.lastDisplay||!Number.isFinite(F(frame.time))||frame.time<0||!Number.isFinite(F(frame.deltaTime))||frame.deltaTime<0)fail('input','原版网格更新帧顺序或时间无效；每次更新后必须执行对应显示帧');
  this.lastUpdate=frame.frameIndex;const dt=F(frame.deltaTime);if(dt<=0)return;
  this.animationTime=F(frame.time);this.parameters.update(dt,sourceSurfaceParameterFrameRate(frame,this.options.frameRate));
  // Native stationary particle positions are only copied by build-time bind.
  // After playback starts bind is prohibited, and display samples its separate
  // inclusive grid. Recalculating that unobserved half-open array would neither
  // update trackingDot (an independent object) nor supply a rendered vertex.
  const d=this.configuration.domain;
  for(const [i,axis]of (['U','V'] as const).entries()){
   const min=F(d[axis==='U'?'uMin':'vMin']),max=F(d[axis==='U'?'uMax':'vMax']),periodic=d[`periodic${axis}`],flowing=d[`flowing${axis}`];
   const wrap=(value:number)=>{const range=F(max-min);if(range<=0)return min;let result=F(F(value-min)%range);if(result<0)result=F(result+range);return F(min+result);};
   let value=this.tracking[i];if(periodic&&flowing)value=wrap(value);
   value=F(value+F(dt*this.tracking[i+2]));
   if(periodic){
    if(flowing)value=wrap(value);
    else if(value<min||value>max){this.tracking[i+2]=-this.tracking[i+2];value=value<min?min:value>max?max:value;}
   }
   this.tracking[i]=value;
  }
  this.position(this.tracking[0],this.tracking[1],this.trackingPosition);
 });}
 /** GPU shape is dirty only when palette/config changes, not when parameter
  * slots move. Uniform wrap/twist is sampled from current function separately.
  * Queue-complete displays still perform this lifecycle, as in drawMeshGPU. */
 private displayGpu(frameIndex:number,publish:boolean,revision:number):void {
  const {mesh:m,domain:d}=this.configuration;
  const decoupled=m.wireframeDecoupled&&(m.wireframeUSegments>0||m.wireframeVSegments>0);
  if(this.gpuShapeRevision!==this.colorRevision){
   this.gpuShape=m.fillEnabled||m.wireframeEnabled&&!decoupled?this.geometry.renderGpu():undefined;
   const ids=this.gpuShape?.sourceColorIndices;this.reserve(ids?.length??0);
   this.gpuShapeColors=new Uint32Array(ids?.length??0);
   if(ids)for(let i=0;i<ids.length;i++){if((i&255)===0)this.check();this.gpuShapeColors[i]=this.color!.packed[ids[i]];}
   this.gpuSeamsCache=undefined;this.gpuShapeRevision=this.colorRevision;this.gpuShapeFunctionRevision=revision;this.gpuShapeGeneration++;
  }
  // Same function/config gives the same seam flags after a completed draw.
  // Palette callbacks can mutate the geometry owner's twist state; resample
  // before publication even when only the color revision changed above.
  if(this.gpuSeamsCache?.revision!==revision)this.gpuSeamsCache={revision,seams:this.geometry.sampleSeams()};
  this.lastDisplay=frameIndex;
  if(!publish){this.rendered=undefined;return;}
  const prepared=this.options.gpuFunction!,parameters=prepared.uniforms(name=>this.options.surfaceFunction.read(name));
  if(!parameters.ok)fail(parameters.error.kind==='capacity'?'capacity':'input',parameters.error.reason);
  const shape=this.gpuShape,colors=this.gpuShapeColors!;
  this.reserve((shape?shape.seeds.length+shape.triangles.length:0)+colors.length+32);
  const packedColors=colors.slice(),seams=this.gpuSeamsCache!.seams;
  const gpuMesh:SourceSurfaceGpuMeshFrame={model:'surface-gpu-mesh-1.7.8',seeds:shape?.seeds.slice()??new Float32Array(),triangles:shape?.triangles.slice()??new Uint32Array(),packedColors,
   shapeGeneration:this.gpuShapeGeneration,shapeFunctionRevision:this.gpuShapeFunctionRevision,
   functionBody:prepared.functionBody,parameters:parameters.value,scale:prepared.scales,offset:prepared.offsets,time:this.animationTime,
   uLimits:[F(d.uMin),F(d.uMax)],vLimits:[F(d.vMin),F(d.vMax)],periodic:[Number(seams.wrapU),Number(seams.wrapV)],flowing:[Number(d.flowingU),Number(d.flowingV)],twistedU:seams.twistedU,twistedV:seams.twistedV,
   fillEnabled:m.fillEnabled,fillOpacity:Math.max(0,Math.min(1,F(m.fillOpacity))),wireframeEnabled:m.wireframeEnabled,wireframeDecoupled:decoupled,lineWeight:Math.max(F(.1),F(m.lineWeight)),wireframeColor:m.wireframeColor};
  this.rendered={frameIndex,animationTime:this.animationTime,gpuMesh,packedColors,fillEnabled:m.fillEnabled,fillOpacity:m.fillOpacity,
   gradient:this.gradient.snapshot(),paletteState:{...this.paletteState},tracked:{index:this.trackingIndex,u:this.tracking[0],v:this.tracking[1],speedU:this.tracking[2],speedV:this.tracking[3],position:[...this.trackingPosition] as unknown as SourceMeshVector},
   diagnostics:[...this.color!.diagnostics,...(this.ignoredNames.size?[`原版曲面忽略 ${this.ignoredNames.size} 个未声明参数的写入。`]:[])],workUnits:this.used};
 }
 /** Call after the frame's animation/update/camera work, even for dt=0 and
  * completed queues. snapshot never creates geometry or initializes U shift. */
 display(frameIndex:number,lineScale=1,publish=true):void{this.guarded(()=>{
  if(this.retired)fail('input','已移出的网格不再显示');
  if(!Number.isInteger(frameIndex)||frameIndex<0||this.lastDisplay>=0&&frameIndex!==this.lastDisplay+1||frameIndex<this.lastUpdate||this.lastDisplay<0&&this.lastUpdate>=0&&frameIndex!==this.lastUpdate)fail('input','原版网格显示帧顺序无效');
  this.reserve(1);
  if(this.options.coverage==='tracked'){this.lastDisplay=frameIndex;this.rendered=undefined;return;}
  const revision=this.options.surfaceFunction.revision;
  if(!Number.isSafeInteger(revision)||revision<0)fail('input','原版网格函数版本无效');
  if(this.configuration.nativeBackend==='gpu'){this.displayGpu(frameIndex,publish,revision);return;}
  const m=this.configuration.mesh,decoupled=m.wireframeDecoupled&&(m.wireframeUSegments>0||m.wireframeVSegments>0);
  // Decoupled-only wire curves must not initialize the fill U-shift cache.
  if((m.fillEnabled||m.wireframeEnabled&&!decoupled)&&this.geometryCache?.revision!==revision){
   this.geometryCache={revision,frame:this.geometry.render()};
  }
  const privateGeometry=this.geometryCache?.frame;
  // A completed display is the cache boundary. With identical function slots
  // and fixed config, repeating closure detection is idempotent (including the
  // retained V-twist flag); first-display shift creation is never skipped.
  // A changed revision always runs native geometry against the same shift owner.
  if(m.wireframeEnabled&&this.wireCache?.revision!==revision)this.wireCache={revision,frame:this.wireframe!.render(privateGeometry,lineScale)};
  if(this.mappedColorCache?.revision!==revision||this.mappedColorCache.colorRevision!==this.colorRevision){
   const length=privateGeometry?.sourceColorIndices.length??0;this.reserve(length);
   const packed=new Uint32Array(length);
   for(let i=0;i<length;i++){
    if((i&255)===0)this.check();packed[i]=this.color!.packed[privateGeometry!.sourceColorIndices[i]];
   }
   this.mappedColorCache={revision,colorRevision:this.colorRevision,packed};
  }
  const privateWire=this.wireCache?.frame,privateColors=this.mappedColorCache.packed;
  // Intermediate source display still resolves geometry/shift state. Only the
  // requested output frame needs public copies; private caches never escape.
  if(!publish){this.lastDisplay=frameIndex;this.rendered=undefined;return;}
  // Private caches never escape. Public frames may be mutated or transferred;
  // charge every element before copying to keep both ownership and bounds.
  this.reserve(privateColors.length+(privateWire?.positions.length??0)+(privateGeometry?privateGeometry.positions.length+privateGeometry.normals.length+privateGeometry.triangles.length+privateGeometry.sourceColorIndices.length+privateGeometry.wireframeIndexedTriangles.length+privateGeometry.wireframeUSeamQuads.length:0));
  const geometry=privateGeometry?{positions:privateGeometry.positions.slice(),normals:privateGeometry.normals.slice(),triangles:privateGeometry.triangles.slice(),sourceColorIndices:privateGeometry.sourceColorIndices.slice(),wireframeIndexedTriangles:privateGeometry.wireframeIndexedTriangles.slice(),wireframeUSeamQuads:privateGeometry.wireframeUSeamQuads.slice(),seams:{...privateGeometry.seams}}:undefined;
  const wireframe=privateWire?{positions:privateWire.positions.slice(),packedColor:privateWire.packedColor,lineWidth:this.wireframe!.resolveLineWidth(lineScale),mode:privateWire.mode}:undefined;
  const packedColors=privateColors.slice();
  this.lastDisplay=frameIndex;
  this.rendered={frameIndex,animationTime:this.animationTime,geometry,packedColors,fillEnabled:m.fillEnabled,fillOpacity:m.fillOpacity,wireframe,
   gradient:this.gradient.snapshot(),paletteState:{...this.paletteState},tracked:{index:this.trackingIndex,u:this.tracking[0],v:this.tracking[1],speedU:this.tracking[2],speedV:this.tracking[3],position:[this.trackingPosition[0],this.trackingPosition[1],this.trackingPosition[2]]},
   diagnostics:[...this.color!.diagnostics,...(this.ignoredNames.size?[`原版曲面忽略 ${this.ignoredNames.size} 个未声明参数的写入。`]:[])],workUnits:this.used};
 });}
 /** Buffers are newly owned by each display snapshot. Repeated reads return
  * that same snapshot without copies. Runtime never reads/mutates them again;
  * callers must coordinate mutation/transfer if sharing a snapshot themselves. */
 snapshot():SourceSurfaceMeshRuntimeSnapshot{return this.guarded(()=>{if(!this.rendered)fail('input','原版网格必须先执行显示帧，不能在 snapshot 延迟初始化几何');return this.rendered;});}
}
export function createSourceSurfaceMeshRuntime(options:SourceSurfaceMeshRuntimeOptions){return new SourceSurfaceMeshRuntime(options);}
