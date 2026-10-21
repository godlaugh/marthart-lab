/** Scene.update calls Mobject.update only if its queue was unfinished at frame
 * start. A zero active dt still calls the object; display is a separate event. */
export interface SourceSymmetryUpdateEvent {readonly frameIndex:number;readonly updated:boolean;}
export interface SourceSymmetryFramePlan {
 readonly model:'symmetry-frame-1.7.8';readonly phase?:'replay';readonly frameIndex:number;readonly objectUpdated:boolean;
 readonly warmupSteps:number;readonly iterationSteps:number;readonly warmupApplied:boolean;
}
export function prepareSourceSymmetryFramePlan(event:SourceSymmetryUpdateEvent,warmupApplied:boolean,burnIn:number,iterations:number):SourceSymmetryFramePlan {
 if(!event||!Number.isSafeInteger(event.frameIndex)||event.frameIndex<0||typeof event.updated!=='boolean'||typeof warmupApplied!=='boolean')throw Error('Symmetry 源对象更新事件无效');
 if(!Number.isSafeInteger(burnIn)||burnIn<0||burnIn>100000||!Number.isSafeInteger(iterations)||iterations<1||iterations>16)throw Error('Symmetry 源更新步数无效');
 return{model:'symmetry-frame-1.7.8',frameIndex:event.frameIndex,objectUpdated:event.updated,warmupSteps:event.updated&&!warmupApplied?burnIn:0,iterationSteps:event.updated?iterations:0,warmupApplied:warmupApplied||event.updated};
}

/** Replay's update passes belong to display, not Scene.update. Zero iterations
 * is needed after all draw passes finish while burn-in is still outstanding. */
export function prepareSourceSymmetryReplayFrame(frameIndex:number,burnIn:number,iterations:number):SourceSymmetryFramePlan {
 if(!Number.isSafeInteger(frameIndex)||frameIndex<0||!Number.isSafeInteger(burnIn)||burnIn<0||burnIn>100000||!Number.isSafeInteger(iterations)||iterations<0||iterations>16)throw Error('Symmetry 重播 GPU 阶段无效');
 return{model:'symmetry-frame-1.7.8',phase:'replay',frameIndex,objectUpdated:false,warmupSteps:burnIn,iterationSteps:iterations,warmupApplied:false};
}
