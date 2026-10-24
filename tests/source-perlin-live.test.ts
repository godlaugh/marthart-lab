import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {AnimationTrack,GenerateContext,SceneDocument,SceneOutput} from '../src/types';
import {SourcePerlinSession} from '../src/scenes/sourcePerlin';
import {parseProjectFile} from '../src/engine/legacyImport';
import {ordinarySourceCameraInitial} from '../src/engine/ordinarySourceCamera';
import {OrdinarySourceCameraTimelineSession} from '../src/engine/ordinarySourceCameraTimeline';
import {validateSourcePerlinLiveContext} from '../src/engine/sourcePerlinLive';

// Only graphics execution is replaced. The real shared timeline, CPU model,
// noise resources, parameters, gradient, particle motion and trails run here.
// This verifies lifecycle/ownership, not GL pixels or original window timing.
const graphics=vi.hoisted(()=>({targets:[] as object[],drawFailure:false}));
vi.mock('../src/engine/sourcePerlinCpuTarget',()=>{
 class Target {
  readonly width:number;readonly height:number;readonly density:number;readonly samples:number;
  readonly physicalWidth:number;readonly physicalHeight:number;draws=0;disposed=false;gpuTimes:number[]=[];
  constructor(o:{width:number;height:number;density:number;samples?:number}){this.width=o.width;this.height=o.height;this.density=o.density;this.samples=o.samples??0;this.physicalWidth=o.width*o.density;this.physicalHeight=o.height*o.density;graphics.targets.push(this);}
  static createSmoothed(o:{width:number;height:number;density:number},samples:number){return new Target({...o,samples});}
  createSibling(o:{width:number;height:number;density:number;samples?:number}){return new Target(o);}
  draw(){if(graphics.drawFailure)throw Error('target draw failure');this.draws++;}
  drawGpu(f:{time:number},channel:{size:number}){expect(channel.size).toBe(512);this.gpuTimes.push(f.time);this.draw();}
  readPixels(cancelled?:()=>boolean){if(cancelled?.())throw new DOMException('cancelled','AbortError');return new Uint8ClampedArray(this.physicalWidth*this.physicalHeight*4);}
  withWorkingBytes<T>(_n:number,fn:()=>T){return fn();}
  releaseSceneGpuBindings(){}
  diagnostics(){return{width:this.width,height:this.height,density:this.density,samples:this.samples,initialized:this.draws>0,draws:this.draws};}
  dispose(){this.disposed=true;}
 }
 return{SourcePerlinCpuTarget:Target};
});
type Raster=Extract<SceneOutput,{type:'raster'}>;
const track=(duration:number,actions:AnimationTrack['actions']=[]):AnimationTrack=>({id:crypto.randomUUID(),type:actions.length?'animate':'wait',target:'camera.actions',duration,actions,easing:'linear',enabled:true,pingPong:false,start:0,from:0,to:0});
function scene(){
 const s=parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'PERLIN',name:'Live boundary',settings:{render_mode:'CPU',seed:123,particle_count:3,cpu_render_style:'PARTICLES'},timeline:[]})).scene;
 s.timeline.fps=4;s.timeline.tracks=[track(.25,[
  {id:'ambient',method:'ambient',args:{thetaSpeed:1}},
  {id:'parameter',method:'paramStart',perlinParameters:{kind:'start',parameters:[{name:'noise_scale',step:1,min:4,max:30}]}},
  {id:'gradient',method:'gradientStart',gradient:{model:'offsets',mode:'hue_rotate',interpolation:'linear',speed:90,affectInside:true,affectOutside:true}},
 ])];return s;
}
const context=(timestampMs=1000,paused=false):GenerateContext=>({time:0,width:8,height:6,quality:'preview',sourcePerlinViewport:{width:8,height:6,pixelDensity:1},sourceViewport:{logicalWidth:8,logicalHeight:6,referenceLogicalHeight:6,target:'primary',projectionPass:'perspective'},perlinLive:{sessionId:'perlin-live',clock:{paused,timestampMs}}});
function generate(owner:SourcePerlinSession,s:SceneDocument,c:GenerateContext):Raster{const o=owner.generate(s,c);expect(o.type).toBe('raster');return o as Raster;}
function numeric(owner:SourcePerlinSession){const state=owner.diagnosticSnapshot()!,model=owner.diagnostics().model!;return{time:model.time,updates:model.updates,cpuUpdates:model.cpuUpdates,motion:state.motion,trails:state.trails,parameters:state.parameters,gradient:state.colors.gradient};}
beforeEach(()=>{graphics.targets.length=0;graphics.drawFailure=false;});

