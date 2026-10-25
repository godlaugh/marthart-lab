import type {SceneDocument,Settings} from '../types';
import type {PreparedSamilaView} from './samilaCamera';
import type {DensityToneJob} from './density';
import {writeSourcePackedColor} from './sourceProcessingGeometry';

export const SOURCE_SAMILA_PRESENTATION_MODEL='samila-present-1.7.8' as const;
interface SourceSamilaPresentationBase {model:typeof SOURCE_SAMILA_PRESENTATION_MODEL;stage:'present-target-rgba8';backend:'webgl2'|'cpu-derived'|'native';}
/** pixels always remain the original target RGBA. Only screen delivery uses
 * this discriminant: normal primary copies RGB; recording first clears to the
 * Scene-owned background and applies Processing BLEND1 using stored alpha.
 * Scene background is independent of the mobject's hot shader background. */
export type SourceSamilaPresentationFacts=SourceSamilaPresentationBase&(
 | {display:'opaque-rgb-copy';backgroundRgba8?:never}
 | {display:'recording-preview-over-background';backgroundRgba8:readonly [number,number,number,number]}
);
/** One consumer boundary for unknown delivered facts. Never infer a display
 * mode or background from the current editable scene, target or alpha bytes. */
export function validateSourceSamilaPresentationFacts(value:unknown):asserts value is SourceSamilaPresentationFacts {
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('源 Samila 呈现事实需要对象');
 const facts=value as Record<string,unknown>;
 if(facts.model!==SOURCE_SAMILA_PRESENTATION_MODEL||facts.stage!=='present-target-rgba8'||!['webgl2','cpu-derived','native'].includes(facts.backend as string))throw Error('源 Samila 呈现事实的版本、阶段或后端无效');
 if(facts.display==='opaque-rgb-copy'){
  if(Object.hasOwn(facts,'backgroundRgba8'))throw Error('源 Samila 普通复制不能携带录制背景');
 }else if(facts.display==='recording-preview-over-background'){
  const background=facts.backgroundRgba8;
  if(!Array.isArray(background)||background.length!==4||![0,1,2,3].every(index=>Object.hasOwn(background,index)&&Number.isInteger(background[index])&&background[index]>=0&&background[index]<=255))throw Error('源 Samila 录制预览需要 Scene 的 RGBA8 背景');
 }else throw Error('源 Samila 呈现模式无效');
}
function packedSceneBackground(settings:Settings):number|undefined {
 const packed=settings.samilaSceneBackgroundColor;
 if(packed!==undefined&&(typeof packed!=='number'||!Number.isSafeInteger(packed)||packed<0||packed>0xffffffff))throw Error('源 Samila Scene 背景需要 uint32 颜色');return packed as number|undefined;
}
/** Constructor-owned Scene color uses Processing colorCalc(int), independently
 * of the shader's masked RGB. Older local documents omit packed provenance and
 * retain their explicit opaque #RRGGBB behavior; no source alpha is invented. */
export function sourceSamilaSceneBackgroundRgba8(settings:Settings,parsedShaderBackground:readonly [number,number,number]):readonly [number,number,number,number] {
 const packed=packedSceneBackground(settings);
 if(packed===undefined)return Object.freeze([...parsedShaderBackground.map(value=>Math.round(value*255)),255] as [number,number,number,number]);
 const rgba=new Float32Array(4);writeSourcePackedColor(packed,rgba,0);return Object.freeze(Array.from(rgba,value=>Math.round(value*255)) as [number,number,number,number]);
}
export function usesSourceSamilaPresentation(scene:Pick<SceneDocument,'kind'|'settings'>):boolean{return scene.kind==='samila'&&scene.settings.samilaPresentationModel===SOURCE_SAMILA_PRESENTATION_MODEL;}
export function sourceSamilaPresentationModel(settings:Settings):typeof SOURCE_SAMILA_PRESENTATION_MODEL|undefined {
 const model=settings.samilaPresentationModel;if(model===undefined)return;
 if(model!==SOURCE_SAMILA_PRESENTATION_MODEL||settings.samilaSplatModel!=='samila-splat-1.7.8'||settings.densityToneModel!=='samila-normalized-v2')throw Error('源 Samila 呈现需要已支持的版本、源 splat 和归一调色');return model;
}
export function validateSourceSamilaPresentation(scene:Pick<SceneDocument,'kind'|'settings'>):void {const model=sourceSamilaPresentationModel(scene.settings);if(model)packedSceneBackground(scene.settings);if(model&&(scene.kind!=='samila'||scene.settings.iteratedMode!=='continuous'||scene.settings.samilaProjectionModel!=='source-ndc-v1'||scene.settings.samilaCameraModel!=='anchored-theta-v1'||scene.settings.samilaMathModel!=='mathart-1.7.8'||scene.settings.samilaHistoryModel!=='bounded-v2'||(scene.settings.densityProjection??'xy')!=='xy'))throw Error('源 Samila 呈现需要 Samila 持续批次、源数学/NDC、锚定相机、bounded-v2 历史和 XY 密度投影');}
const F=Math.fround,clamp=(x:number)=>Math.max(0,Math.min(1,x));
/** Mobject.displayPanelRotationRadians: Java fsub, deliberately no modulo. */
export function sourceSamilaDisplayTransform(view:PreparedSamilaView|undefined,width:number,height:number):{delta:number;aspect:number} {
 const delta=view?F(F(view.currentTheta)-F(view.anchorTheta)):0,aspect=F(width/height);
 if(!Number.isFinite(delta)||!Number.isFinite(aspect)||aspect<=0)throw Error('源 Samila 呈现旋转或宽高比超出有限 float32');return{delta,aspect};
}
/** CPU-derived NEAREST lookup. JS transcendental/interpolation rounding is not
 * the original GPU's execution; GPU presentation never consumes these indices. */
