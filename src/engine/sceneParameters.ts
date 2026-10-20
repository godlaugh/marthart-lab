import type {SceneDocument} from '../types';
import {SAMILA_SCENE_SEQUENCE} from './sourceSamilaReplay';

export interface ParameterTimelineReference {target:string;trackId:string;kind:'value'|'stop';enabled:boolean;}
/** Parameter references follow the timeline's named operation contracts. A stop
 * selector does not read a value; dormant actions retain their references but
 * cannot make a currently enabled evaluation depend on a deleted parameter. */
export function parameterTimelineReferences(scene:Pick<SceneDocument,'timeline'>):ParameterTimelineReference[]{
 const out:ParameterTimelineReference[]=[];
 for(const track of scene.timeline.tracks){
  const add=(target:unknown,enabled:boolean,kind:ParameterTimelineReference['kind']='value')=>{if(typeof target==='string'&&target.startsWith('parameters.'))out.push({target,trackId:track.id,kind,enabled});};
  const ranges=(values:typeof track.parameterAnimations,enabled:boolean)=>{for(const p of values??[]){add(p.target,enabled&&p.enabled);if(p.binding?.mode==='complex-full')add(p.binding.imaginaryTarget,enabled&&p.enabled);}};
  const type=track.type??'numeric';
  if(type==='numeric')add(track.target,track.enabled);
  if(type==='param')ranges(track.parameterAnimations,track.enabled);
  if(type==='animate')for(const action of track.actions??[]){
   if(scene.timeline.schedule===SAMILA_SCENE_SEQUENCE){
    if(action.method==='paramStart')for(const p of action.samilaParameters?.parameters??[])add('parameters.'+p.name,track.enabled);
    continue; // Source stop acts on the drift registry, not a named initial value.
   }
   const enabled=track.enabled&&action.enabled!==false;if(action.method==='paramStart')ranges(action.parameters,enabled);if(action.method==='paramStop')add(action.args?.target,enabled,'stop');
  }
 }
 return out;
}

/** Generic named constants are a separate contract from registered Fractal
 * settings. Keep old data intact; eligibility only governs new UI choices. */
export function supportsGenericParameters(scene:Pick<SceneDocument,'kind'>):boolean{return scene.kind!=='fractal';}
export function genericParameterTargets(scene:Pick<SceneDocument,'kind'|'parameters'>):string[]{return supportsGenericParameters(scene)?Object.keys(scene.parameters).map(key=>'parameters.'+key):[];}
export function genericParameterNotice(scene:Pick<SceneDocument,'kind'>):string|undefined{return supportsGenericParameters(scene)?undefined:'分形公式使用专用参数。导入的通用参数与既有动画保留；它们不实时驱动分形递推。';}
export function inactiveGenericParameterTarget(scene:Pick<SceneDocument,'kind'>,target:string):boolean{return !supportsGenericParameters(scene)&&target.startsWith('parameters.');}
/** Preserve an unavailable current value without offering it to newly-created
 * items. The UI must not silently display a different target for old data. */
export function animationTargetChoices(available:readonly string[],selected:string):{value:string;retained:boolean}[]{const values=[...new Set(available)];return[...(!values.includes(selected)?[{value:selected,retained:true}]:[]),...values.map(value=>({value,retained:false}))];}
export function genericParameterTimelineWarning(scene:SceneDocument):string|undefined{
 if(supportsGenericParameters(scene))return;
 const targets=new Set(parameterTimelineReferences(scene).map(reference=>reference.target));
 return targets.size?`${[...targets].join(', ')} 是保留的通用参数目标，不参与分形递推。请改用公式参数。`:undefined;
}
