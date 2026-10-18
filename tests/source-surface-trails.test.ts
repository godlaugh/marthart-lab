import {describe,it,expect} from 'vitest';
import {parseProjectFile} from '../src/engine/legacyImport';
import {parseScene,serializeScene} from '../src/engine/document';
import {prepareSourceSurfaceParticles,replaySourceSurface} from '../src/engine/sourceSurfaceParticles';
import {generateScene} from '../src/engine/temporal';
import {ordinarySourceViewport} from '../src/engine/ordinarySourceCamera';
import {outputBuffers} from '../src/engine/outputBuffers';

// Static instruction-derived fixtures, not original application runtime results.
// MathArt 1.7.8 a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018:
// updateCPUDots PCs203–620/793–1168/1379–1472; initDots PCs60–72;
// Dot3D addTrail/updateTrailExpiration; ParticleSystemMobject drawTrailsLines.
function fixture(settings:Record<string,unknown>={}){
 const s=parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'SURFACE',name:'Source seams',equations:{x:'u',y:'v',z:'0'},settings:{u_segments:1,v_segments:1,u_min:0,u_max:1,v_min:0,v_max:1,periodic_u:true,flowing_u:true,speed_u:3,speed_v:0,scale_x:1,scale_y:1,scale_z:1,...settings},timeline:[{type:'animate',duration:1,actions:[{method:'track',args:[0]}]},{type:'wait',duration:2}]})).scene;
 s.timeline.fps=4;return s;
}
const f=Math.fround;
function run(settings:Record<string,unknown>={},frames=2){const s=fixture(settings),p=prepareSourceSurfaceParticles(s).create('all');for(let i=0;i<frames;i++)p.update({frameIndex:i,time:(i+1)/4,deltaTime:.25});return p.snapshot();}
const xyz=(positions:Float32Array)=>Array.from({length:positions.length/3},(_,i)=>Array.from(positions.slice(i*3,i*3+3)));

