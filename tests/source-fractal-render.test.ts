import {afterEach,describe,expect,it,vi} from 'vitest';
import mapping from './fixtures/source-fractal-mapping/source.json';
import {createSourceFractalFormulaFromConfig,type SourceFractalFormulaConfiguration,type SourceFractalFormulaNativeState} from '../src/engine/sourceFractalFormulaRuntime';
import {SourceFractalSceneRuntime} from '../src/engine/sourceFractalSceneRuntime';
import {prepareSourceFractalRenderInput,sourceFractalRenderInput} from '../src/engine/sourceFractalRender';
import {buildFractalSourceReference,parseFractalSourceNativePlan,prepareFractalSourceNativePlan,type FractalSourcePlan} from '../src/engine/fractalSourcePrecision';
import {definitions} from '../src/scenes/complex';
import {createScene} from '../src/engine/document';
import {fractalGpu} from '../src/engine/fractalGpu';
import type {GenerateContext} from '../src/types';

const F=Math.fround;
const view={centerX:2,centerXLow:0,centerY:.1,centerYLow:0,zoom:100,rotation:0};
const size={logicalWidth:9,logicalHeight:7,provenance:'requested-output-local' as const};
const formula=(extra:Partial<SourceFractalFormulaConfiguration>={}):SourceFractalFormulaConfiguration=>({formulaId:'newton',fractalType:'mandelbrot',power:7,formulaParams:[7,.5,11,12],bailout:4,julia:[.1234567890123,-.2345678901234],parameters:{floats:{bailout:F(.001),relaxation:F(.7)},complex:{}},...extra});
const plan=(native:SourceFractalFormulaNativeState,formula:'newton'|'nova'='newton')=>parseFractalSourceNativePlan({formula,native,iterations:8},view,size,{precision:'medium'});
function runtime(config=formula()){
 return new SourceFractalSceneRuntime({formula:config,fps:60,clips:[],gradient:{palette:0,inside:0,outside:0},initial:{...view,rotationRate:0,iterations:8,bailout:4,juliaReal:0,juliaImag:0,ambientAngles:[0,0,0],ambientRates:[0,0,0],currentTime:0}},{reserve(){}});
}
const def=definitions.find(d=>d.kind==='fractal')!,ctx:GenerateContext={time:0,width:9,height:7,quality:'export'};
afterEach(()=>{vi.restoreAllMocks();fractalGpu.dispose();});

