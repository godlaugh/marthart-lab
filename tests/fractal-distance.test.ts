import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import type {Complex} from '../src/engine/complexMath';
import {fractalConfig,fractalOrbit,definitions} from '../src/scenes/complex';
import {doubleDoubleOrbit} from '../src/engine/fractalPrecision';
import {dc} from '../src/engine/doubleDouble';
import {createScene} from '../src/engine/document';
import {parseFractalColors,shadeFractalOrbit} from '../src/engine/fractalColor';
import {
 FRACTAL_DISTANCE_VERSION,advanceFractalDistance,beginFractalDistance,estimateFractalDistance,
 finishFractalDistance,fractalDistanceCapability,fractalDistanceColorIndex,normalizeFractalDistancePower,
 parseFractalDistanceVersion,prepareFractalDistance,stepFractalDistanceDerivative,supportsSourceFractalDistance,
 type FractalDistanceEstimate,type FractalDistancePlan,
} from '../src/engine/fractalDistance';

type Scalar=number|'NaN'|'Infinity'|'-Infinity';
type Pair=[Scalar,Scalar];
interface CapabilityCase {
 id:string;input:{formula:string;powerF:number;effectivePowerF:number;p:number;formulaType:number;needsDistanceEstimator:boolean};
 expected:{isIntegerPower:boolean;capable:boolean};
}
interface DistanceExpected {valid:boolean;value:Scalar;valueBits?:string;reason?:string;}
interface OrbitCase {
 id:string;input:{p:number;julia:boolean;zHighSteps:Pair[];finalZHigh:Pair;path:'ordinary'|'perturbation';capable:boolean;escaped:boolean};
 expected:{derivative:Pair;derivativeBits:string[];derivativeTrace:Pair[];distance:DistanceExpected};
}
interface TerminalCase {
 id:string;input:{p:number;finalZHigh:Pair;derivative:Pair;capable:boolean;escaped:boolean};expected:DistanceExpected;
}
interface ColorCase {
 id:string;input:{escaped:boolean;distanceValid:boolean;distance:number;finalZHigh:Pair;iteration:number;distancePower:number;exitKind:0|1|2;residualSquared:number};
 expected:{packedP0:number[];route:string;index:number;indexBits:string};
}
const fixture=JSON.parse(readFileSync(new URL('./fixtures/fractal/de-source-reference.json',import.meta.url),'utf8')) as {
 capabilities:CapabilityCase[];orbits:OrbitCase[];terminalDistances:TerminalCase[];colorIndices:ColorCase[];
};
const scalar=(value:Scalar):number=>typeof value==='number'?value:Number(value);
const pair=(value:Pair):Complex=>[scalar(value[0]),scalar(value[1])];
const bits=(value:number):string=>{const data=new DataView(new ArrayBuffer(4));data.setFloat32(0,value,false);return data.getUint32(0,false).toString(16).padStart(8,'0');};
function checkEstimate(actual:FractalDistanceEstimate,expected:DistanceExpected){
 expect(actual.valid).toBe(expected.valid);expect(actual.value).toBe(scalar(expected.value));
 if(expected.valueBits)expect(bits(actual.value)).toBe(expected.valueBits);
 if(expected.reason)expect(actual).toHaveProperty('reason',expected.reason);
}
function plan(input:OrbitCase['input']):FractalDistancePlan {
 return {version:FRACTAL_DISTANCE_VERSION,requested:true,julia:input.julia,
  capability:{supported:input.capable,power:input.p,powerF:input.p,isIntegerPower:true,...(input.capable?{}:{reason:'unsupported-formula' as const})}};
}

