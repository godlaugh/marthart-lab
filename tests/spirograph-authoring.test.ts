import {describe,it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createScene,parseScene,persistentScene} from '../src/engine/document';
import {parseProjectFile} from '../src/engine/legacyImport';
import {spirographAuthoringControls,withSpirographVersion,withSpirographClock,spirographDrawingEvent} from '../src/engine/spirographAuthoring';
import {parseSpirographVersion} from '../src/engine/spirographModel';
import {createDefaultSpirographLayer} from '../src/scenes/spirograph';
import {clipDuration,sceneAtTime,resolveTimeline} from '../src/engine/timeline';
import {definition} from '../src/scenes';
import {generateScene} from '../src/engine/temporal';
import {SpirographEditor} from '../src/components/SpirographEditor';
import {SettingsFields} from '../src/components/Fields';
import {Timeline} from '../src/components/Timeline';
import {I18nProvider} from '../src/i18n';
import type {SceneDocument} from '../src/types';

const def=definition('spirograph');
const source=(patch:Record<string,unknown>={})=>({config_version:'1.0.0',type:'SPIROGRAPH',name:'source units',settings:{sceneTransform:{offsetX:4,offsetY:6,rotationDegrees:90,scale:1.2},layers:[{statorRadius:150,penDistance:60,rotors:[{radius:50,mode:'INSIDE'}]}]},timeline:[],...patch});
const read=(input=source())=>parseProjectFile(JSON.stringify(input));
const layers=(scene:SceneDocument)=>JSON.parse(String(scene.settings.layers));

