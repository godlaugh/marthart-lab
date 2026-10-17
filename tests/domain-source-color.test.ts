import {describe,it,expect} from 'vitest';
import vectors from './fixtures/domain-source/color-vectors.json';
import {DEFAULT_DOMAIN_SOURCE_COLORS,MAX_DOMAIN_SOURCE_COLORS,domainSourceColorRgbHex,domainSourcePackedColor,domainSourceOklabDistance,parseDomainColorVersion,parseDomainSourcePalette,prepareDomainSourceColor,prepareDomainSourcePalette,sampleDomainSourcePalette,sourceColorLerp,withDomainSourceColorRgb,type DomainSourceInterpolation} from '../src/engine/domainSourceColor';
const gpu='mathart-1.7.8-gpu' as const,cpu='mathart-1.7.8-cpu' as const;
const hex=(v:number)=>'#'+v.toString(16).padStart(8,'0').toUpperCase();
const space=(v:string)=>v.toLowerCase() as DomainSourceInterpolation;

describe('explicit source Domain color owner',()=>{
 it('matches independent bytecode-derived ManimColors vectors without using local palette arithmetic',()=>{
  for(const v of [...vectors.midpoint,...vectors.fractional])expect(hex(sourceColorLerp(domainSourcePackedColor(v.a),domainSourcePackedColor(v.b),v.t,space(v.mode))),JSON.stringify(v)).toBe(v.expected);
 });
 it('matches independent adaptive insertion including closure, threshold, first-largest tie and 0/1/15/16/17 cardinality',()=>{
  for(const v of vectors.palettes){const facts=prepareDomainSourcePalette({version:gpu,colors:v.raw,runtime:{running:true,interpolation:space(v.mode)}});expect(facts.packed.map(hex),v.id+' '+v.mode).toEqual(v.expected);expect(facts.sourcePacked.map(hex)).toEqual(v.raw);}
  expect(domainSourceOklabDistance(0xff000000,0xff1a1a1a)).toBeLessThan(.22);
  expect(domainSourceOklabDistance(0xff000000,0xff1b1b1b)).toBeGreaterThan(.22);
 });
 it('preserves source strings, successful formats, alpha, unusual short hex and empty arrays',()=>{
  const colors=['#aBcDeF','#80AbCdEf','0xabcdef','0x80abcdef','-1','+12','#abc','#'];
  const parsed=parseDomainSourcePalette({colors});expect(parsed.colors).toEqual(colors);expect(parsed.colors).not.toBe(colors);
  expect(colors.map(domainSourcePackedColor)).toEqual([0xffabcdef,0x80abcdef,0xffabcdef,0x80abcdef,0xffffffff,12,0x000ffabc,255]);
  expect(domainSourceColorRgbHex('#abc')).toBe('#0FFABC');expect(withDomainSourceColorRgb('#80abcdef','#123456')).toBe('#80123456');
  expect(withDomainSourceColorRgb('-1','#000000')).toBe('#FF000000');expect(parseDomainSourcePalette({colors:[]})).toEqual({colors:[]});
 });
 it('rejects malformed owned palettes and resource excess instead of deleting or replacing colors',()=>{
  for(const value of [null,undefined,[],{}, {colors:null},{colors:['white']},{colors:[' #ffffff']},{colors:['0Xffffff']},{colors:['2147483648']},{colors:['#8000000000000000']},{colors:[null]},{colors:new Array(1)}])expect(()=>parseDomainSourcePalette(value)).toThrow();
  expect(()=>parseDomainSourcePalette({colors:new Array(MAX_DOMAIN_SOURCE_COLORS+1).fill('#000000')})).toThrow(/预算/);
  expect(()=>parseDomainSourcePalette({colors:new Array(1024).fill('0'.repeat(1025))})).toThrow(/预算/);
  expect(()=>withDomainSourceColorRgb('#123456','#abc')).toThrow();
 });
 it('uses only the explicit version and distinguishes omitted default colors from explicit zero colors',()=>{
  expect(parseDomainColorVersion(undefined)).toBe('local-v1');for(const v of [null,'gpu','mathart-1.7.9-gpu',false])expect(()=>parseDomainColorVersion(v)).toThrow();
  const defaults=prepareDomainSourcePalette({version:gpu});expect(defaults.sourcePacked).toEqual(DEFAULT_DOMAIN_SOURCE_COLORS.map(domainSourcePackedColor));
  expect(prepareDomainSourcePalette({version:gpu,colors:[]}).packed).toEqual([]);
  expect(prepareDomainSourceColor({version:gpu,colors:[],curveMode:'NONE',bias:0}).sample([1,0])).toEqual([0,0,0]);
 });
 it('preserves source float normalization separately from stripe minimum and rejects wrong types',()=>{
  const f=prepareDomainSourceColor({version:cpu,phaseDensity:1e-6,modDensity:0,phaseSharpness:NaN,modSharpness:1e40,bias:2,mix:-1}).facts;
  expect(f.phaseDensity).toBe(Math.fround(1e-6));expect(f.modDensity).toBe(8);expect(f.phaseSharpness).toBe(1);expect(f.modSharpness).toBe(1);expect(f.bias).toBe(1);expect(f.mix).toBe(0);
  expect(prepareDomainSourceColor({version:cpu,bias:NaN,mix:Infinity}).facts.bias).toBe(Math.fround(.15));
  for(const patch of [{phaseDensity:'12'},{bias:false},{curveMode:'phase'},{paletteOffset:Infinity},{paletteOffset:1e40}])expect(()=>prepareDomainSourceColor({version:cpu,...patch})).toThrow();
 });
 it('keeps CPU full palette and uses N-cycle only while running; GPU uses prepared N-1 intervals',()=>{
  const colors=Array.from({length:17},(_,i)=>'#'+(i*13).toString(16).padStart(2,'0').repeat(3));
  const stopped=prepareDomainSourcePalette({version:cpu,colors}),running=prepareDomainSourcePalette({version:cpu,colors,runtime:{running:true,interpolation:'rgb'}}),shader=prepareDomainSourcePalette({version:gpu,colors});
  expect(stopped.packed).toHaveLength(17);expect(running.packed).toHaveLength(17);expect(shader.packed).toHaveLength(16);
  const pair=['#ff0000','#0000ff'];
  expect(sampleDomainSourcePalette(prepareDomainSourcePalette({version:cpu,colors:pair,runtime:{running:true,interpolation:'rgb'}}),.5)).toEqual([0,0,1]);
  expect(sampleDomainSourcePalette(prepareDomainSourcePalette({version:cpu,colors:pair}),.5)).toEqual([.5,0,.5]);
  expect(sampleDomainSourcePalette(prepareDomainSourcePalette({version:gpu,colors:pair}),1)).toEqual([1,0,0]);
 });
 it('uses alpha for closure identity although display RGB ignores alpha',()=>{
  const a=prepareDomainSourcePalette({version:gpu,colors:['#00ff0000','#ffff0000'],runtime:{running:true,interpolation:'rgb'}});
  expect(a.packed).toEqual([0x00ff0000,0xffff0000,0x00ff0000]);expect(a.entries).toEqual([[1,0,0],[1,0,0],[1,0,0]]);
 });
 it('uses product stripes and additive bias without the local magnitude fade',()=>{
  const settings={colors:['#ffffff'],bias:0,phaseDensity:1,modDensity:1,phaseSharpness:1,modSharpness:1};
  for(const version of [cpu,gpu]){
   const unmodulated=prepareDomainSourceColor({...settings,version,curveMode:'NONE'});expect(unmodulated.sample([0,0])).toEqual([1,1,1]);expect(unmodulated.sample([1e-10,0])).toEqual([1,1,1]);
   const shade=prepareDomainSourceColor({...settings,version,curveMode:'PHASE_MODULUS'}).sample([0,Math.E]);
   const expected=.5*(.5+.5*Math.cos(1));expect(shade[0]).toBeCloseTo(expected,2);expect(shade[0]).toBeLessThan(.4);
   expect(prepareDomainSourceColor({...settings,version,curveMode:'NONE',bias:-.25}).sample([1,0])[0]).toBeCloseTo(.75,2);
  }
 });
 it('keeps source CPU packed truncation distinct from GPU continuous RGB',()=>{
  const settings={colors:['#ffffff'],curveMode:'NONE',bias:-.5};
  expect(prepareDomainSourceColor({...settings,version:cpu}).sample([1,0])).toEqual([127/255,127/255,127/255]);
  expect(prepareDomainSourceColor({...settings,version:gpu}).sample([1,0])).toEqual([.5,.5,.5]);
 });
 it('retains the distinct invalid-value source paths',()=>{
  const settings={colors:['#ff0000','#00ff00','#0000ff'],curveMode:'NONE',bias:0};
  const shader=prepareDomainSourceColor({...settings,version:gpu}),software=prepareDomainSourceColor({...settings,version:cpu});
  expect(shader.sample([NaN,1])).toEqual([1,0,0]);expect(software.sample([NaN,1])).toEqual([0,0,0]);
  expect(shader.sample([Infinity,Infinity])).toEqual([1,0,0]);expect(software.sample([Infinity,Infinity])).not.toEqual([1,0,0]);
  expect(prepareDomainSourceColor({...settings,version:cpu,runtime:{running:true,interpolation:'oklch'}}).sample([NaN,1])).toEqual([0,0,0]);
 });
 it('does not let caller mutation alter prepared facts or samples',()=>{
  const colors=['#ff0000','#0000ff'],prepared=prepareDomainSourceColor({version:cpu,colors,curveMode:'NONE',bias:0});const before=prepared.sample([0,1]);colors[0]='#ffffff';expect(prepared.sample([0,1])).toEqual(before);expect(Object.isFrozen(prepared.facts.palette.entries[0])).toBe(true);
 });
});
