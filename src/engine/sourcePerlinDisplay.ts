import {sourceProcessingCameraMatrix,sourceProcessingOrthographic,translateSourceProcessingMatrix,packSourceProcessingMatrix,type SourceProcessingMatrix} from './sourceProcessingMatrix';
const F=Math.fround;
export class SourcePerlinDisplayError extends Error{
 constructor(readonly code:'input'|'nonfinite',message:string){super(message);this.name='SourcePerlinDisplayError';}
}
export interface SourcePerlinParticleDisplayInput{
 readonly width:number;readonly height:number;
 /** Actual PApplet logical dimensions, not the simulation's joint 800 fallback. */
 readonly sourceWidth:number;readonly sourceHeight:number;
 readonly target:'primary'|'offscreen';readonly sourcePixelDensity:number;
 readonly lineWeight:number;readonly dotSize:number;
}
export interface SourcePerlinParticleDisplay{
 readonly modelView:SourceProcessingMatrix;readonly projection:SourceProcessingMatrix;
 readonly viewport:readonly[number,number,number,number];
 readonly lineScale:number;readonly lineWidth:number;readonly pointWidth:number;
 readonly lineShaderScale:readonly[number,number,number];
}
const finite=(v:number)=>{if(typeof v!=='number'||!Number.isFinite(F(v)))throw new SourcePerlinDisplayError('nonfinite','Perlin display requires finite Float32 values.');return F(v);};
/** Perlin.display resets the Scene camera and applies its own camera/ortho,
 * center translation and independent x/y scaling. No Euler/visual transform. */
export function prepareSourcePerlinParticleDisplay(input:SourcePerlinParticleDisplayInput):SourcePerlinParticleDisplay{
 for(const key of ['width','height','sourceWidth','sourceHeight','sourcePixelDensity'] as const){
  const n=input[key];if(!Number.isInteger(n)||n< -2147483648||n>2147483647)throw new SourcePerlinDisplayError('input','Perlin display dimensions/density require Java int32.');
 }
 if(input.width<=0||input.height<=0||!['primary','offscreen'].includes(input.target))throw new SourcePerlinDisplayError('input','Perlin target needs positive dimensions and an explicit target kind.');
 const w=F(input.width),h=F(input.height),sw=F(input.sourceWidth),sh=F(input.sourceHeight);
 const defaultZ=F(F(h/2)/F(Math.tan(F(F(Math.PI/3)/2))));
 const modelView=sourceProcessingCameraMatrix(w,h,defaultZ);
 translateSourceProcessingMatrix(modelView,F(w*.5),F(h*.5),0);
 const sx=input.sourceWidth>0?F(w/sw):1,sy=input.sourceHeight>0?F(h/sh):1;
 // PMatrix3D.scale multiplies every entry in columns0..2, including row3.
 for(let row=0;row<4;row++){modelView[row*4]=F(modelView[row*4]*sx);modelView[row*4+1]=F(modelView[row*4+1]*sy);modelView[row*4+2]=F(modelView[row*4+2]*1);}
 let lineScale=1;
 if(input.target==='offscreen'){
  const arg=F(h/sh),densityScale=F(Math.pow(Math.max(1,input.sourcePixelDensity),F(.15)));
  lineScale=F(F(F(Math.sqrt(F(arg/densityScale)))*F(1.4))*F(.4));
 }
 const lineWidth=Math.max(F(.02),F(finite(input.lineWeight)*lineScale)),pointWidth=F(finite(input.dotSize)*lineScale);
 for(const n of [...modelView,lineScale,lineWidth,pointWidth])finite(n);
 return Object.freeze({modelView:packSourceProcessingMatrix(modelView),projection:packSourceProcessingMatrix(sourceProcessingOrthographic(w,h).values),viewport:Object.freeze([0,0,input.width,input.height]) as readonly[number,number,number,number],lineScale,lineWidth,pointWidth,lineShaderScale:Object.freeze([1,1,F(.999)]) as readonly[number,number,number]});
}
