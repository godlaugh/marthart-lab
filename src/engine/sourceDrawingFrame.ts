import {isSourceDrawingViewport,type SourceDrawingViewport} from './sourceDrawingViewport';
export type {SourceDrawingViewport} from './sourceDrawingViewport';
import {sourceBouncingRetainedBytes,sourceBouncingProgramBytes,type SourceBouncingOperation} from './sourceBouncingOperation';
import type {SourceDrawingSnapshot,SourceDrawingResult,SourceDrawingUniform} from './sourceDrawingSnapshot';

/** Private, little-endian ML F1 wire format. Every numeric array is raw words,
 * never JSON numbers. The receiver validates the complete frame before GL work.
 * Dimensions are physical pixels; clear contains raw GL RGBA components, with no receiver color-space
 * conversion. Commands are in final draw order. Formula/other overlays remain
 * the caller's responsibility until represented as draws. */
export interface SourceDrawingFrame {
  generation:number;sequence:number;width:number;height:number;
  /** Actual GL_SAMPLES; zero is single-sample. Never silently round a request. */
  samples:number;
  /** Original offscreen completion can restore opaque background alpha. */
  completion?:'opaque-alpha';
  /** Omission preserves the full-target viewport used by legacy frames. */
  viewport?:SourceDrawingViewport;
  clear:readonly [number,number,number,number];
  drawing:SourceDrawingSnapshot;
  bouncing?:SourceBouncingOperation;
}
export const SOURCE_FRAME_MAGIC=0x31464c4d;
export const SOURCE_FRAME_BUDGET=256*1024*1024;
const uniformCode:Record<SourceDrawingUniform['kind'],number>={float:1,int:2,vec2:3,ivec2:4,vec3:5,vec4:6,mat4:7,'float-array':8,sampler2d:9,'vec3-array':10};
const encoder=new TextEncoder();
class FrameFailure extends Error {
  constructor(readonly kind:'input'|'capacity'|'cancelled'|'unsupported',message:string){super(message);}
}
const demand=(value:unknown,message:string)=>{if(!value)throw new FrameFailure('input',message);};
const uint=(value:number)=>Number.isInteger(value)&&value>=0&&value<=0xffffffff;
const littleEndian=new Uint8Array(new Uint32Array([1]).buffer)[0]===1;

/** Two passes admit all bytes before allocating the packet. The native side
 * uses the same conservative packet/copy/GPU + (12 + 8*samples) bytes/pixel rule.
 * Generic v12 adds receiver-owned maximum anisotropy (wire zero); numeric
 * requests keep v3. Its conservative transport multiplier is six.
 * This is resource admission, not a claim about driver or JS peak RSS. */