describe('explicit source Spirograph authoring',()=>{
 it('imports degrees, downward Y and native pixels without hidden axis negation',()=>{
  const input=source(),out=read(input);expect(out.scene.settings).toMatchObject({spirographVersion:'mathart-1.7.8-v1',rotation:90,offsetX:4,offsetY:6,scale:1.2,scaleY:1,spiroView:'native'});
  expect(out.scene.provenance?.original).toEqual(input);expect(parseScene(JSON.stringify(out.scene))).toEqual(out.scene);
 });
 it('keeps omitted1803 rules and converted native fields unchanged when a saved local document is loaded',()=>{
  const old=createScene(def);Object.assign(old.settings,{layers:JSON.stringify([createDefaultSpirographLayer()]),offsetY:-6,rotation:-Math.PI/2,scaleY:-1});
  old.provenance={kind:'MathArt Studio',original:source(),warnings:['historical import']};
  expect(parseProjectFile(JSON.stringify(old)).scene).toEqual(old);expect(parseSpirographVersion(old.settings.spirographVersion)).toBe('local-v1');
  expect(parseScene(JSON.stringify(old)).settings.spirographVersion).toBeUndefined();
 });
 it('makes a deliberate version switch without rewriting values, layers, tracks or provenance',()=>{
  const original=read().scene,old=withSpirographVersion(original,'local-v1'),again=withSpirographVersion(old,'mathart-1.7.8-v1');
  const expected=withSpirographClock({...original,settings:{...original.settings,spiroView:'fit'}},undefined);expect(again).toEqual(expected);expect(again.settings.spirographClock).toBeUndefined();expect(old.settings.spiroView).toBe('fit');expect(old.settings.rotation).toBe(90);expect(old.settings.offsetY).toBe(6);
  expect(()=>withSpirographVersion(createScene(def),'mathart-1.7.8-v1')).toThrow('多图层');
  expect(()=>parseScene(JSON.stringify({...original,settings:{...original.settings,spirographVersion:'future'}}))).toThrow();
 });
 it('strips transient runtime radians at both file parse and save boundaries',()=>{
  const original=read().scene,frame={...original,evaluatedSpirographRotationRadians:12};
  expect(persistentScene(frame)).toEqual(original);expect(parseScene(JSON.stringify(frame))).toEqual(original);
  const animated=read(source({timeline:[{type:'animate',duration:1,easing:'LINEAR',actions:[{method:'spirographRotate',args:[1]}]}]})).scene;
  const evaluated=sceneAtTime(animated,2);expect(evaluated.settings.rotation).toBe(90);expect(evaluated.evaluatedSpirographRotationRadians).toBeGreaterThan(0);
  expect(persistentScene(evaluated).evaluatedSpirographRotationRadians).toBeUndefined();
 });
 it('materializes source layer and global defaults rather than the local editor defaults',()=>{
  const scene=read(source({settings:{layers:[{}]}})).scene;
  expect(layers(scene)[0]).toMatchObject({statorRadius:300,penDistance:150,speed:1,rotors:[{radius:150,mode:'inside'}],strokeWidth:1,strokeColor:'#2E8B57',statorColor:'#B4B4B4',palette:['#2E8B57'],visible:true,enabled:true});
  expect(scene.settings).toMatchObject({startEaseEnabled:true,endEaseEnabled:true,fadeInStatorsOnStart:true,fadeOutStatorsOnFinish:false,rotation:0,offsetY:0,scale:1});
 });
 it('distinguishes absent layers using legacy fields from explicit empty layers using the base layer',()=>{
  expect(layers(read(source({settings:{statorRadius:77}})).scene)[0].statorRadius).toBe(77);
  expect(layers(read(source({settings:{layers:[],statorRadius:77}})).scene)[0].statorRadius).toBe(300);
  expect(()=>read(source({settings:{rotors:[]}}))).toThrow('空转子链');
  expect(layers(read(source({settings:{layers:[{rotors:[]}]}})).scene)[0].rotors).toEqual([{radius:150,mode:'inside'}]);
 });
 it('uses ConfigUtils expression conversion for transforms but only literal conversion for animation rates',()=>{
  const input=source({settings:{sceneTransform:{rotationDegrees:'90+90',offsetY:'2*3',scale:'bad('},layers:[{}]},timeline:[{type:'animate',actions:[{method:'spirographRotate',args:['PI/2']}]}]});
  const out=read(input);expect(out.scene.settings).toMatchObject({rotation:180,offsetY:6,scale:0});expect(out.scene.timeline.tracks[0].actions?.[0].args?.speed).toBe(0);
  expect(out.scene.provenance?.original).toEqual(input);expect(out.warnings.join(' ')).toContain('默认值 0');
 });
 it('keeps only the last recognized source target and f32 conversion, retaining ignored raw arguments',()=>{
  const input=source({timeline:[{type:'animate',duration:.7,actions:[{method:'spirographRotate',args:[1]},{method:'spirographRotate',args:[.1,99]},{method:'ambient',args:[8,8,8]}]}]});
  const out=read(input),track=out.scene.timeline.tracks[0];expect(track.duration).toBe(Math.fround(.7));expect(track.actions).toHaveLength(1);expect(track.actions![0].args?.speed).toBe(Math.fround(.1));expect(out.scene.provenance?.original).toEqual(input);
 });
 it('preserves a previous target when later source args are absent or empty, and leaves an empty animate clip without a target',()=>{
  const out=read(source({timeline:[{type:'animate',actions:[{method:'spirographRotate',args:[2]},{method:'spirographRotate',args:[]},{method:'spirographRotate'}]},{type:'animate'}]})).scene;
  expect(out.timeline.tracks.map(t=>t.actions?.[0]?.args?.speed)).toEqual([2,undefined]);expect(out.timeline.tracks[1].actions).toEqual([]);const a=sceneAtTime(out,1).evaluatedSpirographRotationRadians!,b=sceneAtTime(out,2).evaluatedSpirographRotationRadians!;expect(b-a).toBeCloseTo(2,4);expect(out.timeline.tracks.map(t=>t.duration)).toEqual([1,1]);
 });
 it.each([undefined,-1,3000])('keeps source deadline defaults/bounds and advances from actual wait for %s',duration=>{
  const settings={layers:[{autoStopOnClosure:false,rotors:[{radius:1,mode:'INSIDE'}]}]};
  const raw=source({settings,timeline:[{type:'spirograph_finish_wait',...(duration===undefined?{}:{duration})},{type:'wait',duration:2}]});
  const scene=read(raw).scene,wait=scene.timeline.tracks[0],expected=duration===3000?1200:Math.fround(.1);
  expect(wait.spirographWait).toBe('visual-or-deadline-v1');expect(wait.duration).toBe(expected);let elapsed=0,frames=0;while(elapsed<expected){elapsed=Math.fround(elapsed+Math.fround(1/60));frames++;}const seconds=frames/60;expect(clipDuration(wait,scene)).toBe(seconds);expect(scene.timeline.tracks[1].start).toBe(0);expect(scene.timeline.schedule).toBe('spirograph-sequence-v1');expect(resolveTimeline(scene).tracks[1].start).toBe(seconds);expect(scene.provenance?.original).toEqual(raw);
 });
 it('keeps legacy automatic waits unchanged and records source finite maximum separately',()=>{
  const scene=read(source({timeline:[{type:'spirograph_finish_wait',duration:1200},{type:'wait',duration:1}]})).scene,wait=scene.timeline.tracks[0];
  expect(wait.duration).toBe(1200);expect(scene.timeline.tracks[1].start).toBe(0);expect(resolveTimeline(scene).tracks[1].start).toBe(clipDuration(wait,scene));expect(clipDuration(wait,scene)).toBeLessThan(1200);
  const old=withSpirographVersion(scene,'local-v1'),automatic={...wait,spirographWait:undefined,duration:1};
  expect(clipDuration(automatic,old)).toBeGreaterThan(1);
 });
 it('preserves compatible-clock timestamp events and queue identity; restart removes the previous finish timestamp',()=>{
  const original=withSpirographClock(read().scene,undefined),finished=spirographDrawingEvent({...original,settings:{...original.settings,finishTrace:true}},'finish',2.5);
  expect(finished.settings.traceFinishTime).toBe(2.5);expect(finished.settings.finishTrace).toBeUndefined();expect(parseScene(JSON.stringify(finished))).toEqual(finished);
  const restarted=spirographDrawingEvent(finished,'restart',4);expect(restarted.settings.traceStartTime).toBe(4);expect(restarted.settings.traceFinishTime).toBeUndefined();
  const old=withSpirographVersion(original,'local-v1');expect(spirographDrawingEvent(old,'finish',2).settings.finishTrace).toBe(true);
  expect(()=>parseScene(JSON.stringify({...original,timeline:{...original.timeline,schedule:'unknown'}}))).toThrow('顺序规则');
  expect(()=>parseScene(JSON.stringify({...original,kind:'map',spirographFrameEvents:undefined}))).toThrow('顺序规则');
 });
 it('rejects unsupported nonfinite/capacity values instead of clipping them into a plausible source document',()=>{
  expect(()=>read(source({timeline:[{type:'animate',actions:[{method:'spirographRotate',args:['1e100']}]}]}))).toThrow('非有限');
  expect(()=>read(source({settings:{layers:[{rotors:[{mode:' INSIDE'}]}]}}))).toThrow('mode');
  expect(()=>read(source({settings:{layers:[{statorRadius:20000}]}}))).toThrow();
 });
 it('presents version-specific units and a source wait even when drawing has no finite completion',()=>{
  const scene=withSpirographClock(read(source({settings:{layers:[{autoStopOnClosure:false}]}})).scene,undefined);
  const controls=spirographAuthoringControls(scene,def.controls);expect(controls.find(c=>c.key==='rotation')!.label).toContain('度');expect(controls.find(c=>c.key==='offsetY')!.label).toContain('向下');expect(controls.find(c=>c.key==='spiroView')!.options![0].value).toBe('native');expect(controls.some(c=>c.key==='easeDuration'||c.key==='finishTrace')).toBe(false);expect(spirographAuthoringControls(withSpirographVersion(scene,'local-v1'),def.controls).some(c=>c.key==='easeDuration')).toBe(true);
  const html=renderToStaticMarkup(createElement(I18nProvider,{language:'en',children:createElement(SpirographEditor,{scene,time:0,onChange:()=>{}})}));expect(html).toContain('Spirograph coordinate and animation rules');expect(html).toContain('radians/second');expect(html).toContain('Completion has not been confirmed within the current replay range');
  const timeline=renderToStaticMarkup(createElement(I18nProvider,{language:'en',children:createElement(Timeline,{scene,time:0,playing:false,onTime:()=>{},onPlay:()=>{},onChange:()=>{}})}));expect(timeline).toContain('value="spirograph_finish_wait"');
 });
 it('hides dormant source Z controls through the real Fields consumer while retaining saved values and local controls',()=>{
  const scene=read().scene;Object.assign(scene.settings,{scaleZ:7,offsetZ:-31});
  const markup=(document:SceneDocument)=>renderToStaticMarkup(createElement(I18nProvider,{language:'en',children:createElement(SettingsFields,{controls:spirographAuthoringControls(document,def.controls),settings:document.settings,onChange:()=>{}})}));
  const sourceHtml=markup(scene);expect(sourceHtml).not.toContain('id="control-scaleZ"');expect(sourceHtml).not.toContain('id="control-offsetZ"');
  for(const key of ['scaleX','scaleY','offsetX','offsetY','rotateZ'])expect(sourceHtml).toContain(`id="control-${key}"`);
  expect(parseScene(JSON.stringify(scene)).settings).toMatchObject({scaleZ:7,offsetZ:-31});
  const local=withSpirographVersion(scene,'local-v1'),localHtml=markup(local);expect(localHtml).toContain('id="control-scaleZ"');expect(localHtml).toContain('id="control-offsetZ"');expect(local.settings).toMatchObject({scaleZ:7,offsetZ:-31});
 });
 it('leaves public source-frame raster output unchanged when retained Z values differ',async()=>{
  const scene=read().scene;Object.assign(scene.settings,{count:128,scale:.12,startEaseEnabled:false,endEaseEnabled:false});
  const context={time:.5,width:83,height:67,quality:'preview' as const},baseline=await generateScene(scene,context),changed=await generateScene({...scene,settings:{...scene.settings,scaleZ:-100,offsetZ:9999}},context);
  if(baseline.type!=='raster'||changed.type!=='raster')throw new Error('Source Spirograph must produce a raster');
  expect(changed.pixels).toEqual(baseline.pixels);expect(baseline.stats.generated).toBeGreaterThan(0);expect(new Set(baseline.pixels).size).toBeGreaterThan(2);
 });
});
