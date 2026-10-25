import type {DensityBounds,DensityProjection} from '../types';
import type {IteratedFrameJob} from '../scenes/iteratedDensity';
import type {DensityToneJob} from './density';
import {isCapturedDensityView,validateDensityView,type PreparedDensityView} from './densityPresentation';
import {gpuShaderHeader,type GpuShaderProfile} from './gpuShaderProfile';
import {iteratedDensityGpuPrograms} from './iteratedDensityGpuPrograms';
import {DENSITY_PRESENT_VERTEX_GLSL} from './densityGpuShaders';
import {sourceIteratedBrightnessUniform,sourceIteratedPresentGlsl} from './sourceIteratedPresentation';
import {sourceDensityPointDiameter} from './sourceDensitySplat';
import {sourceSymmetryPaletteLut} from './sourceSymmetryPalette';
import {paletteBaseColor} from './palette';
import {createNoisePermutation} from '../scenes/noise';

/** Prepared render inputs, not a transport ABI. Sampler units refer to the
 * caller's owned textures; neither scene settings nor captured uniforms enter. */
export type SourceIteratedRenderUniform=
 |{name:string;kind:'float'|'int'|'bool'|'vec2'|'vec3'|'vec4'|'ivec2'|'mat4';values:number[]}
 |{name:string;kind:'sampler2d'|'usampler2d';texture:number};
const F=Math.fround;
const require=(condition:boolean,message:string)=>{if(!condition)throw Error(message);};
const finite32=(value:number)=>Number.isFinite(value)&&Number.isFinite(F(value));
function value(name:string,kind:Extract<SourceIteratedRenderUniform,{values:number[]}>['kind'],...values:number[]):SourceIteratedRenderUniform {
 require(values.every(finite32),'源迭代绘制 uniform 超出 Float32');
 const result={name,kind,values:kind==='int'||kind==='bool'||kind==='ivec2'?values:values.map(F)};Object.freeze(result.values);return Object.freeze(result);
}
const sampler=(name:string,kind:'sampler2d'|'usampler2d',texture:number):SourceIteratedRenderUniform=>Object.freeze({name,kind,texture});
const freeze=(values:SourceIteratedRenderUniform[])=>Object.freeze(values);
const PALETTE_INTERVALS=4096;
export interface SourceIteratedDrawTarget {width:number;height:number;stateWidth:number;projection:DensityProjection;bounds:DensityBounds;}
/** RGB/mass channel order is the production accumulation representation. State
 * texture padding is ignored by count; metadata is invalid-count/validity-bit. */
