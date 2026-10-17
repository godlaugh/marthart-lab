import {describe,it,expect} from 'vitest';
import {createScene,parseScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {gradientOffsetFrame,compileGradientOffsets,readGradientOffsets} from '../src/engine/gradientOffsets';
import {sceneAtTime} from '../src/engine/timeline';
import {parseLegacyScene} from '../src/engine/legacyImport';
import type {AnimationTrack,GradientAnimation} from '../src/types';
const config=(patch:Partial<GradientAnimation>={}):GradientAnimation=>({model:'offsets',mode:'hue_rotate',speed:90,interpolation:'linear',...patch});
const action=(start:number,gradient?:GradientAnimation,duration=0):AnimationTrack=>({id:crypto.randomUUID(),type:'animate',target:'palette.offset',from:0,to:0,start,duration,easing:'linear',pingPong:false,enabled:true,actions:[{id:crypto.randomUUID(),method:gradient?'gradientStart':'gradientStop',gradient}]});
const make=()=>{const scene=createScene(definition('fractal'));scene.timeline.tracks=[action(0,config())];scene.settings.insideGradientOffset=.1;scene.settings.outsideGradientOffset=.2;return scene;};
describe('independent fractal gradient offset fields',()=>{
 it('matches static field equations and phase shaping, including wrapped periods and both disabled',()=>{
  const base={palette:0,inside:.1,outside:.2};
  expect(gradientOffsetFrame(base,config(),1)).toEqual({palette:.25,inside:.1,outside:.2});
  expect(gradientOffsetFrame(base,config({affectOutside:false}),1)).toEqual({palette:0,inside:.35,outside:.2});
  expect(gradientOffsetFrame(base,config({affectInside:false,affectOutside:false}),1)).toEqual(base);
  expect(gradientOffsetFrame(base,config(),4)).toEqual(base);
  expect(gradientOffsetFrame(base,config({interpolation:'rgb'}),1).palette).toBe(.15625);
  expect(gradientOffsetFrame(base,config({interpolation:'oklab'}),1).palette).toBe(.15625);
  expect(gradientOffsetFrame(base,config({interpolation:'oklch'}),1).palette).toBe(.103515625);
  const offset=gradientOffsetFrame(base,config({mode:'offset_cycle'}),1);
  expect(offset.palette).toBe(0);expect(offset.inside).toBeCloseTo(.3853553390593274,14);expect(offset.outside).toBeCloseTo(.4323223304703363,14);
  expect(gradientOffsetFrame(base,config({mode:'cross_fade'}),0)).toEqual({palette:0,inside:.020000000000000004,outside:.28});
  const morph=gradientOffsetFrame(base,config({mode:'palette_morph'}),0);expect(morph.inside).toBeCloseTo(.05145898033750316,14);expect(morph.outside).toBeCloseTo(.24854101966249686,14);
 });
 it('rejects malformed flags, negative source speed, nonfinite clocks and unsupported color owners',()=>{
  const scene=make();for(const bad of [{affectInside:'false'},{speed:-1},{model:'unknown'}])expect(()=>compileGradientOffsets(scene,{...config(),...bad} as GradientAnimation)).toThrow();
  expect(()=>gradientOffsetFrame(readGradientOffsets(scene),config(),Infinity)).toThrow();
  scene.settings.fractalColorVersion=1;expect(()=>compileGradientOffsets(scene,config())).toThrow('独立内部');
 });
 it('preserves source documents and independently overrides a selected region through save/reload and random seeks',()=>{
  const scene=make();scene.timeline.tracks=[action(0,config({affectInside:false})),action(2)];const original=JSON.stringify(scene),restored=parseScene(original);
  const at=sceneAtTime(restored,1);expect(at.palette).toEqual(scene.palette);expect(at.settings.insideGradientOffset).toBe(.1);expect(at.settings.outsideGradientOffset).toBe(.45);
  expect(sceneAtTime(restored,8).settings.outsideGradientOffset).toBe(.7);expect(sceneAtTime(restored,.5).settings.outsideGradientOffset).toBe(.325);expect(JSON.stringify(scene)).toBe(original);
  restored.timeline.tracks[0].actions![0].gradient!.affectInside=true;expect(sceneAtTime(restored,1).palette.offset).toBe(scene.palette.offset+.25);
 });
 it.each(['there-and-back','there-and-back-with-pause','wiggle','not-quite-there','exponential-decay'])('uses source completion speeds after %s ramps for global and regional offsets',easing=>{
  for(const affectInside of [true,false]){
   const scene=make(),start=action(0,config({speed:36,affectInside}),1);start.easing=easing;scene.timeline.tracks=[start];
   const field=(time:number)=>affectInside?sceneAtTime(scene,time).palette.offset:Number(sceneAtTime(scene,time).settings.outsideGradientOffset);
   expect(field(2)-field(1)).toBeCloseTo(.1,12);
   const stop=action(1,undefined,1);stop.easing=easing;scene.timeline.tracks.push(stop);
   const end=field(2);expect(field(4)).toBe(end);expect(field(2-1e-6)).toBeCloseTo(end,6);
   const restored=parseScene(JSON.stringify(scene));for(const time of [4,.5,2,1,3])expect(sceneAtTime(restored,time)).toEqual(sceneAtTime(scene,time));
  }
 });
 it('moves global offsets through independent cosine and curve palettes without altering dormant stops',()=>{
  for(const mode of ['cosine','curve'] as const){const scene=make();scene.palette.mode=mode;scene.settings.insidePalette=JSON.stringify({...scene.palette,offset:.3});const at=sceneAtTime(scene,1),regional=JSON.parse(String(at.settings.insidePalette));
   expect(at.palette.mode).toBe(mode);expect(at.palette.stops).toEqual(scene.palette.stops);expect(regional.offset).toBeCloseTo(.55);expect(regional.mode).toBe(mode);expect(regional.stops).toEqual(scene.palette.stops);
  }
 });
 it('retains old palette animation behavior when model is omitted',()=>{
  const scene=make();scene.timeline.tracks=[action(0,{mode:'offset_cycle',speed:.1,interpolation:'rgb'})];expect(sceneAtTime(scene,2).palette.offset).toBeCloseTo(scene.palette.offset+.2);expect(sceneAtTime(scene,2).settings.insideGradientOffset).toBe(.1);
 });
 it.each([undefined,'palette'] as const)('preserves legacy return-curve endpoint policy for model=%s',model=>{
  const scene=make(),start=action(0,{model,mode:'offset_cycle',speed:.1,interpolation:'rgb'},1);start.easing='there-and-back';scene.timeline.tracks=[start];
  expect(sceneAtTime(scene,2).palette.offset).toBe(sceneAtTime(scene,1).palette.offset);
  start.easing='linear';const stop=action(1,undefined,1);stop.easing='there-and-back';scene.timeline.tracks.push(stop);
  expect(sceneAtTime(scene,3).palette.offset-sceneAtTime(scene,2).palette.offset).toBeCloseTo(.1,12);
 });
 it('imports actual source scope and degree-per-second units with provenance and verified defaults',()=>{
  for(const mode of ['HUE_ROTATE','OFFSET_CYCLE','CROSS_FADE','PALETTE_MORPH']){
   const source={config_version:'1.0.0',type:'FRACTAL',name:'Gradient',fractal:{formula_id:'mandelbrot'},timeline:[{type:'animate',duration:0,easing:'LINEAR',actions:[{method:'gradientStart',args:[{mode,speed:90,affectInside:false,affectOutside:true}]}]},{type:'wait',duration:5}]};
   const parsed=parseLegacyScene(JSON.stringify(source));expect(parsed.source).toEqual(source);expect(parsed.scene.timeline.tracks[0].actions![0].gradient).toMatchObject({model:'offsets',speed:90,affectInside:false,affectOutside:true});expect(sceneAtTime(parsed.scene,1).palette.offset).toBe(0);expect(sceneAtTime(parsed.scene,1).settings.insideGradientOffset).toBe(0);expect(sceneAtTime(parsed.scene,1).settings.outsideGradientOffset).not.toBe(0);
  }
  const parsed=parseLegacyScene(JSON.stringify({config_version:'1.0.0',type:'FRACTAL',name:'Default',fractal:{formula_id:'mandelbrot'},timeline:[{type:'animate',duration:0,actions:[{method:'gradientStart',args:[{}]}]},{type:'wait',duration:2}]}));expect(parsed.scene.timeline.tracks[0].actions![0].gradient).toMatchObject({mode:'hue_rotate',speed:60,interpolation:'oklab'});
 });
 it('changes actual CPU fractal pixels for outside-only animation while retaining the same orbit workload',()=>{
  const scene=make();scene.settings.fractalBackend='cpu';scene.timeline.tracks=[action(0,config({affectInside:false}))];
  const def=definition('fractal'),before=def.generate(sceneAtTime(scene,0),{time:0,quality:'export',width:80,height:48}),after=def.generate(sceneAtTime(scene,1),{time:1,quality:'export',width:80,height:48});
  expect(before.type).toBe('raster');expect(after.type).toBe('raster');if(before.type!=='raster'||after.type!=='raster')return;
  expect(after.stats.samples).toBe(before.stats.samples);expect(after.pixels).not.toEqual(before.pixels);const center=(24*80+40)*4;expect([...after.pixels.slice(center,center+4)]).toEqual([...before.pixels.slice(center,center+4)]);
 });
});
