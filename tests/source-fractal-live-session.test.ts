import type {prepareFractalRender} from '../src/scenes/complex';
import {describe,expect,it,vi} from 'vitest';
import {parseProjectFile} from '../src/engine/legacyImport';
import {SourceFractalLiveSession,type SourceFractalLiveContext} from '../src/engine/sourceFractalLiveSession';
import {SourceFractalHostSession} from '../src/engine/sourceFractalHostSession';
import {prepareSourceFractalScene} from '../src/engine/sourceFractalTimeline';
import {sourceQueuePresentedScene} from '../src/engine/sourceQueuePresentation';
import {sourceLivePreviewKind} from '../src/engine/sourceLivePreview';
import type {GenerateContext,SceneDocument,SceneOutput} from '../src/types';

const scene=()=>parseProjectFile(JSON.stringify({config_version:'1.0.0',name:'live boundary',type:'FRACTAL',fractal:{formula_id:'newton',parameters:{exponent:[3,.25],bailout:.001,relaxation:1}},timeline:[{type:'animate',duration:1,easing:'LINEAR',actions:[{method:'center',args:[1,-.5]},{method:'paramStart',args:{parameters:{exponent_re:{step:.1,min:2,max:4}}}},{method:'gradientStart',args:{mode:'CROSS_FADE',speed:137.25}}]},{type:'wait',duration:.1}]})).scene;
const context=(overrides:Partial<SourceFractalLiveContext>={},time=50):GenerateContext=>({time:0,quality:'preview',width:16,height:12,fractalPixelDensity:1,fractalViewport:{logicalWidth:16,logicalHeight:12,target:'primary'},fractalLive:{sessionId:'live',revision:0,intent:'apply',clock:{paused:false,timestampMs:time},actualFrameRate:60,...overrides}});
// The injected renderer observes the exact production-bound document. It does
// not establish GPU behavior; the real-browser suite owns pixel verification.
function setup(){
 const scenes:SceneDocument[]=[],render=vi.fn((s:SceneDocument,c:GenerateContext,_prepared?:ReturnType<typeof prepareFractalRender>):SceneOutput=>{scenes.push(structuredClone(s));return{type:'raster',width:c.width,height:c.height,pixels:new Uint8ClampedArray(c.width*c.height*4),stats:{samples:1,generated:1,invalid:0},fractalRender:{} as NonNullable<Extract<SceneOutput,{type:'raster'}>['fractalRender']>};});
 return{owner:new SourceFractalLiveSession(render),render,scenes};
}
describe('retained Fractal live generation',()=>{
 it('initializes from a captured event when the first request is coalesced with a later stage',()=>{
  const captured=scene(),staged=structuredClone(captured);captured.settings.centerX=3;staged.settings.centerX=99;staged.settings.background='#ff0000';
  const f=setup(),out=f.owner.generate(staged,context({revision:1,intent:'hot',configuration:captured,clock:{paused:true}}));
  expect(out.fractalLive!.presentation.settings.centerX).toBe(3);expect(out.fractalLive!.presentation.settings.background).toBe(captured.settings.background);
 });
 it('routes one host through complete runtime updates and ignores same-revision stage edits',()=>{
  const s=scene(),f=setup(),control=new SourceFractalHostSession(prepareSourceFractalScene(s));
  expect(sourceLivePreviewKind(s)).toBe('fractal');const first=f.owner.generate(s,context());control.update(context().fractalLive!.clock,60);
  expect(first.fractalLive!.presentation.evaluatedFractalScene!.scene).toEqual(control.snapshot().state.scene);expect(first.fractalLive!.rawDt).toBe(0);
  const staged=structuredClone(s);staged.settings.background='#ff0000';staged.settings.perturbationPrecision='unknown';staged.settings.centerX=77;
  const next=f.owner.generate(staged,context({},100));control.update(context({},100).fractalLive!.clock,60);
  expect(next.fractalLive!.updateOrdinal).toBe(1);expect(next.fractalLive!.presentation.evaluatedFractalScene!.formula).toEqual(control.snapshot().state.formula);
  expect(f.scenes[1].settings.background).toBe(s.settings.background);expect(f.scenes[1].settings.perturbationPrecision).toBe(s.settings.perturbationPrecision);expect(f.scenes[1].settings.centerX).not.toBe(77);
 });
 it('applies the captured hot event, retaining scene shell and captured queue starts',()=>{
  const s=scene(),f=setup();f.owner.generate(s,context());f.owner.generate(s,context({},100));f.owner.setPaused(true);
  const captured=structuredClone(s);captured.settings.centerX=9;captured.settings.background='#ff0000';captured.settings.showGrid=!s.settings.showGrid;captured.camera.position=[4,5,6];captured.timeline.tracks=[];
  const staged=structuredClone(captured);staged.settings.centerX=99;staged.settings.renderMethod='guessing';
  const c=context({revision:1,intent:'hot',configuration:captured,clock:{paused:true}}),out=f.owner.generate(staged,c),effective=out.fractalLive!.presentation;
  expect(effective.settings.centerX).toBe(9);expect(effective.settings.background).toBe(s.settings.background);expect(effective.settings.showGrid).toBe(s.settings.showGrid);expect(effective.camera).toEqual(s.camera);expect(effective.timeline).toEqual(s.timeline);
  expect(effective.evaluatedFractalScene!.parameters.entries).toEqual([]);expect(effective.evaluatedFractalScene!.gradient.running).toBe(false);expect(out.fractalLive!.objectUpdates).toBe(0);
  captured.settings.centerX=100;expect(out.fractalLive!.presentation.settings.centerX).toBe(9);
  const noPayload=context({revision:1,intent:'hot',clock:{paused:true}});expect(f.owner.generate(staged,noPayload).fractalLive!.presentation.settings.centerX).toBe(9);
  f.owner.setPaused(false,200);const resumed=f.owner.generate(staged,context({revision:1,intent:'hot'},250));expect(resumed.fractalLive!.presentation.settings.centerX).not.toBe(9);expect(resumed.fractalLive!.presentation.timeline).toEqual(s.timeline);
 });
 it('branches Apply on the current pause control, while running Apply replaces queue and shell',()=>{
  const s=scene(),f=setup();f.owner.generate(s,context());f.owner.generate(s,context({},100));f.owner.setPaused(true);
  const edit=structuredClone(s);edit.settings.centerX=5;edit.settings.background='#884422';edit.timeline.tracks=[];
  const paused=f.owner.generate(edit,context({revision:1,configuration:edit,clock:{paused:true}}));expect(paused.fractalLive!.sceneTime).toBeGreaterThan(0);expect(paused.fractalLive!.presentation.timeline.tracks).toHaveLength(2);expect(paused.fractalLive!.presentation.settings.background).toBe(s.settings.background);
  f.owner.setPaused(false,200);const running=f.owner.generate(edit,context({revision:2,configuration:edit},250));
  expect(running.fractalLive!.sceneTime).toBe(0);expect(running.fractalLive!.updateOrdinal).toBe(0);expect(running.fractalLive!.queueComplete).toBe(true);expect(running.fractalLive!.presentation.timeline.tracks).toEqual([]);expect(running.fractalLive!.presentation.settings.background).toBe('#884422');
 });
 it('returns owned effective presentation instead of replaying the staged document',()=>{
  const s=scene(),f=setup();const out=f.owner.generate(s,context({clock:{paused:true}})),draft=structuredClone(s);draft.settings.centerX=200;draft.settings.background='#ffffff';draft.timeline.tracks=[];
  const shown=sourceQueuePresentedScene(draft,out)!;expect(shown.settings.centerX).toBe(s.settings.centerX);expect(shown.timeline).toEqual(s.timeline);expect(shown.evaluatedFractalScene).toEqual(out.fractalLive!.presentation.evaluatedFractalScene);
  shown.settings.centerX=300;expect(out.fractalLive!.presentation.settings.centerX).not.toBe(300);
  out.fractalLive!.presentation.settings.centerX=400;expect(f.owner.generate(s,context({clock:{paused:true}})).fractalLive!.presentation.settings.centerX).not.toBe(400);
 });
 it('distinguishes a fresh first-zero live update from explicit fixed local reconstruction',()=>{
  const s=scene(),fresh=setup(),seek=setup(),first=fresh.owner.generate(s,context({clock:{paused:true}})),atZero=seek.owner.generate(s,context({clock:{paused:true},startAt:0}));
  expect(first.fractalLive!.sceneTime).toBe(0);expect(atZero.fractalLive!.sceneTime).toBe(Math.fround(1/s.timeline.fps));
  expect(()=>seek.owner.generate(s,context({clock:{paused:true},startAt:.2}))).toThrow('sessionId');
  const moved=seek.owner.generate(s,context({sessionId:'seek2',clock:{paused:true},startAt:.2}));expect(moved.fractalLive!.sceneTime).toBeGreaterThan(.2);
 });
 it('admits render configuration before mutating the old host and fails closed after rendering fails',()=>{
  const s=scene(),f=setup(),c=context();f.owner.generate(s,c);const before=f.owner.diagnostics();
  const bad=structuredClone(s);bad.settings.perturbationPrecision='UNKNOWN';
  expect(()=>f.owner.generate(bad,context({revision:1,intent:'hot',configuration:bad},100))).toThrow();expect(f.owner.diagnostics()).toEqual(before);expect(f.owner.matchesCompletedPrimary(s,c)).toBe(true);
  expect(()=>f.owner.generate(s,context({actualFrameRate:NaN}))).toThrow();expect(f.owner.diagnostics()).toEqual(before);
  f.render.mockImplementationOnce(()=>{throw Error('GPU failure');});expect(()=>f.owner.generate(s,context({},100))).toThrow('GPU failure');expect(f.owner.diagnostics().failed).toBe(true);
  expect(()=>f.owner.generate(s,context({},150))).toThrow('sessionId');expect(f.owner.generate(s,context({sessionId:'recovered'},150)).fractalLive!.rawDt).toBe(0);
 });
 it('keeps cancellation scoped to one request and cannot mix live with fixed export clocks',()=>{
  const s=scene(),f=setup(),c=context();f.owner.generate(s,c);const before=f.owner.diagnostics();
  expect(()=>f.owner.generate(s,{...context(),isCancelled:()=>true})).toThrow('取消');expect(f.owner.diagnostics()).toEqual(before);
  expect(()=>f.owner.setPaused(true)).not.toThrow();
  for(const invalid of [{...context(),fractalViewport:{logicalWidth:16,logicalHeight:12,target:'offscreen' as const}},{...context(),fractalRecording:{displayFrame:0,simulationFps:60}}])expect(()=>f.owner.generate(s,invalid)).toThrow();
  f.owner.reset();expect(f.owner.diagnostics().host).toBeUndefined();expect(f.owner.generate(s,context()).fractalLive!.updateOrdinal).toBe(0);
 });
 it('accepts full-quality primary previews without treating sampling quality as target identity',()=>{
  const s=scene(),f=setup(),c={...context({clock:{paused:true}}),quality:'export' as const};
  const out=f.owner.generate(s,c);expect(out.fractalLive).toMatchObject({target:'primary',renderKind:'update',updateOrdinal:0});expect(f.render.mock.calls[0][1].quality).toBe('export');expect(f.owner.matchesCompletedPrimary(s,c)).toBe(true);
 });
 it('captures current hot numerical state twice without an update, using owned primary and offscreen sizes',()=>{
  const s=scene(),f=setup(),initial=context();f.owner.generate(s,initial);f.owner.generate(s,context({},100));f.owner.setPaused(true);
  const hot=structuredClone(s);hot.settings.centerX=7;hot.settings.background='#ffffff';hot.timeline.tracks=[];
  const c=context({revision:1,intent:'hot',configuration:hot,clock:{paused:true}}),out=f.owner.generate(hot,c),before=f.owner.diagnostics();
  const staged=structuredClone(hot);staged.settings.centerX=99;f.render.mockClear();
  const result=f.owner.capturePaused(staged,{...c,width:32,height:20,quality:'export'});
  expect(result.capture).toMatchObject({width:32,height:20,fractalLive:{target:'offscreen',renderKind:'snapshot',objectUpdates:0,updateOrdinal:out.fractalLive!.updateOrdinal,sceneTime:out.fractalLive!.sceneTime}});
  expect(result.preview).toMatchObject({width:16,height:12,fractalLive:{target:'primary',renderKind:'snapshot',objectUpdates:0}});
  expect(result.capture.fractalLive!.presentation.settings.centerX).toBe(7);expect(result.capture.fractalLive!.presentation.settings.background).toBe(s.settings.background);
  expect(f.render.mock.calls[0][1]).toMatchObject({quality:'export',fractalViewport:{logicalWidth:32,logicalHeight:20,target:'offscreen'}});
  expect(f.owner.diagnostics()).toEqual(before);expect(f.owner.matchesCompletedPrimary(staged,c)).toBe(true);
 });
 it('retains a completed preview on capture preflight errors, and fails closed after offscreen failure',()=>{
  const s=scene(),f=setup(),c=context();f.owner.generate(s,c);const before=f.owner.diagnostics();
  expect(()=>f.owner.capturePaused(s,{...c,quality:'export',width:4,height:4})).toThrow('暂停');expect(f.owner.diagnostics()).toEqual(before);
  f.owner.setPaused(true);expect(()=>f.owner.capturePaused(s,{...c,width:NaN})).toThrow();expect(f.owner.matchesCompletedPrimary(s,c)).toBe(true);
  f.render.mockImplementationOnce(()=>{throw Error('capture lost');});expect(()=>f.owner.capturePaused(s,{...c,width:4,height:4})).toThrow('capture lost');expect(f.owner.matchesCompletedPrimary(s,c)).toBe(false);
  expect(()=>f.owner.generate(s,c)).toThrow('sessionId');expect(f.owner.generate(s,context({sessionId:'recovered'})).fractalLive!.updateOrdinal).toBe(0);
 });
 it.each([
  {density:1,width:161,height:121,logicalWidth:161,logicalHeight:121},
  {density:2,width:162,height:122,logicalWidth:81,logicalHeight:61},
  {density:3,width:162,height:120,logicalWidth:54,logicalHeight:40},
  {density:4,width:160,height:120,logicalWidth:40,logicalHeight:30},
 ])('uses retained parent density $density for both logical uniforms and physical capture',expected=>{
  const s=scene(),f=setup(),c={...context({clock:{paused:true}}),fractalPixelDensity:expected.density,fractalViewport:{logicalWidth:32,logicalHeight:24,target:'primary' as const}};
  f.owner.generate(s,c);const before=f.owner.diagnostics();f.render.mockClear();
  // Neither the sampled preview ratio nor an unrelated density in this
  // capture request may replace the completed primary's actual parent density.
  const result=f.owner.capturePaused(s,{...c,width:161,height:121,fractalPixelDensity:99,sourcePointPixelDensity:97});
  expect(result.capture).toMatchObject({width:expected.width,height:expected.height});
  expect(f.render.mock.calls[0][1]).toMatchObject({width:expected.width,height:expected.height,fractalPixelDensity:expected.density,fractalViewport:{logicalWidth:expected.logicalWidth,logicalHeight:expected.logicalHeight,target:'offscreen'}});
  expect(result.preview).toMatchObject({width:16,height:12});expect(f.render.mock.calls[1][1].fractalViewport).toEqual(c.fractalViewport);
  expect(f.owner.diagnostics()).toEqual(before);expect(f.owner.matchesCompletedPrimary(s,c)).toBe(true);
 });
 it.each([undefined,0,1.5,NaN])('keeps a completed live preview when its capture density is unknown/invalid: %s',density=>{
  const s=scene(),f=setup(),c={...context({clock:{paused:true}}),fractalPixelDensity:density};
  f.owner.generate(s,c);const before=f.owner.diagnostics();f.render.mockClear();
  expect(()=>f.owner.capturePaused(s,{...c,width:161,height:121,fractalPixelDensity:1})).toThrow('像素密度');
  expect(f.render).not.toHaveBeenCalled();expect(f.owner.diagnostics()).toEqual(before);expect(f.owner.matchesCompletedPrimary(s,c)).toBe(true);
 });
});

