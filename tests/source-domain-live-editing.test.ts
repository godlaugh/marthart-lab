import {describe,expect,it,vi} from 'vitest';
import type {GenerateContext,SceneDocument} from '../src/types';
import {SourceDomainLiveSession,type SourceDomainLiveContext,type SourceDomainNavigationEvent} from '../src/engine/sourceDomainLiveSession';
import {DomainRenderSession} from '../src/engine/domainRenderSession';
import {generateDomain} from '../src/engine/domain';
import {parseDomainCpuChainModel} from '../src/engine/domainModel';
import {parseProjectFile} from '../src/engine/legacyImport';
import {defaultFormulas} from '../src/engine/formulas';
import {SourceDomainHostSession} from '../src/engine/sourceDomainHostSession';
import {prepareSourceDomainScene} from '../src/engine/sourceDomainTimeline';

function scene(formula='z'){
 const s=parseProjectFile(JSON.stringify({config_version:'1.0.0',name:'Domain live editing',type:'DOMAIN_COLORING',domainColoring:{formula,parameters:{a:.2,b:.3}},timeline:[{type:'animate',duration:1,easing:'LINEAR',actions:[{method:'domainRotate',args:[.7]},{method:'paramStart',args:{parameters:{a:{min:-1,max:1,step:.02},scale:{min:1,max:3,step:.03}}}},{method:'gradientStart',args:{mode:'HUE_ROTATE',speed:60}}]},{type:'wait',duration:.2}]})).scene;
 Object.assign(s.settings,{domainRenderPolicy:'source-cpu-always-v1',centerX:.125,centerY:-.25,scale:2.5,constantReal:7,constantImag:8,seedMode:'CONSTANT_C'});
 Object.assign(s.parameters,{a:.2,b:.3});s.formulas=defaultFormulas();s.formulas.main.visible=true;return s;
}
const context=(changes:Partial<SourceDomainLiveContext>={},timestampMs=1000):GenerateContext&{domainLive:SourceDomainLiveContext}=>({time:0,quality:'preview',width:4,height:3,domainLive:{sessionId:'domain-edit',revision:0,clock:{paused:false,timestampMs},actualFrameRate:24,viewport:{logicalWidth:801,logicalHeight:603,pixelDensity:2},...changes}});
function setup(){
 const scenes:SceneDocument[]=[],sessions:DomainRenderSession[]=[];
 const render=vi.fn((s:SceneDocument,c:GenerateContext,owner:DomainRenderSession)=>{scenes.push(structuredClone(s));sessions.push(owner);return generateDomain(s,c,owner);});
 return{owner:new SourceDomainLiveSession(render),render,scenes,sessions};
}
const state=(f:ReturnType<typeof setup>)=>f.owner.diagnostics().host!;

