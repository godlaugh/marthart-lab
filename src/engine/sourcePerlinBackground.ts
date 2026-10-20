import {writeSourcePackedColor} from './sourceProcessingGeometry';
const F=Math.fround;
export class SourcePerlinBackgroundError extends Error{
 constructor(readonly code:'input',message:string){super(message);this.name='SourcePerlinBackgroundError';}
}
/** Scene.render's RGB255 background(int) / fill(int,fadeAlpha). P3D sets
 * format=ARGB even for primary targets (PGraphicsOpenGL.setPrimary PC13–15).
 * backgroundImpl clears with calcRGBA floats; the fading rect instead carries
 * packed fillColor through tessellation, including byte truncation. */
export function sourcePerlinBackgroundRgba(packed:number,accumulation:boolean,fadeAlpha:number):readonly[number,number,number,number]{
 if(!Number.isInteger(packed)||packed<0||packed>0xffffffff||typeof accumulation!=='boolean'||typeof fadeAlpha!=='number'||!Number.isFinite(F(fadeAlpha)))throw new SourcePerlinBackgroundError('input','Invalid source Perlin background color or fade alpha.');
 const color=new Float32Array(4);writeSourcePackedColor(packed,color,0);
 if(accumulation){
  const alpha=F(Math.max(0,Math.min(255,F(fadeAlpha)))),gray=(packed>>>24)===0&&(packed&0xffffff)<=255;
  const alphaByte=gray?Math.trunc(F(255*F(alpha/255))):alpha===255?packed>>>24:Math.trunc(F((packed>>>24)*F(alpha/255)));
  if(gray)for(let i=0;i<3;i++)color[i]=F(Math.trunc(F(color[i]*255))/255);
  color[3]=F(alphaByte/255);
 }
 return Object.freeze([color[0],color[1],color[2],color[3]]);
}
