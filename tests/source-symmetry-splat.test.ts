import {describe,it,expect} from 'vitest';
import {parseProjectFile} from '../src/engine/legacyImport';
import {parseScene,serializeScene} from '../src/engine/document';
import {prepareIteratedFrame,visibleIteratedControls} from '../src/scenes/iteratedDensity';
import {prepareSourceSymmetrySplat,sourceSymmetryPointDiameter,sourceSymmetrySplatPixelTests} from '../src/engine/sourceSymmetrySplat';
import {sceneAtTime} from '../src/engine/timeline';
import {ordinarySourceCameraFrame,prepareOrdinarySourceFrame} from '../src/engine/ordinarySourceCamera';

const load=(dot_size:number)=>parseProjectFile(JSON.stringify({config_version:'1.0.0',name:'Source dot',type:'SYMMETRY_CHAOS',settings:{dot_size,batch_size:8,burn_in_steps:0}})).scene;
describe('Symmetry source point-size consumer',()=>{
 it.each([-2,0,.01,1.5,40,100000])('retains authored dot size %s across file import/reopen and prepares the original minimum',value=>{
  const scene=parseScene(serializeScene(load(value))),job=prepareIteratedFrame(scene,0,0);
  expect(scene.settings.pointSize).toBe(Math.fround(value));expect(job.symmetrySplat).toMatchObject({dotSize:Math.fround(value),displayScale:1,radius:Math.max(1,Math.fround(value)),path:'points'});
 });
 it('uses the source camera owner’s logical export scale, not pixel density',()=>{
  const scene=load(2),context={time:0,width:900,height:600,quality:'export' as const,sourceViewport:{logicalWidth:900,logicalHeight:600,referenceLogicalHeight:200,target:'offscreen' as const,projectionPass:'perspective' as const},sourcePointPixelDensity:2};
  const plan=prepareOrdinarySourceFrame(ordinarySourceCameraFrame(sceneAtTime(scene,0),context)),facts=prepareSourceSymmetrySplat(2,plan.displayScale);
  expect(facts.radius).toBe(6);expect(sourceSymmetryPointDiameter(facts)).toBe(6);
  expect(sourceSymmetryPointDiameter({...facts,path:'quad'})).toBe(Math.fround(6*Math.fround(.6)));
 });
 it('admits finite project values but enforces actual raster work before drawing',()=>{
  expect(sourceSymmetrySplatPixelTests(prepareSourceSymmetrySplat(-2),8)).toBe(72);
  expect(sourceSymmetrySplatPixelTests(prepareSourceSymmetrySplat(40),8)).toBe(14112);
  expect(()=>sourceSymmetrySplatPixelTests(prepareSourceSymmetrySplat(100000),8)).toThrow('20 亿');
  for(const size of [NaN,Infinity,-Infinity,Number.MAX_VALUE])expect(()=>prepareSourceSymmetrySplat(size)).toThrow('Float32');
  for(const scale of [0,-1,NaN,Infinity])expect(()=>prepareSourceSymmetrySplat(1,scale)).toThrow('Float32');
 });
 it('does not constrain the native point control to the old local .1–32 range',()=>{
  const scene=load(40),controls=visibleIteratedControls(scene.kind,scene.settings,[{key:'pointSize',label:'Size',group:'Rendering',type:'number',min:.1,max:32}],undefined,undefined,scene.equations);
  expect(controls[0].min).toBeUndefined();expect(controls[0].max).toBeUndefined();
 });
});
