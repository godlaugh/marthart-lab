import {describe,it,expect} from 'vitest';
import {parseProjectFile} from '../src/engine/legacyImport';
import {parseScene,serializeScene} from '../src/engine/document';
import {prepareIteratedFrame,visibleIteratedControls} from '../src/scenes/iteratedDensity';
import {prepareSourceDensitySplat,sourceDensityPointDiameter,sourceDensitySplatPixelTests} from '../src/engine/sourceDensitySplat';
import {sceneAtTime} from '../src/engine/timeline';
import {ordinarySourceCameraFrame,prepareOrdinarySourceFrame} from '../src/engine/ordinarySourceCamera';
import {writeSourceSymmetryPointSize} from '../src/engine/sourceSymmetryConfig';
import nativeCold from './fixtures/symmetry/cold-runtime-20261025.json';

const load=(dot_size:number)=>parseProjectFile(JSON.stringify({config_version:'1.0.0',name:'Source dot',type:'SYMMETRY_CHAOS',settings:{dot_size,batch_size:8,burn_in_steps:0}})).scene;
describe('Symmetry source point-size consumer',()=>{
 it.each([-2,0,.01,1.5,40,100000])('retains author %s across reopen; only the hot setter changes runtime point size',value=>{
  const scene=parseScene(serializeScene(load(value))),job=prepareIteratedFrame(scene,0,0);
  expect(scene.settings.pointSize).toBe(Math.fround(value));expect(job.densitySplat).toMatchObject({dotSize:nativeCold.coldPointSize,displayScale:1,radius:nativeCold.coldPointSize,path:'points'});
  const hot=writeSourceSymmetryPointSize(scene,value);if(!hot.ok)throw Error(hot.error.reason);
  expect(prepareIteratedFrame(hot.value,0,0).densitySplat).toMatchObject({dotSize:Math.max(1,Math.fround(value)),displayScale:1,radius:Math.max(1,Math.fround(value)),path:'points'});
 });
 it('uses the source camera owner’s logical export scale, not pixel density',()=>{
  const scene=load(2),context={time:0,width:900,height:600,quality:'export' as const,sourceViewport:{logicalWidth:900,logicalHeight:600,referenceLogicalHeight:200,target:'offscreen' as const,projectionPass:'perspective' as const},sourcePointPixelDensity:2};
  const plan=prepareOrdinarySourceFrame(ordinarySourceCameraFrame(sceneAtTime(scene,0),context)),facts=prepareSourceDensitySplat('symmetry',2,plan.displayScale);
  expect(facts.radius).toBe(6);expect(sourceDensityPointDiameter(facts)).toBe(6);
  expect(sourceDensityPointDiameter({...facts,path:'quad'})).toBe(Math.fround(6*Math.fround(.6)));
 });
 it('shares the observed CGL point footprint without changing consumed radius or quad coverage',()=>{
  // Independent native gl_PointCoord plateaus, three subpixel centers each:
  // .cache/samila-driver-native-20261024/run2 (also used by the Symmetry audit).
  for(const [input,diameter]of [[1.1,1],[1.49,1],[1.5,2],[1.51,2],[2.2606978,2],[2.5,3],[2.672,3]]){
   for(const family of ['symmetry','map'] as const){
    const facts=prepareSourceDensitySplat(family,input),before=structuredClone(facts);
    expect(sourceDensityPointDiameter(facts)).toBe(diameter);
    expect(sourceDensitySplatPixelTests(facts,1)).toBeGreaterThanOrEqual((diameter+2)**2);
    facts.path='quad';expect(sourceDensityPointDiameter(facts)).toBe(Math.max(Math.fround(before.radius*Math.fround(.6)),Math.fround(.8)));
    facts.path='points';expect(facts).toEqual(before);
   }
  }
  // Quantize after export scaling, not before it.
  expect(sourceDensityPointDiameter(prepareSourceDensitySplat('symmetry',1.8,3))).toBe(5);
 });
 it('admits finite project values but enforces actual raster work before drawing',()=>{
  expect(sourceDensitySplatPixelTests(prepareSourceDensitySplat('symmetry',-2),8)).toBe(72);
  expect(sourceDensitySplatPixelTests(prepareSourceDensitySplat('symmetry',40),8)).toBe(14112);
  expect(()=>sourceDensitySplatPixelTests(prepareSourceDensitySplat('symmetry',100000),8)).toThrow('20 亿');
  for(const size of [NaN,Infinity,-Infinity,Number.MAX_VALUE])expect(()=>prepareSourceDensitySplat('symmetry',size)).toThrow('Float32');
  for(const scale of [0,-1,NaN,Infinity])expect(()=>prepareSourceDensitySplat('symmetry',1,scale)).toThrow('Float32');
 });
 it('does not constrain the native point control to the old local .1–32 range',()=>{
  const scene=load(40),controls=visibleIteratedControls(scene.kind,scene.settings,[{key:'pointSize',label:'Size',group:'Rendering',type:'number',min:.1,max:32}],undefined,undefined,scene.equations);
  expect(controls[0].min).toBeUndefined();expect(controls[0].max).toBeUndefined();
 });
});
