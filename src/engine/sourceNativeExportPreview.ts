/** A dialog leases an already paused preview. Retained live ink stays owned;
 * deterministic native Attractor replay may explicitly lend its GPU resource.
 * Input identity follows the App's generation effect, including its RAF tick.
 * One input scheduled before opening may still need to reach the queue. */
const same=(a:readonly unknown[]|undefined,b:readonly unknown[])=>!!a&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));
interface PreviewRelease {
 run:()=>Promise<void>;
 phase:'waiting'|'releasing'|'released'|'failed';
 pending?:Promise<void>;
 error?:unknown;
}
interface FixedPreviewInput {scope:object;time:number;}
interface HeldPreview {token:object;openingSubmitted:boolean;openingFixed?:FixedPreviewInput;deferred:boolean;release?:PreviewRelease;closing?:{pending?:Promise<boolean>};}
export class SourceNativeExportPreview {
 private submitted?:readonly unknown[];
 private reservedFixed?:FixedPreviewInput;
 private held?:HeldPreview;
 get active(){return !!this.held;}
 get requiresRelease(){return !!this.held?.release;}
 get closing(){return !!this.held?.closing?.pending;}
 get ready(){const held=this.held;return !!held&&!held.closing&&(!held.release||held.release.phase==='released');}
 /** Record the issued fixed-time input synchronously, before React commits.
  * This is request identity only; this owner never advances or rounds time. */
 reserveFixedInput(scope:object,time:number){this.reservedFixed={scope,time};}
 open(input:readonly unknown[],options?:{releasePreview?:()=>Promise<void>;fixedInput?:FixedPreviewInput}):object {
  if(this.held)throw Error('原生场景导出已占用当前预览');
  const reserved=this.reservedFixed?.scope===options?.fixedInput?.scope?this.reservedFixed:undefined;
  const token={};this.held={token,openingSubmitted:!reserved&&same(this.submitted,input),openingFixed:reserved??options?.fixedInput,deferred:false,...(options?.releasePreview?{release:{run:options.releasePreview,phase:'waiting' as const}}:{})};return token;
 }
 owns(token:object){return this.held?.token===token;}
 /** Called before changing any queue/presentation state. True means the
  * latest input is remembered by React and must wait until the dialog closes. */
 defer(input:readonly unknown[],fixedInput?:FixedPreviewInput):boolean {
  const held=this.held;
  if(!held){this.submitted=[...input];this.submittedFixed(fixedInput);return false;}
  // React may coalesce a resize into the reserved RAF input before its effect
  // runs. Complete that one pending request before declaring export ready.
  if(!held.openingSubmitted){
   // A passive effect for the previous React commit may run after a RAF has
   // reserved a newer time. It cannot consume that newer opening request.
   if(held.openingFixed&&fixedInput?.scope===held.openingFixed.scope&&!Object.is(fixedInput.time,held.openingFixed.time))return true;
   held.openingSubmitted=true;this.submitted=[...input];this.submittedFixed(fixedInput);held.deferred=false;return false;
  }
  held.deferred=!same(this.submitted,input);return true;
 }
 private submittedFixed(input:FixedPreviewInput|undefined){
  if(!input||this.reservedFixed?.scope!==input.scope||Object.is(this.reservedFixed.time,input.time))this.reservedFixed=undefined;
 }
 private release(held:HeldPreview,retry=false):Promise<void> {
  const release=held.release;
  if(!release||release.phase==='released')return Promise.resolve();
  if(release.pending)return release.pending;
  if(release.phase==='failed'&&!retry)return Promise.reject(release.error);
  release.phase='releasing';
  const attempt=Promise.resolve().then(release.run).then(()=>{release.phase='released';release.error=undefined;},error=>{release.phase='failed';release.error=error;throw error;});
  const pending=attempt.finally(()=>{if(release.pending===pending)release.pending=undefined;});release.pending=pending;return pending;
 }
 /** Called only after the already reserved input has completed presentation.
  * Pixels remain with the viewport; readiness requires the exact release ACK. */
 async preparePresented():Promise<boolean> {
  const held=this.held;if(!held||held.closing||!held.openingSubmitted)return false;
  await this.release(held);return this.held===held&&!held.closing;
 }
 private finishClose(held:HeldPreview):boolean {
  if(this.held!==held)return false;
  const redraw=held.deferred||held.release?.phase==='released';this.held=undefined;return redraw;
 }
 /** No release or deferred change means no redraw/seed from closing. */
 close():boolean {
  const held=this.held;if(!held)return false;
  if(held.release&&held.release.phase!=='waiting'||held.closing)throw Error('原生预览资源交接尚需等待清理');
  return this.finishClose(held);
 }
 /** Keep the dialog lease through pending/failed preview release and export
  * cleanup. Failure retains both ownership and the explicit close retry. */
 closeAfterCleanup(cleanup:()=>Promise<void>):Promise<boolean> {
  const held=this.held;if(!held)return Promise.resolve(false);
  if(held.closing?.pending)return held.closing.pending;
  const closing=held.closing??(held.closing={});
  const attempt=Promise.resolve().then(async()=>{
   if(held.release&&held.release.phase!=='waiting')await this.release(held,true);
   await cleanup();return this.finishClose(held);
  });
  const pending=attempt.finally(()=>{if(closing.pending===pending)closing.pending=undefined;});closing.pending=pending;return pending;
 }
}
