import {describe,it,expect} from 'vitest';
import fixture from './fixtures/source-attractor/parameter-boundary.json';
import {prepareSourceAttractorEquation} from '../src/engine/sourceAttractorEquation';
import {importSourceAttractorConfig} from '../src/engine/sourceAttractorConfig';
import {SourceAttractorCpuParticles} from '../src/engine/sourceAttractorCpuParticles';
import {parseProjectFile} from '../src/engine/legacyImport';
import {parseScene,serializeScene} from '../src/engine/document';
import {generateScene} from '../src/engine/temporal';
import {ordinarySourceViewport} from '../src/engine/ordinarySourceCamera';
import {resolveTimeline} from '../src/engine/timeline';

const native=(timeline:unknown[])=>({config_version:'1.0',type:'ATTRACTOR',name:'Native dispatch',
 equations:{dx:'a',dy:'0',dz:'0'},parameters:{a:2},
 settings:{particle_count_cpu:1,sub_steps:2,time_step:.125,show_trails:true,scale_x:1,scale_y:1,scale_z:1},
 initialization:{warmup_steps:0,bounds:{min_x:0,max_x:0,min_y:0,max_y:0,min_z:0,max_z:0}},timeline});
const importTimeline=(timeline:unknown[])=>parseProjectFile(JSON.stringify(native(timeline)));
const render=(scene:ReturnType<typeof importTimeline>['scene'],time:number)=>{
 const output=generateScene(scene,{time,width:32,height:24,quality:'export',sourceViewport:ordinarySourceViewport(scene,32,24,'primary',24)});
 if(output.type!=='geometry')throw Error('Expected geometry');
 const {elapsedMs:_elapsed,...stats}=output.stats;return{...output,stats};
};

