import type {SceneDocument,GenerateContext} from '../types';
import type {DensityNormalization,DensityNormalizationFacts} from './densityNormalization';
import {prepareNormalizedDensityTone,type DensityToneJob} from './density';
import {usesSourceSymmetryGpu} from './sourceSymmetryMath';
import {MAX_RASTER_PIXELS} from './rasterDimensions';

export const SOURCE_SYMMETRY_PRESENTATION_MODEL='symmetry-present-1.7.8' as const;
export interface SourceSymmetryToneReference {width:number;height:number;}
export interface SourceSymmetryPresentationFacts {
 model:typeof SOURCE_SYMMETRY_PRESENTATION_MODEL;stage:'scene-target-rgba8';display:'opaque-rgb-copy';
 reference:SourceSymmetryToneReference;referenceKind:'primary-canvas'|'local-output';scale:number;
}
export function usesSourceSymmetryPresentation(scene:Pick<SceneDocument,'kind'|'settings'>):boolean{return scene.kind==='symmetry'&&scene.settings.symmetryPresentationModel===SOURCE_SYMMETRY_PRESENTATION_MODEL;}
export function validateSourceSymmetryPresentation(scene:Pick<SceneDocument,'kind'|'settings'>):void {
 const model=scene.settings.symmetryPresentationModel;if(model===undefined)return;
 if(model!==SOURCE_SYMMETRY_PRESENTATION_MODEL||!usesSourceSymmetryGpu(scene)||scene.settings.iteratedMode!=='continuous'||scene.settings.densityToneModel!=='normalized-v2')throw Error('源 Symmetry 呈现需要源 GPU 数学、持续累积和归一调色');
}
const size=(v:number)=>{if(!Number.isInteger(v)||v<1||v>16384)throw Error('源 Symmetry 呈现参考尺寸必须是 1–16384 的物理像素整数');return v;};
/** Original Java computes areas in double, rounds the ratio to float, then
 * promotes that rounded ratio for the scale calculation and rounds again. */
export function deriveSourceSymmetryNormalization(facts:DensityNormalizationFacts,reference:SourceSymmetryToneReference):DensityNormalization {
 if(facts.kind!=='symmetry')throw Error('Symmetry 归一事实的场景类型不匹配');
 const width=size(facts.width),height=size(facts.height),referenceWidth=size(reference.width),referenceHeight=size(reference.height);
 if(!Number.isInteger(facts.recordedPasses)||facts.recordedPasses<0||facts.recordedPasses>2147483647||!Number.isInteger(facts.batchSize)||facts.batchSize<1||facts.batchSize>2147483647)throw Error('源 Symmetry 批次事实超出 Java int 范围');
 const area=width*height,referenceScale=Math.fround(area/(referenceWidth*referenceHeight));
 const scale=Math.fround(Math.max(1,facts.recordedPasses)*Math.max(1,facts.batchSize)/area*Math.max(1e-6,referenceScale));
 if(!Number.isFinite(scale)||scale<=0)throw Error('源 Symmetry 归一尺度非有限或不为正');
 return{...facts,referenceWidth,referenceHeight,scale};
}
export function prepareSourceSymmetryTone(scene:SceneDocument,context:Pick<GenerateContext,'width'|'height'|'sourceSymmetryToneReference'>):DensityToneJob {
 validateSourceSymmetryPresentation(scene);if(!usesSourceSymmetryPresentation(scene))throw Error('场景未选择源 Symmetry 呈现');
 const reference=context.sourceSymmetryToneReference??{width:context.width,height:context.height};
 const normalization=deriveSourceSymmetryNormalization({kind:'symmetry',width:context.width,height:context.height,recordedPasses:0,batchSize:1},reference);
 const job=prepareNormalizedDensityTone(scene.palette,{normalizedBrightness:.3,normalizedDynamicRange:.2,...scene.settings},normalization);
 return{...job,normalization,sourceSymmetryPresentation:{model:SOURCE_SYMMETRY_PRESENTATION_MODEL,stage:'scene-target-rgba8',display:'opaque-rgb-copy',reference:{...reference},referenceKind:context.sourceSymmetryToneReference?'primary-canvas':'local-output',scale:normalization.scale}};
}
/** Before the local replay start there is no accumulated foreground. This is
 * the Scene background clear, not a CPU replacement for source shader math. */
