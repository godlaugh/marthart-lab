import {describe,it,expect} from 'vitest';
import {create,begin,request,packet,reply,resource} from './source-roots-point-native-fixture';
import {sourceRootsPointNativeFrameSchedule} from '../src/engine/sourceRootsPointNativeProtocol';
// @ts-expect-error Node host modules deliberately stay outside the browser.
import {inspectSourceFrameHeader} from '../server/source-renderer.mjs';
// @ts-expect-error Node host modules deliberately stay outside the browser.
import {admitRootsPointRequest,inspectRootsPointResponse} from '../server/source-roots-point-protocol.mjs';
const inspect=(r:ReturnType<typeof create>)=>{const h=inspectSourceFrameHeader(packet(r));expect(h.ok,JSON.stringify(h.error)).toBe(true);return h.value;};
function initialized(){const r=create(),e=inspect(r),ack=inspectRootsPointResponse(Buffer.from(reply(r)),e);expect(ack.ok).toBe(true);return new Map([[`roots-point:${resource}`,ack.value]]);}
function active(){const owners=initialized(),r=begin(),e={...inspect(r),owned:owners.get(`roots-point:${resource}`)};expect(admitRootsPointRequest(e,owners).ok).toBe(true);const ack=inspectRootsPointResponse(Buffer.from(reply(r)),e);expect(ack.ok).toBe(true);owners.set(`roots-point:${resource}`,ack.value);return{owners,r};}
describe('Roots point gateway ownership and complete coverage',()=>{
 it('accepts the actual producer metadata and freezes wire ranges before caller mutation',()=>{const r=begin(),bytes=packet(r),e=inspectSourceFrameHeader(bytes).value;bytes.fill(0);expect(e.rangeCounts).toEqual([5,2]);expect(Object.isFrozen(e.rangeCounts)).toBe(true);expect(e.responseBytes).toBe(96);});
 it('rejects a second resource for the same session role before native dispatch',()=>{const owners=initialized(),r=create();r.operation.resource='56'.repeat(16);expect(admitRootsPointRequest(inspect(r),owners)).toMatchObject({ok:false,error:{kind:'ownership'}});});
 it('permits a separate offscreen role and independent cold session within budget',()=>{const owners=initialized();for(const choice of ['role','session']){const r=create();r.operation.resource='56'.repeat(16);if(r.operation.kind!=='create')throw Error();if(choice==='role')r.operation.target='offscreen';else r.operation.session='78'.repeat(16);expect(admitRootsPointRequest(inspect(r),owners)).toEqual({ok:true});}});
 it('rejects incomplete finish, latches failed ownership and still admits exact cleanup',()=>{const {owners,r}=active();if(r.operation.kind!=='begin')throw Error();const finish=request({kind:'finish',resource,expectedDisplay:0,frame:sourceRootsPointNativeFrameSchedule(r.operation)}),e={...inspect(finish),owned:owners.get(`roots-point:${resource}`)};expect(admitRootsPointRequest(e,owners)).toMatchObject({ok:false,error:{kind:'input'}});expect(e.owned.failed).toBe(true);expect(admitRootsPointRequest({...inspect(request({kind:'release',resource})),owned:e.owned},owners)).toEqual({ok:true});});
 it('accepts exactly the admitted ordered two-range coverage and complete finish ACK',()=>{
  const {owners,r}=active();if(r.operation.kind!=='begin')throw Error();const frame=sourceRootsPointNativeFrameSchedule(r.operation);
  for(const [ordinal,rangeIndex,rangeOffset,count] of [[0,0,0,3],[1,0,3,2],[2,1,0,2]]){
   const a=request({kind:'append',resource,expectedDisplay:0,ordinal,rangeIndex,rangeOffset,points:new Float32Array(count*4),frame}),e={...inspect(a),owned:owners.get(`roots-point:${resource}`)};
   expect(admitRootsPointRequest(e,owners)).toEqual({ok:true});const next=inspectRootsPointResponse(Buffer.from(reply(a)),e);expect(next.ok,JSON.stringify(next.error)).toBe(true);owners.set(`roots-point:${resource}`,next.value);
  }
  const f=request({kind:'finish',resource,expectedDisplay:0,frame}),e={...inspect(f),owned:owners.get(`roots-point:${resource}`)};expect(admitRootsPointRequest(e,owners)).toEqual({ok:true});expect(inspectRootsPointResponse(Buffer.from(reply(f)),e)).toMatchObject({ok:true,value:{displayIndex:1,phase:0,receivedPoints:7,totalPoints:7,pointDraws:3,transaction:false}});
 });
 it.each([44,48,52,56,60,64,68])('rejects forged native coverage field at %i',offset=>{const {owners,r}=active(),e={...inspect(r),owned:owners.get(`roots-point:${resource}`)},raw=Buffer.from(reply(r));raw.writeUInt32LE(raw.readUInt32LE(offset)+1,offset);expect(inspectRootsPointResponse(raw,e).ok).toBe(false);});
 it('rejects packet trailing bytes, unprepared metric and missing initial clear',()=>{
  const r=begin(),bytes=Buffer.from(packet(r));bytes.writeUInt32LE(0,92);expect(inspectSourceFrameHeader(bytes).ok).toBe(false);
  if(r.operation.kind!=='begin')throw Error();const a=request({kind:'append',resource,expectedDisplay:0,ordinal:0,rangeIndex:0,rangeOffset:0,points:new Float32Array(12),frame:sourceRootsPointNativeFrameSchedule(r.operation)}),raw=Buffer.from(packet(a));raw.writeFloatLE(NaN,124);expect(inspectSourceFrameHeader(raw).ok).toBe(false);
  const extra=Buffer.concat([Buffer.from(packet(create())),Buffer.alloc(4)]);extra.writeUInt32LE(extra.length,8);expect(inspectSourceFrameHeader(extra).ok).toBe(false);
 });
 it('preserves raw nonfinite XYZ and signed-zero metric bytes without adding a filter',()=>{const r=begin();if(r.operation.kind!=='begin')throw Error();const points=new Float32Array(12);new Uint32Array(points.buffer).set([0x7fc12345,0x7f800000,0xff800000,0x80000000]);const raw=packet(request({kind:'append',resource,expectedDisplay:0,ordinal:0,rangeIndex:0,rangeOffset:0,points,frame:sourceRootsPointNativeFrameSchedule(r.operation)}));expect(inspectSourceFrameHeader(raw).ok).toBe(true);expect(new DataView(raw.buffer).getUint32(112,true)).toBe(0x7fc12345);});
 it('requires the actual core point-size range when admitting per-draw footprint',()=>{const owners=initialized(),r=begin();r.width=500;r.height=600;if(r.operation.kind!=='begin')throw Error();r.operation.chunkPoints=65536;r.operation.rangeCounts=[65536];const owned=owners.get(`roots-point:${resource}`);owned.width=500;owned.height=600;const uniform=r.operation.metadata.uniforms.find(u=>u.name==='pointSize');if(!uniform||uniform.kind==='sampler2d')throw Error();uniform.values[0]=64;expect(admitRootsPointRequest({...inspect(r),owned},owners)).toMatchObject({ok:false,error:{kind:'capacity'}});});
 it('admits the complete future readback before begin changes retained history',()=>{
  const c=create();c.width=4096;c.height=3900;const ce=inspect(c),ack=inspectRootsPointResponse(Buffer.from(reply(c)),ce);expect(ack.ok).toBe(true);
  const owners=new Map([[`roots-point:${resource}`,ack.value]]),raw=Buffer.from(packet(begin()));raw.writeUInt32LE(c.width,20);raw.writeUInt32LE(c.height,24);
  const parsed=inspectSourceFrameHeader(raw);expect(parsed.ok).toBe(true);const e={...parsed.value,owned:ack.value};expect(e.responseBytes).toBe(96);expect(e.admissionResponseBytes).toBe(96+c.width*c.height*4);
  expect(admitRootsPointRequest(e,owners)).toMatchObject({ok:false,error:{kind:'capacity'}});expect(ack.value).toMatchObject({displayIndex:0,phase:0});expect(ack.value.failed).toBeUndefined();
 });
 it('admits the largest future append before clearing a small target near capacity',()=>{
  const owners=initialized(),owned=owners.get(`roots-point:${resource}`);owners.set('roots-point:other',{...owned,resource:'56'.repeat(16),residentBytes:256*1024*1024-owned.residentBytes-4*1024*1024});
  const r=begin();if(r.operation.kind!=='begin')throw Error();r.operation.chunkPoints=65536;r.operation.rangeCounts=[65536];
  expect(admitRootsPointRequest({...inspect(r),owned},owners)).toMatchObject({ok:false,error:{kind:'capacity'}});expect(owned.failed).toBeUndefined();
  r.operation.chunkPoints=16384;expect(admitRootsPointRequest({...inspect(r),owned},owners)).toEqual({ok:true});
 });
 it('accepts proof of absent/released cleanup without pretending unknown previous work completed',()=>{const r=request({kind:'release',resource}),e=inspect(r);expect(inspectRootsPointResponse(Buffer.from(reply(r)),e)).toMatchObject({ok:true,value:{disposition:2,width:1,height:1}});const released=Buffer.from(reply(r,{28:1,32:2,36:3,40:2,44:3,48:7,52:1,56:3,60:2,80:1}));expect(inspectRootsPointResponse(released,e)).toMatchObject({ok:true,value:{disposition:1,phase:2,pointDraws:2}});});
});