describe('ordinary Attractor source dispatcher does not invent parameter animation',()=>{
 it.each(fixture.dispatch)('matches pinned native dispatcher: $id',row=>{
  if(row.expected.error){expect(()=>importTimeline(row.timeline)).toThrow(/method/);return;}
  const {scene}=importTimeline(row.timeline);
  const queue=scene.timeline.tracks.map(track=>track.type==='animate'&&track.actions?.length?{type:'animate',duration:track.duration,actions:track.actions.map(({method,args})=>({method,args}))}:{type:'wait',duration:track.duration});
  expect(queue).toEqual(row.expected.queue);expect(scene.parameters).toEqual({a:2});
 });
 it.each(fixture.equationCaptures)('captures $parameter=$initialDouble before later configuration-map writes',row=>{
  const parameters:Record<string,number>={[row.parameter]:row.initialDouble};
  const equation=prepareSourceAttractorEquation({equations:{dx:row.equationDx,dy:'0',dz:'0'},parameters});
  if(!equation.ok)throw Error(equation.error.reason);
  Object.assign(parameters,row.configMapAfterConstruction);
  const derivative=new Float32Array(3);equation.value.create().compute(row.initialX,0,0,derivative);expect(derivative[0]).toBe(row.expected.derivativeFloat);
  const config=importSourceAttractorConfig({particle_count_cpu:1,sub_steps:row.substepsPerActiveFrame,time_step:row.dt},{warmup_steps:row.warmupSteps,bounds:{min_x:row.initialX,max_x:row.initialX,min_y:0,max_y:0,min_z:0,max_z:0}});
  if(!config.ok)throw Error(config.error.reason);
  const owner=new SourceAttractorCpuParticles({configuration:config.value.configuration,equation:equation.value});
  expect(owner.snapshot().rawPositions[0]).toBe(row.expected.afterWarmupX);
  for(const [frameIndex,x]of row.expected.frameX.entries()){
   owner.update({frameIndex,time:frameIndex/4,deltaTime:.25});expect(owner.snapshot().rawPositions[0]).toBe(x);
  }
 });
 it('skips unsupported clips before reading their duration, easing, parameters or actions',()=>{
  const ignored={type:'param',duration:{invalid:true},easing:[],parameters:null,actions:false};
  const source=native([ignored,{type:'wait',duration:.5}]),result=parseProjectFile(JSON.stringify(source));
  expect(result.scene.timeline.tracks.map(t=>[t.type,t.duration])).toEqual([['wait',.5]]);
  expect(result.warnings.join('\n')).toContain('不读取其时长或参数');
  expect(result.scene.provenance!.original).toEqual(source);
  expect(parseScene(serializeScene(result.scene)).provenance).toEqual(result.scene.provenance);
  expect(resolveTimeline(result.scene).tracks[0].start).toBe(0);
 });
 it('retains an unknown-only animate as its full-duration empty camera group',()=>{
  const unknownArgs=Array.from({length:129},()=>({invalidParameter:{min:'(',max:null,step:[]}}));
  const raw={type:'animate',duration:.25,easing:'LINEAR',actions:[{method:'paramStart',args:unknownArgs},{method:'paramStop',args:null},{method:'',args:false}]};
  const {scene,warnings}=importTimeline([raw,{type:'wait',duration:.5}]);
  scene.timeline.fps=4;
  expect(scene.timeline.tracks[0]).toMatchObject({type:'animate',duration:.25,actions:[]});
  expect(resolveTimeline(scene).tracks.map(t=>t.start)).toEqual([0,.25]);
  expect(warnings.join('\n')).toContain('原版 ATTRACTOR 未分派该方法');
  expect((scene.provenance!.original as ReturnType<typeof native>).timeline[0]).toEqual(raw);
  const clean=importTimeline([{...raw,actions:[]},{type:'wait',duration:.5}]).scene;clean.timeline.fps=4;
  for(const [time,x]of [[0,.5],[.25,1],[.5,1.5],[.75,1.5],[2,1.5]]){
   const actual=render(scene,time);expect(actual.positions[0]).toBe(x);expect(actual).toEqual(render(clean,time));
  }
  expect(scene.parameters).toEqual({a:2});
 });
 it('keeps mixed real actions, ignores unknown payloads and does not parse unused known-argument tails',()=>{
  const tail=Array.from({length:129},()=>({value:'not an expression'}));
  const ignored={method:'paramStart',args:tail};
  const known=[{method:'rotatePhi',args:[.5,...tail]},{method:'setRates',args:[.1,.2,.3,...tail]},{method:'track',args:[0,...tail]},{method:'gradientStart',args:{speed:30}}];
  const clips=[{type:'param',duration:500,parameters:{a:{min:50,max:100,step:10}}},{type:'animate',duration:.5,easing:'LINEAR',actions:[ignored,...known,{method:'paramStop',args:[null]}]},{type:'wait',duration:.5}];
  const {scene}=importTimeline(clips),clean=importTimeline([{...clips[1],actions:known.map(a=>({...a,args:Array.isArray(a.args)?a.args.slice(0,a.method==='setRates'?3:1):a.args}))},clips[2]]).scene;
  expect(scene.timeline.tracks[0].actions!.map(a=>a.method)).toEqual(['rotatePhi','ambient','track','gradientStart']);
  for(const time of [0,.25,.75,2,.25])expect(render(scene,time)).toEqual(render(clean,time));
 });
 it('still rejects malformed action envelopes, missing methods and malformed consumed scalar slots',()=>{
  for(const actions of [[null],[{args:[]}],[{method:null,args:[]}],false])expect(()=>importTimeline([{type:'animate',actions}])).toThrow();
  expect(()=>importTimeline([{type:'animate',actions:[{method:'rotatePhi',args:[1e40]}]}])).toThrow();
  // Disabled source clips never inspect the type or any child payload.
  expect(importTimeline([{enabled:false,type:null,duration:[],actions:17}]).scene.timeline.tracks).toEqual([]);
 });
});
