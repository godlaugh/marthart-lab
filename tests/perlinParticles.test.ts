import {describe,it,expect,vi} from 'vitest';
import {generatePerlinParticles,PerlinParticleSession,perlinParticleDefaults,perlinAdvanceWork,PERLIN_REPLAY_WORK_LIMIT} from '../src/scenes/perlinParticles';
import {visiblePerlinControls} from '../src/scenes/perlin';
import {definitions} from '../src/scenes/particles';
import {generateScene,TemporalGenerationSession} from '../src/engine/temporal';
import {ordinarySourceViewport} from '../src/engine/ordinarySourceCamera';
import {parseLegacyScene} from '../src/engine/legacyImport';
import type {SceneDocument,SceneOutput,Settings,AnimationTrack} from '../src/types';

const context={time:1,width:32,height:24,quality:'preview' as const};
function scene(settings:Settings={}):SceneDocument {
 return {version:1,id:'continuous',name:'continuous',kind:'perlin',equations:{},parameters:{},settings:{...perlinParticleDefaults,style:'continuous',seed:42,particleCount:4,simulationFps:4,particleSpeed:2,respawnRate:0,noiseScale:0,noiseOffset:0,timeSpeed:0,flow:'angle',particleDisplay:'heads',particleDomainWidth:100,particleDomainHeight:100,...settings},palette:{name:'red',mode:'linear',stops:['#ff0000','#ff0000'],cycles:1,offset:0},camera:{position:[0,0,10],target:[0,0,0],orthographic:true,zoom:1},timeline:{duration:10,fps:30,loop:false,tracks:[]},favorite:false};
}
function geometry(output:SceneOutput){if(output.type!=='geometry')throw new Error('geometry expected');return output;}
function raster(output:SceneOutput){if(output.type!=='raster')throw new Error('raster expected');return output;}
function numeric(output:SceneOutput){return output.type==='raster'?{pixels:output.pixels,width:output.width,height:output.height}:{positions:output.positions,colors:output.colors,ids:output.particleIds,trails:output.trails};}
function track(target:string,from:number,to:number,start=0,duration=1):AnimationTrack{return{id:target,target,from,to,start,duration,easing:'linear',enabled:true,pingPong:false};}

