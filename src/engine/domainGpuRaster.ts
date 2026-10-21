import {DomainGpuError,domainGpuOperation as gpuCall} from './domainGpuFailure';
import type {PreparedDomainViewport} from './domainViewport';
import type {DomainModel} from './domainModel';
import type {DomainGpuSource} from './domainExpressions';
import {prepareDomainGpuColor,DOMAIN_CPU_COLOR_CAPTURE_PLAN,type DomainGpuColorPlan} from './domainGpuColor';
import {MAX_RASTER_PIXELS} from './rasterDimensions';

export const DOMAIN_TILE_WIDTH=256,DOMAIN_TILE_HEIGHT=128;
export const MAX_DOMAIN_RASTER_SCRATCH_BYTES=8*1024*1024;
/** Two RGBA8 full-image attachments, tied to the shared 128 MiB RGBA output limit. */
export const MAX_DOMAIN_SOURCE_ATTACHMENT_BYTES=MAX_RASTER_PIXELS*8;
export interface DomainRepairCoordinates {readonly kind?:'coordinates';readonly values:Float32Array;readonly offset:number;}
/** Borrowed, tile-local sample arrays. Copy before retaining beyond callback. */
export interface DomainNativeGpuResult {readonly kind:'native-gpu-result';readonly values:Float32Array;readonly offset:number;readonly finalValues:Float32Array;readonly valueOffset:number;}
export type DomainRepairFacts=DomainRepairCoordinates|DomainNativeGpuResult;
export type DomainRepairPixel=(index:number,captured?:DomainRepairFacts)=>number;
export const MAX_DOMAIN_NATIVE_NODE_STEPS_PER_DRAW=1048576;
/** Parsed AST-node work proxy shared by raster and TF execution adapters. */
export function domainNativeWork(model:Pick<DomainModel,'expressionCost'|'iteration'|'steps'>,samplesPerItem=1){
 if(!Number.isSafeInteger(model.expressionCost)||model.expressionCost<1)throw new Error('原产物 GPU 表达式成本事实无效');
 const nodeStepsPerItem=model.expressionCost*Math.max(1,model.iteration?model.steps:1)*samplesPerItem;
 if(!Number.isSafeInteger(nodeStepsPerItem)||nodeStepsPerItem<1)throw new Error('原产物 GPU 表达式工作量超过可表示范围');
 return{nodeStepsPerItem,itemsPerDraw:Math.max(1,Math.floor(MAX_DOMAIN_NATIVE_NODE_STEPS_PER_DRAW/nodeStepsPerItem))};
}
export interface DomainRasterFacts {colorFallbackReason?:string;valueCapturePasses?:number;valueReadbackBytes?:number;valueCaptureSamples?:number;tileWidth?:number;tileHeight?:number;estimatedNodeStepsPerDraw?:number;attachmentBytes?:number;stagingBytes?:number;outputBytes?:number;estimatedTotalBytes?:number;coordinatePasses?:number;coordinateReadbackBytes?:number;samples:number;generated:number;invalid:number;invalidSamples:number;repaired:number;tiles:number;readbackBytes:number;estimatedScratchBytes:number;}
export interface DomainRasterProgram {program:WebGLProgram;locations:Map<string,WebGLUniformLocation|null>;}
export const domainRasterVertex=`#version 300 es
precision highp float;
void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);}`;
/** Source UV orientation is top-down after the retained P3D projection. The
 * full-image viewport stays fixed; scissoring bounds each tile without changing
 * interpolation. Six vertices preserve the source QUADS tessellation order. */
export const domainSourceRasterVertex=`#version 300 es
precision highp float;
out vec2 viewUv;
void main(){
 const vec2 corners[6]=vec2[6](vec2(-1.,1.),vec2(1.,1.),vec2(1.,-1.),vec2(1.,-1.),vec2(-1.,-1.),vec2(-1.,1.));
 vec2 p=corners[gl_VertexID];
 viewUv=vec2((p.x+1.)*.5,(1.-p.y)*.5);gl_Position=vec4(p,0.,1.);
}`;


