import {describe,it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {definition} from '../src/scenes';
import {createScene,parseScene,persistentScene} from '../src/engine/document';
import {createDefaultSpirographLayer} from '../src/scenes/spirograph';
import {withSpirographClock,withSpirographSimulationFps,withSpirographVersion,spirographDrawingEvent} from '../src/engine/spirographAuthoring';
import {usesSpirographFrameClock} from '../src/engine/spirographFrameConfig';
import {SpirographEditor} from '../src/components/SpirographEditor';
import {Timeline} from '../src/components/Timeline';
import {I18nProvider} from '../src/i18n';
import type {SceneDocument} from '../src/types';
import saved1871 from './fixtures/spirograph/source-1871-documents.json';
import {parseProjectFile} from '../src/engine/legacyImport';

function document():SceneDocument {
 const scene=createScene(definition('spirograph'));
 scene.settings={...scene.settings,spirographVersion:'mathart-1.7.8-v1',layers:JSON.stringify([createDefaultSpirographLayer()]),spiroView:'native'};
 scene.timeline={...scene.timeline,schedule:'spirograph-sequence-v1',duration:1,tracks:[{...scene.timeline.tracks[0],start:0,duration:2}]};
 return scene;
}

describe('explicit Spirograph frame-clock authoring',()=>{
 it('does not upgrade saved source-v1 or local documents on parse',()=>{
  const old=document();expect(parseScene(JSON.stringify(old))).toEqual(old);expect(usesSpirographFrameClock(old)).toBe(false);
  delete old.settings.spirographVersion;delete old.timeline.schedule;
  expect(parseScene(JSON.stringify(old))).toEqual(old);
  for(const saved of saved1871){const parsed=parseProjectFile(JSON.stringify(saved)).scene;expect(parsed).toEqual(saved);expect(parsed.settings.spirographClock).toBeUndefined();expect(parsed.spirographFrameEvents).toBeUndefined();}
 });
 it('selects the declared offline clock only for fresh source imports and keeps zero waits as waits',()=>{
  const raw={config_version:'1.0.0',type:'SPIROGRAPH',name:'fresh frame reference',settings:{},timeline:[{type:'wait',duration:0},{type:'animate',duration:0,actions:[]}]};
  const {scene,warnings}=parseProjectFile(JSON.stringify(raw));expect(scene.settings).toMatchObject({spirographClock:'source-frame-v1',spirographSimulationFps:60});expect(scene.spirographFrameEvents).toEqual([]);
  expect(scene.timeline.tracks.map(t=>[t.type,t.duration])).toEqual([['wait',0],['animate',0]]);expect(scene.provenance?.original).toEqual(raw);expect(warnings.join(' ')).toContain('60 FPS');expect(parseScene(JSON.stringify(scene))).toEqual(scene);
  const old=document();old.timeline.tracks[0].duration=0;expect(()=>parseScene(JSON.stringify(old))).toThrow('轨道');
 });
 it('transcribes only still-effective legacy timestamps once and preserves their raw fields',()=>{
  const old=document();Object.assign(old.settings,{traceStartTime:1,traceClearTime:2,traceFinishTime:3,animate:false,finishTrace:true});
  const before=structuredClone(old),next=withSpirographClock(old,'source-frame-v1',30);
  expect(old).toEqual(before);expect(next.settings).toMatchObject({spirographClock:'source-frame-v1',spirographSimulationFps:30,animate:true,finishTrace:false,traceStartTime:1,traceClearTime:2,traceFinishTime:3});
  expect(next.spirographFrameEvents).toEqual([{beforeFrame:30,type:'restart'},{beforeFrame:60,type:'clear'},{beforeFrame:90,type:'finish'}]);
  const off=withSpirographClock(next,undefined),again=withSpirographClock(off,'source-frame-v1');expect(off.settings.spirographClock).toBeUndefined();expect(again.spirographFrameEvents).toEqual(next.spirographFrameEvents);
  const stale=document();Object.assign(stale.settings,{traceStartTime:2,traceClearTime:1,traceFinishTime:1});expect(withSpirographClock(stale,'source-frame-v1').spirographFrameEvents).toEqual([{beforeFrame:120,type:'restart'}]);
  const fractional=document();fractional.settings.traceFinishTime=.201;expect(withSpirographClock(fractional,'source-frame-v1',60).spirographFrameEvents).toEqual([{beforeFrame:13,type:'finish'}]);fractional.settings.traceFinishTime=.0333333333333333;expect(withSpirographClock(fractional,'source-frame-v1',30).spirographFrameEvents).toEqual([{beforeFrame:1,type:'finish'}]);
 });
 it('preserves explicit empty events and stores event frame identity across FPS edits and round-trip',()=>{
  const old=document();old.settings.traceFinishTime=1;old.spirographFrameEvents=[];
  const next=withSpirographClock(old,'source-frame-v1',30);expect(next.spirographFrameEvents).toEqual([]);
  const withEvent=spirographDrawingEvent(next,'finish',1),edited=withSpirographSimulationFps(withEvent,60);
  expect(edited.spirographFrameEvents).toEqual([{beforeFrame:30,type:'finish'}]);expect(withEvent.settings.spirographSimulationFps).toBe(30);expect(parseScene(JSON.stringify(edited))).toEqual(edited);
  const local=withSpirographVersion(edited,'local-v1');expect(local.settings.spirographClock).toBeUndefined();expect(local.spirographFrameEvents).toEqual(edited.spirographFrameEvents);
 });
 it('uses exact completed-frame identity and keeps all same-frame commands for last-command replay',()=>{
  const scene=withSpirographClock(document(),'source-frame-v1',30);
  const a=spirographDrawingEvent(scene,'clear',9,2),b=spirographDrawingEvent(a,'finish',9,2),c=spirographDrawingEvent(b,'restart',9,2);
  expect(c.spirographFrameEvents).toEqual([{beforeFrame:2,type:'clear'},{beforeFrame:2,type:'finish'},{beforeFrame:2,type:'restart'}]);
  for(const key of ['traceStartTime','traceFinishTime','traceClearTime'])expect(c.settings[key]).toBe(scene.settings[key]);
  expect(spirographDrawingEvent(scene,'finish',.0333333333333333).spirographFrameEvents).toEqual([{beforeFrame:1,type:'finish'}]);
  expect(spirographDrawingEvent(scene,'finish',0,0).spirographFrameEvents).toEqual([{beforeFrame:1,type:'finish'}]);
 });
 it('rejects incompatible activation without rewriting the original timeline or clock',()=>{
  for(const edit of [(s:SceneDocument)=>{delete s.timeline.schedule;},(s:SceneDocument)=>{s.timeline.tracks[0].type='numeric';s.timeline.tracks[0].target='settings.rotation';},(s:SceneDocument)=>{s.timeline.tracks[0].repeat=2;},(s:SceneDocument)=>{s.settings.spirographVersion='local-v1';}]){
   const scene=document();edit(scene);const before=structuredClone(scene);expect(()=>withSpirographClock(scene,'source-frame-v1')).toThrow();expect(scene).toEqual(before);
  }
  expect(()=>withSpirographClock(document(),'unknown')).toThrow();
 });
 it('validates saved FPS/events/queue and strips delivered runtime facts',()=>{
  const scene=withSpirographClock(document(),'source-frame-v1');
  for(const fps of [0,121,1.5,Infinity])expect(()=>withSpirographSimulationFps(scene,fps)).toThrow();
  for(const events of [{},[{beforeFrame:0,type:'finish'}],[{beforeFrame:1,type:'unknown'}],[{beforeFrame:1,type:'clear',extra:true}],Array.from({length:4097},()=>({beforeFrame:1,type:'clear'}))])expect(()=>parseScene(JSON.stringify({...scene,spirographFrameEvents:events}))).toThrow();
  expect(()=>parseScene(JSON.stringify({...scene,timeline:{...scene.timeline,schedule:undefined}}))).toThrow('队列');
  const frame={...scene,evaluatedSpirographRotationRadians:2,evaluatedSpirographFrame:{frame:9}} as unknown as SceneDocument;
  expect(persistentScene(frame)).toEqual(scene);expect(parseScene(JSON.stringify(frame))).toEqual(scene);
 });
 it('exposes simulation FPS and event semantics without legacy full-preview, looping, or unsupported clip controls',()=>{
  const scene=withSpirographClock(document(),'source-frame-v1');scene.spirographFrameEvents=[{beforeFrame:60,type:'clear'}];
  const editor=renderToStaticMarkup(createElement(I18nProvider,{language:'en',children:createElement(SpirographEditor,{scene,time:1,completedFrame:60,onChange:()=>{}})}));
  expect(editor).toContain('Spirograph simulation FPS');expect(editor).toContain('offline');expect(editor).not.toContain('aria-label="Draw layers over time"');expect(editor).not.toContain('按时间逐层绘制');
  const timeline=renderToStaticMarkup(createElement(I18nProvider,{language:'en',children:createElement(Timeline,{scene,time:1,playing:false,onTime:()=>{},onPlay:()=>{},onChange:()=>{}})}));
  expect(timeline).not.toContain('aria-label="Playback mode"');expect(timeline).not.toContain('Convert to absolute timeline');
  expect(timeline).not.toContain('value="numeric"');expect(timeline).toContain('value="spirograph_finish_wait"');expect(timeline).toContain('value="animate"');
 });
});
