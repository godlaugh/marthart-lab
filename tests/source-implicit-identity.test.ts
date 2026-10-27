import {describe,expect,it} from 'vitest';
import {createScene,parseScene,serializeScene} from '../src/engine/document';
import {definitions} from '../src/scenes';
import {SOURCE_IMPLICIT_CONFIG,SOURCE_IMPLICIT_PRESENTATION,sourceImplicitMeshRoute,usesSourceImplicitConfiguration,usesSourceImplicitMesh,usesSourceImplicitCpuMesh,usesSourceImplicitGpuMesh} from '../src/engine/sourceImplicitIdentity';

const scene=()=>createScene(definitions.find(value=>value.kind==='implicit')!);
describe('source Implicit identity and requested mesh route',()=>{
 it('does not reinterpret existing unmarked local documents or their provenance',()=>{
  const local=scene();local.settings.computeBackend='webgl2';
  expect(usesSourceImplicitConfiguration(local)).toBe(false);expect(sourceImplicitMeshRoute(local)).toBeUndefined();
  const reopened=parseScene(serializeScene(local));expect(reopened.settings).toEqual(local.settings);expect(usesSourceImplicitMesh(reopened)).toBe(false);
 });
 it('retains the old CPU marker and its omitted CPU default without migrating saved data',()=>{
  const old=scene();old.settings.implicitPresentationVersion=SOURCE_IMPLICIT_PRESENTATION;delete old.settings.computeBackend;
  expect(sourceImplicitMeshRoute(old)).toEqual({identity:'legacy-cpu-marker',requestedMeshMode:'CPU',presentation:'cpu-slices'});
  const reopened=parseScene(serializeScene(old));expect(reopened.settings.implicitSourceVersion).toBeUndefined();expect(usesSourceImplicitCpuMesh(reopened)).toBe(true);
  old.settings.computeBackend='webgl2';expect(usesSourceImplicitGpuMesh(old)).toBe(true);
 });
 it.each([['cpu','CPU','cpu-slices'],['webgl2','GPU','gpu-material'],['auto','AUTO','gpu-material']] as const)('resolves the explicit %s request independently of actual computation', (backend,requestedMeshMode,presentation)=>{
  const source=scene();Object.assign(source.settings,{implicitSourceVersion:SOURCE_IMPLICIT_CONFIG,computeBackend:backend});
  expect(sourceImplicitMeshRoute(source)).toEqual({identity:'source-config',requestedMeshMode,presentation});expect(usesSourceImplicitMesh(source)).toBe(true);
 });
 it('defaults only the new source configuration to GPU and excludes PREVIEW math',()=>{
  const source=scene();source.settings.implicitSourceVersion=SOURCE_IMPLICIT_CONFIG;delete source.settings.computeBackend;
  expect(sourceImplicitMeshRoute(source)?.requestedMeshMode).toBe('GPU');source.settings.renderMode='points';
  expect(usesSourceImplicitConfiguration(source)).toBe(true);expect(usesSourceImplicitMesh(source)).toBe(false);expect(usesSourceImplicitGpuMesh(source)).toBe(false);
 });
 it('retains ownership of malformed versions and rejects them before local fallback',()=>{
  const source=scene();source.settings.implicitSourceVersion='unknown';
  expect(usesSourceImplicitConfiguration(source)).toBe(true);expect(()=>sourceImplicitMeshRoute(source)).toThrow('版本');
  source.settings.implicitSourceVersion=SOURCE_IMPLICIT_CONFIG;source.settings.implicitPresentationVersion=SOURCE_IMPLICIT_PRESENTATION;expect(()=>sourceImplicitMeshRoute(source)).toThrow('重复');
  delete source.settings.implicitPresentationVersion;source.settings.computeBackend='unknown';expect(()=>sourceImplicitMeshRoute(source)).toThrow('mesh mode');
 });
});