describe('source Fractal DE independent static-reference vectors',()=>{
 // The JSON was generated from retained shader text in an independent Python
 // transcription. These CPU F32 checks do not claim driver transcendental or
 // native DS bit parity; the separate real-GL verifier owns that comparison.
 it.each(fixture.capabilities)('source capability: $id',({input,expected})=>{
  expect(supportsSourceFractalDistance({formula:input.formula,formulaType:input.formulaType,powerF:input.powerF,p:input.p,requested:input.needsDistanceEstimator})).toBe(expected.capable);
  expect(Math.fround(input.powerF)).toBe(input.effectivePowerF);
 });
 it.each(fixture.orbits)('prescribed source high-component sequence: $id',({input,expected})=>{
  const state=beginFractalDistance(plan(input),input.path)!;
  let derivative:Complex=input.julia?[1,0]:[0,0];
  input.zHighSteps.forEach((sample,index)=>{
   if(input.capable)derivative=stepFractalDistanceDerivative(derivative,pair(sample),input.p,input.julia);
   advanceFractalDistance(state,pair(sample));
   expect(derivative).toEqual(pair(expected.derivativeTrace[index]));expect(state.derivative).toEqual(derivative);
  });
  expect(derivative).toEqual(pair(expected.derivative));expect(derivative.map(bits)).toEqual(expected.derivativeBits);
  const facts=finishFractalDistance(state,{finalZHigh:pair(input.finalZHigh),iteration:input.zHighSteps.length-1,exitKind:input.escaped?1:0,residualSquared:0})!;
  expect(facts.path).toBe(input.path);expect(facts.derivative).toEqual(derivative);
  checkEstimate(facts.estimate,expected.distance);
 });
 it.each(fixture.terminalDistances)('terminal DE validity: $id',({input,expected})=>{
  checkEstimate(estimateFractalDistance({power:input.p,capable:input.capable,escaped:input.escaped,finalZHigh:pair(input.finalZHigh),derivative:pair(input.derivative)}),expected);
 });
 it.each(fixture.colorIndices)('DE packed-p0 coloring: $id',({input,expected})=>{
  const estimate:FractalDistanceEstimate=input.distanceValid?{valid:true,value:input.distance}:{valid:false,value:0,reason:'invalid-distance'};
  const value=fractalDistanceColorIndex({estimate,exitKind:input.escaped?input.exitKind:0,iteration:input.iteration,finalZHigh:pair(input.finalZHigh),residualSquared:input.residualSquared},input.distancePower);
  expect(value).toBe(expected.index);expect(bits(value)).toBe(expected.indexBits);
  expect(normalizeFractalDistancePower(input.distancePower)).toBe(expected.packedP0[2]);
 });
});

