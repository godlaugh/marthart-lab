import {describe,expect,it} from 'vitest';
import {parseLegacyScene,parseProjectFile} from '../src/engine/legacyImport';
import {parseScene,serializeScene,persistentScene} from '../src/engine/document';
import {changeDomainSourcePalette,commitDomainSourcePalette,domainPaletteEditorMode,domainPaletteEditorState,domainPaletteRuntimeScene,restoreDomainSourceManualPalette,retainDomainPaletteEditorOnSave} from '../src/engine/domainPaletteEditing';
import {defaultSourceCurvePalette,generateSourceCosinePalette,generateSourceCurvePalette,normalizeSourceCosinePalette,normalizeSourceCurvePalette,type SourceGradientPaletteCommit} from '../src/engine/sourceGradientPaletteGeneration';
import {prepareDomainSourcePalette} from '../src/engine/domainSourcePalette';
import {snapshotGenerationInput} from '../src/engine/generationInput';
import {SourceDomainLiveSession} from '../src/engine/sourceDomainLiveSession';
import {generateDomain} from '../src/engine/domain';
import type {SceneDocument,GenerationInput} from '../src/types';

const rawColors=['#80AbCdEf','-1','#abc',...Array.from({length:29},(_,i)=>'#'+i.toString(16).padStart(6,'0'))];
const source=(color:unknown={},palette=rawColors)=>({config_version:'1.0.0',type:'DOMAIN_COLORING',name:'Domain generator owner',palette,color,domainColoring:{formula:'z'},timeline:[{type:'wait',duration:1}]});
const scene=(color:unknown={},palette=rawColors)=>parseProjectFile(JSON.stringify(source(color,palette))).scene;
const value=<T>(result:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!result.ok)throw Error(JSON.stringify(result.error));return result.value;};
function cosine(s:SceneDocument,kind:SourceGradientPaletteCommit['kind']='mode',count=9):SourceGradientPaletteCommit {
 const state=value(normalizeSourceCosinePalette({...domainPaletteEditorState(s).cosine,a:[.2,.3,.4],colorCount:count}));return{kind,mode:'cosine',state,colors:value(generateSourceCosinePalette(state))};
}
function curve(kind:SourceGradientPaletteCommit['kind']='mode',count=7):SourceGradientPaletteCommit {
 const state=value(normalizeSourceCurvePalette({...defaultSourceCurvePalette(),colorCount:count,red:[{id:'right',x:1,y:0},{id:'left',x:0,y:1}]}));return{kind,mode:'curve',state,colors:value(generateSourceCurvePalette(state))};
}
describe('Domain opened-project generator owner',()=>{
 it('imports source ProjectState once without applying, normalizing or reinterpreting unrelated color fields',()=>{
  const color={use_cosine_palette:true,use_curve_palette:true,cosine_a:['.1f','0x1.8p-1f',-2,9],cosine_b:[8],curve_red:[{x:1.2,y:-.1},{x:'.25f',y:'.8'},{x:.25,y:.2}],curve_green:[],inside:null},raw=source(color),s=parseProjectFile(JSON.stringify(raw)).scene;
  expect(s.domainSourcePalette?.colors).toEqual(rawColors);expect(domainPaletteEditorMode(s.domainPaletteEditor!)).toBe('curve');
  expect(s.domainPaletteEditor).toMatchObject({useCosine:true,useCurve:true,colorCount:25,cosine:{a:[Math.fround(.1),.75,-2],b:[.5,.5,.5]},curves:{green:[]}});
  expect(s.domainPaletteEditor!.curves!.red!.map(({x,y})=>[x,y])).toEqual([[Math.fround(1.2),Math.fround(-.1)],[.25,Math.fround(.8)],[.25,Math.fround(.2)]]);
  expect(s.domainPaletteEditor!.curves).not.toHaveProperty('blue');expect(s.provenance!.original).toEqual(raw);
  const runtime=parseLegacyScene(JSON.stringify(raw)).scene;expect(runtime).not.toHaveProperty('domainPaletteEditor');expect(runtime.domainSourcePalette?.colors).toEqual(rawColors);
 });
 it('separates literal project Floats from direct runtime cosine expressions for both family entrypoints',()=>{
  for(const type of ['DOMAIN_COLORING','FRACTAL']){
   const raw={...source({cosine_a:['1/2',.2,.3]}),type,fractal:{formula_id:'newton'}};
   expect(()=>parseProjectFile(JSON.stringify(raw))).toThrow('finite source Float required');
   const runtime=parseLegacyScene(JSON.stringify(raw)).scene;
   if(type==='FRACTAL')expect(runtime.fractalSourceColor!.palette.cosine.a).toEqual([.5,Math.fround(.2),Math.fround(.3)]);
   else expect(runtime).not.toHaveProperty('domainPaletteEditor');
  }
  for(const color of [{use_curve_palette:1},{curve_red:null},{curve_blue:[{x:'1/2',y:0}]},{cosine_a:[null,0,1]}])expect(()=>scene(color)).toThrow();
 });
 it('defaults to Manual without curves; explicit empty curves and raw color lists remain empty',()=>{
  const s=scene({},[]);expect(s.domainPaletteEditor).toMatchObject({useCosine:false,colorCount:8});expect(s.domainPaletteEditor).not.toHaveProperty('curves');expect(s.domainSourcePalette?.colors).toEqual([]);
  const empty=scene({curve_red:[],curve_green:[],curve_blue:[]},['#80abcdef']);expect(empty.domainPaletteEditor!.curves).toEqual({red:[],green:[],blue:[]});expect(empty.domainSourcePalette?.colors).toEqual(['#80abcdef']);
  expect(()=>scene({},['malformed retained input'])).toThrow(); // Existing explicit Domain failure; no silent filtering/replacement.
 });
 it('preserves both flags on changes, replaces them on explicit mode and only feeds discrete colors to CPU/GPU',()=>{
  const s=scene({use_cosine_palette:true,use_curve_palette:true}),changed=value(commitDomainSourcePalette(s,curve('change',25)));
  expect(changed.domainPaletteEditor).toMatchObject({useCosine:true,useCurve:true,colorCount:25});expect(changed.palette).toBe(s.palette);expect(changed.settings).toBe(s.settings);
  expect(prepareDomainSourcePalette({version:'mathart-1.7.8-cpu',colors:changed.domainSourcePalette!.colors}).packed).toHaveLength(25);
  expect(prepareDomainSourcePalette({version:'mathart-1.7.8-gpu',colors:changed.domainSourcePalette!.colors}).packed).toHaveLength(16);
  const switched=value(commitDomainSourcePalette(changed,cosine(changed)));expect(switched.domainPaletteEditor).toMatchObject({useCosine:true,useCurve:false});expect(s.domainSourcePalette!.colors).toEqual(rawColors);
 });
 it.each([[],['#80AbCdEf'],rawColors].map(colors=>({colors})))('shares the raw Manual snapshot across surfaces and restores colors only: %j',({colors})=>{
  const s=scene({},colors),generated=value(commitDomainSourcePalette(s,cosine(s))),curved=value(commitDomainSourcePalette(generated,curve())),restored=value(restoreDomainSourceManualPalette(curved));
  expect(restored.domainSourcePalette!.colors).toEqual(colors);expect(restored.domainPaletteEditor).toMatchObject({useCosine:false,useCurve:false,colorCount:7,cosine:generated.domainPaletteEditor!.cosine,curves:curved.domainPaletteEditor!.curves});expect(restored.domainPaletteEditor).not.toHaveProperty('manualColors');
  const baked=value(commitDomainSourcePalette(curved,curve('bake')));expect(baked.domainPaletteEditor).not.toHaveProperty('manualColors');expect(value(restoreDomainSourceManualPalette(baked)).domainSourcePalette).toEqual(baked.domainSourcePalette);
 });
 it('initially loaded generator has no previous Manual snapshot; manual edits preserve current parameters',()=>{
  const s=scene({use_cosine_palette:true,cosine_a:[.1,.2,.3]}),manual=value(restoreDomainSourceManualPalette(s));expect(manual.domainSourcePalette).toEqual(s.domainSourcePalette);
  const edited=value(changeDomainSourcePalette(manual,['#80123456']));expect(edited.domainPaletteEditor!.cosine).toEqual(s.domainPaletteEditor!.cosine);expect(s.domainSourcePalette!.colors).toEqual(rawColors);
 });
 it('keeps session state across save/new id and immutable history, but files/reopen never hydrate it or source provenance',()=>{
  const first=scene({use_cosine_palette:true,use_curve_palette:true,cosine_a:[.8,.7,.6]}),changed=value(commitDomainSourcePalette(first,curve('change',9))),history=structuredClone(first);
  const text=serializeScene(changed),saved=parseScene(text),reopened=parseProjectFile(text).scene;
  expect(JSON.parse(text)).not.toHaveProperty('domainPaletteEditor');expect(saved).not.toHaveProperty('domainPaletteEditor');expect(domainPaletteEditorMode(domainPaletteEditorState(reopened))).toBe('manual');expect(reopened.provenance).toEqual(first.provenance);
  expect(domainPaletteEditorState(reopened).cosine.a).toEqual([.5,.5,.5]);
  const active=retainDomainPaletteEditorOnSave(changed,{...saved,id:'new-library-id'});expect(active.domainPaletteEditor).toBe(changed.domainPaletteEditor);expect(active.id).toBe('new-library-id');expect(persistentScene(active)).not.toHaveProperty('domainPaletteEditor');
  const forged=parseScene(JSON.stringify({...JSON.parse(text),domainPaletteEditor:first.domainPaletteEditor}));expect(forged).not.toHaveProperty('domainPaletteEditor');
  expect(history.domainPaletteEditor!.cosine.a).toEqual([Math.fround(.8),Math.fround(.7),Math.fround(.6)]);expect(history.domainSourcePalette!.colors).toEqual(rawColors);
  const replacement={...scene(),id:first.id};expect(domainPaletteEditorMode(replacement.domainPaletteEditor!)).toBe('manual');
 });
 it('strips session data before transport cloning while retaining evaluated runtime facts',()=>{
  const s=scene();Object.assign(s.domainPaletteEditor!,{uncloneable:()=>undefined});
  s.evaluatedCamera={model:'mandelbulb',time:0,camera:{...s.camera},roll:0,focalLength:1,rayScale:1};
  const projected=domainPaletteRuntimeScene(s);expect(projected).not.toHaveProperty('domainPaletteEditor');expect(projected.evaluatedCamera).toBe(s.evaluatedCamera);expect(projected.domainSourcePalette).toBe(s.domainSourcePalette);expect(domainPaletteRuntimeScene(projected)).toBe(projected);
  const c:GenerationInput={time:0,quality:'preview',width:8,height:6,domainLive:{sessionId:'projection',revision:1,clock:{paused:true},actualFrameRate:30,configuration:s}};
  const input=snapshotGenerationInput(c);expect(input.domainLive!.configuration).not.toHaveProperty('domainPaletteEditor');expect(input.domainLive!.configuration!.evaluatedCamera).toEqual(s.evaluatedCamera);expect(s).toHaveProperty('domainPaletteEditor');
 });
 it('direct live calls never retain or pass the session editor to renderers',()=>{
  const s=scene();s.settings.domainRenderPolicy='source-cpu-always-v1';Object.assign(s.domainPaletteEditor!,{uncloneable:()=>undefined});
  const seen:SceneDocument[]=[],owner=new SourceDomainLiveSession((s,c,session)=>{seen.push(s);return generateDomain(s,c,session);}),c:GenerationInput={time:0,quality:'export',width:4,height:3,domainLive:{sessionId:'direct',revision:0,clock:{paused:true},actualFrameRate:30,configuration:s}};
  const first=owner.generate(s,c);expect(seen.length).toBeGreaterThan(0);expect(seen.every(s=>!Object.hasOwn(s,'domainPaletteEditor'))).toBe(true);expect(first.domainLive.presentation).not.toHaveProperty('domainPaletteEditor');
  expect(owner.diagnostics().retainedBytes).toBe(JSON.stringify(domainPaletteRuntimeScene(s)).length*2);owner.reset();
 });
});
