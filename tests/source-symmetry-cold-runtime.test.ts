import {describe,it,expect} from 'vitest';
import native from './fixtures/symmetry/cold-runtime-20261025.json';
import {parseProjectFile} from '../src/engine/legacyImport';
import {parseScene,serializeScene} from '../src/engine/document';
import {writeSourceSymmetryPointSize,sourceSymmetryPointSize,editSourceSymmetryConfiguration,sourceSymmetryInitialSeed} from '../src/engine/sourceSymmetryConfig';
import {ensureSymmetryPaletteSession,applySymmetrySourcePalette,restartSymmetrySourcePalette,retainSymmetryPaletteOnSave,symmetryPaletteColdAnchor,retainSymmetryPaletteAfterRecording} from '../src/engine/sourceSymmetryPaletteEditing';
import {sourceIteratedApplyIdentity,sourceIteratedReplayIdentity,sourceIteratedSceneIdentity} from '../src/engine/sourceIteratedLiveIdentity';
import {iteratedBaselineKey} from '../src/engine/iteratedIdentity';
import {prepareIteratedFrame} from '../src/scenes/iteratedDensity';
import {prepareSourceDensitySplat} from '../src/engine/sourceDensitySplat';
import {prepareSourceIterationFramePlan} from '../src/engine/sourceIterationFramePlan';
import type {SceneDocument} from '../src/types';

const make=()=>ensureSymmetryPaletteSession(parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'SYMMETRY_CHAOS',name:'Native cold runtime',palette:['#ffffff','#222222'],settings:{batch_size:8,burn_in_steps:native.authoredBurnIn,dot_size:native.authorDotSize},timeline:[{type:'wait',duration:1}]})).scene);
function hot(scene:SceneDocument,value:number){const result=writeSourceSymmetryPointSize({...scene,settings:{...scene.settings,pointSize:value}},value);if(!result.ok)throw Error(result.error.reason);return result.value;}

describe('actual original Symmetry constructor and hot setter ownership',()=>{
 it('matches original CPU setter calls, including explicit same-author input and clamp before export scaling',()=>{
  const cold=make();let scene=cold;
  expect(prepareIteratedFrame(cold,0,0).config.pointSize).toBe(native.coldPointSize);
  expect(cold.settings.pointSize).toBe(native.authorDotSize);
  for(const call of native.calls){
   const bits=new DataView(new ArrayBuffer(4));bits.setInt32(0,call.argumentFloatBits);scene=hot(scene,bits.getFloat32(0));
   expect(prepareIteratedFrame(scene,0,0).config.pointSize).toBe(call.result);
   expect(sourceIteratedApplyIdentity(scene)).toBe(sourceIteratedApplyIdentity(cold));
   expect(sourceIteratedReplayIdentity(scene)).toBe(sourceIteratedReplayIdentity(cold));
   expect(sourceSymmetryInitialSeed(scene.symmetrySource!)).toBe(sourceSymmetryInitialSeed(cold.symmetrySource!));
  }
  const sameAuthor=hot(cold,native.authorDotSize);
  expect(sourceIteratedSceneIdentity(sameAuthor)).not.toBe(sourceIteratedSceneIdentity(cold));
  expect(iteratedBaselineKey(sameAuthor)).not.toBe(iteratedBaselineKey(cold));
  expect(prepareSourceDensitySplat('symmetry',prepareIteratedFrame(hot(cold,.5),0,0).config.pointSize,3).radius).toBe(3);
 });
 it('retains consumed hot state in history and after Save, but strips it from files and cold resets',()=>{
  const cold=make(),edited=hot(cold,5),saved=parseScene(serializeScene(edited));
  for(const scene of [structuredClone(edited),retainSymmetryPaletteOnSave(edited,saved)])expect(sourceSymmetryPointSize(scene)).toBe(5);
  expect(saved.settings.pointSize).toBe(5);expect(saved).not.toHaveProperty('symmetryRuntimePointSize');
  const untrusted=parseScene(JSON.stringify({...saved,symmetryRuntimePointSize:'bad'}));
  for(const scene of [saved,untrusted,restartSymmetrySourcePalette(edited),applySymmetrySourcePalette(edited),editSourceSymmetryConfiguration(edited,edited,'apply'),retainSymmetryPaletteAfterRecording(edited,structuredClone(symmetryPaletteColdAnchor(edited)))])expect(sourceSymmetryPointSize(scene)).toBe(native.coldPointSize);
  // Old canonical source documents can lack the later raw palette metadata.
  const {symmetrySourcePalette:_,symmetryPaletteSession:__,...old}=edited;
  expect(sourceSymmetryPointSize(restartSymmetrySourcePalette(old))).toBe(native.coldPointSize);
  expect(sourceSymmetryPointSize(applySymmetrySourcePalette(old))).toBe(native.coldPointSize);
 });
 it('uses the consumed value for fixed previews and rejects malformed internal state without accepting it from a file',()=>{
  const fixed={...make(),settings:{...make().settings,iteratedStartTime:.25,recordTrails:false}};
  expect(prepareIteratedFrame(fixed,.25,0).config.pointSize).toBe(native.coldPointSize);
  expect(prepareIteratedFrame(hot(fixed,4),.25,0).config.pointSize).toBe(4);
  for(const value of [NaN,Infinity,1e40,'1.5',null])expect(writeSourceSymmetryPointSize(fixed,value).ok).toBe(false);
  for(const value of [NaN,Infinity,.5,1.8])expect(()=>sourceSymmetryPointSize({...fixed,symmetryRuntimePointSize:value})).toThrow('运行点径状态无效');
 });
 it('matches actual first-frame update work without truncating authored burn-in',()=>{
  const scene=make(),job=prepareIteratedFrame(scene,0,0),first=prepareSourceIterationFramePlan('symmetry',{frameIndex:0,updateCount:2},false,job.config.burn,1);
  expect(job.config.burn).toBe(native.authoredBurnIn);
  expect(first.warmupSteps).toBe(native.firstFrameUpdateIterations[0]);
  expect(first.iterationSteps).toBe(native.firstFrameUpdateIterations.slice(1).reduce((sum,n)=>sum+n,0));
  expect(prepareSourceIterationFramePlan('symmetry',{frameIndex:0,updateCount:0},false,job.config.burn,1)).toMatchObject({warmupSteps:0,warmupApplied:false});
  expect(prepareSourceIterationFramePlan('symmetry',{frameIndex:1,updateCount:2},true,job.config.burn,1)).toMatchObject({warmupSteps:0,iterationSteps:2});
 });
});
