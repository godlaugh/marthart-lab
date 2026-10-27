import {describe,expect,it} from 'vitest';
import {parseLegacyScene,parseProjectFile} from '../src/engine/legacyImport';
import {parseScene,serializeScene,persistentScene} from '../src/engine/document';
import {implicitEditableColors,implicitPaletteEditorState,implicitPaletteEditorMode,openImplicitPaletteEditor,commitImplicitSourcePalette,restoreImplicitSourceManualPalette,changeImplicitSourcePalette,implicitPaletteRuntimeScene,retainImplicitPaletteEditorOnSave,implicitManualColorRgb,implicitManualRgbText,SOURCE_IMPLICIT_DEFAULT_COLORS} from '../src/engine/implicitPaletteEditing';
import {SOURCE_PROJECT_PALETTE_COLORS} from '../src/engine/sourceProjectPalette';
import {defaultSourceCurvePalette,generateSourceCosinePalette,generateSourceCurvePalette,normalizeSourceCosinePalette,normalizeSourceCurvePalette,type SourceGradientPaletteCommit} from '../src/engine/sourceGradientPaletteGeneration';
import {prepareImplicitPalette} from '../src/engine/sourceImplicitPalette';
import type {SceneDocument} from '../src/types';

const rawColors=['#80AbCdEf','-1','invalid',...Array.from({length:29},(_,i)=>'#'+i.toString(16).padStart(6,'0'))];
const source=(color:unknown={},palette:unknown=rawColors)=>({config_version:'1.0.0',type:'IMPLICIT',name:'Implicit generator owner',palette,color,equation:{f:'x^2+y^2+z^2-1'},settings:{mesh_mode:'CPU',render_mode:'SOLID',x_segments:4,y_segments:4,z_segments:4},timeline:[{type:'wait',duration:1}]});
const scene=(color:unknown={},palette:unknown=rawColors)=>parseProjectFile(JSON.stringify(source(color,palette))).scene;
const value=<T>(result:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!result.ok)throw Error(JSON.stringify(result.error));return result.value;};
function cosine(s:SceneDocument,kind:SourceGradientPaletteCommit['kind']='mode',count=9):SourceGradientPaletteCommit {
 const state=value(normalizeSourceCosinePalette({...implicitPaletteEditorState(s).cosine,a:[.2,.3,.4],colorCount:count}));return{kind,mode:'cosine',state,colors:value(generateSourceCosinePalette(state))};
}
function curve(kind:SourceGradientPaletteCommit['kind']='mode',count=7):SourceGradientPaletteCommit {
 const state=value(normalizeSourceCurvePalette({...defaultSourceCurvePalette(),colorCount:count,red:[{id:'right',x:1,y:0},{id:'left',x:0,y:1}]}));return{kind,mode:'curve',state,colors:value(generateSourceCurvePalette(state))};
}
describe('Implicit source CPU opened-project palette owner',()=>{
 it('retains raw colors and ProjectState parameters but clears both flags before Appearance without generating',()=>{
  const color={use_cosine_palette:true,use_curve_palette:true,cosine_a:['.1f','0x1.8p-1f',-2,9],cosine_b:[8],curve_red:[{x:1.2,y:-.1},{x:'.25f',y:'.8'},{x:.25,y:.2}],curve_green:[],inside:null},raw=source(color),s=parseProjectFile(JSON.stringify(raw)).scene;
  expect(s.implicitSourcePalette?.colors).toEqual(rawColors);expect(implicitPaletteEditorMode(s.implicitPaletteEditor!)).toBe('manual');
  expect(s.implicitPaletteEditor).toMatchObject({useCosine:false,useCurve:false,colorCount:25,cosine:{a:[Math.fround(.1),.75,-2],b:[.5,.5,.5]},curves:{green:[]}});
  expect(s.implicitPaletteEditor!.curves!.red!.map(({x,y})=>[x,y])).toEqual([[Math.fround(1.2),Math.fround(-.1)],[.25,Math.fround(.8)],[.25,Math.fround(.2)]]);
  expect(s.implicitPaletteEditor!.curves).not.toHaveProperty('blue');expect(s.implicitPaletteEditor).not.toHaveProperty('appearanceOpened');expect(s.provenance!.original).toEqual(raw);
  expect(prepareImplicitPalette(s.implicitSourcePalette!.colors,'cold').packed[0]).toBe(0x80abcdef);expect(prepareImplicitPalette(s.implicitSourcePalette!.colors,'hot').packed[0]).toBe(0xffabcdef);
 });
 it('distinguishes project literals from runtime-config ignored generator data across both source mesh modes',()=>{
  for(const color of [{cosine_a:['1/2',.2,.3]},{use_curve_palette:1},{curve_red:null},{curve_blue:[{x:'1/2',y:0}]},{cosine_a:[null,0,1]}]){
   expect(()=>scene(color)).toThrow();const runtime=parseLegacyScene(JSON.stringify(source(color))).scene;expect(runtime).not.toHaveProperty('implicitPaletteEditor');expect(runtime.implicitSourcePalette?.colors).toEqual(rawColors);
  }
  const gpu=source({use_cosine_palette:true,use_curve_palette:true},['#ff0000','#0000ff']);gpu.settings.mesh_mode='GPU';expect(parseProjectFile(JSON.stringify(gpu)).scene.implicitSourcePalette?.colors).toEqual(gpu.palette);
  const valid={...gpu,color:{use_cosine_palette:true,cosine_a:[.5,.5,.5],cosine_b:[.5,.5,.5],cosine_c:[1,1,1],cosine_d:[0,.33,.67]}};const sourceGpu=parseProjectFile(JSON.stringify(valid)).scene;expect(sourceGpu.implicitSourcePalette?.colors).toEqual(valid.palette);expect(sourceGpu.implicitPaletteEditor).toMatchObject({useCosine:false,useCurve:false});expect(openImplicitPaletteEditor(sourceGpu).implicitPaletteEditor?.appearanceOpened).toBe(true);
 });
 it('preserves entrypoint defaults, explicit empty/single, invalid text and strict array shape',()=>{
  const omitted={...source()};delete (omitted as {palette?:unknown}).palette;
  expect(parseProjectFile(JSON.stringify(omitted)).scene.implicitSourcePalette!.colors).toEqual(SOURCE_PROJECT_PALETTE_COLORS);
  expect(parseLegacyScene(JSON.stringify(omitted)).scene.implicitSourcePalette!.colors).toEqual(SOURCE_IMPLICIT_DEFAULT_COLORS);
  for(const colors of [[],['#80AbCdEf'],['malformed retained input']])expect(scene({},colors).implicitSourcePalette!.colors).toEqual(colors);
  for(const palette of [null,{},[1]])for(const parse of [parseProjectFile,parseLegacyScene])expect(()=>parse(JSON.stringify(source({},palette)))).toThrow();
 });
 it.each([{raw:[],expected:['#3B82F6','#22D3EE']},{raw:['#80AbCdEf'],expected:['#80AbCdEf','#F97316']}])('initializes count before one-time non-notifying Appearance padding: $raw',({raw,expected})=>{
  const before=scene({cosine_a:[.2,.3,.4]},raw),opened=openImplicitPaletteEditor(before);
  expect(before.implicitSourcePalette!.colors).toEqual(raw);expect(opened.implicitSourcePalette!.colors).toEqual(expected);expect(opened.implicitPaletteEditor).toMatchObject({colorCount:8,appearanceOpened:true,cosine:before.implicitPaletteEditor!.cosine});
  expect(openImplicitPaletteEditor(opened)).toBe(opened);expect(JSON.parse(serializeScene(opened)).implicitSourcePalette.colors).toEqual(expected);
  const emptied=value(changeImplicitSourcePalette(opened,[]));expect(openImplicitPaletteEditor(emptied)).toBe(emptied);expect(emptied.implicitSourcePalette!.colors).toEqual([]);
 });
 it('takes a raw Manual snapshot once and restores only colors after edits and mode changes',()=>{
  const s=openImplicitPaletteEditor(scene()),generated=value(commitImplicitSourcePalette(s,cosine(s))),curved=value(commitImplicitSourcePalette(generated,curve())),restored=value(restoreImplicitSourceManualPalette(curved));
  expect(restored.implicitSourcePalette!.colors).toEqual(rawColors);expect(restored.implicitPaletteEditor).toMatchObject({useCosine:false,useCurve:false,colorCount:7,cosine:generated.implicitPaletteEditor!.cosine,curves:curved.implicitPaletteEditor!.curves});expect(restored.implicitPaletteEditor).not.toHaveProperty('manualColors');
  expect(curved.palette).toBe(s.palette);expect(curved.timeline).toBe(s.timeline);expect(curved.settings).toBe(s.settings);
  const baked=value(commitImplicitSourcePalette(curved,curve('bake')));expect(baked.implicitPaletteEditor).not.toHaveProperty('manualColors');expect(value(restoreImplicitSourceManualPalette(baked)).implicitSourcePalette).toEqual(baked.implicitSourcePalette);
  const empty=value(changeImplicitSourcePalette(s,[])),emptyGenerated=value(commitImplicitSourcePalette(empty,cosine(empty)));expect(value(restoreImplicitSourceManualPalette(emptyGenerated)).implicitSourcePalette!.colors).toEqual([]);
 });
 it('keeps explicit same-value actions and untouched raw tails, with bounded input errors',()=>{
  const s=openImplicitPaletteEditor(scene()),same=value(changeImplicitSourcePalette(s,rawColors));expect(same).not.toBe(s);expect(same.implicitPaletteEditor).toBe(s.implicitPaletteEditor);expect(same.implicitSourcePalette!.colors).toEqual(rawColors);
  expect(implicitManualColorRgb('#80AbCdEf')).toBe('#abcdef');expect(implicitManualColorRgb('invalid')).toBe('#000000');expect(implicitManualRgbText('#abcdef')).toBe('#ABCDEF');
  const edited=value(changeImplicitSourcePalette(s,[implicitManualRgbText('#112233'),...rawColors.slice(1)]));expect(edited.implicitSourcePalette!.colors).toEqual(['#112233',...rawColors.slice(1)]);
  expect(changeImplicitSourcePalette(s,new Array(65537).fill('#fff'))).toMatchObject({ok:false,error:{kind:'capacity'}});expect(s.implicitSourcePalette!.colors).toEqual(rawColors);
 });
 it('saves only raw colors while keeping the open editor, immutable history and explicit same-id reload independent',()=>{
  const first=openImplicitPaletteEditor(scene({use_cosine_palette:true,cosine_a:[.8,.7,.6]})),changed=value(commitImplicitSourcePalette(first,curve('mode',9))),history=structuredClone(first);
  const text=serializeScene(changed),saved=parseScene(text),reopened=parseProjectFile(text).scene;
  expect(JSON.parse(text)).not.toHaveProperty('implicitPaletteEditor');expect(saved).not.toHaveProperty('implicitPaletteEditor');expect(implicitPaletteEditorMode(implicitPaletteEditorState(reopened))).toBe('manual');expect(implicitPaletteEditorState(reopened).cosine.a).toEqual([.5,.5,.5]);expect(reopened.provenance).toEqual(first.provenance);
  const active=retainImplicitPaletteEditorOnSave(changed,{...saved,id:'new-library-id'});expect(active.implicitPaletteEditor).toBe(changed.implicitPaletteEditor);expect(persistentScene(active)).not.toHaveProperty('implicitPaletteEditor');
  expect(parseScene(JSON.stringify({...JSON.parse(text),implicitPaletteEditor:{hostile:'not parsed'}}))).not.toHaveProperty('implicitPaletteEditor');
  expect(history.implicitPaletteEditor!.cosine.a).toEqual([Math.fround(.8),Math.fround(.7),Math.fround(.6)]);expect(history.implicitSourcePalette!.colors).toEqual(rawColors);
  const replacement={...scene(),id:first.id};expect(replacement.implicitPaletteEditor).not.toHaveProperty('appearanceOpened');
 });
 it('narrowly strips temporary state without dropping runtime facts or re-reading provenance for old local documents',()=>{
  const s=openImplicitPaletteEditor(scene());Object.assign(s.implicitPaletteEditor!,{uncloneable:()=>undefined});s.evaluatedCamera={model:'mandelbulb',time:0,camera:{...s.camera},roll:0,focalLength:1,rayScale:1};
  const projected=implicitPaletteRuntimeScene(s);expect(projected).not.toHaveProperty('implicitPaletteEditor');expect(projected.evaluatedCamera).toBe(s.evaluatedCamera);expect(projected.implicitSourcePalette).toBe(s.implicitSourcePalette);expect(implicitPaletteRuntimeScene(projected)).toBe(projected);
  const legacy={...projected};delete legacy.implicitSourcePalette;expect(implicitEditableColors(legacy)).toBe(legacy.palette.stops);expect(openImplicitPaletteEditor(legacy).implicitSourcePalette!.colors).toEqual(legacy.palette.stops);
 });
});
