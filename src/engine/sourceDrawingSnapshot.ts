import * as THREE from 'three';
import {sourceTextureUsesMaximumAnisotropy} from './sourceProcessingTextureSampling';
import {sourceShaderUniformOwner,sourceShaderDrawContract,type SourceShaderUniform} from './sourceShaderMaterial';
import {SOURCE_DRAWING_DEFAULT_CHUNK_BYTES,SOURCE_DRAWING_MAX_CHUNK_BYTES,sourceDrawingChunkAvailableBytes,sourceDrawingChunkPeak} from './sourceDrawingBudget';

export interface SourceDrawingError {
  kind:'input'|'unsupported'|'capacity'|'cancelled';
  path:readonly string[];
  reason:string;
}
export type SourceDrawingResult<T>={ok:true;value:T}|{ok:false;error:SourceDrawingError};
export type SourceNumericUniformKind=Exclude<SourceShaderUniform['kind'],'sampler2d'>;
export type SourceDrawingUniform=
  | {name:string;kind:SourceNumericUniformKind;count:number;values:Float32Array|Int32Array}
  | {name:string;kind:'sampler2d';texture:number};
export interface SourceDrawingTexture {
  width:number;height:number;pixels:Uint8Array;anisotropy:number|'maximum';
  magFilter:'linear';minFilter:'linear-mipmap-linear';wrap:'clamp';generateMipmaps:true;
}
export interface SourceDrawingCommand {
  primitive:'triangles'|'points';
  /** Only wire v4 can draw from the separately owned Bouncing state texture. */
  retainedBouncingState?:true;
  vertexShader:string;fragmentShader:string;
  attributes:readonly {name:string;size:number;divisor:0|1;values:Float32Array}[];
  index?:Uint16Array|Uint32Array;
  first:number;count:number;instances:number;
  uniforms:readonly SourceDrawingUniform[];
  depthTest:boolean;depthWrite:boolean;depthFunction:'less-equal';
  frontFace:'clockwise'|'counter-clockwise';
  /** Each pass selects the visible faces, preserving Three's double pass. */
  passes:readonly ('front'|'back'|'both')[];
  blend:'source-alpha-over-additive-alpha'|'source-alpha-over';
}
export interface SourceDrawingSnapshot {
  model:'source-drawing-v1';
  commands:readonly SourceDrawingCommand[];
  textures:readonly SourceDrawingTexture[];
  copiedBufferBytes:number;
  retainedBufferBytes:number;
  admittedBytes:number;
}
const MAX_BYTES=256*1024*1024,MAX_GLSIZE=0x7fffffff;
class BoundaryFailure extends Error {
  constructor(readonly detail:SourceDrawingError){super(detail.reason);}
}
function fail(kind:SourceDrawingError['kind'],path:readonly string[],reason:string):never {
  throw new BoundaryFailure({kind,path,reason});
}
function requireValue(value:unknown,path:readonly string[],reason:string):asserts value {
  if(!value)fail('input',path,reason);
}
const integer=(n:number)=>Number.isSafeInteger(n)&&n>=0&&n<=MAX_GLSIZE;

/** One interpretation owns both full snapshots and bounded plans. Validation
 * walks the entire ordered frame before either adapter allocates packed data. */