describe('fixed-step continuous Perlin particles',()=>{
 it('integrates a real constant direction field with fractional seek and independent fixed rates',()=>{
  const s=scene(),zero=geometry(generatePerlinParticles(s,{...context,time:0}));
  for(const fps of [2,4,60])for(const time of [.125,1,1.13]){
   const out=geometry(generatePerlinParticles({...s,settings:{...s.settings,simulationFps:fps}},{...context,time}));
   for(let i=0;i<4;i++){expect(out.positions[i*3]-zero.positions[i*3]).toBeCloseTo(2*time,5);expect(out.positions[i*3+1]).toBe(zero.positions[i*3+1]);}
   expect(out.stats.samples).toBe(4*Math.ceil(fps*time-1e-9));
  }
 });
 it('evaluates animated physical values at each fixed frame instead of only at the requested time',()=>{
  const s=scene({particleCount:1,simulationFps:2});s.timeline.tracks=[track('settings.particleSpeed',2,6)];
  const x0=geometry(generatePerlinParticles(s,{...context,time:0})).positions[0];
  expect(geometry(generatePerlinParticles(s,context)).positions[0]-x0).toBeCloseTo(3,5);
  expect(geometry(generatePerlinParticles(s,{...context,time:1.25})).positions[0]-x0).toBeCloseTo(4.5,5);
 });
 it('keeps head identity stable, breaks wrap segments, and respawns at deterministic frame-addressed positions',()=>{
  const still=scene({particleDisplay:'trails',trailStride:1,particleSpeed:0});const a=geometry(generatePerlinParticles(still,context));
  expect([...a.particleIds!]).toEqual([0,1,2,3]);expect(a.trails!.indices!.length).toBe(4*4*2);
  const wrap=scene({particleDisplay:'trails',trailStride:1,particleDomainWidth:1,particleDomainHeight:1,particleSpeed:4});
  const session=new PerlinParticleSession(),out=geometry(generatePerlinParticles(wrap,context,session));
  expect(out.trails!.indices!.length).toBe(0);expect(session.diagnostics().wrapped).toBe(16);
  for(let i=0;i<4;i++){expect(out.positions[i*3]).toBeGreaterThanOrEqual(-.5);expect(out.positions[i*3]).toBeLessThan(.5);}
  const respawn=scene({particleDisplay:'trails',trailStride:1,respawnEveryStep:true,particleSpeed:0});
  const b=geometry(generatePerlinParticles(respawn,context));expect(b.trails!.indices!.length).toBe(0);expect(b.positions).not.toEqual(a.positions);
  expect(numeric(generatePerlinParticles(respawn,context))).toEqual(numeric(b));
  expect(geometry(generatePerlinParticles({...respawn,settings:{...respawn.settings,seed:43}},context)).positions).not.toEqual(b.positions);
 });
 it('applies Poisson respawn probability and both boundary policies without reusing trail identity',()=>{
  const s=scene({particleCount:10000,particleSpeed:0,simulationFps:1,respawnRate:Math.LN2}),session=new PerlinParticleSession();generatePerlinParticles(s,context,session);
  expect(session.diagnostics().respawned).toBeGreaterThan(4800);expect(session.diagnostics().respawned).toBeLessThan(5200);
  const boundary=scene({particleDomainWidth:1,particleDomainHeight:1,particleBoundary:'respawn',particleSpeed:4}),other=new PerlinParticleSession();generatePerlinParticles(boundary,context,other);expect(other.diagnostics().respawned).toBe(16);expect(other.diagnostics().wrapped).toBe(0);
 });
 it('uses three genuinely different finite fields and preserves zero-gradient curl motion',()=>{
  const signatures=['angle','curl','swirl'].map(flow=>geometry(generatePerlinParticles(scene({flow,noiseScale:.1}),context)).positions.join());expect(new Set(signatures).size).toBe(3);
  expect(numeric(generatePerlinParticles(scene({flow:'curl'}),context))).toEqual(numeric(generatePerlinParticles(scene(),context)));
  expect(geometry(generatePerlinParticles(scene({angleMap:'soft-power',noiseScale:.1}),context)).positions).not.toEqual(geometry(generatePerlinParticles(scene({noiseScale:.1}),context)).positions);
 });
 it('samples history on the fixed stride, retains only the lifetime, and fades by actual age',()=>{
  const s=scene({particleCount:1,particleDisplay:'trails',simulationFps:10,trailStride:2,trailLifetime:.5});const out=geometry(generatePerlinParticles(s,{...context,time:1.05}));
  expect([...out.trails!.alphas!]).toEqual([expect.closeTo(.1),expect.closeTo(.5),expect.closeTo(.9),1]);expect(out.trails!.positions.length/3).toBe(4);expect(out.trails!.indices!.length).toBe(6);
  s.settings.fadeTrails=false;expect(geometry(generatePerlinParticles(s,context)).trails!.alphas!.every(a=>a===1)).toBe(true);
  s.settings.showTrails=false;expect(geometry(generatePerlinParticles(s,context)).trails).toBeUndefined();
 });
 it('does not connect across stopped recording, even when historical points remain visible',()=>{
  const s=scene({particleCount:1,particleDisplay:'trails',trailStride:1});s.timeline.tracks=[{...track('settings.recordTrails',0,0,.25,.1),type:'trails',trailsEnabled:false},{...track('settings.recordTrails',0,0,.75,.1),id:'restart',type:'trails',trailsEnabled:true}];
  const out=geometry(generatePerlinParticles(s,context));expect(out.trails!.indices!.length).toBe(2);
 });
});