/** This is an execution adapter for already-parsed viewport/orbit/color facts.
 * No palette or raw scene settings are interpreted here. Pixel centers match
 * the selected viewport recipe; risky pixels use that same recipe on CPU. */
export function domainRasterFragment(orbit:DomainGpuSource,color:DomainGpuColorPlan,view?:PreparedDomainViewport,nativeExecution=false):string{
 if(view?.version==='mathart-1.7.8-cpu')throw new Error('原产物 CPU 视口不能由 float32 GPU 光栅替代');
 const source=view?.version==='mathart-1.7.8-gpu',capture=source||nativeExecution;
 return `#version 300 es
precision highp float;precision highp int;
uniform ivec2 fullSize,tileOrigin;uniform int tileHeight,sampleSide;
${source?'in vec2 viewUv;uniform vec2 sourceResolution;uniform vec2 viewCenter;uniform float viewAngle,viewInverse;uniform int coordinateSample;':'uniform vec2 viewCenter,viewRotation;uniform float viewZoom;'}${nativeExecution?`${source?'':'uniform int coordinateSample;'}uniform int captureKind;`:''}uniform vec3 backgroundValue;
layout(location=0)out vec4 outputColor;layout(location=1)out uvec4 outputFacts;
${orbit.fragmentLibrary}
${color.source}
vec2 domainPixel(vec2 samplePosition,out bool risk){
${source?` vec2 uv=viewUv;if(sampleSide>1)uv+=samplePosition/vec2(fullSize);
 vec2 plane=uv*2.-1.;plane.x*=sourceResolution.x/max(sourceResolution.y,1.);
 float co=cos(viewAngle),si=sin(viewAngle);
 vec2 a=vec2(plane.x*co,plane.x*si),b=vec2(-plane.y*si,plane.y*co);
 vec2 rotatedPlane=vec2(plane.x*co-plane.y*si,plane.x*si+plane.y*co);
 vec2 offset=rotatedPlane*viewInverse,p=viewCenter+offset;
 a*=viewInverse;b*=viewInverse;`: ` float re=(samplePosition.x/float(fullSize.x)-.5)*4.*float(fullSize.x)/float(fullSize.y)/viewZoom;
 float im=(.5-samplePosition.y/float(fullSize.y))*4./viewZoom;
 vec2 a=vec2(re*viewRotation.x,re*viewRotation.y),b=vec2(-im*viewRotation.y,im*viewRotation.x);
 vec2 offset=a+b,p=viewCenter+offset;`}
 // Coordinate cancellation can erase a meaningful low part before the complex
 // expression sees it. Preserve the original CPU coordinate on such pixels.
 vec2 scale=max(max(abs(a),abs(b)),abs(viewCenter));
 risk=!cFinite2(p)||any(lessThan(abs(p),scale*4e-6))||any(bvec2(p.x!=0.&&abs(p.x)<1.17549435e-38,p.y!=0.&&abs(p.y)<1.17549435e-38));return p;
}
void main(){
 ivec2 local=ivec2(gl_FragCoord.xy),at=tileOrigin+ivec2(local.x,tileHeight-1-local.y);
 vec3 sum=vec3(0.);uint validCount=0u;bool needsRepair=false;
 for(int y=0;y<3;y++)for(int x=0;x<3;x++){
  if(y>=sampleSide||x>=sampleSide)continue;${capture?'\n  if(coordinateSample>=0&&coordinateSample!=y*sampleSide+x)continue;':''}
  bool coordinateRisk;vec2 pixel=domainPixel(${source?'(vec2(x,y)+.5)/float(sampleSide)-.5':'vec2(at)+(vec2(x,y)+.5)/float(sampleSide)'},coordinateRisk);${capture?`
  if(coordinateSample>=0${nativeExecution?'&&captureKind==0':''}){
   uint bx=floatBitsToUint(pixel.x),by=floatBitsToUint(pixel.y);
   outputColor=vec4(uvec4(bx,bx>>8,bx>>16,bx>>24)&255u)/255.;
   outputFacts=uvec4(by,by>>8,by>>16,by>>24)&255u;return;
  }`:''}
  vec2 value=domainEvaluate(pixel);${nativeExecution?`
  if(coordinateSample>=0&&captureKind==1){
   uint bx=floatBitsToUint(value.x),by=floatBitsToUint(value.y);
   outputColor=vec4(uvec4(bx,bx>>8,bx>>16,bx>>24)&255u)/255.;
   outputFacts=uvec4(by,by>>8,by>>16,by>>24)&255u;return;
  }`:''}bool valid,colorRisk;vec3 color=domainShade(value,pixel,valid,colorRisk);
  needsRepair=needsRepair||${nativeExecution?'':'coordinateRisk||complexRepair||'}colorRisk;
  if(valid){sum+=color;validCount++;}
 }
 vec3 rgb=validCount==0u?backgroundValue:floor(clamp(sum/float(validCount),0.,1.)*255.+.5)/255.;
 outputColor=vec4(rgb,1.);outputFacts=uvec4(validCount,needsRepair?1u:0u,0u,0u);
}`;}

