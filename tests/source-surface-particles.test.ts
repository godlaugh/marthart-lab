import {describe,it,expect} from 'vitest';
import {parseProjectFile} from '../src/engine/legacyImport';
import {parseScene,serializeScene} from '../src/engine/document';
import {prepareSourceSurfaceParticles,replaySourceSurface} from '../src/engine/sourceSurfaceParticles';
import {usesSourceSurfaceParticles} from '../src/engine/sourceSurfaceIdentity';
import {generateScene} from '../src/engine/temporal';
import {sceneAtTime} from '../src/engine/timeline';
import {ordinarySourceViewport} from '../src/engine/ordinarySourceCamera';
import {supportsCameraAction,supportsParticleTracking} from '../src/engine/sceneCamera';

// Instruction-derived examples from MathArt 1.7.8, JAR SHA256
// a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018.
// ParametricSurface.initDots (24–122), updateCPUDots (75–620,1274–1376),
// Scene.update (132/183/225). Exact dyadic fixtures isolate indexing, boundary
// and frame-phase behavior; these are not original runtime/pixel comparisons.
function source(){return{config_version:'1.0.0',type:'SURFACE',name:'Particle identity',equations:{x:'u',y:'v',z:'u+v'},settings:{surface_mode:'POINTS',render_mode:'CPU',show_trails:false,u_segments:3,v_segments:5,u_min:0,u_max:6,v_min:0,v_max:10,speed_u:2,speed_v:-1,scale_x:1,scale_y:1,scale_z:1,offset_x:0,offset_y:0,offset_z:0},camera:{phi:0,theta:0,gamma:0},timeline:[{type:'animate',duration:.5,easing:'LINEAR',actions:[{method:'track',args:[7]}]}]};}
function scene(raw:unknown=source()){const s=parseProjectFile(JSON.stringify(raw)).scene;s.timeline.fps=4;return s;}
const target=(index:number)=>({trackId:'a',actionIndex:0,action:{id:'t',method:'track',args:{index}}});
const point=(positions:Float32Array,id:number)=>Array.from(positions.slice(id*3,id*3+3));

describe('source CPU surface through public import, document and geometry',()=>{
 it('retains the half-open asymmetric U-major lattice and stable index identity',()=>{
  const s=scene(),p=prepareSourceSurfaceParticles(s).create('all'),out=p.snapshot();
  expect(Array.from(out.particleIds)).toEqual(Array.from({length:15},(_,i)=>i));
  expect(Array.from(out.positions)).toEqual([0,0,0, 0,2,2, 0,4,4, 0,6,6, 0,8,8, 2,0,2, 2,2,4, 2,4,6, 2,6,8, 2,8,10, 4,0,4, 4,2,6, 4,4,8, 4,6,10, 4,8,12]);
  expect(supportsCameraAction(s,'track')).toBe(true);expect(supportsParticleTracking(s)).toBe(true);
 });
 it('feeds tracking and rendered geometry from the same frame across save/reopen and reverse seeks',()=>{
  const restored=parseScene(serializeScene(scene()));
  for(const time of [.25,1,0,.25]){
   const out=generateScene(restored,{time,width:96,height:64,quality:'preview',sourceViewport:ordinarySourceViewport(restored,96,64,'primary',64)});
   if(out.type!=='geometry')throw Error('geometry required');
   const expected=time===0?[2.5,3.75,6.25]:[3,3.5,6.5];
   expect(point(out.positions,7)).toEqual(expected);
   const center=time===0?[1,2,3]:expected;
   expect(out.sourceCameraFrame?.camera.center).toEqual(center);
   expect(sceneAtTime(restored,time).evaluatedSourceCamera?.camera.center).toEqual(center);
  }
  expect(restored.evaluatedSourceCamera).toBeUndefined();
 });
 it('reads bounds before custom parameters, literal speeds with fallback, and one-segment axes without local reinterpretation',()=>{
  const raw={...source(),parameters:{a:8},settings:{...source().settings,u_segments:1,u_max:'a',v_max:'PI',speed_u:'2*3',scale_x:'invalid'}};
  const s=scene(raw);expect(s.settings).toMatchObject({uSegments:1,uMax:0,vMax:Math.fround(Math.PI),speedU:Math.fround(.3),scaleX:55});
  expect(prepareSourceSurfaceParticles(s).create('all').snapshot().positions.length).toBe(15);
  expect(s.provenance?.original).toEqual(raw);
 });
 it('preserves source number lexemes for geometry and ignores disabled malformed source clips',()=>{
  const text=JSON.stringify({...source(),timeline:[{enabled:false,actions:42},...source().timeline]}).replace('"u_segments":3','"u_segments":3e0').replace('"speed_u":2','"speed_u":2.000');
  const s=parseProjectFile(text).scene,restored=parseScene(serializeScene(s));
  expect(restored.provenance?.sourceNumberTokens).toEqual(expect.arrayContaining([{path:['settings','u_segments'],token:'3e0'},{path:['settings','speed_u'],token:'2.000'}]));
  expect(restored.settings.uSegments).toBe(3); // JSONObject Double.intValue, with original token retained.
  expect(restored.timeline.tracks).toHaveLength(1);
 });
 it('does not upgrade old local/ordinary camera geometry or empty native track calls',()=>{
  const raw=source();raw.timeline[0].actions[0].args=[];
  const s=scene(raw);expect(usesSourceSurfaceParticles(s)).toBe(false);expect(supportsParticleTracking(s)).toBe(false);
 });
 it.each([{render_mode:'GPU',surface_mode:'MESH'},{u_segments:513}])('fails explicitly instead of changing requested geometry %j',settings=>{
  expect(()=>scene({...source(),settings:{...source().settings,...settings}})).toThrow(/尚未|待接入|1–512/);
 });
 it('rejects parameter actions without the source registry model during replay',()=>{
  const s=scene();s.timeline.tracks[0].actions!.push({id:'p',method:'paramStart',args:{}});
  expect(()=>replaySourceSurface(s,0,'all')).toThrow('需要数组');
 });
});