export function prepareSourceSamilaSampling(view:PreparedSamilaView,width:number,height:number){const {delta,aspect}=sourceSamilaDisplayTransform(view,width,height);return{width,height,aspect,c:F(Math.cos(-delta)),s:F(Math.sin(-delta))};}
export function sourceSamilaPresentationIndex(view:ReturnType<typeof prepareSourceSamilaSampling>,x:number,y:number):number {
 const {width,height,aspect,c,s}=view;
 const qx=F(F(F((x+.5)/width)-.5)*aspect),qy=F(F((height-y-.5)/height)-.5);
 const u=F(F(F(F(qx*c)-F(qy*s))/aspect)+.5),v=F(F(F(qx*s)+F(qy*c))+.5);
 if(!Number.isFinite(u)||!Number.isFinite(v))throw Error('源 Samila CPU 呈现坐标非有限');
 if(u<0||u>1||v<0||v>1)return -1;
 return(height-1-Math.min(height-1,Math.floor(v*height)))*width+Math.min(width-1,Math.floor(u*width));
}
/** Isolated RGBA8 target, cleared to zero and ordinary SRC_ALPHA blended.
 * RGB clamps BEFORE blending. This is not straight alpha nor PNG postprocessing. */
export function sourceSamilaBlendTarget(rgba:readonly number[]):[number,number,number,number] {
 if(!rgba.every(Number.isFinite))throw Error('源 Samila 呈现产生非有限值；不使用稳定公式修复原 GPU 未定义结果');
 const a=clamp(F(rgba[3]));return [0,1,2].map(k=>Math.round(255*F(clamp(F(rgba[k]))*a))).concat(Math.round(255*F(a*a))) as [number,number,number,number];
}
/** Literal source arithmetic with float32 staging; JS libm remains approximate. */
export function sourceSamilaPresentPixel(job:DensityToneJob,mass:number,rgb:readonly number[]):[number,number,number,number] {
 if(job.model!=='samila-normalized-v2'||!job.sourcePresentation)throw Error('源 Samila 呈现缺少已解析调色事实');
 const bg=job.background.map(F),count=Math.max(F(mass),0);if(count<=F(1e-12))return sourceSamilaBlendTarget([...bg,1]);
 const t=job.tone,average=rgb.map(v=>F(F(v)/count)),density=F(count/Math.max(F(job.normalization.scale),F(1e-8)));
 const v=density===0?-20:F(F(Math.log(density))/F(Math.log(1000))),q=F(F(2*F(F(F(t.contrast)*v)+F(t.brightness)))-1),k=Math.max(F(t.dynamicRange),F(.01)),a=F(Math.pow(Math.abs(q),F(1/k)));
 const value=F(F(F(Math.sign(q)*F(Math.pow(F(a/F(a+1)),k)))*.5)+.5),b=clamp(value),inverse=F(1/Math.max(F(t.gamma),F(.001)));
 let color:number[],alpha=F(density/F(density+F(.02)));
 if(job.branch==='palette-average'){
  color=average.map((x,i)=>F(Math.pow(F(F(bg[i]*F(1-b))+F(x*b)),inverse)));
  const y=F(F(F(F(.299)*color[0])+F(F(.587)*color[1]))+F(F(.114)*color[2]));color=color.map(x=>F(F(y*F(1-F(t.saturation)))+F(x*F(t.saturation))));alpha=F(F(1-b)+F(alpha*b));
 }else{
  const y=F(F(F(F(.299)*average[0])+F(F(.587)*average[1]))+F(F(.114)*average[2])),chroma=F(F(F(F(t.saturation)*value)*F(1-value))*4),u=F(F(F(.493)*F(average[2]-y))*chroma),w=F(F(F(.877)*F(average[0]-y))*chroma);
  color=[F(value+F(F(1/.877)*w)),F(F(value-F(F(.39393)*u))-F(F(.58081)*w)),F(value+F(F(1/.493)*u))].map(x=>F(Math.pow(clamp(x),inverse)));
 }
 return sourceSamilaBlendTarget([...color,clamp(alpha)]);
}

