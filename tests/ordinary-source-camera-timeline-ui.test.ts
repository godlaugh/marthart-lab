import {parseProjectFile} from '../src/engine/legacyImport';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import {Timeline} from '../src/components/Timeline';
import {I18nProvider} from '../src/i18n';
import {createScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {supportsCameraAction,supportsCameraComponent,supportsCameraTarget,supportsParticleTracking,usesOrdinarySourceCamera} from '../src/engine/sceneCamera';
import {createAnimationTrack,sceneAtTime} from '../src/engine/timeline';
import type {SceneDocument} from '../src/types';
function source(kind:'surface'|'implicit'|'attractor'|'perlin'='surface'){
 const scene=createScene(definition(kind));scene.sourceCamera={model:'mathart-1.7.8-v1',configuration:{kind:'angles',family:kind,phi:0,theta:0,gamma:0}};scene.settings.sourceCameraProjection='perspective';
 if(kind==='perlin')Object.assign(scene.settings,{style:'continuous',particleDisplay:'heads',dimension:2});
 if(kind==='attractor')scene.settings.presentation='points';
 scene.timeline.schedule='ordinary-camera-sequence-v1';scene.timeline.tracks=[];return scene;
}
function html(scene:SceneDocument){return renderToStaticMarkup(createElement(I18nProvider,{language:'en',children:createElement(Timeline,{scene,time:0,playing:false,onTime:()=>{},onPlay:()=>{},onChange:()=>{}})}));}
const choices=(markup:string)=>markup.match(/<select aria-label="New clip type"[^>]*>(.*?)<\/select>/)?.[1]??'';
describe('ordinary source camera Timeline authoring boundaries',()=>{
 it.each(['surface','implicit','attractor','perlin'] as const)('offers useful source queue edits without unsupported new clip types: %s',kind=>{
  const scene=source(kind),before=structuredClone(scene),markup=html(scene),types=choices(markup);
  for(const name of ['wait','animate','align','param'])expect(types).toContain(`value="${name}"`);
  for(const name of ['numeric','trails','fractal_zoom','spirograph_finish_wait'])expect(types).not.toContain(`value="${name}"`);
  expect(types.includes('value="surface_mode_transition"')).toBe(kind==='surface');
  expect(markup).toContain('Offline preview frame rate');expect(markup).not.toContain('Convert to absolute timeline');expect(markup).not.toContain('role="separator"');expect(scene).toEqual(before);
 });
 it('preserves local documents and their normal numeric/tracking capability without source inference',()=>{
  const scene=createScene(definition('surface')),before=structuredClone(scene),markup=html(scene);
  expect(usesOrdinarySourceCamera(scene)).toBe(false);expect(choices(markup)).toContain('value="numeric"');expect(supportsCameraTarget(scene,'camera.theta')).toBe(true);expect(supportsParticleTracking(scene)).toBe(true);expect(supportsCameraAction(scene,'track')).toBe(true);expect(markup).not.toContain('Offline preview frame rate');expect(scene).toEqual(before);
 });
 it('exposes all source scalar components for eligible two-dimensional Perlin geometry',()=>{
  const scene=source('perlin');for(const axis of ['phi','theta','gamma'])expect(supportsCameraComponent(scene,axis)).toBe(true);
  for(const method of ['rotateTheta','rotatePhi','rotateGamma','rotateTo','zoom','focal','ambient','stopAmbient','stopTracking'])expect(supportsCameraAction(scene,method)).toBe(true);
  expect(supportsCameraAction(scene,'track')).toBe(false);expect(supportsParticleTracking(scene)).toBe(false);for(const target of ['camera.theta','camera.zoom','camera.x','camera.focalLength'])expect(supportsCameraTarget(scene,target)).toBe(false);expect(supportsCameraTarget(scene,'parameters.a')).toBe(true);
 });
 it('creates and evaluates useful supported actions and next-turn alignment through the real timeline producer',()=>{
  const scene=source('perlin'),rotate=createAnimationTrack(scene,'animate'),align=createAnimationTrack(scene,'align');expect(rotate.actions![0].method).toBe('rotateTheta');expect(align.alignMode).toBe('next-turn');expect(align.orientation).toEqual({theta:0,phi:0,gamma:0});
  scene.timeline.tracks=[rotate];expect(sceneAtTime(scene,1).evaluatedSourceCamera?.camera.theta).toBeGreaterThan(0);
 });
 it('retains unsupported authored clips visibly with a production diagnostic and no mutation',()=>{
  const scene=source();scene.timeline.tracks=[{...createAnimationTrack(createScene(definition('surface')),'numeric'),id:'retained-camera',target:'camera.theta',label:'Retained numeric camera'}];const before=structuredClone(scene),markup=html(scene);
  expect(markup).toContain('Retained numeric camera');expect(markup).toContain('role="alert"');expect(choices(markup)).not.toContain('value="numeric"');expect(scene).toEqual(before);
 });
 it('does not expose local camera fallback for a source marker on unsupported raster presentation',()=>{
  const scene=source('perlin');scene.settings.particleDisplay='accumulation';expect(supportsCameraComponent(scene,'theta')).toBe(false);expect(supportsCameraAction(scene,'rotateTheta')).toBe(false);expect(supportsParticleTracking(scene)).toBe(false);expect(html(scene)).toContain('role="alert"');
 });
});

it('offers only implemented clips for source CPU particle replay',()=>{
 const scene=parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'SURFACE',name:'Source index',equations:{x:'u',y:'v',z:'0'},settings:{show_trails:false,u_segments:3,v_segments:5},timeline:[{type:'animate',duration:1,actions:[{method:'track',args:[7]}]}]})).scene;
 const markup=html(scene),types=choices(markup);expect(types).toContain('value="param"');expect(types).not.toContain('value="surface_mode_transition"');expect(types).toContain('value="animate"');expect(types).toContain('value="trails"');expect(supportsCameraAction(scene,'track')).toBe(true);
});
