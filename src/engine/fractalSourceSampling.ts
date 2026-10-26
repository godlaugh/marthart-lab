import type {FractalConfig} from '../scenes/complex';
import type {GpuOrbitBatch} from './fractalGpu';
import type {FractalSourcePlan,FractalSourceReferenceCache,FractalReferenceBuildOptions} from './fractalSourcePrecision';
import type {PreparedFractalSourceColor} from './fractalSourceColor';
import type {SourceFractalDisplayFacts} from './sourceFractalDisplay';
import type {FractalSourceDiagnostics,FractalSourceExecutionIdentity} from './fractalSourceFrame';
import type {RasterOutput} from '../types';

export interface FractalSourceSampleRequest {
 readonly points:Float32Array;readonly width:number;readonly height:number;
 readonly config:FractalConfig;readonly plan:FractalSourcePlan;
 readonly colorPlan:PreparedFractalSourceColor;readonly display?:SourceFractalDisplayFacts;
 readonly isCancelled?:()=>boolean;
 /** Actual caller-owned image backing storage held during this sample. */
 readonly additionalBytes:number;
}
export type FractalSourceSampleAdmission=Omit<FractalSourceSampleRequest,'points'> & {readonly sampleCount:number};
/** One resource owner per live or independent recording session. The shared
 * generator owns sample selection and output assembly; this effect owns only
 * execution, transport, reference caching and actual execution diagnostics. */
export interface FractalSourceAsyncSampler {
 readonly maximumSamples:number;
 prepareReference(plan:FractalSourcePlan,options?:FractalReferenceBuildOptions & {additionalBytes?:number}):ReturnType<FractalSourceReferenceCache['prepare']>;
 /** Admit the complete prospective image and largest batch before allocation. */
 admit(request:FractalSourceSampleAdmission):void;
 sample(request:FractalSourceSampleRequest):Promise<GpuOrbitBatch>;
 diagnostics():FractalSourceDiagnostics;
 execution():Extract<FractalSourceExecutionIdentity,{backend:'native'}>;
 pixelRenderer():NonNullable<RasterOutput['sourcePixelRenderer']>;
 dispose():Promise<void>;
}
