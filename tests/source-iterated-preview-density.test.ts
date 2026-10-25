import {describe,it,expect} from 'vitest';
import {previewProfile} from '../src/engine/preferences';
import {sourceIteratedPreviewPixelDensity} from '../src/engine/sourceIteratedPresentation';
import type {SceneOutput} from '../src/types';
type Raster=Extract<SceneOutput,{type:'raster'}>;
function image(family:'map'|'symmetry',density=2):Raster {
 // Only response facts consumed at this boundary; no live token is required.
 return {type:'raster',width:405*density,height:486*density,[family==='map'?'sourceMapPresentation':'sourceSymmetryPresentation']:{reference:{width:405*density,height:486*density}},sourceCameraFrame:{viewport:{logicalWidth:405,logicalHeight:486,referenceLogicalHeight:486,target:'primary'}}} as unknown as Raster;
}
describe('completed iterated primary density for cold export',()=>{
 it('selects integer Processing density before viewport sizing while retaining ordinary fractional display ratios',()=>{
  for(const [device,selected] of [[1.25,1],[1.5,2],[2,2]]){expect(previewProfile('standard',device,{integerPixelDensity:true}).pixelRatio).toBe(selected);expect(previewProfile('standard',device).pixelRatio).toBe(device);}
  expect(previewProfile('low',1.5,{integerPixelDensity:true}).pixelRatio).toBe(1);expect(previewProfile('high',1.25,{integerPixelDensity:true}).pixelRatio).toBe(2);
 });
 it.each(['map','symmetry'] as const)('retains the %s completed frame density without live state or ambient display measurements',family=>{
  for(const density of [1,2,3])expect(sourceIteratedPreviewPixelDensity(image(family,density))).toBe(density);
 });
 it('rejects offscreen, inconsistent or incomplete facts instead of inventing a primary density',()=>{
  const value=image('symmetry');expect(sourceIteratedPreviewPixelDensity({...value,height:value.height+1})).toBeUndefined();
  expect(sourceIteratedPreviewPixelDensity({...value,sourceCameraFrame:undefined})).toBeUndefined();
  expect(sourceIteratedPreviewPixelDensity({...value,sourceSymmetryPresentation:undefined})).toBeUndefined();
  const offscreen={...value,sourceCameraFrame:{...value.sourceCameraFrame!,viewport:{...value.sourceCameraFrame!.viewport,target:'offscreen' as const}}};expect(sourceIteratedPreviewPixelDensity(offscreen)).toBeUndefined();
  expect(sourceIteratedPreviewPixelDensity(null)).toBeUndefined();
 });
});
