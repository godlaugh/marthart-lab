import {describe,it,expect,vi} from 'vitest';
import {createScene,parseScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {IteratedDensitySession,generateIteratedDensity,visibleIteratedControls} from '../src/scenes/iteratedDensity';
import {copySamilaHistory,prepareSamilaHistoryFrame,selectSamilaHistoryModel,type SamilaHistoryState} from '../src/engine/samilaHistory';
import {iteratedSamilaSeedChunk} from '../src/engine/iteratedSeed';
import {IteratedDensityGpu,iteratedGpuBytes} from '../src/engine/iteratedDensityGpu';
import type {SceneOutput} from '../src/types';

const context={time:0,width:11,height:11,quality:'export' as const};
function scene(){const s=createScene(definition('samila'));s.equations={f1:'0',f2:'0'};s.parameters={a:0};Object.assign(s.settings,{iteratedMode:'continuous',iteratedBackend:'cpu',samilaHistoryModel:'bounded-v2',batchSize:4,iteratedFps:10,densityView:'manual',densitySpan:10,pointSize:1,paletteMode:'source',showTrails:false,alpha:1,accumulationDecay:1,mapping:'f1_f2',projection:'cartesian',start:-1,stop:1});return s;}
function pixels(o:SceneOutput){if(o.type!=='raster')throw Error('expected raster');return o.pixels;}
function plan(parameters:Record<string,number>,previous?:SamilaHistoryState,options:{fieldKey?:string;frame?:number;record?:boolean;forceClear?:boolean}={}){return prepareSamilaHistoryFrame({parameters,fieldKey:options.fieldKey??'field',frame:options.frame??0,count:4,record:options.record??true},previous,options.forceClear);}

describe('Samila versioned bounded history contract',()=>{
 it('acknowledges the first parameters once and compares key/value semantics without insertion order',()=>{
  const first=plan({a:1,b:2});expect(first).toMatchObject({clear:true,passes:1,samples:4,randomFrames:[0]});
  const same=plan({b:2,a:1},first.next,{frame:1});expect(same).toMatchObject({clear:false,passes:1,randomFrames:[6]});
  const added=plan({a:1,b:2,c:0},same.next,{frame:2});expect(added).toMatchObject({clear:true,passes:6,samples:24,randomFrames:[12,13,14,15,16,17]});
  expect(plan({a:1},added.next).passes).toBe(6);
 });
 it('accumulates epsilon changes against the last acknowledged parameters even across unrelated clears',()=>{
  const first=plan({a:0}),small=plan({a:.4e-9},first.next,{frame:1,fieldKey:'rotated'});
  expect(small).toMatchObject({clear:true,passes:1});expect(small.next.parameters).toEqual({a:0});
  const smaller=plan({a:.8e-9},small.next,{frame:2,fieldKey:'rotated',forceClear:true});expect(smaller.passes).toBe(1);expect(smaller.next.parameters).toEqual({a:0});
  const changed=plan({a:1.2e-9},smaller.next,{frame:3,fieldKey:'rotated'});expect(changed.passes).toBe(6);expect(changed.next.parameters).toEqual({a:1.2e-9});
 });
 it('acknowledges parameter clears while recording is off without deferred compensation',()=>{
  const first=plan({a:0}),paused=plan({a:1},first.next,{frame:1,record:false});expect(paused).toMatchObject({clear:true,passes:0,samples:0,randomFrames:[]});
  expect(plan({a:1},paused.next,{frame:2})).toMatchObject({clear:false,passes:1,samples:4,randomFrames:[12]});
 });
 it('uses disjoint deterministic PRNG addresses for all compensation passes',()=>{
  const batch=plan({a:1},plan({a:0}).next,{frame:1}),seeds=batch.randomFrames.map(frame=>iteratedSamilaSeedChunk({count:4,seed:42},frame,-1,1,0,4));
  expect(new Set(seeds.map(x=>Array.from(x).join(','))).size).toBe(6);
  expect(batch.randomFrames).not.toContain(plan({a:1},batch.next,{frame:2}).randomFrames[0]);
  expect(()=>prepareSamilaHistoryFrame({parameters:{a:0},fieldKey:'a',frame:Number.MAX_SAFE_INTEGER,count:8_000_000,record:true})).toThrow(/安全整数/);
  for(const count of [0,8_000_001,NaN,1.5])expect(()=>prepareSamilaHistoryFrame({parameters:{a:0},fieldKey:'a',frame:0,count,record:true})).toThrow();
 });
 it('decays before the 300 mass cap and rescales weighted RGB once before splatting',()=>{
  const ink=new Float64Array([800,400,200,800,600,300,150,600,0,0,0,0]);copySamilaHistory(ink,.5,300);
  expect(Array.from(ink)).toEqual([300,150,75,300,300,150,75,300,0,0,0,0]);
  const full=new Float64Array([400,200,100,400]);copySamilaHistory(full,1,300);expect(Array.from(full)).toEqual([300,150,75,300]);copySamilaHistory(full,0,300);expect(Array.from(full)).toEqual([0,0,0,0]);
  expect(()=>copySamilaHistory(new Float64Array(8),1,300,()=>true)).toThrow(/取消/);
 });
 it('keeps first-frame mass above 300 and caps only copied history; legacy output stays uncapped',()=>{
  const s=scene();s.settings.batchSize=400;const session=new IteratedDensitySession();
  expect(session.generate(s,context).density?.maxCount).toBe(400);
  const out=session.generate(s,{...context,time:.2});expect(out.density?.maxCount).toBe(700);expect(out.stats.samples).toBe(1200);expect(session.diagnostics()).toMatchObject({recordedPasses:3,lastFramePasses:1,lastFrameSamples:400});
  s.settings.samilaHistoryModel='legacy-v1';const legacy=generateIteratedDensity(s,{...context,time:.2});expect(legacy.density?.maxCount).toBe(1200);delete s.settings.samilaHistoryModel;expect(pixels(generateIteratedDensity(s,{...context,time:.2}))).toEqual(pixels(legacy));session.reset();
 });
 it('charges six genuinely new batches on timeline changes and keeps completed passes since the clear',()=>{
  const s=scene();s.timeline.tracks=[{id:'a',target:'parameters.a',from:0,to:1,start:0,duration:.2,easing:'linear',pingPong:false,enabled:true}];const session=new IteratedDensitySession();
  expect(session.generate(s,context).stats.samples).toBe(4);
  const changed=session.generate(s,{...context,time:.2});expect(changed.stats.samples).toBe(52);expect(changed.stats.generated).toBe(24);expect(changed.density?.maxCount).toBe(24);expect(session.diagnostics()).toMatchObject({recordedPasses:6,lastFramePasses:6,lastFrameSamples:24,clears:3});
  const next=session.generate(s,{...context,time:.3});expect(next.stats.samples).toBe(56);expect(next.density?.maxCount).toBe(28);expect(session.diagnostics().recordedPasses).toBe(7);session.reset();
 });
 it('preserves small timeline changes until they cumulatively cross epsilon',()=>{
  const s=scene();s.timeline.tracks=[{id:'a',target:'parameters.a',from:0,to:1.2e-9,start:0,duration:.3,easing:'linear',pingPong:false,enabled:true}];const session=new IteratedDensitySession();
  expect(session.generate(s,{...context,time:.2}).stats.samples).toBe(12);expect(session.diagnostics().clears).toBe(1);
  expect(session.generate(s,{...context,time:.3}).stats.samples).toBe(36);expect(session.diagnostics()).toMatchObject({clears:2,recordedPasses:6});session.reset();
 });
 it('reproduces cold, warm, seek, fractional time and saved document outputs without ambient UI state',()=>{
  const s=scene();s.equations={f1:'x+a',f2:'y'};s.settings.batchSize=19;s.timeline.tracks=[{id:'a',target:'parameters.a',from:0,to:1,start:0,duration:.2,easing:'linear',pingPong:false,enabled:true}];const session=new IteratedDensitySession();session.generate(s,context);session.generate(s,{...context,time:.1});const warm=session.generate(s,{...context,time:.3});
  expect(pixels(session.generate(s,{...context,time:.39}))).toEqual(pixels(warm));expect(pixels(generateIteratedDensity(s,{...context,time:.3}))).toEqual(pixels(warm));
  session.generate(s,{...context,time:0});expect(pixels(session.generate(s,{...context,time:.3}))).toEqual(pixels(warm));
  expect(pixels(generateIteratedDensity(parseScene(JSON.stringify(s)),{...context,time:.3}))).toEqual(pixels(warm));
  s.timeline.tracks=[];s.parameters.a=2;const edited=session.generate(s,context);expect(edited.stats.samples).toBe(19);expect(session.diagnostics().lastFramePasses).toBe(1);expect(pixels(edited)).toEqual(pixels(generateIteratedDensity(s,context)));session.reset();
 });
 it('does not sample paused timeline frames and resumes with one batch after acknowledging the changed parameters',()=>{
  const s=scene();s.timeline.tracks=[{id:'a',target:'parameters.a',from:0,to:1,start:0,duration:.1,easing:'linear',pingPong:false,enabled:true},{id:'pause',type:'trails',target:'settings.recordTrails',from:0,to:0,start:.1,duration:.1,easing:'linear',pingPong:false,enabled:true,trailsEnabled:false},{id:'resume',type:'trails',target:'settings.recordTrails',from:0,to:0,start:.2,duration:.1,easing:'linear',pingPong:false,enabled:true,trailsEnabled:true}];
  const session=new IteratedDensitySession(),paused=session.generate(s,{...context,time:.1});expect(paused.stats.samples).toBe(4);expect(paused.density?.maxCount).toBe(0);expect(session.diagnostics()).toMatchObject({recordedPasses:0,lastFrameSamples:0});
  expect(session.generate(s,{...context,time:.2}).stats.samples).toBe(8);expect(session.diagnostics()).toMatchObject({recordedPasses:1,lastFramePasses:1});session.reset();
 });
 it('accounts for the extra ping-pong texture before GPU admission and exposes controls only in Samila continuous mode',()=>{
  expect(iteratedGpuBytes(4,31,17,2048,true)-iteratedGpuBytes(4,31,17)).toBe(31*17*16);
  for(const kind of ['map','symmetry','samila'] as const){const s=createScene(definition(kind));s.settings.iteratedMode='continuous';const keys=visibleIteratedControls(kind,s.settings,definition(kind).controls).map(c=>c.key);expect(keys.includes('samilaHistoryModel')).toBe(kind==='samila');s.settings.iteratedMode='single';expect(visibleIteratedControls(kind,s.settings,definition(kind).controls).map(c=>c.key)).not.toContain('samilaHistoryModel');}
 });
 it('keeps explicit model selection compatible without rewriting imported combinations',()=>{const settings={samilaHistoryModel:'bounded-v2',densityToneModel:'samila-normalized-v2',normalizedGamma:3};expect(selectSamilaHistoryModel(settings,'legacy-v1')).toEqual({...settings,samilaHistoryModel:'legacy-v1',densityToneModel:'white-point-v1'});expect(selectSamilaHistoryModel(settings,'bounded-v2')).toEqual(settings);for(const value of ['wrong',null,true,0])expect(()=>selectSamilaHistoryModel(settings,value)).toThrow();const s=scene();Object.assign(s.settings,{samilaHistoryModel:'legacy-v1',densityToneModel:'samila-normalized-v2'});expect(()=>generateIteratedDensity(s,context)).toThrow(/Samila 归一调色/);});
 it('rejects expanded compensation work before invoking the GPU or CPU sampler',()=>{const s=scene();Object.assign(s.settings,{iteratedBackend:'gpu',batchSize:1_100_000,pointSize:16,recordTrails:false});s.timeline.tracks=[{id:'a',target:'parameters.a',from:0,to:1,start:0,duration:.1,easing:'linear',pingPong:false,enabled:true},{id:'resume',type:'trails',target:'settings.recordTrails',from:0,to:0,start:.1,duration:.1,easing:'linear',pingPong:false,enabled:true,trailsEnabled:true}];const session=new IteratedDensitySession(),step=vi.spyOn(IteratedDensityGpu.prototype,'step').mockImplementation((_job,options)=>({bounds:options.bounds!,steps:0,invalid:0,accepted:0,clipped:0,sampleInvalid:0}));try{expect(()=>session.generate(s,{...context,time:.1})).toThrow(/20 亿次像素/);expect(step).toHaveBeenCalledTimes(1);expect(session.diagnostics().retainedBytes).toBe(0);}finally{step.mockRestore();session.reset();}});
 it('uses the latest completed frame facts for normalized tone between fixed sampling times',()=>{const s=scene();Object.assign(s.settings,{iteratedBackend:'gpu',densityToneModel:'samila-normalized-v2'});s.timeline.tracks=[{id:'alpha',target:'settings.alpha',from:1,to:0,start:0,duration:.2,easing:'linear',pingPong:false,enabled:true}];const session=new IteratedDensitySession(),step=vi.spyOn(IteratedDensityGpu.prototype,'step').mockImplementation((job,options)=>({bounds:options.bounds!,steps:job.history!.samples,invalid:0,accepted:job.history!.samples,clipped:0,sampleInvalid:0})),present=vi.spyOn(IteratedDensityGpu.prototype,'present').mockImplementation(tone=>{if(tone.model!=='samila-normalized-v2')throw Error();expect(tone.normalization).toMatchObject({alpha:.5,completedPasses:2,baseBatchSize:4,width:11,height:11,splat:{radiusPixels:.5}});return{pixels:new Uint8ClampedArray(11*11*4),occupiedPixels:1,maxCount:6,toneBackend:'webgl2',warnings:[]};});try{session.generate(s,{...context,time:.15});session.generate(s,{...context,time:.19});expect(step).toHaveBeenCalledTimes(2);expect(present).toHaveBeenCalledTimes(2);}finally{step.mockRestore();present.mockRestore();session.reset();}});
 it('fully replays GPU partial failure on CPU with identical six-pass facts and releases cancelled state',()=>{
  const s=scene();s.settings.iteratedBackend='gpu';s.timeline.tracks=[{id:'a',target:'parameters.a',from:0,to:1,start:0,duration:.1,easing:'linear',pingPong:false,enabled:true}];const session=new IteratedDensitySession(),plans:number[]=[];
  const step=vi.spyOn(IteratedDensityGpu.prototype,'step').mockImplementation((job,options)=>{plans.push(job.history!.passes);if(job.frame===1)throw Error('history copy failure');return{bounds:options.bounds!,steps:job.history!.samples,invalid:0,accepted:job.history!.samples,clipped:0,sampleInvalid:0};});
  try{const actual=session.generate(s,{...context,time:.2});expect(plans).toEqual([1,6]);expect(actual.backend).toBe('cpu');expect(actual.stats.samples).toBe(32);s.settings.iteratedBackend='cpu';expect(pixels(actual)).toEqual(pixels(generateIteratedDensity(s,{...context,time:.2})));expect(()=>session.generate(s,{...context,time:.3,isCancelled:()=>true})).toThrow(/取消/);expect(session.diagnostics().retainedBytes).toBe(0);}finally{step.mockRestore();session.reset();}
 });
});
