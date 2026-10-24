import {describe,expect,it} from 'vitest';
import {parseLegacyScene,parseProjectFile} from '../src/engine/legacyImport';
import {parseScene,serializeScene} from '../src/engine/document';
import {createDefaultFractalSourceColorConfiguration,parseFractalSourceColorConfiguration,prepareFractalSourceColor,prepareFractalSourceColorImport} from '../src/engine/fractalSourceColor';
import {commitFractalSourcePalette,restoreFractalSourceManualPalette,fractalSourcePaletteMode} from '../src/engine/fractalSourcePaletteEditing';
import {defaultSourceCurvePalette,generateSourceCosinePalette,generateSourceCurvePalette,normalizeSourceCosinePalette,normalizeSourceCurvePalette,type SourceGradientPaletteCommit} from '../src/engine/sourceGradientPaletteGeneration';
const fixture=(color:Record<string,unknown>={})=>({config_version:'1.0.0',type:'FRACTAL',name:'Generator owner',fractal:{formula_id:'newton'},palette:['#80112233','bad',...Array.from({length:30},(_,i)=>'#'+i.toString(16).padStart(6,'0'))],color});
const value=<T>(result:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!result.ok)throw Error(JSON.stringify(result.error));return result.value;};
function cosine(kind:SourceGradientPaletteCommit['kind'],configuration:ReturnType<typeof createDefaultFractalSourceColorConfiguration>,count:number,a=.5):SourceGradientPaletteCommit {
 const state=value(normalizeSourceCosinePalette({...configuration.palette.cosine,a:[a,.5,.5],colorCount:count}));return{kind,mode:'cosine',state,colors:value(generateSourceCosinePalette(state))};
}
function curve(kind:SourceGradientPaletteCommit['kind'],count=7):SourceGradientPaletteCommit {
 const state=value(normalizeSourceCurvePalette({...defaultSourceCurvePalette(),colorCount:count,red:[{id:'right',x:1,y:0},{id:'left',x:0,y:1},{id:'middle',x:.25,y:.9}]}));return{kind,mode:'curve',state,colors:value(generateSourceCurvePalette(state))};
}
const lut=(configuration:ReturnType<typeof createDefaultFractalSourceColorConfiguration>)=>prepareFractalSourceColor({configuration,formulaPower:3,bailout:.001});

