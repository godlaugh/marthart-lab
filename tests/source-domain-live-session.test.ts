import {describe,expect,it,vi} from 'vitest';
import type {GenerateContext,SceneDocument,SceneOutput} from '../src/types';
import {SourceDomainLiveSession,type SourceDomainLiveContext} from '../src/engine/sourceDomainLiveSession';
import {SourceDomainHostSession} from '../src/engine/sourceDomainHostSession';
import {prepareSourceDomainScene} from '../src/engine/sourceDomainTimeline';
import {DomainRenderSession} from '../src/engine/domainRenderSession';
import {generateDomain} from '../src/engine/domain';
import {parseProjectFile} from '../src/engine/legacyImport';
import {defaultFormulas,formulaPresentation} from '../src/engine/formulas';

const scene=()=>{
 const s=parseProjectFile(JSON.stringify({config_version:'1.0.0',name:'Domain live owner',type:'DOMAIN_COLORING',domainColoring:{formula:'z+a',parameters:{a:0}},timeline:[{type:'animate',duration:1,easing:'LINEAR',actions:[{method:'domainRotate',args:[.7]},{method:'paramStart',args:{parameters:{a:{min:-1,max:1,step:.02}}}},{method:'gradientStart',args:{mode:'HUE_ROTATE',speed:120}}]},{type:'wait',duration:.2}]})).scene;
 s.parameters.a=0;s.settings.domainRenderPolicy='source-cpu-always-v1';s.formulas=defaultFormulas();s.formulas.main.visible=true;return s;
};
const context=(overrides:Partial<SourceDomainLiveContext>={},timestampMs=1000):GenerateContext&{domainLive:SourceDomainLiveContext}=>({time:99,quality:'preview',width:4,height:3,domainLive:{sessionId:'domain-live',revision:0,clock:{paused:false,timestampMs},actualFrameRate:37,...overrides}});
function setup(){
 const scenes:SceneDocument[]=[],sessions:DomainRenderSession[]=[];
 // Real production CPU raster on tiny targets. This does not claim WebGL/GUI coverage.
 const render=vi.fn((s:SceneDocument,c:GenerateContext,session:DomainRenderSession):SceneOutput=>{scenes.push(structuredClone(s));sessions.push(session);return generateDomain(s,c,session);});
 return{owner:new SourceDomainLiveSession(render),render,scenes,sessions};
}