describe('DE version and shared state boundary',()=>{
 it('requires an explicit version and independent colors, preserving the omitted legacy route',()=>{
  const input={formula:'mandelbrot',power:[2,0] as Complex,variant:'mandelbrot'};
  expect(parseFractalDistanceVersion(undefined)).toBeUndefined();expect(prepareFractalDistance({},input)).toBeUndefined();
  expect(()=>parseFractalDistanceVersion(null)).toThrow('Unsupported');expect(()=>parseFractalDistanceVersion('other')).toThrow('Unsupported');
  expect(()=>prepareFractalDistance({fractalDistanceVersion:FRACTAL_DISTANCE_VERSION},input)).toThrow('fractalColorVersion 2');
  const settings={fractalDistanceVersion:FRACTAL_DISTANCE_VERSION,fractalColorVersion:2,insideColoring:'distance_estimator',outsideColoring:'none'};
  const copy=structuredClone(settings),prepared=prepareFractalDistance(settings,input)!;
  expect(prepared).toMatchObject({requested:true,julia:false,capability:{supported:true,power:2}});expect(settings).toEqual(copy);
 });
 it('retains unsupported selection as an invalid DE state and avoids unrequested state',()=>{
  const settings={fractalDistanceVersion:FRACTAL_DISTANCE_VERSION,fractalColorVersion:2,outsideColoring:'distance_estimator'};
  const prepared=prepareFractalDistance(settings,{formula:'newton',power:[3,2],variant:'mandelbrot'})!;
  expect(prepared).toMatchObject({requested:true,capability:{supported:false,reason:'unsupported-formula'}});
  const state=beginFractalDistance(prepared)!;advanceFractalDistance(state,[1,1]);expect(state.derivative).toEqual([0,0]);
  expect(finishFractalDistance(state,{finalZHigh:[2,0],iteration:1,exitKind:2,residualSquared:.01})?.estimate).toEqual({valid:false,value:0,reason:'capability-disabled'});
  expect(beginFractalDistance({...prepared,requested:false})).toBeUndefined();expect(beginFractalDistance()).toBeUndefined();
 });
 it('separates local complex-power extension from source near-integer float ingress and transform type',()=>{
  expect(fractalDistanceCapability({formula:'mandelbrot',power:[2,1e-30]})).toMatchObject({supported:false,reason:'complex-power'});
  expect(fractalDistanceCapability({formula:'binocular',power:[4,0]})).toMatchObject({supported:true});
  expect(fractalDistanceCapability({formula:'mandelbrot',power:[2,0],formulaType:1})).toMatchObject({supported:false,reason:'formula-type'});
  expect(fractalDistanceCapability({formula:'mandelbrot',power:[2+2**-20,0]})).toMatchObject({supported:true,power:2});
  expect(fractalDistanceCapability({formula:'mandelbrot',power:[2+5*2**-22,0]})).toMatchObject({supported:false,reason:'non-integer-power'});
 });
 it('normalizes native color power at float ingress without imposing the old UI maximum',()=>{
  for(const raw of [NaN,Infinity,-Infinity,1e100,-1,0,1])expect(normalizeFractalDistancePower(raw)).toBe(2);
  expect(normalizeFractalDistancePower(1000.125)).toBe(1000.125);
  expect(normalizeFractalDistancePower(2.123456789)).toBe(Math.fround(2.123456789));
 });
 it('keeps terminal facts stable when the owner advances to a later frame',()=>{
  const state=beginFractalDistance(plan(fixture.orbits[0].input))!;advanceFractalDistance(state,[0,0]);
  const facts=finishFractalDistance(state,{finalZHigh:[2,0],iteration:0,exitKind:1,residualSquared:0})!;
  advanceFractalDistance(state,[2,0]);expect(facts.derivative).toEqual([1,0]);expect(state.derivative).toEqual([5,0]);
 });
 it('keeps inside zero ahead of invalid estimates and convergence fallback independent of DE power',()=>{
  const facts={estimate:{valid:false,value:0,reason:'invalid-distance'} as FractalDistanceEstimate,exitKind:0 as const,iteration:4,finalZHigh:[NaN,NaN] as Complex,residualSquared:NaN};
  expect(fractalDistanceColorIndex(facts,2)).toBe(0);
  const converged={...facts,exitKind:2 as const,residualSquared:.01};
  expect(fractalDistanceColorIndex(converged,2)).toBe(fractalDistanceColorIndex(converged,1000));
 });
});

