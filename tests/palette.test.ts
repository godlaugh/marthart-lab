import { describe, expect, it } from 'vitest';
import type { Palette, PaletteCurves, RGB } from '../src/types';
import { DEFAULT_COSINE, MAX_PALETTE_STOPS, bakePalette, curveValue, hexRGB, hsvRGB, insertPaletteStop, movePaletteStop, paletteBaseColor, paletteColor, palettePositions, paletteStopsColor, parsePalette, randomCosinePalette, randomizePalette, randomPalette, randomPrimaryColors, removePaletteStop, reversePalette, rgbHex, rgbHSV, serializePalette, validatePalette } from '../src/engine/palette';
const base:Palette={name:'test',stops:['#ff0000','#00ff00','#0000ff'],positions:[0,.2,1],mode:'linear',offset:0,cycles:1};
const near=(a:RGB,b:RGB)=>a.forEach((v,i)=>expect(v).toBeCloseTo(b[i],10));
const curves:PaletteCurves={red:[{x:.1,y:.2},{x:.3,y:.9},{x:.6,y:.4},{x:.9,y:.8}],green:[{x:0,y:0},{x:1,y:1}],blue:[{x:0,y:1},{x:.5,y:.1},{x:1,y:.7}]};

describe('manual palette editing and interpolation',()=>{
 it('honors irregular positions and preserves closed-domain endpoints',()=>{near(paletteStopsColor(base.stops,.1,base.positions),[.5,.5,0]);near(paletteBaseColor(base,.6),[0,.5,.5]);near(paletteBaseColor(base,1),[0,0,1]);near(paletteColor(base,1),[1,0,0]);});
 it('HSV blends the shortest hue path and handles gray endpoints',()=>{
  near(paletteBaseColor({...base,stops:['#ff0000','#00ff00'],positions:undefined,interpolation:'hsv'},.5),[1,1,0]);
  near(paletteBaseColor({...base,stops:['#ffffff','#0000ff'],positions:undefined,interpolation:'hsv'},.5),[.5,.5,1]);
  const p={...base,positions:undefined,stops:[rgbHex(hsvRGB(.98,1,1)),rgbHex(hsvRGB(.02,1,1))],interpolation:'hsv' as const};
  const middle=paletteBaseColor(p,.5);expect(middle[0]).toBeCloseTo(1);expect(middle[1]).toBeLessThan(.01);expect(middle[2]).toBeLessThan(.01);
 });
 it('inserts into the largest gap with the existing sampled color, without mutating its input',()=>{const snapshot=structuredClone(base),p=insertPaletteStop(base);expect(p.positions).toEqual([0,.2,.6,1]);hexRGB(p.stops[2]).forEach((v,i)=>expect(Math.abs(v-[0,.5,.5][i])).toBeLessThanOrEqual(1/255));expect(base).toEqual(snapshot);});
 it('clamps moving nodes to neighbors and preserves endpoint anchors',()=>{const p=movePaletteStop(base,1,5);expect(p.positions).toEqual([0,.999999,1]);expect(movePaletteStop(base,0,.7).positions).toEqual(base.positions);expect(()=>movePaletteStop(base,9,.1)).toThrow();});
 it('removes endpoints by reanchoring the remaining range, and refuses fewer than two stops',()=>{const p=removePaletteStop(base,0);expect(p.positions).toEqual([0,1]);expect(p.stops).toEqual(['#00ff00','#0000ff']);expect(()=>removePaletteStop(p,0)).toThrow();});
 it('reverses colors and irregular positions together',()=>{const p=reversePalette(base);expect(p.positions).toEqual([0,.8,1]);for(const t of [0,.1,.4,.7,1])near(paletteBaseColor(p,t),paletteBaseColor(base,1-t));expect(reversePalette(p).stops).toEqual(base.stops);});
 it('applies repeat, negative coordinates and offset once',()=>{near(paletteColor({...base,cycles:2,offset:.1},.25),paletteBaseColor(base,.6));near(paletteColor(base,-.8),paletteBaseColor(base,.2));expect(()=>paletteColor(base,Infinity)).toThrow();});
 it('bounds editable nodes while preserving derived palettes with up to 1024 stops',()=>{const many={...base,positions:undefined,stops:Array.from({length:25},()=> '#112233')};expect(()=>insertPaletteStop(many)).toThrow('25');const full={...many,stops:Array.from({length:MAX_PALETTE_STOPS},()=> '#123456')};expect(validatePalette(full).stops).toHaveLength(MAX_PALETTE_STOPS);expect(()=>validatePalette({...full,stops:[...full.stops,'#abcdef']})).toThrow();});
});

