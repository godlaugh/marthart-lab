import type {DensityToneJob} from './density';
import type {PreparedSamilaView} from './samilaCamera';
import type {SourceSamilaDisplayBudget,SourceSamilaDisplayResult,SourceSamilaPreparedDisplay} from './sourceSamilaSession';
import type {SourceIteratedReplayAsyncBackend} from './sourceIteratedReplayBackend';

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
interface IteratedDensityAsyncOwner {
 /** Exact, idempotent release. Failed cleanup retains ownership for retry. */
 reset():Promise<void>;
 diagnostics?():unknown;
}
export interface IteratedDensitySamilaAsyncBackend extends IteratedDensityAsyncOwner {
 readonly kind:'samila';
 admitDisplay(budget:SourceSamilaDisplayBudget):void;
 draw(display:SourceSamilaPreparedDisplay):Promise<IteratedDensityAsyncStepResult>;
 present(prepared:IteratedDensityPreparedPresent):Promise<IteratedDensityAsyncPresentResult>;
}
/** Map/Symmetry consume the same prepared frame and view as synchronous replay.
 * They do not need Samila's sampling tape or its per-display presentation. */
export interface IteratedDensitySourceAsyncBackend extends IteratedDensityAsyncOwner,Pick<SourceIteratedReplayAsyncBackend,'step'|'present'> {
 readonly kind:'source-iterated';
 estimateWork:NonNullable<SourceIteratedReplayAsyncBackend['estimateWork']>;
}
export type IteratedDensityAsyncBackend=IteratedDensitySamilaAsyncBackend|IteratedDensitySourceAsyncBackend;