export function clearSourceSymmetryTarget(width:number,height:number,background:readonly number[],isCancelled?:()=>boolean):Uint8ClampedArray {
 size(width);size(height);if(width*height>MAX_RASTER_PIXELS)throw Error('源场景背景超过共享 RGBA 图像容量');
 if(background.length!==3||!background.every(v=>Number.isFinite(v)&&v>=0&&v<=1))throw Error('源场景背景无效');
 const color=[...background.map(v=>Math.round(v*255)),255],pixels=new Uint8ClampedArray(width*height*4);
 for(let i=0;i<pixels.length;i+=4){if((i&65535)===0&&isCancelled?.())throw new DOMException('源场景背景清除已取消','AbortError');pixels.set(color,i);}return pixels;
}
/** density_map_present.frag mode=1, invert=false, foregroundAlphaScale=1.
 * Local ink is RGB/mass; the source shader uses mass/RGB. Statistics are a
 * separate integer MRT and do not modify the source color arithmetic. */
export const SOURCE_SYMMETRY_PRESENT_GLSL=`
uniform sampler2D ink;uniform ivec2 origin;uniform float displayRotation,viewportAspect,brightness,contrast,gamma,dynamicRange,saturation,scale;
in vec2 texCoord;layout(location=0)out vec4 pixel;layout(location=1)out uvec4 facts;
bool finiteFloat(float x){return(floatBitsToUint(x)&0x7f800000u)!=0x7f800000u;}
bool finite4(vec4 x){return finiteFloat(x.x)&&finiteFloat(x.y)&&finiteFloat(x.z)&&finiteFloat(x.w);}
vec3 rgb2yuv(vec3 rgb){float y=.299*rgb.r+.587*rgb.g+.114*rgb.b;return vec3(y,.493*(rgb.b-y),.877*(rgb.r-y));}
vec3 yuv2rgb(vec3 yuv){return vec3(yuv.x+(1./.877)*yuv.z,yuv.x-.39393*yuv.y-.58081*yuv.z,yuv.x+(1./.493)*yuv.y);}
float smoothLimit(float x,float k){x=2.*x-1.;float a=pow(abs(x),1./max(k,.01));return sign(x)*pow(a/(a+1.),max(k,.01))*.5+.5;}
void main(){
 vec4 original=texelFetch(ink,origin+ivec2(gl_FragCoord.xy),0);float originalCount=original.a;facts=uvec4(originalCount>0.?1u:0u,finiteFloat(originalCount)&&originalCount>0.?floatBitsToUint(originalCount):0u,finite4(original)&&originalCount>=0.?0u:1u,0u);
 vec2 centered=texCoord-vec2(.5);centered.x*=viewportAspect;float c=cos(-displayRotation),s=sin(-displayRotation);vec2 rotated=vec2(centered.x*c-centered.y*s,centered.x*s+centered.y*c);rotated.x/=viewportAspect;rotated+=vec2(.5);
 if(rotated.x<0.||rotated.x>1.||rotated.y<0.||rotated.y>1.){pixel=vec4(0.);return;}
 vec4 accum=texture(ink,rotated);float count=max(accum.a,0.);if(count<=1.e-12){pixel=vec4(0.);return;}
 vec3 avgRgb=accum.rgb/count;float density=count/max(scale,1.e-8);float v=density==0.?-20.:(log(density)-log(1.))/(log(1000.)-log(1.));float value=contrast*v+brightness;value=smoothLimit(value,dynamicRange);value=1.-value;
 vec3 yuv=rgb2yuv(avgRgb);yuv.x=value;yuv.yz*=saturation*value*(1.-value)*4.;vec3 rgb=clamp(yuv2rgb(yuv),0.,1.);vec3 mappedRgb=pow(rgb,vec3(1./max(gamma,.001)));
 float foregroundAlpha=density/(density+.02);foregroundAlpha=clamp(foregroundAlpha*max(1.,0.),0.,1.);pixel=vec4(mappedRgb,foregroundAlpha);if(!finite4(pixel)||!finite4(accum))facts.z=1u;
}`;
