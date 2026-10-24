import {describe,it,expect} from 'vitest';
import {sourceManualMainToneRgb} from '../src/engine/sourceConfigColor';
import {SOURCE_MANUAL_PALETTE_STRATEGIES,generateSourceManualPalette,generateSourceManualMainTones,sourceManualHsbToRgb,sourceManualRgbToHsb,sourceManualSrgbToLinear,sourceManualLinearToSrgb,sourceManualSrgbToOklab,sourceManualOklabToRgb,sourceManualHsbAnchorToOklab} from '../src/engine/sourceManualPaletteGeneration';
import originalPure from './fixtures/source-manual-palette/pure.json';
import originalRandom from './fixtures/source-manual-palette/random.json';
import originalPureEdges from './fixtures/source-manual-palette/pure-edges.json';
import originalRandomEdges from './fixtures/source-manual-palette/random-edges.json';

type FloatValue={text:string;bits:string};
type Triple=[number,number,number];
interface PureCase {id:string;kind:string;input:{text?:string;values?:FloatValue[];integers?:number[]};output:FloatValue|FloatValue[]|{rgb:number[]}|null;}
interface RandomCase {id:string;kind:string;input:{count:number;strategy?:number;mainToneCount?:number;mainTones?:string[]|null};randomReturns:FloatValue[];expectedRandomCalls:number;output:string[];}
const bits=(n:number)=>{const b=new DataView(new ArrayBuffer(4));b.setFloat32(0,n);return b.getUint32(0).toString(16).padStart(8,'0');};
const fromBits=(v:FloatValue)=>{const b=new DataView(new ArrayBuffer(4));b.setUint32(0,parseInt(v.bits,16));return b.getFloat32(0);};
const double=(v:FloatValue)=>{const b=new DataView(new ArrayBuffer(8));b.setBigUint64(0,BigInt('0x'+v.bits));return b.getFloat64(0);};

describe('original Manual random palette conversion boundaries',()=>{
 for(const c of [...originalPure.cases,...originalPureEdges.cases] as PureCase[])it(c.id,()=>{
  const values=(c.input.values?.map(fromBits)??c.input.integers??[]) as Triple;
  if(c.kind==='parse'){
   const rgb=(c.output as {rgb:number[]}|null)?.rgb;
   expect(sourceManualMainToneRgb(c.input.text!)).toBe(rgb?rgb[0]*65536+rgb[1]*256+rgb[2]:null);return;
  }
  if(c.kind==='linear'||c.kind==='srgb'){
   const actual=c.kind==='linear'?sourceManualSrgbToLinear(values[0]):sourceManualLinearToSrgb(values[0]);
   expect(bits(actual)).toBe((c.output as FloatValue).bits);return;
  }
  if(c.kind==='lab'||c.kind==='awtHsb'){
   const actual=c.kind==='lab'?sourceManualOklabToRgb(values):sourceManualHsbToRgb(values);
   expect(actual).toEqual((c.output as {rgb:number[]}).rgb);return;
  }
  const fn=c.kind==='rgb'?sourceManualSrgbToOklab:c.kind==='hsb'?sourceManualHsbAnchorToOklab:c.kind==='awtRgb'?sourceManualRgbToHsb:undefined;
  if(!fn)throw Error('Unrecognized original fixture kind: '+c.kind);
  expect(fn(values).map(bits)).toEqual((c.output as FloatValue[]).map(x=>x.bits));
 });
});
describe('original returned random palettes replayed with observed draws',()=>{
 for(const c of [...originalRandom.cases,...originalRandomEdges.cases] as RandomCase[])it(c.id,()=>{
  let index=0;const next=()=>{if(index>=c.randomReturns.length)throw Error('Unexpected extra random call');return double(c.randomReturns[index++]);};
  const result=c.kind==='mainTones'?generateSourceManualMainTones(c.input.count,next):generateSourceManualPalette({count:c.input.count,mainToneCount:c.input.mainToneCount!,strategy:SOURCE_MANUAL_PALETTE_STRATEGIES[c.input.strategy!],mainTones:c.input.mainTones??undefined},next);
  expect(result).toEqual({ok:true,value:c.output});expect(index).toBe(c.expectedRandomCalls);expect(index).toBe(c.randomReturns.length);
 });
 it('rejects invalid boundary requests and bad draws without mutating inputs',()=>{
  const request={count:8,strategy:'split-complementary' as const,mainToneCount:3,mainTones:['#123456','#ABCDEF','raw']},before=structuredClone(request);
  for(const value of [NaN,Infinity,-.1,1])expect(generateSourceManualPalette(request,()=>value)).toMatchObject({ok:false,error:{kind:'random'}});
  for(const count of [NaN,Infinity,.5,2147483648])expect(generateSourceManualPalette({...request,count})).toMatchObject({ok:false,error:{kind:'input'}});
  expect(generateSourceManualMainTones(NaN)).toMatchObject({ok:false,error:{kind:'input'}});
  expect(generateSourceManualMainTones(4,()=>1)).toMatchObject({ok:false,error:{kind:'random'}});
  expect(request).toEqual(before);
 });
});