describe('real bounded accumulation and lifetime cache',()=>{
 it('conserves normalized splat mass at fixed positions and physically decays/replaces ink',()=>{
  const s=scene({particleCount:1,particleSpeed:0,particleDisplay:'accumulation',accumulationFade:0,transparentBackground:true,particleExposure:.5});
  const a=raster(generatePerlinParticles(s,{...context,time:0})),b=raster(generatePerlinParticles(s,context));
  const mass=(o:typeof a)=>Array.from(o.pixels).reduce((sum,alpha,i)=>i%4===3?sum-Math.log1p(-alpha/255)/.5:sum,0);
  expect(mass(a)).toBeCloseTo(1,1);expect(mass(b)).toBeCloseTo(5,1);
  const erased=raster(generatePerlinParticles({...s,settings:{...s.settings,accumulationFade:255}},context));expect(erased.pixels).toEqual(a.pixels);
  for(let i=0;i<b.pixels.length;i+=4)if(b.pixels[i+3])expect([...b.pixels.slice(i,i+3)]).toEqual([255,0,0]);
 });
 it('pauses deposits through timeline recording events while old ink decays correctly',()=>{
  const s=scene({particleCount:1,particleSpeed:0,simulationFps:60,particleDisplay:'accumulation',accumulationFade:127.5,transparentBackground:true});
  s.timeline.tracks=[{...track('settings.recordTrails',0,0,1/60,.001),type:'trails',trailsEnabled:false}];
  const session=new PerlinParticleSession();generatePerlinParticles(s,{...context,time:0},session);expect(generatePerlinParticles(s,{...context,time:1/60},session).type).toBe('geometry');expect(session.diagnostics().deposited).toBe(1);
  s.timeline.tracks.push({...track('settings.recordTrails',0,0,2/60,.001),id:'resume',type:'trails',trailsEnabled:true});
  const decayed=raster(generatePerlinParticles(s,{...context,time:2/60})),initial=raster(generatePerlinParticles(s,{...context,time:0}));
  const alpha=(out:typeof initial)=>out.pixels.reduce((sum,v,i)=>sum+(i%4===3?v:0),0);expect(alpha(decayed)).toBeGreaterThan(alpha(initial));
  const noDecay=raster(generatePerlinParticles({...s,settings:{...s.settings,accumulationFade:0}},{...context,time:2/60}));expect(alpha(decayed)).toBeLessThan(alpha(noDecay));
  s.settings.accumulationFade=255;expect(raster(generatePerlinParticles(s,{...context,time:2/60})).pixels).toEqual(initial.pixels);
 });
 it('keeps per-frame colors in accumulated ink and composites the chosen background',()=>{
  const s=scene({particleCount:1,particleSpeed:0,simulationFps:2,particleDisplay:'accumulation',accumulationFade:0,transparentBackground:true});s.palette.stops=['#ff0000','#0000ff'];s.timeline.tracks=[track('palette.offset',0,.5)];
  const out=raster(generatePerlinParticles(s,context));expect(out.pixels.some((v,i)=>i%4===2&&v>0)).toBe(true);expect(out.pixels.some((v,i)=>i%4===0&&v>0)).toBe(true);
  s.settings.recordTrails=false;s.settings.transparentBackground=false;s.settings.background='#123456';const bg=raster(generatePerlinParticles(s,context));for(let i=0;i<bg.pixels.length;i+=4)expect([...bg.pixels.slice(i,i+4)]).toEqual([18,52,86,255]);
 });
 for(const display of ['heads','trails','accumulation'])it(`${display} matches cold/export, forward, fractional and backward seeks and owns transferred buffers`,()=>{
  const s=scene({particleDisplay:display,trailStride:1,noiseScale:.02,respawnRate:.5}),session=new PerlinParticleSession();
  generatePerlinParticles(s,{...context,time:.5},session);generatePerlinParticles(s,{...context,time:.63},session);
  const warm=generatePerlinParticles(s,context,session),fresh=generatePerlinParticles(s,{...context,quality:'export'});expect(numeric(warm)).toEqual(numeric(fresh));expect(session.diagnostics().cacheHits).toBe(1);
  if(warm.type==='geometry'){structuredClone(warm.positions,{transfer:[warm.positions.buffer]});warm.trails?.positions.fill(999);}else structuredClone(warm.pixels,{transfer:[warm.pixels.buffer]});
  expect(numeric(generatePerlinParticles(s,context,session))).toEqual(numeric(fresh));
  expect(numeric(generatePerlinParticles(s,{...context,time:.37},session))).toEqual(numeric(generatePerlinParticles(s,{...context,time:.37})));
  expect(session.diagnostics().retainedBytes).toBeLessThanOrEqual(32*1024*1024);
 });
 it('retains a warm strided window without confusing the first recorded time with coverage',()=>{
  const s=scene({particleDisplay:'trails',simulationFps:60,trailLifetime:.5,trailStride:5}),session=new PerlinParticleSession();generatePerlinParticles(s,context,session);
  const warm=generatePerlinParticles(s,{...context,time:1.03},session);expect(session.diagnostics().cacheHits).toBe(1);expect(numeric(warm)).toEqual(numeric(generatePerlinParticles(s,{...context,time:1.03})));
 });
 it('replays when animated lifetime expands beyond retained history',()=>{
  const s=scene({particleDisplay:'trails',simulationFps:10,trailLifetime:.1,trailStride:1});s.timeline.tracks=[track('settings.trailLifetime',.1,2,1,1)];const session=new PerlinParticleSession();generatePerlinParticles(s,context,session);
  expect(numeric(generatePerlinParticles(s,{...context,time:2},session))).toEqual(numeric(generatePerlinParticles(s,{...context,time:2})));expect(session.diagnostics().cacheHits).toBe(0);
 });
 it('bounds per-frame palette expansion before allocation and compacts expired history without changing output',()=>{
  const huge=scene({particleDisplay:'trails',particleCount:1,simulationFps:60,trailLifetime:120,trailStride:1});huge.palette.stops=Array.from({length:1024},()=> '#ff0000');huge.palette.positions=Array.from({length:1024},(_,i)=>i/1023);const oversized=new PerlinParticleSession();
  expect(()=>generatePerlinParticles(huge,{...context,time:60},oversized)).toThrow('32 MiB');expect(oversized.diagnostics().retainedBytes).toBe(0);
  const small=scene({particleDisplay:'trails',particleCount:1,simulationFps:60,trailLifetime:.1,trailStride:1}),session=new PerlinParticleSession();generatePerlinParticles(small,{...context,time:35},session);const next=generatePerlinParticles(small,{...context,time:35.5},session);
  expect(numeric(next)).toEqual(numeric(generatePerlinParticles(small,{...context,time:35.5})));expect(session.diagnostics().cacheHits).toBe(1);expect(session.diagnostics().retainedBytes).toBeLessThan(10000);
 });
 it('invalidates identity inputs and never retains an accumulation buffer over 32 MiB',()=>{
  const s=scene({particleDisplay:'accumulation',particleCount:1}),session=new PerlinParticleSession();generatePerlinParticles(s,context,session);s.settings.seed=71;
  expect(numeric(generatePerlinParticles(s,context,session))).toEqual(numeric(generatePerlinParticles(s,context)));expect(session.diagnostics().cacheHits).toBe(0);
  const out=generatePerlinParticles(s,{...context,time:0,width:1200,height:1000},session);expect(out.warnings?.join()).toContain('32 MiB');expect(session.diagnostics().retainedBytes).toBe(0);
  session.reset();expect(session.diagnostics().frame).toBeNull();
 });
});

