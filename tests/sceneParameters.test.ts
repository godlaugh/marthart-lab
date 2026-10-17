import {describe,expect,it} from 'vitest';
import {animationTargetChoices,genericParameterNotice,genericParameterTargets,genericParameterTimelineWarning,supportsGenericParameters} from '../src/engine/sceneParameters';
import {createAnimationTrack,sceneAtTime,timelineWarnings} from '../src/engine/timeline';
import {createScene,parseScene} from '../src/engine/document';
import {mainEquation} from '../src/engine/formulas';
import {definitions} from '../src/scenes/complex';
import {translate} from '../src/i18n';

function fractal(){const scene=createScene(definitions.find(d=>d.kind==='fractal')!);scene.parameters={oldConstant:2};scene.timeline.tracks=[];scene.settings.fractalBackend='cpu';return scene;}

describe('generic parameter capability and retained Fractal data',()=>{
 it('offers new named targets only for consumers of generic parameters',()=>{
  const source=fractal();expect(supportsGenericParameters(source)).toBe(false);expect(genericParameterTargets(source)).toEqual([]);
  const domain={...source,kind:'domain' as const};expect(supportsGenericParameters(domain)).toBe(true);expect(genericParameterTargets(domain)).toEqual(['parameters.oldConstant']);expect(genericParameterNotice(domain)).toBeUndefined();
  for(const type of ['numeric','param'] as const){const track=createAnimationTrack(source,type);expect(track.target).toBe('palette.offset');expect(track.parameterAnimations?.[0].target??track.target).toBe('palette.offset');}
  expect(createAnimationTrack(domain).target).toBe('parameters.oldConstant');
 });
 it('keeps an unavailable selected target explicit without offering new inert choices',()=>{
  expect(animationTargetChoices(['palette.offset','palette.offset'],'parameters.oldConstant')).toEqual([{value:'parameters.oldConstant',retained:true},{value:'palette.offset',retained:false}]);
  expect(animationTargetChoices(['palette.offset'],'palette.offset')).toEqual([{value:'palette.offset',retained:false}]);
 });
 it('round-trips old numeric, parameter and action targets without mutating the document',()=>{
  const source=fractal(),numeric={...createAnimationTrack(source),target:'parameters.oldConstant',from:2,to:6,duration:2,easing:'linear'};
  const parameter={...createAnimationTrack(source,'param'),parameterAnimations:[{target:'parameters.oldConstant',min:1,max:3,step:1,enabled:true}]};
  const action={...createAnimationTrack(source,'animate'),actions:[{id:'start',method:'paramStart',parameters:parameter.parameterAnimations},{id:'stop',method:'paramStop',args:{target:'parameters.oldConstant'}}]};
  source.timeline.tracks=[numeric,parameter,action];const before=structuredClone(source),parsed=parseScene(JSON.stringify(source));
  expect(parsed.timeline.tracks).toEqual(source.timeline.tracks);expect(parsed.parameters).toEqual(source.parameters);
  expect(genericParameterTimelineWarning(parsed)).toContain('parameters.oldConstant');expect(timelineWarnings(parsed)).toContain(genericParameterTimelineWarning(parsed));
  source.timeline.tracks=[numeric];expect(sceneAtTime(source,1).parameters.oldConstant).toBe(4);expect(source.parameters).toEqual(before.parameters);
  expect(genericParameterTimelineWarning({...parsed,kind:'domain'})).toBeUndefined();
 });
 it('does not claim generic Fractal values affect recurrence or displayed equations',()=>{
  const source=fractal(),definition=definitions.find(d=>d.kind==='fractal')!,context={time:0,width:32,height:24,quality:'export' as const};
  const first=definition.generate(source,context);source.parameters.oldConstant=12345;const changed=definition.generate(source,context);
  expect(first.type).toBe('raster');expect(changed.type).toBe('raster');if(first.type!=='raster'||changed.type!=='raster')throw Error('Expected raster');expect(changed.pixels).toEqual(first.pixels);
  const equation=mainEquation(source);source.parameters.oldConstant=-999;expect(mainEquation(source)).toBe(equation);
  source.settings.power=3;const dedicated=definition.generate(source,context);if(dedicated.type!=='raster')throw Error('Expected raster');expect(dedicated.pixels).not.toEqual(first.pixels);expect(mainEquation(source)).not.toBe(equation);
 });
 it('translates notices and retained targets while preserving arbitrary user names',()=>{
  const source=fractal();source.timeline.tracks=[{...createAnimationTrack(source),target:'parameters.oldConstant'}];
  expect(translate('en',genericParameterNotice(source)!)).toContain('do not drive the fractal recurrence');
  const warning=translate('en',genericParameterTimelineWarning(source)!);expect(warning).toContain('parameters.oldConstant');expect(warning).toContain('do not affect the fractal recurrence');expect(warning).not.toMatch(/[\u3400-\u9fff]/);
  expect(translate('en','{target}（保留）',{target:'parameters.用户值'})).toBe('parameters.用户值 (retained)');
 });
});
