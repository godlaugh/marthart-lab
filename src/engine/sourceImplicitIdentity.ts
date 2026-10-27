import type {SceneDocument} from '../types';

/** Document identity is separate from the actual CPU/GPU presentation model.
 * Older saved CPU imports retain their marker; unmarked local documents never
 * acquire source semantics from a selected backend or their provenance. */
export const SOURCE_IMPLICIT_CONFIG='mathart-1.7.8-implicit-config-v1' as const;
export const SOURCE_IMPLICIT_PRESENTATION='mathart-1.7.8-cpu-slices-v1' as const;
type Identity=Pick<SceneDocument,'kind'|'settings'>;
export interface SourceImplicitMeshRoute {
 readonly identity:'source-config'|'legacy-cpu-marker';
 readonly requestedMeshMode:'CPU'|'GPU'|'AUTO';
 readonly presentation:'cpu-slices'|'gpu-material';
}
/** Presence establishes the owning parser, not validity. Unknown versions are
 * rejected by the route owner instead of silently selecting the local sampler. */
export const usesSourceImplicitConfiguration=(scene:Identity)=>scene.kind==='implicit'&&(scene.settings.implicitSourceVersion!==undefined||scene.settings.implicitPresentationVersion!==undefined);
export function sourceImplicitMeshRoute(scene:Identity):SourceImplicitMeshRoute|undefined {
 if(!usesSourceImplicitConfiguration(scene))return;
 const s=scene.settings,current=s.implicitSourceVersion,legacy=s.implicitPresentationVersion;
 if(current!==undefined&&current!==SOURCE_IMPLICIT_CONFIG||legacy!==undefined&&legacy!==SOURCE_IMPLICIT_PRESENTATION)throw Error('未知源隐式曲面配置版本');
 if(current!==undefined&&legacy!==undefined)throw Error('源隐式曲面配置包含重复身份标记');
 const identity=current===SOURCE_IMPLICIT_CONFIG?'source-config':'legacy-cpu-marker';
 // PREVIEW remains the existing particle/local sampler. This identity does not
 // assert that its numerical path implements the original preview algorithm.
 if(s.renderMode!=='mesh')return;
 const selected=s.computeBackend??(identity==='legacy-cpu-marker'?'cpu':'webgl2');
 if(selected!=='cpu'&&selected!=='webgl2'&&selected!=='auto')throw Error('源隐式曲面 mesh mode 必须为 CPU、GPU 或 AUTO');
 const requestedMeshMode=selected==='cpu'?'CPU':selected==='webgl2'?'GPU':'AUTO';
 return{identity,requestedMeshMode,presentation:requestedMeshMode==='CPU'?'cpu-slices':'gpu-material'};
}
export const usesSourceImplicitMesh=(scene:Identity)=>sourceImplicitMeshRoute(scene)!==undefined;
export const usesSourceImplicitCpuMesh=(scene:Identity)=>sourceImplicitMeshRoute(scene)?.presentation==='cpu-slices';
export const usesSourceImplicitGpuMesh=(scene:Identity)=>sourceImplicitMeshRoute(scene)?.presentation==='gpu-material';
