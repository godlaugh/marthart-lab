import {describe,it,expect} from 'vitest';
import {prepareDensityTone,toneDensityRgbaPrepared} from '../src/engine/density';
import {sampleCapturedDensity,type PreparedCapturedDensityView} from '../src/engine/sourceDensityCamera';
import {validateDensityView} from '../src/engine/densityPresentation';
const palette={name:'white',stops:['#ffffff','#ffffff'],mode:'linear' as const,offset:0,cycles:1};
const width=5,height=3,rotation=Math.fround(.43);
const view=(family:'map'|'symmetry'):PreparedCapturedDensityView=>({family,width,height,rotation,cos:Math.fround(Math.cos(-rotation)),sin:Math.fround(Math.sin(-rotation)),aspect:Math.fround(width/height),filter:family==='map'?'nearest':'linear'});
const ink=Float32Array.from({length:width*height*4},(_,i)=>{const p=Math.floor(i/4),m=p%3===0?0:p*p+.1;return i%4===3?m:m*(i%4===0?p/15:i%4===1?.2:.8);});
const job=prepareDensityTone(palette,{paletteMode:'source',toneMap:'log',dynamicRange:100,gamma:2,transparentBackground:true});
describe('density presentation ownership',()=>{
 for(const family of ['map','symmetry'] as const)it(`${family} samples floating sums and mass before nonlinear tone`,()=>{
  const v=view(family),sampled=new Float64Array(ink.length);
  for(let i=0;i<width*height;i++)for(const tap of sampleCapturedDensity(v,i%width,Math.floor(i/width)))for(let k=0;k<4;k++)sampled[i*4+k]+=ink[tap.index*4+k]*tap.weight;
  const actual=toneDensityRgbaPrepared(width,height,ink,job,undefined,undefined,v),expected=toneDensityRgbaPrepared(width,height,sampled,job);
  expect(actual).toEqual(expected);expect(actual.some(x=>x>0)).toBe(true);
  if(family==='symmetry'){
   const toned=toneDensityRgbaPrepared(width,height,ink,job),wrong=new Uint8ClampedArray(ink.length);
   for(let i=0;i<width*height;i++)for(let k=0;k<4;k++)wrong[i*4+k]=sampleCapturedDensity(v,i%width,Math.floor(i/width)).reduce((n,t)=>n+toned[t.index*4+k]*t.weight,0);
   expect(actual).not.toEqual(wrong);
  }
 });
 it('rejects mismatched owner filtering and dimensions',()=>{expect(()=>validateDensityView({...view('map'),filter:'linear'},width,height)).toThrow();expect(()=>validateDensityView(view('symmetry'),height,width)).toThrow();});
 it('validates the entire source even where a rotated view excludes its bad texel',()=>{const bad=ink.slice();bad[0]=NaN;expect(()=>toneDensityRgbaPrepared(width,height,bad,job,undefined,undefined,view('map'))).toThrow('非有限');});
 it('keeps cancellation and caller-owned destination semantics',()=>{const destination=new Uint8ClampedArray(ink.length);expect(toneDensityRgbaPrepared(width,height,ink,job,undefined,destination,view('symmetry'))).toBe(destination);expect(()=>toneDensityRgbaPrepared(width,height,ink,job,()=>true,undefined,view('map'))).toThrow('取消');});
});