describe('mapped source formula render ownership',()=>{
 it('retains the distinct original JNI-observed reference and shader states',()=>{
  let compared=0;
  for(const row of mapping.cases)if(row.input.formula==='newton'||row.input.formula==='nova')for(const step of row.steps){
   const native=step.native as unknown as SourceFractalFormulaNativeState,p=plan(native,row.input.formula);
   expect(p.uniformPower).toBe(native.power);expect(p.formulaParams).toEqual(native.formulaParams);expect(p.dynamicParams).toEqual(native.dynamicParams);
   expect(p.reference.power).toBe(native.power);expect(p.reference.relaxation).toBe(native.formulaParams[1]>0?native.formulaParams[1]:1);
   expect(p.shaderPower).toEqual(native.dynamicParams.slice(0,2));expect(p.shaderRelaxation).toBe(native.dynamicParams[2]);expect(p.sourceJuliaConstant).toEqual(native.julia);compared++;
  }
  expect(compared).toBe(12);
  // Sparse metadata fallback packed shader exponent 3, while the actual mapper
  // retained native power 7. These are independently captured source outputs.
  const observed=mapping.cases.find(row=>row.input.id==='newton-native-round-and-floor')!.steps[0].native as unknown as SourceFractalFormulaNativeState;
  expect(plan(observed)).toMatchObject({shaderPower:[3,0],uniformPower:7,reference:{power:7},perturbation:{enabled:true}});
 });
 it('keeps an absent ParamSet zero shader payload and refuses a default-exponent repair',()=>{
  const native=createSourceFractalFormulaFromConfig(formula({parameters:undefined})).nativeState(),p=plan(native);
  expect(native.power).toBe(7);expect(p.dynamicParams).toEqual(Array(32).fill(0));expect(p.shaderPower).toEqual([0,0]);expect(p.shaderRelaxation).toBe(0);
  expect(p.reference.relaxation).toBe(1);expect(p.perturbation).toMatchObject({enabled:false,reason:'NEWTON_POWER_CONDITION'});expect(buildFractalSourceReference(p).kind).toBe('unavailable');
 });
 it('takes mapped double Julia for both Nova variants and keeps the shader low words',()=>{
  for(const variant of ['mandelbrot','julia'] as const){
   const owner=createSourceFractalFormulaFromConfig(formula({formulaId:'nova',fractalType:variant}));owner.setJuliaConstant(.1234567890123,-.2345678901234);
   const n=owner.nativeState(),p=plan(n,'nova');expect(p.isJulia).toBe(variant==='julia');expect(p.sourceJuliaConstant).toEqual(n.julia);
   expect(p.shaderJuliaConstant).toEqual([F(n.julia[0]),F(n.julia[0]-F(n.julia[0])),F(n.julia[1]),F(n.julia[1]-F(n.julia[1]))]);
   expect(variant==='julia'?p.reference.constant:p.reference.initialZ).toEqual(n.julia.map(v=>[v,0]));
  }
 });
 it('owns every admitted slot and includes changed native inputs in identity',()=>{
  const original=createSourceFractalFormulaFromConfig(formula()).nativeState(),n={...original,dynamicParams:[...original.dynamicParams],formulaParams:[...original.formulaParams] as [number,number,number,number]},p=plan(n),before=JSON.stringify(p);
  n.dynamicParams[31]=12;n.formulaParams[3]=13;expect(JSON.stringify(p)).toBe(before);expect(plan(n).key).not.toBe(p.key);
  expect(Object.isFrozen(p.dynamicParams)).toBe(true);expect(Object.isFrozen(p.formulaParams)).toBe(true);
  for(const bad of [{...n,dynamicParams:n.dynamicParams.slice(0,3)},{...n,formulaParams:[1,2,3]},{...n,dynamicParams:[.1,...n.dynamicParams.slice(1)]}])expect(prepareFractalSourceNativePlan({formula:'newton',native:bad as unknown as SourceFractalFormulaNativeState,iterations:8},view,size,{precision:'high'}).ok).toBe(false);
 });
 it('requires evaluated source state and explicitly rejects formulas without a proven source renderer',()=>{
  expect(prepareSourceFractalRenderInput(undefined)).toMatchObject({ok:false,error:{kind:'input'}});
  for(const id of ['lambda','mandelbulb_3d']){
   const frame=runtime(formula({formulaId:id,parameters:undefined})).snapshot(),before=structuredClone(frame);
   expect(prepareSourceFractalRenderInput(frame)).toMatchObject({ok:false,error:{kind:'unsupported',formulaId:id}});expect(frame).toEqual(before);
  }
 });
 it('public generation consumes the evaluated native frame despite conflicting dormant settings',()=>{
  const config=formula(),r=runtime(config),s=createScene(def);r.clock.step(F(1/60));
  s.fractalSource={model:'mathart-1.7.8-scene-v1',formula:config};s.evaluatedFractalScene={...r.snapshot(),displayFrame:0,simulationFps:60};
  s.settings={...s.settings,...view,formula:'mandelbulb_3d',variant:'bad',power:'invalid',powerImag:'invalid',relaxation:'invalid',bailout:'invalid',tolerance:'invalid',iterations:1000,juliaReal:4,juliaImag:5,fractalNumericProfile:'local-v1',fractalBackend:'webgl2',renderMethod:'one-pass'};
  let seen:FractalSourcePlan|undefined;
  vi.spyOn(fractalGpu,'sample').mockImplementation((points,_w,_h,_v,c,_r,_t,_colors,source)=>{
   seen=source!.plan;expect(c.formula).toBe('newton');expect(c.iterations).toBe(8);expect(c.bailout).toBe(r.snapshot().formula.native.bailout);
   const values=new Float32Array(points.length*4);for(let i=0;i<points.length/2;i++){values[i*8]=1;values[i*8+3]=1;}return{values};
  });
  const before=structuredClone(s),out=def.generate(s,ctx),expected=sourceFractalRenderInput(r.snapshot());
  expect(seen?.formulaParams).toEqual(expected.native.formulaParams);expect(seen?.dynamicParams).toEqual(expected.native.dynamicParams);expect(seen?.reference.power).toBe(7);
  expect(out.type==='raster'&&out.fractalRender?.view.rules.sourceArithmetic).toBe(true);expect(s).toEqual(before);
 });
 it('does not run missing or unsupported evaluated source state through local rendering',()=>{
  const s=createScene(def),sample=vi.spyOn(fractalGpu,'sample');s.fractalSource={model:'mathart-1.7.8-scene-v1',formula:formula()};
  expect(()=>def.generate(s,ctx)).toThrow('时间线求值');
  s.evaluatedFractalScene={...runtime(formula({formulaId:'lambda',parameters:undefined})).snapshot(),displayFrame:0,simulationFps:60};
  expect(()=>def.generate(s,ctx)).toThrow('渲染尚未验证');expect(sample).not.toHaveBeenCalled();
 });
});
