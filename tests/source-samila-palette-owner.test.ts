import {afterEach,describe,expect,it,vi} from 'vitest';
import {SourceSamilaSession} from '../src/engine/sourceSamilaSession';
import {IteratedDensityGpu} from '../src/engine/iteratedDensityGpu';
import {parseProjectFile} from '../src/engine/legacyImport';
import {openSourceSamilaPaletteEditor,changeSourceSamilaPalette,commitSourceSamilaPalette,sourceSamilaPaletteEditorState,applySourceSamilaPalette,restartSourceSamilaPalette,syncSourceSamilaPaletteSession,sourceSamilaPaletteRuntimeScene,writeSourceSamilaParameter,writeSourceSamilaSetting} from '../src/engine/sourceSamilaPaletteEditing';
import {generateSourceCosinePalette,normalizeSourceCosinePalette} from '../src/engine/sourceGradientPaletteGeneration';
import {SOURCE_SAMILA_PARAMETER_MODEL} from '../src/engine/sourceSamilaParameter';
import type {GenerateContext} from '../src/types';
const value=<T>(r:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
function scene(palette=['#80abcdef','0x123456']){const s=parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'SAMILA',name:'Live palette',palette,equations:{f1:'sin(x*y)',f2:'cos(x-y)'},settings:{batch_size:8},timeline:[{type:'wait',duration:2}]})).scene;s.settings.iteratedBackend='gpu';s.settings.batchSize=8;return s;}
const ctx:GenerateContext={width:17,height:13,time:0,quality:'preview',samilaPrimaryPixelHeight:1080,samilaLive:{sessionId:'palette',pixelDensity:1}};
function producer(){let width=0,height=0;const step=vi.spyOn(IteratedDensityGpu.prototype,'step').mockImplementation((job,options)=>{width=options.width;height=options.height;return{bounds:{minX:-1,maxX:1,minY:-1,maxY:1},steps:job.history!.samples,accepted:job.history!.samples,invalid:0,sampleInvalid:0,clipped:0};});vi.spyOn(IteratedDensityGpu.prototype,'present').mockImplementation(()=>({pixels:new Uint8ClampedArray(width*height*4),occupiedPixels:1,maxCount:1,toneBackend:'webgl2',warnings:[]}));vi.spyOn(IteratedDensityGpu.prototype,'dispose').mockImplementation(()=>{});return step;}
afterEach(()=>vi.restoreAllMocks());
describe('Samila source palette at retained display producer boundary (not GPU pixel parity)',()=>{
 it('stages authored constructor colors while hot edits leave Scene background and applied reset intact',()=>{
  producer();const imported=scene();imported.settings={...imported.settings,background:'#000001',samilaSceneBackgroundColor:1};const initial=applySourceSamilaPalette(imported),owner=new SourceSamilaSession({samilaSeedProvider:()=>7});
  try{
   owner.generate(initial,ctx);expect(owner.diagnostics().sceneBackgroundRgba8).toEqual([1,1,1,255]);
   const hot=writeSourceSamilaSetting(initial,'background','#102030');expect(hot.settings.samilaSceneBackgroundColor).toBe(0xff102030);expect(sourceSamilaPaletteRuntimeScene(hot).settings).toMatchObject({background:'#102030',samilaSceneBackgroundColor:1});
   expect(owner.generate(hot,ctx).samilaLive?.displayIndex).toBe(1);expect(owner.diagnostics().sceneBackgroundRgba8).toEqual([1,1,1,255]);
   const reset=restartSourceSamilaPalette(hot);expect(sourceSamilaPaletteRuntimeScene(reset).settings).toMatchObject({background:'#000001',samilaSceneBackgroundColor:1});expect(reset.settings.background).toBe('#102030');
   const applied=applySourceSamilaPalette(hot);owner.generate(applied,{...ctx,samilaLive:{...ctx.samilaLive!,sessionId:'apply-background'}});expect(owner.diagnostics().sceneBackgroundRgba8).toEqual([16,32,48,255]);expect(sourceSamilaPaletteRuntimeScene(applied).settings.samilaSceneBackgroundColor).toBe(0xff102030);
  }finally{owner.reset();}
 });
 it('a same-RGB author setter stages opaque color for Apply without discarding the active Scene alpha',()=>{
  const imported=scene();imported.settings={...imported.settings,background:'#102030',samilaSceneBackgroundColor:0x80102030};const initial=applySourceSamilaPalette(imported),same=writeSourceSamilaSetting(initial,'background','#102030');
  expect(same.settings.samilaSceneBackgroundColor).toBe(0xff102030);expect(same.samilaPaletteSession!.effective.settings.samilaSceneBackgroundColor).toBe(0x80102030);expect(restartSourceSamilaPalette(same).samilaPaletteSession!.effective.settings.samilaSceneBackgroundColor).toBe(0x80102030);
  expect(applySourceSamilaPalette(same).samilaPaletteSession!.applied.settings.samilaSceneBackgroundColor).toBe(0xff102030);
  const direct={...initial,settings:{...initial.settings,background:'#405060'}};expect(applySourceSamilaPalette(direct).settings.samilaSceneBackgroundColor).toBe(0xff405060);
 });
 it('commits generated lists and continuous coefficients without rebuilding sampling, including an equal-value hot event',()=>{
  const step=producer(),s=openSourceSamilaPaletteEditor(scene()),owner=new SourceSamilaSession({samilaSeedProvider:()=>7});
  try{owner.generate(s,ctx);const state=value(normalizeSourceCosinePalette({...sourceSamilaPaletteEditorState(s).cosine,colorCount:5})),colors=value(generateSourceCosinePalette(state)),hot=value(commitSourceSamilaPalette(s,{kind:'mode',mode:'cosine',state,colors}));
   const once={...ctx,samilaLive:{...ctx.samilaLive!,dirtyRevision:1}};expect(owner.generate(hot,once).samilaLive).toMatchObject({displayIndex:1,cleared:true,accumulationPasses:1});expect(step.mock.calls.at(-1)![0].palette).toMatchObject({mode:'cosine',stops:colors.map(c=>c.toLowerCase()),cosine:{a:state.a}});
   const equal=value(commitSourceSamilaPalette(hot,{kind:'change',mode:'cosine',state,colors})),twice={...ctx,samilaLive:{...ctx.samilaLive!,dirtyRevision:2}};expect(owner.generate(equal,twice).samilaLive).toMatchObject({displayIndex:2,cleared:true,accumulationPasses:1});expect(owner.generate(equal,twice).samilaLive).toMatchObject({displayIndex:3,cleared:false,accumulationPasses:2});expect(owner.diagnostics().random.words).toBe(4);
  }finally{owner.reset();}expect(owner.diagnostics().retainedBytes).toBe(0);
 });
 it('does not clear accumulation or alter cold configuration for appearance metadata and offset-only edits',()=>{
  producer();const s=scene([]),owner=new SourceSamilaSession({samilaSeedProvider:()=>7});try{
   owner.generate(s,ctx);const opened=openSourceSamilaPaletteEditor(s);Object.assign(opened.samilaPaletteEditor!,{uncloneable:()=>undefined});expect(owner.generate(opened,ctx).samilaLive).toMatchObject({displayIndex:1,cleared:false,accumulationPasses:2});expect(owner.matchesCompletedPrimary(opened,ctx)).toBe(true);
   const offset=syncSourceSamilaPaletteSession(opened,{...opened,palette:{...opened.palette,offset:.25}});expect(sourceSamilaPaletteRuntimeScene(offset).palette.offset).toBe(.25);expect(owner.generate(offset,ctx).samilaLive).toMatchObject({displayIndex:2,cleared:false,accumulationPasses:3});expect(restartSourceSamilaPalette(offset).settings.samilaUsePaletteLut).toBe(false);expect(owner.diagnostics().random.words).toBe(3);
  }finally{owner.reset();}
 });
 it('restores the last cold palette on explicit reset while history reconstruction retains effective hot colors',()=>{
  const step=producer(),s=openSourceSamilaPaletteEditor(scene()),owner=new SourceSamilaSession({samilaSeedProvider:()=>7});try{
   owner.generate(s,ctx);const hot=value(changeSourceSamilaPalette(s,['AABBCC','#fff']));owner.generate(hot,{...ctx,samilaLive:{...ctx.samilaLive!,dirtyRevision:1}});expect(step.mock.calls.at(-1)![0].palette.stops).toEqual(['#aabbcc','#ffffff']);
   // Rebuild from a history checkpoint starts fresh ink with that checkpoint's
   // effective hot state; it does not accidentally invoke toolbar reset.
   const history=structuredClone(hot);owner.generate(history,{...ctx,samilaLive:{...ctx.samilaLive!,sessionId:'history'}});expect(step.mock.calls.at(-1)![0].palette.stops).toEqual(['#aabbcc','#ffffff']);
   const reset=restartSourceSamilaPalette(hot);owner.generate(reset,{...ctx,samilaLive:{...ctx.samilaLive!,sessionId:'reset'}});expect(step.mock.calls.at(-1)![0].palette.stops).toEqual(['#abcdef','#123456']);expect(reset.samilaSourcePalette).toEqual(hot.samilaSourcePalette);
   const applied=applySourceSamilaPalette(hot);owner.generate(applied,{...ctx,samilaLive:{...ctx.samilaLive!,sessionId:'apply'}});expect(step.mock.calls.at(-1)![0].palette.stops).toEqual(['#ffffff','#0fffff']);expect(restartSourceSamilaPalette(applied).palette).toEqual(applied.palette);
  }finally{owner.reset();}
 });
 it('resets the full applied configuration, preserves author drafts and merges only subsequent hot writes',()=>{
  const step=producer(),initial=scene();initial.parameters={a:1,b:2};initial.equations={f1:'a*x',f2:'b*y'};initial.settings.alpha=.1;initial.settings.scaleX=.33;
  const applied=applySourceSamilaPalette(initial),owner=new SourceSamilaSession({samilaSeedProvider:()=>3});try{
   owner.generate(applied,ctx);
   const edited=syncSourceSamilaPaletteSession(applied,{...applied,parameters:{a:7,b:8},settings:{...applied.settings,alpha:.7,scaleX:.5}});owner.generate(edited,ctx);
   expect(step.mock.calls.at(-1)![0].config.alpha).toBe(Math.fround(.7));expect(owner.diagnostics().parameters).toEqual({a:7,b:8});
   const reset=restartSourceSamilaPalette(edited),resetContext={...ctx,samilaLive:{...ctx.samilaLive!,sessionId:'cold-all'}};
   expect(reset.parameters).toEqual({a:7,b:8});expect(reset.settings.alpha).toBe(.7);
   owner.generate(reset,resetContext);expect(owner.diagnostics().parameters).toEqual({a:1,b:2});expect(step.mock.calls.at(-1)![0].config.alpha).toBe(Math.fround(.1));expect(step.mock.calls.at(-1)![0].samilaProjection!.scaleX).toBe(Math.fround(.33));
   const after=syncSourceSamilaPaletteSession(reset,{...reset,parameters:{...reset.parameters,a:9},settings:{...reset.settings,alpha:.8}});owner.generate(after,resetContext);expect(owner.diagnostics().parameters).toEqual({a:9,b:2});expect(step.mock.calls.at(-1)![0].config.alpha).toBe(Math.fround(.8));expect(step.mock.calls.at(-1)![0].samilaProjection!.scaleX).toBe(Math.fround(.33));
   const history=structuredClone(after);owner.generate(history,{...ctx,samilaLive:{...ctx.samilaLive!,sessionId:'full-history'}});expect(owner.diagnostics().parameters).toEqual({a:9,b:2});
   const applyAll=applySourceSamilaPalette(after);owner.generate(applyAll,{...ctx,samilaLive:{...ctx.samilaLive!,sessionId:'new-full-apply'}});expect(owner.diagnostics().parameters).toEqual({a:9,b:8});expect(step.mock.calls.at(-1)![0].samilaProjection!.scaleX).toBe(Math.fround(.5));
  }finally{owner.reset();}
 });

 it('replays equal-value hot parameter and grouped appearance events after reset, and retains setter semantics through history',()=>{
  const step=producer(),initial=scene();initial.parameters={a:1,b:2};initial.equations={f1:'a*x',f2:'b*y'};initial.settings.normalizedGamma=50;initial.settings.trailLifetime=4;initial.settings.accumulationDecay=2;
  const applied=applySourceSamilaPalette(initial),owner=new SourceSamilaSession({samilaSeedProvider:()=>3}),withContext=(s:typeof initial,id='same')=>({...ctx,samilaLive:{...ctx.samilaLive!,sessionId:id,runtimeRevision:s.samilaPaletteSession!.runtimeRevision}});
  try{
   const author=writeSourceSamilaParameter(applied,'a',7),reset=restartSourceSamilaPalette(author);owner.generate(reset,withContext(reset));expect(owner.diagnostics().parameters).toEqual({a:1,b:2});
   const equal=writeSourceSamilaParameter(reset,'a',7);owner.generate(equal,{...withContext(equal),samilaLive:{...withContext(equal).samilaLive!,dirtyRevision:1}});expect(owner.diagnostics().parameters).toEqual({a:7,b:2});
   const setting=writeSourceSamilaSetting(equal,'alpha',equal.settings.alpha);expect(setting.samilaPaletteSession!.runtimeRevision).toBe(1);owner.generate(setting,{...withContext(setting),samilaLive:{...withContext(setting).samilaLive!,dirtyRevision:1}});expect(step.mock.calls.at(-1)![0].config.decay).toBe(1);
   const history=structuredClone(setting);owner.generate(history,withContext(history,'history-settings'));expect(step.mock.calls.at(-1)![0].config.decay).toBe(1);
   const cold=restartSourceSamilaPalette(history);owner.generate(cold,withContext(cold,'reset-settings'));expect(step.mock.calls.at(-1)![0].config.decay).toBeLessThan(1);
  }finally{owner.reset();}
 });

 it('delivers a same-author-value parameter write after the active queue changed its uniform, exactly once',()=>{
  producer();const initial=scene();initial.parameters={a:0};initial.equations={f1:'a*x',f2:'y'};
  initial.timeline.tracks=[{id:'animate-a',type:'animate',target:'camera.actions',from:0,to:0,start:0,duration:2,easing:'linear',enabled:true,pingPong:false,actions:[{id:'start-a',method:'paramStart',samilaParameters:{model:SOURCE_SAMILA_PARAMETER_MODEL,kind:'start',parameters:[{name:'a',min:-1,max:1,step:.01}]}}]}];
  const applied=applySourceSamilaPalette(initial),owner=new SourceSamilaSession({samilaSeedProvider:()=>3}),live=(s:typeof initial,timestampMs:number,paused=false):GenerateContext=>({...ctx,samilaLive:{...ctx.samilaLive!,parameterRevisions:s.samilaPaletteSession!.parameterRevisions,clock:{paused,timestampMs}}});
  try{
   owner.generate(applied,live(applied,1000));owner.generate(applied,live(applied,1500));expect(owner.diagnostics().parameters!.a).not.toBe(0);const before=owner.diagnostics().runtime!.parameterWriteRevision;
   owner.setPaused(true);const equal=writeSourceSamilaParameter(applied,'a',0),request=live(equal,1500,true),result=owner.generate(equal,request);
   expect(equal.samilaPaletteSession!.parameterRevisions).toEqual({a:1});expect(owner.diagnostics().parameters).toEqual({a:0});expect(result.samilaLive).toMatchObject({displayIndex:2,cleared:true});expect(owner.diagnostics().runtime!.parameterWriteRevision).toBe(before+1);
   expect(owner.generate(equal,request).samilaLive).toMatchObject({displayIndex:3,cleared:false});expect(owner.diagnostics().runtime!.parameterWriteRevision).toBe(before+1);expect(owner.diagnostics().random.words).toBe(4);
   const twice=writeSourceSamilaParameter(equal,'a',0);owner.generate(twice,live(twice,1500,true));expect(owner.diagnostics().runtime!.parameterWriteRevision).toBe(before+2);
   expect(restartSourceSamilaPalette(twice).samilaPaletteSession!.parameterRevisions).toEqual({});expect(applySourceSamilaPalette(twice).samilaPaletteSession!.parameterRevisions).toEqual({});
  }finally{owner.reset();}
 });

});
