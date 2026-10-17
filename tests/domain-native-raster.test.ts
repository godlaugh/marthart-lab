import {describe,expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {createScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {parseDomainModel} from '../src/engine/domainModel';
import {prepareDomainRaster,domainRasterFragment,MAX_DOMAIN_NATIVE_NODE_STEPS_PER_DRAW} from '../src/engine/domainGpuRaster';
import {DOMAIN_CPU_COLOR_CAPTURE_PLAN} from '../src/engine/domainGpuColor';
import type {DomainGpuColorPlan} from '../src/engine/domainGpuColor';
import type {DomainGpuSource} from '../src/engine/domainExpressions';
const make=()=>{const s=createScene(definition('domain'));s.equations={f:'z+1',next:'sin(w)+c'};Object.assign(s.settings,{domainIterationVersion:'mathart-1.7.8-gpu',domainViewportVersion:'mathart-1.7.8-gpu',iterationEnabled:true,iterationSteps:256,iterationMaxSteps:256,supersampling:3});return s;};
describe('native Domain GPU raster planning',()=>{
 it('bounds native draw work by parsed expression cost and budgets all sample captures',()=>{
  const model=parseDomainModel(make(),0),plan=prepareDomainRaster(model,3840,2160),count=plan.tileWidth*plan.tileHeight;
  expect(model.steps).toBe(256);expect(model.expressionCost).toBeGreaterThan(1);
  expect(plan.estimatedNodeStepsPerDraw).toBe(count*model.expressionCost*model.steps*9);
  expect(plan.estimatedNodeStepsPerDraw).toBeLessThanOrEqual(MAX_DOMAIN_NATIVE_NODE_STEPS_PER_DRAW);
  expect(plan.tileHeight).toBeLessThan(128);expect(plan.attachmentBytes).toBe(3840*2160*8);
  expect(plan.stagingBytes).toBe(count*(8+4+9*16)+plan.color.textureBytes*2);
  expect(plan.estimatedTotalBytes).toBe(plan.stagingBytes+plan.attachmentBytes+3840*2160*4);
 });
 it('retains one indivisible pixel and explicitly reports when its proxy exceeds the target',()=>{
  const model=parseDomainModel(make(),0);model.expressionCost=100000;const plan=prepareDomainRaster(model,17,13);
  expect([plan.tileWidth,plan.tileHeight]).toEqual([1,1]);expect(plan.estimatedNodeStepsPerDraw).toBe(100000*256*9);
  model.expressionCost=0;expect(()=>prepareDomainRaster(model,17,13)).toThrow(/成本事实/);
  model.expressionCost=Number.MAX_SAFE_INTEGER;expect(()=>prepareDomainRaster(model,17,13)).toThrow(/工作量/);
 });
 it('keeps native orbit on GPU when the chosen color contract requires CPU',()=>{
  const s=make();s.settings.domainColorVersion='mathart-1.7.8-cpu';s.evaluatedDomainGradient={running:true,interpolation:'oklch'};
  const model=parseDomainModel(s,0),plan=prepareDomainRaster(model,31,19);
  expect(plan.colorFallbackReason).toMatch(/CPU/);expect(plan.color).toBe(DOMAIN_CPU_COLOR_CAPTURE_PLAN);expect(plan.color.textures).toHaveLength(0);
  model.iterationVersion='mathart-1.7.8';model.execution={...model.execution,version:'mathart-1.7.8',requestedVersion:'mathart-1.7.8',arithmetic:'local'};expect(()=>prepareDomainRaster(model,31,19)).toThrow(/CPU/);
 });
 it('captures actual points and native final values on a local viewport without changing its vertex recipe',()=>{
  const s=make();s.settings.domainViewportVersion='local-v1';const model=parseDomainModel(s,0),plan=prepareDomainRaster(model,257,129);
  expect(plan.capture).toBe(true);expect(plan.nativeExecution).toBe(true);expect(plan.vertexCount).toBe(3);
  expect(plan.attachmentBytes).toBe(plan.tileWidth*plan.tileHeight*8);
  const fragment=domainRasterFragment({fragmentLibrary:'O'} as DomainGpuSource,{source:'C'} as DomainGpuColorPlan,model.view,true);
  expect(fragment).toContain('captureKind==1');expect(fragment).toContain('floatBitsToUint(value.x)');
  expect(fragment).toContain('needsRepair=needsRepair||colorRisk;');expect(fragment).not.toContain('needsRepair=needsRepair||coordinateRisk');
 });
 it('keeps the frozen legacy fragment unchanged when native execution is absent',()=>{
  const fragment=domainRasterFragment({fragmentLibrary:'O'} as DomainGpuSource,{source:'C'} as DomainGpuColorPlan);
  expect(createHash('sha256').update(fragment).digest('hex')).toBe('c635016a7f81b30d0c21869859251fb0d84989adb9bd47d398bb9b2c6a80b9eb');
 });
});
