import {afterEach,describe,expect,it,vi} from 'vitest';
import {createScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {generateDomain} from '../src/engine/domain';
import {domainControlSettings,domainEvaluator,parseDomainModel,shadeDomainValue,visibleDomainControls} from '../src/engine/domainModel';
import {domainGpu} from '../src/engine/domainGpu';
import {prepareDomainGpuColor} from '../src/engine/domainGpuColor';
import type {DomainSourceColorVersion} from '../src/engine/domainSourceColor';
import type {ControlSpec} from '../src/types';

const make=(version:DomainSourceColorVersion)=>{
 const s=createScene(definition('domain'));s.equations={f:'z'};s.parameters={};s.timeline.tracks=[];
 Object.assign(s.settings,{domainBackend:'cpu',domainColorVersion:version,curveMode:'NONE',curveMix:0,curveBias:0});
 s.domainSourcePalette={colors:['#ffffff']};return s;
};
afterEach(()=>vi.restoreAllMocks());

describe('explicit source-color Domain production boundary',()=>{
 it('keeps missing and explicit local-v1 colors and iteration behavior identical',()=>{
  const s=createScene(definition('domain'));s.equations={f:'sin(z)+z/3',next:'missing'};s.settings.domainBackend='cpu';
  const before=generateDomain(s,{time:.25,width:27,height:19,quality:'export'});s.settings.domainColorVersion='local-v1';
  const after=generateDomain(s,{time:.25,width:27,height:19,quality:'export'});
  expect(before.type).toBe('raster');expect(after.type).toBe('raster');
  if(before.type==='raster'&&after.type==='raster')expect(after.pixels).toEqual(before.pixels);
  expect(parseDomainModel(s,0)).toMatchObject({colorVersion:'local-v1',iteration:false,steps:12});
 });
 it('does not fade zero magnitude or discard source-colored poles as background',()=>{
  for(const version of['mathart-1.7.8-gpu','mathart-1.7.8-cpu'] as const){
   const s=make(version);s.equations.f='0';
   const zero=generateDomain(s,{time:0,width:5,height:3,quality:'export'});
   expect(zero.stats).toMatchObject({samples:15,generated:15,invalid:0});
   if(zero.type==='raster')expect([...zero.pixels]).toEqual(Array.from({length:60},()=>255));
   s.equations.f='1/(z-z)';const pole=generateDomain(s,{time:0,width:5,height:3,quality:'export'});
   expect(pole.stats).toMatchObject({samples:15,generated:15,invalid:0});
   if(pole.type==='raster')expect(pole.pixels[3]).toBe(255);
  }
 });
 it('keeps the selected source coloring during complete CPU numerical repair',()=>{
  for(const version of['mathart-1.7.8-gpu','mathart-1.7.8-cpu'] as const){
   const s=make(version);s.domainSourcePalette={colors:['#f31d78','#12a0cb']};s.settings.curveMode='PHASE_MODULUS';s.settings.curveMix=.7;s.settings.curveBias=-.15;s.equations.f='sin(z)';
   const context={time:0,width:11,height:9,quality:'export' as const},cpu=generateDomain(s,context);
   vi.spyOn(domainGpu,'render').mockImplementation((model,w,h,_pixels,repair)=>{
    expect(model.colorVersion).toBe(version);let generated=0,invalid=0;
    for(let i=0;i<w*h;i++){const valid=repair(i);if(valid)generated++;else invalid++;}
    return{samples:w*h,generated,invalid,invalidSamples:invalid,repaired:w*h,tiles:1,readbackBytes:w*h*8,estimatedScratchBytes:524288};
   });
   s.settings.domainBackend='gpu';const repaired=generateDomain(s,context);
   expect(repaired.backend).toBe('cpu');
   if(cpu.type==='raster'&&repaired.type==='raster')expect(repaired.pixels).toEqual(cpu.pixels);
   vi.restoreAllMocks();
  }
 });
 it('executes one selected seed/next step even when source iteration is disabled',()=>{
  const s=make('mathart-1.7.8-gpu');s.equations={f:'99z',next:'w+c+z'};
  Object.assign(s.settings,{domainIterationVersion:'mathart-1.7.8',iterationEnabled:false,iterationSteps:999,iterationMaxSteps:999,seedMode:'ZERO',constantReal:2,constantImag:3});
  let m=parseDomainModel(s,0);expect(m).toMatchObject({iteration:true,steps:1});expect(domainEvaluator(m)([4,5])).toEqual([8,10]);
  s.equations={f:'z+1'};s.settings.iterationEnabled=true;s.settings.iterationSteps=65;s.settings.iterationMaxSteps=100;
  m=parseDomainModel(s,0);expect(m.steps).toBe(65);expect(domainEvaluator(m)([4,5])).toEqual([65,0]);
 });
 it('never activates a dormant next expression merely by changing color versions',()=>{
  const s=make('mathart-1.7.8-gpu');s.equations={f:'z+1',next:'w+100'};s.settings.seedMode='ZERO';s.settings.iterationEnabled=false;
  for(const colorVersion of['local-v1','mathart-1.7.8-gpu','mathart-1.7.8-cpu']){
   s.settings.domainColorVersion=colorVersion;delete s.settings.domainIterationVersion;
   expect(domainEvaluator(parseDomainModel(s,0))([2,3])).toEqual([3,3]);
   s.settings.domainIterationVersion='mathart-1.7.8';expect(domainEvaluator(parseDomainModel(s,0))([2,3])).toEqual([100,0]);
  }
 });
 it('keeps inactive local palette/grid settings and uses separate source palette facts',()=>{
  const s=make('mathart-1.7.8-gpu');s.settings.complexGrid=true;s.settings.gridSpacing=1e-40;s.palette.mode='curve';s.palette.offset=100;s.palette.cycles=17;
  const m=parseDomainModel(s,0),color=shadeDomainValue([1,1],[0,0],m,10);
  expect(m.grid).toBe(false);expect(color).toEqual([1,1,1]);expect(s.settings.complexGrid).toBe(true);expect(s.palette.mode).toBe('curve');
  const plan=prepareDomainGpuColor(m,10);expect(plan).toHaveProperty('plan');
 });
 it('shows source authoring ranges without modifying imported values or hiding the active seed',()=>{
  const controls:ControlSpec[]=['phaseDensity','phaseSharpness','iterationSteps','iterationMaxSteps','seedMode','complexGrid','gridSpacing'].map(key=>({key,label:key,group:'',type:'number',min:0,max:1}));
  const settings={domainColorVersion:'mathart-1.7.8-gpu',domainIterationVersion:'mathart-1.7.8',phaseDensity:1e-8,iterationEnabled:false},before=JSON.stringify(settings),visible=visibleDomainControls(controls,settings);
  expect(visible.find(c=>c.key==='phaseDensity')).toMatchObject({min:.5,max:30});expect(visible.some(c=>c.key==='seedMode')).toBe(true);
  expect(visible.some(c=>c.key==='complexGrid'||c.key==='gridSpacing'||c.key==='iterationSteps')).toBe(false);expect(JSON.stringify(settings)).toBe(before);
 });
 it('adds the source maximum-step control to actual scene controls and supplies display-only defaults',()=>{
  const controls=definition('domain').controls,settings={domainIterationVersion:'mathart-1.7.8',iterationEnabled:true};
  expect(controls.some(c=>c.key==='iterationMaxSteps')).toBe(false);
  const visible=visibleDomainControls(controls,settings);
  expect(visible.find(c=>c.key==='iterationMaxSteps')).toMatchObject({type:'number',min:1,max:256,step:1});
  expect(domainControlSettings(settings)).toMatchObject({iterationSteps:1,iterationMaxSteps:64});
  expect(settings).not.toHaveProperty('iterationMaxSteps');
  expect(domainControlSettings({...settings,iterationSteps:999,iterationMaxSteps:999})).toMatchObject({iterationSteps:999,iterationMaxSteps:999});
  expect(visibleDomainControls(visible,{iterationEnabled:true}).some(c=>c.key==='iterationMaxSteps')).toBe(false);
  expect(visibleDomainControls(controls,{...settings,iterationEnabled:false}).some(c=>c.key==='iterationMaxSteps')).toBe(false);
 });
});
