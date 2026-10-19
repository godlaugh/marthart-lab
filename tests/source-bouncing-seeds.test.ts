import {describe,it,expect,vi} from 'vitest';
import {importSourceBouncingConfig,type SourceBouncingConfiguration} from '../src/engine/sourceBouncingConfig';
import {createSourceBouncingSeedStream,generateSourceBouncingSeeds,prepareSourceBouncingSeeds,SOURCE_BOUNCING_SEED_LIMITS} from '../src/engine/sourceBouncingSeeds';
import {JavaSourceRandom48} from '../src/engine/javaSourceRandom';

function config(settings:Record<string,unknown>={}):SourceBouncingConfiguration{
 const result=importSourceBouncingConfig({settings:{particle_count:3,...settings}});if(!result.ok)throw Error(JSON.stringify(result.error));return result.value.configuration;
}
function generated(c:SourceBouncingConfiguration){const result=generateSourceBouncingSeeds(c);if(!result.ok)throw Error(JSON.stringify(result.error));return result.value;}
const F=Math.fround;
describe('source Bouncing ordered seed owner',()=>{
 it('keeps every slot and the Random state after all512 rejected candidates',()=>{
  const c=config({container_shape:'CIRCLE',boundary_center_x:2,boundary_center_y:3,circle_radius:.1,x0_min:5,x0_max:5,y0_min:6,y0_max:6});
  const out=generated(c);expect(out.diagnostics.centerFallbacks).toBe(3);expect(out.diagnostics.outerAttempts).toBe(1536);expect(out.state.length).toBe(12);
  for(let i=0;i<3;i++)expect(Array.from(out.state.slice(i*4,i*4+2))).toEqual([2,3]);
  const rng=new JavaSourceRandom48(BigInt(c.seed));for(let i=0;i<3*512*2;i++)rng.nextFloat();
  expect(out.diagnostics.randomState48).toBe(rng.state48.toString());
 });
 it('uses boundaryCenter for seed rejection and GPU uniforms, retaining circleCenter as separate config facts',()=>{
  const c=config({container_shape:'CIRCLE',boundary_center_x:2,boundary_center_y:3,circle_center_x:99,circle_center_y:88,x0_min:2,x0_max:2,y0_min:3,y0_max:3});
  const out=generated(c);expect(out.diagnostics.outerAttempts).toBe(3);expect(out.update.boundary).toEqual({kind:'circle',center:[2,3],radius:c.circleRadius});
  expect([c.circleCenterX,c.circleCenterY]).toEqual([99,88]);
 });
 it('uses Float32 world vertex arithmetic mean on polygon fallback without rechecking it',()=>{
  const c=config({boundary_center_x:.1,boundary_center_y:.2,x0_min:99,x0_max:99,y0_min:99,y0_max:99});
  c.polygonVertices=[0,0,2,0,0,1];const out=generated(c),vertices=[[F(.1),F(.2)],[F(2+F(.1)),F(.2)],[F(.1),F(1+F(.2))]];
  let x=0,y=0;for(const v of vertices){x=F(x+v[0]);y=F(y+v[1]);}
  expect(Array.from(out.state.slice(0,2))).toEqual([F(x/3),F(y/3)]);expect(out.diagnostics.centerFallbacks).toBe(3);
  expect(out.update.boundary).toEqual({kind:'polygon',vertices});
 });
 it('does not inset polygon initialization by particleRadius',()=>{
  const c=config({particle_radius:.25,x0_min:.99,x0_max:.99,y0_min:0,y0_max:0});c.polygonVertices=[-1,-1,1,-1,1,1,-1,1];
  expect(generated(c).diagnostics.outerAttempts).toBe(3);
 });
 it('consumes random velocity draws after accepted position and skips zero jitter draws',()=>{
  const c=config({initial_velocity_mode:'RANDOM'}),out=generated(c),rng=new JavaSourceRandom48(BigInt(c.seed));
  for(let i=0;i<3;i++){rng.nextFloat();rng.nextFloat();rng.nextFloat();}
  expect(out.diagnostics.outerAttempts).toBe(3);expect(out.diagnostics.randomState48).toBe(rng.state48.toString());
  const jitter=generated({...c,initialAngleSpread:F(.1)}),withJitter=new JavaSourceRandom48(BigInt(c.seed));for(let i=0;i<12;i++)withJitter.nextFloat();
  expect(jitter.diagnostics.randomState48).toBe(withJitter.state48.toString());
 });
 it('detaches configuration and outputs, with identical independent replay',()=>{
  const c=config(),stream=createSourceBouncingSeedStream(c);if(!stream.ok)throw Error('stream');const first=stream.value.next();if(!first.ok||!first.value)throw Error('first');
  const baseline=generated(c);c.initialXMin=99;c.polygonVertices[0]=99;Reflect.set(first.value.position,0,99);
  const second=stream.value.next();if(!second.ok||!second.value)throw Error('second');expect(second.value.position).toEqual(Array.from(baseline.state.slice(4,6)));expect(second.value.velocity).toEqual(Array.from(baseline.state.slice(6,8)));
  expect(stream.value.next().ok).toBe(true);expect(stream.value.next()).toEqual({ok:true,value:null});
 });
 it('keeps cancellation terminal and returns no partial packed success',()=>{
  let cancelled=false;const stream=createSourceBouncingSeedStream(config(),{isCancelled:()=>cancelled});if(!stream.ok)throw Error('stream');expect(stream.value.next().ok).toBe(true);cancelled=true;
  const fail=stream.value.next();expect(fail).toMatchObject({ok:false,error:{kind:'cancelled'}});cancelled=false;expect(stream.value.next()).toEqual(fail);expect(stream.value.diagnostics().generated).toBe(1);
  expect(generateSourceBouncingSeeds(config(),{isCancelled:()=>true})).toMatchObject({ok:false,error:{kind:'cancelled'}});
 });
 it('bounds nested rejection work without changing source512 attempts or accepting fewer particles',()=>{
  const c=config({initial_position_mode:'FORMULA',shape_formula:'0',container_shape:'CIRCLE',boundary_center_x:3,boundary_center_y:3,circle_radius:.01});
  const result=generateSourceBouncingSeeds(c,{workLimit:100});expect(result).toMatchObject({ok:false,error:{kind:'capacity'}});
  expect(createSourceBouncingSeedStream({...c,particleCount:2147483647})).toMatchObject({ok:false,error:{kind:'capacity'}});
  expect(createSourceBouncingSeedStream(c,{workLimit:SOURCE_BOUNCING_SEED_LIMITS.work+1})).toMatchObject({ok:false,error:{kind:'input'}});
 });
});