export const SOURCE_ITERATED_RENDER_LAYOUT=Object.freeze({
 states:Object.freeze({format:'rgba32f',channels:['x','y','z','metric'],unit:0,filter:'nearest',wrap:'clamp-to-edge'}),
 counters:Object.freeze({format:'rg32ui',channels:['invalid','validity'],unit:1,filter:'nearest',wrap:'clamp-to-edge'}),
 ink:Object.freeze({format:'rgba32f',channels:['red-mass','green-mass','blue-mass','mass'],origin:'bottom-left',clear:[0,0,0,0]}),
 noise:Object.freeze({format:'r8ui',width:256,height:1,unit:3,filter:'nearest',wrap:'clamp-to-edge'}),
 chunkSize:65536,
});
export function prepareSourceIteratedDrawPlan(job:IteratedFrameJob,target:SourceIteratedDrawTarget){
 require(job.kind==='symmetry'&&job.densitySplat?.model==='symmetry-splat-1.7.8'&&!job.samilaSplat&&!job.samilaProjection,'共享源绘制计划需要已准备的 Symmetry 散点');
 const {width,height,stateWidth,projection,bounds:b}=target,cfg=job.config,t=job.transform,splat=job.densitySplat!;
 require([width,height,stateWidth].every(n=>Number.isInteger(n)&&n>0&&n<=16384)&&Number.isInteger(cfg.count)&&cfg.count>0&&cfg.count<=8_000_000,'源迭代绘制尺寸或粒子数无效');
 require([b.minX,b.maxX,b.minY,b.maxY].every(finite32)&&F(b.maxX)>F(b.minX)&&F(b.maxY)>F(b.minY)&&finite32(F(b.maxX)-F(b.minX))&&finite32(F(b.maxY)-F(b.minY)),'GPU 视口在 float32 中退化');
 const axes={xy:[0,1],xz:[0,2],yz:[1,2]}[projection];require(Boolean(axes),'GPU 投影无效');
 const transform=[value('scale','vec3',t.sx,t.sy,t.sz),value('offset','vec3',t.ox,t.oy,t.oz),value('turn','vec2',t.co,t.si),value('axes','ivec2',...axes),value('samilaNdc','int',0),value('samilaOffset','vec2',0,0),value('samilaAspect','float',width/height),value('capturedCamera','int',job.sourceCamera?1:0)];
 if(job.sourceCamera){require(job.sourceCamera.anchor.family==='symmetry','源密度相机与模型不匹配');for(const [name,matrix]of [['capturedProjection',job.sourceCamera.anchor.projection],['capturedModelView',job.sourceCamera.anchor.modelView]]as const){require(matrix.columnMajor.length===16,'源密度投影矩阵无效');transform.push(value(name,'mat4',...matrix.columnMajor));}}
 // GL initializes uniforms to zero. These matrices are unused when
 // capturedCamera=0, but strict native linked-ABI validation still needs them.
 // WebGL staged bindings preserve the historical omission and call order.
 const inactiveCameraUniforms=job.sourceCamera?[]:[value('capturedProjection','mat4',...Array(16).fill(0)),value('capturedModelView','mat4',...Array(16).fill(0))];
 const sharedUniforms=freeze([...transform,value('bounds','vec4',b.minX,b.maxX,b.minY,b.maxY)]);
 const statsSetupUniforms=freeze([...sharedUniforms,value('size','ivec2',width,height),value('radius','float',sourceDensityPointDiameter(splat)/2-.5),value('recording','int',cfg.record?1:0),value('sourcePointClip','int',splat.path==='points'?1:0)]);
 // The reducer adds its owned sourceSize at each level. All other bindings are
 // self-contained; the WebGL adapter retains its existing staged binding order.
 const statsUniforms=freeze([sampler('states','sampler2d',0),sampler('counters','usampler2d',1),value('count','int',cfg.count),...statsSetupUniforms,...inactiveCameraUniforms]);
 const beforeTextures=freeze([...sharedUniforms,value('size','ivec2',width,height),value('count','int',cfg.count),value('radius','float',splat.path==='points'?sourceDensityPointDiameter(splat):splat.radius),value('densitySplat','bool',1),value('mapCosine','bool',0),value('quadSplat','bool',splat.path==='quad'?1:0),value('usePaletteLut','bool',cfg.sourcePaletteLut?1:0),value('alpha','float',cfg.alpha),value('metricMin','float',cfg.metricMin),value('metricMax','float',cfg.metricMax),value('metricRange','float',cfg.metricMax-cfg.metricMin),value('metricMode','int',cfg.metricMode==='robust'?1:0),value('colorMode','int',['step','index','radius','angle','height','noise'].indexOf(cfg.color)),value('colorSpeed','float',cfg.colorSpeed),value('colorPhase','float',cfg.colorPhase),value('paletteCycles','float',job.palette.cycles),value('paletteOffset','float',job.palette.offset)]);
 const sourcePalette=job.symmetryPalette?.model==='source-rgb1024',paletteUniforms=freeze([sampler('palette','sampler2d',2),value('symmetryLut','bool',sourcePalette?1:0)]),noiseUniforms=freeze([sampler('noisePermutation','usampler2d',3)]),stateUniforms=freeze([sampler('states','sampler2d',0),sampler('counters','usampler2d',1),value('stateWidth','int',stateWidth)]);
 const palette=structuredClone(job.palette),frame=job.symmetryPalette?.model==='source-rgb1024'?structuredClone(job.symmetryPalette.frame):undefined;
 const {name:ignoredName,offset,cycles,...base}=palette,format=sourcePalette?'source-rgb1024' as const:'local-rgba4097' as const;
 const key=JSON.stringify([format,sourcePalette?{...base,offset,cycles}:base,frame]);
 return Object.freeze({family:'symmetry' as const,sourceSplatProgram:sourcePalette&&cfg.color==='step'?splat.path:undefined,width,height,count:cfg.count,stateWidth,stateHeight:Math.ceil(cfg.count/stateWidth),sharedUniforms,statsUniforms,statsSetupUniforms,beforeTextures,paletteUniforms,noiseUniforms,stateUniforms,
  drawUniforms:freeze([...beforeTextures,...paletteUniforms,...noiseUniforms,...stateUniforms,value('particleOffset','int',0),...inactiveCameraUniforms]),
  palette:Object.freeze({key,format,width:sourcePalette?1024:4097,height:1,unit:2,internalFormat:sourcePalette?'rgb32f' as const:'rgba32f' as const,filter:sourcePalette?'linear' as const:'nearest' as const,wrapS:sourcePalette?'repeat' as const:'clamp-to-edge' as const,wrapT:'clamp-to-edge' as const,createValues:():Float32Array=>{
   if(sourcePalette)return sourceSymmetryPaletteLut(palette,frame);const colors=new Float32Array((PALETTE_INTERVALS+1)*4);for(let i=0;i<=PALETTE_INTERVALS;i++){colors.set(paletteBaseColor(palette,i/PALETTE_INTERVALS),i*4);colors[i*4+3]=1;}return colors;
  }}),noisePermutation:createNoisePermutation(cfg.seed),primitive:splat.path==='points'?'points' as const:'triangles' as const,verticesPerInstance:splat.path==='points'?1:6,chunkSize:SOURCE_ITERATED_RENDER_LAYOUT.chunkSize,
  record:cfg.record,decay:F(cfg.decay),blend:Object.freeze({equation:'add',source:'one',destination:'one'}),layout:SOURCE_ITERATED_RENDER_LAYOUT});
}
export type SourceIteratedDrawPlan=ReturnType<typeof prepareSourceIteratedDrawPlan>;

