import {afterEach,describe,expect,it,vi} from 'vitest';
import {parseProjectFile} from '../src/engine/legacyImport';
import {defaultFormulas,formulaPresentation} from '../src/engine/formulas';
import {generateScene} from '../src/engine/temporal';
import {SourceFractalLiveSession,type SourceFractalLiveContext} from '../src/engine/sourceFractalLiveSession';
import {definition} from '../src/scenes';
import {FRACTAL_SOURCE_NUMERIC_PROFILE} from '../src/engine/fractalSourcePrecision';
import type {GenerateContext,SceneDocument,SceneOutput} from '../src/types';
type Raster=Extract<SceneOutput,{type:'raster'}>;

function scene(){
 const s=parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'FRACTAL',name:'frozen source labels',fractal:{formula_id:'nova',type:'JULIA',parameters:{exponent:[3,.25],relaxation:.5,julia_seed:[.1,-.2]}},timeline:[{type:'animate',duration:0,actions:[{method:'paramStart',args:{parameters:{exponent_re:{step:.1,min:2,max:4}}}}]},{type:'wait',duration:1}]})).scene;
 s.formulas=defaultFormulas();s.formulas.main.visible=true;s.formulas.additional=[{id:'note',latex:'a=1',visible:true,x:100,y:200,scale:1.5,color:'#ff0000'}];return s;
}
// Deliberately partial render-fact stub: only fields inspected by the recording
// binder are supplied. This isolates annotation ownership, not renderer evidence.
const raster=(c:GenerateContext):Raster=>({type:'raster',width:c.width,height:c.height,pixels:new Uint8ClampedArray(c.width*c.height*4),stats:{samples:1,generated:1,invalid:0},fractalRender:{profile:FRACTAL_SOURCE_NUMERIC_PROFILE,execution:{backend:'webgl2'},rasterSize:[c.width,c.height]} as unknown as NonNullable<Raster['fractalRender']>});
const input=(live:Partial<SourceFractalLiveContext>={},timestampMs=50):GenerateContext=>({time:0,quality:'preview',width:16,height:12,fractalPixelDensity:1,fractalViewport:{logicalWidth:16,logicalHeight:12,target:'primary'},fractalLive:{sessionId:'labels',revision:0,intent:'apply',actualFrameRate:60,clock:{paused:false,timestampMs},...live}});
function changed(s:SceneDocument){
 const result=structuredClone(s),formula=result.fractalSource!.formula;
 result.fractalSource!.formula={...formula,parameters:{...formula.parameters!,complex:{...formula.parameters!.complex,exponent:[5,-.75]}}};
 result.formulas!.main.color='#00ff00';result.formulas!.main.scale=2;if(result.formulas!.additional[0])result.formulas!.additional[0].latex='a=2';result.formulas!.referenceWidth=640;return result;
}
afterEach(()=>vi.restoreAllMocks());
describe('source Fractal annotation facts belong to the rendered Scene construction',()=>{
 for(const ordinal of [false,true])it(`delivers initial labels with actual animated fresh ${ordinal?'ordinal':'time'} state and every progress pass`,()=>{
  const s=scene(),expected=formulaPresentation(s),observed:SceneDocument[]=[],progress:Raster[]=[];
  // Exercise the public numerical producer and its progressive binder. Pixels
  // are isolated here; browser export tests own real WebGL/compositor coverage.
  vi.spyOn(definition('fractal'),'generate').mockImplementation((current,c)=>{observed.push(current);c.onProgress?.(raster(c));return raster(c);});
  const c:GenerateContext={time:.5,quality:'export',width:8,height:6,onProgress:value=>{if(value.type!=='raster')throw Error('raster');progress.push(structuredClone(value));value.formulaPresentation!.labels[0].latex='consumer mutation';}};
  if(ordinal)c.fractalRecording={displayFrame:30,simulationFps:s.timeline.fps};
  const output=generateScene(s,c);if(output.type!=='raster')throw Error('raster');
  expect(observed).toHaveLength(1);expect(observed[0].evaluatedFractalScene!.formula.native.dynamicParams[0]).not.toBe(3);
  expect(progress).toHaveLength(1);expect(progress[0].formulaPresentation).toEqual(expected);expect(output.formulaPresentation).toEqual(expected);
  if(ordinal)expect(output.fractalRecording?.displayFrame).toBe(30);
 });
 it('delivers authoritative empty fresh facts without adopting a renderer-provided label',()=>{
  const s=scene();s.formulas!.main.visible=false;s.formulas!.additional=[];
  vi.spyOn(definition('fractal'),'generate').mockImplementation((_current,c)=>({...raster(c),formulaPresentation:formulaPresentation(scene())}));
  const output=generateScene(s,{time:.5,quality:'export',width:8,height:6});if(output.type!=='raster')throw Error('raster');
  expect(output.formulaPresentation).toEqual({referenceWidth:1280,referenceHeight:720,labels:[]});
 });
 it('retains label text and layout through animation, hot, paused Apply, capture and anchor recording, then rebuilds on running Apply',()=>{
  const owner=new SourceFractalLiveSession((_scene,c)=>raster(c)),s=scene(),expected=formulaPresentation(s),initial=input();
  const first=owner.generate(s,initial),animated=owner.generate(s,input({},100));
  expect(animated.fractalLive!.presentation.evaluatedFractalScene!.formula.native.dynamicParams[0]).not.toBe(first.fractalLive!.presentation.evaluatedFractalScene!.formula.native.dynamicParams[0]);
  expect(animated.formulaPresentation).toEqual(expected);first.formulaPresentation!.labels[0].latex='consumer mutation';
  const draft=changed(s),hotContext=input({revision:1,intent:'hot',configuration:draft},150),hot=owner.generate(draft,hotContext);
  expect(hot.fractalLive!.presentation.evaluatedFractalScene!.formula.native.dynamicParams[0]).toBe(5);expect(hot.formulaPresentation).toEqual(expected);
  owner.setPaused(true);const pausedContext=input({revision:2,intent:'apply',configuration:draft,clock:{paused:true}}),paused=owner.generate(draft,pausedContext);
  expect(paused.formulaPresentation).toEqual(expected);const before=owner.diagnostics(),capture=owner.capturePaused(draft,{...pausedContext,width:20,height:15});
  expect(capture.capture.formulaPresentation).toEqual(expected);expect(capture.preview.formulaPresentation).toEqual(expected);expect(owner.diagnostics()).toEqual(before);
  capture.capture.formulaPresentation!.labels[1].latex='capture mutation';
  const record=owner.beginRecording(draft,pausedContext,{width:16,height:12,simulationFps:60});expect(record.warmup.formulaPresentation).toEqual(expected);
  record.warmup.formulaPresentation!.labels[0].color='#000000';const frame=owner.nextRecordingFrame(record.handle,1);expect(frame.formulaPresentation).toEqual(expected);
  const stop=owner.finishRecording(record.handle,1000);expect(stop.preview.formulaPresentation).toEqual(expected);
  const applied=owner.generate(draft,input({revision:3,intent:'apply',configuration:draft},1100));expect(applied.formulaPresentation).toEqual(formulaPresentation(draft));expect(applied.formulaPresentation).not.toEqual(expected);
  const newRecording=owner.beginRecording(draft,input({revision:3,intent:'apply'},1100),{width:16,height:12,simulationFps:60});expect(newRecording.warmup.formulaPresentation).toEqual(formulaPresentation(draft));owner.finishRecording(newRecording.handle,1200);
 });
 it('does not enable initial hidden labels through stage or hot changes before full reconstruction',()=>{
  const owner=new SourceFractalLiveSession((_scene,c)=>raster(c)),s=scene();s.formulas!.main.visible=false;s.formulas!.additional=[];
  const initial=owner.generate(s,input()),draft=changed(s);draft.formulas!.main.visible=true;
  expect(initial.formulaPresentation!.labels).toEqual([]);expect(owner.generate(draft,input({},100)).formulaPresentation!.labels).toEqual([]);
  expect(owner.generate(draft,input({revision:1,intent:'hot',configuration:draft},150)).formulaPresentation!.labels).toEqual([]);
  expect(owner.generate(draft,input({revision:2,intent:'apply',configuration:draft},200)).formulaPresentation!.labels).toHaveLength(1);
 });
});
