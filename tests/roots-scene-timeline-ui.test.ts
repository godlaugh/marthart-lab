import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import {createScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {defaultRootsPresentationConfiguration} from '../src/engine/rootsPresentationConfig';
import {withRootsPresentation} from '../src/engine/rootsPresentationAuthoring';
import {withRootsCameraTimeline,withRootsSceneTimeline,prepareRootsCameraTimeline} from '../src/engine/rootsCameraTimeline';
import {ROOTS_GRADIENT_DEFAULT} from '../src/engine/rootsGradientConfig';
import {RootsPresentationControls} from '../src/components/RootsPresentationControls';
import {RootsDensityColorControls} from '../src/components/RootsDensityColorControls';
import {Timeline,RootsGradientEditor} from '../src/components/Timeline';
import {I18nProvider} from '../src/i18n';
import type {GradientAnimation,SceneDocument} from '../src/types';

const spatial=()=>withRootsPresentation(createScene(definition('roots')),defaultRootsPresentationConfiguration());
const render=(children:ReturnType<typeof createElement>,language:'zh'|'en'='en')=>renderToStaticMarkup(createElement(I18nProvider,{language,children}));
const panel=(scene:SceneDocument)=>render(createElement(RootsPresentationControls,{scene,onChange:()=>{}}));
const timeline=(scene:SceneDocument)=>render(createElement(Timeline,{scene,time:0,playing:false,onTime:()=>{},onPlay:()=>{},onChange:()=>{}}));
function markerScene(){const scene=spatial();scene.timeline.tracks=[{id:'retained-start',type:'animate',target:'camera.actions',from:0,to:0,start:0,duration:1,easing:'linear',enabled:true,pingPong:false,actions:[{id:'old-marker',method:'gradientStart'}]}];return scene;}

describe('Roots complete scene queue authoring',()=>{
 it('keeps the old camera marker explicit and offers a separate upgrade',()=>{
  const scene=withRootsCameraTimeline(markerScene(),true),before=structuredClone(scene),html=panel(scene);
  expect(html).toContain('Upgrade to full source scene queue');expect(html).toContain('Disable source camera queue');
  expect(html).not.toContain('Return to camera-only queue');expect(scene).toEqual(before);
  expect(prepareRootsCameraTimeline(scene).clips[0].gradientActions).toBeUndefined();
 });
 it('retains an unconfigured old action on upgrade and warns instead of silently creating source defaults',()=>{
  const old=withRootsCameraTimeline(markerScene(),true),full=withRootsSceneTimeline(old,true),before=structuredClone(full);
  expect(full.timeline.tracks).toEqual(old.timeline.tracks);expect(full.timeline.tracks[0].actions![0].gradient).toBeUndefined();
  expect(prepareRootsCameraTimeline(full).clips[0].gradientActions).toEqual([]);
  expect(timeline(full)).toContain('role="alert"');expect(panel(full)).toContain('Return to camera-only queue');
  expect(full).toEqual(before);
 });
 it('renders explicit configuration for missing and incompatible saved gradient values without rewriting them',()=>{
  const invalid={...ROOTS_GRADIENT_DEFAULT,model:'palette',fromStops:['#000000','#ffffff']} as GradientAnimation;
  for(const config of [undefined,invalid]){
   const before=structuredClone(config),html=render(createElement(RootsGradientEditor,{config,onChange:()=>{throw Error('render mutated configuration');}}));
   expect(html).toContain('Configure source gradient');expect(html).toContain('data-testid="roots-gradient-unconfigured"');
   expect(html).not.toContain('aria-label="Gradient speed °/s"');expect(config).toEqual(before);
  }
 });
 it('offers all four source modes and phase curves, degrees per second, and no region or palette-stop controls',()=>{
  const config:GradientAnimation={...ROOTS_GRADIENT_DEFAULT,model:'offsets',affectInside:true,affectOutside:true},before=structuredClone(config);
  const html=render(createElement(RootsGradientEditor,{config,onChange:()=>{}}));
  for(const mode of ['hue_rotate','offset_cycle','palette_morph','cross_fade','rgb','linear','oklab','oklch'])expect(html).toContain(`value="${mode}"`);
  expect(html).toContain('aria-label="Gradient speed °/s"');expect(html).toContain('aria-label="Offset phase curve"');
  expect(html).not.toContain('Affect inside');expect(html).not.toContain('Affect outside');expect(html).not.toContain('type="color"');
  expect(config).toEqual(before);
 });
 it('keeps full-queue playback policy and unsupported tracks visible without offering numeric clips',()=>{
  const scene=withRootsSceneTimeline(spatial(),true);scene.timeline.fps=4;scene.timeline.tracks=[{id:'inactive-number',label:'Retained numeric offset',type:'numeric',target:'settings.rootSourcePaletteOffset',from:0,to:1,start:0,duration:1,easing:'linear',enabled:true,pingPong:false}];
  const html=timeline(scene),options=html.match(/<select aria-label="New clip type"[^>]*>(.*?)<\/select>/)?.[1]??'';
  expect(options).toContain('value="animate"');expect(options).not.toContain('value="numeric"');expect(html).toContain('Retained numeric offset');
  expect(html).toContain('aria-label="Playback mode"');expect(html).toContain('Scene clips run in list order');expect(html).not.toContain('role="separator"');
 });
 it('distinguishes full gradient execution from camera-only and legacy numeric-offset authoring',()=>{
  const base=spatial(),camera=withRootsCameraTimeline(base,true),full=withRootsSceneTimeline(base,true);
  const color=(scene:SceneDocument)=>render(createElement(RootsDensityColorControls,{scene,onChange:()=>{}}));
  expect(color(base)).toContain('source offset supports its numeric track');
  expect(color(camera)).toContain('Numeric and gradient tracks are retained but do not run');
  expect(color(full)).toContain('retains the final offset after stopping');expect(color(full)).not.toContain('Numeric and gradient tracks are retained but do not run');
 });
 it('downgrades explicitly to camera-only without deleting the configured gradients',()=>{
  const scene=markerScene();scene.timeline.tracks[0].actions![0].gradient={...ROOTS_GRADIENT_DEFAULT,model:'offsets',affectInside:true,affectOutside:true};
  const full=withRootsSceneTimeline(scene,true),camera=withRootsCameraTimeline(full,true);
  expect(camera.timeline.schedule).toBe('roots-camera-sequence-v1');expect(camera.timeline.tracks).toEqual(full.timeline.tracks);
  expect(prepareRootsCameraTimeline(full).clips[0].gradientActions).toHaveLength(1);expect(prepareRootsCameraTimeline(camera).clips[0].gradientActions).toBeUndefined();
 });
});