describe('continuous production boundaries',()=>{
 it('routes through the shared generation owner with identical output and mode-specific controls',()=>{
  const s=scene({particleDisplay:'trails'}),session=new TemporalGenerationSession();expect(numeric(generateScene(s,context,session))).toEqual(numeric(generatePerlinParticles(s,context)));expect(session.diagnostics().perlin.frame).toBe(4);
  const controls=definitions.find(d=>d.kind==='perlin')!.controls,keys=(patch:Settings)=>visiblePerlinControls(controls,{...s.settings,...patch}).map(c=>c.key);
  expect(keys({})).toContain('trailStride');expect(keys({})).not.toContain('accumulationFade');expect(keys({particleDisplay:'accumulation'})).toContain('accumulationFade');expect(keys({particleDisplay:'heads'})).not.toContain('recordTrails');expect(keys({respawnEveryStep:true})).not.toContain('respawnRate');
 });
 it('imports actual probability/step/trail settings without dropping persistence semantics',()=>{
  const {scene:s,warnings}=parseLegacyScene(JSON.stringify({config_version:'1.0.0',type:'PERLIN',name:'legacy',settings:{cpu_render_style:'PARTICLES',particle_count:4,step_size:.5,respawn_rate:.1,use_accumulation_buffer:true,accumulation_fade_alpha:255,trail_lifetime:12,dot_size:.8}}));
  expect(s.settings).toMatchObject({style:'continuous',particleCount:4,particleSpeed:30,particleDisplay:'accumulation',accumulationFade:255,trailLifetime:12,particleRadius:.8});expect(s.settings.respawnRate).toBeCloseTo(-60*Math.log(.9));expect(warnings.join()).toContain('60');expect(generateScene(s,context).type).toBe('raster');
 });
 it('preserves long trail lifetimes while bounding the actual requested history, not an unvisited future',()=>{
  const s=scene({particleDisplay:'trails',particleCount:1,simulationFps:2,trailLifetime:120,trailStride:2});const out=geometry(generatePerlinParticles(s,{...context,time:120}));expect(out.trails!.positions.length/3).toBe(121);expect(out.trails!.alphas![0]).toBe(0);expect(out.trails!.alphas![120]).toBe(1);
  expect(geometry(generatePerlinParticles(scene({particleDisplay:'trails',particleCount:20000,simulationFps:120,trailLifetime:3600,trailStride:1}),{...context,time:0})).positions.length/3).toBe(20000);
  const {scene:imported}=parseLegacyScene(JSON.stringify({config_version:'1.0.0',type:'PERLIN',name:'long',settings:{trail_lifetime:120,particle_count:4}}));expect(imported.settings.trailLifetime).toBe(120);const importedOutput=geometry(generateScene(imported,{...context,sourceViewport:ordinarySourceViewport(imported,context.width,context.height,'primary',context.height)}));expect(importedOutput.positions.length).toBe(4*3);expect(importedOutput.sourceCameraFrame).toBeDefined();
 });
 it('preserves zero-size/zero-speed source controls and high finite respawn probabilities',()=>{
  const {scene:s}=parseLegacyScene(JSON.stringify({config_version:'1.0.0',type:'PERLIN',name:'zero',settings:{particle_count:15000,step_size:0,noise_scale:0,dot_size:0,respawn_rate:1-Number.EPSILON,use_accumulation_buffer:true}}));
  expect(s.settings.particleCount).toBe(15000);expect(s.settings.particleSpeed).toBe(0);expect(s.settings.particleRadius).toBe(0);expect(s.settings.respawnRate).toBeGreaterThan(1000);s.settings.transparentBackground=true;
  const output=raster(generateScene(s,{...context,time:0}));expect(output.pixels.every(v=>v===0)).toBe(true);expect(output.stats.generated).toBe(0);
 });
 it('rejects malformed settings and over-budget expansion before doing unbounded work',()=>{
  for(const patch of [{particleCount:1.5},{simulationFps:0},{particleDisplay:'fake'},{particleSpeed:-1},{respawnRate:-1},{trailStride:0},{particleRadius:-1},{particleDomainWidth:0},{flow:'fake'},{seed:-1},{presentation:'density'},{particleCount:20000,particleDisplay:'trails',simulationFps:120,trailLifetime:60,trailStride:1}] as Settings[])expect(()=>generatePerlinParticles(scene(patch),context)).toThrow();
  expect(()=>generatePerlinParticles(scene({particleCount:20000}),{...context,time:86400})).toThrow('10 亿 CPU 工作单元');expect(()=>generatePerlinParticles(scene({particleDisplay:'accumulation'}),{...context,width:4096,height:4096})).toThrow('4194304');expect(()=>generatePerlinParticles(scene(),{...context,time:NaN})).toThrow('时间');
  const s=scene();s.timeline.tracks=[track('settings.particleCount',4,8)];expect(()=>generatePerlinParticles(s,context)).toThrow('不能动画');
 });
 it('clears partially advanced state on cancellation and errors',()=>{
  const session=new PerlinParticleSession(),s=scene();generatePerlinParticles(s,context,session);let checks=0;expect(()=>generatePerlinParticles(s,{...context,time:3,isCancelled:()=>++checks>2},session)).toThrow('取消');expect(session.diagnostics().retainedBytes).toBe(0);
  expect(numeric(generatePerlinParticles(s,context,session))).toEqual(numeric(generatePerlinParticles(s,context)));expect(()=>generatePerlinParticles(s,{...context,time:-1},session)).toThrow();expect(session.diagnostics().frame).toBeNull();
 });
});