describe('source Bouncing pre-allocation seed admission',()=>{
 it('exposes the detached count and shared boundary without allocating particles or consuming RNG',()=>{
  const c=config({container_shape:'CIRCLE',boundary_center_x:2,boundary_center_y:3}),baseline=generated(c);
  const draws=vi.spyOn(JavaSourceRandom48.prototype,'nextFloat'),Original=Float32Array;
  let allocations=0;
  vi.stubGlobal('Float32Array',new Proxy(Original,{construct(target,args){allocations++;return Reflect.construct(target,args);}}));
  try{
   const prepared=prepareSourceBouncingSeeds(c);if(!prepared.ok)throw Error(JSON.stringify(prepared.error));
   expect(allocations).toBe(0);expect(draws).not.toHaveBeenCalled();expect(prepared.value.count).toBe(3);
   expect(prepared.value.update).toEqual(baseline.update);expect(Object.isFrozen(prepared.value.update)).toBe(true);
   expect(Object.isFrozen(prepared.value.update.boundary)).toBe(true);expect(Reflect.set(prepared.value.update.boundary,'radius',0)).toBe(false);
   c.initialXMin=99;c.boundaryCenterX=99;c.particleCount=100;
   const result=prepared.value.generate();if(!result.ok)throw Error(JSON.stringify(result.error));
   expect(allocations).toBe(1);expect(result.value.state).toEqual(baseline.state);expect(result.value.diagnostics).toEqual(baseline.diagnostics);
   expect(result.value.update).toBe(prepared.value.update);
   expect(prepared.value.generate()).toMatchObject({ok:false,error:{kind:'input',path:['generate']}});
   expect(allocations).toBe(1);
  }finally{vi.unstubAllGlobals();draws.mockRestore();}
 });
 it('rejects oversized uploads and pre-cancellation before sampling or array allocation',()=>{
  const c=config({container_shape:'CIRCLE'}),draws=vi.spyOn(JavaSourceRandom48.prototype,'nextFloat'),Original=Float32Array;
  let allocations=0;
  vi.stubGlobal('Float32Array',new Proxy(Original,{construct(target,args){allocations++;return Reflect.construct(target,args);}}));
  try{
   expect(prepareSourceBouncingSeeds({...c,particleCount:SOURCE_BOUNCING_SEED_LIMITS.bytes/16+1})).toMatchObject({ok:false,error:{kind:'capacity',reason:expect.stringContaining('128 MiB')}});
   expect(prepareSourceBouncingSeeds(null,{isCancelled:()=>true})).toMatchObject({ok:false,error:{kind:'cancelled'}});
   expect(draws).not.toHaveBeenCalled();expect(allocations).toBe(0);
  }finally{vi.unstubAllGlobals();draws.mockRestore();}
 });
 it('checks cancellation again immediately before one-shot allocation',()=>{
  let cancelled=false;
  const prepared=prepareSourceBouncingSeeds(config(),{isCancelled:()=>cancelled});if(!prepared.ok)throw Error('prepare');
  const Original=Float32Array;let allocations=0;
  vi.stubGlobal('Float32Array',new Proxy(Original,{construct(target,args){allocations++;return Reflect.construct(target,args);}}));
  try{
   cancelled=true;expect(prepared.value.generate()).toMatchObject({ok:false,error:{kind:'cancelled'}});
   cancelled=false;expect(prepared.value.generate()).toMatchObject({ok:false,error:{kind:'input'}});expect(allocations).toBe(0);
  }finally{vi.unstubAllGlobals();}
 });
 it('consumes the generation attempt on work-budget failure and never returns cached partial state',()=>{
  const c=config({initial_position_mode:'FORMULA',shape_formula:'0',container_shape:'CIRCLE',boundary_center_x:3,boundary_center_y:3,circle_radius:.01});
  const prepared=prepareSourceBouncingSeeds(c,{workLimit:100});if(!prepared.ok)throw Error('prepare');
  expect(prepared.value.generate()).toMatchObject({ok:false,error:{kind:'capacity'}});
  expect(prepared.value.generate()).toMatchObject({ok:false,error:{kind:'input'}});
 });
});
