import * as THREE from 'three';
import type {RasterOutput} from '../types';
import {exactRasterDimensions,MAX_RASTER_PIXELS} from './rasterDimensions';
import {createSourceShaderMaterial} from './sourceShaderMaterial';
import {sourceTextureAnisotropy} from './sourceProcessingTextureSampling';

const vertex='precision highp float; in vec3 position; in vec2 uv; out vec2 texCoord; void main(){gl_Position=vec4(position,1.0);texCoord=uv;}';
const fragment='precision highp float; uniform sampler2D image; in vec2 texCoord; out vec4 color; void main(){color=texture(image,texCoord);}';
/** MathArt.draw images the recording target over Scene.backgroundColor, then
 * PGL copies the resolved RGB into an opaque native window. Keep those stages
 * separate: the browser canvas must not composite the intermediate alpha a
 * third time over the page. This owner retains both passes until disposal. */
export class SourceSamilaRecordingPreviewRenderer {
 private readonly texture:THREE.DataTexture;
 private readonly geometry:THREE.BufferGeometry;
 private readonly material:THREE.RawShaderMaterial;
 private readonly copy:THREE.RawShaderMaterial;
 private readonly target:THREE.WebGLRenderTarget;
 private readonly scene=new THREE.Scene();
 private readonly copyScene=new THREE.Scene();
 private readonly camera=new THREE.Camera();
 private readonly size=new THREE.Vector2();
 private closing=false;
 private textureOwner?:THREE.WebGLRenderer;
 private uploadFailure?:Error;
 private readonly cleanup:{dispose():void}[];
 constructor(frame:Pick<RasterOutput,'width'|'height'|'pixels'>,private readonly background:readonly [number,number,number,number]){
  const {width,height,pixels}=frame;
  exactRasterDimensions({width,height,time:0,quality:'export'});
  if(!(pixels instanceof Uint8ClampedArray)||pixels.length!==width*height*4)throw Error('Samila 录制预览需要完整原始 RGBA 图像');
  this.texture=new THREE.DataTexture(pixels,width,height,THREE.RGBAFormat);
  this.texture.colorSpace=THREE.NoColorSpace;this.texture.flipY=true;
  // Processing's offscreen color texture: observed LINEAR in both directions,
  // CLAMP_TO_EDGE and level zero only. No sRGB decoding or alpha repair.
  this.texture.minFilter=this.texture.magFilter=THREE.LinearFilter;
  this.texture.wrapS=this.texture.wrapT=THREE.ClampToEdgeWrapping;
  this.texture.generateMipmaps=false;this.texture.needsUpdate=true;
  this.geometry=new THREE.BufferGeometry();
  // Processing image tessellation is TL, BL, BR, TR with a TL–BR diagonal.
  // Affine-equivalent triangles can differ at finite interpolation boundaries.
  this.geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,1,0,-1,-1,0,1,-1,0,1,1,0],3));
  this.geometry.setAttribute('uv',new THREE.Float32BufferAttribute([0,1,0,0,1,0,1,1],2));
  this.geometry.setIndex([0,1,2,2,3,0]);
  this.material=createSourceShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:vertex,fragmentShader:fragment,
   uniforms:{image:{kind:'sampler2d',value:this.texture}},transparent:true,depthTest:false,depthWrite:false,toneMapped:false,
   blending:THREE.CustomBlending,blendEquation:THREE.AddEquation,blendSrc:THREE.SrcAlphaFactor,blendDst:THREE.OneMinusSrcAlphaFactor,
   blendEquationAlpha:THREE.AddEquation,blendSrcAlpha:THREE.OneFactor,blendDstAlpha:THREE.OneFactor,
  });
  this.target=new THREE.WebGLRenderTarget(1,1,{depthBuffer:false,stencilBuffer:false,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter});
  this.target.texture.colorSpace=THREE.NoColorSpace;
  this.copy=new THREE.RawShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:vertex,
   fragmentShader:'precision highp float; uniform sampler2D image; in vec2 texCoord; out vec4 color; void main(){color=vec4(texture(image,texCoord).rgb,1.0);}',
   uniforms:{image:{value:this.target.texture}},blending:THREE.NoBlending,depthTest:false,depthWrite:false,toneMapped:false,
  });
  const mesh=new THREE.Mesh(this.geometry,this.material),copy=new THREE.Mesh(this.geometry,this.copy);
  mesh.frustumCulled=copy.frustumCulled=false;this.scene.add(mesh);this.copyScene.add(copy);
  this.cleanup=[this.geometry,this.material,this.copy,this.texture,this.target];
 }
 private upload(renderer:THREE.WebGLRenderer,gl:WebGL2RenderingContext):void {
  if(this.uploadFailure)throw this.uploadFailure;
  if(this.textureOwner&&this.textureOwner!==renderer)throw Error('Samila 录制预览不能跨渲染器使用');
  let configured=!!this.textureOwner;this.textureOwner=renderer;
  // Processing applies maximum anisotropy even with LINEAR level zero. Three
  // r180 skips that profile. Its public initTexture uploads this owned texture
  // and calls onUpdate while it is still bound, then unbinds through its cache.
  this.texture.onUpdate=()=>{
   try{
    const anisotropy=sourceTextureAnisotropy(gl);
    if(anisotropy)gl.texParameterf(gl.TEXTURE_2D,anisotropy.parameter,anisotropy.maximum);
    configured=true;
   }catch(error){this.uploadFailure=error instanceof Error?error:Error(String(error));}
  };
  // Do not throw through onUpdate: Three commits the source version before the
  // callback and the texture version after it. A failed upload poisons this
  // owner, so a later draw cannot silently skip the failed configuration.
  // Repeat initTexture after a context restore; unchanged uploads are cached.
  // Pin the renderer too: two renderers sharing a GL context own distinct caches.
  try{renderer.initTexture(this.texture);}catch(error){this.uploadFailure=error instanceof Error?error:Error(String(error));}finally{this.texture.onUpdate=null;}
  const error=gl.getError();
  if(!this.uploadFailure&&(!configured||gl.isContextLost()||error!==gl.NO_ERROR))this.uploadFailure=Error(`Samila 录制预览纹理上传失败 (${error})`);
  if(this.uploadFailure)throw this.uploadFailure;
 }
 render(renderer:THREE.WebGLRenderer):void {
  if(this.closing)throw Error('Samila 录制预览已释放或等待清理');
  renderer.getDrawingBufferSize(this.size);const width=this.size.x,height=this.size.y;
  exactRasterDimensions({width,height,time:0,quality:'export'});
  // Three r180 creates WebGL2 contexts; its public type still includes WebGL1.
  const previous=renderer.getRenderTarget(),autoClear=renderer.autoClear,gl=renderer.getContext() as WebGL2RenderingContext;
  if(previous)throw Error('Samila 录制预览需要主显示目标');
  if(gl.isContextLost())throw Error('Samila 录制预览图形上下文已丢失');
  const before=gl.getError();if(before!==gl.NO_ERROR)throw Error(`Samila 录制预览前 GL 状态失败 (${before})`);
  const samples=gl.getParameter(gl.SAMPLES) as number;
  const maxTexture=gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,maxRenderbuffer=gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number,maxViewport=gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
  const source=this.texture.image;
  if(source.width>maxTexture||source.height>maxTexture||width>Math.min(maxTexture,maxRenderbuffer,maxViewport[0])||height>Math.min(maxTexture,maxRenderbuffer,maxViewport[1]))throw Error('Samila 录制预览超过 GPU 纹理或视口限制');
  if(!Number.isSafeInteger(samples)||samples<0||samples>0&&!(gl.getInternalformatParameter(gl.RENDERBUFFER,gl.RGBA8,gl.SAMPLES) as Int32Array).includes(samples))throw Error('Samila 录制预览不支持当前主画布采样数');
  // Two raster budgets (256 MiB) bound this owner's known attachments: source
  // upload, resolve texture, and optional multisample color storage. Default
  // canvas/depth storage and driver allocations are outside this estimate.
  const bytes=4*(source.width*source.height+width*height*(samples>0?samples+1:1));
  if(bytes>2*MAX_RASTER_PIXELS*4)throw Error('Samila 录制预览超过 256 MiB 显示缓冲预算');
  this.upload(renderer,gl);
  const dither=gl.isEnabled(gl.DITHER);
  if(this.target.samples!==samples){this.target.dispose();this.target.samples=samples;}
  this.target.setSize(width,height);
  try{
   // The captured original primary image pass has DITHER disabled. Three has
   // no cached dither state; restore the shared context's previous value.
   gl.disable(gl.DITHER);
   renderer.setRenderTarget(this.target);
   renderer.state.buffers.color.setMask(true);
   renderer.state.buffers.color.setClear(...this.background.map(value=>Math.fround(value/255)) as [number,number,number,number],false);
   renderer.clear(true,false,false);renderer.autoClear=false;
   renderer.render(this.scene,this.camera);
   renderer.setRenderTarget(previous);
   renderer.render(this.copyScene,this.camera);
   const error=gl.getError();if(gl.isContextLost()||error!==gl.NO_ERROR)throw Error(`Samila 录制预览绘制失败 (${error})`);
  }finally{renderer.setRenderTarget(previous);renderer.autoClear=autoClear;if(dither)gl.enable(gl.DITHER);}
 }
 dispose():void {
  this.closing=true;this.scene.clear();this.copyScene.clear();
  // A failed disposal keeps the exact unfinished resource for a retry.
  while(this.cleanup.length){this.cleanup[0].dispose();this.cleanup.shift();}
 }
}
