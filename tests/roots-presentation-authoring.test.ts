import {describe,it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {defaultRootsPendingConfiguration,defaultRootsPresentationConfiguration} from '../src/engine/rootsPresentationConfig';
import {usesRootsNativePresentation,withRootsPresentation,rootsPresentationControlVisible,navigateRootsPresentation} from '../src/engine/rootsPresentationAuthoring';
import {RootsPresentationControls} from '../src/components/RootsPresentationControls';
import {I18nProvider} from '../src/i18n';

describe('source spatial Roots authoring',()=>{
 it('activates the complete spatial contract explicitly without losing dormant inputs',()=>{
  const scene=createScene(definition('roots')),before=structuredClone(scene);
  const source=withRootsPresentation(scene,defaultRootsPresentationConfiguration());
  expect(scene).toEqual(before);expect(source.equations).toEqual(scene.equations);expect(source.palette).toEqual(scene.palette);
  expect(usesRootsNativePresentation(source)).toBe(true);expect(source.rootsMath?.model).toBe('mathart-1.7.8-v1');
  expect(source.settings.rootsMode).toBe('progressive');expect(source.settings.rootDensityColorVersion).toBe('mathart-1.7.8-metric-v1');
  const local=withRootsPresentation(source,{...source.rootsPresentation!,model:'local-v1'});
  expect(usesRootsNativePresentation(local)).toBe(false);expect(local.rootsMath).toEqual(source.rootsMath);expect(local.settings).toEqual(source.settings);
  expect(withRootsPresentation(local,{...local.rootsPresentation!,model:'mathart-1.7.8-v1'})).toEqual(source);
 });
 it('keeps only inactive plane controls hidden, preserving sampling and source tone',()=>{
  const scene=withRootsPresentation(createScene(definition('roots')),defaultRootsPresentationConfiguration());
  for(const key of ['rootScale','rootRender','rotation','densityView','rootSplat','rootsMode'])expect(rootsPresentationControlVisible(scene,key)).toBe(false);
  for(const key of ['rootColor','rootSourceGamma','rootSamplesPerFrame','rootSamplingFps','rootStartTime'])expect(rootsPresentationControlVisible(scene,key)).toBe(true);
  expect(usesRootsNativePresentation(createScene(definition('roots')))).toBe(false);
 });
 it('uses source radians/zoom without changing authored transform or the baseline',()=>{
  const initial=defaultRootsPresentationConfiguration(),before=structuredClone(initial);
  const rotated=navigateRootsPresentation(initial,{kind:'rotate',dx:25,dy:10,width:100,height:100});
  expect(rotated.camera.theta).toBe(-Math.PI/2);expect(rotated.camera.phi).toBeCloseTo(initial.camera.phi+Math.PI/10,14);
  const zoomed=navigateRootsPresentation(rotated,{kind:'zoom',deltaPixels:100});
  expect(zoomed.camera.zoom).toBe(Math.exp(-.1));expect(zoomed.transform).toEqual(initial.transform);expect(initial).toEqual(before);
  expect(()=>navigateRootsPresentation(initial,{kind:'rotate',dx:1,dy:2,width:0,height:1})).toThrow();
  expect(()=>navigateRootsPresentation(initial,{kind:'zoom',deltaPixels:-1e9})).toThrow();
 });
 it('exposes mode apply, source units and lifecycle behavior in both languages',()=>{
  const scene=withRootsPresentation(createScene(definition('roots')),defaultRootsPresentationConfiguration());
  for(const language of ['zh','en'] as const){
   const html=renderToStaticMarkup(createElement(I18nProvider,{language,children:createElement(RootsPresentationControls,{scene,onChange:()=>{}})}));
   expect(html).toContain(language==='zh'?'应用显示方式并重新采样':'Apply display mode and restart sampling');
   expect(html).toContain(language==='zh'?'相机 phi（弧度）':'Camera phi (radians)');
   expect(html).toContain(language==='zh'?'空间偏移 Z':'Spatial offset Z');
  }
 });
 it('distinguishes explicit pending upgrade, applicable density budget and dormant point-cloud budget',()=>{
  const original=withRootsPresentation(createScene(definition('roots')),defaultRootsPresentationConfiguration());
  const render=(scene:typeof original)=>renderToStaticMarkup(createElement(I18nProvider,{language:'en',children:createElement(RootsPresentationControls,{scene,onChange:()=>{}})}));
  const oldHtml=render(original);
  expect(oldHtml).toContain('Enable batch queue and restart sampling');
  expect(oldHtml).not.toContain('aria-label="Base points drawn per frame"');
  expect(original.rootsPresentation).not.toHaveProperty('pending');
  const pending=withRootsPresentation(original,{...original.rootsPresentation!,pending:defaultRootsPendingConfiguration()});
  const pendingHtml=render(pending);
  expect(pendingHtml).not.toContain('Enable batch queue and restart sampling');
  expect(pendingHtml).toContain('aria-label="Base points drawn per frame"');
  expect(pendingHtml).toContain('automatically increases');
  const cloud=withRootsPresentation(pending,{...pending.rootsPresentation!,mode:'point-cloud'}),cloudHtml=render(cloud);
  expect(cloudHtml).not.toContain('aria-label="Base points drawn per frame"');
  expect(cloudHtml).toContain('only affects density mode');
  expect(cloud.rootsPresentation!.pending).toEqual(pending.rootsPresentation!.pending);
  expect(withRootsPresentation(cloud,{...cloud.rootsPresentation!,model:'local-v1'}).rootsPresentation!.pending).toEqual(pending.rootsPresentation!.pending);
 });
});
