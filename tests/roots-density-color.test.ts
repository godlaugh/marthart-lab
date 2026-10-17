import {describe,it,expect} from 'vitest';
import vectors from './fixtures/roots/source-color-lut.json';
import {DEFAULT_ROOTS_SOURCE_COLORS,MAX_ROOTS_SOURCE_COLORS,MAX_ROOTS_SOURCE_COLOR_TEXT,ROOTS_DENSITY_COLOR_VERSION,ROOTS_SOURCE_TONE_FIELDS,normalizeRootsSourceMetric,normalizeRootsSourceToneField,parseRootsDensityColorVersion,parseRootsMetricKind,parseRootsSourcePalette,prepareRootsDensityColor,prepareRootsMetric,prepareRootsMetricValue,rootsDensityScale,rootsMetricValue,rootsSourceBackground,rootsSourceColorRgbHex,sampleRootsMetricPalette,toneRootsMetricRgbaPrepared,usesRootsSourceDensity,validateRootsMetricColorPlan,validateRootsSourceColorSettings,withRootsSourceColorRgb,type RootsMetricColorPlan} from '../src/engine/rootsDensityColor';
import {parseRootsSourceScalar} from '../src/engine/rootsSourceScalar';
import {domainSourcePackedColor,parseDomainSourcePalette} from '../src/engine/domainSourcePalette';
import type {Settings} from '../src/types';
const source=ROOTS_DENSITY_COLOR_VERSION;
function plan(colors?:string[],settings:Settings={}):RootsMetricColorPlan {
 const p=prepareRootsDensityColor({settings:{rootDensityColorVersion:source,...settings},...(colors===undefined?{}:{rootsSourcePalette:{colors}})});if(p.kind!=='metric-sum')throw new Error('source');return p;
}
const tone=(ink:number[],p=plan(['#ffffff'],{rootSourceGamma:1,rootSourceBrightness:.5}),n=1)=>Array.from(toneRootsMetricRgbaPrepared(ink.length/4,1,new Float64Array(ink),p,{submittedFinitePointCount:n}));