/** Header-free original reduction body. Native and WebGL use the same uint
 * occupied/max-count/invalid aggregation; only the shader preamble differs. */
export const SOURCE_DENSITY_PRESENT_REDUCTION_GLSL=`
uniform usampler2D values;uniform ivec2 size,reductionOrigin;out uvec4 total;
void main(){ivec2 base=ivec2(gl_FragCoord.xy)*4;uvec4 r=uvec4(0);for(int y=0;y<4;y++)for(int x=0;x<4;x++){ivec2 p=base+ivec2(x,y);if(p.x<size.x&&p.y<size.y){uvec4 v=texelFetch(values,p+reductionOrigin,0);r.x+=v.x;r.y=max(r.y,v.y);r.z|=v.z;r.w|=v.w;}}total=r;}`;
interface RenderProgram {vertex:string;fragment:string;}
export interface SourceIteratedRenderPrograms {draw:RenderProgram;statsFirst:RenderProgram;statsReduce:RenderProgram;present:RenderProgram;presentReduce:RenderProgram;decay:RenderProgram;}
const programCache=new Map<string,SourceIteratedRenderPrograms>();
export function sourceIteratedRenderPrograms(profile:GpuShaderProfile,family:'symmetry'|'map'='symmetry',sourceSplat?:'points'|'quad'):SourceIteratedRenderPrograms {
 const key=profile+':'+family+':'+(sourceSplat??'generic'),cached=programCache.get(key);if(cached)return cached;
 const programs=iteratedDensityGpuPrograms(profile),header=gpuShaderHeader(profile,'precision highp float;precision highp int;precision highp sampler2D;precision highp usampler2D;\n');
 const result={draw:{vertex:programs.DRAW_VERTEX,fragment:sourceSplat==='points'?programs.SOURCE_DENSITY_POINTS_FRAGMENT:sourceSplat==='quad'?programs.SOURCE_DENSITY_QUAD_FRAGMENT:programs.DRAW_FRAGMENT},statsFirst:{vertex:programs.QUAD,fragment:programs.STATS_FIRST},statsReduce:{vertex:programs.QUAD,fragment:programs.STATS_REDUCE},present:{vertex:header+DENSITY_PRESENT_VERTEX_GLSL,fragment:header+sourceIteratedPresentGlsl(family)},presentReduce:{vertex:programs.QUAD,fragment:header+SOURCE_DENSITY_PRESENT_REDUCTION_GLSL},decay:{vertex:programs.QUAD,fragment:programs.EMPTY}};
 for(const program of Object.values(result))Object.freeze(program);Object.freeze(result);programCache.set(key,result);return result;
}
export function prepareSourceIteratedPresentPlan(job:DensityToneJob,width:number,height:number,view?:PreparedDensityView){
 const family=job.sourceMapPresentation?'map':job.sourceSymmetryPresentation?'symmetry':undefined;
 require(Boolean(family)&&!job.sourcePresentation&&!(job.sourceMapPresentation&&job.sourceSymmetryPresentation)&&job.model==='normalized-v2','源迭代呈现身份无效');
 if(job.model!=='normalized-v2'||!family)throw Error('源迭代呈现归一事实缺失');
 const facts=family==='map'?job.sourceMapPresentation!:job.sourceSymmetryPresentation!;
 require(facts.model===`${family}-present-1.7.8`&&facts.stage==='scene-target-rgba8'&&facts.display==='opaque-rgb-copy'&&job.normalization.kind===family,'源迭代呈现身份与归一事实不匹配');
 require([width,height].every(n=>Number.isInteger(n)&&n>0&&n<=16384)&&width*height<=33554432,'源密度呈现尺寸超出 128 MiB 输出限制');
 if(view){validateDensityView(view,width,height);require(isCapturedDensityView(view)&&view.family===family,'源迭代密度呈现相机类型不匹配');}
 const rotation=view&&isCapturedDensityView(view)?view.rotation:0,clear=job.sceneBackground??[...job.background,1];
 require(clear.length===4&&Array.from(clear).every(v=>finite32(v)&&v>=0&&v<=1),'源密度呈现缺少有效场景清屏 RGBA');
 require(family!=='map'||Boolean(job.sceneBackground),'源 Map 呈现缺少有效场景清屏 RGBA');
 const setupUniforms=freeze([sampler('ink','sampler2d',0),value('usePaletteLUT','int',0),value('backgroundRgb','vec3',...job.background),...Object.entries({displayRotation:rotation,viewportAspect:F(width/height),brightness:sourceIteratedBrightnessUniform(job.tone.brightness),contrast:job.tone.contrast,gamma:job.tone.gamma,dynamicRange:job.tone.dynamicRange,saturation:job.tone.saturation,scale:job.normalization.scale}).map(([name,n])=>value(name,'float',n))]);
 const originUniform=value('origin','ivec2',0,0),uniforms=freeze([...setupUniforms,originUniform]);
 return Object.freeze({family,width,height,uniforms,setupUniforms,originUniform,clear:Float32Array.from(clear),filter:family==='map'?'nearest' as const:'linear' as const,
  output:'rgba8' as const,statistics:'rgba32ui' as const,primitive:'triangle-strip' as const,vertexCount:4,blend:Object.freeze({equation:'add',source:'src-alpha',destination:'one-minus-src-alpha'}),readbackOrigin:'top-left' as const,invalidInk:'reject' as const,display:'opaque-rgb-copy' as const});
}
/** The WebGL consumer binds the same records at its existing texture/target
 * boundaries. No shader parsing, capture-derived names, or GL resource lookup. */
export function applySourceIteratedRenderUniforms(gl:WebGL2RenderingContext,location:(name:string)=>WebGLUniformLocation|null,uniforms:readonly SourceIteratedRenderUniform[]):void {
 for(const u of uniforms){const at=location(u.name);if('texture'in u){gl.uniform1i(at,u.texture);continue;}const v=u.values;switch(u.kind){
  case 'float':gl.uniform1f(at,v[0]);break;case 'int':case 'bool':gl.uniform1i(at,v[0]);break;
  case 'vec2':gl.uniform2f(at,v[0],v[1]);break;case 'vec3':gl.uniform3f(at,v[0],v[1],v[2]);break;case 'vec4':gl.uniform4f(at,v[0],v[1],v[2],v[3]);break;
  case 'ivec2':gl.uniform2i(at,v[0],v[1]);break;case 'mat4':gl.uniformMatrix4fv(at,false,v);break;
 }}
}
