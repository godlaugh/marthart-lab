import type {DensityToneJob} from './density';
import type {PreparedSamilaView} from './samilaCamera';
import type {SourceSamilaDisplayBudget,SourceSamilaDisplayResult,SourceSamilaPreparedDisplay} from './sourceSamilaSession';

/** Fixed-frame replay owns its clock, tape and history. This boundary owns only
 * a separate retained renderer resource; it must never abort shared transport. */
export interface IteratedDensityPreparedPresent {
 readonly tone:DensityToneJob;
 readonly view:PreparedSamilaView;
 readonly width:number;
 readonly height:number;
}
export type IteratedDensityAsyncStepResult=Pick<SourceSamilaDisplayResult,'facts'|'sourcePixelRenderer'>;
export type IteratedDensityAsyncPresentResult=Pick<SourceSamilaDisplayResult,'shown'|'sourcePixelRenderer'>;
export interface IteratedDensityAsyncBackend {
 admitDisplay(budget:SourceSamilaDisplayBudget):void;
 draw(display:SourceSamilaPreparedDisplay):Promise<IteratedDensityAsyncStepResult>;
 present(prepared:IteratedDensityPreparedPresent):Promise<IteratedDensityAsyncPresentResult>;
 /** Exact, idempotent release. Failed cleanup retains ownership for retry. */
 reset():Promise<void>;
 diagnostics?():unknown;
}
