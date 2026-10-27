import {describe,it,expect} from 'vitest';
import {
 encodeSourceRootsPointNativeRequest,admitSourceRootsPointNativeRequest,captureSourceRootsPointNativeResponseBinding,decodeSourceRootsPointNativeResponse,
 sourceRootsPointNativeResponseBytes,sourceRootsPointNativeProgramBytes,sourceRootsPointNativeResidentBytes,
 sourceRootsPointNativePeakBytes,sourceRootsPointNativeChunkPlan,sourceRootsPointNativeSchedule,sourceRootsPointNativeScheduleChunk,sourceRootsPointNativeFrameSchedule,
 type SourceRootsPointNativeOperation,type SourceRootsPointNativeRequest,type SourceRootsPointNativeResponseBinding,type SourceRootsPointNativeFrameSchedule,
} from '../src/engine/sourceRootsPointNativeProtocol';
import type {RootsPointPrograms,RootsPointFrameMetadata} from '../src/engine/rootsPointCloudDrawing';
import type {SourceDrawingUniform} from '../src/engine/sourceDrawingSnapshot';
import {rootsPointCloudPrograms,prepareRootsPointFrame,prepareRootsPointChunks} from '../src/engine/rootsPointCloudDrawing';
import {RootsPointCloudRing} from '../src/engine/rootsPointCloudRing';
import {defaultRootsPresentationConfiguration} from '../src/engine/rootsPresentationConfig';
import {prepareRootsProjection} from '../src/engine/rootsProjection';
import {prepareRootsDensityColor,ROOTS_DENSITY_COLOR_VERSION} from '../src/engine/rootsDensityColor';

