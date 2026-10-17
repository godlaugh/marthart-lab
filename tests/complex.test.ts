import {describe,it,expect} from 'vitest';
import {compileComplex,compilePolynomial,complexPower,definitions,evaluatePolynomial,solvePolynomial,fractalOrbit,fractalConfig} from '../src/scenes/complex';
import {createScene} from '../src/engine/document';
import type {Complex} from '../src/scenes/complex';
import type {SceneDocument,SceneKind,GenerateContext} from '../src/types';
const context:GenerateContext={time:0,quality:'preview',width:48,height:36};
const scene=(kind:SceneKind):SceneDocument=>createScene(definitions.find(d=>d.kind===kind)!);
const generate=(doc:SceneDocument,ctx=context)=>definitions.find(d=>d.kind===doc.kind)!.generate(doc,ctx);
function close(z:Complex,w:Complex,precision=9){expect(z[0]).toBeCloseTo(w[0],precision);expect(z[1]).toBeCloseTo(w[1],precision);}
describe('restricted complex arithmetic',()=>{
 it('evaluates powers, implicit multiplication and principal values',()=>{
  close(compileComplex('2z+i')({z:[3,-2]}),[6,-3]);close(compileComplex('exp(i*pi)')({}),[-1,0]);
  close(compileComplex('sin(z)^2+cos(z)^2')({z:[.7,.2]}),[1,0]);
  close(compileComplex('sqrt(-1)')({}),[0,1]);close(complexPower([0,0],[0,0]),[1,0]);
  close(compileComplex('atan(1)')({}),[Math.PI/4,0]);close(compileComplex('conj(z)+re(z)+i*im(z)')({z:[2,3]}),[4,0]);
 });
 it('rejects capabilities outside arithmetic and undeclared symbols',()=>{
  for(const text of ['z=2','import("fs")','z.constructor','f(x)=x','[1,2]','constructor(z)','sin(z,2)'])expect(()=>compileComplex(text,['z'])).toThrow();
  expect(()=>compileComplex('z+typo',['z'])).toThrow('未知变量');expect(()=>compileComplex('missing')({})).toThrow('未知变量');
 });
 it('preserves caller-defined e while retaining the natural constant fallback',()=>{close(compileComplex('e')({}),[Math.E,0]);close(compileComplex('e*z',['e','z'])({e:2,z:[0,1]}),[0,2]);close(compilePolynomial('z-e','z',['e'])({e:3})[0],[-3,0]);});
 it('keeps poles nonfinite',()=>{expect(compileComplex('1/z')({z:[0,0]}).every(Number.isFinite)).toBe(false);});
});
describe('polynomial root mathematics',()=>{
 it('extracts complex coefficients from a factored polynomial',()=>{
  const c=compilePolynomial('(z-1)*(z+i)+t*z^3','z',['t'])({t:2});
  const expected:Complex[]=[[0,-1],[-1,1],[1,0],[2,0]];c.forEach((z,i)=>close(z,expected[i]));
 });
 it('finds every cubic root and independently verifies residuals',()=>{
  const c=compilePolynomial('z^3-1')({}),r=solvePolynomial(c);expect(r.converged).toBe(true);expect(r.roots).toHaveLength(3);
  for(const z of r.roots)expect(Math.hypot(...evaluatePolynomial(c,z))).toBeLessThan(1e-7);
  for(let i=0;i<3;i++){const e=[Math.cos(i*Math.PI*2/3),Math.sin(i*Math.PI*2/3)];expect(Math.min(...r.roots.map(z=>Math.hypot(z[0]-e[0],z[1]-e[1])))).toBeLessThan(1e-7);}
 });
 it('handles complex coefficients and repeated roots',()=>{
  const r=solvePolynomial(compilePolynomial('(z-2i)*(z+1)*(z-3)')({}));expect(r.converged).toBe(true);
  for(const e of [[0,2],[-1,0],[3,0]])expect(Math.min(...r.roots.map(z=>Math.hypot(z[0]-e[0],z[1]-e[1])))).toBeLessThan(1e-6);
  expect(solvePolynomial(compilePolynomial('z^4*(z-1)')({})).roots.filter(z=>z[0]===0&&z[1]===0)).toHaveLength(4);
  const c=compilePolynomial('(z-1)^3')({}),repeated=solvePolynomial(c,500,1e-10);expect(repeated.converged).toBe(true);
  for(const z of repeated.roots)expect(Math.hypot(...evaluatePolynomial(c,z))).toBeLessThan(1e-8);
 });
 it('rejects non-polynomials, unbounded degree and zero polynomials',()=>{
  for(const source of ['sin(z)','1/z','z^(-1)','z^1.5','z^100'])expect(()=>compilePolynomial(source)).toThrow();
  expect(()=>solvePolynomial([[0,0],[0,0]])).toThrow('无限');expect(solvePolynomial([[2,0]]).roots).toEqual([]);
 });
 it('reports failure when iteration allowance is insufficient',()=>{
  const r=solvePolynomial(compilePolynomial('z^12+z-1')({}),1,1e-14);expect(r.converged).toBe(false);expect(r.iterations).toBe(1);
 });
});
describe('fractal generation',()=>{
 it('renders a Mandelbrot raster with varied colors',()=>{
  const o=generate(scene('fractal'));expect(o.type).toBe('raster');if(o.type!=='raster')return;
  expect(o.pixels).toHaveLength(48*36*4);expect(o.stats.generated).toBe(48*36);
  expect(new Set(Array.from(o.pixels)).size).toBeGreaterThan(40);expect(o.warnings!.join(' ')).toContain('CPU');
 });
 it('executes every offered 2D formula and coloring algorithm',()=>{
  const doc=scene('fractal'),def=definitions[0];
  for(const item of def.controls.find(c=>c.key==='formula')!.options!){
   if(item.value==='mandelbulb_3d')continue;doc.settings.formula=item.value;doc.settings.power=['newton','nova'].includes(item.value)?3:2;
   const o=generate(doc,{...context,width:12,height:10});expect(o.type).toBe('raster');expect(o.stats.samples,item.value).toBe(120);expect(o.stats.generated+o.stats.invalid).toBe(120);
  }
  doc.settings.formula='mandelbrot';doc.settings.power=2;
  for(const item of def.controls.find(c=>c.key==='outsideColoring')!.options!){doc.settings.outsideColoring=item.value;expect(generate(doc,{...context,width:12,height:10}).stats.generated,item.value).toBeGreaterThan(0);}
 });
 it('matches source-derived one-step recurrences instead of substituting another map',()=>{
  const s=scene('fractal').settings;
  Object.assign(s,{formula:'c_sin',startReal:Math.PI/2,startImag:0,iterations:1});
  close(fractalOrbit([2,3],fractalConfig(s)).z,[2,3]);
  Object.assign(s,{formula:'spiral_septagon',variant:'julia',power:7,juliaReal:-.2,juliaImag:.433,bailout:1e12});
  close(fractalOrbit([1,0],fractalConfig(s)).z,[.8,.433]);
  close(fractalOrbit([0,0],fractalConfig(s)).z,[0,0]);
  Object.assign(s,{formula:'binocular',variant:'mandelbrot',power:4,relaxation:1});
  // At z0=2: (16+4+1)/(2*8-2+1)=21/15.
  close(fractalOrbit([2,0],fractalConfig(s)).z,[1.4,0]);
  s.relaxation=.5;close(fractalOrbit([2,0],fractalConfig(s)).z,[1.7,0]);
 });
 it('returns actual bounded Mandelbulb boundary geometry',()=>{
  const doc=scene('fractal');Object.assign(doc.settings,{formula:'mandelbulb_3d',bulbPresentation:'points',power:8,bulbResolution:16,iterations:12});
  const o=generate(doc);expect(o.type).toBe('geometry');if(o.type!=='geometry')return;
  expect(o.stats.samples).toBe(16**3);expect(o.stats.generated).toBeGreaterThan(10);expect(Array.from(o.positions).every(Number.isFinite)).toBe(true);expect(o.colors!.length).toBe(o.positions.length);
 });
 it('bounds work and handles cancellation and unsupported ids',()=>{
  const doc=scene('fractal');doc.settings.iterations=4096;const o=generate(doc,{...context,width:512,height:512,isCancelled:()=>true});
  expect(o.stats.samples).toBe(0);expect(o.warnings!.join(' ')).toContain('取消');if(o.type==='raster')expect(o.width).toBeLessThan(512);
  doc.settings.formula='unknown_formula';expect(()=>generate(doc)).toThrow('不支持选项');
 });
});
describe('domain and root sampling',()=>{
 it('renders changes in formulas and level curves',()=>{
  const doc=scene('domain'),a=generate(doc);doc.equations.f='1/z';const b=generate(doc);
  if(a.type!=='raster'||b.type!=='raster')throw new Error('raster expected');expect(a.pixels).not.toEqual(b.pixels);expect(a.stats.generated).toBe(48*36);
  doc.settings.curveMode='NONE';const none=generate(doc);if(none.type==='raster')expect(none.pixels).not.toEqual(b.pixels);
 });
 it('counts poles and preserves the raw iterate without applying f a second time',()=>{
  const doc=scene('domain');doc.equations.f='1/z';expect(generate(doc,{...context,width:1,height:1}).stats.invalid).toBe(1);
  doc.equations.f='z';doc.equations.next='w';const a=generate(doc);doc.equations.f='z^2+1';doc.settings.iterationEnabled=true;doc.settings.seedMode='PIXEL_Z';const b=generate(doc);
  if(a.type==='raster'&&b.type==='raster')expect(a.pixels).toEqual(b.pixels);
  doc.settings.seedMode='CONSTANT_C';doc.settings.constantReal=2;const c=generate(doc);
  if(c.type==='raster')expect(new Set(Array.from({length:48*36},(_,i)=>c.pixels.slice(i*4,i*4+3).join(','))).size).toBe(1);
 });
 it('binds iteration c to the pixel for ZERO and CONSTANT_C and to the user constant for PIXEL_Z',()=>{
  for(const [seedMode,expected]of [['ZERO','z'],['CONSTANT_C','2+3i+z'],['PIXEL_Z','z+2+3i']]){
   const doc=scene('domain');Object.assign(doc.settings,{iterationEnabled:true,iterationSteps:1,seedMode,constantReal:2,constantImag:3});doc.equations={f:'z^7',next:'w+c'};
   const actual=generate(doc);doc.settings.iterationEnabled=false;doc.equations.f=expected;const reference=generate(doc);
   expect(actual.stats.invalid).toBe(0);if(actual.type==='raster'&&reference.type==='raster')expect(actual.pixels).toEqual(reference.pixels);
  }
 });
 it('iterates f itself when no next formula is provided',()=>{
  const doc=scene('domain');doc.equations={f:'z+1'};Object.assign(doc.settings,{iterationEnabled:true,iterationSteps:3,seedMode:'PIXEL_Z'});const actual=generate(doc);
  doc.settings.iterationEnabled=false;doc.equations.f='z+3';const expected=generate(doc);if(actual.type==='raster'&&expected.type==='raster')expect(actual.pixels).toEqual(expected.pixels);
 });
 it('samples deterministic true roots for identical seeds',()=>{
  const doc=scene('roots');Object.assign(doc.settings,{sampleCount:50,rootIterations:200});const a=generate(doc),b=generate(doc);
  if(a.type!=='geometry'||b.type!=='geometry')throw new Error('geometry expected');expect(a.positions).toEqual(b.positions);expect(a.stats.generated).toBe(400);
  doc.settings.seed=43;const c=generate(doc);if(c.type==='geometry')expect(c.positions).not.toEqual(a.positions);
 });
 it('filters upper-half roots and maps coefficient depth',()=>{
  const doc=scene('roots');doc.equations.polynomial='z^2+1';Object.assign(doc.settings,{sampleCount:5,filter:'UPPER_HALF',domain2:'FIXED',fixed2Imag:.75,rootRender:'DEPTH',depthScale:2});
  const o=generate(doc);if(o.type!=='geometry')throw new Error('geometry expected');expect(o.stats.generated).toBe(5);
  for(let i=0;i<o.positions.length;i+=3){expect(o.positions[i+1]).toBeGreaterThan(0);expect(o.positions[i+2]).toBe(1.5);}
 });
 it('rejects bad boundaries, symbols and unsupported algorithm combinations',()=>{
  const d=scene('domain');d.settings.scale=0;expect(()=>generate(d)).toThrow();d.settings.scale=1;d.equations.f='unknown+z';expect(()=>generate(d)).toThrow('未知变量');
  const r=scene('roots');r.settings.rangeMin=2;r.settings.rangeMax=1;expect(()=>generate(r)).toThrow('下限');
  const f=scene('fractal');delete f.settings.fractalDistanceVersion;f.settings.formula='newton';f.settings.outsideColoring='distance_estimator';expect(()=>generate(f)).toThrow('仅支持');
 });
});