describe('independent cosine and shape-preserving RGB curves',()=>{
 it('evaluates all twelve IQ coefficients independently and clamps output',()=>{const p:Palette={...base,mode:'cosine',cosine:{a:[.2,.3,.4],b:[.1,.2,2],c:[1,2,3],d:[0,.25,.5]}};near(paletteBaseColor(p,0),[.3,.3,0]);near(paletteBaseColor(p,.25),[.2,.3,.4]);});
 it('retains previous cosine appearance when coefficients are omitted',()=>{const p={...base,mode:'cosine' as const};for(const t of [0,.2,.7])near(paletteBaseColor(p,t),[0,2,4].map(x=>.5+.5*Math.cos(Math.PI*2*t+x)) as RGB);expect(DEFAULT_COSINE.c).toEqual([1,1,1]);});
 it('reverses cosine mathematically instead of baking it',()=>{const p={...base,mode:'cosine' as const,cosine:randomCosinePalette(777)};for(const t of [0,.2,.35,.9,1])near(paletteBaseColor(reversePalette(p),t),paletteBaseColor(p,1-t));});
 it('supports imported curves whose endpoints are inside 0..1 and passes every node',()=>{for(const node of curves.red)expect(curveValue(curves.red,node.x)).toBeCloseTo(node.y);expect(curveValue(curves.red,0)).toBe(.2);expect(curveValue(curves.red,1)).toBe(.8);});
 it('reproduces linear channels and does not overshoot local extrema',()=>{expect(curveValue(curves.green,.42)).toBeCloseTo(.42);for(let i=0;i<curves.red.length-1;i++){const a=curves.red[i],b=curves.red[i+1];for(let j=0;j<=100;j++){const v=curveValue(curves.red,a.x+(b.x-a.x)*j/100);expect(v).toBeGreaterThanOrEqual(Math.min(a.y,b.y)-1e-12);expect(v).toBeLessThanOrEqual(Math.max(a.y,b.y)+1e-12);}}});
 it('uses independent channels and reverses the entire curve including non-boundary endpoints',()=>{const p:Palette={...base,mode:'curve',curves};near(paletteBaseColor(p,.3),[.9,.3,curveValue(curves.blue,.3)]);for(const t of [0,.1,.3,.75,1])near(paletteBaseColor(reversePalette(p),t),paletteBaseColor(p,1-t));});
 it('bakes coefficients and curves into editable stops with exact quantized samples',()=>{const p:Palette={...base,mode:'curve',curves,offset:.2,cycles:3},baked=bakePalette(p,25);expect(baked.mode).toBe('linear');expect(baked.offset).toBe(.2);expect(baked.cycles).toBe(3);baked.stops.forEach((color,i)=>expect(color).toBe(rgbHex(paletteBaseColor(p,i/24))));});
 it('renders finite values for large finite cosine phase and frequency',()=>{const p={...base,mode:'cosine' as const,cosine:{a:[.5,.5,.5] as RGB,b:[.5,.5,.5] as RGB,c:[1e308,1,1] as RGB,d:[1e308,0,0] as RGB}};expect(paletteBaseColor(p,.8).every(Number.isFinite)).toBe(true);});
});

