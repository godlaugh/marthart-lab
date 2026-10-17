import {describe,it,expect} from 'vitest';
import {createScene,parseScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {withDomainColorVersion} from '../src/engine/domainAuthoring';
import {gradientAnimationCapabilities} from '../src/engine/gradientOffsets';
import {createAnimationTrack,sceneAtTime,timelineWarnings} from '../src/engine/timeline';
import type {AnimationTrack,GradientAnimation,SceneDocument} from '../src/types';

function scene(version='mathart-1.7.8-gpu'){
 const s=createScene(definition('domain'));s.equations.f='1+i';s.parameters={};s.settings.domainBackend='cpu';Object.assign(s.settings,{curveMode:'NONE',curveMix:0,curveBias:0});s.palette={name:'Two',mode:'linear',stops:['#ff0000','#0000ff'],offset:0,cycles:1};s.timeline.tracks=[];return withDomainColorVersion(s,version);
}
function gradient(config?:GradientAnimation,start=0):AnimationTrack{return{id:'g'+start,type:'animate',target:'camera.actions',from:0,to:0,start,duration:2,easing:'linear',pingPong:false,enabled:true,actions:[{id:'a',method:'gradientStart',gradient:config}]};}
function pixels(s:SceneDocument,time:number){const out=definition('domain').generate(sceneAtTime(s,time),{time,width:2,height:2,quality:'export'});if(out.type!=='raster')throw Error('raster required');return [...out.pixels];}
const palette:GradientAnimation={model:'palette',mode:'offset_cycle',speed:.25,interpolation:'rgb'};
describe('source Domain gradient producer applicability',()=>{
 it.each(['mathart-1.7.8-gpu','mathart-1.7.8-cpu'])('retains but diagnoses inactive palette actions without changing local document behavior: %s',version=>{
  const local=scene('local-v1');local.timeline.tracks=[gradient(palette)];expect(pixels(local,1)).not.toEqual(pixels(local,0));expect(timelineWarnings(local)).toEqual([]);
  const source=withDomainColorVersion(local,version),saved=JSON.stringify(source);expect(pixels(source,1)).toEqual(pixels(source,0));expect(timelineWarnings(source)).toContain(gradientAnimationCapabilities(source).retainedPaletteWarning);
  expect(sceneAtTime(source,1).palette.offset).toBe(source.palette.offset);expect(JSON.stringify(source)).toBe(saved);
  const restored=withDomainColorVersion(parseScene(saved),'local-v1');expect(pixels(restored,1)).toEqual(pixels(local,1));expect(restored.timeline).toEqual(local.timeline);
 });
 it('keeps omitted legacy model semantics, while new source actions use a real visible offset animation',()=>{
  const s=scene();s.timeline.tracks=[gradient()];expect(timelineWarnings(s)).toHaveLength(1);expect(pixels(s,1)).toEqual(pixels(s,0));
  s.timeline.tracks=[gradient(gradientAnimationCapabilities(s).defaultAnimation)];expect(timelineWarnings(s)).toEqual([]);expect(pixels(s,1)).not.toEqual(pixels(s,0));expect(s.settings.domainIterationVersion).toBeUndefined();
 });
 it('an inapplicable action does not interrupt an already running source gradient',()=>{
  const s=scene();s.timeline.tracks=[gradient(gradientAnimationCapabilities(s).defaultAnimation)];const expected=sceneAtTime(s,1.5);
  s.timeline.tracks.push(gradient(palette,.5));const actual=sceneAtTime(s,1.5);expect(actual.settings.paletteOffset).toBe(expected.settings.paletteOffset);expect(actual.evaluatedDomainGradient).toEqual(expected.evaluatedDomainGradient);
 });
 it('skips inactive numeric and oscillator targets but continues applicable parameters in the same track',()=>{
  const s=scene(),numeric=createAnimationTrack(s,'numeric');Object.assign(numeric,{target:'palette.offset',from:0,to:.4,easing:'linear'});
  const param=createAnimationTrack(s,'param');param.parameterAnimations=[{target:'palette.cycles',min:1,max:3,step:1,enabled:true},{target:'settings.paletteOffset',min:0,max:1,step:1,enabled:true}];s.timeline.tracks=[numeric,param];const before=JSON.stringify(s),at=sceneAtTime(s,1);
  expect(at.palette).toEqual(s.palette);expect(at.settings.paletteOffset).not.toBe(0);expect(timelineWarnings(s)).toHaveLength(1);expect(JSON.stringify(s)).toBe(before);
 });
 it('also skips continuous palette oscillators and does not warn for disabled values or actions',()=>{
  const s=scene(),track=gradient();track.actions=[{id:'p',method:'paramStart',parameters:[{target:'palette.offset',min:0,max:1,step:1,enabled:true}]}];s.timeline.tracks=[track];expect(timelineWarnings(s)).toHaveLength(1);expect(sceneAtTime(s,1).palette.offset).toBe(0);
  track.actions[0].parameters![0].enabled=false;expect(timelineWarnings(s)).toEqual([]);track.actions=[{id:'g',method:'gradientStart',enabled:false}];expect(timelineWarnings(s)).toEqual([]);track.actions[0].enabled=true;track.enabled=false;expect(timelineWarnings(s)).toEqual([]);
 });
 it('authors numeric/param defaults against the consumed source offset, including an omitted zero default',()=>{
  const s=scene();delete s.settings.paletteOffset;const before=JSON.stringify(s);
  for(const type of ['numeric','param'] as const){const track=createAnimationTrack(s,type);expect(track.target).toBe('settings.paletteOffset');if(type==='param')expect(track.parameterAnimations![0].target).toBe('settings.paletteOffset');expect(track.from).toBe(0);}
  expect(JSON.stringify(s)).toBe(before);expect(gradientAnimationCapabilities(scene('local-v1')).paletteOffsetTarget).toBe('palette.offset');
 });
});
