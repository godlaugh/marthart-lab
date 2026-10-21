import {describe,expect,it} from 'vitest';
import native from './fixtures/source-surface-clock/native.json';
import {importSourceSurfaceMeshConfig} from '../src/engine/sourceSurfaceMeshConfig';
import {SourceSurfaceHost} from '../src/engine/sourceSurfaceHost';
import {SourceSurfaceParameterRuntime} from '../src/engine/sourceSurfaceParameterRuntime';

const F=Math.fround;
function host(kind:string,backend:'CPU'|'GPU',initial:number){
 const parsed=importSourceSurfaceMeshConfig({render_mode:backend,surface_mode:kind==='mesh'?'MESH':'POINTS',u_segments:2,v_segments:2,mesh_u_segments:2,mesh_v_segments:2,u_min:0,u_max:1,v_min:0,v_max:1,speed_u:0,speed_v:0,scale_x:1,scale_y:1,scale_z:1,show_trails:false,mesh_wireframe:false});
 if(!parsed.ok)throw Error(parsed.error.reason);
 return new SourceSurfaceHost({configuration:parsed.value.configuration,equations:{x:'a+u',y:'v',z:'0'},parameters:{a:initial},frameRate:4,coverage:'all'});
}
function value(h:SourceSurfaceHost){const s=h.snapshot();return 'gpuPoints' in s?s.gpuPoints.frame.parameters[0]:s.mode==='points'?s.points.positions[0]:s.mesh.gpuMesh?s.mesh.gpuMesh.parameters[0]:s.mesh.geometry!.positions[0];}
const traces=native.actual.filter(c=>c.kind!=='mesh-empty');
describe('original JVM Surface observations through production geometry/uniform owners',()=>{
 for(const trace of traces)for(const backend of ['CPU','GPU'] as const)it(`${backend} ${trace.kind} native case ${trace.case}`,()=>{
  const h=host(trace.kind,backend,trace.initial);
  h.beginParameterActions([{kind:'start',scope:{kind:'named',name:'a'},configuration:{step:trace.step,min:trace.min,max:trace.max}}]);h.interpolateParameterActions(1,true);
  for(const [frameIndex,f] of trace.frames.entries()){
   // Native surface update ignores dt<=0 without changing signed scene facts.
   const frame={frameIndex,time:f.time,deltaTime:f.dt,actualFrameRate:f.actualFrameRate};
   h.update(frame);h.displayFrame(frameIndex,true);
   expect(value(h),`frame ${frameIndex}, observed FPS ${f.actualFrameRate}`).toBe(F(f.value.value));
  }
 });
 for(const trace of traces.filter(c=>c.kind==='points'))it(`original double phases and setters case ${trace.case}`,()=>{
  let current=trace.initial;const runtime=new SourceSurfaceParameterRuntime({read:()=>current,write:(_,v)=>current=v,reserve:()=>{}});
  runtime.begin([{kind:'start',scope:{kind:'named',name:'a'},configuration:{step:trace.step,min:trace.min,max:trace.max}}]);runtime.interpolate(1,true);
  expect(runtime.snapshot().entries[0].phase).toBeCloseTo(trace.initialPhase.value,13);
  for(const f of trace.frames){if(f.dt>0)runtime.update(f.dt,f.actualFrameRate);expect(current).toBeCloseTo(f.value.value,13);expect(runtime.snapshot().entries[0].phase).toBeCloseTo(f.phase.value,13);}
 });
 for(const kind of ['points','mesh'])for(const backend of ['CPU','GPU'] as const){
  it(`${backend} ${kind} rejects malformed observations and retains the failed owner`,()=>{
   for(const actualFrameRate of [NaN,Infinity,-Infinity,1e300,null,'37']){
    const h=host(kind,backend,.25),frame={frameIndex:0,time:.1,deltaTime:.1,actualFrameRate:actualFrameRate as number};
    expect(()=>h.update(frame)).toThrow('有限 Float32');
    expect(()=>h.snapshot()).toThrow('有限 Float32');
   }
  });
  it(`${backend} ${kind} does not consume an observation on a zero-dt display`,()=>{
   const h=host(kind,backend,.25),frame={frameIndex:0,time:0,deltaTime:0,actualFrameRate:NaN};h.update(frame);h.displayFrame(0,true);expect(value(h)).toBe(.25);
  });
 }
 it('keeps the fixed replay fallback equivalent to an explicit matching observation',()=>{
  const a=host('points','CPU',.25),b=host('points','CPU',.25);
  for(const h of [a,b]){h.beginParameterActions([{kind:'start',scope:{kind:'named',name:'a'},configuration:{step:.1,min:-1,max:1}}]);h.interpolateParameterActions(1,true);}
  for(let frameIndex=0;frameIndex<4;frameIndex++){
   const frame={frameIndex,time:(frameIndex+1)/4,deltaTime:.25};a.update(frame);const observed={...frame,actualFrameRate:4};b.update(observed);a.displayFrame(frameIndex,true);b.displayFrame(frameIndex,true);expect(a.snapshot()).toEqual(b.snapshot());
  }
 });
});
