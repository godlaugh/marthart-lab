import {Generator} from './client';
import {symmetryCustomExecutionBackend} from './symmetryCustomExecution';
import {symmetryCustomValidationInput} from './symmetryEditing';
import type {SceneDocument} from '../types';

export interface SymmetryCustomValidation {readonly promise:Promise<void>;cancel():void;}

// Validation owners outlive editor components until release is acknowledged.
// Failed release remains reachable and must be retried before another candidate.
const retiring=new Map<Generator,Promise<void>|undefined>();
function release(owner:Generator):Promise<void>{
 const pending=retiring.get(owner);if(pending)return pending;
 owner.dispose();retiring.set(owner,undefined);
 const attempt=Promise.resolve().then(()=>owner.settledNativeCleanup());
 const tracked=attempt.then(()=>{retiring.delete(owner);},error=>{retiring.set(owner,undefined);throw error;});
 retiring.set(owner,tracked);return tracked;
}

/** Execute a real first frame and retire its independent GPU owner before the
 * caller may publish the candidate. Cancellation invalidates late success. */
export function beginSymmetryCustomValidation(scene:SceneDocument):SymmetryCustomValidation{
 const owner=new Generator();let cancelled=false;
 const check=()=>{if(cancelled)throw new DOMException('已取消','AbortError');};
 const promise=(async()=>{
  for(const previous of retiring.keys()){await release(previous);check();}
  check();
  try{
   const output=await owner.generate(scene,symmetryCustomValidationInput(scene));
   if(output.backend!==symmetryCustomExecutionBackend(scene))throw Error('自定义 GLSL 需要 GPU 首帧验证');
   check();
  }finally{await release(owner);}
  check();
 })();
 return{promise,cancel(){cancelled=true;void release(owner).catch(()=>{/* Retained for the next validation attempt. */});}};
}
