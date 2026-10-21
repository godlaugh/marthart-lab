import type {DomainIterationVersion} from './domainSourceIteration';
import type {DomainColorVersion} from './domainSourceColor';
import type {DomainViewportVersion,PreparedDomainViewport} from './domainViewport';
import type {DomainGpuFailureFacts} from './domainGpuFailure';

/** Absence keeps the saved-document contract that predates whole-chain recovery. */
export type DomainRenderPolicy='selected-rules-1723'|'source-cpu-on-gpu-failure-v1'|'source-cpu-always-v1';
export function parseDomainRenderPolicy(value:unknown):DomainRenderPolicy {
 if(value===undefined||value==='selected-rules-1723')return 'selected-rules-1723';
 if(value==='source-cpu-on-gpu-failure-v1'||value==='source-cpu-always-v1')return value;
 throw new Error('域着色渲染恢复策略无效');
}
export interface DomainRenderRules {
 readonly formula:DomainIterationVersion;
 readonly color:DomainColorVersion;
 readonly viewport:DomainViewportVersion;
}
/** Facts of one delivered frame, never settings and never persisted in a project.
 * A GPU version with a CPU backend denotes its staged CPU reference. */
export interface DomainRenderFacts {
 readonly policy:DomainRenderPolicy;
 readonly requested:DomainRenderRules & {readonly backend:'auto'|'cpu'|'gpu'};
 readonly effective:DomainRenderRules & {readonly backend:'cpu'|'webgl2'};
 readonly route:'selected'|'source-cpu-failure'|'source-cpu-forced';
 readonly trigger?:DomainGpuFailureFacts;
 /** True when this request reused a previously observed failure. */
 readonly sticky:boolean;
 readonly view:PreparedDomainViewport;
 readonly constant:[number,number];
 readonly sourceConstantUpload?:boolean;
 /** Numerical clock that produced these pixels. Fixed replay selects a display
  * ordinal. With domainLive, displayFrame is the retained update ordinal and
  * simulationFps is only the document's local replay rate; rawDt and
  * parameterFps report the independent inputs actually used by that host. */
 readonly sourceClock?:{readonly displayFrame:number;readonly simulationFps:number;readonly parameterFps:number;readonly sceneTime:number;readonly rawDt:number;readonly activeDt:number;readonly queueIndex:number;readonly queueComplete:boolean;readonly rotationRate:number;readonly paletteOffset:number};
}