/** Literal samila_present.frag mode=1; local ink is RGB/mass, source is mass/RGB.
 * The adapter uses actual RGBA8 fixed-function blending after this raw output. */
export const SOURCE_SAMILA_PRESENT_GLSL=`
uniform sampler2D ink;uniform ivec2 origin;uniform float displayRotation,viewportAspect,brightness,contrast,gamma,dynamicRange,saturation,scale;uniform vec3 backgroundRgb;uniform bool usePaletteLUT;
in vec2 texCoord;layout(location=0)out vec4 pixel;layout(location=1)out uvec4 facts;
bool finiteFloat(float x){return(floatBitsToUint(x)&0x7f800000u)!=0x7f800000u;}
bool finite4(vec4 x){return finiteFloat(x.x)&&finiteFloat(x.y)&&finiteFloat(x.z)&&finiteFloat(x.w);}
vec3 rgb2yuv(vec3 rgb){float y=.299*rgb.r+.587*rgb.g+.114*rgb.b;return vec3(y,.493*(rgb.b-y),.877*(rgb.r-y));}
vec3 yuv2rgb(vec3 yuv){return vec3(yuv.x+(1./.877)*yuv.z,yuv.x-.39393*yuv.y-.58081*yuv.z,yuv.x+(1./.493)*yuv.y);}
float smoothLimit(float x,float k){x=2.*x-1.;float a=pow(abs(x),1./max(k,.01));return sign(x)*pow(a/(a+1.),max(k,.01))*.5+.5;}
void main(){
 vec4 original=texelFetch(ink,origin+ivec2(gl_FragCoord.xy),0);float originalCount=original.a;facts=uvec4(originalCount>0.?1u:0u,finiteFloat(originalCount)&&originalCount>0.?floatBitsToUint(originalCount):0u,finite4(original)?0u:1u,0u);
 vec2 centered=texCoord-vec2(.5);centered.x*=viewportAspect;float c=cos(-displayRotation),s=sin(-displayRotation);vec2 rotated=vec2(centered.x*c-centered.y*s,centered.x*s+centered.y*c);rotated.x/=viewportAspect;rotated+=vec2(.5);
 if(rotated.x<0.||rotated.x>1.||rotated.y<0.||rotated.y>1.){pixel=vec4(backgroundRgb,1.);return;}
 vec4 accum=texture(ink,rotated);float count=max(accum.a,0.);if(count<=1.e-12){pixel=vec4(backgroundRgb,1.);return;}
 vec3 avgRgb=accum.rgb/count;float density=count/max(scale,1.e-8);float v=density==0.?-20.:(log(density)-log(1.))/(log(1000.)-log(1.));float value=contrast*v+brightness;value=smoothLimit(value,dynamicRange);float densityBrightness=clamp(value,0.,1.);vec3 mappedRgb;
 if(usePaletteLUT){mappedRgb=mix(backgroundRgb,avgRgb,densityBrightness);mappedRgb=pow(mappedRgb,vec3(1./max(gamma,.001)));float luma=dot(mappedRgb,vec3(.299,.587,.114));mappedRgb=mix(vec3(luma),mappedRgb,saturation);}
 else{vec3 yuv=rgb2yuv(avgRgb);yuv.x=value;yuv.yz*=saturation*value*(1.-value)*4.;vec3 rgb=clamp(yuv2rgb(yuv),0.,1.);mappedRgb=pow(rgb,vec3(1./max(gamma,.001)));}
 float alpha=density/(density+.02);if(usePaletteLUT)alpha=mix(1.,alpha,densityBrightness);alpha=clamp(alpha,0.,1.);pixel=vec4(mappedRgb,alpha);if(!finite4(pixel)||!finite4(accum))facts.z=1u;
}`;
