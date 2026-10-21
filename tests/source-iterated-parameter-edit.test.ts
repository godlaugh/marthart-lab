import {describe,it,expect} from 'vitest';
import {parseLegacyScene,parseProjectFile} from '../src/engine/legacyImport';
import {sourceIteratedParameterChanges} from '../src/engine/sourceIteratedParameterEdit';
import {editSourceMapScene} from '../src/engine/sourceMapScene';
import {editSourceSymmetryConfiguration} from '../src/engine/sourceSymmetryConfig';
import {SourceIteratedTimelineSession} from '../src/engine/sourceIteratedTimeline';
const make=(family:'map'|'symmetry',template='standard')=>(family==='map'?parseLegacyScene:parseProjectFile)(JSON.stringify({config_version:'1.0.0',type:family==='map'?'MAP_ATTRACTOR':'SYMMETRY_CHAOS',name:'hot parameters',parameters:{gain:.001,symmetry_degree:3,delta_power:1},equations:{x_next:' x+gain ',y_next:' y '},equation:{template},settings:{batch_size:4,burn_in_steps:2},timeline:[]})).scene;
const edit=(s:ReturnType<typeof make>,parameters:typeof s.parameters)=>s.kind==='map'?editSourceMapScene(s,{...s,parameters},'parameters'):editSourceSymmetryConfiguration(s,{...s,parameters},'parameters');
describe('ordinary iterated parameter edit ownership',()=>{
 for(const family of ['map','symmetry'] as const)it(family+' admits finite value changes and preserves pending display acknowledgement',()=>{
  const s=make(family),next=edit(s,{...s.parameters,gain:.2});
  expect(sourceIteratedParameterChanges(s,next)).toEqual([['gain',.2]]);
  expect(sourceIteratedParameterChanges(s,{...next,settings:{...next.settings,pointSize:17}})).toBeUndefined();
  expect(sourceIteratedParameterChanges(s,edit(s,{...s.parameters,newKey:1}))).toBeUndefined();
  expect(sourceIteratedParameterChanges(s,{...next,parameters:{...next.parameters,gain:NaN}})).toBeUndefined();
  const t=new SourceIteratedTimelineSession(s);t.step(.01);const before=t.snapshot();t.writeParameters([['gain',.2]]);
  expect(t.snapshot().frame).toEqual(before.frame);expect(t.snapshot().parameters).toEqual({values:{...before.parameters!.values,gain:.2},changed:false});
  expect(t.step(0,{paused:true,acknowledgeParameters:false}).parameters!.changed).toBe(false);
  expect(t.step(0,{paused:true}).parameters!.changed).toBe(true);
  expect(t.step(.01).parameters!.changed).toBe(false);t.reset();
 });
 it('preserves explicit authored-equal writes and raw standard delta uniforms',()=>{
  const scene=make('symmetry'),next=edit(scene,{...scene.parameters,delta_power:2.25});
  expect(next.parameters.delta_power).toBe(2.25);expect(sourceIteratedParameterChanges(scene,next)).toEqual([['delta_power',2.25]]);
  expect(sourceIteratedParameterChanges(scene,scene,[['gain',scene.parameters.gain]])).toEqual([['gain',scene.parameters.gain]]);
  expect(sourceIteratedParameterChanges(scene,scene,[['gain',999]])).toBeUndefined();
 });
 it('ignores Java-blank setter names without acknowledging a changed display',()=>{
  const scene=make('map');scene.parameters[' ']=1;const t=new SourceIteratedTimelineSession(scene);t.step(0,{paused:true});t.writeParameters([[' ',2]]);expect(t.step(0,{paused:true}).parameters).toMatchObject({changed:false,values:{' ':1}});t.reset();
 });
 it('keeps raw Map equations and parameter order on value writes',()=>{
  const s=make('map'),next=edit(s,{...s.parameters,gain:-.2});
  expect(next.mapSource!.construction.equations).toEqual(s.mapSource!.construction.equations);
  expect(next.mapSource!.construction.parameters.map(([k])=>k)).toEqual(s.mapSource!.construction.parameters.map(([k])=>k));
 });
 it('distinguishes ordinary degree uniform from modified structural delta power',()=>{
  const s=make('symmetry'),next=edit(s,{...s.parameters,symmetry_degree:5});
  expect(sourceIteratedParameterChanges(s,next)).toEqual([['symmetry_degree',5]]);
  const modified=make('symmetry','modified');expect(()=>edit(modified,{...modified.parameters,delta_power:2})).toThrow('结构参数');
  const applied=editSourceSymmetryConfiguration(modified,{...modified,parameters:{...modified.parameters,delta_power:2}});expect(sourceIteratedParameterChanges(modified,applied,[['delta_power',2]])).toBeUndefined();
 });
 for(const family of ['map','symmetry'] as const)it(family+' requires explicit admission for a new running parameter and preserves raw construction facts',()=>{
  const before=make(family),snapshot=structuredClone(before),next=edit(before,{...before.parameters,delta:2.25});
  expect(before).toEqual(snapshot);
  expect(sourceIteratedParameterChanges(before,next)).toBeUndefined();
  expect(sourceIteratedParameterChanges(before,next,[['delta',2.25]])).toEqual([['delta',2.25]]);
  expect(sourceIteratedParameterChanges(before,next,[['delta',2]])).toBeUndefined();
  const old=before.mapSource??before.symmetrySource!,configuration=next.mapSource??next.symmetrySource!;
  expect(configuration.construction.parameters).toEqual([...old.construction.parameters,['delta',2.25]]);
  expect(configuration.editorParameters).toEqual([...old.editorParameters!,['delta',2.25]]);
  if(family==='map')expect(next.mapSource!.construction.equations).toEqual(before.mapSource!.construction.equations);
  else expect(next.settings.template).toBe('standard');
  const t=new SourceIteratedTimelineSession(before);t.step(0,{paused:true});const frame=t.snapshot().frame;
  t.writeParameters([['delta',2.25]]);
  expect(t.snapshot().frame).toEqual(frame);expect(t.snapshot().parameters!.values.delta).toBe(2.25);
  const paused=t.step(0,{paused:true});expect(paused.frame.sceneTime).toBe(0);expect(paused.update.calls).toEqual([]);expect(paused.parameters!.changed).toBe(true);
  expect(t.step(0,{paused:true}).parameters!.changed).toBe(false);t.reset();
 });
 for(const family of ['map','symmetry'] as const)it(family+' rejects deletion, nonfinite writes and mixed construction edits before mutating the input',()=>{
  const before=make(family),snapshot=structuredClone(before),removed={...before.parameters};delete removed.gain;
  expect(()=>edit(before,removed)).toThrow('不能删除');
  expect(sourceIteratedParameterChanges(before,{...before,parameters:removed},[['gain',0]])).toBeUndefined();
  expect(()=>edit(before,{...before.parameters,delta:Infinity})).toThrow();
  const candidate={...before,parameters:{...before.parameters,delta:2.25},settings:{...before.settings,batchSize:8}};
  expect(()=>family==='map'?editSourceMapScene(before,candidate,'parameters'):editSourceSymmetryConfiguration(before,candidate,'parameters')).toThrow('构造字段');
  expect(before).toEqual(snapshot);
  const t=new SourceIteratedTimelineSession(before);t.step(0,{paused:true});const initial=t.snapshot();
  expect(()=>t.writeParameters([['delta',2.25],['bad',Infinity]])).toThrow();expect(t.snapshot()).toEqual(initial);
  t.writeParameters([[' ',2.25]]);expect(t.snapshot().parameters!.values).not.toHaveProperty(' ');t.reset();
 });
 it('keeps generic delta_power raw on the running standard template even when a draft is pending',()=>{
  const before=make('symmetry'),next={...before,parameters:{...before.parameters,delta_power:2.25}};
  // Opaque staging metadata is owned by another module, not this classifier.
  Object.defineProperty(next,'iteratedDraft',{value:{kind:'pending-template'},enumerable:true});
  const changed=editSourceSymmetryConfiguration(before,next,'parameters');
  expect(changed.parameters.delta_power).toBe(2.25);expect(changed.settings.template).toBe('standard');
  expect(sourceIteratedParameterChanges(before,changed,[['delta_power',2.25]])).toEqual([['delta_power',2.25]]);
 });

});