describe('Domain retained live numerical/raster boundary',()=>{
 it('uses one numerical host and delivers its state through the real CPU producer',()=>{
  const s=scene(),f=setup(),control=new SourceDomainHostSession(prepareSourceDomainScene(s));
  for(const ms of [1000,1016,1033]){
   const c=context({},ms),expected=control.update(c.domainLive.clock,c.domainLive.actualFrameRate),out=f.owner.generate(s,c);
   expect(out.domainLive.presentation.evaluatedDomainScene?.clock).toEqual(expected.state.clock);
   expect(out.domainLive.presentation.parameters).toEqual(expected.state.parameters);
   expect(out.domainLive.actualFrameRate).toBe(expected.state.parameterFps);expect(out.domainLive.sceneTime).toBe(expected.state.clock.sceneTime);
   expect(out.domainRender?.sourceClock?.sceneTime).toBe(out.domainLive.sceneTime);expect(out.backend).toBe('cpu');expect(out.pixels.length).toBe(48);
  }
  expect(f.sessions[0]).toBe(f.sessions[2]);expect(f.owner.diagnostics().host?.updateOrdinal).toBe(2);
 });
 it('initializes from the captured event and stages same-revision author edits',()=>{
  const captured=scene(),staged=structuredClone(captured);captured.settings.background='#123456';staged.equations.f='(';staged.settings.background='#ffffff';
  const f=setup(),c=context({revision:3,configuration:captured,clock:{paused:true}}),first=f.owner.generate(staged,c);
  expect(first.domainLive.presentation.equations).toEqual(captured.equations);expect(first.domainLive.presentation.settings.background).toBe('#123456');
  captured.settings.background='#ff0000';const next=f.owner.generate(staged,context({revision:3,clock:{paused:true}}));
  expect(next.domainLive.presentation.settings.background).toBe('#123456');expect(next.formulaPresentation).toEqual(first.formulaPresentation);
  expect(next.domainLive).toMatchObject({renderKind:'snapshot',updateOrdinal:0,rawDt:0,activeDt:0});
 });
 it('performs full Apply while paused, replacing queue, shell and captured labels',()=>{
  const s=scene(),f=setup();f.owner.generate(s,context());f.owner.generate(s,context({},1100));f.owner.setPaused(true);
  const edit=structuredClone(s);edit.settings.rotation=.8;edit.settings.background='#884422';edit.timeline.tracks=[];edit.formulas!.main.latex='q=7';
  const c=context({revision:1,configuration:edit,clock:{paused:true},actualFrameRate:29.97}),out=f.owner.generate(edit,c);
  expect(out.domainLive).toMatchObject({paused:true,sceneTime:0,updateOrdinal:0,queueComplete:true,renderKind:'update',actualFrameRate:Math.fround(29.97)});
  expect(out.domainLive.presentation.settings.rotation).toBe(Math.fround(.8));expect(out.domainLive.presentation.settings.background).toBe('#884422');
  expect(out.domainLive.presentation.timeline.tracks).toEqual([]);expect(out.formulaPresentation).toEqual(formulaPresentation(edit));expect(f.sessions[0]).not.toBe(f.sessions.at(-1));
  f.owner.setPaused(false,3000);const resumed=f.owner.generate(edit,context({revision:1},3016));
  expect(resumed.domainLive.rawDt).toBe(Math.fround(Math.fround(3.016)-3));expect(resumed.domainLive.presentation.settings.rotation).toBe(Math.fround(.8));
 });
 it('reuses the paused snapshot for resize without consuming a new numerical FPS observation',()=>{
  const s=scene(),f=setup();f.owner.generate(s,context());f.owner.generate(s,context({},1016));f.owner.setPaused(true);
  const before=f.owner.diagnostics().host!,c={...context({clock:{paused:true},actualFrameRate:1}),width:6,height:2},out=f.owner.generate(s,c);
  expect(out.domainLive).toMatchObject({paused:true,renderKind:'snapshot',updateOrdinal:before.updateOrdinal,rawDt:0,activeDt:0,actualFrameRate:37});
  expect(f.owner.diagnostics().host).toEqual(before);expect(out.width).toBe(6);expect(f.owner.matchesCompletedPrimary(s,c)).toBe(true);
  expect(f.owner.matchesCompletedPrimary(s,{...c,width:4})).toBe(false);
 });
 it('keeps snapshot presentation and formulas independent of caller mutations',()=>{
  const s=scene(),f=setup(),c=context({clock:{paused:true}}),out=f.owner.generate(s,c);
  out.domainLive.presentation.settings.rotation=100;out.domainLive.presentation.parameters.a=100;out.domainLive.presentation.timeline.tracks=[];out.formulaPresentation.labels[0].latex='changed';
  const next=f.owner.generate(s,c);expect(next.domainLive.presentation.settings.rotation).toBe(0);expect(next.domainLive.presentation.parameters.a).toBe(0);
  expect(next.domainLive.presentation.timeline.tracks).toHaveLength(2);expect(next.formulaPresentation.labels[0].latex).not.toBe('changed');
  expect(Object.hasOwn(next.domainLive.presentation,'sourceCamera')).toBe(true);expect(next.domainLive.presentation.sourceCamera).toBeUndefined();
 });
 it('requires a new session for identity/seek changes and a captured full snapshot for each revision',()=>{
  const s=scene(),f=setup(),c=context();f.owner.generate(s,c);
  for(const invalid of [context({revision:1}),context({revision:-1}),context({startAt:0}),context({clock:{paused:true}})])expect(()=>f.owner.generate(s,invalid)).toThrow();
  expect(()=>f.owner.generate({...s,id:'foreign'},c)).toThrow('sessionId');expect(f.owner.matchesCompletedPrimary(s,c)).toBe(true);
  expect(f.owner.matchesCompletedPrimary({...s,id:'foreign'},c)).toBe(false);
  expect(()=>f.owner.generate(s,context({revision:1,configuration:{...s,id:'foreign'}}))).toThrow('配置');
 });
 it('distinguishes a fresh first-zero live frame from explicit fixed local reconstruction',()=>{
  const s=scene(),fresh=setup(),seek=setup(),first=fresh.owner.generate(s,context({clock:{paused:true},actualFrameRate:29.97})),rebuilt=seek.owner.generate(s,context({clock:{paused:true},startAt:0}));
  expect(first.domainLive).toMatchObject({renderKind:'update',updateOrdinal:0,actualFrameRate:Math.fround(29.97)});
  expect(first.domainLive.sceneTime).toBe(0);expect(rebuilt.domainLive.sceneTime).toBe(Math.fround(1/Math.fround(s.timeline.fps)));
  expect(rebuilt.domainLive).toMatchObject({renderKind:'snapshot',updateOrdinal:0});
  const changed=structuredClone(s);changed.timeline.tracks=[];
  const applied=seek.owner.generate(changed,context({revision:1,startAt:0,configuration:changed,clock:{paused:true}}));
  expect(applied.domainLive.sceneTime).toBe(0);expect(applied.domainLive.renderKind).toBe('update');
 });
 it('rejects malformed input and bad Apply before changing a completed capability',()=>{
  const s=scene(),f=setup(),c=context();f.owner.generate(s,c);const before=f.owner.diagnostics(),bad=structuredClone(s);bad.settings.domainRenderPolicy='unknown';
  expect(()=>f.owner.generate(bad,context({revision:1,configuration:bad}))).toThrow('策略');
  for(const invalid of [context({actualFrameRate:NaN}),{...c,width:NaN},{...c,quality:'bad'} as unknown as typeof c,{...c,fractalRecording:{displayFrame:0,simulationFps:60}}])expect(()=>f.owner.generate(s,invalid)).toThrow();
  expect(f.owner.diagnostics()).toEqual(before);expect(f.owner.matchesCompletedPrimary(s,c)).toBe(true);
  expect(()=>f.owner.setPaused(true,Infinity)).toThrow();expect(f.owner.matchesCompletedPrimary(s,c)).toBe(true);
 });
 it('preserves a cancelled preflight, and invalidates state after rendering or cancellation began',()=>{
  const s=scene(),f=setup(),c=context();f.owner.generate(s,c);const before=f.owner.diagnostics();
  expect(()=>f.owner.generate(s,{...c,isCancelled:()=>true})).toThrow('取消');expect(f.owner.diagnostics()).toEqual(before);
  let cancel=false;f.render.mockImplementationOnce((s,c,owner)=>{const out=generateDomain(s,{...c,isCancelled:undefined},owner);cancel=true;return out;});
  expect(()=>f.owner.generate(s,{...context({},1016),isCancelled:()=>cancel})).toThrow('取消');expect(f.owner.matchesCompletedPrimary(s,c)).toBe(false);expect(f.owner.diagnostics().failed).toBe(true);
  expect(()=>f.owner.generate(s,c)).toThrow('sessionId');expect(()=>f.owner.setPaused(true)).toThrow('主预览');
  const recovered=f.owner.generate(s,context({sessionId:'recovered'},2000));expect(recovered.domainLive.rawDt).toBe(0);
  f.render.mockImplementationOnce(()=>{throw Error('render lost');});expect(()=>f.owner.generate(s,context({sessionId:'recovered'},2016))).toThrow('render lost');
  f.owner.reset();expect(f.owner.diagnostics().host).toBeUndefined();expect(f.owner.generate(s,c).domainLive.updateOrdinal).toBe(0);
 });
 it('owns fallback identity separately from other instances and resets it on full Apply',()=>{
  const s=scene(),f=setup(),g=setup();f.owner.generate(s,context());g.owner.generate(s,context({sessionId:'other'}));
  f.sessions[0].fail({stage:'render',reason:'owned failure witness'});f.owner.generate(s,context({},1016));
  expect(f.sessions[1]).toBe(f.sessions[0]);expect(f.owner.diagnostics().renderFailure?.reason).toBe('owned failure witness');expect(g.owner.diagnostics().renderFailure).toBeUndefined();
  f.owner.generate(s,context({revision:1,configuration:s},1033));expect(f.owner.diagnostics().renderFailure).toBeUndefined();expect(f.sessions[2]).not.toBe(g.sessions[0]);
 });
 it('binds producer facts to progress and rejects malformed renderer output',()=>{
  const s=scene(),f=setup(),progress:SceneOutput[]=[];
  f.render.mockImplementationOnce((s,c,owner)=>{const out=generateDomain(s,c,owner);c.onProgress?.({...out,pixels:new Uint8ClampedArray(out.pixels)});return out;});
  const out=f.owner.generate(s,{...context(),onProgress:value=>progress.push(value)});expect(progress).toHaveLength(1);
  const first=progress[0] as typeof out;expect(first.domainLive).toEqual(out.domainLive);expect(first.formulaPresentation).toEqual(out.formulaPresentation);expect(first.formulaPresentation).not.toBe(out.formulaPresentation);
  f.render.mockImplementationOnce((s,c,owner)=>{const out=generateDomain(s,c,owner);delete out.domainRender;return out;});
  expect(()=>f.owner.generate(s,context({},1016))).toThrow('栅格事实');expect(f.owner.diagnostics().failed).toBe(true);
 });
 it('accepts high-quality primary requests without treating quality as an offscreen identity',()=>{
  const s=scene(),f=setup(),c={...context({clock:{paused:true}}),quality:'export' as const},out=f.owner.generate(s,c);
  expect(out.domainLive.target).toBe('primary');expect(out.width).toBe(c.width);expect(f.owner.matchesCompletedPrimary(s,c)).toBe(true);
 });
});
