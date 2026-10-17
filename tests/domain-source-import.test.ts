import {describe,it,expect} from 'vitest';
import {parseLegacyScene,parseProjectFile} from '../src/engine/legacyImport';
import {createScene,parseScene,persistentScene} from '../src/engine/document';
import {withDomainColorVersion} from '../src/engine/domainAuthoring';
import {definition} from '../src/scenes';
import {domainEvaluator,parseDomainModel} from '../src/engine/domainModel';
import {domainExpressions} from '../src/engine/domainExpressions';
import {DEFAULT_DOMAIN_SOURCE_COLORS} from '../src/engine/domainSourceColor';
import {sceneAtTime} from '../src/engine/timeline';
import {exploreComplex} from '../src/engine/complexExplore';

const native=(patch:Record<string,unknown>={})=>({config_version:'1.0.0',type:'DOMAIN_COLORING',name:'Source Domain',domainColoring:{formula:'z'},...patch});
const read=(source:unknown)=>parseLegacyScene(JSON.stringify(source));
describe('source Domain import and persistent authoring',()=>{
 it('imports commented files through the same entry used by the App, preserving strings and provenance',()=>{
  const source=native({name:'https://example.test/*keep*/',palette:['#80112233']});
  const text='// source file\n'+JSON.stringify(source).replace('"palette":','/* colors */"palette":');
  const result=parseProjectFile(text);expect(result.format).toBe('mathart');expect(result.scene.name).toBe(source.name);expect(result.scene.provenance?.original).toEqual(source);
  result.scene.domainSourcePalette!.colors[0]='#ffffff';expect(result.scene.provenance?.original).toEqual(source);
  expect(parseScene(JSON.stringify(result.scene)).provenance).toEqual(result.scene.provenance);
 });
 it('routes a local document through its validator without changing legacy behavior',()=>{
  const s=createScene(definition('domain')),result=parseProjectFile(JSON.stringify(s));expect(result).toEqual({format:'local',scene:s,warnings:[]});
  expect(()=>parseProjectFile(JSON.stringify({...s,settings:{...s.settings,domainColorVersion:'future-v2'}}))).toThrow('颜色版本');
 });
 it('rejects malformed file boundaries before constructing a scene',()=>{
  for(const text of ['null','[]','{/* unclosed','{"version":1}',' '.repeat(8*1024*1024+1)])expect(()=>parseProjectFile(text)).toThrow();
 });
 it('selects the documented runtime-config entry defaults and preserves omission',()=>{
  const source=native(),r=read(source);expect(r.scene.settings).toMatchObject({domainColorVersion:'mathart-1.7.8-gpu',domainIterationVersion:'mathart-1.7.8-gpu',domainSourceImportPath:'runtime-config',iterationSteps:1,iterationMaxSteps:64});
  expect(r.scene.domainSourcePalette).toBeUndefined();expect(parseScene(JSON.stringify(r.scene)).domainSourcePalette).toBeUndefined();expect(r.source).toEqual(source);expect(r.warnings.join()).toContain('运行时配置');
 });
 it.each([
  [{isCPURender:true},'mathart-1.7.8-cpu'],[{isCPURender:'TRUE'},'mathart-1.7.8-cpu'],[{isCPURender:' true '},'mathart-1.7.8-gpu'],
  [{isCPURender:true,render_mode:'gPu'},'mathart-1.7.8-gpu'],[{render_mode:' GPU '},'mathart-1.7.8-cpu'],
  [{render_mode:'unknown'},'mathart-1.7.8-cpu'],[{render_mode:12},'mathart-1.7.8-cpu'],[{isCPURender:true,render_mode:null},'mathart-1.7.8-cpu'],
 ] as const)('keeps source selection independent of the device backend: %j', (settings,version)=>{
  const scene=read(native({settings})).scene;expect(scene.settings.domainColorVersion).toBe(version);expect(scene.settings.domainBackend).toBe('auto');
  scene.settings.domainBackend='cpu';expect(parseScene(JSON.stringify(scene)).settings.domainColorVersion).toBe(version);
 });
 it.each([[],['#123456'],['#00112233','#ff112233'],Array.from({length:17},(_,i)=>'#'+i.toString(16).padStart(6,'0'))].map(colors=>({colors})))('preserves all source colors and alpha across save/load: $colors',({colors})=>{
  const source=native({palette:colors}),r=read(source),parsed=parseScene(JSON.stringify(r.scene));expect(parsed.domainSourcePalette?.colors).toEqual(colors);
  if(r.scene.domainSourcePalette!.colors.length)r.scene.domainSourcePalette!.colors[0]='#ffffff';expect(r.source).toEqual(source);
 });
 it('does not import the rich local palette as the source renderer palette',()=>{
  const colors=['0xff00ff00','-65536','#ABC'],source=native({palette:colors}),r=read(source);expect(r.scene.domainSourcePalette?.colors).toEqual(colors);expect(parseScene(JSON.stringify(r.scene)).palette).toEqual(r.scene.palette);
 });
 it('preserves out-of-control-range authored numeric values and separate maxSteps',()=>{
  const source=native({domainColoring:{formula:'z',levelCurve:{phaseDensity:1e-8,modDensity:70,phaseSharpness:8,modSharpness:-2,bias:3,mix:-1},iteration:{enabled:true,steps:999,maxSteps:100,nextFormula:'w',escapeRadius:.001}}});
  const s=read(source).scene,parsed=parseScene(JSON.stringify(s));expect(parsed.settings).toMatchObject({phaseDensity:1e-8,modDensity:70,phaseSharpness:8,modSharpness:-2,curveBias:3,curveMix:-1,iterationSteps:999,iterationMaxSteps:100,bailout:.001});
  const before=JSON.stringify(parsed),model=parseDomainModel(parsed,0);expect(model.steps).toBe(100);expect(JSON.stringify(parsed)).toBe(before);
 });
 it.each(['','   '])('accepts an empty next formula without inventing an override',nextFormula=>{
  const s=read(native({domainColoring:{formula:'z',iteration:{enabled:false,nextFormula}}})).scene;
  expect(s.equations.next).toBe(nextFormula);
  for(const enabled of [false,true]){
   const model=parseDomainModel({...s,settings:{...s.settings,iterationEnabled:enabled}},0),facts=domainExpressions.get(model);
   expect(model.next).toBe(nextFormula);expect(facts.effectiveNext).toBeUndefined();expect(facts.next).toBeUndefined();
   expect(domainEvaluator(model)([.25,-.5])).toEqual([.25,-.5]);
  }
  expect(parseScene(JSON.stringify(s)).equations.next).toBe(nextFormula);
 });
 it('uses the source default formula when missing, while preserving authored invalid text',()=>{
  expect(read(native({domainColoring:{}})).scene.equations.f).toBe('z^3 - 1');
  const invalid=read(native({domainColoring:{formula:''}}));expect(invalid.scene.equations.f).toBe('');expect(parseDomainModel(invalid.scene,0).executionWarnings).toEqual([]);
  const numeric=read(native({domainColoring:{formula:42,iteration:{nextFormula:1}}}));expect(numeric.scene.equations).toMatchObject({f:'42',next:'1'});expect((numeric.source as {domainColoring:{formula:number}}).domainColoring.formula).toBe(42);
 });
 it('only consults legacy nested sampling when the iteration object is absent',()=>{
  const sampling={iterations:65,maxIterations:100,clampMagnitude:.5};
  const legacy=read(native({domainColoring:{formula:'z',sampling}})).scene;expect(legacy.settings).toMatchObject({iterationEnabled:true,iterationSteps:65,iterationMaxSteps:100,bailout:.5});expect(parseDomainModel(legacy,0).steps).toBe(65);
  const explicit=read(native({domainColoring:{formula:'z',sampling,iteration:{}}}));expect(explicit.scene.settings).toMatchObject({iterationEnabled:false,iterationSteps:1,iterationMaxSteps:64});expect(explicit.warnings.join()).toContain('sampling');
  expect(()=>read(native({domainColoring:{formula:'z',sampling,iteration:null}}))).toThrow();
 });
 it('renders the source no-fade color rule through the real imported scene',()=>{
  const s=read(native({palette:['#ff0000','#0000ff'],domainColoring:{formula:'.25',levelCurve:{mode:'NONE',mix:0,bias:0}}})).scene;s.settings.domainBackend='cpu';
  const out=definition('domain').generate(s,{time:0,width:3,height:2,quality:'export'});if(out.type!=='raster')throw Error('raster');expect([...out.pixels]).toEqual(Array.from({length:6},()=>[255,0,0,255]).flat());
 });
 it('keeps missing-version local documents and their authored palette unchanged',()=>{
  const s=createScene(definition('domain')),before=JSON.stringify(s),parsed=parseScene(before);expect(parsed.settings.domainColorVersion).toBeUndefined();expect(parsed.domainSourcePalette).toBeUndefined();expect(JSON.stringify(parsed)).toBe(before);
 });
 it('switches deliberately, retaining independently edited palettes through reload and back',()=>{
  const s=createScene(definition('domain')),before=JSON.stringify(s),source=withDomainColorVersion(s,'mathart-1.7.8-gpu');expect(source.domainSourcePalette?.colors).toEqual(s.palette.stops);
  expect(source.settings.domainIterationVersion).toBeUndefined();expect(parseDomainModel(source,0).next).toBeUndefined();expect(source.equations.next).toBe(s.equations.next);
  source.domainSourcePalette!.colors[0]='#aa112233';expect(JSON.stringify(s)).toBe(before);
  const local=withDomainColorVersion(parseScene(JSON.stringify(source)),'local-v1');local.palette.stops[0]='#778899';
  const back=withDomainColorVersion(parseScene(JSON.stringify(local)),'mathart-1.7.8-cpu');expect(back.domainSourcePalette?.colors[0]).toBe('#aa112233');expect(back.palette.stops[0]).toBe('#778899');
  expect(persistentScene(back).domainSourcePalette).toEqual(back.domainSourcePalette);
 });
 it('retains the omitted runtime default across source backend and local version changes',()=>{
  const s=read(native()).scene,other=withDomainColorVersion(s,'mathart-1.7.8-cpu');expect(other.domainSourcePalette).toBeUndefined();
  const local=withDomainColorVersion(other,'local-v1'),back=withDomainColorVersion(local,'mathart-1.7.8-gpu');expect(back.domainSourcePalette?.colors).toEqual(DEFAULT_DOMAIN_SOURCE_COLORS);
 });
 it('rejects unknown versions and malformed owned palettes even when inactive',()=>{
  const s=createScene(definition('domain'));
  expect(()=>parseScene(JSON.stringify({...s,settings:{...s.settings,domainColorVersion:'future-v2'}}))).toThrow();
  for(const invalid of [{colors:['not-a-color']},{colors:[22]},{colors:null},[]])expect(()=>parseScene(JSON.stringify({...s,domainSourcePalette:invalid}))).toThrow();
 });
 it('owns timeline palette copies and observes palette edits on warm evaluation',()=>{
  const s=read(native({palette:['#123456','#abcdef']})).scene,before=JSON.stringify(s),at=sceneAtTime(s,0);
  at.domainSourcePalette!.colors[0]='#ff0000';expect(JSON.stringify(s)).toBe(before);
  s.domainSourcePalette!.colors[0]='#00ff00';expect(sceneAtTime(s,0).domainSourcePalette!.colors[0]).toBe('#00ff00');
 });
 it('applies an explored source formula to the producer rather than retaining an active old next',()=>{
  const s=read(native({domainColoring:{formula:'z',iteration:{enabled:false,seedMode:'ZERO',nextFormula:'1'}}})).scene,before=JSON.stringify(s);
  const result=exploreComplex(s,{kind:'domain',seed:42,family:'POLY_TRIG_BLEND',candidateCount:2});expect(result.status).toBe('found');
  expect(result.scene!.settings).toMatchObject({iterationEnabled:false,seedMode:'PIXEL_Z'});expect(result.scene!.equations.next).toBe('');
  const model=parseDomainModel(result.scene!,0),facts=domainExpressions.get(model),evaluate=domainEvaluator(model);
  expect(model.next).toBe('');expect(facts.effectiveNext).toBeUndefined();expect(facts.next).toBeUndefined();
  for(const pixel of [[.25,-.5],[-.75,.25]] as [number,number][]){
   expect(evaluate(pixel)).toEqual(facts.f({...model.parameters,z:pixel,w:pixel,c:model.constant}));
  }
  expect(JSON.stringify(s)).toBe(before);
 });
});