describe('Perlin retained live owner',()=>{
 it.each(['cpu','gpu'] as const)('continues %s Scene/camera/display after completion while retaining object state',backend=>{
  const s=scene();s.perlinSource!.backend=backend;const owner=new SourcePerlinSession();
  const first=generate(owner,s,context());expect(first.perlinLive).toMatchObject({renderKind:'update',sceneTime:0,constructions:1,frame:{frameIndex:0,rawDt:0}});
  const terminal=generate(owner,s,context(1250)),before=numeric(owner),target=graphics.targets[0] as {draws:number;gpuTimes:number[];disposed:boolean};
  expect(terminal.sourcePerlinFrame).toMatchObject({sceneTime:.25,queueComplete:true,updates:2});
  const later=generate(owner,s,context(1500));
  expect(later.perlinLive).toMatchObject({sceneTime:.5,frame:{frameIndex:2,queueComplete:true,rawDt:.25,activeDt:0}});
  expect(later.perlinLive!.frame.camera.theta).toBeGreaterThan(terminal.perlinLive!.frame.camera.theta);
  expect(numeric(owner)).toEqual(before);expect(target.draws).toBe(3);expect(graphics.targets).toHaveLength(1);expect(target.disposed).toBe(false);
  if(backend==='gpu')expect(target.gpuTimes).toEqual([0,.25,.25]);
  owner.reset();expect(target.disposed).toBe(true);
 });
 it('keeps paused updates and capture numerical snapshots; resume uses its own wall-clock anchor',()=>{
  const s=scene(),owner=new SourcePerlinSession();generate(owner,s,context());const finished=generate(owner,s,context(1250));
  owner.setPaused(true,2000);const before=numeric(owner),paused=context(9000,true);
  const redraw=generate(owner,s,paused);expect(redraw.perlinLive).toMatchObject({paused:true,renderKind:'snapshot',sceneTime:.25,frame:{frameIndex:1}});
  expect(numeric(owner)).toEqual(before);
  const image=owner.capturePaused(s,{...paused,width:4,height:4,sourceViewport:{...paused.sourceViewport!,target:'offscreen'}});
  for(const output of [image.capture,image.preview])expect(output.perlinLive).toMatchObject({paused:true,renderKind:'snapshot',sceneTime:finished.perlinLive!.sceneTime,frame:{frameIndex:1}});
  expect(numeric(owner)).toEqual(before);expect(owner.matchesCompletedPrimary(s,paused)).toBe(true);
  expect(()=>owner.setPaused(false,NaN)).toThrow();expect(owner.matchesCompletedPrimary(s,paused)).toBe(true);
  owner.setPaused(false,10000);const next=generate(owner,s,context(10250));expect(next.perlinLive).toMatchObject({sceneTime:.5,frame:{rawDt:.25,frameIndex:2}});owner.reset();
 });
 it('starts paused at zero and hot switches CPU/GPU without changing numerical or target identity',()=>{
  const s=scene(),owner=new SourcePerlinSession(),c=context(1000,true);const initial=generate(owner,s,c),target=graphics.targets[0];
  expect(initial.sourcePerlinFrame).toMatchObject({sceneTime:0,updates:0});
  const before=owner.diagnosticSnapshot()!;s.perlinSource!.backend='gpu';const gpu=generate(owner,s,c);
  expect(gpu.backend).toBe('webgl2');expect(owner.diagnostics().flow?.builds).toBe(1);
  s.perlinSource!.backend='cpu';const cpu=generate(owner,s,c),after=owner.diagnosticSnapshot()!;
  expect(cpu.perlinLive).toMatchObject({renderKind:'snapshot',frame:{frameIndex:0}});
  expect(after.motion).toEqual(before.motion);expect(after.parameters.values).toEqual(before.parameters.values);expect(after.parameters.drifts).toEqual(before.parameters.drifts);
  expect(after.colors.gradient).toEqual(before.colors.gradient);expect(graphics.targets).toEqual([target]);expect(owner.diagnostics().appliedBackend).toBe('cpu');owner.reset();
 });
 it('auto applies ordinary edits at zero without replaying a previous local seek; target resize still reconstructs',()=>{
  const s=scene(),owner=new SourcePerlinSession(),c=context(1000,true);c.perlinLive!.startAt=.5;
  const sought=generate(owner,s,c);expect(sought.sourcePerlinFrame).toMatchObject({frameIndex:2,sceneTime:.75});
  const old=graphics.targets[0] as {disposed:boolean};s.perlinSource!.particles.stepSize=2;
  const applied=generate(owner,s,c);expect(applied.sourcePerlinFrame).toMatchObject({frameIndex:0,sceneTime:0,updates:0});expect(old.disposed).toBe(true);
  const next={...c,width:4,height:3,sourcePerlinViewport:{width:4,height:3,pixelDensity:1},sourceViewport:{...c.sourceViewport!,logicalWidth:4,logicalHeight:3}};
  expect(generate(owner,s,next).sourcePerlinFrame).toMatchObject({frameIndex:0,sceneTime:0});owner.reset();
 });
 it.each(['particles','field-curves','gpu'] as const)('hot recolors %s without replacing simulation, gradient, camera or target',style=>{
  const s=scene(),config=s.perlinSource!;
  config.backend=style==='gpu'?'gpu':'cpu';config.cpuStyle=style==='field-curves'?'field-curves':'particles';
  config.curves.count=3;config.curves.length=4;
  const owner=new SourcePerlinSession();generate(owner,s,context());generate(owner,s,context(1125));owner.setPaused(true,1125);
  const c=context(9000,true),before=generate(owner,s,c),numericBefore=numeric(owner),snapshot=owner.diagnosticSnapshot()!,targets=[...graphics.targets];
  config.palette=[0x40112233,0x80112233];
  const recolored=generate(owner,s,c),after=owner.diagnosticSnapshot()!;
  expect(recolored.perlinLive).toEqual(before.perlinLive);expect(recolored.sourcePerlinFrame).toEqual(before.sourcePerlinFrame);
  expect(numeric(owner)).toEqual(numericBefore);expect(after.geometry).toEqual(snapshot.geometry);expect(graphics.targets).toEqual(targets);
  expect(after.colors.revision).toBe(snapshot.colors.revision+1);
  expect(config.palette).toEqual([0x40112233,0x80112233]);
  if(style!=='field-curves')expect([...after.particleColors!.packed]).toEqual([0xff112233,0xff112233,0xff112233]);
  // A structural edit still constructs from the authored, alpha-bearing list.
  config.palette=[0x40112233];config.particles.stepSize+=1;
  expect(generate(owner,s,c).sourcePerlinFrame).toMatchObject({sceneTime:0,updates:0});
  expect(graphics.targets.length).toBeGreaterThan(targets.length);expect(targets[0]).toMatchObject({disposed:true});
  if(style!=='field-curves')expect([...owner.diagnosticSnapshot()!.particleColors!.packed]).toEqual([0x40112233,0x40112233,0x40112233]);
  owner.reset();
 });
 it('records from the cold palette while preserving authored colors across the recording handoff',()=>{
  const s=scene();s.timeline.tracks=[track(.5)];s.perlinSource!.palette=[0x40123456,0x80abcdef];
  const owner=new SourcePerlinSession(),c=context(1000,true);generate(owner,s,c);
  const original=owner.diagnosticSnapshot()!.particleColors!.packed;
  s.perlinSource!.palette=[0x20112233,0x60445566];generate(owner,s,c);
  expect(owner.diagnosticSnapshot()!.particleColors!.packed).not.toEqual(original);
  const recording=owner.beginRecording(s,c,{width:4,height:4,simulationFps:4});
  expect(owner.diagnosticSnapshot()!.particleColors!.packed).toEqual(original);
  expect(recording.scene.perlinSource!.palette).toEqual(s.perlinSource!.palette);
  owner.nextRecordingFrame(recording.handle,1);const stopped=owner.finishRecording(recording.handle);
  expect(stopped.scene.perlinSource!.palette).toEqual(s.perlinSource!.palette);
  owner.setPaused(true,2000);const paused={...stopped.context,perlinLive:{...stopped.context.perlinLive!,clock:{paused:true,timestampMs:2000}}};
  generate(owner,stopped.scene,paused);expect(owner.diagnosticSnapshot()!.particleColors!.packed).toEqual(original);
  stopped.scene.perlinSource!.palette=[0x01112233];generate(owner,stopped.scene,paused);
  expect([...owner.diagnosticSnapshot()!.particleColors!.packed]).toEqual([0xff112233,0xff112233,0xff112233]);
  owner.applyConfiguration(stopped.scene);generate(owner,stopped.scene,paused);
  expect([...owner.diagnosticSnapshot()!.particleColors!.packed]).toEqual([0x01112233,0x01112233,0x01112233]);
  owner.reset();
 });
 it('resumes from the actual paused seek camera instead of restoring the initial camera',()=>{
  const s=scene(),owner=new SourcePerlinSession(),c=context(1000,true);c.perlinLive!.startAt=.5;
  const seek=generate(owner,s,c);expect(seek.perlinLive!.frame.camera.theta).not.toBe(ordinarySourceCameraInitial(s)!.theta);
  owner.setPaused(false,2000);const next=generate(owner,s,{...c,perlinLive:{...c.perlinLive!,clock:{paused:false,timestampMs:2000}}});
  expect(next.perlinLive!.frame.camera).toEqual(seek.perlinLive!.frame.camera);expect(next.perlinLive!.frame.rawDt).toBe(0);owner.reset();
 });
 it('recording resets simulation once but retains canvases; finish resumes that instance without another update',()=>{
  let now=1000;const s=scene();s.timeline.tracks=[track(.25),track(.25)];
  const owner=new SourcePerlinSession({now:()=>now}),c=context(1000,true);generate(owner,s,c);const primary=graphics.targets[0] as {disposed:boolean;draws:number};
  const recording=owner.beginRecording(s,c,{width:4,height:4,simulationFps:4});
  expect(recording.warmup.perlinLive).toMatchObject({clockSource:'fixed-step',paused:false,frame:{frameIndex:0,sceneTime:.25}});
  const last=owner.nextRecordingFrame(recording.handle,1);expect(last.perlinLive).toMatchObject({sceneTime:.5,frame:{time:.25,frameIndex:1,queueComplete:true}});
  const before=numeric(owner),constructions=owner.diagnostics().constructions,targets=[...graphics.targets];now=5000;
  const stop=owner.finishRecording(recording.handle);expect(stop.context).toMatchObject({time:.5,perlinLive:{sessionId:'perlin-live',clock:{paused:false}}});expect(stop.context.perlinLive!.startAt).toBeUndefined();
  expect(numeric(owner)).toEqual(before);expect(owner.diagnostics().constructions).toBe(constructions);expect(graphics.targets).toEqual(targets);
  if(!('preview'in stop))throw Error('Live stop must own its preview');
  expect(stop.preview.perlinLive).toMatchObject({renderKind:'snapshot',sceneTime:.5,frame:{frameIndex:1}});expect(numeric(owner)).toEqual(before);expect(primary.disposed).toBe(false);
  const draws=primary.draws;structuredClone(stop.preview.pixels,{transfer:[stop.preview.pixels.buffer]});expect(stop.preview.pixels.byteLength).toBe(0);now=5100;
  const retry=owner.finishRecording(recording.handle);if(!('preview'in retry))throw Error('Live retry must own its preview');
  expect(retry.preview.pixels.byteLength).toBe(8*6*4);expect(retry.preview.perlinLive).toEqual(stop.preview.perlinLive);expect(primary.draws).toBe(draws);expect(numeric(owner)).toEqual(before);
  expect(owner.diagnostics().live?.lastTime).toBe(5);
  const live=generate(owner,stop.scene,{...stop.context,perlinLive:{...stop.context.perlinLive!,clock:{paused:false,timestampMs:5250}}});
  expect(live.perlinLive).toMatchObject({renderKind:'update',sceneTime:.75,frame:{frameIndex:2,rawDt:.25}});expect(numeric(owner)).toEqual(before);expect(graphics.targets).toEqual(targets);expect(()=>owner.finishRecording(recording.handle)).toThrow('身份');owner.reset();
 });
 it('keeps legacy fixed recording fixed and preserves deterministic replay',()=>{
  const s=scene(),owner=new SourcePerlinSession(),c={...context(),perlinLive:undefined};const a=generate(owner,s,c);
  expect(a.perlinLive).toBeUndefined();const record=owner.beginRecording(s,c,{width:4,height:4,simulationFps:4});expect(record.clock.encodedFrames).toBe(0);
  const stopped=owner.finishRecording(record.handle);expect(stopped.context.perlinLive).toBeUndefined();expect(generate(owner,stopped.scene,stopped.context).perlinLive).toBeUndefined();owner.reset();
 });
 it('rejects malformed live input before replacing a capability and fails closed after actual work fails',()=>{
  const s=scene(),owner=new SourcePerlinSession(),c=context(1000,true);generate(owner,s,c);const target=graphics.targets[0] as {disposed:boolean};
  expect(()=>owner.generate(s,{...c,perlinLive:{...c.perlinLive!,sessionId:''}})).toThrow('身份');expect(owner.matchesCompletedPrimary(s,c)).toBe(true);
  expect(()=>owner.capturePaused(s,{...c,width:0,sourceViewport:{...c.sourceViewport!,target:'offscreen'}})).toThrow();expect(owner.matchesCompletedPrimary(s,c)).toBe(true);
  graphics.drawFailure=true;expect(()=>owner.generate(s,c)).toThrow('target draw failure');expect(target.disposed).toBe(true);expect(owner.matchesCompletedPrimary(s,c)).toBe(false);
  graphics.drawFailure=false;generate(owner,s,c);expect(graphics.targets).toHaveLength(2);
  expect(()=>owner.generate(s,{...c,isCancelled:()=>true})).toThrow(expect.objectContaining({name:'AbortError'}));expect(owner.diagnostics().target).toBeUndefined();owner.reset();
 });
 it('retains the explicit model rejection of backward clock deltas instead of silently clamping',()=>{
  const s=scene(),owner=new SourcePerlinSession();s.timeline.tracks=[track(2)];generate(owner,s,context(2000));
  expect(()=>owner.generate(s,context(1900))).toThrow('nonnegative delta time');expect(owner.diagnostics().target).toBeUndefined();owner.reset();
 });
});