describe('Roots scalar metric producer and version',()=>{
 it('requires the explicit version without touching old or inactive local controls',()=>{
  expect(parseRootsDensityColorVersion(undefined)).toBe('local-rgb-v1');expect(prepareRootsDensityColor({settings:{gamma:0,rootColor:'unknown'}})).toEqual({kind:'rgb-sum',version:'local-rgb-v1'});
  for(const value of [null,false,1,'metric',{},'mathart-1.7.8'])expect(()=>parseRootsDensityColorVersion(value)).toThrow();
  expect(usesRootsSourceDensity({rootDensityColorVersion:source,rootsMode:'single'})).toBe(false);expect(usesRootsSourceDensity({rootDensityColorVersion:source,rootsMode:'progressive'})).toBe(true);
  expect(parseRootsMetricKind(undefined)).toBe('t2_imag');expect(()=>parseRootsMetricKind(null)).toThrow();
 });
 it('keeps raw fixed t2 values and missing t2 zero independent of display parameter bounds',()=>{
  expect(prepareRootsMetric('t2_real',[0,0],{t2:[.5,0]})).toEqual({raw:.5,float32:.5,clamped:.5});
  for(const kind of ['t2_real','t2_imag'] as const){expect(prepareRootsMetric(kind,[0,0],{}).clamped).toBe(0);expect(prepareRootsMetric(kind,[0,0],Object.create({t2:[1,1]})).raw).toBe(0);}
  expect(prepareRootsMetric('t2_imag',[0,0],{t2:[.5,.25],q:[10,10]}).clamped).toBe(.25);
 });
 it('derives radius by hypot without /3 and keeps derivation separate from admission',()=>{
  expect(rootsMetricValue('radius',[3,4],{})).toBe(5);expect(prepareRootsMetric('radius',[1,0],{})).toEqual({raw:1,float32:1,clamped:1});
  expect(rootsMetricValue('radius',[1e200,1e200],{})).toBe(Math.SQRT2*1e200);expect(rootsMetricValue('radius',undefined,{})).toBe(0);
  expect(rootsMetricValue('t2_real',[0,0],{t2:[NaN,0]})).toBeNaN();expect(()=>prepareRootsMetricValue(NaN)).toThrow(/NaN/);
 });
 it('converts to float before clamp, admits overflowing finite doubles and preserves minus zero',()=>{
  expect([-2,0,.25,1,2,1e300,-1e300].map(x=>prepareRootsMetricValue(x).clamped)).toEqual([0,0,.25,1,1,1,0]);
  expect(prepareRootsMetricValue(1e300).float32).toBe(Infinity);expect(prepareRootsMetricValue(Infinity).clamped).toBe(1);expect(prepareRootsMetricValue(-Infinity).clamped).toBe(0);
  expect(Object.is(prepareRootsMetricValue(-0).clamped,-0)).toBe(true);expect(()=>prepareRootsMetricValue('1' as never)).toThrow();
 });
 it('uses the exact native selector aliases and unknown fallback, not local abs(z)',()=>{
  for(const raw of [undefined,null,'im(t2)',' IM(T2)\n'])expect(normalizeRootsSourceMetric(raw)).toEqual({metric:'t2_imag',diagnostics:[]});
  expect(normalizeRootsSourceMetric('re(t2)').metric).toBe('t2_real');for(const raw of ['root.radius','root.radio'])expect(normalizeRootsSourceMetric(raw).metric).toBe('radius');
  for(const raw of ['abs(z)','radius','',42,'\u00a0re(t2)']){const result=normalizeRootsSourceMetric(raw);expect(result.metric).toBe('t2_imag');expect(result.diagnostics).toHaveLength(1);}
 });
});
describe('Roots source palette and import contracts',()=>{
 it('matches independent full LUT bytecode fixtures including 0/1/2/3/4/17 colors',()=>{
  for(const v of vectors.palettes)expect(Array.from(plan(v.colors).lut),v.id).toEqual(v.rgba);
 });
 it('distinguishes missing four-color palette, explicit empty white and constant singleton',()=>{
  expect(plan().lut).toEqual(plan([...DEFAULT_ROOTS_SOURCE_COLORS]).lut);expect(plan().lut).not.toEqual(plan([]).lut);
  expect([...plan([]).lut].every(v=>v===255)).toBe(true);expect(Array.from(plan(['#80402010']).lut.slice(0,8))).toEqual([64,32,16,255,64,32,16,255]);
 });
 it('keeps strings and invalid color recovery without silently accepting malformed containers',()=>{
  const colors=['#abc','#','0xabcdef','-1','white'];const parsed=parseRootsSourcePalette({colors});expect(parsed.colors).toEqual(colors);expect(parsed.colors).not.toBe(colors);
  const p=plan(['white']);expect(p.diagnostics).toHaveLength(1);expect([...p.lut].every(v=>v===255)).toBe(true);
  expect(rootsSourceColorRgbHex('#abc')).toBe('#0FFABC');expect(rootsSourceColorRgbHex('white')).toBe('#FFFFFF');expect(withRootsSourceColorRgb('#80112233','#445566')).toBe('#80445566');
  for(const raw of [null,[],{}, {colors:null},{colors:[null]},{colors:[1]},{colors:new Array(1)}])expect(()=>parseRootsSourcePalette(raw)).toThrow();
 });
 it('bounds owned source preparation and diagnostics rather than truncating colors',()=>{
  expect(()=>parseRootsSourcePalette({colors:new Array(MAX_ROOTS_SOURCE_COLORS+1).fill('#fff')})).toThrow(/预算/);
  expect(()=>parseRootsSourcePalette({colors:['0'.repeat(MAX_ROOTS_SOURCE_COLOR_TEXT+1)]})).toThrow(/预算/);
  const p=plan(new Array(20).fill('invalid'));expect(p.diagnostics).toHaveLength(9);expect(p.diagnostics[8]).toContain('20');
 });
 it('does not alter the old Domain strict color contract after extracting the shared parser',()=>{
  expect(['#aBcDeF','#80AbCdEf','0xabcdef','0x80abcdef','-1','+12','#abc','#'].map(domainSourcePackedColor)).toEqual([0xffabcdef,0x80abcdef,0xffabcdef,0x80abcdef,0xffffffff,12,0xffabc,255]);
  expect(()=>domainSourcePackedColor('white')).toThrow('原版域色板颜色格式无效');expect(()=>domainSourcePackedColor('2147483648')).toThrow('原版域色板颜色数值越界');expect(()=>parseDomainSourcePalette({colors:['white']})).toThrow();
 });
 it('keeps ConfigUtils scalar defaults, Java-double direct parsing and expression failure zero distinct',()=>{
  expect(parseRootsSourceScalar(undefined,2.2).value).toBe(Math.fround(2.2));expect(parseRootsSourceScalar(null,1).value).toBe(1);
  expect(parseRootsSourceScalar('1e3',1).value).toBe(1000);expect(parseRootsSourceScalar('pi/2',1).value).toBe(Math.fround(Math.PI/2));
  expect(parseRootsSourceScalar('unknown',1)).toMatchObject({value:0});expect(parseRootsSourceScalar('unknown',1).diagnostics).toHaveLength(1);
  expect(parseRootsSourceScalar(true,1).value).toBe(0);expect(parseRootsSourceScalar('1/0',1).value).toBe(Infinity);expect(parseRootsSourceScalar('0/0',1).value).toBeNaN();
  expect(()=>parseRootsSourceScalar('1'.repeat(65537),1)).toThrow(/预算/);
 });
 it('preserves numeric JSON background tokens and the native missing/null default',()=>{
  for(const value of [undefined,null])expect(rootsSourceBackground(value)).toEqual({value:'#000000',diagnostics:[]});
  expect(rootsSourceBackground('#80123456').value).toBe('#80123456');
  const cases:[number,string,string][]=[[1,'1','#000001'],[1,'1.0','#FFFFFF'],[1,'1e0','#FFFFFF'],[-0,'-0','#000000'],[-0,'-0.0','#FFFFFF'],[0,'1e-400','#FFFFFF'],[Infinity,'1e400','#FFFFFF'],[9007199254740992,'9007199254740993','#FFFFFF'],[-1,'-1','#FFFFFF'],[16711680,'16711680','#FF0000']];
  for(const [number,token,rgb]of cases){const parsed=rootsSourceBackground(number,{numberToken:token});expect(parsed.value).toBe(token);expect(rootsSourceColorRgbHex(parsed.value)).toBe(rgb);}
  for(const value of [1,-0,Infinity,NaN])expect(()=>rootsSourceBackground(value)).toThrow(/原始数字文本/);
  for(const token of ['1.0x','01',' 1','+1','2','true'])expect(()=>rootsSourceBackground(1,{numberToken:token})).toThrow(/不一致/);
  expect(()=>rootsSourceBackground(-0,{numberToken:'0'})).toThrow(/不一致/);
  for(const value of [true,false,[],[1],{}, {color:1}]){const p=rootsSourceBackground(value);expect(p.value).toBe('#FFFFFF');expect(p.diagnostics).toHaveLength(1);}
 });
 it('shares source defaults and effective float clamps, retaining inactive local tone fields',()=>{
  const p=plan(undefined,{brightness:-100,gamma:.01,dynamicRange:100,rootSourceGamma:1e300,rootSourceBrightness:-1e300});
  expect(p).toMatchObject({brightness:-.5,contrast:1,gamma:10,dynamicRange:1,saturation:1,paletteOffset:0,backgroundRGB:[0,0,0]});
  expect(plan().gamma).toBe(Math.fround(2.2));expect(ROOTS_SOURCE_TONE_FIELDS.map(f=>f.key)).toContain('rootSourcePaletteOffset');
  expect(normalizeRootsSourceToneField('rootSourceGamma',Infinity)).toBe(10);expect(normalizeRootsSourceToneField('rootSourceGamma',-Infinity)).toBe(Math.fround(.1));
  for(const value of [NaN,'1',null])expect(()=>normalizeRootsSourceToneField('rootSourceGamma',value as never)).toThrow();
  expect(()=>normalizeRootsSourceToneField('rootSourcePaletteOffset',1e300)).toThrow();expect(()=>validateRootsSourceColorSettings({rootSourceGamma:Infinity})).toThrow();
  expect(()=>validateRootsSourceColorSettings({rootSourceGamma:'2.2'})).toThrow();expect(()=>validateRootsSourceColorSettings({rootSourceGamma:1e300})).not.toThrow();
 });
});
describe('metric-average presentation, exposure and safety',()=>{
 it('samples palette at the weighted mean instead of averaging per-point colors',()=>{
  const p=plan(['#ff0000','#00ff00','#ff0000']);expect(Array.from(p.lut.slice(127*4,129*4))).toEqual([1,254,0,255,1,254,0,255]);
  expect(sampleRootsMetricPalette(p.lut,.5)).toEqual([1/255,254/255,0]);
  for(const v of vectors.handGoldens.filter(v=>'metrics'in v)){
   const mass=v.weights!.reduce((a,b)=>a+b,0),sum=v.weights!.reduce((a,b,i)=>a+b*v.metrics![i],0);expect([mass,sum,0,0]).toEqual(v.ink);expect(sum/mass).toBe(v.mean);
  }
  expect(tone([2,1,0,0],p)).not.toEqual(tone([2,0,0,0],p));
 });
 it('uses submitted finite points and physical dimensions as the independent exposure denominator',()=>{
  expect(rootsDensityScale({submittedFinitePointCount:8000000,width:1000,height:1000})).toBe(2);
  expect(rootsDensityScale({submittedFinitePointCount:0,width:1000,height:1000})).toBe(1);
  expect(rootsDensityScale({submittedFinitePointCount:8000000,width:2000,height:1000})).toBe(1);
  expect(tone([2,1,0,0],undefined,8)).not.toEqual(tone([2,1,0,0],undefined,80));
  for(const n of [-1,.5,Infinity,Number.MAX_SAFE_INTEGER+1])expect(()=>rootsDensityScale({submittedFinitePointCount:n,width:1,height:1})).toThrow();
 });
 it('matches hand-solvable smoothLimit, gamma, grayscale and raw-empty background paths',()=>{
  expect(tone([1,.5,0,0])).toEqual([128,128,128,255]);
  expect(tone([1,0,0,0],plan(['#ffffff'],{rootSourceGamma:1,rootSourceBrightness:1}))).toEqual([191,191,191,255]);
  const p=plan(['#ffffff'],{background:'#123456',rootSourceGamma:8,rootSourceSaturation:0});
  expect(tone([0,0,0,0,1e-12,0,0,0],p)).toEqual([18,52,86,255,18,52,86,255]);
 });
 it('applies negative/periodic offset after averaging and keeps the texture seam clamped',()=>{
  const colors=['#ff0000','#0000ff'];expect(tone([1,.25,0,0],plan(colors,{rootSourcePaletteOffset:-.5}))).toEqual(tone([1,.25,0,0],plan(colors,{rootSourcePaletteOffset:1.5})));
  expect(tone([1,1,0,0],plan(colors))).toEqual(tone([1,0,0,0],plan(colors)));
  expect(sampleRootsMetricPalette(plan(colors).lut,0)).toEqual([1,0,0]);expect(sampleRootsMetricPalette(plan(colors).lut,1)).toEqual([0,0,1]);
 });
 it('uses one prepared-fact validator for CPU and GPU presentation admission',()=>{
  const p=plan();expect(()=>validateRootsMetricColorPlan(p)).not.toThrow();
  for(const change of [{gamma:NaN},{gamma:0},{dynamicRange:-1},{paletteOffset:Infinity},{backgroundRGB:[0,NaN,0]},{backgroundRGB:undefined},{lut:new Uint8Array(4)},{metric:'other'},{metric:undefined},{version:'local-rgb-v1'}]){
   const bad={...p,...change} as RootsMetricColorPlan;expect(()=>validateRootsMetricColorPlan(bad)).toThrow();expect(()=>tone([0,0,0,0],bad)).toThrow();
  }
 });
 it('owns LUT output and rejects malformed ink, dimensions, destination and cancellation',()=>{
  const colors=['#ff0000'],p=plan(colors),before=p.lut.slice();colors[0]='#00ff00';expect(p.lut).toEqual(before);
  for(const ink of [[NaN,0,0,0],[-1,0,0,0],[1,Infinity,0,0],[1,0,1,0],[1,-1,0,0],[1,1.01,0,0],[0,1,0,0]])expect(()=>tone(ink,p)).toThrow();
  expect(()=>toneRootsMetricRgbaPrepared(1,1,new Float64Array(3),p,{submittedFinitePointCount:1})).toThrow();
  expect(()=>toneRootsMetricRgbaPrepared(16384,16384,new Float64Array(4),p,{submittedFinitePointCount:1})).toThrow(/预算/);
  expect(()=>toneRootsMetricRgbaPrepared(1,1,new Float64Array(4),p,{submittedFinitePointCount:1},undefined,new Uint8ClampedArray(3))).toThrow();
  expect(()=>toneRootsMetricRgbaPrepared(1,1,new Float64Array(4),p,{submittedFinitePointCount:1},()=>true)).toThrow(/取消/);
  const destination=new Uint8ClampedArray(4);expect(toneRootsMetricRgbaPrepared(1,1,new Float32Array([1,.5,0,0]),p,{submittedFinitePointCount:1},undefined,destination)).toBe(destination);
 });
});