describe('random palette color relationships and deterministic persistence',()=>{
 it('randomizes editable modes in place and persists independently editable RGB curves',()=>{
  const options={strategy:'complementary' as const,count:6,seed:321},source={...base,mode:'curve' as const,offset:.37,cycles:3,curves,cosine:randomCosinePalette(12)},before=structuredClone(source),out=randomizePalette(source,options);
  expect(source).toEqual(before);expect(out).toEqual(randomizePalette(source,options));expect(out.curves).not.toEqual(randomizePalette(source,{...options,seed:322}).curves);
  expect(out).toMatchObject({name:source.name,mode:'curve',offset:.37,cycles:3,cosine:source.cosine,stops:source.stops,positions:source.positions});
  const restored=parsePalette(serializePalette(out));expect(restored).toEqual(out);for(const channel of Object.values(restored.curves!)){expect(channel).toHaveLength(6);expect(channel[0].x).toBe(0);expect(channel.at(-1)!.x).toBe(1);}
  for(let i=0;i<=1000;i++)for(const v of paletteBaseColor(restored,i/1000)){expect(v).toBeGreaterThanOrEqual(0);expect(v).toBeLessThanOrEqual(1);}
  const old=paletteBaseColor(restored,.5);restored.curves!.red[3].y=.123;const edited=paletteBaseColor(restored,.6);expect(edited[0]).toBeCloseTo(.123);expect(out.curves!.red[3].y).not.toBe(.123);expect(old.every(Number.isFinite)).toBe(true);
  expect(randomizePalette({...source,mode:'cosine'},options)).toMatchObject({mode:'cosine',offset:.37,cycles:3,curves,cosine:randomCosinePalette(321)});
  expect(randomizePalette({...source,mode:'sine'},options).mode).toBe('sine');expect(randomizePalette({...source,mode:'hsv'},options).mode).toBe('linear');
 });
 it('uses deterministic seeds for all four strategies',()=>{for(const strategy of ['monochromatic','analogous','complementary','split-complementary'] as const){const options={strategy,count:12,seed:123};expect(randomPalette(options)).toEqual(randomPalette(options));expect(randomPalette({...options,seed:456}).stops).not.toEqual(randomPalette(options).stops);expect(randomPalette(options).stops).toHaveLength(12);}});
 it('monochromatic generation keeps hue while changing brightness and saturation',()=>{const h=randomPalette({strategy:'monochromatic',count:16,seed:123}).stops.map(s=>rgbHSV(hexRGB(s)));expect(Math.max(...h.map(v=>v[0]))-Math.min(...h.map(v=>v[0]))).toBeLessThan(.01);expect(new Set(h.map(v=>v[2])).size).toBeGreaterThan(5);});
 it('complementary generation alternates opposing hues',()=>{const h=randomPalette({strategy:'complementary',count:10,seed:123}).stops.map(s=>rgbHSV(hexRGB(s))[0]);for(let i=1;i<h.length;i++)expect(Math.abs(h[i]-h[i-1])).toBeCloseTo(.5,1);});
 it('split complementary respects all three to six editable primary colors',()=>{const primary=['#ff0000','#00ff00','#0000ff','#ffff00','#00ffff','#ff00ff'];const colors=randomPalette({strategy:'split-complementary',count:12,seed:3,primaryColors:primary}).stops;colors.forEach((c,i)=>expect(rgbHSV(hexRGB(c))[0]).toBeCloseTo(rgbHSV(hexRGB(primary[i%6]))[0],2));expect(randomPrimaryColors(3,6)).toHaveLength(6);});
 it('rejects fractional counts, invalid primary colors and noninteger seeds',()=>{expect(()=>randomPalette({strategy:'analogous',count:2.3,seed:1})).toThrow();expect(()=>randomPalette({strategy:'analogous',count:17,seed:1})).toThrow();expect(()=>randomPrimaryColors(NaN)).toThrow();expect(()=>randomPalette({strategy:'split-complementary',count:5,seed:1,primaryColors:['red']})).toThrow();});
 it('round trips every mode with independent nested data and accepts simple color arrays',()=>{for(const mode of ['linear','sine','hsv','cosine','curve'] as const){const p={...base,mode,cosine:randomCosinePalette(2),curves,interpolation:'hsv' as const};const parsed=parsePalette(serializePalette(p));expect(parsed).toEqual(p);parsed.curves!.red[0].y=.5;expect(p.curves.red[0].y).toBe(.2);}expect(parsePalette('["#000000","#ffffff"]').stops).toEqual(['#000000','#ffffff']);});
 it('rejects malformed imported modes, curves, stop positions and resource expansion',()=>{for(const override of [{mode:'unknown'},{stops:['#bad','#000000']},{offset:Infinity},{positions:[0,.5,.4]},{cosine:{a:[1,2,3]}},{curves:{...curves,red:[{x:.5,y:0},{x:.5,y:1}]}},{curves:{...curves,red:[{x:0,y:0},{x:1e-320,y:1}]}}])expect(()=>validatePalette({...base,...override})).toThrow();expect(()=>parsePalette(' '.repeat(256*1024+1))).toThrow('256');expect(()=>parsePalette('{"type":"mathart-palette","version":2}')).toThrow('版本');});
});
