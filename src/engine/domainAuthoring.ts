import type {SceneDocument} from '../types';
import {DEFAULT_DOMAIN_SOURCE_COLORS,parseDomainColorVersion,parseDomainSourcePalette} from './domainSourceColor';
import {parseDomainIterationVersion} from './domainSourceIteration';
import {parseDomainViewportVersion} from './domainViewport';
import {parseDomainRenderPolicy} from './domainRenderPolicy';

/** Execution routing never rewrites the three authored rule selections. */
export function withDomainRenderPolicy(scene:SceneDocument,value:unknown):SceneDocument {
 if(scene.kind!=='domain')throw new Error('渲染恢复规则仅适用于域着色场景');
 return{...scene,settings:{...scene.settings,domainRenderPolicy:parseDomainRenderPolicy(value)}};
}

/** A deliberate version selection creates the source palette once. Subsequent
 * selections retain both authored palettes, and never derive one from the other. */
export function withDomainColorVersion(scene:SceneDocument,value:unknown):SceneDocument {
 if(scene.kind!=='domain')throw new Error('着色版本仅适用于域着色场景');
 const version=parseDomainColorVersion(value),previous=parseDomainColorVersion(scene.settings.domainColorVersion),settings={...scene.settings,domainColorVersion:version};
 if(version==='local-v1')return {...scene,settings,...(previous!=='local-v1'&&scene.domainSourcePalette===undefined?{domainSourcePalette:{colors:[...DEFAULT_DOMAIN_SOURCE_COLORS]}}:{})};
 if(scene.domainSourcePalette===undefined&&previous!=='local-v1')return {...scene,settings};
 return {...scene,settings,
  domainSourcePalette:parseDomainSourcePalette(scene.domainSourcePalette??{colors:scene.palette.stops})};
}

/** An explored formula is an independent one-step map. Source versions still
 * apply next/seed when iteration is disabled, so reset those active inputs. */
export function withExploredDomainFormula(scene:SceneDocument,formula:string):SceneDocument {
 const source=parseDomainIterationVersion(scene.settings.domainIterationVersion)!=='local-v1';
 return {...scene,equations:{...scene.equations,f:formula,...(source?{next:''}:{})},settings:{...scene.settings,iterationEnabled:false,...(source?{seedMode:'PIXEL_Z'}:{})}};
}

export function withDomainIterationVersion(scene:SceneDocument,value:unknown):SceneDocument {
 if(scene.kind!=='domain')throw new Error('公式执行规则仅适用于域着色场景');
 const version=parseDomainIterationVersion(value);
 return {...scene,settings:{...scene.settings,domainIterationVersion:version,...(version!=='local-v1'?{iterationMaxSteps:scene.settings.iterationMaxSteps??64}:{})}};
}

/** A rule selection retains the authored center, scale and angle. Converting
 * scale here would destroy the caller's values when switching back or reloading. */
export function withDomainViewportVersion(scene:SceneDocument,value:unknown):SceneDocument {
 if(scene.kind!=='domain')throw new Error('视口坐标规则仅适用于域着色场景');
 const version=parseDomainViewportVersion(value);
 return{...scene,settings:{...scene.settings,domainViewportVersion:version}};
}
