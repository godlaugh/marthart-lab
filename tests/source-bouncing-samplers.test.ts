import {describe,it,expect} from 'vitest';
import {createSourceBouncingSampler,type SourceBouncingSamplerConfiguration} from '../src/engine/sourceBouncingSamplers';
import {importSourceBouncingConfig,SOURCE_BOUNCING_POSITION_MODES} from '../src/engine/sourceBouncingConfig';
import {JavaSourceRandom48} from '../src/engine/javaSourceRandom';
import {prepareSourceRealExpression} from '../src/engine/domainSourceScalar';
const F=Math.fround;
function configuration(patch:Partial<SourceBouncingSamplerConfiguration>={}):SourceBouncingSamplerConfiguration{const r=importSourceBouncingConfig({});if(!r.ok)throw Error('defaults');return{...r.value.configuration,...patch};}
function sampler(patch:Partial<SourceBouncingSamplerConfiguration>={}){const r=createSourceBouncingSampler(configuration(patch));if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;}
class ControlledRandom extends JavaSourceRandom48{
 floatCalls=0;doubleCalls=0;
 constructor(readonly floatValue:number,readonly doubleValues:number[]=[0]){super(1n);}
 override nextFloat(){this.floatCalls++;return this.floatValue;}
 override nextDouble(){const value=this.doubleValues[this.doubleCalls%this.doubleValues.length];this.doubleCalls++;return value;}
}

