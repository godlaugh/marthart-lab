import type {SceneOutput} from '../types';
import type {SourceFractalDisplayFacts} from './sourceFractalDisplay';
import type {PreparedFractalSourceColor} from './fractalSourceColor';
import type {FractalSourcePlan,FractalSourceReferenceResult} from './fractalSourcePrecision';
import type {PreparedFractalViewportNavigation} from './complexViewport';

/** Shared sampling facts; neither application consumers nor native adapters
 * depend on a concrete WebGL resource owner. All counters are cumulative. */
export interface FractalSourceDiagnostics {
 reference:{builds:number;hits:number};referenceUploads:number;referenceHits:number;
 samples:number;draws:number;rasterDraws:number;rasterAllocations:number;glitches:number;perturbSamples:number;ordinarySteps:number;perturbSteps:number;
 colorSamples:number;colorUploads:number;colorHits:number;retainedCpuBytes:number;retainedGpuBytes:number;estimatedPeakBytes:number;
}
export type FractalSourceExecutionIdentity={backend:'webgl2'}|{backend:'native';renderer:{identity:string;contextSerial:number;sessionSerial:number}};
/** Request-scoped facts accompany delivered pixels. Counters include earlier
 * preview passes of this request; they exclude every previous request. No
 * probe draw or independent CPU repair is part of the source execution path. */
export interface FractalSourceFrameFacts {
 profile:FractalSourcePlan['profile'];formula:FractalSourcePlan['formula'];authoredVariant:string;effectiveVariant:'mandelbrot'|'julia';
 view:PreparedFractalViewportNavigation;
 requestedSize:readonly[number,number];rasterSize:readonly[number,number];logicalSize:FractalSourcePlan['logicalSize'];logicalSizeProvenance:FractalSourcePlan['logicalSizeProvenance'];
 precision:FractalSourcePlan['perturbation']['precision'];perturbationCapability:FractalSourcePlan['perturbation'];
 stopRules:FractalSourcePlan['stopRules'];shaderIterationCap:2048;
 reference:{kind:'ready'|'unavailable';length:number;reason?:string;builds:number;cacheHits:number;uploads:number;textureHits:number};
 execution:FractalSourceExecutionIdentity&{scope:'request-including-preview-passes';samples:number;draws:number;rasterDraws:number;rasterAllocations:number;glitches:number;perturbSamples:number;ordinarySteps:number;perturbSteps:number;cpuOrbitSamples:0;probeSamples:0};
 retained:{cpuBytes:number;gpuBytes:number;ownerPeakEstimatedBytes:number};
 originalRuntimeCompared:false;coloring:'local-shared'|'source-fragment';previewScheduling:'local'|'source-display';
 display?:SourceFractalDisplayFacts;
 color?:{profile:PreparedFractalSourceColor['profile'];samples:number;uploads:number;textureHits:number;lutSize:1024};
}
export function fractalSourceFrameFacts(plan:FractalSourcePlan,view:PreparedFractalViewportNavigation,reference:FractalSourceReferenceResult,requestedSize:readonly[number,number],rasterSize:readonly[number,number],before:FractalSourceDiagnostics|undefined,after:FractalSourceDiagnostics,color?:PreparedFractalSourceColor,display?:SourceFractalDisplayFacts,execution:FractalSourceExecutionIdentity={backend:'webgl2'}):FractalSourceFrameFacts {
 const delta=(key:'samples'|'draws'|'rasterDraws'|'rasterAllocations'|'glitches'|'perturbSamples'|'ordinarySteps'|'perturbSteps'|'referenceUploads'|'referenceHits'|'colorSamples'|'colorUploads'|'colorHits')=>after[key]-(before?.[key]??0);
 return{profile:plan.profile,formula:plan.formula,authoredVariant:plan.authoredVariant,effectiveVariant:plan.isJulia?'julia':'mandelbrot',view,requestedSize,rasterSize,logicalSize:plan.logicalSize,logicalSizeProvenance:plan.logicalSizeProvenance,precision:plan.perturbation.precision,perturbationCapability:plan.perturbation,stopRules:plan.stopRules,shaderIterationCap:plan.maximumShaderIterations,
  reference:{kind:reference.kind,length:reference.length,...(reference.kind==='unavailable'?{reason:reference.reason}:{}),builds:after.reference.builds-(before?.reference.builds??0),cacheHits:after.reference.hits-(before?.reference.hits??0),uploads:delta('referenceUploads'),textureHits:delta('referenceHits')},
  execution:{...execution,scope:'request-including-preview-passes',samples:delta('samples'),draws:delta('draws'),rasterDraws:delta('rasterDraws'),rasterAllocations:delta('rasterAllocations'),glitches:delta('glitches'),perturbSamples:delta('perturbSamples'),ordinarySteps:delta('ordinarySteps'),perturbSteps:delta('perturbSteps'),cpuOrbitSamples:0,probeSamples:0},
  retained:{cpuBytes:after.retainedCpuBytes,gpuBytes:after.retainedGpuBytes,ownerPeakEstimatedBytes:after.estimatedPeakBytes},originalRuntimeCompared:false,coloring:color?'source-fragment':'local-shared',...(color?{color:{profile:color.profile,samples:delta('colorSamples'),uploads:delta('colorUploads'),textureHits:delta('colorHits'),lutSize:color.lutSize}}:{}),previewScheduling:display?'source-display':'local',...(display?{display}:{})};
}

/** Validate execution identity at recording and client publication boundaries.
 * Native facts require the actual transport-confirmed renderer identity. */
export function validFractalSourceExecution(output:SceneOutput):boolean {
 if(output.type!=='raster'||!output.fractalRender)return false;
 const execution=output.fractalRender.execution;
 if(execution?.backend==='webgl2')return output.backend===undefined||output.backend==='webgl2';
 if(execution?.backend!=='native'||output.backend!=='native')return false;
 const renderer=execution.renderer,pixel=output.sourcePixelRenderer;
 return !!renderer&&/^[a-f0-9]{64}$/.test(renderer.identity)&&Number.isSafeInteger(renderer.contextSerial)&&renderer.contextSerial>0&&Number.isSafeInteger(renderer.sessionSerial)&&renderer.sessionSerial>0&&pixel?.backend==='native'&&pixel.identity===renderer.identity&&Number.isSafeInteger(pixel.generation)&&pixel.generation>0&&Number.isSafeInteger(pixel.sequence)&&pixel.sequence>0;
}
