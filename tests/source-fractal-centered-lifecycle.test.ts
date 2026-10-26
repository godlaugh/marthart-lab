import {describe,expect,it,vi} from 'vitest';
import {parseProjectFile} from '../src/engine/legacyImport';
import {SourceFractalLiveSession} from '../src/engine/sourceFractalLiveSession';
import {prepareGenerationPresentation} from '../src/engine/generationPresentation';
import {defaultFormulas,formulaPresentation} from '../src/engine/formulas';
import {validateFrameFormulas} from '../src/engine/formulaConfig';
import {FRACTAL_SOURCE_NUMERIC_PROFILE} from '../src/engine/fractalSourcePrecision';
import type {GenerateContext,SceneDocument,SceneOutput} from '../src/types';

type Raster=Extract<SceneOutput,{type:'raster'}>;
function scene(){
 const s=parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'FRACTAL',name:'centered labels',fractal:{formula_id:'newton'},timeline:[{type:'wait',duration:.2}]})).scene;
 s.formulas={layout:'source-surface-centered-v1',main:{visible:true,x:3,y:-7,scale:.5,color:'#ffffff',anchor:'center',latex:'initial'},additional:[]};return s;
}
const context=(height=12):GenerateContext=>({time:0,quality:'preview',width:16,height:12,fractalPixelDensity:2,fractalViewport:{logicalWidth:32,logicalHeight:height,target:'primary'},fractalLive:{sessionId:'centered',revision:0,intent:'apply',clock:{paused:true,timestampMs:100},actualFrameRate:60}});
// These CPU renderer stubs isolate real Scene, queue, display and formula owners.
// They do not claim GPU pixels or original application glyph compositing.
const raster=(c:GenerateContext):Raster=>({type:'raster',width:c.width,height:c.height,pixels:new Uint8ClampedArray(c.width*c.height*4),stats:{samples:1,generated:1,invalid:0},fractalRender:{profile:FRACTAL_SOURCE_NUMERIC_PROFILE,execution:{backend:'webgl2'},rasterSize:[c.width,c.height]} as unknown as NonNullable<Raster['fractalRender']>});
const centered=(output:SceneOutput)=>{const value=output.formulaPresentation;if(value?.layout!=='source-surface-centered-v1')throw Error('centered');return value;};