describe('Perlin live input and fixed-to-live handoff',()=>{
 it('validates and detaches the live request',()=>{
  for(const bad of [null,[],{},...['', ' '.repeat(4),'x'.repeat(257)].map(sessionId=>({sessionId,clock:{paused:true}})),{sessionId:'a',clock:[]},{sessionId:'a',clock:{paused:'yes'}},{sessionId:'a',clock:{paused:false,timestampMs:NaN}},{sessionId:'a',clock:{paused:true},startAt:86401}])expect(()=>validateSourcePerlinLiveContext(bad)).toThrow();
  const input={sessionId:'source',clock:{paused:false,timestampMs:10},startAt:0},value=validateSourcePerlinLiveContext(input);input.clock.timestampMs=50;expect(value.clock.timestampMs).toBe(10);
 });
 it('hands the exact fixed replay to live without construction, update or display',()=>{
  const s=scene();s.timeline.tracks=[track(1)];let creates=0,updates=0,displays=0,cancel=false;
  const timeline=new OrdinarySourceCameraTimelineSession(ordinarySourceCameraInitial(s)!,s.timeline.tracks,4,{isCancelled:()=>cancel,particleActions:'perlin',createParticles:()=>{creates++;return{bind:()=>{throw Error('unused');},update:()=>{updates++;},displayFrame:()=>{displays++;}};}});
  expect(()=>timeline.resumeLive()).toThrow('已完成');const fixed=timeline.evaluate(.25);expect([creates,updates,displays]).toEqual([1,2,2]);
  cancel=true;expect(()=>timeline.resumeLive()).toThrow();cancel=false;
  const live=timeline.resumeLive();expect(live).toEqual({...fixed,time:fixed.sceneTime});expect([creates,updates,displays]).toEqual([1,2,2]);
  timeline.display();expect([creates,updates,displays]).toEqual([1,2,3]);expect(timeline.step(.125).sceneTime).toBe(.625);expect([creates,updates,displays]).toEqual([1,3,4]);
  expect(()=>timeline.evaluate(.5)).toThrow('实时队列');timeline.reset();
 });
});
