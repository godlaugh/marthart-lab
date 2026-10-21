/** The actual GenericSymmetryChaosScene dispatch, in call order. The base
 * call uses active dt; the subclass call uses raw dt and continues after the
 * queue completes. Parameter snapshots belong to each call, not just display. */
export interface SourceSymmetryObjectUpdate {readonly time:number;readonly deltaTime:number;readonly parameters?:Readonly<Record<string,number>>;}
export interface SourceSymmetryUpdateEvent {readonly frameIndex:number;readonly calls:readonly SourceSymmetryObjectUpdate[];}
export interface SourceSymmetryFramePlan {
 readonly model:'symmetry-frame-1.7.8';readonly phase?:'replay';readonly frameIndex:number;readonly objectUpdates:number;
 readonly warmupSteps:number;readonly iterationSteps:number;readonly warmupApplied:boolean;
}
export function prepareSourceSymmetryFramePlan(event:{frameIndex:number;updateCount:number},warmupApplied:boolean,burnIn:number,iterations:number):SourceSymmetryFramePlan {
 if(!event||!Number.isSafeInteger(event.frameIndex)||event.frameIndex<0||!Number.isInteger(event.updateCount)||event.updateCount<0||event.updateCount>2||typeof warmupApplied!=='boolean')throw Error('Symmetry 源对象更新事件无效');
 if(!Number.isSafeInteger(burnIn)||burnIn<0||burnIn>100000||!Number.isSafeInteger(iterations)||iterations<1||iterations>16)throw Error('Symmetry 源更新步数无效');
 return{model:'symmetry-frame-1.7.8',frameIndex:event.frameIndex,objectUpdates:event.updateCount,warmupSteps:event.updateCount>0&&!warmupApplied?burnIn:0,iterationSteps:event.updateCount*iterations,warmupApplied:warmupApplied||event.updateCount>0};
}

/** Replay's update passes belong to display, not Scene.update. Zero iterations
 * is needed after all draw passes finish while burn-in is still outstanding. */
export function prepareSourceSymmetryReplayFrame(frameIndex:number,burnIn:number,iterations:number):SourceSymmetryFramePlan {
 if(!Number.isSafeInteger(frameIndex)||frameIndex<0||!Number.isSafeInteger(burnIn)||burnIn<0||burnIn>100000||!Number.isSafeInteger(iterations)||iterations<0||iterations>16)throw Error('Symmetry 重播 GPU 阶段无效');
 return{model:'symmetry-frame-1.7.8',phase:'replay',frameIndex,objectUpdates:0,warmupSteps:burnIn,iterationSteps:iterations,warmupApplied:false};
}