describe('measured long replay work and progress',()=>{
 it('charges actual noise evaluations by flow and octave count, including analytic constant/stopped fields',()=>{
  const cfg={count:8000,speed:24,frequency:.01,flow:'angle',octaves:3};
  expect(perlinAdvanceWork(cfg)).toEqual({updates:8000,noiseSamples:24000,units:32000});
  const curl=perlinAdvanceWork({...cfg,flow:'curl'});expect(curl.noiseSamples).toBe(96000);expect(curl.units*7200).toBe(748800000);expect(curl.units*7200).toBeLessThan(PERLIN_REPLAY_WORK_LIMIT);
  expect(perlinAdvanceWork({...cfg,flow:'swirl'})).toEqual(perlinAdvanceWork(cfg));
  expect(perlinAdvanceWork({...cfg,flow:'curl',frequency:0}).noiseSamples).toBe(0);
  expect(perlinAdvanceWork({...cfg,frequency:0}).noiseSamples).toBe(3);
  expect(perlinAdvanceWork({...cfg,speed:0}).noiseSamples).toBe(0);
 });
 it('charges the timeline-resolved field for each actual step and does not charge stopped-field noise',()=>{
  const s=scene({particleCount:4,simulationFps:2,noiseScale:.1,flow:'curl',octaves:1}),session=new PerlinParticleSession();s.timeline.tracks=[track('settings.octaves',1,3,0,.5)];
  generatePerlinParticles(s,context,session);expect(session.diagnostics()).toMatchObject({integrated:8,noiseSamples:64,workUnits:72});
  s.timeline.tracks=[track('settings.particleSpeed',2,0,0,.5)];generatePerlinParticles(s,context,session);expect(session.diagnostics()).toMatchObject({integrated:8,noiseSamples:16,workUnits:24});
 });
 it('preserves the exact constant-direction trajectory for a formerly rejected 24M-update cold seek',()=>{
  const s=scene({particleCount:20000,simulationFps:10,particleSpeed:0,respawnRate:0}),session=new PerlinParticleSession();
  const zero=geometry(generatePerlinParticles(s,{...context,time:0})),out=geometry(generatePerlinParticles(s,{...context,time:120},session));
  expect(out.stats.samples).toBe(24000000);expect(out.positions).toEqual(zero.positions);expect(out.particleIds).toEqual(zero.particleIds);
  expect(session.diagnostics().workUnits).toBe(24000000);expect(session.diagnostics().noiseSamples).toBe(0);
 });
 it('publishes owned incomplete head frames without changing the final history and allows cancel from progress',()=>{
  const s=scene({particleDisplay:'trails',trailStride:1}),session=new PerlinParticleSession();let clock=0;const timer=vi.spyOn(performance,'now').mockImplementation(()=>clock+=600),times:number[]=[];
  try{
   const out=generatePerlinParticles(s, {...context,onProgress:output=>{times.push(output.temporal!.time);expect(output.warnings!.join()).toContain('尚未完成');expect(geometry(output).trails).toBeUndefined();structuredClone(geometry(output).positions,{transfer:[geometry(output).positions.buffer]});}},session);
   expect(times).toEqual([.25,.5,.75]);expect(numeric(out)).toEqual(numeric(generatePerlinParticles(s,context)));expect(geometry(out).trails!.indices!.length).toBeGreaterThan(0);
   let replayProgress=0;const back=generatePerlinParticles(s,{...context,time:.75,onProgress:()=>{replayProgress++;expect(session.diagnostics().frame).toBeNull();}},session);expect(replayProgress).toBe(2);expect(numeric(back)).toEqual(numeric(generatePerlinParticles(s,{...context,time:.75})));
   let stop=false;expect(()=>generatePerlinParticles(s,{...context,time:3,isCancelled:()=>stop,onProgress:()=>{stop=true;}},session)).toThrow('取消');expect(session.diagnostics().retainedBytes).toBe(0);
   expect(numeric(generatePerlinParticles(s,context,session))).toEqual(numeric(generatePerlinParticles(s,context)));
  }finally{timer.mockRestore();}
 });
 it('keeps independently allocated trail indices exact and cancellation cleans up during output construction',()=>{
  const s=scene({particleDisplay:'trails',particleCount:2048,simulationFps:1,trailStride:1,particleSpeed:0}),session=new PerlinParticleSession();
  const out=geometry(generatePerlinParticles(s,context,session));expect(out.trails!.indices!.byteLength).toBe(2048*2*4);
  let checks=0;expect(()=>generatePerlinParticles(s,{...context,isCancelled:()=>++checks>8},session)).toThrow('取消');expect(session.diagnostics().retainedBytes).toBe(0);
 });
});
