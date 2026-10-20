import {describe,it,expect} from 'vitest';
import {parseLegacyScene,parseProjectFile} from '../src/engine/legacyImport';
import {parseScene,serializeScene} from '../src/engine/document';
import {importSourceSamilaTimeline} from '../src/engine/sourceSamilaTimelineImport';
import {sceneAtTime} from '../src/engine/timeline';
import {samilaCameraFrame} from '../src/engine/samilaCamera';
import {withoutEditableParameter} from '../src/engine/parameterEditing';
import {parameterTimelineReferences} from '../src/engine/sceneParameters';
const raw=(timeline?:unknown)=>({config_version:'1.0.0',type:'SAMILA',name:'Source queue',equations:{f1:'a+x',f2:'y'},parameters:{a:.2},settings:{batch_size:8,render_mode:'CPU'},...(timeline===undefined?{}:{timeline})});
const parse=(timeline?:unknown)=>parseProjectFile(JSON.stringify(raw(timeline)));
describe('source Samila timeline import',()=>{
 it('opts only new imports into the queue and keeps old saved math versions unchanged',()=>{
  const source=JSON.stringify(raw([{type:'wait',duration:1}])),fresh=parseProjectFile(source).scene,old=parseLegacyScene(source,{samilaTimeline:'legacy-v1'}).scene;
  expect(fresh.timeline.schedule).toBe('samila-scene-sequence-v1');expect(old.timeline.schedule).toBeUndefined();expect(old.settings.samilaMathModel).toBe('mathart-1.7.8');
  expect(parseScene(serializeScene(old)).timeline).toEqual(old.timeline);
  expect(parse().scene.timeline.tracks).toEqual([]);
 });
 it('keeps unknown types including align/param/trails as waits without reading dormant values',()=>{
  const {scene}=parse(['align','param','trails','mystery'].map(type=>({type,duration:0,target_theta:2,parameters:'bad',enable:false,easing:'bad'})));
  expect(scene.timeline.tracks.map(t=>[t.type,t.duration,t.start])).toEqual(Array.from({length:4},()=>['wait',0,0]));
  const evaluated=sceneAtTime(scene,1);expect(evaluated.parameters.a).toBe(.2);expect(samilaCameraFrame(evaluated)?.theta).toBe(0);
 });
 it('uses source scalar expressions without parameter scope and exact easing lookup',()=>{
  const {scene}=parse([{duration:'PI/2'},{type:'animate',duration:'a',easing:'sine_in',actions:[]},{type:'animate',duration:-2,easing:'LINEAR',actions:[]}]);
  expect(scene.timeline.tracks.map(t=>t.duration)).toEqual([Math.fround(Math.PI/2),1,-2]);
  expect(scene.timeline.tracks.map(t=>t.easing)).toEqual(['linear','sine-in-out','linear']);
 });
 it('ignores action enabled, requires argument containers and consumes only supported camera slots',()=>{
  const {scene}=parse([{type:'animate',duration:1,actions:[{method:'ambient',args:[.1,.2]},{method:'rotateTheta',args:[],enabled:false},{method:'rotatePhi',args:{}},{method:'stopAmbient'},{method:'RotateTheta',args:[9]},{method:'rotateTo',args:[1,2]},{method:'stopAmbient',args:[]}]}]);
  expect(scene.timeline.tracks[0].actions?.map(a=>[a.method,a.args])).toEqual([['ambient',{phiSpeed:Math.fround(.1),thetaSpeed:Math.fround(.2),gammaSpeed:0}],['rotateTheta',{angle:0}],['stopAmbient',{}]]);
 });
 it('parses dedicated parameter payloads with literal defaults and preserves raw number tokens',()=>{
  const json=JSON.stringify(raw([{type:'animate',duration:1,actions:[{method:'paramStart',args:[{targetDomain:'SYMMETRY_CHAOS',parameters:{a:{min:2,max:-2,step:'PI',enabled:false},b:{enable:false,min:'bad'},c:2}}]},{method:'paramStop',args:{}}]}]));
  const parsed=parseProjectFile(json),actions=parsed.scene.timeline.tracks[0].actions!;
  expect(actions[0].samilaParameters).toEqual({model:'samila-param-1.7.8',kind:'start',parameters:[{name:'a',min:-2,max:2,step:.001}]});
  expect(actions[1].samilaParameters).toEqual({model:'samila-param-1.7.8',kind:'stop',parameters:[]});
  expect(parsed.scene.provenance?.sourceNumberTokens).toContainEqual({path:['timeline','0','actions','0','args','0','parameters','a','min'],token:'2'});
  expect(parseScene(serializeScene(parsed.scene)).timeline).toEqual(parsed.scene.timeline);
 });
 it('skips disabled clips before malformed values but rejects malformed active source containers',()=>{
  expect(parse([{enabled:false,type:[],duration:'NaN',actions:null}]).scene.timeline.tracks).toEqual([]);
  for(const timeline of [null,[null],[{enabled:null}],[{type:'animate',actions:null}],[{type:'animate',actions:[{method:'paramStart',args:{parameters:null}}]}]])expect(()=>parse(timeline)).toThrow();
 });
 it('returns tagged capacity errors for aggregate work without parsing unknown actions as executable',()=>{
  const timeline=Array.from({length:65},()=>({type:'animate',actions:Array.from({length:64},()=>({method:'rotateTheta',args:[0]}))}));
  const result=importSourceSamilaTimeline(timeline,{numberToken:()=>undefined,memberKeys:()=>[]});expect(result).toMatchObject({ok:false,error:{kind:'capacity'}});
 });
 it('protects initial values used by source actions even with a dormant action switch',()=>{
  const {scene}=parse([{type:'animate',duration:1,actions:[{method:'paramStart',args:{parameters:{a:{}}}}]}]);
  scene.timeline.tracks[0].actions![0].enabled=false;
  expect(parameterTimelineReferences(scene)).toEqual([{target:'parameters.a',trackId:scene.timeline.tracks[0].id,kind:'value',enabled:true}]);
  expect(()=>withoutEditableParameter(scene,'a')).toThrow('仍被启用的动画引用');
  scene.timeline.tracks[0].enabled=false;expect(withoutEditableParameter(scene,'a').parameters).toEqual({});
  const stopped=parse([{type:'animate',actions:[{method:'paramStop',args:{parameters:{a:{}}}}]}]).scene;
  expect(parameterTimelineReferences(stopped)).toEqual([]);expect(withoutEditableParameter(stopped,'a').parameters).toEqual({});
 });
});