function prepareDrawings(meshes:readonly THREE.Mesh[],options:{isCancelled?:()=>boolean}={}) {
  let admittedBytes=0,retainedBufferBytes=0,fullCopyBytes=0;
  const retained=new Set<ArrayBufferLike>(),textures=new Map<THREE.DataTexture,number>();
  const pendingTextures:THREE.DataTexture[]=[];
  const check=()=>{if(options.isCancelled?.())fail('cancelled',[],'绘制快照已取消');};
  const charge=(bytes:number,path:readonly string[])=>{
    requireValue(Number.isSafeInteger(bytes)&&bytes>=0,path,'绘制缓冲尺寸无效');
    admittedBytes+=bytes;
  };
  const copyCharge=(bytes:number,path:readonly string[])=>{charge(bytes,path);fullCopyBytes+=bytes;};
  const retain=(buffer:ArrayBufferLike,path:readonly string[])=>{
    if(!(buffer instanceof ArrayBuffer))fail('unsupported',path,'不支持并发可变共享缓冲快照');
    try{new Uint8Array(buffer,0,0);}catch{fail('input',path,'源绘制缓冲已转移');}
    if(!retained.has(buffer)){charge(buffer.byteLength,path);retained.add(buffer);retainedBufferBytes+=buffer.byteLength;}
  };
    check();
    // Two phases: validate and admit every draw before allocating packed arrays.
    const prepared=meshes.flatMap((mesh,number)=>{
      check();const path=[String(number)];
      if(!mesh.visible)return[];
      if(Array.isArray(mesh.material)||!(mesh.material instanceof THREE.RawShaderMaterial))fail('unsupported',path,'绘制需要一个已声明的源着色器材质');
      if(mesh instanceof THREE.InstancedMesh||mesh instanceof THREE.SkinnedMesh)fail('unsupported',path,'额外实例矩阵或骨骼尚未支持');
      const material=mesh.material,bindings=sourceShaderUniformOwner(material);
      if(material.onBeforeCompile!==THREE.Material.prototype.onBeforeCompile||mesh.onBeforeRender!==THREE.Object3D.prototype.onBeforeRender)fail('unsupported',path,'自定义绘制或着色器回调尚未支持');
      if(!bindings||material.uniforms!==bindings)fail('unsupported',path,'源材质类型声明缺失、已释放或被替换');
      if(material.glslVersion!==THREE.GLSL3||Object.keys(material.defines??{}).length||material.toneMapped||material.wireframe||material.polygonOffset||material.stencilWrite||!material.colorWrite||material.alphaTest!==0||material.alphaHash||material.alphaToCoverage||material.premultipliedAlpha||material.clippingPlanes?.length||material.lights)
        fail('unsupported',path,'源绘制包含尚未支持的着色器或光栅状态');
      if(material.depthFunc!==THREE.LessEqualDepth||material.blending!==THREE.CustomBlending||!material.transparent||material.blendEquation!==THREE.AddEquation||material.blendEquationAlpha!==THREE.AddEquation||material.blendSrc!==THREE.SrcAlphaFactor||material.blendDst!==THREE.OneMinusSrcAlphaFactor||material.blendSrcAlpha!==THREE.OneFactor||material.blendDstAlpha!==THREE.OneFactor)
        fail('unsupported',path,'源绘制的深度或混合状态尚未支持');
      const passes:('front'|'back'|'both')[]=material.side===THREE.DoubleSide?(material.forceSinglePass?['both']:['back','front']):material.side===THREE.FrontSide?['front']:['back'];
      charge((material.vertexShader.length+material.fragmentShader.length)*3+256,path);
      const geometry=mesh.geometry;
      if(geometry.groups.length||Object.keys(geometry.morphAttributes).length)fail('unsupported',path,'源绘制不支持分组或形变属性');
      const instances=geometry instanceof THREE.InstancedBufferGeometry?geometry.instanceCount:1;
      requireValue(integer(instances),path,'实例数必须是有限 GLsizei');
      let vertices=Infinity;
      const attributes=Object.entries(geometry.attributes).map(([name,attribute])=>{
        const p=[...path,'attributes',name];
        if(!/^[A-Za-z_]\w*$/.test(name))fail('input',p,'属性名称无效');
        if(attribute instanceof THREE.Float16BufferAttribute||('gpuType' in attribute&&attribute.gpuType!==THREE.FloatType))fail('unsupported',p,'半精度或整数着色器属性尚未支持');
        const interleaved=attribute instanceof THREE.InterleavedBufferAttribute;
        if(interleaved)requireValue(integer(attribute.offset)&&integer(attribute.data.stride)&&attribute.data.stride>0&&attribute.offset+attribute.itemSize<=attribute.data.stride&&attribute.data.array.length%attribute.data.stride===0,p,'交错属性布局无效');
        const storage=interleaved?attribute.data:attribute;
        if(storage.array instanceof Float64Array)fail('unsupported',p,'WebGL 源属性不支持 float64 缓冲');
        const instance=storage instanceof THREE.InstancedInterleavedBuffer||storage instanceof THREE.InstancedBufferAttribute;
        if(instance&&storage.meshPerAttribute!==1)fail('unsupported',p,'实例步进必须为 1');
        requireValue(integer(attribute.count)&&Number.isInteger(attribute.itemSize)&&attribute.itemSize>=1&&attribute.itemSize<=4,p,'属性尺寸无效');
        if(instance)requireValue(attribute.count>=instances,p,'实例属性短于实例数');
        else vertices=Math.min(vertices,attribute.count);
        retain(storage.array.buffer,p);
        copyCharge(attribute.count*attribute.itemSize*4,p);charge(96+name.length*3,p);
        return{name,attribute,divisor:instance?1 as const:0 as const};
      });
      requireValue(Number.isFinite(vertices),path,'绘制缺少逐顶点属性');
      if(geometry.index)requireValue(geometry.index.itemSize===1&&!geometry.index.normalized,path,'索引布局无效');
      const index=geometry.index?.array;
      if(index&&!(index instanceof Uint16Array)&&!(index instanceof Uint32Array))fail('unsupported',path,'索引必须为 uint16 或 uint32');
      if(index){retain(index.buffer,path);copyCharge(index.byteLength,path);}
      const available=index?.length??vertices,first=geometry.drawRange.start,count=geometry.drawRange.count===Infinity?available-first:geometry.drawRange.count;
      requireValue(integer(first)&&integer(count)&&first<=available&&count<=available-first&&count%3===0,path,'三角形绘制范围无效');
      if(index)for(let i=first;i<first+count;i++){if((i&4095)===0)check();requireValue(index[i]<vertices,path,'绘制索引超出属性范围');}
      const uniforms=Object.entries(bindings).map(([name,uniform])=>{
        const p=[...path,'uniforms',name];
        requireValue(/^[A-Za-z_]\w*$/.test(name),p,'参数名称无效');charge(96+name.length*3,p);
        if(uniform.kind==='sampler2d'){
          const texture=uniform.value;
          if(!(texture instanceof THREE.DataTexture)||texture.type!==THREE.UnsignedByteType||texture.format!==THREE.RGBAFormat||texture.colorSpace!==THREE.NoColorSpace||texture.flipY||texture.premultiplyAlpha||texture.wrapS!==THREE.ClampToEdgeWrapping||texture.wrapT!==THREE.ClampToEdgeWrapping||texture.magFilter!==THREE.LinearFilter||texture.minFilter!==THREE.LinearMipmapLinearFilter||!texture.generateMipmaps||texture.mipmaps.length)
            fail('unsupported',p,'纹理格式或采样状态尚未支持');
          const {width,height,data}=texture.image;
          requireValue(integer(width)&&integer(height)&&width>0&&height>0&&Number.isFinite(texture.anisotropy)&&texture.anisotropy>=1,p,'纹理尺寸或过滤值无效');
          requireValue(data instanceof Uint8Array||data instanceof Uint8ClampedArray,p,'纹理必须为 RGBA8');
          requireValue(Number.isSafeInteger(width*height*4)&&data.byteLength===width*height*4,p,'纹理缓冲与尺寸不匹配');
          if(!textures.has(texture)){retain(data.buffer,p);copyCharge(data.byteLength,p);charge(128,p);textures.set(texture,pendingTextures.length);pendingTextures.push(texture);}
          return{name,uniform};
        }
        const values=uniformComponents(uniform),count=uniform.kind==='float-array'||uniform.kind==='vec3-array'?uniform.count:1;
        const expected=uniform.kind==='vec3-array'?count*3:uniform.kind==='mat4'?16:uniform.kind==='vec4'?4:uniform.kind==='vec3'?3:uniform.kind==='vec2'||uniform.kind==='ivec2'?2:uniform.kind==='float-array'?count:1;
        requireValue(integer(count)&&count>0&&values.length===expected,p,'参数分量数量与声明不一致');
        if(ArrayBuffer.isView(values))retain(values.buffer,p);
        copyCharge(values.length*4,p);
        const integral=uniform.kind==='int'||uniform.kind==='ivec2';
        for(let i=0;i<values.length;i++){
          if((i&4095)===0)check();const n=values[i];
          requireValue(typeof n==='number'&&(integral?Number.isInteger(n)&&n>=-2147483648&&n<=2147483647:Number.isFinite(Math.fround(n))),p,'参数超出声明的数值范围');
        }
        return{name,uniform,values,count,integral};
      });
      return[{material,rangeIdentity:sourceShaderDrawContract(material)?.rangeIdentity,attributes,index,first,count,instances,uniforms,passes,frontFace:mesh.matrixWorld.determinant()<0?'clockwise' as const:'counter-clockwise' as const}];
    });
    check();return{prepared,pendingTextures,textures,admittedBytes,retainedBufferBytes,fullCopyBytes,metadataBytes:admittedBytes-retainedBufferBytes-fullCopyBytes,buffers:[...retained] as ArrayBuffer[],check};
}
type PreparedDrawings=ReturnType<typeof prepareDrawings>;
type PreparedDraw=PreparedDrawings['prepared'][number];
function capacity(bytes:number,limit:number){if(!Number.isSafeInteger(bytes)||bytes>limit)fail('capacity',[],'绘制快照和保留缓冲超过本地预算');}
function budget(value:number){requireValue(Number.isSafeInteger(value)&&value>0&&value<=MAX_BYTES,['maxBytes'],'快照预算必须在 1 至 256 MiB 内');}
function result<T>(run:()=>T):SourceDrawingResult<T>{try{return{ok:true,value:run()};}catch(error){if(error instanceof BoundaryFailure)return{ok:false,error:error.detail};throw error;}}
function textureCopies(p:PreparedDrawings):SourceDrawingTexture[]{return p.pendingTextures.map(texture=>{
 p.check();const {width,height,data}=texture.image,pixels=new Uint8Array(data.byteLength);
 for(let i=0;i<pixels.length;i+=65536){p.check();pixels.set((data as Uint8Array).subarray(i,i+65536),i);}
 return{width,height,pixels,anisotropy:sourceTextureUsesMaximumAnisotropy(texture)?'maximum':texture.anisotropy,magFilter:'linear',minFilter:'linear-mipmap-linear',wrap:'clamp',generateMipmaps:true};
});}
function uniformCopies(p:PreparedDrawings,draw:PreparedDraw):SourceDrawingUniform[]{return draw.uniforms.map(u=>{
 if(u.uniform.kind==='sampler2d')return{name:u.name,kind:'sampler2d',texture:p.textures.get(u.uniform.value)!};
 const values=u.integral?new Int32Array(u.values!):new Float32Array(u.values!);p.check();
 return{name:u.name,kind:u.uniform.kind,count:u.count!,values};
});}
function command(draw:PreparedDraw,attributes:SourceDrawingCommand['attributes'],index:SourceDrawingCommand['index'],uniforms:SourceDrawingUniform[]):SourceDrawingCommand {
 return{primitive:'triangles',vertexShader:draw.material.vertexShader,fragmentShader:draw.material.fragmentShader,attributes,index,first:draw.first,count:draw.count,instances:draw.instances,uniforms,depthTest:draw.material.depthTest,depthWrite:draw.material.depthWrite,depthFunction:'less-equal',frontFace:draw.frontFace,passes:draw.passes,blend:'source-alpha-over-additive-alpha'};
}
function attributeCopy(entry:PreparedDraw['attributes'][number],count:number,sourceIndex:(i:number)=>number,check:()=>void):SourceDrawingCommand['attributes'][number]{
 const {name,attribute,divisor}=entry,values=new Float32Array(count*attribute.itemSize),interleaved=attribute instanceof THREE.InterleavedBufferAttribute;
 const input=interleaved?attribute.data.array:attribute.array;
 // Preserve every Float32 word, including NaN payloads, infinities and -0.
 const words=input instanceof Float32Array?new Uint32Array(input.buffer,input.byteOffset,input.length):undefined,outputWords=new Uint32Array(values.buffer);
 const stride=interleaved?attribute.data.stride:attribute.itemSize,offset=interleaved?attribute.offset:0;
 for(let i=0;i<count;i++){if((i&4095)===0)check();const source=sourceIndex(i);for(let k=0;k<attribute.itemSize;k++){
  const target=i*attribute.itemSize+k;if(words)outputWords[target]=words[source*stride+offset+k];else values[target]=attribute.getComponent(source,k);
 }}check();return{name,size:attribute.itemSize,divisor,values};
}
/** Complete owned snapshot for existing callers; it consumes the same parsed
 * facts as the bounded adapter and preserves its original packing exactly. */
