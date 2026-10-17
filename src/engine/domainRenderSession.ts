import type {DomainGpuFailureFacts} from './domainGpuFailure';

/** A selected Domain renderer instance owns its failed-GPU state independently
 * of shared GL program caches. Editing its configuration does not create a new
 * instance. Leaving the document or explicitly resetting the session does. */
export class DomainRenderSession {
 private sceneId?:string;
 private failed?:DomainGpuFailureFacts;
 select(sceneId:string){if(this.sceneId!==sceneId){this.reset();this.sceneId=sceneId;}}
 failure():DomainGpuFailureFacts|undefined{return this.failed;}
 fail(failure:DomainGpuFailureFacts){if(!this.failed)this.failed=Object.freeze({...failure});}
 reset(){this.sceneId=undefined;this.failed=undefined;}
}