const resource='12'.repeat(16),session='34'.repeat(16),budget=256*1024*1024;
const programs=():RootsPointPrograms=>({point:{vertex:'#version 410 core\nvoid main(){}',fragment:'#version 410 core\nvoid main(){}'},fade:{vertex:'#version 410 core\nvoid main(){}',fragment:'#version 410 core\nvoid main(){}'}});
function metadata():RootsPointFrameMetadata {
 const scalar=(name:string):SourceDrawingUniform=>({name,kind:'float',count:1,values:new Float32Array([1])});
 const uniforms:SourceDrawingUniform[]=[
  ...['projection','modelview'].map(name=>({name,kind:'mat4' as const,count:1,values:new Float32Array(16)})),
  ...['pointSize','rotationDegrees','brightness','contrast','gamma','dynamicRange','saturation','paletteOffset'].map(scalar),
  ...['scaleVec','offsetVec','backgroundRgb'].map(name=>({name,kind:'vec3' as const,count:1,values:new Float32Array(3)})),
  {name:'paletteTex',kind:'sampler2d',texture:0},
 ];
 return{clear:[0,0,0,1],fade:[0,0,0,.2],palette:new Uint8Array(1024),uniforms};
}
const frame=():SourceRootsPointNativeFrameSchedule=>({rangeCounts:[5,2],chunkPoints:3,clear:true,fade:true});
const request=(operation:SourceRootsPointNativeOperation):SourceRootsPointNativeRequest=>({generation:1,sequence:2,width:operation.kind==='release'?1:2,height:operation.kind==='release'?1:3,operation});
const create=()=>request({kind:'create',resource,session,target:'primary',programs:programs()});
const begin=()=>request({kind:'begin',resource,expectedDisplay:0,chunkPoints:3,rangeCounts:[5,2],metadata:metadata()});
const append=()=>request({kind:'append',resource,expectedDisplay:0,ordinal:1,rangeIndex:0,rangeOffset:3,points:new Float32Array(8),frame:frame()});
const finish=()=>request({kind:'finish',resource,expectedDisplay:0,frame:frame()});
function packet(r:SourceRootsPointNativeRequest){const encoded=encodeSourceRootsPointNativeRequest(r);if(!encoded.ok)throw Error(encoded.error.reason);return encoded.value;}
function reply(r:SourceRootsPointNativeRequest,overrides:Partial<Record<number,number>>={}):Uint8Array {
 const b=captureSourceRootsPointNativeResponseBinding(r),out=new Uint8Array(sourceRootsPointNativeResponseBytes(b)),v=new DataView(out.buffer);
 const words:Record<number,number>={0:7,4:{create:1,begin:2,append:3,finish:4,release:5}[r.operation.kind],24:b.displayIndex??0,28:r.operation.kind==='release'?1:0,32:r.operation.kind==='release'?2:b.width,36:r.operation.kind==='release'?3:b.height,40:b.phase==='active'?1:0,44:b.receivedPoints??0,48:b.totalPoints??0,52:b.nextChunk??0,56:b.totalChunks??0,60:b.pointDraws??0,64:b.fadeDraws??0,68:b.clears??0,80:1,...overrides};
 for(const [offset,n]of Object.entries(words))v.setUint32(Number(offset),n,true);
 for(let i=0;i<16;i++)out[8+i]=parseInt(resource.slice(i*2,i*2+2),16);
 v.setFloat32(72,1,true);v.setFloat32(76,64,true);return out;
}
describe('Roots retained point target v15 codec',()=>{
 it('accepts actual shared programs/metadata and wrapped ring chunks without a second interpretation',()=>{
  const c=defaultRootsPresentationConfiguration();c.mode='point-cloud';const plan=prepareRootsProjection(c,{width:2,height:3,viewport:{logicalWidth:2,logicalHeight:3,referenceLogicalHeight:3,target:'primary'}});
  const color=prepareRootsDensityColor({settings:{rootDensityColorVersion:ROOTS_DENSITY_COLOR_VERSION,background:'#000000'}});if(color.kind!=='metric-sum')throw Error();
  expect(packet(request({kind:'create',resource,session,target:'primary',programs:rootsPointCloudPrograms('native-gl41')})).length).toBeGreaterThan(1000);
  const ring=new RootsPointCloudRing({capacityPoints:4,recentWindowPoints:4});
  try{
   ring.append(new Float32Array([1,2,3,.5,4,5,6,-0,7,8,9,Infinity]));ring.append(new Float32Array([10,11,12,-Infinity,13,14,15,2]));
   const chunks=prepareRootsPointChunks(ring,2),op:Extract<SourceRootsPointNativeOperation,{kind:'begin'}>={kind:'begin',resource,expectedDisplay:0,chunkPoints:2,rangeCounts:chunks.rangeCounts,metadata:prepareRootsPointFrame(plan,color,true)};
   expect(packet(request(op)).length).toBeGreaterThan(1024);const ownedFrame=sourceRootsPointNativeFrameSchedule(op);
   for(const chunk of chunks){const r=request({kind:'append',resource,expectedDisplay:0,ordinal:chunk.ordinal,rangeIndex:chunk.rangeIndex,rangeOffset:chunk.rangeOffset,points:chunk.points,frame:ownedFrame});expect([...packet(r).subarray(112)]).toEqual([...new Uint8Array(chunk.points.buffer)]);}
   const done=request({kind:'finish',resource,expectedDisplay:0,frame:ownedFrame});expect(decodeSourceRootsPointNativeResponse(reply(done),captureSourceRootsPointNativeResponseBinding(done)).receivedPoints).toBe(4);
  }finally{ring.dispose();}
 });
 it('encodes the fixed envelope and four full-profile shader blocks',()=>{
  const r=create(),p=packet(r),v=new DataView(p.buffer);expect([0,4,8,12,16,20,24,60,64,68].map(o=>v.getUint32(o,true))).toEqual([0x31464c4d,15,p.length,1,2,2,3,7,1,16]);expect([...p.subarray(28,60)]).toEqual(new Array(32).fill(0));
  expect(v.getUint32(88,true)).toBe(16);expect([...p.subarray(92,108)]).toEqual(new Array(16).fill(0x34));expect(v.getUint32(108,true)).toBe(1);expect(v.getUint32(112,true)).toBe(1);
  expect(p.length).toBe(132+sourceRootsPointNativeProgramBytes(programs())/3);
 });
 it('encodes complete begin ranges, clear/fade, the actual LUT and uniform table',()=>{
  const p=packet(begin()),v=new DataView(p.buffer);expect([88,92,96,100,104,108].map(o=>v.getUint32(o,true))).toEqual([0,3,3,2,5,2]);expect(v.getFloat32(124,true)).toBe(1);expect(v.getFloat32(140,true)).toBe(Math.fround(.2));expect(v.getUint32(144,true)).toBe(1024);expect(v.getUint32(1172,true)).toBe(14);
 });
 it('keeps append wire free of logical schedule copies',()=>{const p=packet(append()),v=new DataView(p.buffer);expect(p.length).toBe(144);expect([88,92,96,100,104,108].map(o=>v.getUint32(o,true))).toEqual([0,1,0,3,2,32]);});
 it('preserves raw XYZ NaN/Inf payloads and metric signed zero exactly',()=>{
  const points=new Float32Array(4),bits=new Uint32Array(points.buffer);bits.set([0x7fc12345,0x7f800000,0xff800000,0x80000000]);
  const r=request({kind:'append',resource,expectedDisplay:7,ordinal:0,rangeIndex:0,rangeOffset:0,points,frame:{rangeCounts:[1],chunkPoints:1,clear:false,fade:false}}),p=packet(r),v=new DataView(p.buffer);
  expect([112,116,120,124].map(o=>v.getUint32(o,true))).toEqual([...bits]);
 });
 it('copies only the borrowed subarray bytes and revalidates a changed metric after admission',()=>{
  const backing=new Uint32Array([0x12345678,0x7fc12345,0xffc23456,0x80000000,0x80000000,0x87654321]);
  const points=new Float32Array(backing.buffer,4,4),r=request({kind:'append',resource,expectedDisplay:1,ordinal:0,rangeIndex:0,rangeOffset:0,points,frame:{rangeCounts:[1],chunkPoints:1,clear:false,fade:false}});
  expect(admitSourceRootsPointNativeRequest(r)).toEqual({ok:true,value:undefined});const p=packet(r),v=new DataView(p.buffer);
  expect(p.length).toBe(128);expect([112,116,120,124].map(o=>v.getUint32(o,true))).toEqual([...backing.subarray(1,5)]);
  points[3]=Infinity;expect(encodeSourceRootsPointNativeRequest(r)).toMatchObject({ok:false,error:{kind:'input'}});expect(admitSourceRootsPointNativeRequest(r)).toMatchObject({ok:false,error:{kind:'input'}});
 });
 it.each([NaN,Infinity,-Infinity,-.01,1.01])('rejects unprepared metric %s without filtering raw positions',metric=>{const r=append();if(r.operation.kind!=='append')throw Error();r.operation.points[3]=metric;expect(encodeSourceRootsPointNativeRequest(r)).toMatchObject({ok:false,error:{kind:'input'}});});
 it('binds all ACK scalar expectations before caller mutation',()=>{
  const r=append(),ack=reply(r),b=captureSourceRootsPointNativeResponseBinding(r);if(r.operation.kind!=='append')throw Error();
  r.operation.frame.rangeCounts=[1];r.operation.frame.fade=false;r.operation.ordinal=0;r.operation.resource='ab'.repeat(16);r.width=10;r.operation.points.fill(NaN);
  expect(Object.isFrozen(b)).toBe(true);expect(Object.values(b).every(x=>typeof x!=='object')).toBe(true);expect(decodeSourceRootsPointNativeResponse(ack,b)).toMatchObject({receivedPoints:5,totalPoints:7,nextChunk:2,totalChunks:3,pointDraws:2,fadeDraws:1,width:2});
 });
 it('derives the complete ordered two-range schedule without a second point interpretation',()=>{
  const s=sourceRootsPointNativeSchedule([5,2],3);expect([0,1,2].map(i=>sourceRootsPointNativeScheduleChunk(s,i))).toEqual([{rangeIndex:0,rangeOffset:0,count:3,receivedPoints:3},{rangeIndex:0,rangeOffset:3,count:2,receivedPoints:5},{rangeIndex:1,rangeOffset:0,count:2,receivedPoints:7}]);expect(()=>sourceRootsPointNativeScheduleChunk(s,3)).toThrow();
 });
 it.each(['ordinal','rangeIndex','rangeOffset','points'] as const)('rejects an append with skipped/duplicate %s',field=>{
  const r=append();if(r.operation.kind!=='append')throw Error();if(field==='points')r.operation.points=new Float32Array(4);else r.operation[field]=field==='ordinal'?0:99;expect(encodeSourceRootsPointNativeRequest(r)).toMatchObject({ok:false,error:{kind:'input'}});
 });
 it('requires first display clear, preserves optional later clear and independent fade',()=>{
  const r=begin();if(r.operation.kind!=='begin')throw Error();Reflect.deleteProperty(r.operation.metadata,'clear');expect(encodeSourceRootsPointNativeRequest(r).ok).toBe(false);r.operation.expectedDisplay=1;expect(new DataView(packet(r).buffer).getUint32(92,true)).toBe(2);
 });
 it('supports a zero-point frame without claiming a point draw or dropping clear/fade',()=>{
  const r=begin();if(r.operation.kind!=='begin')throw Error();r.operation.rangeCounts=[];const f=sourceRootsPointNativeFrameSchedule(r.operation),done=request({kind:'finish',resource,expectedDisplay:0,frame:f});
  expect(Object.isFrozen(f.rangeCounts)).toBe(true);expect(decodeSourceRootsPointNativeResponse(reply(done),captureSourceRootsPointNativeResponseBinding(done))).toMatchObject({displayIndex:1,totalPoints:0,totalChunks:0,pointDraws:0,fadeDraws:1,clears:1});
 });
 it.each([44,48,52,56,60,64,68])('rejects a finish ACK with incomplete/forged coverage at %i',offset=>{const r=finish(),raw=reply(r),v=new DataView(raw.buffer);v.setUint32(offset,v.getUint32(offset,true)+1,true);expect(()=>decodeSourceRootsPointNativeResponse(raw,captureSourceRootsPointNativeResponseBinding(r))).toThrow();});
 it.each([0,4,8,24,28,32,36,40,80,84,88,92])('rejects wrong identity/checkpoint/reserved word at %i',offset=>{const r=create(),raw=reply(r);new DataView(raw.buffer).setUint32(offset,999,true);expect(()=>decodeSourceRootsPointNativeResponse(raw,captureSourceRootsPointNativeResponseBinding(r))).toThrow();});
 it.each(['short','long','fake-binding','bad-range'] as const)('rejects %s response',kind=>{
  const r=finish(),raw=reply(r),b=captureSourceRootsPointNativeResponseBinding(r);
  if(kind==='short')expect(()=>decodeSourceRootsPointNativeResponse(raw.subarray(0,-1),b)).toThrow();
  if(kind==='long'){const more=new Uint8Array(raw.length+1);more.set(raw);expect(()=>decodeSourceRootsPointNativeResponse(more,b)).toThrow();}
  if(kind==='fake-binding')expect(()=>decodeSourceRootsPointNativeResponse(raw,{...b} as SourceRootsPointNativeResponseBinding)).toThrow();
  if(kind==='bad-range'){new DataView(raw.buffer).setFloat32(76,NaN,true);expect(()=>decodeSourceRootsPointNativeResponse(raw,b)).toThrow();}
 });
 it('returns borrowed complete raw RGBA including alpha with no row conversion',()=>{
  const r=finish(),a=reply(r);for(let i=96;i<a.length;i++)a[i]=i-96;const padded=new Uint8Array(a.length+3);padded.set(a,3);const result=decodeSourceRootsPointNativeResponse(padded.subarray(3),captureSourceRootsPointNativeResponseBinding(r));
  expect([...result.pixels!]).toEqual([...a.subarray(96)]);expect(result.pixels!.buffer).toBe(padded.buffer);expect(result.pixels!.length).toBe(24);
 });
 it('accepts release after unknown partial mutation without imposing stale schedule relations',()=>{
  const r=request({kind:'release',resource}),a=reply(r,{24:25,40:2,44:5,48:0,52:1,56:0,60:2});new DataView(a.buffer).setFloat32(72,0,true);new DataView(a.buffer).setFloat32(76,0,true);
  expect(decodeSourceRootsPointNativeResponse(a,captureSourceRootsPointNativeResponseBinding(r))).toMatchObject({disposition:'released',phase:'failed',displayIndex:25,receivedPoints:5,pointSizeRange:[0,0]});
 });
 it('accepts exact absent cleanup and rejects absent ACKs carrying retained facts',()=>{
  const r=request({kind:'release',resource}),a=reply(r,{28:2,32:1,36:1,80:0}),v=new DataView(a.buffer);v.setFloat32(72,0,true);v.setFloat32(76,0,true);const b=captureSourceRootsPointNativeResponseBinding(r);
  expect(decodeSourceRootsPointNativeResponse(a,b).disposition).toBe('absent');v.setUint32(44,1,true);expect(()=>decodeSourceRootsPointNativeResponse(a,b)).toThrow();
 });
 it('permits cleanup when held resources exceed current admission',()=>{expect(encodeSourceRootsPointNativeRequest(request({kind:'release',resource}),{retainedBytes:budget+1}).ok).toBe(true);});
 it('charges fixed VBO/target/control/shaders once at create and packet/readback copies',()=>{
  const r=create(),p=packet(r),resident=sourceRootsPointNativeResidentBytes(2,3,sourceRootsPointNativeProgramBytes(programs())),cost=resident+p.length*8+96*4;
  expect(resident).toBe(2*3*4+1024+2*1048576+sourceRootsPointNativeProgramBytes(programs()));
  expect(encodeSourceRootsPointNativeRequest(r,{retainedBytes:budget-cost}).ok).toBe(true);expect(encodeSourceRootsPointNativeRequest(r,{retainedBytes:budget-cost+1})).toMatchObject({ok:false,error:{kind:'capacity'}});
 });
 it('admits the future complete finish readback before begin can clear history',()=>{
  const r=begin();r.width=1024;r.height=1024;const binding=captureSourceRootsPointNativeResponseBinding(r),held=budget-92*8-(96+r.width*r.height*4)*4;
  expect(sourceRootsPointNativeResponseBytes(binding)).toBe(96);expect(encodeSourceRootsPointNativeRequest(r,{retainedBytes:held}).ok).toBe(true);expect(encodeSourceRootsPointNativeRequest(r,{retainedBytes:held+1})).toMatchObject({ok:false,error:{kind:'capacity'}});
 });
 it('admits the largest actual append as a separate frame peak before begin',()=>{
  const r=begin();if(r.operation.kind!=='begin')throw Error();r.operation.rangeCounts=[65536,1];r.operation.chunkPoints=65536;
  const held=budget-(112+16*65536)*8-96*4;
  expect(encodeSourceRootsPointNativeRequest(r,{retainedBytes:held}).ok).toBe(true);expect(encodeSourceRootsPointNativeRequest(r,{retainedBytes:held+1})).toMatchObject({ok:false,error:{kind:'capacity'}});
  r.operation.rangeCounts=[2,1];expect(encodeSourceRootsPointNativeRequest(r,{retainedBytes:held+1}).ok).toBe(true);
 });
 it('bounds chunk allocation before copying, including a single remaining point',()=>{
  const held=budget-(112+16*7)*8-96*4;expect(sourceRootsPointNativeChunkPlan(held,65536,100)).toEqual({count:7,packetBytes:224});expect(()=>sourceRootsPointNativeChunkPlan(budget-128*8-96*4+1,65536,100)).toThrow();expect(sourceRootsPointNativeChunkPlan(0,65536,1).count).toBe(1);
 });
 it('preserves 3M recent-window capacity and rejects oversized/sparse schedules',()=>{expect(sourceRootsPointNativeSchedule([1_000_000,2_000_000],65536).totalPoints).toBe(3_000_000);for(const counts of [[3_000_001],[0],[1,2,3],new Array<number>(1)])expect(()=>sourceRootsPointNativeSchedule(counts,65536)).toThrow();});
 it('counts reply peak before allocating a full image',()=>{expect(()=>sourceRootsPointNativePeakBytes(0,0,0,96+16_000_000*4)).not.toThrow();expect(()=>sourceRootsPointNativePeakBytes(16_000_000,0,0,96+16_000_000*4)).toThrow();});
 it.each(['unknown','unicode','crlf','sparse-color','extra-uniform','sampler','missing-uniform','nonfinite','shared'] as const)('rejects malformed %s at the owning boundary',kind=>{
  const r=kind==='unicode'||kind==='crlf'?create():begin();
  if(r.operation.kind==='create')Object.assign(r.operation.programs.point,{vertex:kind==='unicode'?'#version 410 core\n\ud800':'#version 410 core\r\nvoid main(){}'});
  if(r.operation.kind==='begin'){
   const m=r.operation.metadata;
   if(kind==='unknown')Object.assign(r.operation,{unknown:true});
   if(kind==='sparse-color')Object.assign(m,{clear:new Array(4)});
   if(kind==='extra-uniform')Object.assign(m,{uniforms:[...m.uniforms,{name:'extra',kind:'float',count:1,values:new Float32Array([0])}]});
   if(kind==='missing-uniform')Object.assign(m,{uniforms:m.uniforms.slice(1)});
   if(kind==='sampler')Object.assign(m,{uniforms:m.uniforms.map(u=>u.kind==='sampler2d'?{...u,texture:1}:u)});
   if(kind==='nonfinite'){const u=m.uniforms[0];if(u.kind==='sampler2d')throw Error();u.values[0]=NaN;}
   if(kind==='shared')Object.assign(m,{palette:new Uint8Array(new SharedArrayBuffer(1024))});
  }
  expect(encodeSourceRootsPointNativeRequest(r)).toMatchObject({ok:false,error:{kind:'input'}});
 });
});
