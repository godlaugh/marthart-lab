import {describe,it,expect} from 'vitest';
import {createScene,parseScene,persistentScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {sceneAtTime,interpolateColor} from '../src/engine/timeline';
import {compileDomainPalette,hasDiscreteDomainPalette} from '../src/engine/domainGradient';
import {parseDomainModel as parseAnyDomainModel,shadeDomainValue} from '../src/engine/domainModel';
import {parseLegacyScene} from '../src/engine/legacyImport';
import {paletteColor} from '../src/engine/palette';
import type {AnimationTrack,GradientAnimation,Palette} from '../src/types';
const config=(patch:Partial<GradientAnimation>={}):GradientAnimation=>({model:'offsets',mode:'hue_rotate',speed:90,interpolation:'linear',...patch});
const action=(start:number,gradient?:GradientAnimation,duration=0):AnimationTrack=>({id:crypto.randomUUID(),type:'animate',target:'settings.paletteOffset',from:0,to:0,start,duration,easing:'linear',pingPong:false,enabled:true,actions:[{id:crypto.randomUUID(),method:gradient?'gradientStart':'gradientStop',gradient}]});
const make=()=>{const s=createScene(definition('domain'));s.equations.f='z';Object.assign(s.settings,{domainBackend:'cpu',curveMode:'NONE',curveMix:0,curveBias:0,paletteOffset:.2});s.palette={name:'Discrete',mode:'linear',stops:['#ff0000','#0000ff'],offset:.1,cycles:2};s.timeline.duration=10;s.timeline.tracks=[];return s;};
const parseDomainModel=(...args:Parameters<typeof parseAnyDomainModel>)=>{const m=parseAnyDomainModel(...args);if(m.colorVersion!=='local-v1')throw Error('expected local-v1 fixture');return m;};
describe('Domain gradient single-target state',()=>{
 it.each(['hue_rotate','offset_cycle','palette_morph','cross_fade'] as const)('projects all four flag pairs for %s without inventing regional offsets',mode=>{
  for(const inside of [true,false])for(const outside of [true,false]){const s=make();s.timeline.tracks=[action(0,config({mode,affectInside:inside,affectOutside:outside}))];const before=JSON.stringify(s),at=sceneAtTime(s,1);expect(at.settings.paletteOffset).toBeCloseTo(.2+(mode!=='offset_cycle'&&inside&&outside?.25:0),14);expect(at.palette).toEqual(s.palette);expect(at.settings.insideGradientOffset).toBeUndefined();expect(at.settings.outsideGradientOffset).toBeUndefined();expect(at.evaluatedDomainGradient).toEqual({running:true,interpolation:'linear'});expect(JSON.stringify(s)).toBe(before);}
 });
 it('owns one seconds clock through ramps, stop, restart and unordered seeks',()=>{
  const s=make();s.timeline.tracks=[action(0,config(),2),action(4,undefined,2),action(8,config({speed:36}))];
  // ramp integral: t²/4 through t=2; full speed through 4; triangular stop to6.
  const expected=new Map([[1,.2625],[2,.45],[4,.95],[5,1.1375],[6,.2],[7,.2],[8,.2],[9,.3]]);
  for(const t of [9,1,7,2,8,6,4,5]){const at=sceneAtTime(s,t);expect(at.settings.paletteOffset).toBeCloseTo(expected.get(t)!,13);expect(at.evaluatedDomainGradient?.running).toBe(t<6||t>=8);}
  const parsed=parseScene(JSON.stringify(s));expect(sceneAtTime(parsed,9)).toEqual(sceneAtTime(s,9));
 });
 it.each([1,2])('captures full source speed when stopping at %s after a return-curve start',stopAt=>{
  const s=make(),start=action(0,config(),1);start.easing='there-and-back';s.timeline.tracks=[start];
  expect(sceneAtTime(s,1).settings.paletteOffset).toBeCloseTo(.325,13);expect(sceneAtTime(s,2).settings.paletteOffset).toBeCloseTo(.575,13);
  s.timeline.tracks.push(action(stopAt,undefined,1));const expected=.45+(stopAt-1)*.25;
  for(const time of [stopAt+1,8]){const at=sceneAtTime(s,time);expect(at.settings.paletteOffset).toBeCloseTo(expected,13);expect(at.evaluatedDomainGradient?.running).toBe(false);}
  expect(sceneAtTime(s,stopAt+1-1e-6).evaluatedDomainGradient?.running).toBe(true);
 });
 it('captures partial speed when stopping within a start ramp and handles instantaneous boundaries',()=>{
  const s=make();s.timeline.tracks=[action(0,config(),2),action(.5,undefined,1)];
  // Start contributes .5²/(2*2) seconds, stop contributes .25*1/2.
  expect(sceneAtTime(s,1.5).settings.paletteOffset).toBeCloseTo(.246875,13);expect(sceneAtTime(s,4).settings.paletteOffset).toBeCloseTo(.246875,13);
  s.timeline.tracks=[action(1,config()),action(2)];expect(sceneAtTime(s,.5).evaluatedDomainGradient).toBeUndefined();expect(sceneAtTime(s,1).evaluatedDomainGradient?.running).toBe(true);
  for(const time of [2,8]){const at=sceneAtTime(s,time);expect(at.settings.paletteOffset).toBeCloseTo(.45,13);expect(at.evaluatedDomainGradient?.running).toBe(false);}
  s.timeline.tracks=[action(1,config()),action(1)];expect(sceneAtTime(s,1).settings.paletteOffset).toBe(.2);expect(sceneAtTime(s,1).evaluatedDomainGradient?.running).toBe(false);
 });
 it('recognizes a decimal absolute completion time without losing speed through subtraction rounding',()=>{
  const s=make(),start=action(1,config(),.2);start.easing='there-and-back';s.timeline.tracks=[start,action(1+.2,undefined,.2)];
  expect(sceneAtTime(s,1.2).settings.paletteOffset).toBeCloseTo(.225,13);for(const time of [1.2+.2,3]){const at=sceneAtTime(s,time);expect(at.settings.paletteOffset).toBeCloseTo(.25,13);expect(at.evaluatedDomainGradient?.running).toBe(false);}
 });
 it.each(['there-and-back','not-quite-there'])('freezes source offsets and rendered pixels at %s stop completion',easing=>{
  const s=make(),stop=action(1,undefined,1);stop.easing=easing;s.timeline.tracks=[action(0,config()),stop];
  const end=sceneAtTime(s,2),later=sceneAtTime(s,3);expect(later.settings.paletteOffset).toBe(end.settings.paletteOffset);expect(end.evaluatedDomainGradient).toEqual({running:false,interpolation:'linear'});expect(later.evaluatedDomainGradient).toEqual(end.evaluatedDomainGradient);
  if(easing==='there-and-back')expect(end.settings.paletteOffset).toBeCloseTo(.575,13);
  const def=definition('domain'),first=def.generate(end,{time:2,width:32,height:24,quality:'export'}),last=def.generate(later,{time:3,width:32,height:24,quality:'export'});if(first.type!=='raster'||last.type!=='raster')throw Error('raster');expect(last.pixels).toEqual(first.pixels);
 });
 it('restarts during a return-curve stop from the cutoff offset and remains deterministic after reload',()=>{
  const s=make(),stop=action(1,undefined,2);stop.easing='there-and-back';s.timeline.tracks=[action(0,config()),stop,action(2,config({speed:36}))];
  const original=JSON.stringify(s),restored=parseScene(original);for(const time of [3,1,2,2.5,.5])expect(sceneAtTime(restored,time)).toEqual(sceneAtTime(s,time));
  expect(sceneAtTime(s,2).settings.paletteOffset).toBeCloseTo(.575,13);expect(sceneAtTime(s,3).settings.paletteOffset).toBeCloseTo(.675,13);expect(sceneAtTime(s,3).evaluatedDomainGradient?.running).toBe(true);expect(JSON.stringify(s)).toBe(original);
 });
 it('starts cyclic sampling at zero speed, keeps it during the stop ramp, and restores ordinary sampling exactly at completion',()=>{
  const s=make();s.settings.paletteOffset=0;s.palette.offset=0;s.palette.cycles=1;s.timeline.tracks=[action(0,config({mode:'offset_cycle',speed:0,interpolation:'rgb'})),action(2,undefined,1)];
  const at=(t:number)=>parseDomainModel(sceneAtTime(s,t),t);
  expect(at(0).paletteSample(.75)).toEqual([128/255,0,128/255]);expect(at(2.5).paletteSample(.75)).toEqual([128/255,0,128/255]);
  expect(at(3).paletteSample(.75)).toEqual([.25,0,.75]);expect(at(8).paletteSample(.75)).toEqual([.25,0,.75]);
  expect(sceneAtTime(s,8).settings.paletteOffset).toBe(0);expect(s.palette.stops).toEqual(['#ff0000','#0000ff']);
 });
 it('keeps settings paletteOffset before cycles and preserves the separate authored palette offset',()=>{
  const s=make();s.timeline.tracks=[action(0,config())];const at=sceneAtTime(s,1),m=parseDomainModel(at,1),expected=compileDomainPalette(s.palette,at.evaluatedDomainGradient).sample(.45);
  expect(shadeDomainValue([1,0],[0,0],m,40)).toEqual(expected);expect(at.palette.offset).toBe(.1);expect(at.palette.cycles).toBe(2);
  expect(m.paletteSample(.45)).not.toEqual(compileDomainPalette({...s.palette,offset:.35},at.evaluatedDomainGradient).sample(.2));
 });
 it('retains old model=omitted artwork and resets stale evaluated state on a fresh evaluation',()=>{
  const s=make();s.timeline.tracks=[action(0,{mode:'offset_cycle',speed:.1,interpolation:'rgb'})];const at=sceneAtTime(s,2);expect(at.palette.offset).toBeCloseTo(.3);expect(at.settings.paletteOffset).toBe(.2);expect(at.evaluatedDomainGradient).toBeUndefined();
  s.evaluatedDomainGradient={running:true,interpolation:'oklab'};expect(sceneAtTime(s,2).evaluatedDomainGradient).toBeUndefined();s.timeline.tracks=[];expect(sceneAtTime(s,2).evaluatedDomainGradient).toBeUndefined();
 });
 it('discards injected runtime facts at parse/save while retaining authored action configuration',()=>{
  const s=make();s.timeline.tracks=[action(0,config())];const at=sceneAtTime(s,1);expect(persistentScene(at).evaluatedDomainGradient).toBeUndefined();
  for(const bad of [{running:true,interpolation:'oklab'},{running:'yes',interpolation:'unknown'},'not runtime']){const parsed=parseScene(JSON.stringify({...s,evaluatedDomainGradient:bad}));expect(parsed.evaluatedDomainGradient).toBeUndefined();expect(sceneAtTime(parsed,1).evaluatedDomainGradient).toEqual({running:true,interpolation:'linear'});}
 });
});
describe('Domain sampling owner and import',()=>{
 it('uses cyclic entry interpolation in every supported color space without a Timeline import cycle',()=>{
  const palette:Palette={name:'N=3',stops:['#ff0000','#00ff00','#0000ff'],mode:'linear',cycles:1,offset:0};
  for(const interpolation of ['rgb','linear','oklab','oklch'] as const){const sampler=compileDomainPalette(palette,{running:true,interpolation}).sample;expect(sampler(0)).toEqual([1,0,0]);expect(sampler(1)).toEqual([1,0,0]);expect(sampler(-.125)).toEqual(sampler(.875));
   const hex=interpolateColor('#0000ff','#ff0000',.625,interpolation),expected=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);expect(sampler(.875)).toEqual(expected);
  }
  expect(()=>compileDomainPalette(palette,{running:true,interpolation:'unknown'} as never)).toThrow();
 });
 it('keeps richer authored palettes intact and explicitly reports the independent offset-only extension',()=>{
  const s=make();for(const palette of [{...s.palette,mode:'cosine'},{...s.palette,mode:'curve'},{...s.palette,interpolation:'hsv'},{...s.palette,positions:[0,1]}] as Palette[]){const before=JSON.stringify(palette),result=compileDomainPalette(palette,{running:true,interpolation:'oklab'});expect(hasDiscreteDomainPalette(palette)).toBe(false);expect(result.warnings.join()).toContain('仅应用域偏移');expect(result.sample(.3)).toEqual(paletteColor(palette,.3));expect(JSON.stringify(palette)).toBe(before);}
 });
 it('imports the actual Domain target and defaults, preserving no-motion flags and provenance',()=>{
  for(const mode of ['HUE_ROTATE','OFFSET_CYCLE','CROSS_FADE','PALETTE_MORPH'])for(const inside of [true,false])for(const outside of [true,false]){
   const source={config_version:'1.0.0',type:'DOMAIN_COLORING',name:'Domain gradient',palette:['#ff0000','#0000ff'],domainColoring:{formula:'z'},timeline:[{type:'animate',duration:0,actions:[{method:'gradientStart',args:[{mode,speed:90,interpolation:'LINEAR',affectInside:inside,affectOutside:outside}]}]},{type:'wait',duration:4}]};
   const result=parseLegacyScene(JSON.stringify(source)),s=result.scene;expect(result.source).toEqual(source);expect(s.timeline.tracks[0].actions![0].gradient).toEqual(config({mode:mode.toLowerCase() as GradientAnimation['mode'],affectInside:inside,affectOutside:outside}));s.timeline.fps=4;/* Four displayed updates, each with active and raw .25s phases. */expect(sceneAtTime(s,.75).settings.paletteOffset).toBe(mode!=='OFFSET_CYCLE'&&inside&&outside?.5:0);expect(s.palette.offset).toBe(0);expect(result.warnings.join()).toContain('只消费 paletteOffset');
  }
  const result=parseLegacyScene(JSON.stringify({config_version:'1.0.0',type:'DOMAIN_COLORING',name:'Defaults',domainColoring:{formula:'z'},timeline:[{type:'animate',duration:0,actions:[{method:'gradientStart',args:[{}]}]},{type:'wait',duration:2}]}));expect(result.scene.timeline.tracks[0].actions![0].gradient).toMatchObject({model:'offsets',mode:'hue_rotate',speed:60,interpolation:'oklab',affectInside:true,affectOutside:true});
 });
 it('renders real pixels with unchanged mathematical workload and returns to the original sampler after stop',()=>{
  const s=make();s.timeline.tracks=[action(0,config({mode:'offset_cycle',speed:0,interpolation:'rgb'})),action(2)];const def=definition('domain'),generate=(scene= s,time=0)=>def.generate(sceneAtTime(scene,time),{time,width:64,height:48,quality:'export'}),active=generate(s,1),stopped=generate(s,2),plain=generate({...s,timeline:{...s.timeline,tracks:[]}},2);
  if(active.type!=='raster'||stopped.type!=='raster'||plain.type!=='raster')throw Error('raster');expect(active.stats.samples).toBe(stopped.stats.samples);expect(active.pixels).not.toEqual(stopped.pixels);expect(stopped.pixels).toEqual(plain.pixels);expect(generate(parseScene(JSON.stringify(s)),1)).toMatchObject({pixels:active.pixels});
 });
});
