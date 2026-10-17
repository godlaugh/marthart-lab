import {describe,it,expect} from 'vitest';
import {createScene,parseScene,persistentScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {sceneAtTime,timelineControlsTarget,domainParameterFrame,readDomainParameterScalar,validateDomainParameterActions} from '../src/engine/timeline';
import {DomainParameterTimeline} from '../src/engine/domainParameterTimeline';
import {domainParameterBinding,normalizedDomainParameterValue} from '../src/engine/domainParameterBinding';
import {easingCurve} from '../src/engine/timeline';
import type {AnimationAction,DomainParameterAction,SceneDocument} from '../src/types';

const scope=(name?:string):DomainParameterAction['scope']=>name===undefined?{kind:'all'}:{kind:'named',name};
const start=(name?:string,step=.1,min=-1,max=1):AnimationAction=>({id:crypto.randomUUID(),method:'paramStart',domainParameters:[{model:'domain-registry-1.7.8',scope:scope(name),...(name===undefined?{}:{configuration:{step,min,max,edgeEasing:{window:.5,floor:1,easing:'linear'}}})}]});
const stop=(name?:string):AnimationAction=>({id:crypto.randomUUID(),method:'paramStop',domainParameters:[{model:'domain-registry-1.7.8',scope:scope(name)}]});
function fixture(groups:{at:number;duration?:number;easing?:string;actions:AnimationAction[]}[],parameters:Record<string,number>={a:0,b:0}):SceneDocument {
 const scene=createScene(definition('domain'));scene.parameters=parameters;scene.timeline.duration=10;
 scene.timeline.tracks=groups.map(g=>({id:crypto.randomUUID(),type:'animate',target:'camera.actions',from:0,to:0,pingPong:false,repeat:1,enabled:true,start:g.at,duration:g.duration??0,easing:g.easing??'linear',actions:g.actions}));return scene;
}
const facts=(scene:SceneDocument,t:number)=>domainParameterFrame(sceneAtTime(scene,t))!;
const entry=(scene:SceneDocument,t:number,name='a')=>facts(scene,t).entries.find(e=>e.name===name)!;
// Independent neutral-edge fixed-grid reference. The positive dt is passed as
// a Java float, while the configured float step is promoted back to double.
function neutral(phase:number,step:number,seconds:number,half=1){
 const count=Math.floor(seconds*60+1e-9);for(let n=0;n<count;n++)phase=(phase+Math.abs(Math.fround(step))/half*(Math.fround(1/60)*60))%(2*Math.PI);
 const rest=seconds-count/60;if(rest>1e-12)phase=(phase+Math.abs(Math.fround(step))/half*(Math.fround(rest)*60))%(2*Math.PI);return phase;
}
describe('source Domain registry state ownership',()=>{
 it('starts empty, keeps first-frame raw values and produces shared binding facts after positive dt',()=>{
  const all=fixture([{at:0,actions:[start()]}]);expect(facts(all,2)).toMatchObject({running:true,entries:[]});
  const scene=fixture([{at:0,actions:[start('a')]}],{a:8});expect(sceneAtTime(scene,0).parameters.a).toBe(8);expect(entry(scene,0)).toMatchObject({written:false,gain:1});
  expect(sceneAtTime(scene,1/60).parameters.a).toBeCloseTo(Math.sin(neutral(-Math.PI/2,.1,1/60)),13);
 });
 it('distinguishes StartAll while running from StopAll followed by StartAll, retaining named configuration',()=>{
  const make=(all:boolean)=>fixture([{at:0,actions:[start('a')]},{at:.5,actions:[stop(all?undefined:'a')]},{at:1,actions:[start()]}]);
  const heldPhase=neutral(0,.1,.5),held=Math.sin(heldPhase),named=make(false),global=make(true);
  expect(entry(named,.75).phase).toBeCloseTo(heldPhase,12);expect(facts(named,.75).running).toBe(true);expect(facts(global,.75).running).toBe(false);
  expect(sceneAtTime(named,1.1).parameters.a).toBeCloseTo(Math.sin(neutral(heldPhase,.1,.1)),11);
  expect(sceneAtTime(global,1.1).parameters.a).toBeCloseTo(Math.sin(neutral(Math.asin(held),.1,.1)),11);
  expect(entry(global,1.1)).toMatchObject({minimum:-1,maximum:1,step:Math.fround(.1)});
 });
 it('same-group named replacement syncs from a shared raw value and last config wins without synthetic t0 writes',()=>{
  const scene=fixture([{at:0,actions:[start('a',.02,-2,2),start('a',-.02,-3,3)]}],{a:8});
  expect(sceneAtTime(scene,0).parameters.a).toBe(8);
  expect(sceneAtTime(scene,1).parameters.a).toBeCloseTo(3*Math.sin(neutral(Math.PI/2,-.02,1,3)),12);
 });
 it('StopAll captures update names, but finish stops parameters registered during its release',()=>{
  const scene=fixture([{at:0,actions:[start('a')]},{at:1,duration:2,actions:[stop()]},{at:1.5,actions:[start('b')]}]);
  expect(entry(scene,2,'a').gain).toBe(.5);expect(entry(scene,2,'b').gain).toBe(1);
  expect(facts(scene,3)).toMatchObject({running:false});expect(entry(scene,3,'b').gain).toBe(0);
  expect(sceneAtTime(scene,4).parameters).toEqual(sceneAtTime(scene,3).parameters);
 });
 it('StartAll updates the current registry and named stop while already stopped does nothing',()=>{
  const scene=fixture([{at:0,actions:[start('a')]},{at:1,actions:[stop()]},{at:1.2,duration:3,actions:[stop('a')]},{at:2,duration:4,actions:[start()]},{at:3,actions:[start('b')]}]);
  expect(entry(scene,4,'a').gain).toBe(.5);expect(entry(scene,4,'b').gain).toBe(.5);
  expect(entry(scene,6,'a').gain).toBe(1);expect(facts(scene,6).running).toBe(true);
 });
 it('source finish overrides an easing endpoint other than 1 and overshoot is not upper clamped',()=>{
  const scene=fixture([{at:0,duration:1,easing:'back-out',actions:[start('a',.001)]},{at:2,duration:1,easing:'there-and-back',actions:[stop('a')]}]);
  expect(entry(scene,.7).gain).toBeGreaterThan(1);expect(entry(scene,1).gain).toBe(1);expect(entry(scene,3).gain).toBe(0);expect(facts(scene,3).running).toBe(true);
  const startBack=fixture([{at:0,duration:1,easing:'there-and-back',actions:[start('a',.001)]}]);expect(entry(startBack,1).gain).toBe(1);
 });
 it('uses exact own names with no dotted aliases or prototype semantics and preserves unknown first writes',()=>{
  const names=['a.b','a_b','aB','constructor','__proto__','prototype','中文','\u00a0','   '];
  const scene=fixture([{at:0,actions:names.map(n=>start(n,.01,2,2))}],Object.fromEntries(names.map((n,i)=>[n,i+10])));
  const value=sceneAtTime(scene,.1);for(const name of names.filter(n=>n!=='   ')){expect(Object.hasOwn(value.parameters,name)).toBe(true);expect(value.parameters[name]).toBe(2);}
  expect(value.parameters['   ']).toBe(18);expect({}.hasOwnProperty.call(value.parameters,'__proto__')).toBe(true);
  const missing=fixture([{at:0,actions:[start('new.name',.01,2,3)]}],{});expect(Object.hasOwn(sceneAtTime(missing,0).parameters,'new.name')).toBe(false);expect(sceneAtTime(missing,.1).parameters['new.name']).toBeGreaterThan(2);
 });
 it('special exact names take precedence, normalize once and register navigation control only after a write',()=>{
  const scene=fixture([{at:0,actions:[start('scale',0,-2,-2),start('phaseDensity',0,-2,-2)]}],{scale:77,phaseDensity:88});scene.settings.scale=4;scene.settings.phaseDensity=20;scene.settings.curveBias=5;scene.settings.curveMix=-1;scene.settings.modSharpness=-3;
  const initial=sceneAtTime(scene,0),value=sceneAtTime(scene,.1);expect(readDomainParameterScalar(initial,'phaseDensity')).toBe(20);
  expect(value.parameters).toEqual({scale:77,phaseDensity:88});expect(value.settings.scale).toBe(1e-9);expect(value.settings.phaseDensity).toBe(12);
  expect(value.settings.curveBias).toBe(1);expect(value.settings.curveMix).toBe(0);expect(value.settings.modSharpness).toBe(1);
  expect(timelineControlsTarget(initial,'settings.scale')).toBe(false);expect(timelineControlsTarget(value,'settings.scale')).toBe(true);
  const binding=domainParameterBinding('phaseDensity');expect(normalizedDomainParameterValue(binding,1e40,7)).toBe(7);expect(normalizedDomainParameterValue(binding,NaN,7)).toBe(7);expect(normalizedDomainParameterValue(binding,-1,7)).toBe(12);
 });
 it('reproduces fractional/warm/backward/save reload while bounded checkpoints never store a fractional request',()=>{
  const scene=fixture([{at:0,actions:[start('a',.02)]},{at:.55,duration:.2,actions:[stop('a')]},{at:1,actions:[start()]}]);
  const restored=parseScene(JSON.stringify(persistentScene(scene))),raw=JSON.stringify(scene);
  const expected=new Map([.0333333333333333,.037,1.2,.2,2,.55].map(t=>[t,sceneAtTime(restored,t).parameters.a]));
  for(const time of [2,.037,.2,1.2,.0333333333333333,.55,2])expect(sceneAtTime(scene,time).parameters.a).toBe(expected.get(time));
  expect(JSON.stringify(scene)).toBe(raw);expect(JSON.stringify(restored)).not.toContain('running');
  const owner=new DomainParameterTimeline(easingCurve);owner.appendGroup(0,0,'linear',[start('a')],scene);for(let i=1;i<30;i++)owner.sample(i/10+.001);
  expect(owner.diagnostics().checkpoints).toBeLessThanOrEqual(8);expect(owner.diagnostics().estimatedCacheBytes).toBeLessThanOrEqual(4*1024*1024);
 });
 it('captures prior numeric plans at the next group and retains stable local mixed-plan precedence',()=>{
  const scene=fixture([{at:0,actions:[start('a')]},{at:3,actions:[start('a',-.01)]}]);
  scene.timeline.tracks.splice(1,0,{id:'numeric',type:'numeric',target:'parameters.a',start:1,duration:1,easing:'linear',from:0,to:.5,enabled:true,pingPong:false,repeat:1});
  expect(sceneAtTime(scene,1.5).parameters.a).toBe(.25);expect(sceneAtTime(scene,3).parameters.a).toBe(.5);
  expect(sceneAtTime(scene,3.1).parameters.a).toBeCloseTo(Math.sin(neutral(Math.PI-Math.asin(.5),-.01,.1)),12);
  expect(sceneAtTime(scene,.1).parameters.a).toBeCloseTo(Math.sin(neutral(0,.1,.1)),12);
 });
 it('validates one explicit interpretation and keeps the source 128 operations inside one action',()=>{
  expect(()=>validateDomainParameterActions(start('a').domainParameters,'zoom','domain')).toThrow();expect(()=>validateDomainParameterActions(start('a').domainParameters,'paramStart','surface')).toThrow();
  expect(()=>validateDomainParameterActions([{model:'domain-registry-1.7.8',scope:{kind:'named',name:'a'}}],'paramStart','domain')).toThrow();
  const many=Array.from({length:128},(_,i)=>start(String(i)).domainParameters![0]);const scene=fixture([{at:0,actions:[{...start(),domainParameters:many}]}]);expect(facts(scene,.1).entries).toHaveLength(128);
  expect(()=>validateDomainParameterActions([...many,many[0]],'paramStart','domain')).toThrow();
  const none=fixture([{at:0,actions:[{...start(),domainParameters:[]}]},{at:1,actions:[{...stop(),domainParameters:[]}]}]);
  const restored=parseScene(JSON.stringify(none));expect(restored.timeline.tracks[0].actions![0].domainParameters).toEqual([]);expect(domainParameterFrame(sceneAtTime(restored,2))).toBeUndefined();expect(sceneAtTime(restored,2).parameters).toEqual(none.parameters);
 });
 it('rejects non-progressing or excessive source phase reduction without manufacturing a modulo trajectory',()=>{
  expect(()=>sceneAtTime(fixture([{at:0,actions:[start('a',1e38)]}]),1/60)).toThrow('约简无法推进');
  expect(()=>sceneAtTime(fixture([{at:0,actions:[start('a',1e10)]}]),1/60)).toThrow('2000万');
  const safe=fixture([{at:0,actions:[start('a',100)]}]);let phase=Math.fround(100)*(Math.fround(1/60)*60);while(phase>2*Math.PI)phase-=2*Math.PI;
  expect(entry(safe,1/60).phase).toBe(phase);
 });
});