describe('CPU and DD production bridges',()=>{
 const settings={fractalDistanceVersion:FRACTAL_DISTANCE_VERSION,fractalColorVersion:2,outsideColoring:'distance_estimator'};
 it.each(['double','double-double'] as const)('%s executes the ordinary derivative update before each recurrence',backend=>{
  const config=fractalConfig({...settings,formula:'mandelbrot',iterations:8,power:2,bailout:4});
  const orbit=backend==='double'?fractalOrbit([2,0],config):doubleDoubleOrbit(dc(2,0),config);
  // Exact short integer orbit: 0 -> 2 -> 6, D: 0 -> 1 -> 5.
  const expected=fixture.orbits.find(v=>v.id==='mandel-p2-ordinary-c2')!;
  expect(orbit).toMatchObject({count:2,z:[6,0],inside:false,invalid:false,derivative:[5,0]});
  expect(orbit.distance).toMatchObject({path:'ordinary',iteration:1,exitKind:1,finalZHigh:[6,0]});
  checkEstimate(orbit.distance!.estimate,expected.expected.distance);
 });
 it('uses the DD high word as its binary32 bridge, excluding a retained low residual',()=>{
  const config=fractalConfig({...settings,formula:'julia',juliaReal:0,juliaImag:0,power:2,iterations:1,bailout:1.5});
  // A normalized DD input just above a float32 midpoint. Its nonzero low
  // residual belongs to the DD orbit, while source-DE consumes the high word.
  const high=2+2**-23,low=2**-52,point=dc(high,0,low,0);
  expect(point[0]).toEqual([high,low]);
  const orbit=doubleDoubleOrbit(point,config);
  expect(orbit.derivative).toEqual([4,0]);
  expect(orbit.distance).toMatchObject({iteration:0,exitKind:1,finalZHigh:[Math.fround(high*high),0]});
 });
 it.each(['double','double-double'] as const)('%s keeps bounded orbits inside with no valid terminal DE',backend=>{
  const config=fractalConfig({...settings,insideColoring:'distance_estimator',iterations:3});
  const orbit=backend==='double'?fractalOrbit([0,0],config):doubleDoubleOrbit(dc(0,0),config);
  expect(orbit).toMatchObject({inside:true,count:3,distance:{exitKind:0,iteration:2,estimate:{valid:false,value:0,reason:'not-escaped'}}});
  expect(fractalDistanceColorIndex(orbit.distance!,2)).toBe(0);
 });
 it('keeps the existing convergence classification while supplying explicit unsupported-DE facts',()=>{
  const legacy=fractalConfig({...settings,formula:'newton',power:2,iterations:4,convergenceMode:'legacy'});
  const step=fractalConfig({...settings,formula:'newton',power:2,iterations:4,convergenceMode:'step'});
  for(const evaluate of [(c:typeof legacy)=>fractalOrbit([1,0],c),(c:typeof legacy)=>doubleDoubleOrbit(dc(1,0),c)]){
   const old=evaluate(legacy),modern=evaluate(step);
   expect(old).toMatchObject({inside:true,converged:true,count:0,distance:{exitKind:0,iteration:0}});
   expect(modern).toMatchObject({inside:false,converged:true,count:1,distance:{exitKind:2,iteration:0}});
   expect(old.distance!.estimate).toEqual({valid:false,value:0,reason:'capability-disabled'});
   expect(modern.distance!.estimate).toEqual(old.distance!.estimate);
  }
 });
 it('uses producer validity and DE packing without consuming dormant Smooth settings',()=>{
  const scene=createScene(definitions.find(d=>d.kind==='fractal')!);
  Object.assign(scene.settings,settings,{formula:'phoenix',iterations:8,bailout:1.5,fractalBackend:'cpu',renderMethod:'one-pass',centerX:2,centerY:0});
  const config=fractalConfig(scene.settings),orbit=fractalOrbit([2,0],config);
  expect(orbit).toMatchObject({z:[2,0],count:1,inside:false,distance:{exitKind:1,iteration:0,estimate:{valid:false,reason:'capability-disabled'}}});
  const original=shadeFractalOrbit(orbit,config,parseFractalColors(scene));
  expect(original).toBeDefined();
  Object.assign(scene.settings,{outsideSmoothSource:'complex',outsideSmoothReal:17,outsideSmoothImag:3,outsideSmoothPower:50,outsideSmoothBailout:100});
  expect(shadeFractalOrbit(orbit,config,parseFractalColors(scene))).toEqual(original);
  expect(()=>shadeFractalOrbit({...orbit,distance:undefined},config,parseFractalColors(scene))).toThrow('producer facts');
  const definition=definitions.find(d=>d.kind==='fractal')!;
  const output=definition.generate(scene,{quality:'export',width:1,height:1,time:0});
  expect(output.type).toBe('raster');expect(output.stats.invalid).toBe(0);
  delete scene.settings.fractalDistanceVersion;
  expect(()=>definition.generate(scene,{quality:'export',width:1,height:1,time:0})).toThrow('仅支持');
 });
 it('leaves derivative and color behavior on the legacy route when version is omitted',()=>{
  const config=fractalConfig({formula:'mandelbrot',iterations:8,power:2,bailout:4,outsideColoring:'distance_estimator',fractalColorVersion:2});
  const orbit=fractalOrbit([2,0],config);
  expect(config.distance).toBeUndefined();expect(orbit.distance).toBeUndefined();expect(orbit.derivative).toEqual([5,0]);
 });
});