describe('Domain completed-primary navigation and hot parameter boundary',()=>{
 it('uses retained logical dimensions for pan and renders a snapshot at the completed raster profile',()=>{
  const s=scene(),f=setup(),c=context({clock:{paused:true}}),initial=f.owner.generate(s,c),before=state(f);
  const staged=structuredClone(s);staged.equations.f='(';staged.formulas!.main.latex='staged';
  // Extra physical dimensions cannot override the primary's logical viewport.
  const event={kind:'pan' as const,dx:17,dy:-9,width:4,height:3};
  const out=f.owner.navigatePaused(staged,{...c,quality:'export'},event),after=state(f);
  expect(after.state.settings.centerX).toBe(.10244610342342458);expect(after.state.settings.centerY).toBe(-.2380597014925373);
  expect({...after,state:before.state}).toEqual(before);expect({...after.state,settings:before.state.settings}).toEqual(before.state);
  expect(out.domainLive).toMatchObject({renderKind:'snapshot',rawDt:0,activeDt:0,updateOrdinal:before.updateOrdinal});
  expect(out.formulaPresentation).toEqual(initial.formulaPresentation);expect(out.domainLive.presentation.equations.f).toBe('z');
  expect(f.render.mock.calls.at(-1)![1]).toMatchObject({quality:'preview',width:4,height:3});expect(f.sessions[1]).toBe(f.sessions[0]);
  expect(f.owner.matchesCompletedPrimary(staged,c)).toBe(true);
 });
 it('preserves the primary viewport snapshot and requires a completed redraw before resizing its identity',()=>{
  const s=scene(),f=setup(),c=context({clock:{paused:true}});f.owner.generate(s,c);
  c.domainLive.viewport!.logicalWidth=802;expect(f.owner.matchesCompletedPrimary(s,c)).toBe(false);
  expect(()=>f.owner.navigatePaused(s,c,{kind:'wheel',count:1})).toThrow('匹配');
  const original=context({clock:{paused:true}});expect(f.owner.matchesCompletedPrimary(s,original)).toBe(true);
  const out=f.owner.generate(s,c);expect(out.domainLive.renderKind).toBe('snapshot');expect(f.owner.matchesCompletedPrimary(s,c)).toBe(true);
  expect(()=>f.owner.navigatePaused(s,original,{kind:'wheel',count:1})).toThrow('匹配');
  const before=state(f);f.owner.navigatePaused(s,c,{kind:'wheel',count:2});expect(state(f).state.settings.scale).toBe(2.2675739021000716);expect(state(f).updateOrdinal).toBe(before.updateOrdinal);
 });
 it('rejects missing/malformed viewport, foreign identity and invalid gestures before mutating the owner',()=>{
  const s=scene(),f=setup(),c=context({clock:{paused:true}});f.owner.generate(s,c);const before=state(f);
  for(const viewport of [{logicalWidth:0,logicalHeight:603,pixelDensity:2},{logicalWidth:801.5,logicalHeight:603,pixelDensity:2},{logicalWidth:801,logicalHeight:603,pixelDensity:1.5},{logicalWidth:16384,logicalHeight:16384,pixelDensity:2}])expect(()=>f.owner.generate(s,context({clock:{paused:true},viewport}))).toThrow();
  for(const event of [{kind:'pan',dx:NaN,dy:0},{kind:'wheel',count:.5},{kind:'wheel',count:-2147483648},{kind:'unknown'},null] as SourceDomainNavigationEvent[])expect(()=>f.owner.navigatePaused(s,c,event)).toThrow();
  expect(()=>f.owner.navigatePaused({...s,id:'foreign'},c,{kind:'wheel',count:1})).toThrow('匹配');expect(state(f)).toEqual(before);expect(f.owner.matchesCompletedPrimary(s,c)).toBe(true);
  const noViewport=setup(),missing=context({clock:{paused:true},viewport:undefined});noViewport.owner.generate(s,missing);
  expect(()=>noViewport.owner.navigatePaused(s,missing,{kind:'wheel',count:1})).toThrow('逻辑视口');expect(noViewport.owner.matchesCompletedPrimary(s,missing)).toBe(true);
 });
 it('requires independent pause control and performs no hidden numerical update on navigation',()=>{
  const s=scene(),f=setup(),c=context();f.owner.generate(s,c);const before=state(f);
  expect(()=>f.owner.navigatePaused(s,c,{kind:'wheel',count:1})).toThrow('暂停');expect(state(f)).toEqual(before);
  f.owner.setPaused(true);const paused=context({clock:{paused:true},actualFrameRate:1}),out=f.owner.navigatePaused(s,paused,{kind:'wheel',count:1});
  expect(out.domainLive).toMatchObject({paused:true,actualFrameRate:24,updateOrdinal:0,renderKind:'snapshot'});
  f.owner.setPaused(false,3000);const resumed=f.owner.generate(s,context({},3016));expect(resumed.domainLive.rawDt).toBe(Math.fround(Math.fround(3.016)-3));
 });
 it('preserves pre-cancel capability and fail-closes renderer or post-render cancellation after a gesture',()=>{
  const s=scene(),f=setup(),c=context({clock:{paused:true}});f.owner.generate(s,c);const before=state(f);
  expect(()=>f.owner.navigatePaused(s,{...c,isCancelled:()=>true},{kind:'wheel',count:1})).toThrow('取消');expect(state(f)).toEqual(before);
  let cancelled=false;f.render.mockImplementationOnce((s,c,owner)=>{const out=generateDomain(s,{...c,isCancelled:undefined},owner);cancelled=true;return out;});
  expect(()=>f.owner.navigatePaused(s,{...c,isCancelled:()=>cancelled},{kind:'wheel',count:1})).toThrow('取消');expect(f.owner.matchesCompletedPrimary(s,c)).toBe(false);expect(f.owner.diagnostics().failed).toBe(true);
  const fresh=context({sessionId:'new',clock:{paused:true}});f.owner.generate(s,fresh);f.render.mockImplementationOnce(()=>{throw Error('render lost');});
  expect(()=>f.owner.navigatePaused(s,fresh,{kind:'wheel',count:1})).toThrow('render lost');expect(f.owner.diagnostics().failed).toBe(true);
 });
 it.each(['z','z^3-2'])('hot %s captures current a/b base without replacing it with the literal override',formula=>{
  const s=scene(formula),f=setup(),c=context(),initial=f.owner.generate(s,c);f.owner.generate(s,context({},1250));
  const animated=state(f);expect(animated.state.parameters.a).not.toBe(.2);expect(animated.state.settings.constantReal).toBe(7);expect(animated.state.settings.constantImag).toBe(8);
  f.owner.setPaused(true);const paused=context({clock:{paused:true}});f.owner.navigatePaused(s,paused,{kind:'pan',dx:2,dy:-3});const before=state(f),renders=f.render.mock.calls.length;
  f.sessions[0].fail({stage:'render',reason:'retained failure witness'});f.owner.updateParameters(s,paused,[['b',.75]]);
  const after=state(f);expect(f.render).toHaveBeenCalledTimes(renders);expect(after.updateOrdinal).toBe(before.updateOrdinal);expect(after.hostClock).toEqual(before.hostClock);expect(after.state.clock).toEqual(before.state.clock);
  expect(after.state.settings).toMatchObject({centerX:.125,centerY:-.25,scale:2.5,constantReal:Math.fround(before.state.parameters.a),constantImag:.75});
  expect(after.state.parameters).toEqual({...before.state.parameters,b:.75});expect(after.state.parameterState.entries).toEqual([]);expect(after.state.parameterState.running).toBe(false);expect(after.state.parameterState.children).toEqual(before.state.parameterState.children);
  expect(after.state.gradient).toEqual(before.state.gradient);expect(after.state.rotation).toBe(before.state.rotation);expect(after.state.rotationRate).toBe(before.state.rotationRate);expect(after.state.paletteOffset).toBe(before.state.paletteOffset);
  const out=f.owner.generate(s,paused),model=parseDomainCpuChainModel(f.scenes.at(-1)!,out.domainLive.sceneTime);
  expect(model.nativeConstant?.baseConstant).toEqual([Math.fround(before.state.parameters.a),.75]);expect(model.constant).toEqual(formula==='z'?[Math.fround(before.state.parameters.a),.75]:[2,0]);
  expect(initial.formulaPresentation.labels.length).toBeGreaterThan(0);expect(out.formulaPresentation).toEqual(initial.formulaPresentation);expect(f.owner.diagnostics().renderFailure?.reason).toBe('retained failure witness');
  const full=f.owner.generate(s,context({clock:{paused:true},revision:1,configuration:s}));expect(full.domainLive.presentation.settings).toMatchObject({constantReal:7,constantImag:8});expect(full.domainLive.presentation.parameters).toEqual(s.parameters);expect(f.owner.diagnostics().renderFailure).toBeUndefined();
 });
 it('re-captures a missing/default or float-overflow axis but retains raw double map values',()=>{
  const s=scene(),f=setup(),c=context({clock:{paused:true}});delete s.parameters.b;f.owner.generate(s,c);f.owner.updateParameters(s,c,[['a',1e100]]);
  const after=state(f);expect(after.state.parameters.a).toBe(1e100);expect(after.state.settings).toMatchObject({constantReal:1,constantImag:0});
  f.owner.updateParameters(s,c,[['a',-0]]);expect(Object.is(state(f).state.settings.constantReal,-0)).toBe(true);
  f.owner.updateParameters(s,c,[['scale',7]]);expect(state(f).state.parameters.scale).toBe(7);expect(state(f).state.settings.scale).toBe(2.5);
 });
 it('preserves invalid hot-input preflight, while started budget failure invalidates the owner',()=>{
  const s=scene(),f=setup(),c=context();f.owner.generate(s,c);const before=state(f);
  for(const value of [NaN,Infinity])expect(()=>f.owner.updateParameters(s,c,[['a',value]])).toThrow();
  expect(()=>f.owner.updateParameters(s,c,[[null as unknown as string,1]])).toThrow();expect(()=>f.owner.updateParameters(s,{...c,isCancelled:()=>true},[['a',1]])).toThrow('取消');
  expect(state(f)).toEqual(before);expect(f.owner.matchesCompletedPrimary(s,c)).toBe(true);
  expect(()=>f.owner.updateParameters(s,c,[['x'.repeat(2_000_001),1]])).toThrow('预算');expect(f.owner.diagnostics().failed).toBe(true);expect(f.owner.matchesCompletedPrimary(s,c)).toBe(false);
  expect(f.owner.generate(s,context({sessionId:'recovered'})).domainLive.updateOrdinal).toBe(0);
 });
 it('validates an entire hot batch before any write and preserves an existing completed capability',()=>{
  const s=scene(),f=setup(),c=context(),configuration=prepareSourceDomainScene(s),host=new SourceDomainHostSession(configuration);
  f.owner.generate(s,c);const before=state(f),hostBefore=host.snapshot(),renders=f.render.mock.calls.length;
  const malformed=[[],[['a',.7],['b',NaN]],[['a',.7],['b']],[['a',.7],['b',.8,'extra']]] as unknown as readonly (readonly (readonly [string,number])[])[];
  for(const writes of malformed){expect(()=>host.updateParameters(writes)).toThrow();expect(host.snapshot()).toEqual(hostBefore);expect(()=>f.owner.updateParameters(s,c,writes)).toThrow();expect(state(f)).toEqual(before);expect(f.owner.matchesCompletedPrimary(s,c)).toBe(true);}
  f.owner.updateParameters(s,c,[['a',.7],['b',.8],['a',.9]]);const after=state(f);
  expect(after.state.parameters).toMatchObject({a:.9,b:.8});expect(after.state.settings).toMatchObject({constantReal:Math.fround(.9),constantImag:Math.fround(.8)});expect(after.updateOrdinal).toBe(before.updateOrdinal);expect(after.state.clock).toEqual(before.state.clock);expect(f.render).toHaveBeenCalledTimes(renders);
 });
 it('shares one budget across ordered hot writes and recovers only through full load/new session',()=>{
  const s=scene(),configuration=prepareSourceDomainScene(s),host=new SourceDomainHostSession(configuration),name='x'.repeat(1_000_000),writes=[[name,1],[name,2]] as const;
  // Each individual edit is affordable; their single delivered batch is not.
  host.updateParameter(name,1);expect(host.updateParameter(name,2).state.parameters[name]).toBe(2);host.fullLoad(configuration);
  expect(()=>host.updateParameters(writes)).toThrow('预算');expect(()=>host.snapshot()).toThrow('fullLoad');host.fullLoad(configuration);expect(host.snapshot().state.parameters).toEqual(s.parameters);
  const f=setup(),c=context();f.owner.generate(s,c);expect(()=>f.owner.updateParameters(s,c,writes)).toThrow('预算');expect(f.owner.diagnostics().failed).toBe(true);expect(f.owner.matchesCompletedPrimary(s,c)).toBe(false);
  expect(f.owner.generate(s,context({sessionId:'batch-recovered'})).domainLive.presentation.parameters).toEqual(s.parameters);
 });
 it('publishes navigation progress using the same owned snapshot and isolated formula facts',()=>{
  const s=scene(),f=setup(),c=context({clock:{paused:true}});f.owner.generate(s,c);const progress:ReturnType<SourceDomainLiveSession['generate']>[]=[];
  f.render.mockImplementationOnce((s,c,owner)=>{const out=generateDomain(s,c,owner);c.onProgress?.({...out,pixels:new Uint8ClampedArray(out.pixels)});return out;});
  const out=f.owner.navigatePaused(s,{...c,onProgress:value=>progress.push(value as typeof out)},{kind:'wheel',count:1});
  expect(progress).toHaveLength(1);expect(progress[0].domainLive).toEqual(out.domainLive);expect(progress[0].formulaPresentation).toEqual(out.formulaPresentation);expect(progress[0].formulaPresentation).not.toBe(out.formulaPresentation);
 });
});