export function snapshotSourceDrawings(meshes:readonly THREE.Mesh[],options:{maxBytes?:number;isCancelled?:()=>boolean}={}):SourceDrawingResult<SourceDrawingSnapshot>{return result(()=>{
 const limit=options.maxBytes??MAX_BYTES;budget(limit);const p=prepareDrawings(meshes,options);capacity(p.admittedBytes,limit);
 const textures=textureCopies(p),commands=p.prepared.map(draw=>command(draw,draw.attributes.map(a=>attributeCopy(a,a.attribute.count,i=>i,p.check)),draw.index?.slice(),uniformCopies(p,draw)));
 p.check();return{model:'source-drawing-v1',commands,textures,copiedBufferBytes:p.fullCopyBytes,retainedBufferBytes:p.retainedBufferBytes,admittedBytes:p.admittedBytes};
});}

export type SourceDrawingRangeKind='instances'|'vertices'|'draw';
export interface SourceDrawingSchedule {
 readonly commandIndex:number;readonly primitive:'triangles';readonly rangeKind:SourceDrawingRangeKind;
 readonly total:number;readonly passes:readonly ('front'|'back'|'both')[];
 readonly chunksPerPass:number;readonly rangeSize:number;
}
export interface SourceDrawingChunk {
 readonly ordinal:number;readonly commandIndex:number;readonly passIndex:number;
 readonly rangeKind:SourceDrawingRangeKind;readonly offset:number;readonly count:number;readonly total:number;
 /** Immutable frame declarations are shared; only this range's attributes and
  * indices are newly owned. Do not retain drawing after release succeeds. */
 readonly drawing:SourceDrawingSnapshot;
 release():SourceDrawingResult<void>;
}
export interface SourceDrawingPlan {
 readonly chunkCount:number;readonly maxChunkBytes:number;
 readonly retainedBufferBytes:number;readonly retainedBytes:number;
 readonly admittedMetadataBytes:number;readonly peakBytes:number;
 readonly schedule:readonly SourceDrawingSchedule[];
 next():SourceDrawingResult<SourceDrawingChunk|undefined>;
 /** An in-flight chunk must be acknowledged/released even after cancellation.
  * A failed disposal keeps its borrowed storage, allowing that cleanup retry. */
 dispose():SourceDrawingResult<void>;
}
export interface SourceDrawingPlanOptions {
 /** maxChunkBytes is a ceiling; joint admission may select smaller complete ranges. */
 maxBytes?:number;maxChunkBytes?:number;
 retainedBuffers?:readonly ArrayBuffer[];additionalBytes?:number;frameBytes?:number;
 isCancelled?:()=>boolean;isCurrent?:()=>boolean;
}

