import {afterEach,describe,expect,it,vi} from 'vitest';
import {SourceImplicitRecordingSession} from '../src/engine/sourceImplicitRecording';
import {generateScene} from '../src/engine/temporal';
import {parseProjectFile} from '../src/engine/legacyImport';
import {ordinarySourceViewport} from '../src/engine/ordinarySourceCamera';
import type {ImplicitPaletteFacts} from '../src/engine/implicitPaletteControl';
import type {GenerateContext,SceneDocument,SceneOutput} from '../src/types';
import * as geometry from '../src/scenes/geometry';
import native from './fixtures/source-implicit-presentation/recording-clock.json';

type Geometry=Extract<SceneOutput,{type:'geometry'}>;
function fixture(){
 const raw=structuredClone(native.cases[0].input.project);raw.settings.x_segments=raw.settings.y_segments=raw.settings.z_segments=4;
 const scene=parseProjectFile(JSON.stringify(raw)).scene;scene.implicitSourcePalette={colors:['#80112233','#40abcdef']};
 const context:GenerateContext={time:0,width:64,height:48,quality:'preview',sourcePointPixelDensity:1,sourceViewport:ordinarySourceViewport(scene,64,48,'primary',48),implicitControls:{sessionId:'palette-test',acknowledgedRevision:0,commands:[{kind:'apply',revision:1,scene}]}};
 const owner=new SourceImplicitRecordingSession(),options={width:64,height:48,simulationFps:4,actualFrameRate:37};
 return{scene,context,owner,options};
}
function render(context:GenerateContext){return(scene:SceneDocument,palette:ImplicitPaletteFacts):Geometry=>{
 const {implicitControls:_controls,implicitLive:_live,...input}=context;void _controls;void _live;
 const output=generateScene(scene,{...input,implicitPalettePrepared:palette});if(output.type!=='geometry')throw Error('Expected geometry');return output;
};}
function run(f:ReturnType<typeof fixture>,scene=f.scene,context=f.context){return f.owner.generateControlled(scene,context,render(context));}
function hot(f:ReturnType<typeof fixture>,colors=['#8000ff00'],author=f.scene){
 const context={...f.context,implicitControls:{sessionId:'palette-test',acknowledgedRevision:1,commands:[{kind:'palette' as const,revision:2,colors}]}};
 return{context,output:run(f,author,context)};
}
afterEach(()=>vi.restoreAllMocks());

describe('Implicit palette commands and completed geometry ownership',()=>{
 it('uses cold Apply geometry and narrow hot colors while retaining staged author fields',()=>{
  const f=fixture(),first=run(f),staged=structuredClone(f.scene);staged.parameters.unapplied=123;staged.equations={...staged.equations,f:'unapplied()'};staged.sourceCamera={...staged.sourceCamera!,configuration:{kind:'angles',family:'implicit',phi:123}};staged.implicitSourcePalette={colors:['#80ff0000']};
  let effective:SceneDocument|undefined,palette:ImplicitPaletteFacts|undefined;
  const context={...f.context,implicitControls:{sessionId:'palette-test',acknowledgedRevision:1,commands:[{kind:'palette' as const,revision:2,colors:['#8000ff00']}]}};
  const output=f.owner.generateControlled(staged,context,(value,facts)=>{effective=value;palette=facts;return render(context)(value,facts);});
  expect(effective?.equations).toEqual(f.scene.equations);expect(effective?.parameters).toEqual(f.scene.parameters);expect(effective?.sourceCamera).toEqual(f.scene.sourceCamera);expect(palette?.packed).toEqual([0xff00ff00]);
  expect(output.positions).toEqual(first.positions);expect(output.sourceCameraFrame).toEqual(first.sourceCameraFrame);expect(output.implicitControls).toEqual({sessionId:'palette-test',revision:2,applyRevision:1,resetRevision:1});
  expect(Array.from(output.sourceImplicitPresentation!.fillColors.slice(0,4))).toEqual([0,1,0,Math.fround(229/255)]);expect(output.sourceImplicitPresentation!.fillColors).not.toEqual(first.sourceImplicitPresentation!.fillColors);
  expect(f.owner.matchesCompletedPrimary(staged,context)).toBe(true);expect(staged.implicitSourcePalette.colors).toEqual(['#80ff0000']);f.owner.reset();
 });
 it('keeps prior primary on render/cancellation/identity failure and allows exact retry',()=>{
  const f=fixture();run(f);const update={...f.context,implicitControls:{sessionId:'palette-test',acknowledgedRevision:1,commands:[{kind:'palette' as const,revision:2,colors:['#123456']}]}};
  expect(()=>f.owner.generateControlled(f.scene,update,()=>{throw Error('geometry failed');})).toThrow('geometry failed');expect(f.owner.matchesCompletedPrimary(f.scene,f.context)).toBe(true);
  let cancelled=false;const context={...update,isCancelled:()=>cancelled};expect(()=>f.owner.generateControlled(f.scene,context,(scene,facts)=>{const output=render(context)(scene,facts);cancelled=true;return output;})).toThrowError(expect.objectContaining({name:'AbortError'}));expect(f.owner.matchesCompletedPrimary(f.scene,f.context)).toBe(true);
  expect(()=>run(f,f.scene,{...update,implicitControls:{...update.implicitControls,sessionId:'lost'}})).toThrow('Apply');expect(f.owner.matchesCompletedPrimary(f.scene,f.context)).toBe(true);
  const done=run(f,f.scene,update);expect(done.implicitControls?.revision).toBe(2);expect(run(f,f.scene,update).implicitControls).toEqual(done.implicitControls);f.owner.reset();
 });
 it('preflights every Apply so a later valid Apply cannot conceal malformed geometry',()=>{
  const f=fixture();run(f);const invalid=structuredClone(f.scene);invalid.equations.f='sin(';
  const context={...f.context,implicitControls:{sessionId:'palette-test',acknowledgedRevision:1,commands:[{kind:'apply' as const,revision:2,scene:invalid},{kind:'apply' as const,revision:3,scene:f.scene}]}};
  expect(()=>run(f,f.scene,context)).toThrow();expect(f.owner.matchesCompletedPrimary(f.scene,f.context)).toBe(true);
  const update=hot(f);expect(update.output.implicitControls?.revision).toBe(2);f.owner.reset();
 });
 it('rejects replay-time Apply/restart and prevents callback re-entry without losing primary',()=>{
  const f=fixture();run(f);const restart={...f.context,time:.5,implicitControls:{sessionId:'palette-test',acknowledgedRevision:1,commands:[{kind:'restart' as const,revision:2}]}};
  expect(()=>run(f,f.scene,restart)).toThrow('时间必须为 0');expect(f.owner.matchesCompletedPrimary(f.scene,f.context)).toBe(true);
  const context={...restart,time:0};expect(()=>f.owner.generateControlled(f.scene,context,()=>run(f))).toThrow('期间');expect(f.owner.matchesCompletedPrimary(f.scene,f.context)).toBe(true);
  expect(run(f,f.scene,context).implicitControls).toMatchObject({revision:2,applyRevision:1,resetRevision:2});f.owner.reset();
 });
});

