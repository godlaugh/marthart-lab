import type {SourceProcessingNoise} from './sourceProcessingNoise';
import {sourcePerlinFbm} from './sourcePerlinFbm';

const F=Math.fround,PI=F(Math.PI),TAU=F(2*Math.PI),ANGLE_FACTOR=F(.7);
const clamp=(v:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,v));
/** One million grid cells: 4 MiB retained plus at most 4 MiB diagnostic copy.
 * Each cell performs at most six outer FBM calls, each four Processing octaves. */
export const SOURCE_PERLIN_ANGLE_MAX_CELLS=1024*1024;
export class SourcePerlinAngleFieldError extends Error {
 constructor(readonly code:'input'|'capacity'|'nonfinite'|'cancelled',message:string){super(message);this.name=code==='cancelled'?'AbortError':'SourcePerlinAngleFieldError';}
}
const finite=(value:number)=>{
 if(typeof value!=='number'||!Number.isFinite(F(value)))throw new SourcePerlinAngleFieldError('nonfinite','Perlin angle field requires finite Float32 values.');
 return F(value);
};
export interface SourcePerlinAngleFieldOptions {
 readonly width:number;readonly height:number;readonly fieldCellSize:number;
 readonly textureSeed:number;readonly curveNoiseScale:number;readonly curveNoiseOctaves:number;
 readonly curveNoiseOffset:number;readonly curveAngleScale:number;
 /** Caller owns the ambient noise lifecycle. Building this field never reseeds. */
 readonly noise:Pick<SourceProcessingNoise,'sample'>;
 readonly isCancelled?:()=>boolean;
}
/** Source angleLerp preserves the unnormalized result and JVM signed remainder. */
export function sourcePerlinAngleLerp(a:number,b:number,t:number):number{
 a=finite(a);b=finite(b);t=finite(t);
 let d=F(F(F(F(b-a)+PI)%TAU)-PI);
 if(d< -PI)d=F(d+TAU);
 return finite(F(a+F(d*clamp(t,0,1))));
}

/** PerlinNoiseField buildAngleField/fbm/sampleFieldAngle. Grid and query use
 * different native divisors (max4 vs max1); do not normalize them together.
 * Array order is x-major, matching source float[x][y]. */
export class SourcePerlinAngleField {
 readonly width:number;readonly height:number;readonly nx:number;readonly ny:number;
 private readonly angles:Float32Array;
 private readonly cellSize:number;private readonly angleScale:number;
 private readonly isCancelled?:()=>boolean;
 constructor(options:SourcePerlinAngleFieldOptions){
  this.width=finite(options.width);this.height=finite(options.height);
  if(this.width<=0||this.height<=0)throw new SourcePerlinAngleFieldError('input','Perlin angle field dimensions must be positive.');
  for(const value of [options.fieldCellSize,options.textureSeed,options.curveNoiseOctaves])if(!Number.isInteger(value)||value< -2147483648||value>2147483647)throw new SourcePerlinAngleFieldError('input','Perlin angle field integer slots require Java int32.');
  this.cellSize=options.fieldCellSize;this.angleScale=finite(options.curveAngleScale);
  const scale=finite(options.curveNoiseScale),offset=finite(options.curveNoiseOffset);
  this.isCancelled=options.isCancelled;this.check();
  const divisor=F(Math.max(4,this.cellSize));
  // Check the source division before rounding/int addition can overflow and
  // before allocation. Requests beyond the local representation budget fail.
  const count=(extent:number)=>{const ratio=F(extent/divisor);if(ratio>SOURCE_PERLIN_ANGLE_MAX_CELLS)throw new SourcePerlinAngleFieldError('capacity','Perlin angle grid exceeds the local cell budget.');return Math.max(2,Math.floor(ratio+.5)+1);};
  this.nx=count(this.width);this.ny=count(this.height);
  if(this.nx>Math.floor(SOURCE_PERLIN_ANGLE_MAX_CELLS/this.ny))throw new SourcePerlinAngleFieldError('capacity','Perlin angle grid exceeds the local cell budget.');
  const angles=new Float32Array(this.nx*this.ny);
  const sx=F(F((options.textureSeed&65535)/F(65535))*10),sy=F(F(((options.textureSeed>>>16)&65535)/F(65535))*10);
  for(let x=0;x<this.nx;x++)for(let y=0;y<this.ny;y++){
   if((y&127)===0)this.check();
   const u=F(F(x)/F(this.nx-1)),v=F(F(y)/F(this.ny-1));
   const n=sourcePerlinFbm(options.noise,F(sx+F(u*scale)),F(sy+F(v*scale)),options.curveNoiseOctaves);
   angles[x*this.ny+y]=finite(F(F(F(F(offset+n)*PI)*ANGLE_FACTOR)*this.angleScale));
  }
  this.check();this.angles=angles;
 }
 private check(){if(this.isCancelled?.())throw new SourcePerlinAngleFieldError('cancelled','Perlin angle field generation cancelled.');}
 diagnostics(){return{nx:this.nx,ny:this.ny,retainedBytes:this.angles.byteLength};}
 /** Explicit diagnostic copy; callers cannot mutate the field. */
 copyAngles(){this.check();return this.angles.slice();}
 sample(x:number,y:number,noiseOffset:number,width=this.width,height=this.height):number{
  this.check();x=finite(x);y=finite(y);noiseOffset=finite(noiseOffset);width=finite(width);height=finite(height);
  const gx=F(clamp(x,0,Math.max(0,F(width-F(.001))))/F(Math.max(1,this.cellSize)));
  const gy=F(clamp(y,0,Math.max(0,F(height-F(.001))))/F(Math.max(1,this.cellSize)));
  const ix=clamp(Math.floor(gx),0,this.nx-2),iy=clamp(Math.floor(gy),0,this.ny-2);
  const tx=clamp(F(gx-F(ix)),0,1),ty=clamp(F(gy-F(iy)),0,1);
  const a=sourcePerlinAngleLerp(this.angles[ix*this.ny+iy],this.angles[(ix+1)*this.ny+iy],tx);
  const b=sourcePerlinAngleLerp(this.angles[ix*this.ny+iy+1],this.angles[(ix+1)*this.ny+iy+1],tx);
  return finite(F(sourcePerlinAngleLerp(a,b,ty)+F(F(F(noiseOffset*PI)*ANGLE_FACTOR)*this.angleScale)));
 }
}
