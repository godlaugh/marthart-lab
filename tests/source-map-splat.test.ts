import {describe,it,expect} from 'vitest';
import {parseProjectFile,parseLegacyScene} from '../src/engine/legacyImport';
import {parseScene,serializeScene} from '../src/engine/document';
import {prepareIteratedFrame,visibleIteratedControls} from '../src/scenes/iteratedDensity';
import {sourceMapSplatSettings} from '../src/engine/sourceMapSplat';
import {prepareSourceDensitySplat,sourceDensityPointDiameter,sourceDensitySplatPixelTests} from '../src/engine/sourceDensitySplat';
const F=Math.fround;
const raw=(settings:Record<string,unknown>={})=>({config_version:'1.0.0',type:'MAP_ATTRACTOR',name:'Source coverage',equations:{x_next:'x',y_next:'y'},parameters:{},settings:{batch_size:4,burn_in_steps:0,...settings},timeline:[]});
const project=(settings:Record<string,unknown>={})=>parseProjectFile(JSON.stringify(raw(settings))).scene;
describe('Map source scatter configuration and display boundary',()=>{
 it('keeps the project and direct JSON dot defaults separate',()=>{
  expect(project().settings.pointSize).toBe(1.5);expect(parseLegacyScene(JSON.stringify(raw())).scene.settings.pointSize).toBe(1);
  const p=project({dot_size:'PI/4'}),r=parseLegacyScene(JSON.stringify(raw({dot_size:'PI/4'}))).scene;expect(p.settings.pointSize).toBe(1.5);expect(r.settings.pointSize).toBe(F(Math.PI/4));
 });
 for(const size of [-2,0,.5,1.5,40])it('scales before minimum pixel clamp: '+size,()=>{
  const scene=parseScene(serializeScene(project({dot_size:size}))),job=prepareIteratedFrame(scene,0,0);
  expect(job.densitySplat).toMatchObject({model:'map-splat-1.7.8',dotSize:F(size),displayScale:1,radius:Math.max(1,F(size))});
  const scaled=prepareSourceDensitySplat('map',job.config.pointSize,4);expect(scaled.radius).toBe(Math.max(1,F(F(size)*4)));expect(sourceDensityPointDiameter({...scaled,path:'quad'})).toBe(Math.max(F(scaled.radius*F(.6)),F(.8)));
 });
 it('retains signed metric bounds and applies the constructor Float32 lower span',()=>{
  const scene=project({step_metric_min:-3,step_metric_max:-8,step_metric_normalize_mode:' robust '}),job=prepareIteratedFrame(scene,0,0);
  expect(scene.settings.stepMetricMax).toBe(F(-3+F(.001)));expect(job.config.metricMin).toBe(-3);expect(job.config.metricMax).toBe(F(-3+F(.001)));expect(job.config.metricMode).toBe('robust');
  for(const value of ['CLAMP','unknown','\u00a0ROBUST\u00a0','',3,null])expect(project({step_metric_normalize_mode:value}).settings.stepMetricNormalize).toBe('clamp');
  expect(project({step_metric_normalize_mode:'\u0000robust\t'}).settings.stepMetricNormalize).toBe('robust');
  expect(sourceMapSplatSettings({stepMetricMin:1e20,stepMetricMax:1e20}).metricMax).toBe(F(1e20));
 });
 it('binds native radians, independently from local color/palette settings',()=>{
  const scene=parseScene(serializeScene(project({color_speed:.37,color_phase:213.7,step_metric_min:-2,step_metric_max:3})));scene.settings.iteratedColor='height';scene.palette.cycles=5;
  const cfg=prepareIteratedFrame(scene,0,0).config;expect(cfg.color).toBe('step');expect(cfg.colorSpeed).toBe(F(.37));expect(cfg.colorPhase).toBe(F(F(F(213.7)*F(Math.PI))/180));
 });
 it('versions new imports without migrating prior saved Map scenes',()=>{
  const scene=project(),legacy=structuredClone(scene);delete legacy.settings.mapSplatModel;expect(prepareIteratedFrame(parseScene(serializeScene(legacy)),0,0).densitySplat).toBeUndefined();
  for(const mutate of [(s:typeof scene)=>{s.settings.mapSplatModel='unknown';},(s:typeof scene)=>{delete s.settings.mapMathModel;}]){const bad=structuredClone(scene);mutate(bad);expect(()=>parseScene(serializeScene(bad))).toThrow();}
 });
 it('uses display footprint capacity and exposes source ranges in controls',()=>{
  expect(()=>sourceDensitySplatPixelTests(prepareSourceDensitySplat('map',100000),4)).toThrow('20 亿');
  const scene=project(),controls=visibleIteratedControls('map',scene.settings,['pointSize','stepMetricMin','stepMetricMax','colorSpeed','colorPhase','iteratedColor'].map(key=>({key,label:key,type:'number',group:'density',min:.1,max:32})),scene.timeline,scene.palette);
  expect(controls.find(c=>c.key==='pointSize')!.max).toBeUndefined();expect(controls.find(c=>c.key==='stepMetricMin')!.min).toBeUndefined();expect(controls.find(c=>c.key==='colorSpeed')).toMatchObject({min:.1,max:2});expect(controls.find(c=>c.key==='colorPhase')).toMatchObject({min:0,max:360});expect(controls.some(c=>c.key==='iteratedColor')).toBe(false);
 });
});
