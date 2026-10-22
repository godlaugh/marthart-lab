import * as formulas from '../src/engine/formulas';
import {describe,it,expect,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {parseProjectFile} from '../src/engine/legacyImport';
import {parseScene,createScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {defaultFormulas,formulaPlacement,formulaPresentation,validateFormulas,validateFormulaPresentation} from '../src/engine/formulas';
import {validateFrameFormulas} from '../src/engine/formulaConfig';
import {ordinarySourceViewport} from '../src/engine/ordinarySourceCamera';
import {SourceSurfaceLiveSession} from '../src/engine/sourceSurfaceLiveSession';
import {generateSourceSurface} from '../src/scenes/sourceSurface';
import {validSourceSurfaceOutput} from '../src/engine/sourceSurfaceResponse';
import {FormulaEditor} from '../src/components/FormulaEditor';
import type {GenerationInput,FormulaPresentation} from '../src/types';

function imported(){return parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'SURFACE',name:'formula fixture',equations:{x:'u',y:'v',z:'0'},settings:{render_mode:'CPU',surface_mode:'POINTS',u_segments:2,v_segments:2,u_min:0,u_max:1,v_min:0,v_max:1,scale_x:1,scale_y:1,scale_z:1,speed_u:0,speed_v:0,show_trails:false},camera:{phi:0,theta:0,gamma:0},timeline:[{type:'wait',duration:1}],main_equation:{enabled:true,position:[10,20],scale:.25,color:'#FFFFFF',latex:'x=u'},formulas:[{position:[-20,-30],scale:.02,color:'#ff0000',latex:'v=0'}]}));}
function setup(height=100,density=2){const scene=imported().scene,context:GenerationInput={time:0,width:200*density,height:height*density,quality:'preview',sourcePointPixelDensity:density,sourceViewport:ordinarySourceViewport(scene,200,height,'primary',height),surfaceLive:{sessionId:'formula-layout',revision:0,clock:{paused:true,timestampMs:0},actualFrameRate:60}},owner=new SourceSurfaceLiveSession();return{scene,context,owner};}
const glyph={width:200,height:40};
function sourcePresentation(height:number):FormulaPresentation{const s=imported().scene;return formulaPresentation(s,ordinarySourceViewport(s,200,height,'primary',height));}
describe('new source Surface formula layout',()=>{
 it('preserves source centred offsets and scale through project save/reopen without persisting runtime sizes',()=>{
  const result=imported(),scene=parseScene(JSON.stringify(result.scene));
  expect(scene.formulas).toEqual(result.scene.formulas);expect(scene.formulas).toMatchObject({layout:'source-surface-centered-v1',main:{x:10,y:20,scale:.25,anchor:'center'},additional:[{x:-20,y:-30,scale:.02}]});
  expect(scene.formulas).not.toHaveProperty('referenceWidth');expect(scene.formulas).not.toHaveProperty('primaryLogicalHeight');expect(result.scene.provenance?.original).toMatchObject({main_equation:{position:[10,20],scale:.25}});
  const markup=renderToStaticMarkup(<FormulaEditor scene={scene} onChange={()=>{}}/>);expect(markup).toContain('主预览逻辑像素');expect(markup).toContain('水平偏移');expect(markup).not.toContain('1280');expect(markup).not.toContain('位置锚点');
 });
 it('uses height for both signed offsets and glyph scale, independent of target aspect and physical density',()=>{
  const p=sourcePresentation(100),label=p.labels[0];
  expect(formulaPlacement(p,label,200,100,glyph)).toEqual({x:47.5,y:57.5,scale:.625});
  expect(formulaPlacement(p,label,400,100,glyph)).toEqual({x:147.5,y:57.5,scale:.625});
  expect(formulaPlacement(p,label,400,200,glyph)).toEqual({x:95,y:115,scale:1.25});
  expect(formulaPlacement(p,label,600,400,glyph)).toEqual({x:90,y:230,scale:2.5});
  const taller=sourcePresentation(200);expect(formulaPlacement(taller,label,400,200,glyph)).toEqual({x:147.5,y:107.5,scale:.625});
 });
 it('retains legacy local/saved layouts and does not infer a source model for other families',()=>{
  const s=createScene(definition('surface'));s.formulas=defaultFormulas();s.formulas.main={visible:true,x:640,y:520,scale:.625,color:'#ffffff',anchor:'center',latex:'x'};
  const restored=parseScene(JSON.stringify(s)),p=formulaPresentation(restored);expect(p).not.toHaveProperty('layout');expect(formulaPlacement(p,p.labels[0],1280,720,glyph)).toEqual({x:577.5,y:507.5,scale:.625});
  const source=imported().scene;source.formulas=restored.formulas;expect(formulaPresentation(parseScene(JSON.stringify(source)))).toEqual(p);
  const other=createScene(definition('attractor'));other.formulas=imported().scene.formulas;expect(()=>parseScene(JSON.stringify(other))).toThrow('源曲面');
 });
 it('rejects unknown/mixed layout models and invalid or mismatched runtime references',()=>{
  const config=imported().scene.formulas!,p=sourcePresentation(100),viewport=ordinarySourceViewport(imported().scene,200,100,'primary',100);
  for(const value of [{...config,layout:'future'},{...config,referenceWidth:1280},{...config,primaryLogicalHeight:100},{...config,main:{...config.main,anchor:'top-left'}}])expect(()=>validateFormulas(value)).toThrow();
  for(const value of [{...p,primaryLogicalHeight:undefined},{...p,primaryLogicalHeight:0},{...p,primaryLogicalHeight:Infinity},{...p,primaryLogicalHeight:100.5},{...p,referenceHeight:720}])expect(()=>validateFormulaPresentation(value)).toThrow();
  expect(()=>formulaPresentation(imported().scene)).toThrow('实际主画布');expect(()=>formulaPlacement(config,p.labels[0],200,100,glyph)).toThrow('实际主画布');
  expect(()=>validateFrameFormulas({...p,primaryLogicalHeight:200},viewport)).toThrow('不匹配');
 });
 it('binds applied text once and shares actual main height across preview, resize, paused capture and recording',()=>{
  const f=setup(),resolve=vi.spyOn(formulas,'resolveFormulaContent'),first=f.owner.generate(f.scene,f.context),p=first.formulaPresentation!;expect(p).toMatchObject({layout:'source-surface-centered-v1',primaryLogicalHeight:100});
  const draft=structuredClone(f.scene);draft.formulas!.main.latex='staged';draft.formulas!.main.x=999;
  const capture=f.owner.capturePaused(draft,f.context,{width:500,height:600},3);expect(capture.capture.formulaPresentation).toEqual(p);expect(capture.preview.formulaPresentation).toEqual(p);expect(capture.capture.sourceCameraFrame!.viewport).toMatchObject({logicalHeight:300,referenceLogicalHeight:100});
  const record=f.owner.beginRecording(draft,f.context,{width:200,height:100,simulationFps:10,actualFrameRate:60});expect(record.warmup.formulaPresentation).toEqual(p);
  const next=f.owner.nextRecordingFrame(record.handle,1,60);expect(next.formulaPresentation).toEqual(p);const stop=f.owner.finishRecording(record.handle,1000);expect(stop.preview.formulaPresentation).toEqual(p);
  const resized={...stop.context,width:800,height:400,sourceViewport:ordinarySourceViewport(f.scene,400,200,'primary',200),surfaceLive:{...stop.context.surfaceLive!,clock:{paused:false,timestampMs:1000}}};
  const changed=f.owner.generate(draft,resized);expect(changed.formulaPresentation).toMatchObject({primaryLogicalHeight:200,labels:p.labels});
  expect(first.formulaPresentation).toEqual(p);expect(changed.formulaPresentation).not.toBe(p);expect(resolve).toHaveBeenCalledTimes(2);resolve.mockRestore();
 });
 it('ordinary offscreen replay delivers the same reference contract and client rejects corrupted facts',()=>{
  const f=setup(),input={...f.context,surfaceLive:undefined,quality:'export' as const,width:600,height:400,sourceViewport:ordinarySourceViewport(f.scene,600,400,'offscreen',100)};
  const out=generateSourceSurface(f.scene,input);expect(out.formulaPresentation).toEqual(sourcePresentation(100));
  const first=f.owner.generate(f.scene,f.context);expect(validSourceSurfaceOutput(first,f.context)).toBe(true);
  const missing=structuredClone(first);delete missing.formulaPresentation;expect(validSourceSurfaceOutput(missing,f.context)).toBe(false);
  const corrupt=structuredClone(first);corrupt.formulaPresentation={...sourcePresentation(101)};expect(validSourceSurfaceOutput(corrupt,f.context)).toBe(false);
 });
});

describe('source formula preview canvas rectangle',()=>{
 it.each([
  {name:'landscape',canvas:{left:30,top:101,width:800,height:400},host:{left:30,top:20,width:800,height:562},expected:{left:0,top:81,width:800,height:400}},
  {name:'portrait',canvas:{left:230,top:20,width:400,height:600},host:{left:30,top:20,width:800,height:600},expected:{left:200,top:0,width:400,height:600}},
 ])('clips and positions $name formulas within the measured canvas, not its parent',async({canvas,host,expected})=>{
  const {formulaOverlayRect}=await import('../src/engine/formulaOverlayRect'),rect=formulaOverlayRect(host,canvas,true),p=sourcePresentation(canvas.height);
  expect(rect).toEqual(expected);expect(formulaPlacement(p,p.labels[0],rect.width,rect.height,glyph).scale).toBe(.625);
  expect(formulaOverlayRect(host,canvas,false)).toEqual({left:0,top:0,width:host.width,height:host.height});
  expect(formulaOverlayRect(host,undefined,true)).toMatchObject({width:0,height:0});
 });
});