export function prepareDomainRaster(model:DomainModel,width:number,height:number,target?:import('./domainRasterTarget').DomainRasterTarget){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>16384||height>16384||width*height>MAX_RASTER_PIXELS)throw new Error('域着色 GPU 图像尺寸超出预算');
 if(model.view.version==='mathart-1.7.8-cpu')throw new Error('原产物 CPU 视口不能由 float32 GPU 光栅替代');
 if(target&&(target.width!==width||target.height!==height||![target.logicalWidth,target.logicalHeight,target.density].every(n=>Number.isSafeInteger(n)&&n>0)||target.logicalWidth*target.density!==width||target.logicalHeight*target.density!==height))throw Error('域着色 GPU 逻辑目标与物理尺寸不匹配');
 const nativeExecution=model.execution.arithmetic==='native-gpu',preparedColor=prepareDomainGpuColor(model,height);
 if('reason'in preparedColor&&!nativeExecution)throw new Error(preparedColor.reason);
 const color='plan'in preparedColor?preparedColor.plan:DOMAIN_CPU_COLOR_CAPTURE_PLAN,colorFallbackReason='reason'in preparedColor?preparedColor.reason:undefined;
 const source=model.view.version==='mathart-1.7.8-gpu',capture=source||nativeExecution;
 let tileWidth=DOMAIN_TILE_WIDTH,tileHeight=DOMAIN_TILE_HEIGHT,estimatedNodeStepsPerDraw:number|undefined;
 if(nativeExecution){
  // Node x step x SS is a work proxy, not a driver-time bound. At least one
  // pixel must fit a draw; an indivisible pixel can exceed this proxy target.
  const {nodeStepsPerItem:workPerPixel,itemsPerDraw:pixels}=domainNativeWork(model,model.supersampling**2);
  tileWidth=Math.min(tileWidth,pixels);tileHeight=Math.min(tileHeight,Math.max(1,Math.floor(pixels/tileWidth)));
  estimatedNodeStepsPerDraw=tileWidth*tileHeight*workPerPixel;
 }
 const tilePixels=tileWidth*tileHeight;
 // Source UV interpolation needs full-image attachments. Native arithmetic on
 // a local viewport keeps the original local coordinate path and tiled FBO.
 const attachmentBytes=(source?width*height:tilePixels)*8;
 let stagingBytes=tilePixels*8+(capture?tilePixels*(4+model.supersampling**2*(nativeExecution?16:8)):0);
 for(const texture of color.textures){if(!Number.isInteger(texture.width)||!Number.isInteger(texture.height)||texture.width<1||texture.height<1||texture.data.length!==texture.width*texture.height*4)throw new Error('域着色 GPU 色板纹理事实无效');stagingBytes+=texture.data.byteLength*2;}
 if(!Number.isSafeInteger(stagingBytes)||stagingBytes>MAX_DOMAIN_RASTER_SCRATCH_BYTES)throw new Error('域着色 GPU 临时表示超过 8 MiB 预算');
 if(!Number.isSafeInteger(attachmentBytes)||attachmentBytes>MAX_DOMAIN_SOURCE_ATTACHMENT_BYTES)throw new Error('域着色 GPU 全图附件超过共享图像预算的两倍');
 const outputBytes=width*height*4,estimatedScratchBytes=attachmentBytes+stagingBytes;
 return{logicalWidth:target?.logicalWidth??width,logicalHeight:target?.logicalHeight??height,color,colorFallbackReason,nativeExecution,capture,tileWidth,tileHeight,estimatedNodeStepsPerDraw,estimatedScratchBytes,attachmentBytes,stagingBytes,outputBytes,estimatedTotalBytes:estimatedScratchBytes+outputBytes,vertexSource:source?domainSourceRasterVertex:domainRasterVertex,vertexCount:source?6:3};
}