describe('source surface trail producer, finite output and original break identity',()=>{
 it('records no initial point, inserts two boundary endpoints and a gap, and fades by original ordinal',()=>{
  const out=run(),t=out.trails!;expect(t.records).toBe(5);
  expect(xyz(t.positions)).toEqual([[.75,0,0],[1,0,0],[0,0,0],[.5,0,0]]);
  expect(Array.from(t.indices)).toEqual([0,1,2,3]);expect(Array.from(t.alphas)).toEqual([0,f(63/255),f(191/255),1]);
  expect(Array.from(t.particleIds)).toEqual([0,0,0,0]);expect(t.positions.every(Number.isFinite)).toBe(true);
 });
 it('never joins different particle histories when compacting pooled records',()=>{
  const t=run({u_segments:2}).trails!;expect(t.records).toBe(10);
  expect(Array.from(t.particleIds)).toEqual([0,0,0,0,1,1,1,1]);expect(Array.from(t.indices)).toEqual([0,1,2,3,5,6,6,7]);
 });
 it('preserves the native strict crossing test: an exact endpoint wrap has no break marker',()=>{
  const t=run({speed_u:2}).trails!;expect(t.records).toBe(2);expect(xyz(t.positions)).toEqual([[.5,0,0],[0,0,0]]);expect(Array.from(t.indices)).toEqual([0,1]);
 });
 it('uses one earliest boundary and resets both crossing axes even for different crossing fractions and multiple wraps',()=>{
  const t=run({u_min:.5,speed_u:4,speed_v:16,periodic_v:true,flowing_v:true},1).trails!;
  expect(t.records).toBe(4);expect(xyz(t.positions)).toEqual([[.75,1,0],[.5,0,0],[.5,0,0]]);expect(Array.from(t.indices)).toEqual([1,2]);
 });
 it('does not insert separators on nonflowing reflection',()=>{
  const t=run({flowing_u:false},3).trails!;expect(t.records).toBe(3);expect(xyz(t.positions)).toEqual([[.75,0,0],[1,0,0],[.25,0,0]]);expect(Array.from(t.indices)).toEqual([0,1,1,2]);
 });
 it('keeps break records even when the exit formula is nonfinite, and never bridges them after compaction',()=>{
  const s=fixture();s.equations.x='1/(u-1)';const p=prepareSourceSurfaceParticles(s).create('all');
  for(let i=0;i<2;i++)p.update({frameIndex:i,time:(i+1)/4,deltaTime:.25});
  const t=p.snapshot().trails!;expect(t.records).toBe(5);expect(xyz(t.positions)).toEqual([[-4,0,0],[-1,0,0],[-2,0,0]]);expect(Array.from(t.indices)).toEqual([1,2]);expect(Array.from(t.alphas)).toEqual([0,f(191/255),1]);
 });
 it('expires only when Float32 age is strictly greater than lifetime, counting separators too',()=>{
  const t=run({trail_lifetime:.5},3).trails!;expect(t.records).toBe(9);expect(t.oldestTime).toBe(.25);
  const later=run({trail_lifetime:.5},4).trails!;expect(later.records).toBe(9);expect(later.oldestTime).toBe(.5);
 });
 it('uses native per-dot maximum even when a higher frame rate could retain more samples within lifetime',()=>{
  const s=fixture({trail_lifetime:1,periodic_u:false,speed_u:1}),p=prepareSourceSurfaceParticles(s).create('all');
  for(let i=0;i<600;i++)p.update({frameIndex:i,time:(i+1)/256,deltaTime:1/256});
  const t=p.snapshot().trails!;expect(t.records).toBe(180);expect(t.positions[0]).toBe(421/256);expect(t.positions.at(-3)).toBe(600/256);expect(t.indices.length).toBe(358);
 });
 it('retains all same-frame records at zero lifetime, and honors signed native capacity overflow',()=>{
  const t=run({trail_lifetime:0}).trails!;expect(t.records).toBe(4);expect(xyz(t.positions)).toEqual([[1,0,0],[0,0,0],[.5,0,0]]);expect(Array.from(t.indices)).toEqual([1,2]);
  expect(run({trail_lifetime:-1}).trails!.records).toBe(0);
  expect(run({trail_lifetime:1e10}).trails!.records).toBe(0);
 });
 it('keeps nonfading opacity constant and history independent across repeated snapshots',()=>{
  const s=fixture({fade_trails:false}),p=prepareSourceSurfaceParticles(s).create('all');p.update({frameIndex:0,time:.25,deltaTime:.25});p.update({frameIndex:1,time:.5,deltaTime:.25});
  const a=p.snapshot().trails!;expect(Array.from(a.alphas)).toEqual([1,1,1,1]);a.positions.fill(999);expect(p.snapshot().trails!.positions[0]).toBe(.75);
 });
 it.each(['showTrails','recordTrails','fadeTrails'])('rejects an invalid authored %s rather than guessing a display/recording state',key=>{const s=fixture();s.settings[key]='false';expect(()=>prepareSourceSurfaceParticles(s)).toThrow('布尔值');});
 it('does not allocate visible history for disabled display/recording or sparse camera queries',()=>{
  const s=fixture({show_trails:false});expect(replaySourceSurface(s,1,'all').particles.snapshot().trails).toBeUndefined();
  s.settings.showTrails=true;s.settings.recordTrails=false;expect(replaySourceSurface(s,1,'all').particles.snapshot().trails).toBeUndefined();
  expect(replaySourceSurface(fixture(),1,'tracked').frame.camera).toEqual(replaySourceSurface(fixture(),1,'all').frame.camera);
 });
 it('does not age or mutate trails after source queue completion',()=>{
  const s=fixture({trail_lifetime:.5}),a=replaySourceSurface(s,3,'all'),b=replaySourceSurface(s,10,'all');expect(a.particles.snapshot().trails).toEqual(b.particles.snapshot().trails);
 });
 it('delivers source line style, finite explicit topology and transferable trail buffers after save/reopen',()=>{
  const s=parseScene(serializeScene(fixture({line_weight:0}))),out=generateScene(s,{time:.25,width:96,height:64,quality:'preview',sourceViewport:ordinarySourceViewport(s,96,64,'primary',64)});
  if(out.type!=='geometry')throw Error('geometry required');
  expect(out.trails?.appearance).toEqual({width:f(.1),overlay:true});expect(out.trails?.indices).toEqual(new Uint32Array([0,1,2,3]));
  expect(out.trails?.colors?.length).toBe(out.trails?.positions.length);expect(out.temporal?.recordedPoints).toBe(5);
  for(const array of [out.trails!.positions,out.trails!.alphas,out.trails!.indices!,out.trails!.colors!])expect(outputBuffers(out)).toContain(array.buffer);
 });
 it('poisons snapshots if history enumeration is cancelled',()=>{
  let cancelled=false;const p=prepareSourceSurfaceParticles(fixture()).create('all',()=>cancelled);p.update({frameIndex:0,time:.25,deltaTime:.25});cancelled=true;expect(()=>p.snapshot()).toThrow('取消');cancelled=false;expect(()=>p.snapshot()).toThrow('取消');
 });
});
