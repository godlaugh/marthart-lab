import {hasMathematicalPlane,isRaymarchScene,supportsCameraActions} from '../src/engine/sceneCamera';
import {planeNavigation,fitPlane} from '../src/engine/planeNavigation';
import {describe,expect,it} from 'vitest';
import {sourceFractalFormulaIdentity,activeFractalFormulaIdentity} from '../src/engine/sourceFractalIdentity';
import {supportsFractalSourceColor} from '../src/engine/fractalSourceColorAuthoring';
import {supportsGradientOffsets,gradientAnimationCapabilities} from '../src/engine/gradientOffsets';
import {createSourceFractalFormulaFromConfig} from '../src/engine/sourceFractalFormulaRuntime';
import {createScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {FRACTAL_SOURCE_COLOR_PROFILE} from '../src/engine/fractalSourceColor';
import {FRACTAL_SOURCE_NUMERIC_PROFILE} from '../src/engine/fractalPrecision';
function source(){const scene=createScene(definition('fractal'));scene.fractalSource={model:'mathart-1.7.8-scene-v1',formula:{formulaId:'newton',fractalType:'mandelbrot',power:3,formulaParams:[3,1,0,0],bailout:.001,julia:[0,0]}};scene.settings.fractalColorProfile=FRACTAL_SOURCE_COLOR_PROFILE;return scene;}
describe('source formula identity ownership',()=>{
 it.each([undefined,null,'','\t\n','\u2003'])('uses native fallback for absent/Java-blank ID %j',formulaId=>{const config={formulaId,fractalType:'julia' as const};expect(sourceFractalFormulaIdentity(config)).toBe('julia');expect(createSourceFractalFormulaFromConfig({...config,power:2,formulaParams:[2,0,0,0],bailout:4,julia:[.2,.3]}).snapshot().formulaId).toBe('julia');});
 it.each([' newton ','NEWTON','\u00a0'])('retains nonblank registry identity %j exactly',formulaId=>{expect(sourceFractalFormulaIdentity({formulaId,fractalType:'mandelbrot'})).toBe(formulaId);});
 it('uses source identity across stale local formula and numeric-profile fields',()=>{const scene=source();Object.assign(scene.settings,{formula:'mandelbulb_3d',fractalNumericProfile:'invalid dormant value'});expect(activeFractalFormulaIdentity(scene)).toBe('newton');expect(supportsFractalSourceColor(scene)).toBe(true);expect(supportsGradientOffsets(scene)).toBe(true);expect(gradientAnimationCapabilities(scene)).toMatchObject({localPalette:false,offsets:true,paletteOffsetTarget:'fractalColor.paletteOffset'});});
 it('does not allow local Newton settings to enable unsupported source identity',()=>{const scene=source();scene.fractalSource!.formula={...scene.fractalSource!.formula,formulaId:' '};Object.assign(scene.settings,{formula:'newton',fractalNumericProfile:FRACTAL_SOURCE_NUMERIC_PROFILE});expect(activeFractalFormulaIdentity(scene)).toBe('mandelbrot');expect(supportsFractalSourceColor(scene)).toBe(false);expect(supportsGradientOffsets(scene)).toBe(false);expect(gradientAnimationCapabilities(scene).localPalette).toBe(false);});
 it('keeps the source Newton viewport planar while dormant legacy settings select a bulb',()=>{
  const scene=source();Object.assign(scene.settings,{formula:'mandelbulb_3d',fractalNumericProfile:'invalid dormant value',zoom:2,centerX:.125,centerY:.25});const before=structuredClone(scene);
  expect(isRaymarchScene(scene)).toBe(false);expect(hasMathematicalPlane(scene)).toBe(true);expect(supportsCameraActions(scene)).toBe(false);
  const view=planeNavigation(scene,800,600);expect(view.kind).toBe('fractal');expect(view.spanY).toBe(1);expect(view.fractalViewport!.rules).toMatchObject({sourceNewtonNova:true,yDirection:'down'});expect(fitPlane(scene).centerX).toBe(0);expect(scene).toEqual(before);
  delete scene.fractalSource;expect(isRaymarchScene(scene)).toBe(true);expect(hasMathematicalPlane(scene)).toBe(false);
 });
 it('retains old document capability rules when source payload is absent',()=>{const scene=source();delete scene.fractalSource;scene.settings.formula='newton';scene.settings.fractalNumericProfile=FRACTAL_SOURCE_NUMERIC_PROFILE;expect(supportsFractalSourceColor(scene)).toBe(true);scene.settings.fractalNumericProfile='local-v1';expect(supportsFractalSourceColor(scene)).toBe(false);scene.settings.formula='mandelbulb_3d';expect(supportsGradientOffsets(scene)).toBe(false);});
});