/** Bounded native frame producer. Full validation/admission precedes all packed
 * copies. Mesh → pass → range order is fixed, so two-sided blending is never
 * interleaved across chunks. Only a producer-declared attribute identity allows
 * range rebasing; arbitrary GLSL is not inferred from names or text searches. */
export function prepareSourceDrawingPlan(meshes:readonly THREE.Mesh[],options:SourceDrawingPlanOptions={}):SourceDrawingResult<SourceDrawingPlan>{return result(()=>{
 const limit=options.maxBytes??MAX_BYTES,chunkLimit=options.maxChunkBytes??SOURCE_DRAWING_DEFAULT_CHUNK_BYTES;budget(limit);
 requireValue(Number.isSafeInteger(chunkLimit)&&chunkLimit>0&&chunkLimit<=SOURCE_DRAWING_MAX_CHUNK_BYTES,['maxChunkBytes'],'分块上限必须为 1 字节至 4 MiB 的整数');
 const check=()=>{if(options.isCancelled?.()||options.isCurrent?.()===false)fail('cancelled',[],'绘制计划已取消或所属渲染帧已改变');};check();
 let p:PreparedDrawings|undefined=prepareDrawings(meshes,{isCancelled:()=>{check();return false;}});
 const buffers=new Set(p.buffers);
 for(const buffer of options.retainedBuffers??[]){requireValue(buffer instanceof ArrayBuffer,['retainedBuffers'],'保留缓冲必须是非共享 ArrayBuffer');try{new Uint8Array(buffer,0,0);}catch{fail('input',['retainedBuffers'],'保留缓冲已转移');}buffers.add(buffer);}
 const additionalBytes=options.additionalBytes??0,frameBytes=options.frameBytes??0;
 requireValue(Number.isSafeInteger(additionalBytes)&&additionalBytes>=0&&Number.isSafeInteger(frameBytes)&&frameBytes>=0,['bytes'],'额外留存及帧存储容量无效');
 const retainedBytes=[...buffers].reduce((sum,buffer)=>sum+buffer.byteLength,additionalBytes),retainedBufferBytes=p.retainedBufferBytes;
 buffers.clear();
 const sourceStorage=p.buffers.map(buffer=>({buffer,bytes:buffer.byteLength}));
 const checkStorage=()=>{check();for(const {buffer,bytes}of sourceStorage){requireValue(buffer.byteLength===bytes,[],'源绘制缓冲在计划期间改变');try{new Uint8Array(buffer,0,0);}catch{fail('input',[],'源绘制缓冲在计划期间转移');}}};
 const fixedCopies=p.pendingTextures.reduce((sum,t)=>sum+t.image.data.byteLength,0)+p.prepared.reduce((sum,d)=>sum+d.uniforms.reduce((n,u)=>n+(u.values?.length??0)*4,0),0);
 const admittedMetadataBytes=p.metadataBytes+fixedCopies;
 // Admit immutable declarations, all borrowed storage and the full-sized
 // target first. Only transport granularity adapts to the remaining budget;
 // no primitive, pass or pixel is omitted and no packed copy exists yet.
 const fixedBudget={retainedBytes,frameBytes,metadataBytes:admittedMetadataBytes,scheduleCount:p.prepared.length};
 capacity(sourceDrawingChunkPeak({...fixedBudget,maxChunkBytes:0}),limit);
 const availableChunkBytes=Math.min(chunkLimit,sourceDrawingChunkAvailableBytes(fixedBudget,limit));
 // This bound includes conservative UTF-8 names/shaders, block headers and
 // the complete fixed frame declarations even when a transport sends them once.
 const wireFixed=admittedMetadataBytes+256,payloadLimit=availableChunkBytes-wireFixed;
 if(payloadLimit<0)fail('capacity',[],'完整帧声明超过分块传输上限');
 let maxPayload=0,chunkCount=0;
 const schedule:SourceDrawingSchedule[]=p.prepared.map((draw,commandIndex)=>{
  const attributes=draw.attributes,whole=attributes.reduce((sum,a)=>sum+a.attribute.count*a.attribute.itemSize*4,draw.index?.byteLength??0);
  const perInstance=attributes.filter(a=>a.divisor===1).reduce((sum,a)=>sum+a.attribute.itemSize*4,0);
  let rangeKind:SourceDrawingRangeKind='draw',total=draw.count&&draw.instances?1:0,rangeSize=1,payload=whole;
  if(draw.rangeIdentity==='attribute-only'&&perInstance){
   rangeKind='instances';total=draw.count?draw.instances:0;
   const fixed=attributes.filter(a=>a.divisor===0).reduce((sum,a)=>sum+a.attribute.count*a.attribute.itemSize*4,draw.index?.byteLength??0);
   rangeSize=Math.floor((payloadLimit-fixed)/perInstance);
   if(total&&rangeSize<1)fail('capacity',[String(commandIndex)],'单个实例及共享拓扑超过分块容量');
   rangeSize=Math.max(1,Math.min(Math.max(1,total),rangeSize));payload=fixed+Math.min(total,rangeSize)*perInstance;
  }else if(whole>payloadLimit){
   if(draw.rangeIdentity!=='attribute-only')fail('unsupported',[String(commandIndex)],'着色器未声明可重基的属性身份，不能分块该绘制');
   if(draw.instances!==1||perInstance)fail('unsupported',[String(commandIndex)],'多维实例与顶点分块尚未支持');
   rangeKind='vertices';total=draw.count;
   const perVertex=attributes.reduce((sum,a)=>sum+a.attribute.itemSize*4,0);
   rangeSize=Math.floor(payloadLimit/perVertex/3)*3;
   if(total&&rangeSize<3)fail('capacity',[String(commandIndex)],'单个三角形超过分块容量');
   rangeSize=Math.max(3,Math.min(Math.max(3,total),rangeSize));payload=Math.min(total,rangeSize)*perVertex;
  }
  if(total)maxPayload=Math.max(maxPayload,payload);
  const chunksPerPass=total?Math.ceil(total/rangeSize):0;chunkCount+=chunksPerPass*draw.passes.length;
  return Object.freeze({commandIndex,primitive:'triangles' as const,rangeKind,total,passes:Object.freeze([...draw.passes]),chunksPerPass,rangeSize});
 });
 const maxChunkBytes=wireFixed+maxPayload;
 // Source buffers and mathematical output are deduplicated by backing storage.
 // One packed chunk plus the shared transport/receiver copy bound coexist.
 // frameBytes comes from the actual target/sample count, never a lowered mode.
 const peakBytes=sourceDrawingChunkPeak({retainedBytes,frameBytes,metadataBytes:admittedMetadataBytes,scheduleCount:schedule.length,maxChunkBytes});
 capacity(peakBytes,limit);requireValue(Number.isSafeInteger(chunkCount)&&chunkCount<=0xffffffff,['chunks'],'绘制分块数量超出 uint32');check();
 let textures:readonly SourceDrawingTexture[]=textureCopies(p);
 let templates:readonly SourceDrawingCommand[]=p.prepared.map(d=>command(d,[],undefined,uniformCopies(p!,d)));
 let active:SourceDrawingChunk|undefined,closed=false,ordinal=0,commandIndex=0,passIndex=0,offset=0;
 const clear=()=>{p=undefined;textures=[];templates=[];sourceStorage.length=0;};
 const plan:SourceDrawingPlan={chunkCount,maxChunkBytes,retainedBufferBytes,retainedBytes,admittedMetadataBytes,peakBytes,schedule:Object.freeze(schedule),
  next:()=>result(()=>{
   requireValue(!closed,[],'绘制计划已释放');requireValue(!active,[],'前一绘制分块尚未确认释放');checkStorage();
   while(commandIndex<schedule.length&&schedule[commandIndex].total===0)commandIndex++;
   if(commandIndex===schedule.length)return;
   const row=schedule[commandIndex],draw=p!.prepared[commandIndex],count=Math.min(row.rangeSize,row.total-offset),at=offset,whichCommand=commandIndex,whichPass=passIndex;
   const attributes=draw.attributes.map(a=>row.rangeKind==='vertices'
    ?attributeCopy(a,count,i=>draw.index?draw.index[draw.first+at+i]:draw.first+at+i,check)
    :attributeCopy(a,row.rangeKind==='instances'&&a.divisor?count:a.attribute.count,i=>row.rangeKind==='instances'&&a.divisor?at+i:i,check));
   const index=row.rangeKind==='vertices'?undefined:draw.index?.slice();
   const copiedBufferBytes=fixedCopies+attributes.reduce((sum,a)=>sum+a.values.byteLength,index?.byteLength??0);
   const chunkCommand:SourceDrawingCommand={...templates[commandIndex],attributes,index,passes:[row.passes[passIndex]],...(row.rangeKind==='vertices'?{first:0,count,instances:1}:row.rangeKind==='instances'?{instances:count}:{})};
   let drawing:SourceDrawingSnapshot|undefined={model:'source-drawing-v1',commands:[chunkCommand],textures,copiedBufferBytes,retainedBufferBytes,admittedBytes:retainedBufferBytes+admittedMetadataBytes+copiedBufferBytes-fixedCopies};
   checkStorage();const chunk:SourceDrawingChunk={ordinal:ordinal++,commandIndex:whichCommand,passIndex:whichPass,rangeKind:row.rangeKind,offset:at,count,total:row.total,
    get drawing(){requireValue(drawing,[],'绘制分块已释放');return drawing;},
    release:()=>result(()=>{requireValue(active===chunk,[],'绘制分块不属于当前未确认请求');drawing=undefined;active=undefined;if(closed)clear();}),
   };active=chunk;
   offset+=count;if(offset===row.total){offset=0;passIndex++;if(passIndex===row.passes.length){passIndex=0;commandIndex++;}}
   return chunk;
  }),
  dispose:()=>result(()=>{closed=true;requireValue(!active,[],'未确认绘制分块仍由计划持有，请在请求结束后释放');clear();}),
 };return plan;
});}

function uniformComponents(uniform:Exclude<SourceShaderUniform,{kind:'sampler2d'}>):ArrayLike<number> {
  switch(uniform.kind){
    case 'float':case 'int':return[uniform.value];
    case 'mat4':return uniform.value.elements;
    case 'float-array':case 'vec3-array':return uniform.value;
    default:return uniform.value instanceof THREE.Vector2||uniform.value instanceof THREE.Vector3||uniform.value instanceof THREE.Vector4?uniform.value.toArray():uniform.value;
  }
}