/** Synchronous, exclusively leased context. All pass resources belong to this
 * request until release succeeds; failed cleanup stays with the context owner.
 * Only compiled programs belong to the caller's bounded cache. Final
 * RGBA is supplied by the caller and is never duplicated for CPU repairs. */
export function renderDomainRaster(gl:WebGL2RenderingContext,ownCleanup:(cleanup:()=>void)=>()=>void,getProgram:(fragment:string)=>DomainRasterProgram,orbit:DomainGpuSource,model:DomainModel,width:number,height:number,pixels:Uint8ClampedArray,repairPixel:DomainRepairPixel,isCancelled?:()=>boolean,prepared?:ReturnType<typeof prepareDomainRaster>):DomainRasterFacts{
 const cancelled=()=>{if(isCancelled?.())throw new DOMException('域着色计算已取消','AbortError');};cancelled();
 const {logicalWidth,logicalHeight,color,colorFallbackReason,nativeExecution,capture,tileWidth,tileHeight,estimatedNodeStepsPerDraw,estimatedScratchBytes,attachmentBytes,stagingBytes,outputBytes,estimatedTotalBytes,vertexCount}=prepared??prepareDomainRaster(model,width,height);
 if(pixels.length!==width*height*4)throw new Error('域着色 GPU 输出缓冲尺寸无效');
 if(orbit.parameters.length+32+color.uniforms.length>gpuCall('capability','域着色 GPU uniform 容量查询失败',()=>gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS)))throw new DomainGpuError('capability','域着色参数超过 GPU fragment uniform 容量');
 const maxTexture=gpuCall('capability','域着色 GPU 纹理容量查询失败',()=>gl.getParameter(gl.MAX_TEXTURE_SIZE)),units=gpuCall('capability','域着色 GPU 纹理单元查询失败',()=>gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)),sourceView=model.view.version==='mathart-1.7.8-gpu';
 if(sourceView){const limit=gpuCall('capability','域着色 GPU 视口容量查询失败',()=>gl.getParameter(gl.MAX_VIEWPORT_DIMS)) as Int32Array;if(width>limit[0]||height>limit[1])throw new DomainGpuError('capability','原产物 GPU 全图视口超过设备容量');}
 if(maxTexture<(sourceView?Math.max(width,height):Math.max(tileWidth,tileHeight))||color.textures.length>units||color.textures.some(t=>t.width>maxTexture||t.height>maxTexture))throw new DomainGpuError('capability','域着色 GPU 纹理容量不足');
 const textures:WebGLTexture[]=[],framebuffers:WebGLFramebuffer[]=[],vaos:WebGLVertexArrayObject[]=[];
 const release=ownCleanup(()=>{
  if(sourceView)gl.disable(gl.SCISSOR_TEST);gl.bindVertexArray(null);gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.useProgram(null);for(let i=0;i<color.textures.length;i++){gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,null);}gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,null);
  while(vaos.length){gl.deleteVertexArray(vaos[0]);vaos.shift();}while(framebuffers.length){gl.deleteFramebuffer(framebuffers[0]);framebuffers.shift();}while(textures.length){gl.deleteTexture(textures[0]);textures.shift();}
 });
 const facts:DomainRasterFacts={colorFallbackReason,tileWidth,tileHeight,estimatedNodeStepsPerDraw,...(nativeExecution?{valueCapturePasses:0,valueReadbackBytes:0,valueCaptureSamples:0}:{}),attachmentBytes,stagingBytes,outputBytes,estimatedTotalBytes,...(capture?{coordinatePasses:0,coordinateReadbackBytes:0}:{}),samples:width*height*model.supersampling**2,generated:0,invalid:0,invalidSamples:0,repaired:0,tiles:0,readbackBytes:0,estimatedScratchBytes};
 try{
  const fragment=domainRasterFragment(orbit,color,model.view,nativeExecution);
  // Source production is outside the GL boundary: emitter failures are not device failures.
  const p=getProgram(fragment);gpuCall('render','域着色 GPU 程序绑定失败',()=>gl.useProgram(p.program));
  const loc=(name:string)=>{if(!p.locations.has(name))p.locations.set(name,gpuCall('render','域着色 GPU uniform 查询失败',()=>gl.getUniformLocation(p.program,name)));return p.locations.get(name)!;};
  const background=model.background.map(v=>Math.round(v*255)/255);
  gpuCall('render','域着色 GPU uniform 上传失败',()=>{
  orbit.parameters.forEach((name,i)=>gl.uniform1f(loc('parameter'+i),model.parameters[name]));gl.uniform2f(loc('constantValue'),...model.constant);gl.uniform1i(loc('iterate'),model.iteration?1:0);gl.uniform1i(loc('iterationSteps'),model.steps);gl.uniform1i(loc('seedMode'),model.seed==='PIXEL_Z'?0:model.seed==='ZERO'?1:2);gl.uniform1f(loc('bailout'),model.bailout);
  gl.uniform2i(loc('fullSize'),width,height);gl.uniform2f(loc('sourceResolution'),logicalWidth,logicalHeight);gl.uniform1i(loc('sampleSide'),model.supersampling);gl.uniform2f(loc('viewCenter'),model.view.centerX,model.view.centerY);if(model.view.version==='mathart-1.7.8-gpu'){gl.uniform1f(loc('viewAngle'),model.view.angle);gl.uniform1f(loc('viewInverse'),model.view.inverseScale);}else{gl.uniform2f(loc('viewRotation'),Math.cos(model.view.rotation),Math.sin(model.view.rotation));gl.uniform1f(loc('viewZoom'),model.view.scale);}if(capture)gl.uniform1i(loc('coordinateSample'),-1);if(nativeExecution)gl.uniform1i(loc('captureKind'),0);gl.uniform3fv(loc('backgroundValue'),background);
  for(const u of color.uniforms){const location=loc(u.name);if(u.type==='1i')gl.uniform1i(location,u.value as number);else if(u.type==='1f')gl.uniform1f(location,u.value as number);else if(u.type==='2f')gl.uniform2fv(location,u.value as number[]);else if(u.type==='3f')gl.uniform3fv(location,u.value as number[]);else gl.uniform4fv(location,u.value as number[]);}
  });
  const texture=(w:number,h:number,internal:number,format:number,type:number,data:ArrayBufferView|null)=>{const t=gpuCall('allocation','域着色 GPU 纹理分配失败',()=>gl.createTexture());if(!t)throw new DomainGpuError('allocation','域着色 GPU 纹理分配失败');textures.push(t);gpuCall('allocation','域着色 GPU 纹理准备失败',()=>{gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,internal,w,h,0,format,type,data);});return t;};
  gpuCall('render','域着色 GPU 纹理单元绑定失败',()=>gl.activeTexture(gl.TEXTURE0));const textureWidth=sourceView?width:tileWidth,textureHeight=sourceView?height:tileHeight,rgba=texture(textureWidth,textureHeight,gl.RGBA8,gl.RGBA,gl.UNSIGNED_BYTE,null),metadata=texture(textureWidth,textureHeight,gl.RGBA8UI,gl.RGBA_INTEGER,gl.UNSIGNED_BYTE,null);
  color.textures.forEach((t,i)=>{gpuCall('render','域着色 GPU 纹理单元绑定失败',()=>gl.activeTexture(gl.TEXTURE0+i));texture(t.width,t.height,gl.RGBA32F,gl.RGBA,gl.FLOAT,t.data);gpuCall('render','域着色 GPU 色板绑定失败',()=>gl.uniform1i(loc(t.name),i));});
  const fbo=gpuCall('allocation','域着色 GPU framebuffer 分配失败',()=>gl.createFramebuffer());if(!fbo)throw new DomainGpuError('allocation','域着色 GPU framebuffer 分配失败');framebuffers.push(fbo);gpuCall('render','域着色 GPU framebuffer 绑定失败',()=>{gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,rgba,0);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT1,gl.TEXTURE_2D,metadata,0);gl.drawBuffers([gl.COLOR_ATTACHMENT0,gl.COLOR_ATTACHMENT1]);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new DomainGpuError('render','域着色 GPU framebuffer 不完整');});
  const vao=gpuCall('allocation','域着色 GPU VAO 分配失败',()=>gl.createVertexArray());if(!vao)throw new DomainGpuError('allocation','域着色 GPU VAO 分配失败');vaos.push(vao);gpuCall('render','域着色 GPU 光栅状态设置失败',()=>{gl.bindVertexArray(vao);gl.disable(gl.RASTERIZER_DISCARD);gl.disable(gl.BLEND);gl.disable(gl.DEPTH_TEST);gl.disable(gl.SCISSOR_TEST);gl.disable(gl.DITHER);gl.colorMask(true,true,true,true);gl.pixelStorei(gl.PACK_ALIGNMENT,1);});
  const rgbaRead=new Uint8Array(tileWidth*tileHeight*4),flagsRead=new Uint8Array(rgbaRead.length),samplesPerPixel=model.supersampling**2;
  const savedFacts=capture?new Uint8Array(flagsRead.length):undefined,coordinates=capture?new Float32Array(tileWidth*tileHeight*samplesPerPixel*2):undefined,coordinateBits=coordinates?new Uint32Array(coordinates.buffer):undefined,finalValues=nativeExecution?new Float32Array(tileWidth*tileHeight*samplesPerPixel*2):undefined,finalBits=finalValues?new Uint32Array(finalValues.buffer):undefined;
  const checkGl=()=>{if(gl.isContextLost())throw new DomainGpuError('context','域着色 GPU 上下文已丢失');const error=gl.getError();if(error!==gl.NO_ERROR)throw new DomainGpuError('readback','域着色 GPU 光栅执行失败 ('+error+')');};
  for(let top=0;top<height;top+=tileHeight)for(let left=0;left<width;left+=tileWidth){
   cancelled();const w=Math.min(tileWidth,width-left),h=Math.min(tileHeight,height-top);gpuCall('render','域着色 GPU 光栅执行失败',()=>{if(sourceView){gl.viewport(0,0,width,height);gl.enable(gl.SCISSOR_TEST);gl.scissor(left,height-top-h,w,h);}else gl.viewport(0,0,w,h);if(capture)gl.uniform1i(loc('coordinateSample'),-1);gl.uniform2i(loc('tileOrigin'),left,top);gl.uniform1i(loc('tileHeight'),h);gl.drawArrays(gl.TRIANGLES,0,vertexCount);});cancelled();
   gpuCall('readback','域着色 GPU 光栅读回失败',()=>{gl.readBuffer(gl.COLOR_ATTACHMENT0);gl.readPixels(sourceView?left:0,sourceView?height-top-h:0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,rgbaRead);gl.readBuffer(gl.COLOR_ATTACHMENT1);gl.readPixels(sourceView?left:0,sourceView?height-top-h:0,w,h,gl.RGBA_INTEGER,gl.UNSIGNED_BYTE,flagsRead);checkGl();});
   facts.tiles++;facts.readbackBytes+=w*h*8;
   for(let y=0;y<h;y++)pixels.set(rgbaRead.subarray((h-1-y)*w*4,(h-y)*w*4),((top+y)*width+left)*4);
   let tileFacts=flagsRead;
   if(capture){
    let needsCoordinates=false;for(let i=0;i<w*h;i++){if(flagsRead[i*4]>samplesPerPixel||flagsRead[i*4+1]>1)throw new DomainGpuError('render','域着色 GPU 像素状态无效');if(flagsRead[i*4+1])needsCoordinates=true;}
    if(needsCoordinates){
     savedFacts!.set(flagsRead.subarray(0,w*h*4));tileFacts=savedFacts!;
     for(let mode=0;mode<(nativeExecution?2:1);mode++)for(let sample=0;sample<samplesPerPixel;sample++){
      cancelled();gpuCall('render','域着色 GPU 捕获执行失败',()=>{if(nativeExecution)gl.uniform1i(loc('captureKind'),mode);gl.uniform1i(loc('coordinateSample'),sample);gl.drawArrays(gl.TRIANGLES,0,vertexCount);});cancelled();
      gpuCall('readback','域着色 GPU 捕获读回失败',()=>{gl.readBuffer(gl.COLOR_ATTACHMENT0);gl.readPixels(sourceView?left:0,sourceView?height-top-h:0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,rgbaRead);gl.readBuffer(gl.COLOR_ATTACHMENT1);gl.readPixels(sourceView?left:0,sourceView?height-top-h:0,w,h,gl.RGBA_INTEGER,gl.UNSIGNED_BYTE,flagsRead);checkGl();});
      if(mode===0){facts.coordinatePasses!++;facts.coordinateReadbackBytes!+=w*h*8;}else{facts.valueCapturePasses!++;facts.valueReadbackBytes!+=w*h*8;facts.valueCaptureSamples!+=w*h;}facts.readbackBytes+=w*h*8;
      for(let y=0;y<h;y++)for(let x=0;x<w;x++){
       const from=((h-1-y)*w+x)*4;if(!tileFacts[from+1])continue;const to=((y*w+x)*samplesPerPixel+sample)*2;
       (mode===0?coordinateBits!:finalBits!)[to]=(rgbaRead[from]|rgbaRead[from+1]<<8|rgbaRead[from+2]<<16|rgbaRead[from+3]<<24)>>>0;
       (mode===0?coordinateBits!:finalBits!)[to+1]=(flagsRead[from]|flagsRead[from+1]<<8|flagsRead[from+2]<<16|flagsRead[from+3]<<24)>>>0;
      }
     }
    }
   }
   for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const from=((h-1-y)*w+x)*4,index=(top+y)*width+left+x;let valid=tileFacts[from];
    if(valid>samplesPerPixel||tileFacts[from+1]>1)throw new DomainGpuError('render','域着色 GPU 像素状态无效');
    if(tileFacts[from+1]){if((x&31)===0)cancelled();valid=repairPixel(index,coordinates?nativeExecution?{kind:'native-gpu-result',values:coordinates,offset:(y*w+x)*samplesPerPixel*2,finalValues:finalValues!,valueOffset:(y*w+x)*samplesPerPixel*2}:{values:coordinates,offset:(y*w+x)*samplesPerPixel*2}:undefined);facts.repaired+=samplesPerPixel;}
    facts.invalidSamples+=samplesPerPixel-valid;if(valid)facts.generated++;else facts.invalid++;
   }
  }
  cancelled();return facts;
 }finally{release();}
}