describe('Fractal centered labels bind the actual target without reconstructing Scene text',()=>{
 it('rebases a same-instance resize to logical height while retaining construction content and label ownership',()=>{
  const s=scene(),render=vi.fn((_s:SceneDocument,c:GenerateContext)=>raster(c)),owner=new SourceFractalLiveSession(render);
  const first=owner.generate(s,context());centered(first).labels[0].latex='consumer mutation';
  const draft=structuredClone(s);draft.formulas!.main.latex='staged author';
  const resized=owner.generate(draft,context(48));
  expect(centered(resized)).toMatchObject({primaryLogicalHeight:48,labels:[{latex:'initial',x:3,y:-7}]});
  expect(render).toHaveBeenCalledTimes(2);expect(owner.matchesCompletedPrimary(draft,context())).toBe(false);
  expect(owner.matchesCompletedPrimary(draft,context(48))).toBe(true);
 });
 it('keeps the latest completed primary height through paused capture, scale-three recording and stop',()=>{
  const s=scene(),inputs:GenerateContext[]=[],owner=new SourceFractalLiveSession((_s,c)=>{inputs.push(structuredClone(c));return raster(c);}),c=context(48);
  const first=owner.generate(s,c),captured=owner.capturePaused(s,{...c,width:30,height:20});
  expect(inputs.slice(1).map(v=>v.fractalViewport)).toEqual([
   {logicalWidth:15,logicalHeight:10,referenceLogicalHeight:48,target:'offscreen'},c.fractalViewport,
  ]);
  expect(captured.capture.formulaPresentation).toEqual(first.formulaPresentation);expect(captured.preview.formulaPresentation).toEqual(first.formulaPresentation);
  const start=owner.beginRecording(s,c,{width:20,height:10,simulationFps:60});
  expect(inputs.at(-1)!.fractalViewport).toMatchObject({referenceLogicalHeight:48,target:'offscreen'});
  expect(start.warmup.formulaPresentation).toEqual(first.formulaPresentation);
  expect(owner.nextRecordingFrame(start.handle,1).formulaPresentation).toEqual(first.formulaPresentation);
  const stop=owner.finishRecording(start.handle,200);expect(stop.preview.formulaPresentation).toEqual(first.formulaPresentation);
  expect(stop.context.fractalViewport).toEqual(c.fractalViewport);
 });
 it('rejects an invalid resize before host mutation and keeps the previous completed capability',()=>{
  const s=scene(),render=vi.fn((_s:SceneDocument,c:GenerateContext)=>raster(c)),owner=new SourceFractalLiveSession(render),c=context();
  owner.generate(s,c);const before=owner.diagnostics();
  expect(()=>owner.generate(s,context(0))).toThrow('主画布');
  expect(owner.diagnostics()).toEqual(before);expect(owner.matchesCompletedPrimary(s,c)).toBe(true);expect(render).toHaveBeenCalledTimes(1);
 });
 it('validates a hidden source layout too, with no fabricated primary height',()=>{
  const s=scene();s.formulas!.main.visible=false;
  const render=vi.fn((_s:SceneDocument,c:GenerateContext)=>raster(c)),owner=new SourceFractalLiveSession(render);
  expect(()=>owner.generate(s,context(NaN))).toThrow('主画布');expect(render).not.toHaveBeenCalled();
  const first=owner.generate(s,context(48));expect(centered(first)).toEqual({layout:'source-surface-centered-v1',primaryLogicalHeight:48,labels:[]});
 });
 it('captures async viewport values before a delayed render and does not publish a later caller resize',async()=>{
  let resolve!:(value:SceneOutput)=>void;let pending:GenerateContext|undefined;
  const owner=new SourceFractalLiveSession(undefined,{asyncRender:(_s,c)=>{pending=c;return new Promise(done=>{resolve=done;});}}),s=scene(),c=context(48);
  const promise=owner.generateAsync(s,c);c.fractalViewport!.logicalHeight=99;
  for(let i=0;i<4;i++)await Promise.resolve();expect(pending!.fractalViewport!.logicalHeight).toBe(48);
  resolve(raster(pending!));expect(centered(await promise).primaryLogicalHeight).toBe(48);
 });
});

describe('cold Fractal formula viewport admission',()=>{
 const cold=(referenceLogicalHeight?:number):GenerateContext=>({time:0,quality:'export',width:80,height:60,fractalViewport:{logicalWidth:80,logicalHeight:60,target:'offscreen',referenceLogicalHeight},sourceViewport:{logicalWidth:100,logicalHeight:100,referenceLogicalHeight:100,target:'primary',projectionPass:'unknown'}});
 it('uses fractalViewport rather than an unrelated camera and freezes initial text across progress and completion',()=>{
  const s=scene(),frames:SceneOutput[]=[],c={...cold(48),onProgress:(value:SceneOutput)=>frames.push(value)},prepared=prepareGenerationPresentation(s,c);
  s.formulas!.main.latex='after construction';prepared.context.onProgress!(raster(c));
  const output=prepared.complete(raster(c));expect(centered(output)).toMatchObject({primaryLogicalHeight:48,labels:[{latex:'initial'}]});
  expect(frames[0].formulaPresentation).toEqual(output.formulaPresentation);
  expect(()=>validateFrameFormulas(output.formulaPresentation,c.sourceViewport)).toThrow('不匹配');
 });
 it.each([undefined,0,NaN,1.5])('rejects missing or invalid explicit offscreen primary height: %s',height=>{
  const s=scene();s.formulas!.main.visible=false;
  expect(()=>prepareGenerationPresentation(s,cold(height))).toThrow('主画布');
 });
 it('preserves legacy generic saved layout without requiring source viewport facts',()=>{
  const s=scene();s.formulas=defaultFormulas();s.formulas.main.visible=true;
  const c:GenerateContext={time:0,quality:'export',width:8,height:6};
  expect(prepareGenerationPresentation(s,c).complete(raster(c)).formulaPresentation).toEqual(formulaPresentation(s));
 });
});
