import {describe,expect,it} from 'vitest';
import {parseProjectFile,parseLegacyScene} from '../src/engine/legacyImport';
import {parseScene,serializeScene} from '../src/engine/document';
import {openSourceSamilaPaletteEditor,sourceSamilaPaletteEditorState,sourceSamilaPaletteEditorMode,commitSourceSamilaPalette,restoreSourceSamilaManualPalette,changeSourceSamilaPalette,sourceSamilaEditableColors,applySourceSamilaPalette,restartSourceSamilaPalette,sourceSamilaPalettePersistentScene,retainSourceSamilaPaletteOnSave,sourceSamilaPaletteRuntimeScene,sourceSamilaManualRgbText,sourceSamilaManualColorRgb,syncSourceSamilaPaletteSession,ensureSourceSamilaPaletteSession} from '../src/engine/sourceSamilaPaletteEditing';
import {sourceSamilaPaletteLut} from '../src/engine/sourceSamilaSplat';
import {sourceSamilaApplyIdentity,sourceSamilaSceneIdentity} from '../src/engine/sourceSamilaIdentity';
import {defaultSourceCurvePalette,generateSourceCosinePalette,generateSourceCurvePalette,normalizeSourceCosinePalette,type SourceGradientPaletteCommit} from '../src/engine/sourceGradientPaletteGeneration';
import {SOURCE_PROJECT_PALETTE_COLORS} from '../src/engine/sourceProjectPalette';
import {DEFAULT_SOURCE_SURFACE_COLORS} from '../src/engine/sourceSurfaceColor';
import type {SceneDocument} from '../src/types';
const raw=['#80AbCdEf','-1','invalid',...Array.from({length:29},(_,i)=>'#'+i.toString(16).padStart(6,'0'))];
const value=<T>(r:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
const source=(palette:unknown=raw,color:unknown={})=>({config_version:'1.0.0',type:'SAMILA',name:'Samila palette owner',palette,color,settings:{batch_size:8},equations:{f1:'sin(x*y)',f2:'cos(x-y)'},timeline:[{type:'wait',duration:1}]});
const scene=(palette:unknown=raw,color:unknown={})=>parseProjectFile(JSON.stringify(source(palette,color))).scene;
function cosine(s:SceneDocument,kind:SourceGradientPaletteCommit['kind']='mode',colorCount=9):SourceGradientPaletteCommit {const state=value(normalizeSourceCosinePalette({...sourceSamilaPaletteEditorState(s).cosine,c:[.7,.8,.9],colorCount}));return{kind,mode:'cosine',state,colors:value(generateSourceCosinePalette(state))};}
function curve(kind:SourceGradientPaletteCommit['kind']='mode'):SourceGradientPaletteCommit {const state=defaultSourceCurvePalette();state.colorCount=7;return{kind,mode:'curve',state,colors:value(generateSourceCurvePalette(state))};}
describe('Samila source raw palette and opened generator owner',()=>{
 it('imports raw source strings and ProjectState Float parameters while clearing the two mode flags',()=>{
  const s=scene(raw,{use_cosine_palette:true,use_curve_palette:true,cosine_a:['.1f','0x1.8p-1f',-2,9],cosine_b:[8],curve_red:[{x:1.2,y:-.1},{x:'.25f',y:'.8'},{x:.25,y:.2}],curve_green:[]});
  expect(s.samilaSourcePalette?.colors).toEqual(raw);expect(s.samilaPaletteEditor).toMatchObject({useCosine:false,useCurve:false,colorCount:25,cosine:{a:[Math.fround(.1),.75,-2],b:[.5,.5,.5]},curves:{green:[]}});
  expect(s.samilaPaletteEditor!.curves!.red!.map(({x,y})=>[x,y])).toEqual([[Math.fround(1.2),Math.fround(-.1)],[.25,Math.fround(.8)],[.25,Math.fround(.2)]]);expect(s.palette.mode).toBe('linear');expect(s.palette.stops.slice(0,3)).toEqual(['#abcdef','#ffffff','#ffffff']);
 });
 it('retains entrypoint defaults and ignores generator fields only at the direct runtime configuration entry',()=>{
  const omitted=source();delete (omitted as {palette?:unknown}).palette;
  expect(parseProjectFile(JSON.stringify(omitted)).scene.samilaSourcePalette!.colors).toEqual(SOURCE_PROJECT_PALETTE_COLORS);
  expect(parseLegacyScene(JSON.stringify(omitted)).scene.samilaSourcePalette!.colors).toEqual(DEFAULT_SOURCE_SURFACE_COLORS);
  for(const color of [{cosine_a:['1/2',.2,.3]},{use_curve_palette:1},{curve_red:null}]){expect(()=>scene(raw,color)).toThrow();expect(parseLegacyScene(JSON.stringify(source(raw,color))).scene).not.toHaveProperty('samilaPaletteEditor');}
 });
 it.each([{raw:[]},{raw:['#80AbCdEf']}])('pads first Appearance only as metadata while keeping the original cold fallback: $raw',({raw})=>{
  const s=scene(raw),opened=openSourceSamilaPaletteEditor(s),expected=raw.length?[raw[0],'#F97316']:['#3B82F6','#22D3EE'];
  expect(opened.samilaSourcePalette!.colors).toEqual(expected);expect(opened.samilaPaletteEditor).toMatchObject({colorCount:8,appearanceOpened:true});expect(opened.palette).toBe(s.palette);expect(opened.settings).toBe(s.settings);expect(s.samilaSourcePalette!.colors).toEqual(raw);
  expect(openSourceSamilaPaletteEditor(opened)).toBe(opened);expect(sourceSamilaSceneIdentity(opened)).toBe(sourceSamilaSceneIdentity(s));expect(restartSourceSamilaPalette(opened).palette).toEqual(s.palette);
  const emptied=value(changeSourceSamilaPalette(opened,[]));expect(openSourceSamilaPaletteEditor(emptied)).toBe(emptied);expect(emptied.settings.samilaUsePaletteLut).toBe(false);expect(emptied.samilaSourcePalette!.colors).toEqual([]);
 });
 it('keeps raw Manual snapshots across continuous Cosine and baked linear Curve with full tail preservation',()=>{
  const s=openSourceSamilaPaletteEditor(scene()),generated=value(commitSourceSamilaPalette(s,cosine(s))),curved=value(commitSourceSamilaPalette(generated,curve())),restored=value(restoreSourceSamilaManualPalette(curved));
  expect(generated.palette.mode).toBe('cosine');expect(generated.samilaSourcePalette!.colors).toHaveLength(9);expect(generated.palette.stops).toHaveLength(9);expect(sourceSamilaPaletteLut(generated.palette)).not.toEqual(sourceSamilaPaletteLut({...generated.palette,mode:'linear'}));
  const lut=sourceSamilaPaletteLut(generated.palette);expect(lut.length).toBe(3072);expect([...lut.slice(-3)]).toEqual([...lut.slice(0,3)]);
  expect(curved.palette.mode).toBe('linear');expect(curved.samilaSourcePalette!.colors).toHaveLength(7);expect(restored.samilaSourcePalette!.colors).toEqual(raw);expect(restored.samilaPaletteEditor).toMatchObject({colorCount:7,useCosine:false,useCurve:false,cosine:generated.samilaPaletteEditor!.cosine,curves:curved.samilaPaletteEditor!.curves});expect(restored.samilaPaletteEditor).not.toHaveProperty('manualColors');
  expect(sourceSamilaApplyIdentity(restored)).toBe(sourceSamilaApplyIdentity(s));expect(restored.timeline).toBe(s.timeline);expect(restored.parameters).toBe(s.parameters);
  const baked=value(commitSourceSamilaPalette(generated,cosine(generated,'bake')));expect(baked.palette.mode).toBe('linear');expect(baked.samilaPaletteEditor).not.toHaveProperty('manualColors');expect(value(restoreSourceSamilaManualPalette(baked)).samilaSourcePalette).toEqual(baked.samilaSourcePalette);
 });
 it('separates hot parser, raw author, cold Apply and restart without silently replacing the reset anchor',()=>{
  const s=openSourceSamilaPaletteEditor(scene(['0x123456','#abc','#80AbCdEf'])),hot=value(changeSourceSamilaPalette(s,['-1','#fff','AABBCC']));
  expect(hot.palette.stops).toEqual(['#ffffff','#ffffff','#aabbcc']);expect(hot.samilaSourcePalette!.colors).toEqual(['-1','#fff','AABBCC']);
  const reset=restartSourceSamilaPalette(hot);expect(reset.palette.stops).toEqual(['#123456','#0ffabc','#abcdef']);expect(reset.samilaSourcePalette).toBe(hot.samilaSourcePalette);expect(reset.samilaPaletteEditor).toBe(hot.samilaPaletteEditor);
  const applied=applySourceSamilaPalette(hot);expect(applied.palette.stops).toEqual(['#ffffff','#0fffff','#ffffff']);expect(restartSourceSamilaPalette(applied).palette).toEqual(applied.palette);
  expect(sourceSamilaManualColorRgb('#80AbCdEf')).toBe('#abcdef');expect(sourceSamilaManualRgbText('#abcdef')).toBe('#ABCDEF');expect(sourceSamilaManualColorRgb('invalid')).toBe('#000000');
 });
 it('saves exact raw strings as cold manual while keeping the open runtime, editor and reset anchor',()=>{
  const s=openSourceSamilaPaletteEditor(scene()),hot=value(commitSourceSamilaPalette(s,cosine(s))),disk=sourceSamilaPalettePersistentScene(hot),saved=parseScene(serializeScene(hot));
  expect(disk).not.toHaveProperty('samilaPaletteEditor');expect(disk).not.toHaveProperty('samilaPaletteSession');expect(saved).not.toHaveProperty('samilaPaletteEditor');expect(saved).not.toHaveProperty('samilaPaletteSession');expect(saved.palette.mode).toBe('linear');expect(saved.samilaSourcePalette).toEqual(hot.samilaSourcePalette);
  expect(sourceSamilaPaletteEditorMode(sourceSamilaPaletteEditorState(saved))).toBe('manual');expect(sourceSamilaPaletteEditorState(saved).cosine.a).toEqual([.5,.5,.5]);
  const kept=retainSourceSamilaPaletteOnSave(hot,{...saved,id:'save-copy'});expect(kept.palette).toBe(hot.palette);expect(kept.samilaPaletteEditor).toBe(hot.samilaPaletteEditor);expect(kept.samilaPaletteSession).toBe(hot.samilaPaletteSession);expect(restartSourceSamilaPalette(kept).palette).toEqual(s.palette);
 });
 it('preserves legacy local cosine documents and strips editor before direct runtime transport',()=>{
  const s=scene();delete s.samilaSourcePalette;delete s.samilaPaletteEditor;s.palette.mode='cosine';const opened=openSourceSamilaPaletteEditor(s);expect(opened).not.toHaveProperty('samilaSourcePalette');expect(sourceSamilaPaletteEditorState(opened).useCosine).toBe(true);expect(sourceSamilaPalettePersistentScene(opened).palette).toBe(s.palette);expect(applySourceSamilaPalette(opened)).toBe(opened);expect(restartSourceSamilaPalette(opened)).toBe(opened);
  Object.assign(opened.samilaPaletteEditor!,{uncloneable:()=>undefined});const wire=sourceSamilaPaletteRuntimeScene(opened);expect(wire).not.toHaveProperty('samilaPaletteEditor');expect(sourceSamilaPaletteRuntimeScene(wire)).toBe(wire);expect(sourceSamilaEditableColors(wire)).toBe(s.palette.stops);
 });
 it('keeps explicit same-value events and rejects oversize input before mutation',()=>{
  const s=openSourceSamilaPaletteEditor(scene()),same=value(changeSourceSamilaPalette(s,raw));expect(same).not.toBe(s);expect(same.samilaSourcePalette!.colors).toEqual(raw);
  expect(changeSourceSamilaPalette(s,new Array(1025).fill('#ffffff'))).toMatchObject({ok:false,error:{kind:'capacity'}});expect(changeSourceSamilaPalette(s,['x'.repeat(524289)])).toMatchObject({ok:false,error:{kind:'capacity'}});expect(s.samilaSourcePalette!.colors).toEqual(raw);
 });
 it('keeps cold and effective state separate from author values in files, metadata and same-id opens',()=>{
  const first=ensureSourceSamilaPaletteSession(scene());first.parameters={a:1};const applied=applySourceSamilaPalette(first),hot=syncSourceSamilaPaletteSession(applied,{...applied,parameters:{a:7}}),reset=restartSourceSamilaPalette(hot);
  expect(sourceSamilaPaletteRuntimeScene(reset).parameters).toEqual({a:1});expect(parseScene(serializeScene(reset)).parameters).toEqual({a:7});
  const named=syncSourceSamilaPaletteSession(reset,{...reset,name:'Renamed'});expect(named.samilaPaletteSession).toBe(reset.samilaPaletteSession);expect(sourceSamilaPaletteRuntimeScene(named).parameters).toEqual({a:1});
  const sameId=ensureSourceSamilaPaletteSession({...scene(['#123456']),id:first.id,parameters:{a:99}}),opened=syncSourceSamilaPaletteSession(named,sameId);expect(opened).toBe(sameId);expect(sourceSamilaPaletteRuntimeScene(opened).parameters).toEqual({a:99});expect(restartSourceSamilaPalette(opened).palette.stops).toEqual(['#123456','#123456']);
  expect(ensureSourceSamilaPaletteSession(opened)).toBe(opened);
 });

});
