import {compileSourceSamilaDirect} from './sourceSamilaGpuDirect';
import {DENSITY_FULLSCREEN_VERTEX_GLSL,DENSITY_PRESENT_VERTEX_GLSL,SAMILA_HISTORY_COPY_GLSL} from './densityGpuShaders';
import {SOURCE_SAMILA_PRESENT_GLSL,sourceSamilaDisplayTransform} from './sourceSamilaPresentation';
import {sourceSamilaNoiseLut,sourceSamilaPaletteLut} from './sourceSamilaSplat';
import {validateSourceSamilaSamplingBatch} from './sourceSamilaSampling';
import type {IteratedFrameJob} from '../scenes/iteratedDensity';
import type {DensityToneJob} from './density';
import type {PreparedSamilaView} from './samilaCamera';
import type {SourceSamilaNativeOperation,SourceSamilaNativeShaders,SourceSamilaNativeUniform} from './sourceSamilaNativeProtocol';
import {validateSourceSamilaNativeDisplay} from './sourceSamilaNativeProtocol';
import {SourceNativeError} from './sourceNativeError';

const f=(name:string,...values:number[]):SourceSamilaNativeUniform=>({name,kind:values.length===1?'float':values.length===2?'vec2':'vec3',count:1,values:new Float32Array(values)});
const i=(name:string,value:number):SourceSamilaNativeUniform=>({name,kind:'int',count:1,values:new Int32Array([value])});
const b=(name:string,value:boolean):SourceSamilaNativeUniform=>({name,kind:'bool',count:1,values:new Int32Array([value?1:0])});
const sampler=(name:string,texture:number):SourceSamilaNativeUniform=>({name,kind:'sampler2d',texture});
export function prepareSourceSamilaNativeProgram(job:IteratedFrameJob):{shaders:SourceSamilaNativeShaders;key:string} {
 if(job.field.kind!=='samila'||job.field.mathModel!=='mathart-1.7.8')throw new SourceNativeError('input','原生 Samila 需要已解析源数学字段');
 const compiled=compileSourceSamilaDirect(job.field,'native'),shaders={historyVertex:DENSITY_FULLSCREEN_VERTEX_GLSL,historyFragment:SAMILA_HISTORY_COPY_GLSL,sampleVertex:compiled.vertex,sampleFragment:compiled.fragment,presentVertex:DENSITY_PRESENT_VERTEX_GLSL,presentFragment:SOURCE_SAMILA_PRESENT_GLSL};
 return{shaders,key:JSON.stringify(shaders)};
}
export function prepareSourceSamilaNativeCreate(job:IteratedFrameJob,resource:string):Extract<SourceSamilaNativeOperation,{kind:'create'}> {return{kind:'create',resource,shaders:prepareSourceSamilaNativeProgram(job).shaders,noise:sourceSamilaNoiseLut(),palette:sourceSamilaPaletteLut(job.palette)};}
/** Current typed production owners supply every value. No captured uniforms,
 * shader rewriting, JSON float round trips or expected intermediate ink. */
export function prepareSourceSamilaNativeDisplay(job:IteratedFrameJob,tone:DensityToneJob,view:PreparedSamilaView|undefined,options:{width:number;height:number;clearInk:boolean;resource:string;expectedIndex:number;paletteChanged:boolean}):Extract<SourceSamilaNativeOperation,{kind:'display'}> {
 const {width,height}=options,field=job.field,projection=job.samilaProjection,splat=job.samilaSplat,batch=job.samilaSampling,history=job.history;
 if(field.kind!=='samila'||!projection||!splat||splat.path!=='points'||!batch||!history||![1,6].includes(history.passes)||tone.model!=='samila-normalized-v2'||!tone.sourcePresentation)throw new SourceNativeError('unsupported','原生 Samila 需要完整 points/采样/历史/呈现合同');
 validateSourceSamilaSamplingBatch(batch,job.config.count,history.passes,job.frame);
 const compiled=compileSourceSamilaDirect(field,'native'),transform=sourceSamilaDisplayTransform(view,width,height),cfg=job.config;
 const operation:Extract<SourceSamilaNativeOperation,{kind:'display'}>={kind:'display',resource:options.resource,expectedIndex:options.expectedIndex,clear:options.clearInk,baseBatch:cfg.count,passes:history.passes as 1|6,seed:batch.frameSeed>>>0,...(options.paletteChanged?{palette:sourceSamilaPaletteLut(job.palette)}:{}),
  history:[sampler('previousInk',0),f('decay',cfg.decay),f('densityCeiling',history.densityCeiling)],
  sample:[...Object.entries(compiled.uniforms).map(([name,value])=>f(name,value)),i('sourceSamilaMode',compiled.selection.modeIndex),i('sourceSamilaProjection',compiled.selection.projectionIndex),i('u_frameSeed',batch.frameSeed|0),i('u_particleCount',batch.sampleCount),f('u_rangeStart',field.lo),f('u_rangeStop',field.hi),f('scale',projection.scaleX,projection.scaleY),f('offset',projection.offsetX,projection.offsetY),f('u_viewportSize',width,height),f('u_aspectRatio',width/height),f('radius',splat.radius),b('u_quadSplat',false),f('alpha',cfg.alpha),f('colorPhase',cfg.colorPhase),b('useLUT',Boolean(cfg.sourcePaletteLut)),sampler('noiseLUT',3),sampler('paletteLUT',2)],
  present:[sampler('ink',0),{name:'origin',kind:'ivec2',count:1,values:new Int32Array([0,0])},b('usePaletteLUT',tone.branch==='palette-average'),f('backgroundRgb',...tone.background),...Object.entries({displayRotation:transform.delta,viewportAspect:transform.aspect,brightness:tone.tone.brightness,contrast:tone.tone.contrast,gamma:tone.tone.gamma,dynamicRange:tone.tone.dynamicRange,saturation:tone.tone.saturation,scale:tone.normalization.scale}).map(([name,value])=>f(name,value))]};
 validateSourceSamilaNativeDisplay(operation,width,height);return operation;
}
