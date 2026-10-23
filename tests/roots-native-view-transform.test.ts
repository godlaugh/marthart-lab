import {describe,it,expect} from 'vitest';
import {rootsNativeFloatMultiplyAdd,transformRootsNativeViewBatch} from '../src/engine/rootsNativeViewTransform';
const floats=new Float32Array(1),uints=new Uint32Array(floats.buffer);
const fromBits=(bits:number)=>{uints[0]=bits;return floats[0];};
const toBits=(value:number)=>{floats[0]=value;return uints[0];};
// Independent exact integer arithmetic in units of 2^-298. This oracle does
// not use floating multiply/add or the production rounding implementation.
function exact(a:number,b:number,c:number):number {
 const integer=(bits:number)=>{
  const exponent=(bits>>>23)&255;if(exponent===0)return 0n;
  const magnitude=BigInt((bits&0x7fffff)|0x800000)<<BigInt(exponent-1);
  return bits>>>31?-magnitude:magnitude;
 };
 let value=integer(a)*integer(b)+(integer(c)<<149n);
 if(value===0n)return 0;
 const sign=value<0n?0x80000000:0;if(value<0n)value=-value;
 const length=value.toString(2).length,shift=Math.max(149,length-24),unit=1n<<BigInt(shift);
 let significand=value>>BigInt(shift);const remainder=value&(unit-1n),half=unit>>1n;
 if(remainder>half||remainder===half&&(significand&1n)!==0n)significand++;
 if(significand<0x800000n)return sign; // Native output FTZ.
 let exponent=shift-298+23;
 if(significand===0x1000000n){significand>>=1n;exponent++;}
 if(exponent>127)return (sign|0x7f800000)>>>0;
 return (sign|((exponent+127)<<23)|Number(significand-0x800000n))>>>0;
}
describe('native Roots view-transform float boundary',()=>{
 it('retains the small residual at double-rounding ties in both directions',()=>{
  const a=1+2**-12;
  for(const sign of [1,-1])for(const residual of [2**-100,-(2**-100)]){
   const actual=rootsNativeFloatMultiplyAdd(sign*a,a,residual);
   expect(toBits(actual)).toBe(exact(toBits(sign*a),toBits(a),toBits(residual)));
  }
  expect(rootsNativeFloatMultiplyAdd(a,a,2**-100)).not.toBe(Math.fround(a*a+2**-100));
 });
 it('matches exact integer rounding over finite Float32 inputs and overflow',()=>{
  let state=0x9134ba2f;
  const next=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;const bits=state>>>0;return ((bits>>>23)&255)===255?bits^0x00800000:bits;};
  for(let i=0;i<12000;i++){
   const a=next(),b=next(),c=next(),result=rootsNativeFloatMultiplyAdd(fromBits(a),fromBits(b),fromBits(c)),expected=exact(a,b,c);
   // Exact zero's sign is a separate IEEE semantic, not represented by bigint.
   if((expected&0x7fffffff)===0)expect(result===0).toBe(true);
   else expect(toBits(result)).toBe(expected);
  }
 });
 it('flushes subnormal inputs before multiplication and preserves signed zero',()=>{
  expect(Object.is(rootsNativeFloatMultiplyAdd(-(2**-140),2**100,-0),-0)).toBe(true);
  expect(rootsNativeFloatMultiplyAdd(2**-140,2**100,1)).toBe(1);
  expect(rootsNativeFloatMultiplyAdd(2**-126,.5,0)).toBe(0);
 });
 it('owns only the requested staging prefix, preserves metric, and checks cancellation',()=>{
  const m=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,2,3,-240,1]);
  const points=new Float32Array([1,2,3,.25,4,5,6,.5]);
  transformRootsNativeViewBatch(points,1,m);
  expect(Array.from(points)).toEqual([3,5,-237,.25,4,5,6,.5]);
  expect(()=>transformRootsNativeViewBatch(points,1,m,()=>true)).toThrow('已取消');
 });
});