describe('retained Fractal display lifecycle',()=>{
 it('preserves saved source arithmetic with local coloring and consumes the same prepared numerical owner',()=>{
  const s=scene(),f=setup(),c=context({clock:{paused:true}});delete s.fractalSourceColor;delete s.settings.fractalColorProfile;
  for(let i=0;i<3;i++)f.owner.generate(s,c);
  for(const [current,context,prepared] of f.render.mock.calls){
   expect(context.fractalDisplay).toBeUndefined();expect(prepared!.colorPlan).toBeUndefined();
   expect(prepared!.sourcePlan!.formula).toBe('newton');
   expect(prepared!.source!.native).toEqual(current.evaluatedFractalScene!.formula.native);
  }
 });
 it('advances paused displays while leaving the original numerical clock stationary',()=>{
  const s=scene(),f=setup(),c=context({clock:{paused:true}});s.settings.renderMethod='multi-pass';
  const outputs=Array.from({length:5},()=>f.owner.generate(s,c));
  expect(outputs.map(o=>o.fractalLive!.sceneTime)).toEqual([0,0,0,0,0]);
  expect(outputs.map(o=>o.fractalLive!.objectUpdates)).toEqual([0,0,0,0,0]);
  expect(f.render.mock.calls.map(([,c])=>[c.fractalDisplay!.previewScale,c.fractalDisplay!.gradientSize,c.fractalDisplay!.needsAnotherDisplay])).toEqual([[.25,0,true],[.5,0,true],[1,0,true],[1,1024,false],[1,1024,false]]);
 });
 it('shares the display owner for paused offscreen capture and primary restore, without implicit warmups',()=>{
  const s=scene(),f=setup(),c=context({clock:{paused:true}});s.settings.renderMethod='multi-pass';
  for(let i=0;i<4;i++)f.owner.generate(s,c);f.render.mockClear();
  const result=f.owner.capturePaused(s,{...c,width:32,height:24,quality:'export'});
  expect(f.render).toHaveBeenCalledTimes(2);
  expect(f.render.mock.calls.map(([,c])=>c.fractalDisplay)).toEqual([
   expect.objectContaining({ordinal:4,previewScale:.25,gradientSize:1024,useGradientTexture:false,stateReset:true}),
   expect.objectContaining({ordinal:5,previewScale:.25,gradientSize:0,useGradientTexture:false,stateReset:true}),
  ]);
  expect(result.capture.fractalLive!.sceneTime).toBe(result.preview.fractalLive!.sceneTime);
  f.owner.generate(s,c);expect(f.render.mock.calls.at(-1)![1].fractalDisplay).toMatchObject({ordinal:6,previewScale:.5,gradientSize:0});
 });
 it('hot applies retain the shader queue while a new incarnation starts from a fresh shader',()=>{
  const s=scene(),f=setup(),c=context({clock:{paused:true}});s.settings.renderMethod='multi-pass';for(let i=0;i<4;i++)f.owner.generate(s,c);
  const hot=structuredClone(s);hot.settings.centerX=9;
  f.owner.generate(hot,context({clock:{paused:true},revision:1,intent:'hot',configuration:hot}));
  expect(f.render.mock.calls.at(-1)![1].fractalDisplay).toMatchObject({previewScale:.25,gradientSize:1024,stateReset:false});
  f.owner.generate(hot,context({sessionId:'fresh-display',clock:{paused:true}}));
  expect(f.render.mock.calls.at(-1)![1].fractalDisplay).toMatchObject({ordinal:0,previewScale:.25,gradientSize:0,stateReset:true});
 });
});