export function encodeSourceDrawingFrame(frame:SourceDrawingFrame,options:{isCancelled?:()=>boolean;retainedBytes?:number}={}):SourceDrawingResult<Uint8Array> {
  const check=()=>{if(options.isCancelled?.())throw new FrameFailure('cancelled','原生帧编码已取消');};
  try{
    check();
    const retainedBytes=options.retainedBytes??0;demand(Number.isSafeInteger(retainedBytes)&&retainedBytes>=0,'调用者保留缓冲容量无效');
    demand(uint(frame.generation)&&frame.generation>0&&uint(frame.sequence)&&frame.sequence>0,'帧身份需要非零 uint32 代次和序号');
    demand(uint(frame.width)&&frame.width>0&&frame.width<=16384&&uint(frame.height)&&frame.height>0&&frame.height<=16384&&frame.width*frame.height<=16_000_000,'帧物理尺寸超出容量');
    demand(uint(frame.samples)&&frame.samples<=0x7fffffff,'帧采样数必须为非负 GLsizei');
    demand(frame.clear.length===4&&frame.clear.every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1),'帧背景必须为四个有限的 0 至 1 分量');
    demand(frame.completion===undefined||frame.completion==='opaque-alpha'&&frame.clear[3]===1,'帧完成阶段的 alpha 策略无效');
    demand(frame.viewport===undefined||isSourceDrawingViewport(frame.viewport),'帧物理 viewport 必须为 int32 原点和非负 GLsizei 尺寸');
    demand(!frame.bouncing||frame.viewport===undefined,'保留状态帧不支持通用 viewport');
    demand(frame.drawing.model==='source-drawing-v1','未知绘制快照版本');
    const maximumAnisotropy=frame.drawing.textures.some(t=>t.anisotropy==='maximum');
    const operation=frame.bouncing;
    demand(!operation||!maximumAnisotropy,'保留状态帧不支持通用纹理最大采样策略');
    let nativeBytes=0,uploadBytes=0;
    if(operation){
      demand(['create','upload','draw','release'].includes(operation.kind)&&/^[a-f0-9]{32}$/.test(operation.resource)&&operation.resource!=='0'.repeat(32),'原生状态操作或资源身份无效');
      if(operation.kind!=='release'){demand(uint(operation.particleCount)&&operation.particleCount>0&&operation.particleCount<=0x7fffffff,'原生状态粒子数量无效');demand(uint(operation.programBytes),'原生状态程序容量无效');nativeBytes=sourceBouncingRetainedBytes(operation.particleCount,operation.programBytes);if(operation.kind==='create')demand(operation.programBytes===sourceBouncingProgramBytes(operation.shaders),'原生状态程序容量不匹配');}
      if(operation.kind==='upload'){demand(operation.particles instanceof Float32Array&&operation.particles.buffer instanceof ArrayBuffer&&operation.particles.length>0&&operation.particles.length%4===0&&uint(operation.offset)&&operation.offset+operation.particles.length/4<=operation.particleCount,'原生状态上传范围无效');uploadBytes=operation.particles.buffer.byteLength;}
      if(operation.kind!=='draw')demand(frame.width===1&&frame.height===1&&frame.samples===0&&!frame.completion&&frame.clear.every(n=>n===0)&&!frame.drawing.commands.length&&!frame.drawing.textures.length,'状态控制请求不能包含绘图');
      else demand(frame.drawing.commands[0]?.retainedBouncingState===true&&frame.drawing.commands.filter(d=>d.retainedBouncingState).length===1,'状态绘图需要唯一的首个粒子绘制');
    }
    let offset=0,packet:Uint8Array|undefined,view:DataView|undefined;
    const reserve=(length:number)=>{
      check();demand(Number.isSafeInteger(length)&&length>=0,'帧字段长度无效');
      if(length>SOURCE_FRAME_BUDGET-offset)throw new FrameFailure('capacity','原生帧超过容量');
      const start=offset;offset+=length;return start;
    };
    const u32=(n:number)=>{demand(uint(n),'帧整数字段无效');const at=reserve(4);view?.setUint32(at,n,true);};
    const f32=(n:number)=>{demand(typeof n==='number'&&Number.isFinite(Math.fround(n)),'帧浮点字段无效');const at=reserve(4);view?.setFloat32(at,n,true);};
    const raw=(bytes:Uint8Array)=>{u32(bytes.byteLength);const at=reserve(bytes.byteLength);if(packet)for(let i=0;i<bytes.length;i+=65536){check();packet.set(bytes.subarray(i,i+65536),at+i);}};
    const words=(values:Float32Array|Int32Array|Uint16Array|Uint32Array)=>{
      demand(values.buffer instanceof ArrayBuffer,'不支持共享缓冲帧');
      const bytes=new Uint8Array(values.buffer,values.byteOffset,values.byteLength);
      if(littleEndian){raw(bytes);return;}
      u32(bytes.length);const at=reserve(bytes.length);
      if(packet){const width=values.BYTES_PER_ELEMENT;for(let i=0;i<bytes.length;i++){if((i&65535)===0)check();packet[at+i]=bytes[i-i%width+width-1-i%width];}}
    };
    // Cache encoded strings only after their upper bound fits, sharing repeated
    // shaders without reparsing GLSL. Reject NUL/unpaired surrogate replacement.
    const strings=new Map<string,Uint8Array>();
    const text=(s:string)=>{
      demand(typeof s==='string'&&s.length>0&&!s.includes('\0'),'帧字符串无效');
      if(s.length>(SOURCE_FRAME_BUDGET-offset)/3)throw new FrameFailure('capacity','帧字符串超过容量');
      let bytes=strings.get(s);if(!bytes){bytes=encoder.encode(s);demand(new TextDecoder('utf-8',{fatal:true}).decode(bytes)===s,'帧字符串不是有效 Unicode');strings.set(s,bytes);}raw(bytes);
    };
    const emit=()=>{
      u32(SOURCE_FRAME_MAGIC);u32(frame.viewport?16:operation?4:maximumAnisotropy?12:3);u32(packet?.length??0);u32(frame.generation);u32(frame.sequence);u32(frame.width);u32(frame.height);
      frame.clear.forEach(f32);u32(frame.drawing.textures.length);u32(frame.drawing.commands.length);u32(frame.samples);u32(frame.completion==='opaque-alpha'?1:0);
      if(frame.viewport){u32(0);frame.viewport.forEach(n=>u32(n>>>0));}
      if(operation){
        u32({create:1,upload:2,draw:3,release:4}[operation.kind]);raw(Uint8Array.from(operation.resource.match(/../g)!,v=>parseInt(v,16)));
        if(operation.kind!=='release'){u32(operation.particleCount);u32(operation.programBytes);}
        if(operation.kind==='create'){for(const key of ['quad','update','vertex','fragment'] as const)text(operation.shaders[key]);}
        if(operation.kind==='upload'){u32(operation.offset);words(operation.particles);}
        if(operation.kind==='draw'){
          demand(uint(operation.from)&&uint(operation.to)&&operation.to>=operation.from&&operation.to<=10000,'原生状态更新索引无效');u32(operation.from);u32(operation.to);
          const u=operation.update,b=u.boundary;demand(Number.isInteger(u.subSteps)&&u.subSteps>=-2147483648&&u.subSteps<=2147483647,'原生状态子步需要 int32');u32(u.subSteps>>>0);f32(u.timeStep);f32(u.particleRadius);
          demand(['circle','ellipse','polygon'].includes(b.kind),'原生状态容器无效');u32(b.kind==='circle'?1:b.kind==='ellipse'?2:0);
          if(b.kind==='polygon'){demand(b.vertices.length<=64,'原生多边形顶点超过容量');u32(b.vertices.length);for(const p of b.vertices){demand(p.length===2,'原生顶点尺寸无效');p.forEach(f32);}}
          else{demand(b.center.length===2,'原生容器中心尺寸无效');b.center.forEach(f32);if(b.kind==='circle')f32(b.radius);else{f32(b.a);f32(b.b);}}
        }
      }
      for(const t of frame.drawing.textures){
        demand(t.magFilter==='linear'&&t.minFilter==='linear-mipmap-linear'&&t.wrap==='clamp'&&t.generateMipmaps===true,'不支持的帧纹理采样');
        demand(t.anisotropy==='maximum'||typeof t.anisotropy==='number'&&Number.isFinite(t.anisotropy)&&t.anisotropy>=1,'纹理各向异性需要有限上限或原生最大策略');
        u32(t.width);u32(t.height);f32(t.anisotropy==='maximum'?0:t.anisotropy);raw(t.pixels);
      }
      for(const d of frame.drawing.commands){
        demand(d.depthFunction==='less-equal'&&['source-alpha-over-additive-alpha','source-alpha-over'].includes(d.blend),'不支持的帧深度或混合方式');
        demand(typeof d.depthTest==='boolean'&&typeof d.depthWrite==='boolean'&&['clockwise','counter-clockwise'].includes(d.frontFace),'帧光栅状态无效');
        demand(d.primitive==='triangles'||d.primitive==='points','未知绘制图元');
        demand(d.primitive==='points'||d.count%3===0,'三角形范围必须是三个顶点的倍数');
        demand(d.retainedBouncingState===undefined||d.retainedBouncingState===true,'保留状态标记无效');
        if(d.retainedBouncingState)demand(operation?.kind==='draw'&&d===frame.drawing.commands[0]&&d.primitive==='points'&&d.count===operation.particleCount&&d.first===0&&d.instances===1&&!d.attributes.length&&!d.index&&!d.depthTest&&!d.depthWrite&&d.blend==='source-alpha-over'&&d.frontFace==='counter-clockwise'&&d.passes.length===1&&d.passes[0]==='both','状态粒子绘制声明无效');
        text(d.vertexShader);text(d.fragmentShader);u32(d.first);u32(d.count);u32(d.instances);
        u32((d.depthTest?1:0)|(d.depthWrite?2:0)|(d.frontFace==='clockwise'?4:0)|(d.primitive==='points'?8:0)|(d.blend==='source-alpha-over'?16:0)|(d.retainedBouncingState?32:0));u32(d.passes.length);
        for(const pass of d.passes){demand(['both','front','back'].includes(pass),'帧面选择无效');u32(pass==='both'?0:pass==='front'?1:2);}
        u32(d.attributes.length);
        for(const a of d.attributes){text(a.name);u32(a.size);u32(a.divisor);words(a.values);}
        u32(d.index?(d.index instanceof Uint16Array?16:32):0);if(d.index)words(d.index);
        u32(d.uniforms.length);
        for(const u of d.uniforms){text(u.name);u32(uniformCode[u.kind]);if(u.kind==='sampler2d')u32(u.texture);else{u32(u.count);words(u.values);}}
      }
    };
    emit();const size=offset;
    // Also account for the retained input snapshot while emitting. Driver-side
    // validation does not trust the caller's accounting fields.
    const frameStorage=frame.width*frame.height*(12+8*frame.samples);
    demand(Number.isSafeInteger(frame.drawing.admittedBytes)&&frame.drawing.admittedBytes>=0,'快照容量信息无效');
    if(operation&&size*6+frameStorage+nativeBytes+uploadBytes+retainedBytes+frame.drawing.admittedBytes>SOURCE_FRAME_BUDGET)throw new FrameFailure('capacity','状态、调用方种子、协议副本与输出超过 256 MiB 预算');
    if((frame.viewport?retainedBytes:0)+size*(maximumAnisotropy||frame.viewport?6:4)+frameStorage>SOURCE_FRAME_BUDGET||size+frame.drawing.admittedBytes+frameStorage+retainedBytes>SOURCE_FRAME_BUDGET)throw new FrameFailure('capacity','帧传输、缓冲及读回超过 256 MiB 预算');
    packet=new Uint8Array(size);view=new DataView(packet.buffer);offset=0;emit();
    demand(offset===size,'编码期间帧结构发生变化');check();return{ok:true,value:packet};
  }catch(error){if(error instanceof FrameFailure)return{ok:false,error:{kind:error.kind,path:['frame'],reason:error.message}};throw error;}
}
