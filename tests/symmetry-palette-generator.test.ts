import {describe,it,expect} from 'vitest';
import {parseProjectFile,parseLegacyScene} from '../src/engine/legacyImport';
import {parseScene,serializeScene} from '../src/engine/document';
import {openSymmetryPaletteEditor,symmetryPaletteEditorState,commitSymmetrySourcePalette,restoreSymmetrySourceManualPalette,changeSymmetrySourcePalette,applySymmetrySourcePalette,restartSymmetrySourcePalette,retainSymmetryPaletteOnSave,symmetryManualColorRgb} from '../src/engine/sourceSymmetryPaletteEditing';
import {generateSourceCosinePalette,generateSourceCurvePalette,defaultSourceCurvePalette,type SourceGradientPaletteCommit} from '../src/engine/sourceGradientPaletteGeneration';
import {sourceSymmetryPaletteLut} from '../src/engine/sourceSymmetryPalette';
import {sourceIteratedApplyIdentity,sourceIteratedReplayIdentity} from '../src/engine/sourceIteratedLiveIdentity';
import {sourcePaletteRuntimeScene} from '../src/engine/sourcePaletteRuntimeScene';
import {SOURCE_PROJECT_PALETTE_COLORS} from '../src/engine/sourceProjectPalette';
import type {SceneDocument} from '../src/types';
const raw=['#80AbCdEf','invalid',...Array.from({length:30},(_,i)=>'#'+i.toString(16).padStart(6,'0'))];
const source=(palette:unknown=raw,color:unknown={})=>({config_version:'1.0.0',type:'SYMMETRY_CHAOS',name:'Symmetry generator',palette,color,equation:{template:'standard'},settings:{batch_size:8,burn_in_steps:0},timeline:[{type:'wait',duration:1}]});
const scene=(palette:unknown=raw,color:unknown={})=>parseProjectFile(JSON.stringify(source(palette,color))).scene;
const value=<T>(r:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
function cosine(s:SceneDocument,count=9,kind:SourceGradientPaletteCommit['kind']='mode'):SourceGradientPaletteCommit{const state={...symmetryPaletteEditorState(s).cosine,a:[.2,.3,.4] as [number,number,number],colorCount:count};return{mode:'cosine',kind,state,colors:value(generateSourceCosinePalette(state))};}
function curve():SourceGradientPaletteCommit{const state={...defaultSourceCurvePalette(),colorCount:7};return{mode:'curve',kind:'mode',state,colors:value(generateSourceCurvePalette(state))};}
describe('source Symmetry palette ownership',()=>{
 it('retains exact raw source and imported generator parameters but clears flags',()=>{
  const s=scene(raw,{use_cosine_palette:true,use_curve_palette:true,cosine_a:['.1f','0x1.8p-1f',-2],curve_red:[{x:1.2,y:-.1},{x:.25,y:.8}],curve_green:[]});
  expect(s.symmetrySourcePalette!.colors).toEqual(raw);expect(s.palette.mode).toBe('linear');expect(s.palette.stops.slice(0,2)).toEqual(['#abcdef','#ffffff']);
  expect(s.symmetryPaletteEditor).toMatchObject({useCosine:false,useCurve:false,colorCount:25,cosine:{a:[Math.fround(.1),.75,-2]}});
  expect(s.symmetryPaletteEditor!.curves!.red!.map(p=>[p.x,p.y])).toEqual([[Math.fround(1.2),Math.fround(-.1)],[.25,Math.fround(.8)]]);
  expect(s.provenance!.original).toEqual(source(raw,{use_cosine_palette:true,use_curve_palette:true,cosine_a:['.1f','0x1.8p-1f',-2],curve_red:[{x:1.2,y:-.1},{x:.25,y:.8}],curve_green:[]}));
 });
 it('honors project/runtime/custom project entry defaults and ignored runtime color',()=>{
  const input={...source()};delete (input as {palette?:unknown}).palette;
  expect(parseProjectFile(JSON.stringify(input)).scene.symmetrySourcePalette!.colors).toEqual(SOURCE_PROJECT_PALETTE_COLORS);
  expect(parseLegacyScene(JSON.stringify(input),{symmetryEntry:'project'}).scene.symmetrySourcePalette!.colors).toEqual(SOURCE_PROJECT_PALETTE_COLORS);
  expect(parseLegacyScene(JSON.stringify(input)).scene.symmetrySourcePalette!.colors).toHaveLength(6);
  for(const color of [{cosine_a:['1/2',0,1]},{curve_red:null},{use_cosine_palette:42}]){
   expect(()=>scene(raw,color)).toThrow();const runtime=parseLegacyScene(JSON.stringify(source(raw,color))).scene;expect(runtime).not.toHaveProperty('symmetryPaletteEditor');expect(runtime.palette.mode).toBe('linear');
  }
  for(const palette of [null,{},[1]])expect(()=>parseLegacyScene(JSON.stringify(source(palette)))).toThrow();
 });
 it.each([{colors:[]},{colors:['#80AbCdEf']}])('Appearance pads metadata once without altering runtime $colors',({colors})=>{
  const initial=scene(colors),opened=openSymmetryPaletteEditor(initial);expect(initial.symmetrySourcePalette!.colors).toEqual(colors);expect(opened.palette).toBe(initial.palette);expect(sourceIteratedApplyIdentity(opened)).toBe(sourceIteratedApplyIdentity(initial));expect(sourceIteratedReplayIdentity(opened)).toBe(sourceIteratedReplayIdentity(initial));
  expect(opened.symmetryPaletteEditor).toMatchObject({colorCount:8,appearanceOpened:true});expect(opened.symmetrySourcePalette!.colors).toHaveLength(2);expect(openSymmetryPaletteEditor(opened)).toBe(opened);
  const empty=value(changeSymmetrySourcePalette(opened,[]));expect(openSymmetryPaletteEditor(empty)).toBe(empty);
 });
 it('commits discrete list and continuous Cosine together, Curve is discrete and raw Manual is restored',()=>{
  const first=openSymmetryPaletteEditor(scene()),generated=value(commitSymmetrySourcePalette(first,cosine(first))),more=value(commitSymmetrySourcePalette(generated,cosine(generated,13,'change')));
  expect(generated.symmetrySourcePalette!.colors).toHaveLength(9);expect(generated.palette.mode).toBe('cosine');expect(sourceSymmetryPaletteLut(generated.palette)).toEqual(sourceSymmetryPaletteLut(more.palette));
  expect(sourceIteratedApplyIdentity(generated)).toBe(sourceIteratedApplyIdentity(first));expect(sourceIteratedReplayIdentity(generated)).not.toBe(sourceIteratedReplayIdentity(first));
  const curved=value(commitSymmetrySourcePalette(generated,curve()));expect(curved.palette.mode).toBe('linear');expect(curved.palette.stops).toEqual(curved.symmetrySourcePalette!.colors.map(c=>c.toLowerCase()));
  const restored=value(restoreSymmetrySourceManualPalette(curved));expect(restored.symmetrySourcePalette!.colors).toEqual(raw);expect(restored.symmetryPaletteEditor!.cosine).toEqual(generated.symmetryPaletteEditor!.cosine);expect(restored.symmetryPaletteEditor!.curves).toEqual(curved.symmetryPaletteEditor!.curves);
  const baked=value(commitSymmetrySourcePalette(generated,cosine(generated,11,'bake')));expect(baked.palette.mode).toBe('linear');expect(baked.symmetryPaletteEditor).not.toHaveProperty('manualColors');
 });
 it('hot empty preserves previous colors but closes continuous mode, while cold empty is black',()=>{
  const initial=openSymmetryPaletteEditor(scene()),generated=value(commitSymmetrySourcePalette(initial,cosine(initial))),emptyManual=value(restoreSymmetrySourceManualPalette({...generated,symmetryPaletteEditor:{...generated.symmetryPaletteEditor!,manualColors:[]}}));
  expect(emptyManual.palette.mode).toBe('linear');expect(emptyManual.palette.stops).toEqual(generated.palette.stops);expect(emptyManual.symmetrySourcePalette!.colors).toEqual([]);
  expect(sourceSymmetryPaletteLut(applySymmetrySourcePalette(emptyManual).palette).every(n=>n===0)).toBe(true);
  const same=value(changeSymmetrySourcePalette(initial,raw));expect(same).not.toBe(initial);expect(same.timeline).toBe(initial.timeline);
  expect(changeSymmetrySourcePalette(initial,new Array(1025).fill('#123456'))).toMatchObject({ok:false,error:{kind:'capacity'}});expect(symmetryManualColorRgb('invalid')).toBe('#000000');
 });
 it('saves cold baked list, retains live open session, and ignores forged transient file state',()=>{
  const first=openSymmetryPaletteEditor(scene()),generated=value(commitSymmetrySourcePalette(first,cosine(first))),saved=parseScene(serializeScene(generated));
  expect(saved.symmetrySourcePalette).toEqual(generated.symmetrySourcePalette);expect(saved.palette.mode).toBe('linear');expect(saved).not.toHaveProperty('symmetryPaletteEditor');expect(saved).not.toHaveProperty('symmetryPaletteSession');
  const active=retainSymmetryPaletteOnSave(generated,{...saved,id:'library-copy'});expect(active.palette).toBe(generated.palette);expect(active.symmetryPaletteEditor).toBe(generated.symmetryPaletteEditor);
  expect(restartSymmetrySourcePalette(active).palette).toEqual(first.palette);expect(applySymmetrySourcePalette(active).palette).toEqual(saved.palette);
  const forged=parseScene(JSON.stringify({...saved,symmetryPaletteEditor:{not:'authoritative'},symmetryPaletteSession:{not:'authoritative'}}));expect(forged).not.toHaveProperty('symmetryPaletteSession');
  Object.assign(generated.symmetryPaletteEditor!,{uncloneable:()=>0});expect(()=>structuredClone(sourcePaletteRuntimeScene(generated))).not.toThrow();
 });
 it('leaves older rich local palettes unchanged without an explicit source owner',()=>{
  const old=scene();delete old.symmetrySourcePalette;delete old.symmetryPaletteEditor;old.palette={...old.palette,mode:'cosine',cosine:{a:[.2,.3,.4],b:[.4,.4,.4],c:[2,2,2],d:[0,.3,.6]}};
  expect(openSymmetryPaletteEditor(old)).toBe(old);expect(parseScene(serializeScene(old)).palette).toEqual(old.palette);
 });
});