describe('source Bouncing sampler budgets and source exceptional semantics',()=>{
 it.each(SOURCE_BOUNCING_POSITION_MODES)('%s cancellation precedes its first RNG draw and is not swallowed',initialPositionMode=>{
  const rng=new JavaSourceRandom48(8n),before=rng.state48,marker=new Error('caller cancelled');
  expect(()=>sampler({initialPositionMode,shapeFormula:'x+y>0'}).sample(rng,{consume(){throw marker;}})).toThrow(marker);
  expect(rng.state48).toBe(before);
 });
 it('charges every inner rejected candidate and retains the 512-attempt center result',()=>{
  for(const initialPositionMode of ['HEART','INFINITY','FORMULA'] as const){
   const rng=new ControlledRandom(0),work:number[]=[];
   const actual=sampler({initialPositionMode,initialCircleCenterX:3,initialCircleCenterY:-2,shapeFormula:'0'}).sample(rng,{consume:n=>work.push(n)});
   expect(actual).toEqual([3,-2]);
   expect(rng.floatCalls).toBe(initialPositionMode==='FORMULA'?0:1024);expect(rng.doubleCalls).toBe(initialPositionMode==='FORMULA'?1024:0);
   expect(work).toEqual(Array(initialPositionMode==='FORMULA'?1024:512).fill(1));
  }
 });
 it('interrupts within an inner rejection loop without returning a repaired center',()=>{
  const rng=new ControlledRandom(0),marker=new Error('capacity');let work=0;
  expect(()=>sampler({initialPositionMode:'HEART'}).sample(rng,{consume:n=>{work+=n;if(work>3)throw marker;}})).toThrow(marker);
  expect(rng.floatCalls).toBe(6);
 });
 it('charges both formula ASTs separately, with caller failures outside native evaluate catch',()=>{
  const expr=prepareSourceRealExpression('x*x+y*y',['x','y']);if(!expr.ok)throw Error('expression');
  const rng=new ControlledRandom(0,[.25,.5]),work:number[]=[];
  sampler({initialPositionMode:'FORMULA',shapeFormula:'x*x+y*y>=0'}).sample(rng,{consume:n=>work.push(n)});
  expect(work).toEqual([1,expr.value.operations,1]);
  const marker=new Error('AST budget');let calls=0;
  expect(()=>sampler({initialPositionMode:'FORMULA',shapeFormula:'x>=0'}).sample(rng,{consume(){if(++calls===3)throw marker;}})).toThrow(marker);
 });
 it('distinguishes empty predicate, whitespace-zero, and IEEE nonfinite comparisons',()=>{
  for(const [shapeFormula,draws]of [['',2],[' ',1024],['0/0',2],['0/0==0/0',1024],['0/0!=0/0',2],['0/0>0',1024],['0/0<0',1024],['0/0>=0',1024],['0/0<=0',1024]] as const){
   const rng=new ControlledRandom(0,[.25,.5]);sampler({initialPositionMode:'FORMULA',shapeFormula}).sample(rng);expect(rng.doubleCalls,shapeFormula).toBe(draws);
  }
 });
 it('reports formula compilation errors and capacity, rather than permissive evaluate fallback',()=>{
  for(const shapeFormula of ['x+','z','>=0','x<0>=1','sin('])expect(createSourceBouncingSampler(configuration({initialPositionMode:'FORMULA',shapeFormula}))).toMatchObject({ok:false,error:{kind:'input',path:['shapeFormula']}});
  expect(createSourceBouncingSampler(configuration({initialPositionMode:'FORMULA',shapeFormula:'x'.repeat(65537)}))).toMatchObject({ok:false,error:{kind:'capacity',path:['shapeFormula']}});
  expect(createSourceBouncingSampler(configuration({initialPositionMode:'BOX',shapeFormula:'bad('})).ok).toBe(true);
 });
 it('evaluates world coordinates, and outline jitter is a separate Float32 add after predicate success',()=>{
  const rng=new ControlledRandom(0,[0,.25,.75,0]);
  const result=sampler({initialPositionMode:'FORMULA',initialCircleCenterX:2,initialCircleCenterY:3,initialCircleRadius:1,shapeFormula:'x>2',shapeFillMode:'OUTLINE',shapeLineWidth:1}).sample(rng);
  expect(result).toEqual([2.625,2.75]);expect(rng.doubleCalls).toBe(4);
 });
 it('keeps BOX/ARCHIMEDEAN identical, with two nextFloat draws even for degenerate bounds',()=>{
  const box=sampler(),arch=sampler({initialPositionMode:'ARCHIMEDEAN_SPIRAL'}),r1=new JavaSourceRandom48(19n),r2=r1.clone();
  for(let i=0;i<20;i++)expect(arch.sample(r2)).toEqual(box.sample(r1));expect(r1.state48).toBe(r2.state48);
  const rng=new ControlledRandom(.25);expect(sampler({initialXMin:2,initialXMax:2,initialYMin:3,initialYMax:3}).sample(rng)).toEqual([2,3]);expect(rng.floatCalls).toBe(2);
 });
 it.each(['SPIRAL','LISSAJOUS','ROSE','SUPERELLIPSE','HYPOCYCLOID','EPICYCLOID'] as const)('%s consumes the native discarded fill draw even at zero radius',initialPositionMode=>{
  const fill=new ControlledRandom(0,[.1,.2,.3]),outline=new ControlledRandom(0,[.1,.2,.3]);
  sampler({initialPositionMode,initialCircleRadius:0}).sample(fill);
  sampler({initialPositionMode,initialCircleRadius:0,shapeFillMode:'OUTLINE'}).sample(outline);
  expect(fill.doubleCalls).toBe(initialPositionMode==='SPIRAL'?2:3);expect(outline.doubleCalls).toBe(2);
 });
 it('preserves the native heart outline inversion and superellipse exponent, including generated NaN',()=>{
  expect(sampler({initialPositionMode:'HEART',shapeFillMode:'OUTLINE',initialCircleRadius:1}).sample(new ControlledRandom(0,[0,.5]))).toEqual([0,F(-.25)]);
  const square=sampler({initialPositionMode:'SUPERELLIPSE',shapeFillMode:'OUTLINE',initialCircleRadius:1,shapeSuperellipseN:2}).sample(new ControlledRandom(0,[.125,.5]));
  expect(square).toEqual([1,1]);
  const nonfinite=sampler({initialPositionMode:'SUPERELLIPSE',shapeFillMode:'FILL',shapeSuperellipseN:4}).sample(new ControlledRandom(0,[0,.5,0]));
  expect(Number.isNaN(nonfinite[1])).toBe(true);
 });
 it.each(SOURCE_BOUNCING_POSITION_MODES)('%s emits rounded float coordinates without changing source configuration',initialPositionMode=>{
  const config=configuration({initialPositionMode}),copy=structuredClone(config),r=createSourceBouncingSampler(config);if(!r.ok)throw Error('compile');
  const result=r.value.sample(new JavaSourceRandom48(-9223372036854775808n));expect(result.map(F)).toEqual(result);expect(config).toEqual(copy);
 });
});
