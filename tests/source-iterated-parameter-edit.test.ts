import {describe,it,expect} from 'vitest';
import {parseLegacyScene,parseProjectFile} from '../src/engine/legacyImport';
import {sourceIteratedParameterChanges} from '../src/engine/sourceIteratedParameterEdit';
import {editSourceMapScene} from '../src/engine/sourceMapScene';
import {editSourceSymmetryConfiguration} from '../src/engine/sourceSymmetryConfig';
import {SourceIteratedTimelineSession} from '../src/engine/sourceIteratedTimeline';
const make=(family:'map'|'symmetry',template='standard')=>(family==='map'?parseLegacyScene:parseProjectFile)(JSON.stringify({config_version:'1.0.0',type:family==='map'?'MAP_ATTRACTOR':'SYMMETRY_CHAOS',name:'hot parameters',parameters:{gain:.001,symmetry_degree:3,delta_power:1},equations:{x_next:' x+gain ',y_next:' y '},equation:{template},settings:{batch_size:4,burn_in_steps:2},timeline:[]})).scene;
const edit=(s:ReturnType<typeof make>,parameters:typeof s.parameters)=>s.kind==='map'?editSourceMapScene(s,{...s,parameters},'parameters'):editSourceSymmetryConfiguration(s,{...s,parameters},'parameters');
describe('ordinary iterated parameter edit ownership',()=>{
 for(const family of ['map','symmetry'] as const)it(family+' admits only existing finite value changes and preserves pending display acknowledgement',()=>{
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
  const modified=make('symmetry','modified');expect(sourceIteratedParameterChanges(modified,edit(modified,{...modified.parameters,delta_power:2}))).toBeUndefined();
 });
});
