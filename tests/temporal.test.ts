import { describe, expect, it,vi } from 'vitest';
import { generateScene, historyTimes, TemporalGenerationSession } from '../src/engine/temporal';
import { definitions, prepareAttractorParticles } from '../src/scenes/geometry';
import { PALETTES } from '../src/engine/palette';
import {outputBuffers} from '../src/engine/outputBuffers';
import {createScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import type { GenerateContext, GeometryOutput, SceneDocument, SceneOutput } from '../src/types';

const context: GenerateContext = { time: 2, width: 640, height: 480, quality: 'preview' };
function source(kind: 'surface' | 'attractor'): SceneDocument {
  const defaults = definitions.find(d => d.kind === kind)!.defaults;
  const scene: SceneDocument = { version: 1, id: 'history', name: 'history', kind, ...structuredClone(defaults), palette: structuredClone(PALETTES[0]), camera: { position: [4, 4, 4], target: [0, 0, 0], zoom: 1, orthographic: false }, favorite: false, timeline: { duration: 10, fps: 30, loop: false, tracks: [] } };
  Object.assign(scene.settings, { renderMode: 'points', showTrails: true, recordTrails: true, trailLifetime: 1, trailSampleRate: 2, fadeTrails: true });
  if (kind === 'surface') { scene.equations = { x: 'u+t', y: 'v', z: '0' }; scene.parameters = {}; Object.assign(scene.settings, { uMin: 0, uMax: 1, vMin: 0, vMax: 1, uSegments: 2, vSegments: 2, periodicU: false, periodicV: false }); }
  else { scene.equations = { dx: 'speed', dy: '0', dz: '0' }; scene.parameters = { speed: 1 }; Object.assign(scene.settings, { simulationMode: 'continuous', simulationFps: 2, initialX: 0, burnIn: 0, particleCount: 1, dt: .1, subSteps: 2 }); }
  return scene;
}
function geometry(output: SceneOutput): GeometryOutput & SceneOutput { if (output.type !== 'geometry') throw new Error('geometry expected'); return output; }
function numeric(output: SceneOutput) { const g = geometry(output); return { positions: g.positions, colors: g.colors, ids: g.particleIds, trails: g.trails }; }

describe('public generation session ownership',()=>{
 it('releases an internally created session but preserves a borrowed session on success',()=>{
  const reset=vi.spyOn(TemporalGenerationSession.prototype,'reset');
  try{generateScene(source('surface'),context);expect(reset).toHaveBeenCalledTimes(1);reset.mockClear();const owner=new TemporalGenerationSession();generateScene(source('surface'),context,owner);expect(reset).not.toHaveBeenCalled();expect(owner.diagnostics().retainedFrames).toBeGreaterThan(0);owner.reset();expect(owner.diagnostics().retainedBytes).toBe(0);}finally{reset.mockRestore();}
 });
});

describe('time-addressable particle history', () => {
  it('keeps cached particle frames owned when an entire worker output is transferred',()=>{
    const session=new TemporalGenerationSession(),scene=source('surface');
    const first=geometry(generateScene(scene,context,session)),expected=structuredClone(first);
    expect(first.particleIds!.byteLength).toBeGreaterThan(0);
    structuredClone(first,{transfer:outputBuffers(first)});
    expect(first.positions.byteLength).toBe(0);
    const second=geometry(generateScene(scene,context,session));
    expect(second.particleIds).toEqual(expected.particleIds);expect(second.positions).toEqual(expected.positions);expect(second.temporal!.cacheHits).toBeGreaterThan(0);session.reset();expect(session.diagnostics().retainedBytes).toBe(0);
  });
  it('anchors sampling to zero, includes exact fractional seek times, and bounds the retained window', () => {
    expect(historyTimes(2.2, 1, 2)).toEqual([1.5, 2, 2.2]);
    expect(historyTimes(.2, 1, 2)).toEqual([0, .2]);
    expect(() => historyTimes(Infinity, 1, 30)).toThrow('时间');
    expect(() => historyTimes(2, 61, 30)).toThrow('寿命');
  });
  it('returns current heads plus independent fading segments with stable particle identities', () => {
    const out = geometry(generateScene(source('surface'), context));
    expect(out.positions).toEqual(new Float32Array([2, 0, 0, 3, 0, 0, 2, 1, 0, 3, 1, 0]));
    expect(out.particleIds).toEqual(new Uint32Array([0, 1, 2, 3]));
    expect(out.trails!.positions.length / 3).toBe(12);
    expect(out.trails!.indices!.length).toBe(16);
    expect(Array.from(out.trails!.alphas)).toEqual([0,0,0,0,.5,.5,.5,.5,1,1,1,1]);
    for (let i = 0; i < out.trails!.indices!.length; i += 2) expect(out.trails!.indices![i] % 4).toBe(out.trails!.indices![i + 1] % 4);
  });
  it('never joins different particles or bridges a frame in which a particle was undefined', () => {
    const s = source('surface'); s.settings.trailLifetime = 2; s.equations.z = 'u==0 and t==1 ? 0/0 : 0';
    const out = geometry(generateScene(s, context)), trail = out.trails!;
    for (let i = 0; i < trail.indices!.length; i += 2) {
      const a = trail.indices![i] * 3, b = trail.indices![i + 1] * 3;
      expect(trail.positions[b] - trail.positions[a]).toBeCloseTo(.5, 6);
      expect(trail.positions[b + 1]).toBe(trail.positions[a + 1]);
    }
    expect(trail.indices!.length).toBe(24);
  });
  it('stops recording on historical timeline events and allows existing samples to age out', () => {
    const s = source('surface'); s.settings.trailLifetime = 2;
    s.timeline.tracks = [.5, 1.5].map((start, i) => ({ id: String(i), type: 'trails', target: 'settings.recordTrails', from: 0, to: 0, start, duration: .1, easing: 'linear', enabled: true, pingPong: false, trailsEnabled: i === 1 }));
    const out = geometry(generateScene(s, context));
    expect(out.trails!.indices!.length).toBe(8);
    s.settings.showTrails = false; s.timeline.tracks = [];
    expect(geometry(generateScene(s, context)).trails).toBeUndefined();
  });
  it('preserves preview/export and cold/forward/backward seek equivalence without exposing cache buffers', () => {
    for (const kind of ['surface', 'attractor'] as const) {
      const s = source(kind), session = new TemporalGenerationSession();
      generateScene(s, { ...context, time: 1 }, session);
      const warm = generateScene(s, context, session), fresh = generateScene(s, { ...context, quality: 'export' });
      expect(numeric(warm)).toEqual(numeric(fresh));
      geometry(warm).positions.fill(999); geometry(warm).trails!.positions.fill(888);
      expect(numeric(generateScene(s, context, session))).toEqual(numeric(fresh));
      expect(numeric(generateScene(s, { ...context, time: .7 }, session))).toEqual(numeric(generateScene(s, { ...context, time: .7 })));
      expect(session.diagnostics().retainedBytes).toBeLessThanOrEqual(32 * 1024 * 1024);
    }
  });
  it('uses fixed simulation frames and true integral state with fractional seek and parameter changes', () => {
    const s = source('attractor');
    expect(geometry(generateScene(s, context)).positions[0]).toBeCloseTo(.8, 6);
    expect(geometry(generateScene(s, { ...context, time: 2.25 })).positions[0]).toBeCloseTo(.9, 6);
    s.timeline.tracks = [{ id: 'speed', type: 'numeric', target: 'parameters.speed', from: 1, to: 3, start: 0, duration: 2, easing: 'linear', enabled: true, pingPong: false }];
    // Parameter values held at frame starts: 1,1.5,2,2.5, each for .2 physical seconds.
    expect(geometry(generateScene(s, context)).positions[0]).toBeCloseTo(1.4, 6);
  });
  it('invalidates on scene edits, preserves stopped divergence, and resets cancelled sessions', () => {
    const s = source('attractor'), session = new TemporalGenerationSession();
    generateScene(s, context, session); s.parameters.speed = 2;
    expect(numeric(generateScene(s, context, session))).toEqual(numeric(generateScene(s, context)));
    let checks = 0;
    expect(() => generateScene(s, { ...context, time: 5, isCancelled: () => ++checks > 2 }, session)).toThrow('已取消');
    expect(session.diagnostics().retainedFrames).toBe(0);
    s.equations.dx = 'x^2'; s.settings.initialX = 2; s.settings.divergenceLimit = 3;
    const dead = geometry(generateScene(s, context)); expect(dead.positions.length).toBe(0); expect(dead.warnings?.join('')).toContain('停止');
  });
  it('fails before unbounded history or replay allocation', () => {
    const s = source('surface'); Object.assign(s.settings, { uSegments: 512, vSegments: 512, trailLifetime: 10, trailSampleRate: 120 });
    expect(() => generateScene(s, context)).toThrow('1,000,000');
    const a = source('attractor'); Object.assign(a.settings, { particleCount: 10000, burnIn: 100000 });
    expect(() => generateScene(a, context)).toThrow('2,000,000');
  });
});

describe('time-addressable density accumulation', () => {
  function densitySource(kind:'surface'|'attractor'='surface') {
    const s=source(kind);Object.assign(s.settings,{presentation:'density',densityAccumulation:'window',densityLifetime:1,densitySampleRate:2,densityDecay:1,densityView:'manual',densitySpan:10,toneMap:'linear',gamma:1,dynamicRange:16,transparentBackground:true});
    s.palette={name:'white',stops:['#ffffff','#ffffff'],offset:0,cycles:1,mode:'linear'};return s;
  }
  function raster(output:SceneOutput) {if(output.type!=='raster')throw new Error('raster expected');return output;}
  it('accumulates all historical point counts with shared viewport and identical preview/export samples',()=>{
    const s=densitySource(),ctx={...context,width:1,height:1},session=new TemporalGenerationSession();
    const cold=raster(generateScene(s,ctx)),warm=raster(generateScene(s,ctx,session));
    expect(cold.density).toMatchObject({accepted:12,inputPoints:12,maxCount:12,invalid:0,clipped:0});expect(cold.pixels[3]).toBe(191);
    expect(cold.temporal).toMatchObject({frames:3,recordedPoints:12,samplingFps:2});expect(warm.pixels).toEqual(cold.pixels);
    expect(raster(generateScene(s,{...ctx,quality:'export'},session)).pixels).toEqual(cold.pixels);
    const replay=raster(generateScene(s,ctx,session));expect(replay.temporal!.cacheHits).toBe(3);
    expect(raster(generateScene(s,{...ctx,time:.25},session)).pixels).toEqual(raster(generateScene(s,{...ctx,time:.25})).pixels);
  });
  it('applies per-sample decay before one tone map, while raw statistics still count observations',()=>{
    const s=densitySource(),ctx={...context,width:1,height:1};s.settings.densityDecay=.5;
    const out=raster(generateScene(s,ctx));expect(out.density!.accepted).toBe(12);expect(out.pixels[3]).toBe(Math.round(255*4*(.25+.5+1)/16));
    s.settings.densityDecay=0;expect(raster(generateScene(s,ctx)).pixels[3]).toBe(64);
    s.settings.densityAccumulation='frame';expect(raster(generateScene(s,ctx)).pixels[3]).toBe(64);
  });
  it('handles continuous attractor heads in both current-frame and historical density modes',()=>{
    const s=densitySource('attractor'),ctx={...context,width:1,height:1};s.settings.showTrails=false;
    const window=raster(generateScene(s,ctx));expect(window.density!.accepted).toBe(3);expect(window.pixels[3]).toBe(48);
    s.settings.densityAccumulation='frame';const frame=raster(generateScene(s,ctx));expect(frame.density!.accepted).toBe(1);expect(frame.pixels[3]).toBe(16);
  });
  it('does not reuse cancelled history and rejects nonpoint or oversized accumulation',()=>{
    const s=densitySource(),session=new TemporalGenerationSession();generateScene(s,context,session);
    expect(()=>generateScene(s,{...context,isCancelled:()=>true},session)).toThrow('已取消');expect(session.diagnostics().retainedFrames).toBe(0);
    s.settings.renderMode='mesh';expect(()=>generateScene(s,context)).toThrow('点云模式');
    Object.assign(s.settings,{renderMode:'points',uSegments:512,vSegments:512,densityLifetime:2,densitySampleRate:8});
    expect(()=>generateScene(s,{...context,width:1,height:1})).toThrow('2,000,000');
  });
});


describe('temporal cache and particle ownership',()=>{
  it('evicts old frames under actual memory pressure and retains the latest frame',()=>{
    const session=new TemporalGenerationSession(),size=65536;
    for(let time=0;time<24;time++)session.put({time,recording:true,output:{type:'geometry',topology:'points',positions:new Float32Array(size*3),colors:new Float32Array(size*3),particleIds:new Uint32Array(size),stats:{samples:size,generated:size,invalid:0}}});
    const diagnostics=session.diagnostics();expect(diagnostics.retainedBytes).toBeLessThanOrEqual(32*1024*1024);expect(diagnostics.retainedFrames).toBeLessThan(24);expect(session.has(0)).toBe(false);expect(session.has(23)).toBe(true);
  });
  it('keeps particle-index colors attached to identities when an earlier particle stops',()=>{
    const s=source('attractor');Object.assign(s.settings,{particleCount:3,initialSpread:1,colorMetric:'index',showTrails:false});
    s.palette={name:'id',stops:['#ff0000','#00ff00','#0000ff'],offset:0,cycles:1,mode:'linear'};
    const particles=prepareAttractorParticles(s);s.equations.dx=`abs(x-(${particles[0].point[0]}))<1e-8 ? 1e20 : 0`;
    const before=geometry(generateScene(s,{...context,time:0})),after=geometry(generateScene(s,{...context,time:.5}));
    expect([...after.particleIds!]).toEqual([1,2]);expect(after.colors!.slice(0,3)).toEqual(before.colors!.slice(3,6));expect(after.colors!.slice(3,6)).toEqual(before.colors!.slice(6,9));
  });
});

describe('animated history grid changes',()=>{
 it('breaks connectivity when a surface grid changes identity space',()=>{
  const s=source('surface');s.settings.trailLifetime=2;
  s.timeline.tracks=[{id:'grid',type:'numeric',target:'settings.uSegments',from:2,to:3,start:0,duration:1,easing:'linear',enabled:true,pingPong:false,round:true}];
  const out=geometry(generateScene(s,context));expect(out.warnings?.join()).toContain('新旧粒子');
  // Frames: t0 has four vertices, t.5 and later have six. No first four connect.
  expect([...out.trails!.indices!].every(i=>i>=4)).toBe(true);
 });
 it('checks historical sample workload before an animated small final grid can hide large earlier grids',()=>{
  const s=source('surface');s.settings.trailLifetime=2;s.settings.trailSampleRate=4;s.settings.vSegments=512;
  s.timeline.tracks=[{id:'grid',type:'numeric',target:'settings.uSegments',from:512,to:2,start:1.5,duration:.5,easing:'linear',enabled:true,pingPong:false,round:true}];s.settings.uSegments=512;
  expect(()=>generateScene(s,context)).toThrow('1,000,000');
 });
});

describe('Perlin session ownership at the common generation boundary',()=>{
 it('routes the base timeline document, preserves seek/export equality and resets across scene kinds',async()=>{
  const {createScene}=await import('../src/engine/document'),{definition}=await import('../src/scenes');
  const s=createScene(definition('perlin'));Object.assign(s.settings,{style:'continuous',particleDisplay:'heads',particleCount:4,simulationFps:4,particleSpeed:1,respawnRate:0});
  const session=new TemporalGenerationSession(),ctx={...context,time:.5,width:32,height:24};generateScene(s,ctx,session);
  const warm=generateScene(s,{...ctx,time:1},session),fresh=generateScene(s,{...ctx,time:1,quality:'export'});expect(numeric(warm)).toEqual(numeric(fresh));expect(session.diagnostics().perlin.frame).toBe(4);
  generateScene(source('surface'),ctx,session);expect(session.diagnostics().perlin.frame).toBeNull();
  expect(numeric(generateScene(s,{...ctx,time:1},session))).toEqual(numeric(fresh));
  expect(()=>generateScene(s,{...ctx,isCancelled:()=>true},session)).toThrow('已取消');expect(session.diagnostics().perlin.frame).toBeNull();
 });
});

describe('continuous density at the public generation boundary',()=>{
 it('routes before generic density history, preserves owned state for tone edits and releases it on family change or cancellation',()=>{
  const s=createScene(definition('map'));Object.assign(s.settings,{iteratedMode:'continuous',batchSize:12,burnIn:2,iterationsPerFrame:1,iteratedFps:4,presentation:'density',densityAccumulation:'window',densityView:'manual',densitySpan:6});
  const session=new TemporalGenerationSession(),ctx={width:32,height:24,time:.5,quality:'export' as const};
  const first=generateScene(s,ctx,session);expect(first.type).toBe('raster');expect(first.temporal?.frames).toBe(3);expect(session.diagnostics().iterated.frame).toBe(2);
  const toned={...s,settings:{...s.settings,exposure:2}},warm=generateScene(toned,{...ctx,time:1},session),fresh=generateScene(toned,{...ctx,time:1});
  expect(warm.type).toBe('raster');if(warm.type==='raster'&&fresh.type==='raster')expect(warm.pixels).toEqual(fresh.pixels);
  expect(warm.temporal?.cacheHits).toBe(1);generateScene(source('surface'),ctx,session);expect(session.diagnostics().iterated.retainedBytes).toBe(0);
  generateScene(s,ctx,session);expect(()=>generateScene(s,{...ctx,isCancelled:()=>true},session)).toThrow();expect(session.diagnostics().iterated.retainedBytes).toBe(0);
 });
});
