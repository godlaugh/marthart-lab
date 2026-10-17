import {describe,it,expect} from 'vitest';
import {parseLegacyScene,parseProjectFile} from '../src/engine/legacyImport';
import {parseScene,persistentScene,createScene} from '../src/engine/document';
import {sceneAtTime} from '../src/engine/timeline';
import {prepareRootsCameraTimeline} from '../src/engine/rootsCameraTimeline';
import {definition} from '../src/scenes';
import type {SceneDocument} from '../src/types';

const header={config_version:'1.0.0',type:'COMPLEX_ROOTS',name:'Native camera queue'};
const load=(timeline:unknown,extra:Record<string,unknown>={})=>parseProjectFile(JSON.stringify({...header,camera:{phi:0},...extra,timeline}));
const literal=(timeline:string)=>parseProjectFile(`{"config_version":"1.0.0","type":"COMPLEX_ROOTS","name":"lexemes","camera":{"phi":0},"timeline":${timeline}}`);
const save=(scene:SceneDocument)=>parseScene(JSON.stringify(persistentScene(scene)));
const animate=(actions:unknown[],more:Record<string,unknown>={})=>({type:'animate',duration:1,easing:'LINEAR',actions,...more});
const at=(scene:SceneDocument,time:number)=>sceneAtTime(scene,time).evaluatedRootsCamera!.camera;
const F=Math.fround;

