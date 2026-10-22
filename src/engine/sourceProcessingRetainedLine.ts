/** PShapeOpenGL's retained LINES store world vertices and their raw F32
 * differences. Shape.matrix is null for ImplicitSurface contours, so its
 * tessellator transformScale is 1. The display modelview belongs to the shader,
 * unlike Processing's immediate flush which pretransforms vertices on CPU. */
export interface SourceProcessingRetainedLineInput {
 readonly positions:Float32Array;readonly lineWidth:number;
 readonly indices?:Uint32Array;readonly isCancelled?:()=>boolean;
 /** Retained RGBA source views, charged by backing-store identity. */
 readonly colorBuffers?:readonly Float32Array[];
}
const F=Math.fround,MAX_BYTES=256*1024*1024;
export function sourceProcessingRetainedLineInstances(input:SourceProcessingRetainedLineInput){
 const {positions:xyz,lineWidth,indices,isCancelled}=input;
 const check=()=>{if(isCancelled?.())throw new DOMException('源 retained 线条展开已取消','AbortError');};check();
 if(!(xyz instanceof Float32Array)||xyz.length%3||indices!==undefined&&!(indices instanceof Uint32Array)||!Number.isFinite(F(lineWidth))||lineWidth<=0)throw Error('源 retained 线条输入无效');
 const count=indices?indices.length/2:xyz.length/6;
 // Two endpoint/direction/RGBA vec4 streams plus the shared four-vertex quad.
 // Include retained input backing buffers before any output allocation.
 const colorBuffers=input.colorBuffers??[];if(colorBuffers.some(a=>!(a instanceof Float32Array)))throw Error('源 retained 线条颜色缓冲无效');
 const retained=new Set<ArrayBufferLike>([xyz.buffer,...(indices?[indices.buffer]:[]),...colorBuffers.map(a=>a.buffer)]),bytes=Array.from(retained).reduce((n,b)=>n+b.byteLength,0)+count*96+40;
 if(!Number.isSafeInteger(count)||!Number.isSafeInteger(bytes)||bytes>MAX_BYTES)throw Error('源 retained 线条缓冲超过 256 MiB 容量或端点计数无效');
 if(indices)for(let i=0;i<indices.length;i++){if((i&2047)===0)check();if(indices[i]>=xyz.length/3)throw Error('源 retained 线条索引越界');}
 const positions=new Float32Array(count*8),directions=new Float32Array(count*8),half=F(F(lineWidth)/2);
 for(let pair=0;pair<count;pair++){
  if((pair&1023)===0)check();
  const a=(indices?indices[pair*2]:pair*2)*3,b=(indices?indices[pair*2+1]:pair*2+1)*3,o=pair*8;
  for(let axis=0;axis<3;axis++){
   positions[o+axis]=xyz[a+axis];positions[o+4+axis]=xyz[b+axis];
   directions[o+axis]=F(xyz[b+axis]-xyz[a+axis]);directions[o+4+axis]=F(xyz[a+axis]-xyz[b+axis]);
  }
  positions[o+3]=positions[o+7]=1;directions[o+3]=directions[o+7]=half;
 }
 check();return{positions,directions,count};
}
