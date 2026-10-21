import type {SourceDomainSceneClip} from './sourceDomainSceneRuntime';

/** Parameter/gradient children make an AnimationGroup's duration nonnegative.
 * A rotation-only animation and a wait retain their signed Float32 duration.
 * Runtime, timeline layout and recording planning consume this same rule. */
export function sourceDomainQueueDuration(clip:SourceDomainSceneClip):number {
 const duration=Math.fround(clip.duration);
 return clip.kind==='animate'&&(clip.parameters?.length||clip.gradients?.length)?Math.max(0,duration):duration;
}
