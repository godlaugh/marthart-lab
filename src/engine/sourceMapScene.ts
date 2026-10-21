import type {SceneDocument} from '../types';
import {SOURCE_MAP_MATH,usesSourceMapMath} from './sourceMapMath';
import {SOURCE_MAP_CONFIG,editSourceMapConfiguration,type SourceMapConfiguration} from './sourceMapConfig';

export function usesSourceMapConfiguration(scene:Pick<SceneDocument,'kind'|'mapSource'>):boolean {
 if(scene.mapSource===undefined)return false;
 if(scene.kind!=='map'||scene.mapSource.model!==SOURCE_MAP_CONFIG)throw Error('未知源 Map 构造配置');
 return true;
}
/** The configuration owner has already parsed these values. UI controls expose
 * them, but neither the importer nor the GPU derives construction facts again. */
export function withSourceMapConfiguration(scene:SceneDocument,configuration:SourceMapConfiguration,parameters:Record<string,number>):SceneDocument {
 const c=configuration.construction;
 return{...scene,mapSource:configuration,parameters,equations:{...c.equations},settings:{...scene.settings,mapMathModel:SOURCE_MAP_MATH,iteratedMode:'continuous',iteratedBackend:'gpu',batchSize:c.batchSize,dimension:c.dimension,burnIn:c.burnIn,iterationsPerFrame:c.iterations,initialMode:'box',initialXMin:c.initial.xMin,initialXMax:c.initial.xMax,initialYMin:c.initial.yMin,initialYMax:c.initial.yMax,initialZMin:-1,initialZMax:1}};
}
const editable=(scene:SceneDocument)=>({parameters:scene.parameters,equations:{x:scene.equations.x??'',y:scene.equations.y??'',z:scene.equations.z??''},batchSize:Number(scene.settings.batchSize),dimension:Number(scene.settings.dimension),initial:{xMin:Number(scene.settings.initialXMin),xMax:Number(scene.settings.initialXMax),yMin:Number(scene.settings.initialYMin),yMax:Number(scene.settings.initialYMax)},burnIn:Number(scene.settings.burnIn),iterations:Number(scene.settings.iterationsPerFrame)});
export function editSourceMapScene(before:SceneDocument,next:SceneDocument,intent:'edit'|'apply'|'parameters'='edit'):SceneDocument {
 if(!usesSourceMapConfiguration(next))return next;
 const changed=editSourceMapConfiguration(next.mapSource!,editable(before),editable(next),intent);
 if(!changed.ok)throw Error(changed.error.reason);
 return changed.value.configuration===next.mapSource?next:withSourceMapConfiguration(next,changed.value.configuration,changed.value.parameters);
}
/** A runtime frame may vary uniforms, but structural edits must go through the
 * editor reconstruction boundary. Refuse inconsistent saved/animated inputs. */
export function sourceMapConstruction(scene:SceneDocument,authored:SceneDocument=scene):SourceMapConfiguration['construction']|undefined {
 if(!usesSourceMapConfiguration(authored))return;
 if(!usesSourceMapMath(scene))throw Error('源 Map 构造配置需要匹配的数学模型');
 const c=authored.mapSource!.construction,current=editable(scene);
 if(current.batchSize!==c.batchSize||current.dimension!==c.dimension||current.burnIn!==c.burnIn||current.iterations!==c.iterations||scene.settings.initialMode!=='box'||Object.keys(c.initial).some(k=>!Object.is(current.initial[k as keyof typeof c.initial],c.initial[k as keyof typeof c.initial]))||(['x','y','z'] as const).some(k=>current.equations[k]!==c.equations[k]))throw Error('源 Map 结构或公式改变需要重建构造配置');
 return c;
}
