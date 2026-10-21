import type {SceneDocument} from '../types';
import {sourceIteratedLiveKind} from './sourceLivePreview';
import {sourceIteratedSceneIdentity} from './sourceIteratedLiveIdentity';
import {editSourceMapScene} from './sourceMapScene';
import {editSourceSymmetryConfiguration} from './sourceSymmetryConfig';
/** Ordinary parameter-panel value edits. Geometry controls and add/delete are
 * Apply operations; modified delta_power belongs to that structural panel. A
 * new runtime name needs an explicit write from the value editor: it can exist
 * only in the staged ProjectState while the running scene still lacks it. */
export function sourceIteratedParameterChanges(before:SceneDocument,next:SceneDocument,writes?:readonly (readonly [string,number])[]):readonly (readonly [string,number])[]|undefined {
 const family=sourceIteratedLiveKind(before);
 if(!family||sourceIteratedLiveKind(next)!==family||before.id!==next.id)return;
 const beforeNames=Object.keys(before.parameters),names=Object.keys(next.parameters);
 if(beforeNames.some(k=>!Object.hasOwn(next.parameters,k)))return;
 if(writes?.some(([k,v])=>!Object.hasOwn(next.parameters,k)||!Number.isFinite(v)||!Object.is(next.parameters[k],v)))return;
 const explicit=new Set(writes?.map(([k])=>k));
 if(names.some(k=>!Object.hasOwn(before.parameters,k)&&!explicit.has(k)))return;
 const changes=names.filter(k=>explicit.has(k)||!Object.hasOwn(before.parameters,k)||!Object.is(before.parameters[k],next.parameters[k])).map(k=>[k,next.parameters[k]] as const);
 if(!changes.length||changes.some(([k,v])=>!Number.isFinite(v)||family==='symmetry'&&next.settings.template==='modified'&&k==='delta_power'))return;
 const candidate={...before,parameters:next.parameters};
 const expected=family==='map'?editSourceMapScene(before,candidate,'parameters'):editSourceSymmetryConfiguration(before,candidate,'parameters');
 if(sourceIteratedSceneIdentity(expected)!==sourceIteratedSceneIdentity(next))return;
 return changes;
}
