import {afterEach,describe,expect,it,vi} from 'vitest';
import {definition} from '../src/scenes';
import {createScene,parseScene,serializeScene} from '../src/engine/document';
import {parseLegacyScene} from '../src/engine/legacyImport';
import {FRACTAL_SOURCE_COLOR_PROFILE,prepareFractalSourceColor} from '../src/engine/fractalSourceColor';
import {selectFractalColorProfile,authoredFractalSourceColor} from '../src/engine/fractalSourceColorAuthoring';
import {FRACTAL_SOURCE_NUMERIC_PROFILE} from '../src/engine/fractalSourcePrecision';
import {fractalGpu} from '../src/engine/fractalGpu';
import {sceneAtTime,readAnimationValue,timelineControlsTarget,timelineWarnings} from '../src/engine/timeline';
import type {AnimationTrack,GradientAnimation,SceneDocument} from '../src/types';
const def=definition('fractal');
const context={time:0,width:9,height:7,quality:'export' as const};
function scene(){const s=createScene(def);Object.assign(s.settings,{formula:'nova',fractalNumericProfile:FRACTAL_SOURCE_NUMERIC_PROFILE,fractalBackend:'webgl2',iterations:12,power:3,startReal:1,startImag:0,perturbationPrecision:'medium',renderMethod:'one-pass'});return selectFractalColorProfile(s,FRACTAL_SOURCE_COLOR_PROFILE);}
function action(start:number,gradient?:GradientAnimation):AnimationTrack{return{id:'g'+start,type:'animate',target:'camera.actions',from:0,to:0,start,duration:0,easing:'linear',pingPong:false,enabled:true,actions:[{id:'a'+start,method:gradient?'gradientStart':'gradientStop',gradient}]};}
const gradient:GradientAnimation={model:'offsets',mode:'hue_rotate',speed:90,interpolation:'linear',affectInside:true,affectOutside:true};
afterEach(()=>{vi.restoreAllMocks();fractalGpu.dispose();});
describe('source fractal color public document and rendering boundary',()=>{
 it('selects independent defaults and retains both sets of edits through toggle, save and reopen',()=>{
  const local=createScene(def),before=structuredClone(local),source=selectFractalColorProfile(local,FRACTAL_SOURCE_COLOR_PROFILE);
  expect(source.settings).toEqual({...before.settings,fractalColorProfile:FRACTAL_SOURCE_COLOR_PROFILE});expect(source.palette).toEqual(before.palette);
  source.fractalSourceColor!.outside.parameters.trap_angle=45;source.fractalSourceColor!.palette.gamma=2;
  const back=selectFractalColorProfile(parseScene(serializeScene(source)),'local-v1');expect(back.settings).toEqual(before.settings);expect(back.palette).toEqual(before.palette);
  expect(selectFractalColorProfile(back,FRACTAL_SOURCE_COLOR_PROFILE).fractalSourceColor).toEqual(source.fractalSourceColor);expect(local).toEqual(before);
 });
 it('does not persist or trust a runtime palette interpolation override',()=>{
  const s=scene();s.evaluatedFractalGradient={interpolation:'oklab',cyclic:true};
  expect(JSON.parse(serializeScene(s)).evaluatedFractalGradient).toBeUndefined();expect(parseScene(JSON.stringify(s)).evaluatedFractalGradient).toBeUndefined();
  expect(sceneAtTime(s,0).evaluatedFractalGradient).toBeUndefined();
 });
 it('retains unknown saved algorithms for repair, while execution rejects them before sampling',()=>{
  const s=scene();s.fractalSourceColor!.outside.algorithm='future-algorithm';const restored=parseScene(serializeScene(s)),sample=vi.spyOn(fractalGpu,'sample');
  expect(restored.fractalSourceColor!.outside.algorithm).toBe('future-algorithm');expect(()=>def.generate(restored,context)).toThrow('unsupported source coloring algorithm');expect(sample).not.toHaveBeenCalled();
  const malformed=JSON.parse(serializeScene(s));malformed.fractalSourceColor.palette.colors=null;expect(()=>parseScene(JSON.stringify(malformed))).toThrow('array required');
 });
 it.each([{fractalNumericProfile:'local-v1'},{formula:'mandelbrot'},{formula:'mandelbulb_3d'}])('rejects incompatible source-color math explicitly: %j',settings=>{
  const s=scene();Object.assign(s.settings,settings);const saved=parseScene(serializeScene(s)),sample=vi.spyOn(fractalGpu,'sample');
  expect(()=>def.generate(saved,context)).toThrow('原版分形着色需要');expect(sample).not.toHaveBeenCalled();
 });
 it('delivers exact GPU color bytes without unpacking or interpreting local color settings',()=>{
  const s=scene();Object.assign(s.settings,{fractalColorVersion:99,insideColoring:'bad',outsideColoring:'bad',fractalDistanceVersion:'bad',trapShape:'bad',trapAspect:'bad',insidePalette:'{broken'});
  const saved=parseScene(serializeScene(s));let called=0;
  vi.spyOn(fractalGpu,'sample').mockImplementation((points,_w,_h,_view,config,_ref,_threshold,local,source)=>{
   called++;expect(local).toBeUndefined();expect(config.distance).toBeUndefined();expect(source!.colorPlan!.profile).toBe(FRACTAL_SOURCE_COLOR_PROFILE);
   const sourceRGBA=new Uint8Array(points.length*2);for(let i=0;i<points.length/2;i++)sourceRGBA.set([17,128,254,255],4*i);
   // Nonfinite orbit diagnostic values must never become CPU-shaded colors.
   return{values:new Float32Array(points.length*4).fill(NaN),sourceRGBA};
  });
  const out=def.generate(saved,context);expect(called).toBe(1);expect(out.type).toBe('raster');if(out.type!=='raster')return;
  expect([...out.pixels]).toEqual(Array.from({length:63},()=>[17,128,254,255]).flat());expect(out.stats).toMatchObject({samples:63,generated:63,invalid:0});
 });
 it.each(['missing','short','nonopaque'])('rejects an invalid source color transport: %s',bad=>{
  vi.spyOn(fractalGpu,'sample').mockImplementation(points=>({values:new Float32Array(points.length*4),sourceRGBA:bad==='missing'?undefined:new Uint8Array(bad==='short'?4:points.length*2)}));
  expect(()=>def.generate(scene(),context)).toThrow(bad==='nonopaque'?'nonopaque':'complete RGBA');
 });
 it('imports native color independently, retains alpha and None semantics, and reports unconsumed fields',()=>{
  const raw={config_version:'1.0.0',type:'FRACTAL',name:'Source color',fractal:{formula_id:'nova'},palette:['#80FF0000','#FF00FF00'],color:{use_cosine_palette:false,palette_gamma:2,unmapped_root:4,inside:{algorithm_id:'none',transfer_function:'LINEAR'},outside:{algorithm_id:'orbit_trap_index',transfer_function:'NONE',repeat_gradient:false,algorithm_params:{trap_angle:90,unknown_parameter:42},unknown_side:true}}};
  const result=parseLegacyScene(JSON.stringify(raw)),c=result.scene.fractalSourceColor!;
  expect(result.scene.settings.fractalColorProfile).toBe(FRACTAL_SOURCE_COLOR_PROFILE);expect(c.palette).toMatchObject({colors:raw.palette,gamma:2,useCosine:false});
  expect(c.inside).toMatchObject({algorithm:'none',transfer:'linear'});expect(c.outside).toMatchObject({algorithm:'orbit_trap_index',transfer:'none',repeat:false,parameters:{trap_angle:90}});
  expect(result.warnings.join()).toContain('unknown_parameter');expect(result.warnings.join()).toContain('unknown_side');expect(result.warnings.join()).toContain('unmapped_root');expect(result.source).toEqual(raw);
  expect(parseScene(serializeScene(result.scene)).fractalSourceColor).toEqual(c);
 });
 it('changes only the source payload on timeline seek; running overrides clear on stop and restore on restart',()=>{
  const s=scene();s.fractalSourceColor!.palette.useCosine=false;s.timeline.tracks=[action(0,gradient),action(2),action(3,{...gradient,interpolation:'oklab'})];const before=serializeScene(s);
  for(const t of [4,1,2.5,.5,3.5]){
   const a=sceneAtTime(s,t),b=sceneAtTime(parseScene(before),t);expect(a).toEqual(b);expect(a.palette).toEqual(s.palette);
   expect(a.settings).toEqual(s.settings);expect(timelineControlsTarget(a,'fractalColor.paletteOffset')).toBe(true);
  }
  const active=sceneAtTime(s,1),stopped=sceneAtTime(s,2.5),restart=sceneAtTime(s,3.5);
  expect(active.evaluatedFractalGradient).toEqual({interpolation:'linear',cyclic:true});expect(active.fractalSourceColor!.palette.offset).toBe(.25);
  expect(stopped.evaluatedFractalGradient).toBeUndefined();expect(stopped.fractalSourceColor!.palette.offset).toBe(.5);expect(restart.evaluatedFractalGradient).toEqual({interpolation:'oklab',cyclic:true});
  const plan=(x:SceneDocument)=>prepareFractalSourceColor({configuration:authoredFractalSourceColor(x),formulaPower:3,bailout:.001,runtime:x.evaluatedFractalGradient});
  expect(plan(active).lutKey).not.toBe(plan({...active,evaluatedFractalGradient:undefined}).lutKey);expect(serializeScene(s)).toBe(before);
 });
 it('invalidates compiled gradient baselines for source-payload edits, including caller mutation and negative zero',()=>{
  const s=scene();s.timeline.tracks=[action(0,gradient)];expect(sceneAtTime(s,1).fractalSourceColor!.palette.offset).toBe(.25);
  const original=structuredClone(s);s.fractalSourceColor!.palette.offset=.2;
  expect(sceneAtTime(s,1).fractalSourceColor!.palette.offset).toBe(.45);
  // A cached closure owns the original snapshot, not the caller's mutated payload.
  expect(sceneAtTime(original,1).fractalSourceColor!.palette.offset).toBe(.25);
  expect(sceneAtTime(original,1)).not.toHaveProperty('fractalSourceColorIdentity');
  const immutable={...s,fractalSourceColor:structuredClone(s.fractalSourceColor!)};immutable.fractalSourceColor.inside.offset=.3;
  expect(sceneAtTime(immutable,1).fractalSourceColor!.inside.offset).toBe(.3);
  immutable.fractalSourceColor.outside.offset=-0;expect(Object.is(sceneAtTime(immutable,1).fractalSourceColor!.outside.offset,-0)).toBe(true);
  expect(s.fractalSourceColor!.inside.offset).toBe(0);
 });
 it('retains source offset tracks while local color is selected, without rewriting local offsets',()=>{
  const s=scene();s.timeline.tracks=[{id:'n',type:'numeric',target:'fractalColor.outsideOffset',from:0,to:1,start:0,duration:2,easing:'linear',pingPong:false,enabled:true}];
  const local=selectFractalColorProfile(s,'local-v1'),at=sceneAtTime(local,1);expect(at.fractalSourceColor).toEqual(s.fractalSourceColor);expect(at.palette).toEqual(s.palette);expect(timelineWarnings(local)).toContain('原版分形着色已停用；其偏移动画保留但不执行。');
  expect(sceneAtTime(selectFractalColorProfile(local,FRACTAL_SOURCE_COLOR_PROFILE),1).fractalSourceColor!.outside.offset).toBe(.5);
 });
 it('numeric offset tracks write their independent owner and retain the authored base',()=>{
  const s=scene(),before=serializeScene(s);s.timeline.tracks=[{id:'n',type:'numeric',target:'fractalColor.outsideOffset',from:0,to:1,start:0,duration:2,easing:'linear',pingPong:false,enabled:true}];
  const at=sceneAtTime(s,1);expect(readAnimationValue(at,'fractalColor.outsideOffset')).toBe(.5);expect(at.fractalSourceColor!.inside.offset).toBe(0);expect(at.palette).toEqual(s.palette);expect(timelineControlsTarget(at,'fractalColor.outsideOffset')).toBe(true);expect(s.fractalSourceColor).toEqual(parseScene(before).fractalSourceColor);
 });
});
