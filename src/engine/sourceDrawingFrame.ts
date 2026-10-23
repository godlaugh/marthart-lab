import type {SourceDrawingSnapshot,SourceDrawingResult,SourceDrawingUniform} from './sourceDrawingSnapshot';

/** Private, little-endian ML F1 wire format. Every numeric array is raw words,
 * never JSON numbers. The receiver validates the complete frame before GL work.
 * Dimensions are physical pixels; clear contains raw GL RGBA components, with no receiver color-space
 * conversion. Commands are in final draw order. Formula/other overlays remain
 * the caller's responsibility until represented as draws. */
export interface SourceDrawingFrame {
  generation:number;sequence:number;width:number;height:number;
  clear:readonly [number,number,number,number];
  drawing:SourceDrawingSnapshot;
}
export const SOURCE_FRAME_MAGIC=0x31464c4d;
export const SOURCE_FRAME_BUDGET=256*1024*1024;
const uniformCode:Record<SourceDrawingUniform['kind'],number>={float:1,int:2,vec2:3,ivec2:4,vec3:5,vec4:6,mat4:7,'float-array':8,sampler2d:9};
const encoder=new TextEncoder();
class FrameFailure extends Error {
  constructor(readonly kind:'input'|'capacity'|'cancelled'|'unsupported',message:string){super(message);}
}
const demand=(value:unknown,message:string)=>{if(!value)throw new FrameFailure('input',message);};
const uint=(value:number)=>Number.isInteger(value)&&value>=0&&value<=0xffffffff;
const littleEndian=new Uint8Array(new Uint32Array([1]).buffer)[0]===1;

/** Two passes admit all bytes before allocating the packet. The native side
 * uses the same conservative packet/copy/GPU + 12 bytes/pixel capacity rule.
 * This is resource admission, not a claim about driver or JS peak RSS. */
export function encodeSourceDrawingFrame(frame:SourceDrawingFrame,options:{isCancelled?:()=>boolean}={}):SourceDrawingResult<Uint8Array> {
  const check=()=>{if(options.isCancelled?.())throw new FrameFailure('cancelled','原生帧编码已取消');};
  try{
    check();
    demand(uint(frame.generation)&&frame.generation>0&&uint(frame.sequence)&&frame.sequence>0,'帧身份需要非零 uint32 代次和序号');
    demand(uint(frame.width)&&frame.width>0&&frame.width<=16384&&uint(frame.height)&&frame.height>0&&frame.height<=16384&&frame.width*frame.height<=16_000_000,'帧物理尺寸超出容量');
    demand(frame.clear.length===4&&frame.clear.every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1),'帧背景必须为四个有限的 0 至 1 分量');
    demand(frame.drawing.model==='source-drawing-v1','未知绘制快照版本');
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
      u32(SOURCE_FRAME_MAGIC);u32(1);u32(packet?.length??0);u32(frame.generation);u32(frame.sequence);u32(frame.width);u32(frame.height);
      frame.clear.forEach(f32);u32(frame.drawing.textures.length);u32(frame.drawing.commands.length);
      for(const t of frame.drawing.textures){
        demand(t.magFilter==='linear'&&t.minFilter==='linear-mipmap-linear'&&t.wrap==='clamp'&&t.generateMipmaps===true,'不支持的帧纹理采样');
        u32(t.width);u32(t.height);f32(t.anisotropy);raw(t.pixels);
      }
      for(const d of frame.drawing.commands){
        demand(d.depthFunction==='less-equal'&&d.blend==='source-alpha-over-additive-alpha','不支持的帧深度或混合方式');
        demand(typeof d.depthTest==='boolean'&&typeof d.depthWrite==='boolean'&&['clockwise','counter-clockwise'].includes(d.frontFace),'帧光栅状态无效');
        text(d.vertexShader);text(d.fragmentShader);u32(d.first);u32(d.count);u32(d.instances);
        u32((d.depthTest?1:0)|(d.depthWrite?2:0)|(d.frontFace==='clockwise'?4:0));u32(d.passes.length);
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
    const frameStorage=frame.width*frame.height*12;
    demand(Number.isSafeInteger(frame.drawing.admittedBytes)&&frame.drawing.admittedBytes>=0,'快照容量信息无效');
    if(size*4+frameStorage>SOURCE_FRAME_BUDGET||size+frame.drawing.admittedBytes+frameStorage>SOURCE_FRAME_BUDGET)throw new FrameFailure('capacity','帧传输、缓冲及读回超过 256 MiB 预算');
    packet=new Uint8Array(size);view=new DataView(packet.buffer);offset=0;emit();
    demand(offset===size,'编码期间帧结构发生变化');check();return{ok:true,value:packet};
  }catch(error){if(error instanceof FrameFailure)return{ok:false,error:{kind:error.kind,path:['frame'],reason:error.message}};throw error;}
}
