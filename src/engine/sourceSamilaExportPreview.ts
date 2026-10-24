/** A dialog leases an already paused preview; it does not own or recreate ink.
 * Input identity follows the App's generation effect, including its RAF tick.
 * One input scheduled before opening may still need to reach the queue. */
const same=(a:readonly unknown[]|undefined,b:readonly unknown[])=>!!a&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));
export class SourceSamilaExportPreview {
 private submitted?:readonly unknown[];
 private held?:{token:object;openingSubmitted:boolean;deferred:boolean};
 get active(){return !!this.held;}
 open(input:readonly unknown[]):object {
  if(this.held)throw Error('Samila 导出已占用当前预览');
  const token={};this.held={token,openingSubmitted:same(this.submitted,input),deferred:false};return token;
 }
 owns(token:object){return this.held?.token===token;}
 /** Called before changing any queue/presentation state. True means the
  * latest input is remembered by React and must wait until the dialog closes. */
 defer(input:readonly unknown[]):boolean {
  const held=this.held;
  if(!held){this.submitted=[...input];return false;}
  // React may coalesce a resize into the reserved RAF input before its effect
  // runs. Complete that one pending request before declaring export ready.
  if(!held.openingSubmitted){
   held.openingSubmitted=true;this.submitted=[...input];held.deferred=false;return false;
  }
  held.deferred=!same(this.submitted,input);return true;
 }
 /** No deferred change means no redraw/seed merely from closing the dialog. */
 close():boolean {const deferred=this.held?.deferred??false;this.held=undefined;return deferred;}
}