describe('Roots native camera timeline public import',()=>{
 it('enables only an explicitly present native timeline and keeps omission at the previous default',()=>{
  const omitted=parseProjectFile(JSON.stringify(header)).scene;
  const baseline=createScene(definition('roots'));
  expect(omitted.timeline.schedule).toBeUndefined();expect(omitted.timeline.duration).toBe(baseline.timeline.duration);
  expect(omitted.timeline.tracks.map(({id:_id,...track})=>track)).toEqual(baseline.timeline.tracks.map(({id:_id,...track})=>track));
  const empty=load([]).scene;
  expect(empty.timeline.schedule).toBe('roots-scene-sequence-v1');expect(empty.timeline.tracks).toEqual([]);expect(empty.timeline.duration).toBe(.1);
  expect(save(empty).timeline).toEqual(empty.timeline);
  expect(save(omitted).timeline.schedule).toBeUndefined();
 });
 it('does not reinterpret existing local files or an omitted schedule',()=>{
  const old=createScene(definition('roots'));old.timeline.tracks=[];
  const result=parseProjectFile(JSON.stringify(persistentScene(old)));
  expect(result.format).toBe('local');expect(result.scene.rootsPresentation).toBeUndefined();expect(result.scene.timeline.schedule).toBeUndefined();
 });
 it.each([null,{},1,'wait'])('rejects a present non-array timeline %j',value=>{
  expect(()=>load(value)).toThrow('timeline');
 });
 it('skips disabled clips before reading malformed type/duration/actions',()=>{
  const timeline=[{enabled:false,type:[],duration:'NaN',actions:7},{enabled:'FALSE',type:{},duration:'Infinity',actions:null},{duration:.25}];
  const result=load(timeline);expect(result.scene.timeline.tracks).toHaveLength(1);
  expect(result.scene.timeline.tracks[0]).toMatchObject({type:'wait',duration:.25,start:0});
  expect(result.scene.provenance!.original).toEqual({...header,camera:{phi:0},timeline});
 });
 it.each([null,0,' false ',{},[]].map(value=>[value]))('does not default a malformed clip enabled %j',enabled=>{
  expect(()=>load([{enabled}])).toThrow('布尔');
 });
 it('defaults missing/null type to wait, lowercases strings without trimming, and skips unknown types',()=>{
  const result=load([{}, {type:null}, {type:'WAIT',duration:.5}, {type:' wait ',duration:'NaN'}, {type:'hold',duration:5}, {type:17,duration:5}, {type:true,duration:5}, {type:{},duration:5}]);
  expect(result.scene.timeline.tracks.map(t=>[t.type,t.duration])).toEqual([['wait',1],['wait',1],['wait',.5]]);
  expect(result.warnings.join('\n')).toContain('不将其改作等待');
 });
 it('distinguishes direct wait duration from animate expressions and uses empty-map fallback1',()=>{
  const result=load([
   {duration:'PI/2'},animate([],{duration:'PI/2'}),{duration:'1e3'},animate([],{duration:'1e3'}),
   {duration:'sin('},animate([],{duration:'sin('}),{duration:''},animate([],{duration:''}),
   animate([],{duration:'a+1'}),animate([],{duration:true}),animate([],{duration:{x:1}}),
  ],{parameters:{a:4}});
  expect(result.scene.timeline.tracks.map(t=>t.duration)).toEqual([1,F(Math.PI/2),1000,1000,1,1,1,F(.001),1,1,1]);
 });
 it('clamps after source float conversion, including negative infinity, then persists finite duration',()=>{
  const result=load([{duration:0},animate([],{duration:-3}),{duration:'-Infinity'},animate([],{duration:'-Infinity'})]);
  expect(result.scene.timeline.tracks.map(t=>t.duration)).toEqual(Array(4).fill(F(.001)));
  expect(save(result.scene).timeline).toEqual(result.scene.timeline);
 });
 it.each(['Infinity','NaN','0/0','sqrt(-1)'])('rejects nonfinite animate duration %s rather than using a default',duration=>{
  expect(()=>load([animate([],{duration})])).toThrow('有限');
 });
 it('uses exact source easing registration and fallback, not case/space normalization',()=>{
  const result=load(['LINEAR','SINE_IN_OUT','sine_in_out',' SINE_IN_OUT','step',null,5,{}].map(easing=>animate([],{easing})));
  expect(result.scene.timeline.tracks.map(t=>t.easing)).toEqual(['linear','sine-in-out','sine-in-out','sine-in-out','sine-in-out','sine-in-out','sine-in-out','sine-in-out']);
  expect(result.warnings.filter(w=>w.includes('未匹配原版精确注册名'))).toHaveLength(5);
 });
 it('retains missing/empty actions as timed camera waits and ignores wait actions/easing entirely',()=>{
  const result=load([{type:'animate'},{type:'animate',actions:[]},{type:'wait',actions:7,easing:{}}]);
  expect(result.scene.timeline.tracks).toHaveLength(3);
  expect(result.scene.timeline.tracks[0].actions).toEqual([]);expect(result.scene.timeline.tracks[1].actions).toEqual([]);
  expect(prepareRootsCameraTimeline(result.scene).clips).toEqual(Array(3).fill({duration:1,easing:'sine-in-out',gradientActions:[]}));
 });
 it.each([null,7,{},''])('rejects present non-array animate actions %j',actions=>{
  expect(()=>load([{type:'animate',actions}])).toThrow('actions');
 });
 it.each([null,7,[],true].map(value=>[value]))('rejects a non-object action member %j',action=>{
  expect(()=>load([animate([action])])).toThrow('对象');
 });
 it('preserves recognized action order and delegates independent last writes to the queue owner',()=>{
  const actions=[{method:'ambient',args:[1,2,3],enabled:false},{method:'zoom',args:[2,999]},{method:'stopAmbient',args:{ignored:true}},
   {method:'ambient',args:[4,5]}, {method:'zoom',args:[0]}, {method:'ambient',args:[1]}];
  const result=load([animate(actions)]),track=result.scene.timeline.tracks[0];
  expect(track.actions!.map(a=>a.method)).toEqual(['ambient','zoom','stopAmbient','ambient','zoom']);
  expect(track.actions![0].enabled).toBe(true);
  expect(prepareRootsCameraTimeline(result.scene).clips).toEqual([{duration:1,easing:'linear',rates:[4,5,0],zoom:0,gradientActions:[]}]);
  expect(result.scene.provenance!.original).toEqual({...header,camera:{phi:0},timeline:[animate(actions)]});
  expect(result.warnings.join('\n')).toContain('不读取动作级 enabled');
 });
 it('accepts zoom empty array as zero, negative targets and ignores non-array payloads',()=>{
  const result=load([animate([{method:'zoom',args:[]}]),animate([{method:'zoom',args:[-3]}]),
   animate([{method:'zoom',args:3},{method:'zoom',args:{value:8}},{method:'zoom'}])]);
  expect(prepareRootsCameraTimeline(result.scene).clips).toEqual([{duration:1,easing:'linear',zoom:0,gradientActions:[]},{duration:1,easing:'linear',zoom:-3,gradientActions:[]},{duration:1,easing:'linear',gradientActions:[]}]);
  expect(save(result.scene).timeline).toEqual(result.scene.timeline);
 });
 it('uses Java literals then source expressions for args, missing/invalid0, and no formula parameter scope',()=>{
  const result=load([animate([{method:'ambient',args:['1e3','PI/2','a+1','Infinity']}]),
   animate([{method:'ambient',args:[null,true,{}]}]),animate([{method:'zoom',args:['sin(']}])],{parameters:{a:9}});
  expect(prepareRootsCameraTimeline(result.scene).clips.map(c=>[c.rates,c.zoom])).toEqual([[[1000,F(Math.PI/2),0],undefined],[[0,0,0],undefined],[undefined,0]]);
 });
 it('does not read ignored extra args or stopAmbient payloads',()=>{
  const result=load([animate([{method:'zoom',args:[2,'NaN']},{method:'ambient',args:[1,2,3,'NaN']},{method:'stopAmbient',args:['NaN']}])]);
  expect(prepareRootsCameraTimeline(result.scene).clips[0]).toEqual({duration:1,easing:'linear',zoom:2,rates:[0,0,0],gradientActions:[]});
 });
 it.each(['Infinity','NaN','0/0'])('rejects a supported nonfinite camera target %s',value=>{
  expect(()=>load([animate([{method:'zoom',args:[value]}])])).toThrow('非有限');
  expect(()=>load([animate([{method:'ambient',args:[0,value]}])])).toThrow('非有限');
 });
 it('ignores unknown methods without invoking generic camera action mappings',()=>{
  const result=load([animate([{},{method:null},{method:7},{method:'Zoom',args:[2]},
   {method:'rotatePhi',args:[1]},{method:'focal',args:[3]},{method:'track',args:[0]}])]);
  expect(result.scene.timeline.tracks[0].actions).toEqual([]);
  expect(result.warnings.join('\n')).toContain('原版复根不执行此动作方法');
 });
 it('imports complete source gradient config into the explicit mixed queue',()=>{
  const timeline=[animate([{method:'gradientStart',args:{mode:'HUE_ROTATE',speed:37},enabled:false},{method:'gradientStop'}])];
  const result=load(timeline);
  expect(result.scene.timeline.tracks[0].actions!.map(a=>a.method)).toEqual(['gradientStart','gradientStop']);
  expect(prepareRootsCameraTimeline(result.scene).clips[0]).toEqual({duration:1,easing:'linear',gradientActions:[{kind:'start',config:{mode:'hue_rotate',speed:37,interpolation:'oklab'}},{kind:'stop'}]});
  expect(result.scene.timeline.schedule).toBe('roots-scene-sequence-v1');
  const reloaded=save(result.scene);expect(reloaded.provenance!.original).toEqual({...header,camera:{phi:0},timeline});
  expect(reloaded.timeline.tracks[0].actions![0].gradient).toMatchObject({model:'offsets',speed:37,affectInside:true,affectOutside:true});
 });
 it('ignores authored absolute starts, repeats, labels and local aliases instead of interpreting them twice',()=>{
  const result=load([animate([{method:'ambient',args:[1,0]}],{start:999,repeat:9,pingPong:true,label:{unknown:true},Duration:90})]);
  expect(result.scene.timeline.tracks[0]).toMatchObject({start:0,duration:1,pingPong:false,label:'animate'});
  const unmapped=result.warnings.filter(w=>w.startsWith('以下字段尚未映射')).join('\n');
  for(const name of ['start','repeat','pingPong','label','Duration'])expect(unmapped).toContain(name);
 });
 it('runs imported/saved source frames through sceneAtTime and keeps the authored camera unchanged',()=>{
  const scene=load([animate([{method:'ambient',args:[1,0,0]}]),animate([{method:'stopAmbient'}],{duration:.5})]).scene;
  scene.timeline.fps=4;const baseline=structuredClone(scene.rootsPresentation!.camera),reloaded=save(scene);
  const expected=[.0625,.1875,.375,.625,.75,.75,.75];
  expected.forEach((phi,i)=>{expect(at(scene,i/4).phi).toBe(phi);expect(at(reloaded,i/4).phi).toBe(phi);});
  expect(scene.rootsPresentation!.camera).toEqual(baseline);
  const evaluated=sceneAtTime(scene,.75);expect(evaluated.rootsPresentation!.camera).toEqual(baseline);
  expect(save(evaluated).rootsPresentation!.camera).toEqual(baseline);expect(save(evaluated).evaluatedRootsCamera).toBeUndefined();
  expect(at(scene,.25).phi).toBe(.1875);
 });
 it('preserves source non-unit easing zoom endpoint after reload',()=>{
  const scene=load([animate([{method:'zoom',args:[5]},{method:'ambient',args:[2,0,0]}],{easing:'THERE_AND_BACK'})]).scene;
  scene.timeline.fps=2;
  expect(at(scene,0)).toMatchObject({phi:1,zoom:5});
  expect(at(save(scene),.5)).toMatchObject({phi:2,zoom:1});
 });
 it('reports scalar capacity instead of silently choosing source defaults',()=>{
  expect(()=>load([animate([],{duration:'1'.repeat(65537)})])).toThrow('容量');
  expect(()=>load([animate([{method:'zoom',args:['1'.repeat(65537)]}])])).toThrow('容量');
 });
});

