import {encodeSourceAttractorNativeRequest,type SourceAttractorNativeRequest,type SourceAttractorNativeCheckpoint,type SourceAttractorNativeDisplay} from '../src/engine/sourceAttractorNativeProtocol';
export const resource='12'.repeat(16),program={vertex:'#version 410 core\nvoid main(){gl_Position=vec4(0);}',fragment:'#version 410 core\nout vec4 color;void main(){color=vec4(1);}'};
export const checkpoint:SourceAttractorNativeCheckpoint={expectedIndex:0,expectedRenderIndex:0,expectedUploaded:9,expectedCount:5,expectedTexSize:3};
export const display=(width=2,height=2):SourceAttractorNativeDisplay=>({layout:{width,height,scale:1.5,accumWidth:3,accumHeight:3,bytes:0},radius:1,scale:[1,1,1],offset:[0,0,0],projection:new Float32Array(16),modelview:new Float32Array(16),backgroundRgb:[0,0,0],exposure:1,contrast:1,gamma:1,saturation:1,densityScale:.5});
export const request=(operation:SourceAttractorNativeRequest['operation'],sequence=1):SourceAttractorNativeRequest=>({generation:1,sequence,width:operation.kind==='render'?operation.display.layout.width:1,height:operation.kind==='render'?operation.display.layout.height:1,operation});
export const create=(token=resource)=>request({kind:'create',resource:token,count:5,texSize:3,shaderOperations:1,programs:{update:program,accumulate:program,present:program}});
export const upload=(offset=0,n=9)=>request({kind:'upload',resource,...checkpoint,expectedUploaded:offset,offset,positions:new Float32Array(n*4),texIndex:new Float32Array(Math.min(n,Math.max(5-offset,0))*2),colors:new Float32Array(Math.min(n,Math.max(5-offset,0))*4)});
export const packet=(r:SourceAttractorNativeRequest)=>{const p=encodeSourceAttractorNativeRequest(r);if(!p.ok)throw Error(p.error.reason);return p.value;};
export function reply(r:SourceAttractorNativeRequest,overrides:Record<number,number>={}){
 const op=r.operation,kind={create:1,upload:2,pass:3,render:4,read:5,release:6}[op.kind],read=op.kind==='read'?op.count:0;
 const b=new Uint8Array(96+(op.kind==='render'?r.width*r.height*4:read*16)),v=new DataView(b.buffer),word=(at:number,n:number)=>v.setUint32(at,n,true);
 word(0,6);word(4,kind);b.set(Buffer.from(op.resource,'hex'),8);
 if(op.kind==='release')word(44,2);else{
  word(24,op.kind==='create'?0:op.expectedIndex+(op.kind==='pass'?1:0));word(28,op.kind==='create'?0:op.expectedRenderIndex+(op.kind==='render'?1:0));word(32,op.kind==='create'?0:op.kind==='upload'?op.offset+op.positions.length/4:op.expectedUploaded);word(36,op.kind==='create'?op.count:op.expectedCount);word(40,op.kind==='create'?op.texSize:op.expectedTexSize);
  if(op.kind==='render'){word(48,r.width);word(52,r.height);word(56,op.display.layout.accumWidth);word(60,op.display.layout.accumHeight);word(64,op.expectedIndex);}
  if(op.kind==='read'){word(68,op.target==='state'?1:2);word(72,op.offset);word(76,op.count);}
 }
 for(const [k,n]of Object.entries(overrides))word(Number(k),n);return b;
}