describe('source particle state boundary',()=>{
 it('clamps overshoot, reverses only strictly outside, and retains separate particle references',()=>{
  const s=scene();Object.assign(s.settings,{uMin:0,uMax:1,uSegments:2,vSegments:1,speedU:2,speedV:0,periodicU:true,flowingU:false});
  const p=prepareSourceSurfaceParticles(s).create('all'),a=p.bind(target(0)),b=p.bind(target(1));if(a.kind!=='bound'||b.kind!=='bound')throw Error();
  const values:number[][]=[];
  for(let i=0;i<4;i++){p.update({frameIndex:i,time:(i+1)/4,deltaTime:.25});values.push([a.readPosition()[0],b.readPosition()[0]]);}
  expect(values).toEqual([[.5,1],[1,1],[1,.5],[.5,0]]);
 });
 it('wraps negative remainders, prewraps and handles collapsed periods',()=>{
  const s=scene();Object.assign(s.settings,{uMin:0,uMax:1,uSegments:1,vSegments:1,speedU:-2,speedV:0,periodicU:true,flowingU:true});
  const p=prepareSourceSurfaceParticles(s).create('all');p.update({frameIndex:0,time:.25,deltaTime:.25});expect(p.snapshot().positions[0]).toBe(.5);
  s.settings.uMax=0;const collapsed=prepareSourceSurfaceParticles(s).create('all');collapsed.update({frameIndex:0,time:.25,deltaTime:.25});expect(collapsed.snapshot().positions[0]).toBe(0);
 });
 it('uses float conversion before separate scale multiply and offset add',()=>{
  const s=scene();s.equations.x='16777217';s.settings.scaleX=3;s.settings.offsetX=-50331648;
  expect(prepareSourceSurfaceParticles(s).create('all').snapshot().positions[0]).toBe(0);
 });
 it('last parameter slots shadow u/v, while no implicit time variable is invented',()=>{
  const s=scene();s.parameters={u:7};expect(point(prepareSourceSurfaceParticles(s).create('all').snapshot().positions,7)).toEqual([7,4,11]);
  s.equations.x='u+t';expect(()=>prepareSourceSurfaceParticles(s)).toThrow('公式 x');
 });
 it('sparse targets match full state, including truncation/clamping, and remain isolated across factories',()=>{
  const prepared=prepareSourceSurfaceParticles(scene()),full=prepared.create('all'),sparse=prepared.create('tracked');
  const refs=[-2,7.9,1e20].map(index=>sparse.bind(target(index)));
  for(let i=0;i<4;i++){const f={frameIndex:i,time:(i+1)/4,deltaTime:.25};full.update(f);sparse.update(f);}
  const positions=full.snapshot().positions;
  refs.forEach((ref,i)=>{if(ref.kind!=='bound')throw Error();expect(ref.readPosition()).toEqual(point(positions,[0,7,14][i]));});
  expect(prepared.create('all').snapshot().positions[0]).toBe(0);
 });
 it('poisons a cancelled replay so partial state cannot escape or resume',()=>{
  let cancel=false;const p=prepareSourceSurfaceParticles(scene()).create('all',()=>cancel),ref=p.bind(target(7));
  p.update({frameIndex:0,time:.25,deltaTime:.25});cancel=true;expect(()=>p.update({frameIndex:1,time:.5,deltaTime:.25})).toThrow('取消');cancel=false;
  expect(()=>p.snapshot()).toThrow('取消');expect(()=>p.update({frameIndex:1,time:.5,deltaTime:.25})).toThrow('取消');if(ref.kind==='bound')expect(()=>ref.readPosition()).toThrow('取消');
 });
 it('rejects nonfinite computed positions and never publishes a partially updated buffer',()=>{
  const s=scene();s.equations.x='1/(u-.5)';const p=prepareSourceSurfaceParticles(s).create('all');
  expect(()=>p.update({frameIndex:0,time:.25,deltaTime:.25})).toThrow('非有限坐标');expect(()=>p.snapshot()).toThrow('非有限坐标');
 });
 it('freezes after the active queue and rejects unsupported replay workloads',()=>{
  const s=scene();expect(replaySourceSurface(s,10,'all').particles.snapshot().positions).toEqual(replaySourceSurface(s,.25,'all').particles.snapshot().positions);
  Object.assign(s.settings,{uSegments:512,vSegments:512});s.timeline.tracks[0].duration=10;
  expect(()=>replaySourceSurface(s,1,'all')).toThrow('工作单位预算');
 });
});