describe('Roots timeline registered numeric lexemes',()=>{
 it('retains negative overflow duration token through finite clamp, save, and reload',()=>{
  const scene=literal('[{"type":"animate","duration":-1e999,"actions":[]}]').scene;
  expect(scene.timeline.tracks[0].duration).toBe(F(.001));
  const record={path:['timeline','0','duration'],token:'-1e999'};
  expect(scene.provenance!.sourceNumberTokens).toContainEqual(record);
  expect(save(scene).provenance!.sourceNumberTokens).toContainEqual(record);
  expect(save(scene).timeline).toEqual(scene.timeline);
 });
 it('rejects positive overflow duration but retains registered dormant/unknown original lexemes',()=>{
  expect(()=>literal('[{"duration":1e999}]')).toThrow('有限');
  const scene=literal('[{"enabled":false,"duration":1e999,"actions":[{"method":"zoom","args":[-0,1.0,9007199254740993]}]},{"type":"UNKNOWN","duration":-1e999,"actions":[{"method":"UNKNOWN","args":[1e999]}]}]').scene;
  expect(scene.timeline.tracks).toEqual([]);
  const records=[
   {path:['timeline','0','duration'],token:'1e999'},
   {path:['timeline','0','actions','0','args','0'],token:'-0'},
   {path:['timeline','0','actions','0','args','1'],token:'1.0'},
   {path:['timeline','0','actions','0','args','2'],token:'9007199254740993'},
   {path:['timeline','1','duration'],token:'-1e999'},
   {path:['timeline','1','actions','0','args','0'],token:'1e999'},
  ];
  expect(scene.provenance!.sourceNumberTokens!.filter(r=>r.path[0]==='timeline')).toEqual(records);
  expect(save(scene).provenance!.sourceNumberTokens!.filter(r=>r.path[0]==='timeline')).toEqual(records);
 });
 it('exposes the same token facts through both import adapters',()=>{
  const text=JSON.stringify({...header,timeline:[animate([{method:'zoom',args:[2]}])]});
  expect(parseLegacyScene(text).sourceNumberTokens).toEqual(parseProjectFile(text).scene.provenance!.sourceNumberTokens);
 });
 it.each([
  ['timeline','1000','duration'],['timeline','00','duration'],['timeline','-1','duration'],['timeline','0','start'],
  ['timeline','0','actions','64','args','0'],['timeline','0','actions','0','args','3'],['timeline','0','actions','0','value'],
 ].map(path=>[path]))('rejects unregistered or out-of-budget numeric provenance path %j',path=>{
  const scene=load([]).scene;scene.provenance!.sourceNumberTokens=[{path,token:'1'}];
  expect(()=>save(scene)).toThrow('字段路径');
 });
 it('rejects duplicate registered slots and malformed number tokens',()=>{
  const scene=load([]).scene,record={path:['timeline','0','duration'],token:'1'};
  scene.provenance!.sourceNumberTokens=[record,record];expect(()=>save(scene)).toThrow('重复');
  scene.provenance!.sourceNumberTokens=[{...record,token:'01'}];expect(()=>save(scene)).toThrow('JSON 数字');
 });
});
