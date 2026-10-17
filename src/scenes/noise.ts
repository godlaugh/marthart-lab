import {finite,random} from '../engine/expression';
// Seeded gradient noise with quintic interpolation, written from the lattice definition.
export function createNoisePermutation(seedValue:number):Uint8Array {
  finite(seedValue,'噪声种子');const r=random(seedValue),perm=Array.from({length:256},(_,i)=>i);
  for(let i=255;i>0;i--){const j=Math.floor(r()*(i+1));[perm[i],perm[j]]=[perm[j],perm[i]];}
  return Uint8Array.from(perm);
}
export function createNoise(seedValue:number):(x:number,y:number,z?:number)=>number {
  const perm=createNoisePermutation(seedValue),p=Array.from({length:512},(_,i)=>perm[i&255]);
  const fade=(t:number)=>t*t*t*(t*(t*6-15)+10),mix=(a:number,b:number,t:number)=>a+(b-a)*t;
  const grad=(hash:number,x:number,y:number,z:number)=>{const h=hash&15,u=h<8?x:y,v=h<4?y:h===12||h===14?x:z;return((h&1)?-u:u)+((h&2)?-v:v);};
  return(x,y,z=0)=>{
    if(![x,y,z].every(Number.isFinite))throw new Error('噪声坐标必须有限');
    const fx=Math.floor(x),fy=Math.floor(y),fz=Math.floor(z),X=fx&255,Y=fy&255,Z=fz&255;x-=fx;y-=fy;z-=fz;
    const u=fade(x),v=fade(y),w=fade(z),A=p[X]+Y,AA=p[A]+Z,AB=p[A+1]+Z,B=p[X+1]+Y,BA=p[B]+Z,BB=p[B+1]+Z;
    return mix(mix(mix(grad(p[AA],x,y,z),grad(p[BA],x-1,y,z),u),mix(grad(p[AB],x,y-1,z),grad(p[BB],x-1,y-1,z),u),v),mix(mix(grad(p[AA+1],x,y,z-1),grad(p[BA+1],x-1,y,z-1),u),mix(grad(p[AB+1],x,y-1,z-1),grad(p[BB+1],x-1,y-1,z-1),u),v),w);
  };
}
