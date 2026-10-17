import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import {createScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {defaultRootsPresentationConfiguration} from '../src/engine/rootsPresentationConfig';
import {withRootsPresentation} from '../src/engine/rootsPresentationAuthoring';
import {withRootsCameraTimeline} from '../src/engine/rootsCameraTimeline';
import {RootsPresentationControls} from '../src/components/RootsPresentationControls';
import {RootsDensityColorControls} from '../src/components/RootsDensityColorControls';
import {Timeline} from '../src/components/Timeline';
import {I18nProvider} from '../src/i18n';
import type {SceneDocument} from '../src/types';

const spatial=()=>withRootsPresentation(createScene(definition('roots')),defaultRootsPresentationConfiguration());
function markup(scene:SceneDocument,part:'panel'|'timeline'|'color',language:'zh'|'en'='en'){
 const children=part==='panel'?createElement(RootsPresentationControls,{scene,onChange:()=>{}}):part==='color'?createElement(RootsDensityColorControls,{scene,onChange:()=>{}}):createElement(Timeline,{scene,time:0,playing:false,onTime:()=>{},onPlay:()=>{},onChange:()=>{}});
 return renderToStaticMarkup(createElement(I18nProvider,{language,children}));
}
function clipOptions(html:string){return html.match(/<select aria-label="New clip type"[^>]*>(.*?)<\/select>/)?.[1]??'';}

describe('Roots source camera timeline authoring surface',()=>{
 it('requires explicit activation for an existing source presentation document',()=>{
  const scene=spatial(),before=structuredClone(scene);
  const panel=markup(scene,'panel'),timeline=markup(scene,'timeline');
  expect(panel).toContain('Enable source camera queue');expect(panel).not.toContain('Disable source camera queue');
  expect(timeline).not.toContain('Offline preview frame rate');expect(clipOptions(timeline)).toContain('value="numeric"');
  expect(scene.timeline.schedule).toBeUndefined();expect(scene).toEqual(before);
 });
 it('offers only queue clips, arbitrary supported integer preview FPS and local playback choices',()=>{
  const scene=withRootsCameraTimeline(spatial(),true);scene.timeline.fps=2;
  const before=structuredClone(scene),html=markup(scene,'timeline'),options=clipOptions(html);
  expect(options).toContain('value="wait"');expect(options).toContain('value="animate"');
  for(const type of ['numeric','align','param','fractal_zoom','trails'])expect(options).not.toContain(`value="${type}"`);
  expect(html).toMatch(/aria-label="Offline preview frame rate"[^>]*min="1"[^>]*max="120"[^>]*value="2"/);
  expect(html).toContain('aria-label="Playback mode"');expect(html).toContain('value="ping-pong"');
  expect(html).not.toContain('Convert to absolute timeline');expect(html).not.toContain('role="separator"');
  expect(scene).toEqual(before);
 });
 it('explains the shared initial camera and queue units in both languages',()=>{
  const scene=withRootsCameraTimeline(spatial(),true);
  for(const language of ['zh','en'] as const){
   const html=markup(scene,'panel',language);
   expect(html).toContain(language==='zh'?'停用源相机队列':'Disable source camera queue');
   expect(html).toContain(language==='zh'?'空间相机参数定义起始状态':'Spatial camera values define the initial state');
   expect(html).toContain(language==='zh'?'缩放可为零或负数':'zoom may be zero or negative');
  }
 });
 it('retains incompatible tracks visibly while omitting new unsupported choices',()=>{
  const scene=spatial();scene.timeline.tracks.push({id:'held-plane',type:'numeric',target:'settings.rootScale',from:1,to:2,start:3,duration:2,easing:'linear',enabled:true,pingPong:false,label:'Saved plane scale'});
  const source=withRootsCameraTimeline(scene,true),before=structuredClone(source),html=markup(source,'timeline');
  expect(html).toContain('Saved plane scale');expect(html).toContain('role="alert"');expect(html).not.toContain('aria-label="Clip Saved plane scale"');
  expect(clipOptions(html)).not.toContain('value="numeric"');expect(source).toEqual(before);
 });
 it('shows an owner validation failure without losing the editable authored scene',()=>{
  const scene=withRootsCameraTimeline(spatial(),true);scene.timeline.tracks=[{id:'too-large',type:'animate',target:'camera.actions',from:0,to:0,start:0,duration:1,easing:'linear',enabled:true,pingPong:false,actions:[{id:'zoom',method:'zoom',args:{value:1e100}}]}];
  const before=structuredClone(scene),html=markup(scene,'timeline');
  expect(html).toContain('role="alert"');expect(html).toContain('Float32');expect(scene).toEqual(before);
 });
 it('leaves authored tracks and baseline camera intact when switching back to the previous rules',()=>{
  const scene=spatial(),source=withRootsCameraTimeline(scene,true),local=withRootsCameraTimeline(source,false);
  expect(local.timeline.tracks).toEqual(scene.timeline.tracks);expect(local.rootsPresentation).toEqual(scene.rootsPresentation);expect(local.camera).toEqual(scene.camera);
  expect(markup(local,'panel')).toContain('Enable source camera queue');expect(markup(local,'timeline')).not.toContain('Offline preview frame rate');
 });
 it('describes static-only source colors only while the source camera queue is active',()=>{
  const scene=spatial(),source=withRootsCameraTimeline(scene,true),before=structuredClone(source);
  for(const language of ['zh','en'] as const){
   const active=markup(source,'color',language),previous=markup(scene,'color',language);
   expect(active).toContain(language==='zh'?'数值与渐变轨道保留但不执行':'Numeric and gradient tracks are retained but do not run');
   expect(active).not.toContain(language==='zh'?'源偏移可使用对应数值轨道':'source offset supports its numeric track');
   expect(previous).toContain(language==='zh'?'源偏移可使用对应数值轨道':'source offset supports its numeric track');
  }
  expect(source).toEqual(before);
 });
});
