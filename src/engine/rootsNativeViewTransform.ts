// The retained native GL vertex probe observes column-order fused multiply/add
// and flush-to-zero inputs/results. ANGLE may reassociate a matrix multiply,
// changing clip W and raster coverage even with identical matrix uniforms.
const F=Math.fround,MIN_NORMAL=2**-126,MAX_FLOAT=(2-2**-23)*2**127,OVERFLOW_MID=2**128-2**103;
const scratch=new Float32Array(1),bits=new Uint32Array(scratch.buffer);
const flush=(value:number)=>Math.abs(value)<MIN_NORMAL?value*0:value;

/** Float32 operands, one exact fused rounding, then native flush-to-zero.
 * A float product is exact in double. TwoSum retains the addition residual;
 * it matters only when the double sum is exactly a Float32 rounding midpoint.
 * This avoids the rare double-rounding error of fround(a*b+c). */
export function rootsNativeFloatMultiplyAdd(a:number,b:number,c:number):number {
 a=flush(a);b=flush(b);c=flush(c);
 const product=a*b,sum=product+c;
 if(!Number.isFinite(sum))return F(sum);
 const z=sum-product,residual=(product-(sum-z))+(c-z);
 let rounded=F(sum);
 if(residual!==0){
  if(!Number.isFinite(rounded)){
   if(Math.abs(sum)===OVERFLOW_MID&&Math.sign(residual)!==Math.sign(sum))rounded=Math.sign(sum)*MAX_FLOAT;
  }else if(sum!==rounded){
   const direction=Math.sign(sum-rounded);
   if(rounded===0){bits[0]=direction>0?1:0x80000001;}
   else{scratch[0]=rounded;bits[0]+=direction*(rounded>0?1:-1);}
   const neighbor=scratch[0];
   if(Math.abs(sum-rounded)===Math.abs(neighbor-rounded)/2&&Math.sign(residual)===direction)rounded=neighbor;
  }
 }
 return flush(rounded);
}

/** Convert the owned staging prefix in place; the metric lane is unchanged.
 * Model-view matrices are prepared affine Float32 values. No growing vertex
 * history or second staging allocation is introduced. */
export function transformRootsNativeViewBatch(points:Float32Array,count:number,matrix:Float32Array,isCancelled?:()=>boolean):void {
 const m=matrix,ma=rootsNativeFloatMultiplyAdd;
 for(let i=0;i<count*4;i+=4){
  if((i&4095)===0&&isCancelled?.())throw new DOMException('复根视图变换已取消','AbortError');
  const x=flush(points[i]),y=flush(points[i+1]),z=flush(points[i+2]);
  for(let row=0;row<3;row++){
   const first=flush(F(flush(m[row])*x));
   const second=ma(m[4+row],y,first),third=ma(m[8+row],z,second);
   points[i+row]=flush(F(third+flush(m[12+row])));
  }
 }
}
