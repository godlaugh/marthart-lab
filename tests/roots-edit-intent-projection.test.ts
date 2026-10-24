import {describe,expect,it} from 'vitest';
import {createScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {withRootsPresentation} from '../src/engine/rootsPresentationAuthoring';
import {defaultRootsPendingConfiguration,defaultRootsPresentationConfiguration} from '../src/engine/rootsPresentationConfig';
import {withRootsSceneTimeline} from '../src/engine/rootsCameraTimeline';
import {ROOTS_SOURCE_TONE_FIELDS} from '../src/engine/rootsDensityColor';
import {RootsControlOwner} from '../src/engine/rootsControl';
import {rootsEditorActionFor,type RootsEditorIntent} from '../src/engine/rootsEditIntent';

function source(){return withRootsSceneTimeline(withRootsPresentation(createScene(definition('roots')),{...defaultRootsPresentationConfiguration(),pending:defaultRootsPendingConfiguration(),previewMode:'live-worker-arrival-v1'}),true);}

describe('Roots editor event to narrow runtime command projection',()=>{
 it.each(['roots-palette','roots-tone','roots-transform','roots-offset'] as const)('%s excludes staged mode, camera, timeline and math from the actual command owner',intent=>{
  const cold=source(),owner=new RootsControlOwner('editor-projection');owner.commit(owner.prepare({acknowledgedRevision:0,commands:[{kind:'apply',revision:1,scene:cold}]}));
  const next=structuredClone(cold);next.name='staged author';next.rootsPresentation!.mode='point-cloud';next.rootsPresentation!.camera.phi=.765;
  next.timeline.duration=777;next.rootsMath!.polynomial.coefficients[0].expression='not an applied expression';
  next.rootsSourcePalette={colors:['#ff8800']};next.settings.rootSourceBrightness=.7;next.settings.rootSourcePaletteOffset=.25;next.rootsPresentation!.dotSize=.025;next.rootsPresentation!.transform.offset[0]=3;
  const before=structuredClone(next),action=rootsEditorActionFor(next,intent);expect(action.kind).toBe('hot');if(action.kind!=='hot')throw Error('expected hot action');
  expect(action.command).not.toHaveProperty('scene');expect(action.command).not.toHaveProperty('camera');expect(action.command).not.toHaveProperty('timeline');
  owner.commit(owner.prepare({acknowledgedRevision:1,commands:[{revision:2,...action.command}]}));
  expect(owner.currentScene.rootsPresentation!.mode).toBe(cold.rootsPresentation!.mode);expect(owner.currentScene.rootsPresentation!.camera).toEqual(cold.rootsPresentation!.camera);expect(owner.currentScene.timeline).toEqual(cold.timeline);expect(owner.currentScene.rootsMath).toEqual(cold.rootsMath);expect(owner.currentScene.name).toBe(cold.name);
  if(intent==='roots-palette')expect(owner.currentScene.rootsSourcePalette!.colors).toEqual(['#ffff8800']);
  if(intent==='roots-tone'){expect(owner.currentScene.settings.rootSourceBrightness).toBe(Math.fround(.7));expect(owner.currentScene.rootsPresentation!.dotSize).toBe(Math.fround(.025));expect(owner.currentScene.settings.rootSourcePaletteOffset).toBe(cold.settings.rootSourcePaletteOffset);}
  if(intent==='roots-transform')expect(owner.currentScene.rootsPresentation!.transform.offset[0]).toBe(3);
  if(intent==='roots-offset')expect(owner.currentScene.settings.rootSourcePaletteOffset).toBe(.25);
  expect(owner.receipt).toEqual({revision:2,applyRevision:1,resetRevision:1});expect(next).toEqual(before);
 });

 it('uses the declared tone field mapping and defaults, leaving clamping and Float32 to the command owner',()=>{
  const scene=source();for(const field of ROOTS_SOURCE_TONE_FIELDS)delete scene.settings[field.key];
  const fallback=rootsEditorActionFor(scene,'roots-tone');expect(fallback).toEqual({kind:'hot',command:{kind:'tone',tone:{brightness:1,contrast:1,gamma:2.2,dynamicRange:1,saturation:1,dotSize:scene.rootsPresentation!.dotSize}}});
  Object.assign(scene.settings,{rootSourceBrightness:7,rootSourceContrast:.0123,rootSourceGamma:12.34,rootSourceDynamicRange:.333,rootSourceSaturation:.25,rootSourcePaletteOffset:90});
  expect(rootsEditorActionFor(scene,'roots-tone')).toEqual({kind:'hot',command:{kind:'tone',tone:{brightness:7,contrast:.0123,gamma:12.34,dynamicRange:.333,saturation:.25,dotSize:scene.rootsPresentation!.dotSize}}});
  expect(rootsEditorActionFor(scene,'roots-offset')).toEqual({kind:'hot',command:{kind:'offset',offset:90}});delete scene.settings.rootSourcePaletteOffset;expect(rootsEditorActionFor(scene,'roots-offset')).toEqual({kind:'hot',command:{kind:'offset',offset:0}});
 });

 it('preserves absent, empty and raw palettes instead of interpreting or filling them at the UI boundary',()=>{
  const scene=source();for(const palette of [undefined,{colors:[]},{colors:['','#80AbCdEf','invalid']}] ){
   scene.rootsSourcePalette=palette;expect(rootsEditorActionFor(scene,'roots-palette')).toEqual({kind:'hot',command:{kind:'palette',palette}});
  }
 });

 it('only Apply carries the author document; stage and metadata contain no runtime payload',()=>{
  const scene=source();scene.rootsPresentation!.mode='point-cloud';scene.rootsPresentation!.camera.zoom=-2;scene.timeline.duration=23;
  for(const [intent,kind]of [['roots-stage','stage'],['roots-metadata','metadata']] as const)expect(rootsEditorActionFor(scene,intent)).toEqual({kind});
  const intent:RootsEditorIntent='roots-apply',action=rootsEditorActionFor(scene,intent);expect(action).toEqual({kind:'apply',scene});expect(action.kind==='apply'&&action.scene).toBe(scene);
 });
});
