import {prepareDomainSourceSegment,sampleDomainSourceSegment,type DomainSourceInterpolation} from './domainSourcePalette';
import {sourceConfigPackedColor,SourceConfigColorError} from './sourceConfigColor';
export interface SourcePaletteRuntimeConfiguration {
 colors:string[];offset:number;gamma:number;space:'rgb'|'hsv';useCosine:boolean;
 cosine:{a:[number,number,number];b:[number,number,number];c:[number,number,number];d:[number,number,number]};
}
export interface SourcePaletteRuntimeState {interpolation:DomainSourceInterpolation;cyclic:boolean}
const F=Math.fround,clamp=(x:number,lo=0,hi=1)=>Math.max(lo,Math.min(hi,x));
const fail=(field:string,reason:string):never=>{throw new Error(`${field}: ${reason}`);};
function f32(value:number,field:string){const v=F(value);if(!Number.isFinite(v))return fail(field,'value is outside finite float32 execution range');return v;}
function packed(raw:string,diagnostics:string[]):number {try{return sourceConfigPackedColor(raw);}catch(error){if(!(error instanceof SourceConfigColorError))throw error;diagnostics.push('Source color could not be parsed; the retained parser uses white. Original text is preserved.');return 0xffffffff;}}
const rgb=(v:number):[number,number,number]=>[F(((v>>>16)&255)/255),F(((v>>>8)&255)/255),F((v&255)/255)];
const fract=(x:number)=>F(x-F(Math.floor(x))),lerp=(a:number,b:number,t:number)=>F(a+F(F(b-a)*t));
function rgbToHsv([r,g,b]:readonly number[]):[number,number,number]{
 const max=Math.max(r,Math.max(g,b)),min=Math.min(r,Math.min(g,b)),d=F(max-min);let h=d<F(1e-6)?0:max===r?F(F(F(g-b)/d)/6):max===g?F(F(F(F(b-r)/d)+2)/6):F(F(F(F(r-g)/d)+4)/6);if(h<0)h=F(h+1);return[h,max<=0?0:F(d/max),max];
}
function hsvToRgb([h,s,v]:readonly number[]):[number,number,number]{
 const q=F(h*6),i=Math.floor(q),f=F(q-F(i)),p=F(v*F(1-s)),a=F(v*F(1-F(s*f))),b=F(v*F(1-F(s*F(1-f))));return([[v,b,p],[a,v,p],[p,v,b],[p,a,v],[b,p,v],[v,p,a]][i%6]??[v,p,a]) as [number,number,number];
}
export interface SourcePaletteUniforms {
 readonly packedColors:readonly number[];readonly colors:readonly number[];readonly size:number;
 readonly offset:number;readonly gamma:number;readonly space:0|1;readonly useCosine:boolean;
 readonly cosine:{readonly a:readonly number[];readonly b:readonly number[];readonly c:readonly number[];readonly d:readonly number[]};
}
/** Parse once for both the original CPU LUT and the shader's first-16 fallback.
 * The full packed palette remains available for original display-state hashing. */
export function prepareSourcePaletteRuntime(p:SourcePaletteRuntimeConfiguration,runtime:SourcePaletteRuntimeState|undefined,diagnostics:string[]):{lut:Float32Array;fallback:SourcePaletteUniforms} {
 const offset=f32(p.offset,'palette.offset'),gamma=Math.max(F(.01),f32(p.gamma,'palette.gamma'));
 const cosine=Object.fromEntries(Object.entries(p.cosine).map(([k,v])=>[k,v.map((n,i)=>f32(n,`cosine.${k}[${i}]`))])) as unknown as SourcePaletteRuntimeConfiguration['cosine'];
 const colors=p.colors.map(v=>packed(v,diagnostics)),entries=colors.map(rgb),lut=new Float32Array(1024*3);
 if(runtime&&(!['rgb','linear','oklab','oklch'].includes(runtime.interpolation)||typeof runtime.cyclic!=='boolean'))return fail('palette.runtime','invalid interpolation/cyclic facts');
 const segments=runtime&&!p.useCosine&&colors.length>1?colors.map((v,i)=>prepareDomainSourceSegment(v,colors[(i+1)%colors.length],runtime.interpolation)):[];
 for(let i=0;i<1024;i++){
  const t=F(F(i)/F(1023)),coordinate=F(t+offset);let color:[number,number,number];
  if(p.useCosine)color=[0,1,2].map(k=>clamp(F(cosine.a[k]+F(cosine.b[k]*F(Math.cos(F(F(6.28318)*F(F(cosine.c[k]*coordinate)+cosine.d[k])))))))) as [number,number,number];
  else if(colors.length===0)color=[0,0,0];else if(colors.length===1)color=entries[0];
  else{
   const x=F(Math.pow(fract(coordinate),gamma)),u=runtime?fract(x):clamp(x),pos=F(u*F(runtime?.cyclic?colors.length:colors.length-1));
   let index=Math.floor(pos);if(runtime){if(runtime.cyclic&&index>=colors.length)index=colors.length-1;else if(!runtime.cyclic&&index>=colors.length-1)index=colors.length-2;}
   const blend=F(pos-F(index)),next=runtime?.cyclic?(index+1)%colors.length:Math.min(index+1,colors.length-1);
   if(runtime)color=rgb(sampleDomainSourceSegment(segments[index],blend));
   else if(p.space==='rgb')color=entries[index].map((v,k)=>lerp(v,entries[next][k],blend)) as [number,number,number];
   else{const a=rgbToHsv(entries[index]),b=rgbToHsv(entries[next]),delta=F(b[0]-a[0]);if(Math.abs(delta)>.5)a[0]=F(a[0]+Math.sign(delta));color=hsvToRgb([fract(lerp(a[0],b[0],blend)),lerp(a[1],b[1],blend),lerp(a[2],b[2],blend)]);}
  }
  if(!color.every(Number.isFinite))return fail('palette','source LUT produced nonfinite colors');lut.set(color,i*3);
 }
 const fallback:SourcePaletteUniforms=Object.freeze({packedColors:Object.freeze(colors),colors:Object.freeze(entries.slice(0,16).flat()),size:Math.min(colors.length,16),offset,gamma,space:p.space==='hsv'?1:0,useCosine:p.useCosine,cosine:Object.freeze({a:Object.freeze(cosine.a),b:Object.freeze(cosine.b),c:Object.freeze(cosine.c),d:Object.freeze(cosine.d)})});
 return{lut,fallback};
}
