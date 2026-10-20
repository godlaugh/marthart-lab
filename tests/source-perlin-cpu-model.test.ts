import {describe,it,expect,vi} from 'vitest';
import {SourcePerlinCpuModel} from '../src/engine/sourcePerlinCpuModel';
import {importSourcePerlinCpuDocument,type SourcePerlinCpuDocumentPayload} from '../src/engine/sourcePerlinCpuDocument';
import {SourcePerlinCpuTarget} from '../src/engine/sourcePerlinCpuTarget';
import {sourcePerlinBackgroundRgba} from '../src/engine/sourcePerlinBackground';
import {SourcePerlinCurveColors} from '../src/engine/sourcePerlinCurveColors';
import {SourcePerlinColorRuntime} from '../src/engine/sourcePerlinColorRuntime';
import {SourceProcessingNoise} from '../src/engine/sourceProcessingNoise';
import {sourcePerlinSeed} from '../src/engine/sourcePerlinSeed';
import type {SourcePerlinParameterAction} from '../src/engine/sourcePerlinParameterConfig';
import particles from './fixtures/source-perlin/particles.json';
import angles from './fixtures/source-perlin/angle-field.json';
const F=Math.fround;
const config=():SourcePerlinCpuDocumentPayload=>{const p=importSourcePerlinCpuDocument({seed:1,particle_count:3,curve_count:3,curve_length:5,field_cell_size:80,seed_space_circle_count:2},[]);if(!p.ok)throw Error(p.error.reason);return p.value.configuration;};
const model=(c=config(),options={})=>new SourcePerlinCpuModel({config:c,sourceWidth:320,sourceHeight:200,curveCacheSamples:0,...options});
const start=(name:'curve_noise_scale'|'noise_offset'|'noise_scale',min:number,max:number,step:number):SourcePerlinParameterAction=>({kind:'start',parameters:[{name,min,max,step}]});
const gradient={kind:'start' as const,config:{mode:'hue_rotate' as const,interpolation:'rgb' as const,speed:120}};