describe('Fractal generator authored / continuous renderer boundary',()=>{
 it('keeps old saved omission and independent project/runtime defaults without generating colors',()=>{
  const original=createDefaultFractalSourceColorConfiguration(),parsed=parseFractalSourceColorConfiguration(original);
  expect(parsed).toEqual(original);expect(parsed.palette).not.toHaveProperty('useCurve');expect(parsed.palette).not.toHaveProperty('curves');
  const raw={config_version:'1.0.0',type:'FRACTAL',name:'Defaults',fractal:{formula_id:'newton'}};
  const project=parseProjectFile(JSON.stringify(raw)).scene.fractalSourceColor!,runtime=parseLegacyScene(JSON.stringify(raw)).scene.fractalSourceColor!;
  expect(project.palette.useCosine).toBe(false);expect(project.palette.colors).toHaveLength(7);expect(runtime.palette.useCosine).toBe(true);expect(runtime.palette.colors).toHaveLength(6);
 });
 it('imports raw flags and unnormalized Curve floats once, saves them, and leaves original source intact',()=>{
  const source=fixture({use_cosine_palette:true,use_curve_palette:true,cosine_a:[.1,.2,.3],curve_red:[{x:1.3,y:-.2},{x:'.25f',y:'0x1.8p-1f'},{x:'.25',y:1}],curve_green:[]}),before=structuredClone(source);
  const imported=parseProjectFile(JSON.stringify(source)),p=imported.scene.fractalSourceColor!.palette;
  expect(p.useCosine).toBe(true);expect(p.useCurve).toBe(true);expect(fractalSourcePaletteMode(p)).toBe('curve');expect(p.colors).toEqual(source.palette);
  expect(p.curves!.red!.map(({x,y})=>[x,y])).toEqual([[Math.fround(1.3),Math.fround(-.2)],[.25,.75],[.25,1]]);expect(p.curves!.green).toEqual([]);expect(p.curves).not.toHaveProperty('blue');
  expect(new Set(p.curves!.red!.map(x=>x.id)).size).toBe(3);expect(imported.scene.provenance!.original).toEqual(before);expect(source).toEqual(before);
  const saved=serializeScene(imported.scene);expect(parseScene(saved).fractalSourceColor).toEqual(imported.scene.fractalSourceColor);expect(JSON.parse(saved).provenance.original).toEqual(source);
 });
 it('preserves both flags through Curve parameter edits; only explicit mode changes make them exclusive',()=>{
  const before=prepareFractalSourceColorImport(fixture({use_cosine_palette:true,use_curve_palette:true})).configuration;
  const changed=value(commitFractalSourcePalette(before,curve('change')));
  expect(changed.palette).toMatchObject({useCosine:true,useCurve:true});expect([...lut(changed).lut]).toEqual([...lut(before).lut]);
  const switched=value(commitFractalSourcePalette(changed,curve('mode')));expect(switched.palette).toMatchObject({useCosine:false,useCurve:true});expect([...lut(switched).lut]).not.toEqual([...lut(changed).lut]);
 });
 it('count edits change the saved discrete list while continuous Cosine still samples 1024 points',()=>{
  const c=createDefaultFractalSourceColorConfiguration(),two=value(commitFractalSourcePalette(c,cosine('change',c,2))),many=value(commitFractalSourcePalette(two,cosine('change',two,25)));
  expect(two.palette.colors).toHaveLength(2);expect(many.palette.colors).toHaveLength(25);expect(lut(two).lutSize).toBe(1024);expect([...lut(two).lut]).toEqual([...lut(many).lut]);
  const altered=value(commitFractalSourcePalette(many,cosine('change',many,25,.25)));expect([...lut(altered).lut]).not.toEqual([...lut(many).lut]);
 });
 it('keeps author-only Curve points/flags out of runtime identities and LUT values',()=>{
  const c=createDefaultFractalSourceColorConfiguration(),before=lut(c);c.palette.useCurve=true;c.palette.curves={red:[{id:'a',x:.2,y:.7}]};
  const after=lut(c);expect(after.key).toBe(before.key);expect(after.lutKey).toBe(before.lutKey);expect([...after.lut]).toEqual([...before.lut]);
 });
 it('restores only the Manual colors after editing generators, retaining all other author fields',()=>{
  const c=prepareFractalSourceColorImport(fixture({use_cosine_palette:false})).configuration,raw=[...c.palette.colors],original=structuredClone(c);
  c.palette.offset=.3;c.palette.gamma=2;c.palette.space='hsv';c.inside.solidColor='#12010203';
  const generated=value(commitFractalSourcePalette(c,cosine('mode',c,9,.25))),curved=value(commitFractalSourcePalette(generated,curve('mode',9))),restored=value(restoreFractalSourceManualPalette(curved,raw));
  expect(restored.palette.colors).toEqual(raw);expect(restored.palette).toMatchObject({useCosine:false,useCurve:false,offset:.3,gamma:2,space:'hsv',cosine:generated.palette.cosine,curves:curved.palette.curves});expect(restored.inside).toEqual(c.inside);expect(original.palette.colors).toEqual(raw);
 });
 it('bakes generated colors to Manual without losing the generator parameters',()=>{
  const c=createDefaultFractalSourceColorConfiguration(),action=cosine('bake',c,8,.2),baked=value(commitFractalSourcePalette(c,action));
  expect(baked.palette.colors).toEqual(action.colors);expect(baked.palette).toMatchObject({useCosine:false,useCurve:false});expect(baked.palette.cosine.a[0]).toBe(Math.fround(.2));
 });
 it.each([[],['#80112233'],fixture().palette].map(colors=>({colors})))('Manual restoration retains exact authored empty/single/tail colors: %j',({colors})=>{
  const c=createDefaultFractalSourceColorConfiguration(),next=value(restoreFractalSourceManualPalette(c,colors));expect(next.palette.colors).toEqual(colors);expect(c.palette.colors).not.toEqual(colors);
 });
 it('rejects invalid saved author data without rewriting an existing configuration',()=>{
  const c=createDefaultFractalSourceColorConfiguration(),before=structuredClone(c);
  expect(()=>parseFractalSourceColorConfiguration({...c,palette:{...c.palette,useCurve:'true'}})).toThrow('boolean required');
  expect(()=>parseFractalSourceColorConfiguration({...c,palette:{...c.palette,curves:{red:[{id:'bad',x:NaN,y:0}]}}})).toThrow('finite number required');
  expect(()=>prepareFractalSourceColorImport(fixture({curve_red:[{x:'1/2',y:0}]}))).toThrow('finite source Float required');
  expect(()=>prepareFractalSourceColorImport(fixture({curve_red:Array.from({length:65531},()=>({x:0,y:0}))}))).toThrow('65536-point');expect(c).toEqual(before);
 });
});
