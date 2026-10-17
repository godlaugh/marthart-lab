import {describe,it,expect} from 'vitest';
import type {Palette} from '../src/types';
import {prepareDensityTone,toneDensityRgbaPrepared,type DensityToneJob} from '../src/engine/density';
import {prepareSamilaView,samilaSourceIndex,type PreparedSamilaView} from '../src/engine/samilaCamera';
import {initializeSamilaTone} from '../src/engine/samilaTone';
const palette:Palette={name:'Asymmetric view',mode:'linear',stops:['#ff0011','#04ff00','#0009ff'],cycles:1,offset:0};
const view=(w:number,h:number,theta:number)=>prepareSamilaView({model:'anchored-theta-v1',time:.25,theta},0,w,h);
function ink(w:number,h:number){const a=new Float32Array(w*h*4);for(let i=0;i<w*h;i++){const mass=i%11?1+i/13:0;a.set([mass*(i%5)/4,mass*(i%7)/6,mass*(i%3)/2,mass],i*4);}return a;}
function gather(a:Float32Array,v:PreparedSamilaView){const out=new Float32Array(a.length);for(let y=0;y<v.height;y++)for(let x=0;x<v.width;x++){const source=samilaSourceIndex(v,x,y);if(source>=0)out.set(a.subarray(source*4,source*4+4),(y*v.width+x)*4);}return out;}
function jobs(w:number,h:number,transparentBackground:boolean):DensityToneJob[]{
 const common={background:'#123456',transparentBackground};
 const facts={kind:'samila' as const,historyModel:'bounded-v2' as const,width:w,height:h,completedPasses:4,baseBatchSize:32,alpha:.1,combinedDecay:.9,splat:{model:'local-feathered-disc-v1' as const,radiusPixels:1}};
 const mapFacts={kind:'map' as const,width:w,height:h,recordedPasses:4,batchSize:32};
 const v1=prepareDensityTone(palette,{...common,paletteMode:'source',toneMap:'linear',dynamicRange:4,gamma:1});
 // The view is a presentation fact, independent of the chosen tone branch.
 return[v1,prepareDensityTone(palette,{...common,densityToneModel:'normalized-v2',densityReferenceWidth:w,densityReferenceHeight:h},mapFacts),...(['palette-average','yuv-average'] as const).map(samilaToneBranch=>prepareDensityTone(palette,{...initializeSamilaTone({iteratedMode:'continuous'}),...common,samilaToneBranch},facts))];
}
describe('shared raw-ink Samila presentation',()=>{
 it('has an explicit top-down quarter-turn index golden',()=>{const v=view(3,3,Math.PI/2);expect(Array.from({length:9},(_,i)=>samilaSourceIndex(v,i%3,Math.floor(i/3)))).toEqual([2,5,8,1,4,7,0,3,6]);});
 it('samples raw RGB sums and mass before all tone branches with aspect and outside-background behavior',()=>{
  for(const [w,h]of [[7,5],[5,9],[19,3]])for(const theta of [0,Math.PI/2,-Math.PI/2,Math.PI,.37,Math.PI*2+.37])for(const transparent of [false,true]){
   const a=ink(w,h),original=a.slice(),v=view(w,h,theta);
   for(const job of jobs(w,h,transparent)){const expected=toneDensityRgbaPrepared(w,h,gather(a,v),job),destination=new Uint8ClampedArray(a.length).fill(255),actual=toneDensityRgbaPrepared(w,h,a,job,undefined,destination,v);expect(actual).toBe(destination);expect(actual).toEqual(expected);}
   expect(a).toEqual(original);
  }
 });
 it('rejects malformed source even when rotation hides the texel or its mass is zero',()=>{
  const w=7,h=5,v=view(w,h,.63),visible=new Set(Array.from({length:w*h},(_,i)=>samilaSourceIndex(v,i%w,Math.floor(i/w)))),hidden=Array.from({length:w*h},(_,i)=>i).find(i=>!visible.has(i));expect(hidden).toBeDefined();
  for(const job of jobs(w,h,true))for(const patch of [[NaN,0,0,0],[0,0,0,-1],[0,0,0,Infinity]]){const a=ink(w,h);a.set(patch,hidden!*4);expect(()=>toneDensityRgbaPrepared(w,h,a,job,undefined,undefined,v)).toThrow(/有限/);}
 });
 it('keeps omitted view unchanged, validates view dimensions, and cancels source validation',()=>{
  const a=ink(7,5),job=jobs(7,5,false)[0];expect(toneDensityRgbaPrepared(7,5,a,job,undefined,undefined,view(7,5,0))).toEqual(toneDensityRgbaPrepared(7,5,a,job));
  expect(()=>toneDensityRgbaPrepared(7,5,a,job,undefined,undefined,view(5,7,0))).toThrow('显示事实');
  expect(()=>toneDensityRgbaPrepared(7,5,a,job,()=>true,undefined,view(7,5,.2))).toThrow('取消');
 });
});