describe('Perlin CPU model composition',()=>{
 for(const c of particles.cases.filter(c=>!c.diagnostic&&c.name!=='resize-live-bounds'))it(`retains independent complete particle trajectory: ${c.name}`,()=>{
  const p=c.config,d=config();d.seed=p.seed;d.particles={count:p.particleCount,stepSize:p.stepSize,timeScale:p.timeScale,respawnRate:p.respawnRate,flowMode:p.flowMode as typeof d.particles.flowMode,angleMap:p.angleMap as typeof d.particles.angleMap};d.parameters={...d.parameters,noise_scale:p.noiseScale,noise_offset:p.noiseOffset};
  const m=model(d,{sourceWidth:p.width,sourceHeight:p.height});
  const assert=(expected:typeof c.initial|typeof c.frames[number]['expected'])=>{
   const s=m.diagnosticSnapshot().motion!;expect([...s.positions]).toEqual(expected.positions.flatMap(v=>v.slice(0,2)));expect([...s.velocities]).toEqual(expected.velocities.flat());expect(s.randomState48).toBe(expected.randomState);
  };
  assert(c.initial);for(const f of c.frames){m.update(f.input.time,Math.max(0,f.input.dt));assert(f.expected);}m.dispose();
 });
 for(const c of angles.curveGeometryCases.filter(c=>c.input.count>=1&&c.input.length>=2&&c.input.stepSize>=.05))it(`composes independent initial and rebuilt curves: ${c.name}`,()=>{
  const a=angles.cases.find(a=>a.name===c.angleFieldCase)!.input,d=config();d.cpuStyle='field-curves';d.seed=c.input.seed;d.parameters={...d.parameters,noise_offset:c.input.noiseOffset,curve_noise_scale:a.curveNoiseScale,curve_angle_scale:a.curveAngleScale};d.curves={...d.curves,count:c.input.count,length:c.input.length,stepSize:c.input.stepSize,sampling:c.input.sampling as typeof d.curves.sampling,cellSize:a.fieldCellSize,noiseOctaves:a.curveNoiseOctaves,noiseOffset:a.curveNoiseOffset};
  const m=model(d,{sourceWidth:c.input.width,sourceHeight:c.input.height}),before=m.diagnosticSnapshot();
  expect([...before.geometry!.xs]).toEqual(c.xs);expect([...before.geometry!.ys]).toEqual(c.ys);
  m.beginPerlinParameterActions([start('noise_offset',c.rebuild.noiseOffset,c.rebuild.noiseOffset,0)]);m.interpolatePerlinParameterActions(1,true,0);m.update(0,0);
  const after=m.diagnosticSnapshot();expect([...after.geometry!.xs]).toEqual(c.rebuild.xs);expect([...after.geometry!.ys]).toEqual(c.rebuild.ys);expect(after.curveColors).toEqual(before.curveColors);expect(after.geometry!.seedXs).toEqual(before.geometry!.seedXs);m.dispose();
 });
 it('refreshes curve colors before the same update advances noise scale drift',()=>{
  const d=config();d.cpuStyle='field-curves';d.curves.colorMode='noise';const m=model(d);
  m.beginPerlinParameterActions([start('curve_noise_scale',.1,10,.8)]);m.interpolatePerlinParameterActions(1,true,0);
  m.beginGradientActions([gradient]);m.interpolateGradientActions(1,true);
  const before=m.diagnosticSnapshot(),g=before.geometry!;
  const colors=new SourcePerlinColorRuntime({palette:d.palette});colors.beginGradientActions([gradient]);colors.interpolateGradientActions(1,true);colors.update(.2);
  const resolver=new SourcePerlinCurveColors({seed:d.seed,width:320,height:200,seedSpaceCircleCount:d.curves.seedCircleCount,minRadius:d.curves.seedMinRadius,maxRadius:d.curves.seedMaxRadius,colors,noise:new SourceProcessingNoise(BigInt(sourcePerlinSeed(d.seed).textureSeed))});
  const expected=Array.from({length:g.count},(_,i)=>resolver.resolve({mode:'noise',index:i,count:g.count,x:g.seedXs[i],y:g.seedYs[i],curveNoiseScale:before.parameters.values.curve_noise_scale,curveNoiseOctaves:d.curves.noiseOctaves}));
  m.update(.2,.2);const after=m.diagnosticSnapshot();expect([...after.curveColors!]).toEqual(expected);expect(after.parameters.values.curve_noise_scale).not.toBe(before.parameters.values.curve_noise_scale);expect(after.geometry!.xs).not.toEqual(before.geometry!.xs);m.dispose();
 });
 it('retains initial particle color endpoint until an actual refresh',()=>{
  const d=config();d.particles.count=1;d.palette=[0xffff0000,0xff0000ff];const m=model(d);
  expect([...m.diagnosticSnapshot().particleColors!.packed]).toEqual([0xff0000ff]);m.beginGradientActions([gradient]);m.interpolateGradientActions(1,true);expect([...m.diagnosticSnapshot().particleColors!.packed]).toEqual([0xff0000ff]);m.replacePalette(d.palette);expect([...m.diagnosticSnapshot().particleColors!.packed]).toEqual([0xffff0000]);m.dispose();
 });
 it('showTrails affects recording while hidden trails still expire',()=>{
  const d=config();d.display.trailLifetime=.1;d.display.showTrails=false;d.particles.stepSize=2;const m=model(d);
  expect(m.diagnostics().trails!.records).toBe(3);m.update(.2,.2);expect(m.diagnostics().trails!.records).toBe(0);m.setShowTrails(true);m.update(.21,.01);expect(m.diagnostics().trails!.records).toBe(3);m.dispose();
 });
 it('static draw snapshots only on cache rebuilding and never advances motion',()=>{
  // Intercepts the already-tested GPU boundary; this checks model/cache event
  // ownership, not pixels or WebGL capabilities.
  const draw=vi.spyOn(SourcePerlinCpuTarget.prototype,'draw').mockImplementation(()=>{}),d=config();d.cpuStyle='field-curves';const m=model(d),target=new SourcePerlinCpuTarget({width:320,height:200,density:1,samples:0,initialColor:[0,0,0,0]});
  try{for(let i=0;i<4;i++)m.draw({target,kind:'primary',sourcePixelDensity:1});expect(m.diagnostics()).toMatchObject({drawingSnapshots:1,updates:0,draws:4});m.replacePalette([0xff123456]);m.draw({target,kind:'primary',sourcePixelDensity:1});expect(m.diagnostics().drawingSnapshots).toBe(2);}
  finally{m.dispose();target.dispose();draw.mockRestore();}
 });
 it('preserves source display PC202–233 branches without particle heads',()=>{
  const submitted:string[]=[],draw=vi.spyOn(SourcePerlinCpuTarget.prototype,'draw').mockImplementation(frame=>{submitted.push(...frame.primitives.map(p=>p.kind));frame.streamPrimitives?.(p=>submitted.push(p.kind));});
  try{for(const accumulation of [false,true])for(const showTrails of [false,true]){
   submitted.length=0;
   const d=config();d.display.accumulation=accumulation;d.display.showTrails=showTrails;const m=model(d),target=new SourcePerlinCpuTarget({width:320,height:200,density:1,samples:0,initialColor:[0,0,0,0]});
   for(let i=1;i<=6;i++)m.update(i/60,1/60);
   m.draw({target,kind:'primary',sourcePixelDensity:1});const frame=draw.mock.calls.at(-1)![0];expect(submitted).toEqual(accumulation?['points']:showTrails?['lines']:[]);expect(frame.accumulation).toBe(accumulation);m.dispose();target.dispose();
  }}finally{draw.mockRestore();}
 });
 it('streams long trail caches inside one target frame without retaining expanded geometry',()=>{
  const chunks:number[]=[],draw=vi.spyOn(SourcePerlinCpuTarget.prototype,'draw').mockImplementation(frame=>frame.streamPrimitives?.(primitive=>{
   expect(primitive.kind).toBe('lines');expect(primitive.buffers.caches).toHaveLength(1);expect(primitive.buffers.caches[0].vertexOffset).toBe(0);chunks.push(primitive.buffers.positions.length/4);
  }));
  const d=config();d.particles.count=3000;d.particles.stepSize=2;
  const m=model(d),target=new SourcePerlinCpuTarget({width:320,height:200,density:1,samples:0,initialColor:[0,0,0,0]});
  try{
   for(let i=1;i<=12;i++)m.update(i/60,1/60);
   m.draw({target,kind:'primary',sourcePixelDensity:1});
   expect(draw).toHaveBeenCalledTimes(1);expect(draw.mock.calls[0][0].primitives).toHaveLength(0);expect(chunks.length).toBeGreaterThan(1);expect(Math.max(...chunks)).toBeLessThan(32768);expect(m.diagnostics().draws).toBe(1);
   const snapshot=m.diagnosticSnapshot().trails!,bytes=Object.values(snapshot).reduce((sum,value)=>sum+(ArrayBuffer.isView(value)?value.byteLength:0),0)+snapshot.alphas.length*16;
   expect(draw.mock.calls[0][0].streamRetainedBytes).toBe(bytes);
   let emitted=0;draw.mockImplementation(frame=>frame.streamPrimitives?.(()=>{if(++emitted===2)throw new Error('Second upload failed');}));
   expect(()=>m.draw({target,kind:'primary',sourcePixelDensity:1})).toThrow('Second upload failed');expect(emitted).toBe(2);expect(()=>m.setBackend('gpu')).toThrow(expect.objectContaining({code:'failed'}));
  }finally{m.dispose();target.dispose();draw.mockRestore();}
 });
 it('does not borrow canonical mutable input or diagnostic arrays',()=>{
  const d=config(),a=model(d),b=model(d);d.particles.stepSize=900;d.palette[0]=0;a.diagnosticSnapshot().motion!.positions.fill(0);a.update(.1,.1);b.update(.1,.1);expect(a.diagnosticSnapshot()).toEqual(b.diagnosticSnapshot());a.dispose();b.dispose();
 });
 it('reserves cumulative work before changing the next particle frame',()=>{
  let armed=false,units=0;const m=model(config(),{reserve:(n:number)=>{units+=n;if(armed)throw Object.assign(new Error('Replay work budget exceeded'),{code:'capacity'});}});
  expect(units).toBeGreaterThan(0);armed=true;expect(()=>m.update(.1,.1)).toThrow(expect.objectContaining({code:'capacity'}));armed=false;expect(()=>m.diagnosticSnapshot()).toThrow(expect.objectContaining({code:'failed'}));m.dispose();
 });
 it('fails closed after invalid update, cancellation and render failure',()=>{
  const a=model();expect(()=>a.update(NaN,0)).toThrow(expect.objectContaining({code:'input'}));expect(()=>a.diagnostics()).toThrow(expect.objectContaining({code:'failed'}));a.dispose();
  let cancelled=false;const b=model(config(),{isCancelled:()=>cancelled});cancelled=true;expect(()=>b.update(.1,.1)).toThrow(expect.objectContaining({code:'cancelled'}));cancelled=false;expect(()=>b.setShowTrails(true)).toThrow(expect.objectContaining({code:'failed'}));b.dispose();
  const c=model();expect(()=>c.draw(null!)).toThrow(expect.objectContaining({code:'input'}));expect(()=>c.update(.1,.1)).toThrow(expect.objectContaining({code:'failed'}));c.dispose();expect(()=>c.diagnostics()).toThrow(expect.objectContaining({code:'disposed'}));
 });
});
describe('Perlin retained CPU state across backend switches',()=>{
 it('initializes CPU particles even for GPU and creates palette pixels only at a GPU display request',()=>{
  const d=config(),gpu=model(d,{backend:'gpu'}),cpu=model(d);
  expect(gpu.diagnosticSnapshot().motion).toEqual(cpu.diagnosticSnapshot().motion);
  expect(gpu.diagnosticSnapshot().trails).toEqual(cpu.diagnosticSnapshot().trails);
  expect(gpu.diagnosticSnapshot().particleColors).toEqual(cpu.diagnosticSnapshot().particleColors);
  expect(gpu.diagnosticSnapshot().colors.textureBuilds).toBe(0);
  gpu.update(1/3,.1);gpu.setBackend('cpu');gpu.setBackend('gpu');
  expect(gpu.diagnosticSnapshot().colors.textureBuilds).toBe(0);
  const first=gpu.gpuDisplayFacts();expect(first.time).toBe(F(1/3));expect(first.palette).toHaveLength(256);
  const original=first.palette[0];first.palette.fill(0);
  expect(gpu.gpuDisplayFacts().palette[0]).toBe(original);expect(gpu.diagnosticSnapshot().colors.textureBuilds).toBe(1);
  gpu.dispose();cpu.dispose();
 });
 it('pauses CPU RNG, motion, trail expiration and natural drift while GPU time and gradients continue',()=>{
  const d=config();d.particles.stepSize=4;d.particles.respawnRate=.7;d.particles.timeScale=.5;d.display.trailLifetime=.2;
  const retained=model(d),control=model(d);
  for(const m of [retained,control]){
   m.beginPerlinParameterActions([start('noise_scale',4,30,1)]);m.interpolatePerlinParameterActions(1,true,0);
   for(let i=1;i<=4;i++)m.update(i/60,1/60);
  }
  retained.beginGradientActions([gradient]);retained.interpolateGradientActions(1,true);
  retained.setBackend('gpu');const before=retained.diagnosticSnapshot();
  for(let i=1;i<=3;i++)retained.update(i,.2);
  const gpu=retained.diagnosticSnapshot();
  expect(gpu.motion).toEqual(before.motion);expect(gpu.trails!.positions).toEqual(before.trails!.positions);expect(gpu.trails!.records).toBe(before.trails!.records);expect(gpu.trails!.alphas).toEqual(before.trails!.alphas);
  expect(gpu.parameters).toEqual(before.parameters);expect(gpu.colors.state).not.toEqual(before.colors.state);expect(gpu.particleColors!.packed).not.toEqual(before.particleColors!.packed);
  expect(retained.diagnostics()).toMatchObject({backend:'gpu',time:3,updates:7,cpuUpdates:4});expect(gpu.colors.textureBuilds).toBe(0);
  expect(retained.gpuDisplayFacts().time).toBe(3);
  retained.setBackend('cpu');retained.update(3.1,.1);control.update(3.1,.1);
  const resumed=retained.diagnosticSnapshot(),expected=control.diagnosticSnapshot();
  expect(resumed.motion).toEqual(expected.motion);expect(resumed.parameters).toEqual(expected.parameters);
  expect(resumed.trails!.positions).toEqual(expected.trails!.positions);expect(resumed.trails!.records).toBe(expected.trails!.records);
  expect(retained.diagnostics()).toMatchObject({backend:'cpu',updates:8,cpuUpdates:5});retained.dispose();control.dispose();
 });
 it('retains curve seeds while GPU actions rebuild angles and dirty geometry before CPU resumes',()=>{
  const d=config();d.cpuStyle='field-curves';const m=model(d,{backend:'gpu'}),before=m.diagnosticSnapshot();
  m.beginPerlinParameterActions([start('curve_noise_scale',3,3,0)]);m.interpolatePerlinParameterActions(1,true,0);
  const changed=m.diagnosticSnapshot();expect(changed.parameters.values.curve_noise_scale).toBe(3);expect(changed.geometry).toEqual(before.geometry);expect(m.diagnostics().geometryDirty).toBe(true);
  m.update(1,.5);expect(m.diagnosticSnapshot().parameters).toEqual(changed.parameters);expect(m.diagnostics().geometryBuilds).toBe(1);
  m.setBackend('cpu');m.update(1,0);const after=m.diagnosticSnapshot();
  expect(m.diagnostics().geometryBuilds).toBe(2);expect(after.geometry!.seedXs).toEqual(before.geometry!.seedXs);expect(after.geometry!.seedYs).toEqual(before.geometry!.seedYs);expect(after.geometry!.xs).not.toEqual(before.geometry!.xs);
  expect(after.curveColors).toEqual(before.curveColors);m.dispose();
 });
 it('switches neither rebuild nor discard the retained static curve cache',()=>{
  const draw=vi.spyOn(SourcePerlinCpuTarget.prototype,'draw').mockImplementation(()=>{}),d=config();d.cpuStyle='field-curves';const m=model(d),target=new SourcePerlinCpuTarget({width:320,height:200,density:1,samples:0,initialColor:[0,0,0,0]});
  try{
   m.draw({target,kind:'primary',sourcePixelDensity:1});const before=m.diagnostics();
   m.setBackend('gpu');m.gpuDisplayFacts();m.setBackend('cpu');m.draw({target,kind:'primary',sourcePixelDensity:1});
   expect(m.diagnostics().curveDisplay!.builds).toBe(before.curveDisplay!.builds);expect(m.diagnostics().drawingSnapshots).toBe(1);expect(target.diagnostics().deviceTargets).toBe(2);
  }finally{m.dispose();target.dispose();draw.mockRestore();}
 });
 it('uses the injected live noise owner after switching without recreating CPU state',()=>{
  let value=.1,calls=0;const noise={sample:()=>{calls++;return value;}},d=config(),m=model(d,{noise});
  m.update(.1,.1);expect(calls).toBeGreaterThan(0);const count=calls,before=m.diagnosticSnapshot().motion!;
  m.setBackend('gpu');value=.8;m.update(.2,.1);expect(calls).toBe(count);expect(m.diagnosticSnapshot().motion).toEqual(before);
  m.setBackend('cpu');m.update(.3,.1);expect(calls).toBeGreaterThan(count);expect(m.diagnosticSnapshot().motion!.velocities).not.toEqual(before.velocities);m.dispose();
 });
 it('rejects invalid backend/noise and poisons a failed display or switch owner',()=>{
  for(const options of [{backend:'invalid'},{noise:null},{noise:{sample:3}}])expect(()=>model(config(),options)).toThrow(expect.objectContaining({code:'input'}));
  const m=model();expect(()=>m.setBackend('invalid' as 'cpu')).toThrow(expect.objectContaining({code:'input'}));expect(()=>m.setBackend('gpu')).toThrow(expect.objectContaining({code:'failed'}));m.dispose();
  const cpu=model();expect(()=>cpu.gpuDisplayFacts()).toThrow(expect.objectContaining({code:'input'}));expect(()=>cpu.update(0,0)).toThrow(expect.objectContaining({code:'failed'}));cpu.dispose();
  const gpu=model(config(),{backend:'gpu'});expect(()=>gpu.draw(null!)).toThrow(expect.objectContaining({code:'input'}));expect(()=>gpu.gpuDisplayFacts()).toThrow(expect.objectContaining({code:'failed'}));gpu.dispose();
 });
});
describe('Scene background clear/fade RGB255 boundary',()=>{
 it('distinguishes packed transparent colors from low-integer gray',()=>{expect(sourcePerlinBackgroundRgba(1,false,6)).toEqual([F(1/255),F(1/255),F(1/255),1]);expect(sourcePerlinBackgroundRgba(0x123456,false,6)).toEqual([F(0x12/255),F(0x34/255),F(0x56/255),0]);});
 it('multiplies and truncates packed alpha once for the fading rect',()=>{expect(sourcePerlinBackgroundRgba(0x80123456,true,6)[3]).toBe(F(3/255));expect(sourcePerlinBackgroundRgba(0x80123456,true,255)[3]).toBe(F(128/255));expect(sourcePerlinBackgroundRgba(1,true,6)[3]).toBe(F(6/255));expect(sourcePerlinBackgroundRgba(0x01000001,true,6)).toEqual([0,0,F(1/255),0]);});
 it('clamps Scene fade alpha without altering background clear alpha',()=>{expect(sourcePerlinBackgroundRgba(0x80123456,true,-10)[3]).toBe(0);expect(sourcePerlinBackgroundRgba(0x80123456,true,1000)[3]).toBe(F(128/255));expect(sourcePerlinBackgroundRgba(0x80123456,false,0)[3]).toBe(F(128/255));});
});
