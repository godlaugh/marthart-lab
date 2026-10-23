/** Processing's immediate CPU geometry/color boundary. Callers validate their
 * own buffer capacities and source settings before invoking these scalar writes.
 * Retain F32 operation order; GPU matrix multiplication is not equivalent. */
export function writeSourceEyePosition(m:readonly number[],x:number,y:number,z:number,out:Float32Array,offset:number):void {
 const F=Math.fround;
 for(let row=0;row<4;row++){
  const k=row*4;
  out[offset+row]=F(F(F(F(m[k]*x)+F(m[k+1]*y))+F(m[k+2]*z))+m[k+3]);
 }
}

/** Processing immediate tessellation bakes modelview on the CPU, then flushes
 * with identity modelview. Preserve its staged Float32 operations and nonfinite
 * source slots. Callers admit their family's capacity before allocating vec4s. */
export function sourceEyePositions(positions:Float32Array,rowMajor:readonly number[]):Float32Array {
 const eye=new Float32Array(positions.length/3*4);
 for(let i=0;i<positions.length;i+=3)writeSourceEyePosition(rowMajor,positions[i],positions[i+1],positions[i+2],eye,i/3*4);
 return eye;
}

/** PGraphics.colorCalc(int), shared by fill(int) and stroke(int). Zero-alpha
 * integers <=255 are opaque grayscale; all other values are packed ARGB.
 * Fill replaces the alpha byte before this boundary; stroke retains it. */
export function writeSourcePackedColor(packed:number,out:Float32Array,offset:number,displayOpacity=1):void {
 const rgb=packed&0xffffff,alpha=packed>>>24,gray=alpha===0&&rgb<=255;
 out[offset]=(gray?rgb:(rgb>>>16)&255)/255;
 out[offset+1]=(gray?rgb:(rgb>>>8)&255)/255;
 out[offset+2]=(rgb&255)/255;
 out[offset+3]=Math.fround((gray?255:alpha)/255)*displayOpacity;
}
