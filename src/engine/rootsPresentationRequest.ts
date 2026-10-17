import type {SceneDocument} from '../types';
/** Runtime instance identity is distinct from an authored document ID. A save
 * may assign a new document ID while retaining this worker-owned instance. */
export function rootsPresentationRequestIdentity(scene:Pick<SceneDocument,'id'>,runtimeId:unknown):string {
 if(runtimeId===undefined)return JSON.stringify(['document',scene.id]);
 if(typeof runtimeId!=='string'||!runtimeId.trim())throw new Error('源复根运行实例标识必须是非空字符串');
 return JSON.stringify(['runtime',runtimeId]);
}
