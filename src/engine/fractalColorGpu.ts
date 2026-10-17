import type {FractalColors} from './fractalColor';
import {usesFractalTrap} from './fractalColor';
// Independent compact representation. The CPU uses the same sampled palette for
// layered traps, so RGB curves, HSV interpolation and endpoint wrapping have one owner.
export const fractalTrapGLSL=`
uniform int traceEnabled;
uniform vec4 traceInsideGeometry,traceOutsideGeometry,traceInsideShape,traceOutsideShape,traceInsideColor,traceOutsideColor;
uniform sampler2D tracePalette;
vec4 traceInside=vec4(3.402823466e38,0.,0.,0.),traceOutside=vec4(3.402823466e38,0.,0.,0.);
vec3 traceHSV(float h,float s,float v){return v*mix(vec3(1.),clamp(abs(fract(vec3(h)+vec3(0.,2./3.,1./3.))*6.-3.)-1.,0.,1.),s);}
vec3 tracePaletteAt(float t,int row){float p=clamp(t,0.,1.)*1024.;int i=min(1023,int(floor(p)));return mix(texelFetch(tracePalette,ivec2(i,row),0).rgb,texelFetch(tracePalette,ivec2(i+1,row),0).rgb,p-float(i));}
void traceOne(vec2 z,vec4 geometry,vec4 shape,vec4 tint,int row,inout vec4 state){
 if(shape.w<.5)return;
 vec2 q=z-geometry.xy;float co=cos(geometry.z),si=sin(geometry.z);q=vec2(q.x*co-q.y*si,(q.x*si+q.y*co)*geometry.w);
 float distance=shape.x>1.5?min(abs(q.x),abs(q.y)):shape.x>.5?abs(length(q)-shape.y):length(q);
 if(isnan(distance)||isinf(distance))return;state.x=min(state.x,distance);
 if(shape.w<1.5||distance>=shape.z)return;
 float value=1.-distance/shape.z,hue=fract(atan(z.y,z.x)/6.283185307179586+.5);
 vec3 rgb=pow(traceHSV(hue,tint.y,value),vec3(1./tint.x));
 rgb=mix(rgb,tracePaletteAt(value,row),tint.z);state.yzw=mix(state.yzw,rgb,value*tint.w);
}
void traceStep(vec2 z){if(traceEnabled==0)return;traceOne(z,traceInsideGeometry,traceInsideShape,traceInsideColor,0,traceInside);traceOne(z,traceOutsideGeometry,traceOutsideShape,traceOutsideColor,1,traceOutside);}
`;
export function uploadFractalTrace(gl:WebGL2RenderingContext,program:WebGLProgram,colors:FractalColors|undefined,onTextureAllocated?:(texture:WebGLTexture)=>void,gpuOperation:<T>(operation:()=>T)=>T=operation=>operation()):WebGLTexture|null {
 gpuOperation(()=>gl.uniform1i(gl.getUniformLocation(program,'traceEnabled'),colors?1:0));
 if(!colors){gpuOperation(()=>gl.uniform1i(gl.getUniformLocation(program,'tracePalette'),0));return null;}
 const palette=new Float32Array(1025*2*4);
 for(const [row,side]of (['inside','outside'] as const).entries()){
  const s=colors[side],prefix='trace'+(side==='inside'?'Inside':'Outside');
  // A finite float is insufficient when its quantization exceeds the active
  // trap feature size. Preserve these geometries through the CPU fallback.
  if(usesFractalTrap(s)&&([...s.center,...(s.shape==='ring'?[s.radius]:[])].some(v=>Math.abs(Math.fround(v)-v)>s.threshold*.01)||Math.abs(Math.fround(s.rotation)-s.rotation)>1e-6))throw new Error('Trap geometry loses precision relative to its threshold; CPU required');
  const four=(suffix:string,v:number[])=>{if(!v.every(n=>Number.isFinite(Math.fround(n))))throw new Error('Trap parameters exceed float32');gpuOperation(()=>gl.uniform4fv(gl.getUniformLocation(program,prefix+suffix),v));};
  four('Geometry',[...s.center,s.rotation,s.aspect]);four('Shape',[['point','ring','cross'].indexOf(s.shape),s.radius,s.threshold,!usesFractalTrap(s)?0:s.algorithm==='direct_orbit_trap'?2:1]);four('Color',[s.gamma,s.saturation,s.mix,s.merge]);
  for(let i=0;i<=1024;i++){const k=(row*1025+i)*4;palette.set(s.trapLut.subarray(i*3,i*3+3),k);palette[k+3]=1;}
 }
 // With the hook, ownership transfers immediately, even if registration or
 // upload throws. That caller must retain/delete the handle; this helper must
 // not delete it a second time. Legacy callers keep the prior local lifetime.
 const texture=gpuOperation(()=>{const t=gl.createTexture();if(!t)throw new Error('Trap palette allocation failed');return t;});
 if(onTextureAllocated)onTextureAllocated(texture);
 try{gpuOperation(()=>{gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,1025,2,0,gl.RGBA,gl.FLOAT,palette);gl.uniform1i(gl.getUniformLocation(program,'tracePalette'),1);});return texture;}catch(error){if(!onTextureAllocated)gpuOperation(()=>gl.deleteTexture(texture));throw error;}
}
