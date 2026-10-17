import {describe,it,expect} from 'vitest';
import {parseProjectFile,parseLegacyScene} from '../src/engine/legacyImport';
import {serializeScene} from '../src/engine/document';
import {sceneAtTime,timelineWarnings} from '../src/engine/timeline';
import {prepareRootsCameraTimeline} from '../src/engine/rootsCameraTimeline';
import {parseSourceNumberTokens} from '../src/engine/sourceNumberTokens';
import {SOURCE_JSON_LIMITS} from '../src/engine/sourceJson';

const header={config_version:'1.0.0',type:'COMPLEX_ROOTS',name:'Native mixed queue',camera:{phi:0}};
const animate=(actions:unknown[],duration=1)=>({type:'animate',duration,easing:'LINEAR',actions});
const load=(timeline:unknown)=>parseProjectFile(JSON.stringify({...header,timeline}));
const literal=(timeline:string)=>parseProjectFile(`{"config_version":"1.0.0","type":"COMPLEX_ROOTS","name":"gradient tokens","timeline":${timeline}}`);
const reload=(scene:ReturnType<typeof load>['scene'])=>parseProjectFile(serializeScene(scene)).scene;

describe('Roots mixed gradient public import and persistence',()=>{
 it('uses the new schedule only for present native timeline and keeps old canonical camera markers inactive',()=>{
  expect(parseProjectFile(JSON.stringify(header)).scene.timeline.schedule).toBeUndefined();
  expect(load([]).scene.timeline.schedule).toBe('roots-scene-sequence-v1');
  const scene=load([animate([{method:'gradientStart',args:{speed:30}}])]).scene;
  scene.timeline.schedule='roots-camera-sequence-v1';delete scene.timeline.tracks[0].actions![0].gradient;
  const saved=reload(scene);expect(saved.timeline.schedule).toBe('roots-camera-sequence-v1');expect(prepareRootsCameraTimeline(saved).clips[0].gradientActions).toBeUndefined();
  expect(timelineWarnings(saved).join('\n')).toContain('仅相机队列不会启用渐变动作');
 });
 it('maps the first later object and source applicability through one owner, retaining every raw input',()=>{
  const timeline=[animate([{method:'gradientStart',enabled:false,args:[7,null,{mode:'OFFSET_CYCLE',speed:'0x1.8p3',interpolation:'LINEAR',affectInside:false,affectOutside:false,unknown:3},{speed:999}]},{method:'zoom',args:[2]},{method:'gradientStop',args:{ignored:'NaN'}}])];
  const result=load(timeline),actions=result.scene.timeline.tracks[0].actions!;
  expect(actions.map(a=>a.method)).toEqual(['gradientStart','zoom','gradientStop']);
  expect(actions[0]).toMatchObject({enabled:true,gradient:{model:'offsets',mode:'offset_cycle',speed:12,interpolation:'linear',affectInside:true,affectOutside:true}});
  expect(actions[2].gradient).toBeUndefined();expect(result.scene.provenance!.original).toEqual({...header,timeline});
  expect(result.warnings.join('\n')).toContain('unknown');expect(result.warnings.join('\n')).toContain('固定同时');
  expect(reload(result.scene).timeline).toEqual(result.scene.timeline);
 });
 it('does not change disabled, target-mismatched, unknown-mode or stop input semantics',()=>{
  const result=load([{enabled:false,type:'animate',actions:[{method:'gradientStart',args:{speed:'1'.repeat(65537)}}]},animate([
   {method:'gradientStart',args:{targetDomain:'DOMAIN_COLORING',speed:'1'.repeat(65537)}},
   {method:'gradientStart',args:{mode:'NONE'}},{method:'gradientStop',args:{speed:'1'.repeat(65537)}},{method:'gradientStart',args:7},
  ])]);
  expect(result.scene.timeline.tracks).toHaveLength(1);expect(result.scene.timeline.tracks[0].actions!.map(a=>a.method)).toEqual(['gradientStop','gradientStart']);
  expect(result.scene.timeline.tracks[0].actions![1].gradient).toMatchObject({mode:'hue_rotate',speed:60,interpolation:'oklab'});
 });
 it('executes independent linear start/stop frame values after actual public save/load',()=>{
  const scene=load([animate([{method:'gradientStart',args:{mode:'HUE_ROTATE',interpolation:'LINEAR',speed:360}}]),animate([{method:'gradientStop'}],.5)]).scene;
  scene.timeline.fps=4;const saved=reload(scene),expected=[.125,.375,.75,.25,.5,.5,.5];
  for(const [frame,offset]of expected.entries())for(const input of [scene,saved])expect(sceneAtTime(input,frame/4).evaluatedRootsCamera!.gradient!.offset).toBe(offset);
  expect(scene.settings.rootSourcePaletteOffset??0).toBe(0);expect(serializeScene(sceneAtTime(scene,.75))).not.toContain('evaluatedRootsCamera');
 });
 it('validates full-scene configurations on disabled clips without narrowing double speed or changing old markers',()=>{
  const scene=load([animate([{method:'gradientStart',args:{speed:1e100}}])]).scene;
  const track=scene.timeline.tracks[0],action=track.actions![0];track.enabled=false;
  const authored=structuredClone(action.gradient!);
  expect(reload(scene).timeline.tracks[0].actions![0].gradient).toEqual(authored);
  expect(action.gradient!.speed).toBe(1e100);
  for(const patch of [{model:'palette'},{affectInside:false},{affectOutside:false},{fromStops:['#000000','#ffffff']}]){
   Object.assign(action,{gradient:{...authored,...patch}});
   expect(()=>reload(scene)).toThrow(/复根/);
   scene.timeline.schedule='roots-camera-sequence-v1';
   expect(reload(scene).timeline.tracks[0].actions![0].gradient).toEqual(action.gradient);
   scene.timeline.schedule='roots-scene-sequence-v1';
  }
  delete action.gradient;
  expect(reload(scene).timeline.tracks[0].actions![0].gradient).toBeUndefined();
  track.enabled=true;expect(timelineWarnings(reload(scene)).join('\n')).toContain('没有配置');
 });
 it('retains raw overflow and numeric-class lexemes for selected fields including a later payload index',()=>{
  const prefix=Array(70).fill('null').join(',');
  const scene=literal(`[{"type":"animate","actions":[{"method":"gradientStart","args":[${prefix},{"mode":"HUE_ROTATE","speed":1e999,"interpolation":1.0,"affectInside":-0,"affectOutside":9007199254740993}]}]}]`).scene;
  expect(scene.timeline.tracks[0].actions![0].gradient).toMatchObject({speed:60,interpolation:'oklab'});
  const tokens=scene.provenance!.sourceNumberTokens!,base=['timeline','0','actions','0','args','70'];
  for(const [field,token]of [['speed','1e999'],['interpolation','1.0'],['affectInside','-0'],['affectOutside','9007199254740993']])expect(tokens).toContainEqual({path:[...base,field],token});
  expect(reload(scene).provenance!.sourceNumberTokens).toEqual(tokens);
  expect(parseLegacyScene(JSON.stringify({...header,timeline:[animate([{method:'gradientStart',args:{speed:5}}])]})).sourceNumberTokens).toContainEqual({path:['timeline','0','actions','0','args','speed'],token:'5'});
 });
 it('preserves dormant registered gradient fields and direct numeric args without activating them',()=>{
  const scene=literal('[{"enabled":false,"actions":[{"method":"gradientStart","args":{"speed":-1e999,"targetDomain":1.0}}]},{"type":"UNKNOWN","actions":[{"method":"gradientStart","args":1e999}]}]').scene;
  expect(scene.timeline.tracks).toEqual([]);expect(scene.provenance!.sourceNumberTokens).toEqual([
   {path:['timeline','0','actions','0','args','targetDomain'],token:'1.0'},{path:['timeline','0','actions','0','args','speed'],token:'-1e999'},
   {path:['timeline','1','actions','0','args'],token:'1e999'},
  ]);expect(reload(scene).provenance!.sourceNumberTokens).toEqual(scene.provenance!.sourceNumberTokens);
 });
 it('retains only the selected object and rejects duplicate payload or unregistered numeric fields',()=>{
  const scene=literal('[{"type":"animate","actions":[{"method":"gradientStart","args":[{"speed":1.0},{"speed":2.0}]}]}]').scene;
  expect(scene.provenance!.sourceNumberTokens).toEqual([{path:['timeline','0','actions','0','args','0','speed'],token:'1.0'}]);
  const token=(path:string[])=>({path,token:'1'}),base=['timeline','0','actions','0','args'];
  expect(()=>parseSourceNumberTokens([token([...base,'0','speed']),token([...base,'1','mode'])])).toThrow('首个对象');
  for(const path of [[...base,'0','unknown'],[...base,String(SOURCE_JSON_LIMITS.nodes),'speed'],[...base,'01','speed']])expect(()=>parseSourceNumberTokens([token(path)])).toThrow('字段路径');
 });
 it('closes the public capacity chain for expanded registered gradient metadata without dropping tokens',()=>{
  const timeline=Array.from({length:800},()=>({enabled:false,actions:Array.from({length:10},()=>({method:'gradientStart',args:{targetDomain:1,mode:1,interpolation:1,speed:1,affectInside:1,affectOutside:1}}))}));
  const input=JSON.stringify({...header,timeline});expect(input.length).toBeLessThan(SOURCE_JSON_LIMITS.characters);
  const scene=parseProjectFile(input).scene;expect(scene.provenance!.sourceNumberTokens!.filter(record=>record.path[0]==='timeline')).toHaveLength(48000);
  const saved=serializeScene(scene);expect(saved.length).toBeLessThan(SOURCE_JSON_LIMITS.characters);expect(saved).not.toContain('\n');
  const reopened=parseProjectFile(saved);expect(reopened.scene.provenance).toEqual(scene.provenance);expect(serializeScene(reopened.scene)).toBe(saved);
 });
});
