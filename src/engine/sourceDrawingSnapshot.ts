import * as THREE from 'three';
import {sourceShaderUniformOwner,type SourceShaderUniform} from './sourceShaderMaterial';

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
  width:number;height:number;pixels:Uint8Array;anisotropy:number;
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

/** Synchronous, owned snapshot of explicitly ordered source drawables.
 * Admission covers retained buffers plus packed copies and conservative UTF-8
 * shader/metadata transport space. It is not a JavaScript/GPU RSS measurement.
 * Unsupported state fails the entire snapshot; no draw is silently omitted.
 * The caller owns render ordering, viewport/background and subsequent delivery. */
export function snapshotSourceDrawings(
  meshes:readonly THREE.Mesh[],
  options:{maxBytes?:number;isCancelled?:()=>boolean}={},
):SourceDrawingResult<SourceDrawingSnapshot> {
  const limit=options.maxBytes??MAX_BYTES;
  let admittedBytes=0,retainedBufferBytes=0,copiedBufferBytes=0;
  const retained=new Set<ArrayBufferLike>(),textures=new Map<THREE.DataTexture,number>();
  const pendingTextures:THREE.DataTexture[]=[];
  const check=()=>{if(options.isCancelled?.())fail('cancelled',[],'绘制快照已取消');};
  const charge=(bytes:number,path:readonly string[])=>{
    requireValue(Number.isSafeInteger(bytes)&&bytes>=0,path,'绘制缓冲尺寸无效');
    if(bytes>limit-admittedBytes)fail('capacity',path,'绘制快照和保留缓冲超过本地预算');
    admittedBytes+=bytes;
  };
  const retain=(buffer:ArrayBufferLike,path:readonly string[])=>{
    if(!(buffer instanceof ArrayBuffer))fail('unsupported',path,'不支持并发可变共享缓冲快照');
    if(!retained.has(buffer)){charge(buffer.byteLength,path);retained.add(buffer);retainedBufferBytes+=buffer.byteLength;}
  };
  try{
    requireValue(Number.isSafeInteger(limit)&&limit>0&&limit<=MAX_BYTES,['maxBytes'],'快照预算必须在 1 至 256 MiB 内');
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
        charge(attribute.count*attribute.itemSize*4+96+name.length*3,p);
        return{name,attribute,divisor:instance?1 as const:0 as const};
      });
      requireValue(Number.isFinite(vertices),path,'绘制缺少逐顶点属性');
      if(geometry.index)requireValue(geometry.index.itemSize===1&&!geometry.index.normalized,path,'索引布局无效');
      const index=geometry.index?.array;
      if(index&&!(index instanceof Uint16Array)&&!(index instanceof Uint32Array))fail('unsupported',path,'索引必须为 uint16 或 uint32');
      if(index){retain(index.buffer,path);charge(index.byteLength,path);}
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
          if(!textures.has(texture)){retain(data.buffer,p);charge(data.byteLength+128,p);textures.set(texture,pendingTextures.length);pendingTextures.push(texture);}
          return{name,uniform};
        }
        const values=uniformComponents(uniform),count=uniform.kind==='float-array'||uniform.kind==='vec3-array'?uniform.count:1;
        const expected=uniform.kind==='vec3-array'?count*3:uniform.kind==='mat4'?16:uniform.kind==='vec4'?4:uniform.kind==='vec3'?3:uniform.kind==='vec2'||uniform.kind==='ivec2'?2:uniform.kind==='float-array'?count:1;
        requireValue(integer(count)&&count>0&&values.length===expected,p,'参数分量数量与声明不一致');
        if(ArrayBuffer.isView(values))retain(values.buffer,p);
        charge(values.length*4,p);
        const integral=uniform.kind==='int'||uniform.kind==='ivec2';
        for(let i=0;i<values.length;i++){
          if((i&4095)===0)check();const n=values[i];
          requireValue(typeof n==='number'&&(integral?Number.isInteger(n)&&n>=-2147483648&&n<=2147483647:Number.isFinite(Math.fround(n))),p,'参数超出声明的数值范围');
        }
        return{name,uniform,values,count,integral};
      });
      return[{material,attributes,index,first,count,instances,uniforms,passes,frontFace:mesh.matrixWorld.determinant()<0?'clockwise' as const:'counter-clockwise' as const}];
    });
    check();
    const textureCopies=pendingTextures.map(texture=>{
      check();const {width,height,data}=texture.image;
      const pixels=new Uint8Array(data.byteLength);copiedBufferBytes+=pixels.byteLength;
      for(let i=0;i<pixels.length;i+=65536){check();pixels.set((data as Uint8Array).subarray(i,i+65536),i);}
      return{width,height,pixels,anisotropy:texture.anisotropy,magFilter:'linear' as const,minFilter:'linear-mipmap-linear' as const,wrap:'clamp' as const,generateMipmaps:true as const};
    });
    const commands:SourceDrawingCommand[]=prepared.map(draw=>{
      const attributes=draw.attributes.map(({name,attribute,divisor})=>{
        const values=new Float32Array(attribute.count*attribute.itemSize);copiedBufferBytes+=values.byteLength;
        const interleaved=attribute instanceof THREE.InterleavedBufferAttribute;
        const input=interleaved?attribute.data.array:attribute.array;
        // Copy raw float words, including NaN payloads and signed zero. Other
        // attribute formats use Three's owning normalization implementation.
        const words=input instanceof Float32Array?new Uint32Array(input.buffer,input.byteOffset,input.length):undefined;
        const outputWords=new Uint32Array(values.buffer);
        const stride=interleaved?attribute.data.stride:attribute.itemSize,offset=interleaved?attribute.offset:0;
        for(let i=0;i<attribute.count;i++){
          if((i&4095)===0)check();
          for(let k=0;k<attribute.itemSize;k++){
            const target=i*attribute.itemSize+k;
            if(words)outputWords[target]=words[i*stride+offset+k];
            else values[target]=attribute.getComponent(i,k);
          }
        }
        return{name,size:attribute.itemSize,divisor,values};
      });
      const index=draw.index?.slice();copiedBufferBytes+=index?.byteLength??0;
      const uniforms:SourceDrawingUniform[]=draw.uniforms.map(u=>{
        if(u.uniform.kind==='sampler2d')return{name:u.name,kind:'sampler2d',texture:textures.get(u.uniform.value)!};
        const values=u.integral?new Int32Array(u.values!):new Float32Array(u.values!);copiedBufferBytes+=values.byteLength;
        return{name:u.name,kind:u.uniform.kind,count:u.count!,values};
      });
      check();return{primitive:'triangles',vertexShader:draw.material.vertexShader,fragmentShader:draw.material.fragmentShader,attributes,index,first:draw.first,count:draw.count,instances:draw.instances,uniforms,depthTest:draw.material.depthTest,depthWrite:draw.material.depthWrite,depthFunction:'less-equal',frontFace:draw.frontFace,passes:draw.passes,blend:'source-alpha-over-additive-alpha'};
    });
    return{ok:true,value:{model:'source-drawing-v1',commands,textures:textureCopies,copiedBufferBytes,retainedBufferBytes,admittedBytes}};
  }catch(error){if(error instanceof BoundaryFailure)return{ok:false,error:error.detail};throw error;}
}

function uniformComponents(uniform:Exclude<SourceShaderUniform,{kind:'sampler2d'}>):ArrayLike<number> {
  switch(uniform.kind){
    case 'float':case 'int':return[uniform.value];
    case 'mat4':return uniform.value.elements;
    case 'float-array':case 'vec3-array':return uniform.value;
    default:return uniform.value instanceof THREE.Vector2||uniform.value instanceof THREE.Vector3||uniform.value instanceof THREE.Vector4?uniform.value.toArray():uniform.value;
  }
}
