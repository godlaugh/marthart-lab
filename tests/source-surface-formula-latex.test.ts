import {describe,it,expect} from 'vitest';
import {sourceSurfaceFormulaLatex} from '../src/engine/sourceSurfaceFormulaLatex';
import {parseProjectFile} from '../src/engine/legacyImport';
import {parseScene} from '../src/engine/document';
import {SourceSurfaceLiveSession} from '../src/engine/sourceSurfaceLiveSession';
import {ordinarySourceViewport} from '../src/engine/ordinarySourceCamera';
import {formulaLabels} from '../src/engine/formulas';
import {renderFormulaSvg} from '../src/engine/formulaSvg';
import type {GenerationInput} from '../src/types';
import fixture from './fixtures/source-surface-formula-labels/source.json';

describe('original Surface automatic equation labels',()=>{
 it.each(fixture.cases)('matches the executed original builder: $input.name',({input,output})=>{
  expect(sourceSurfaceFormulaLatex({...input,parameters:(input.parameters??{}) as Record<string,number>})).toBe(output.latex);
 });
 function imported(){
  const input=fixture.cases.find(c=>c.input.name==='Cornucopia')!.input;
  return parseProjectFile(JSON.stringify({...input,config_version:'1.0.0',type:'SURFACE',settings:{render_mode:'CPU',surface_mode:'POINTS',u_segments:3,v_segments:3,u_min:0,u_max:1,v_min:0,v_max:1,scale_x:1,scale_y:1,scale_z:1,speed_u:0,speed_v:0,show_trails:false},camera:{phi:0,theta:0,gamma:0},timeline:[{type:'wait',duration:1}]})).scene;
 }
 it('carries the source label through import, save/reopen, applied preview, capture and retained recording',()=>{
  const scene=parseScene(JSON.stringify(imported())),expected=fixture.cases.find(c=>c.input.name==='Cornucopia')!.output.latex;
  expect(formulaLabels(scene)[0].latex).toBe(expected);expect(renderFormulaSvg(expected,'#ffffff').source).toContain('<path');
  const context:GenerationInput={time:0,width:200,height:200,quality:'preview',sourcePointPixelDensity:1,sourceViewport:ordinarySourceViewport(scene,200,200,'primary',200),surfaceLive:{sessionId:'native-label',revision:0,clock:{paused:true,timestampMs:0},actualFrameRate:60}};
  const owner=new SourceSurfaceLiveSession(),first=owner.generate(scene,context),draft=structuredClone(scene);
  draft.name='unapplied';draft.equations.x='u+v';draft.parameters.a=42;
  expect(first.formulaPresentation!.labels[0].latex).toBe(expected);
  const captured=owner.capturePaused(draft,context,{width:500,height:600},1);expect(captured.capture.formulaPresentation!.labels[0].latex).toBe(expected);
  const recording=owner.beginRecording(draft,context,{width:200,height:200,simulationFps:10,actualFrameRate:60});expect(recording.warmup.formulaPresentation!.labels[0].latex).toBe(expected);
  const next=owner.nextRecordingFrame(recording.handle,1,60);expect(next.formulaPresentation!.labels[0].latex).toBe(expected);owner.finishRecording(recording.handle,1000);
  const applied=owner.generate(draft,{...context,surfaceLive:{...context.surfaceLive!,revision:1,configuration:draft}});expect(applied.formulaPresentation!.labels[0].latex).toContain('\\text{unapplied}');expect(applied.formulaPresentation!.labels[0].latex).toContain('x = u + v');owner.reset();
 });
 it('retains an explicit local TeX override and rejects unsupported automatic input without a different parser fallback',()=>{
  const scene=imported();scene.formulas!.main.latex='local_override';expect(formulaLabels(scene)[0].latex).toBe('local_override');
  delete scene.formulas!.main.latex;scene.equations.x='u>v?u:v';expect(()=>formulaLabels(scene)).toThrow('原版曲面主方程');
 });
});