describe('Implicit cold recording reset and controlled continuation',()=>{
 it('commits the cold reset only after a successful warmup and returns the author without applying staged fields',()=>{
  const f=fixture(),cold=run(f),staged=structuredClone(f.scene);staged.parameters.unapplied=123;staged.equations.f='x';staged.timeline.tracks=[];staged.implicitSourcePalette={colors:['#80ff0000']};const update=hot(f,['#8000ff00'],staged);
  vi.spyOn(geometry,'generateImplicit').mockImplementationOnce(()=>{throw Error('warmup failure');});expect(()=>f.owner.beginRecording(staged,update.context,f.options)).toThrow('warmup failure');expect(f.owner.matchesCompletedPrimary(staged,update.context)).toBe(true);
  expect(run(f,staged,update.context).implicitControls).toMatchObject({revision:2,resetRevision:1});
  const start=f.owner.beginRecording(staged,update.context,f.options);expect(start.scene).toEqual(staged);expect(start.warmup.implicitControls).toMatchObject({revision:2,applyRevision:1,resetRevision:2});expect(start.warmup.sourceImplicitParameters?.values).not.toHaveProperty('unapplied');
  expect(start.warmup.positions).toEqual(cold.positions);expect(start.warmup.sourceImplicitPresentation!.fillColors).toEqual(cold.sourceImplicitPresentation!.fillColors);expect(start.clock.encodedFrames).toBeGreaterThan(0);expect(start.context.implicitControls).toEqual({sessionId:'palette-test',acknowledgedRevision:2,commands:[]});
  const frame=f.owner.nextRecordingFrame(start.handle,1,12);expect(frame.implicitControls).toEqual(start.warmup.implicitControls);
  const stop=f.owner.finishRecording(start.handle,1000);expect(stop.scene).toEqual(staged);expect(stop.context.implicitControls).toEqual(start.context.implicitControls);expect(stop.preview.implicitControls).toEqual(start.warmup.implicitControls);expect(stop.preview.sourceCameraFrame?.frameIndex).toBe(1);f.owner.reset();
 });
 it('does not revive old unacknowledged hot colors after recording and keeps the held queue for new hot colors/capture/pause',()=>{
  const f=fixture();run(f);const staged=structuredClone(f.scene);staged.implicitSourcePalette={colors:['#80ff0000']};const update=hot(f,['#8000ff00'],staged),start=f.owner.beginRecording(staged,update.context,f.options),stop=f.owner.finishRecording(start.handle,1000);
  const paused=f.owner.setPaused(stop.scene,stop.context,true,1100),retry={...paused,implicitControls:update.context.implicitControls};
  const original=run(f,stop.scene,retry);expect(original.implicitControls).toMatchObject({revision:2,resetRevision:2});expect(original.sourceCameraFrame).toEqual(stop.preview.sourceCameraFrame);
  expect(original.sourceImplicitPresentation!.fillColors).toEqual(stop.preview.sourceImplicitPresentation!.fillColors);expect(original.sourceImplicitPresentation!.fillColors).not.toEqual(update.output.sourceImplicitPresentation!.fillColors);
  const next={...paused,implicitControls:{sessionId:'palette-test',acknowledgedRevision:2,commands:[{kind:'palette' as const,revision:3,colors:['#80abcdef']}]}};
  const changed=run(f,stop.scene,next);expect(changed.implicitControls).toMatchObject({revision:3,applyRevision:1,resetRevision:2});expect(changed.sourceCameraFrame).toEqual(stop.preview.sourceCameraFrame);expect(changed.implicitLive?.renderKind).toBe('snapshot');
  const capture=f.owner.capturePaused(stop.scene,next,{width:64,height:48},1);expect(capture.scene).toEqual(staged);expect(capture.capture.implicitControls).toEqual(changed.implicitControls);expect(capture.preview.sourceCameraFrame).toEqual(changed.sourceCameraFrame);
  const resumed=f.owner.setPaused(stop.scene,next,false,2000),context={...resumed,implicitControls:{sessionId:'palette-test',acknowledgedRevision:3,commands:[]},implicitLive:{...resumed.implicitLive!,clock:{paused:false,timestampMs:2125}}};
  const continued=run(f,stop.scene,context);expect(continued.sourceCameraFrame).toMatchObject({frameIndex:1,sceneTime:.375,rawDt:.125});expect(continued.implicitControls).toEqual(changed.implicitControls);f.owner.reset();
 });
 it('rejects reset on a held live context, then applies a fresh context without carrying the old queue',()=>{
  const f=fixture(),initial=run(f),start=f.owner.beginRecording(f.scene,f.context,f.options),stop=f.owner.finishRecording(start.handle,1000),context={...stop.context,time:0,implicitControls:{sessionId:'palette-test',acknowledgedRevision:1,commands:[{kind:'restart' as const,revision:2}]}};
  expect(()=>run(f,stop.scene,context)).toThrow('新的主预览上下文');expect(f.owner.matchesCompletedPrimary(stop.scene,stop.context)).toBe(true);
  const {implicitLive:_missingClock,...noClock}=stop.context;void _missingClock;const renderSpy=vi.fn(render(noClock));expect(()=>f.owner.generateControlled(stop.scene,noClock,renderSpy)).toThrow('需要 implicitLive');expect(renderSpy).not.toHaveBeenCalled();expect(f.owner.matchesCompletedPrimary(stop.scene,stop.context)).toBe(true);
  const {implicitControls:_missingControl,...noControl}=stop.context;void _missingControl;expect(()=>f.owner.generateContinuation(stop.scene,noControl)).toThrow('控制事务');expect(f.owner.matchesCompletedPrimary(stop.scene,stop.context)).toBe(true);
  const {implicitLive:_live,...fresh}=context;void _live;const output=run(f,stop.scene,fresh);expect(output.implicitControls).toMatchObject({revision:2,resetRevision:3});expect(output.sourceCameraFrame).toEqual(initial.sourceCameraFrame);expect(output.implicitLive).toBeUndefined();expect(()=>f.owner.generateControlled(stop.scene,context,render(context))).toThrow();f.owner.reset();
 });
 it('retains the existing consumed-frame failure rule for continuation while not committing a failed hot transaction',()=>{
  const f=fixture();run(f);const start=f.owner.beginRecording(f.scene,f.context,f.options),stop=f.owner.finishRecording(start.handle,1000),context={...stop.context,implicitControls:{sessionId:'palette-test',acknowledgedRevision:1,commands:[{kind:'palette' as const,revision:2,colors:['#abcdef']}]},implicitLive:{...stop.context.implicitLive!,clock:{paused:false,timestampMs:1125}}};
  vi.spyOn(geometry,'generateImplicit').mockImplementationOnce(()=>{throw Error('continued geometry');});expect(()=>run(f,stop.scene,context)).toThrow('continued geometry');expect(f.owner.matchesCompletedPrimary(stop.scene,stop.context)).toBe(false);expect(()=>run(f,stop.scene,context)).toThrow('原录制');
  const {implicitLive:_live,...fresh}=context;void _live;expect(()=>run(f,stop.scene,{...fresh,time:0})).toThrow('需要 implicitLive');
  const output=run(f,stop.scene,{...fresh,time:0,implicitControls:{sessionId:'palette-test',acknowledgedRevision:1,commands:[{kind:'restart',revision:2}]}});expect(output.implicitControls).toMatchObject({revision:2,applyRevision:1,resetRevision:3});f.owner.reset();
 });
});
