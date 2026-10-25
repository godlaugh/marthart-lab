import {describe,expect,it} from 'vitest';
import {SOURCE_FRAME_BUDGET} from '../src/engine/sourceDrawingFrame';
import {captureSourceIteratedNativeResponseBinding,decodeSourceIteratedNativeResponse,encodeSourceIteratedNativeRequest,sourceSymmetryNativeResidentBytes,type SourceIteratedNativeOperation} from '../src/engine/sourceIteratedNativeProtocol';
import {sourceSymmetryNativeProcessingBytes} from '../src/engine/sourceSymmetryNativeBindings';
// @ts-expect-error The Node transport owner is separate from browser contracts.
import {inspectSourceFrameHeader} from '../server/source-renderer.mjs';

const resource='31'.repeat(16);
const operation=():Extract<SourceIteratedNativeOperation,{kind:'advance-processing-fragment'}>=>({kind:'advance-processing-fragment',resource,expectedCount:7,expectedIndex:4,steps:3,reset:false,resetCounter:false,automatic:[{names:['viewport','fallback'],type:35666,values:[-0,0,405,486]}],parameters:[{name:'iterations',value:12},{name:'123',value:7}]});
const request=()=>({generation:1,sequence:5,operation:operation()});
function encoded(){const r=request(),wire=encodeSourceIteratedNativeRequest(r);if(!wire.ok)throw Error(wire.error.reason);return{r,wire:wire.value};}
function reply(){
 const b=new Uint8Array(84),v=new DataView(b.buffer);[2,9,0,0,0,0,5,0,7,7,0,0,3,1,1,1,1,2,4,3,1].forEach((n,i)=>v.setUint32(i*4,n,true));b.set(new Uint8Array(16).fill(0x31),8);return b;
}
describe('source Processing setter wire and response identity',()=>{
 it('encodes explicit setter intent and raw matcher facts without captured reflection',()=>{
  const {wire}=encoded(),v=new DataView(wire.buffer);expect(v.getUint32(4,true)).toBe(9);expect(v.getUint32(64,true)).toBe(9);expect(v.getUint32(104,true)).toBe(1);expect(v.getUint32(108,true)).toBe(2);
  expect(inspectSourceFrameHeader(wire)).toMatchObject({ok:true,value:{fragmentProfile:true,operation:9,automaticAliases:[2],parameterCount:2,processingBytes:20}});
  const program={vertex:'#version 410 core\nvoid main(){}',fragment:'#version 410 core\nvoid main(){}',bindingNames:['iterations','stateTex','gl_unused','123']};
  expect(encodeSourceIteratedNativeRequest({generation:1,sequence:1,operation:{kind:'create-fragment',resource,count:7,...program}}).ok).toBe(true);
 });
 it('preserves selected alias and per-parameter failure/absence independently of caller mutation',()=>{
  const {r}=encoded(),binding=captureSourceIteratedNativeResponseBinding(r);(r.operation.automatic[0].names as string[])[1]='changed';(r.operation.parameters[1] as {name:string}).name='changed';
  expect(decodeSourceIteratedNativeResponse(reply(),binding).processingBindings).toEqual({automatic:[{outcome:'applied',selectedName:'fallback'}],parameters:[{name:'iterations',outcome:'rejected'},{name:'123',outcome:'inactive'}]});
 });
 it.each([[60,0],[64,2],[68,1],[72,6],[76,4],[80,0],[24,4],[52,0],[56,0]])('rejects forged response word at %s', (at,n)=>{
  const raw=reply();new DataView(raw.buffer).setUint32(at,n,true);expect(()=>decodeSourceIteratedNativeResponse(raw,request())).toThrow();
 });
 it('requires skipped binding results for zero-step reset operations',()=>{
  const r=request();r.operation.steps=0;r.operation.reset=true;r.operation.resetCounter=true;const raw=reply(),v=new DataView(raw.buffer);v.setUint32(48,0,true);for(const at of [72,76,80])v.setUint32(at,0,true);
  expect(decodeSourceIteratedNativeResponse(raw,r).processingBindings?.automatic).toEqual([{outcome:'skipped'}]);v.setUint32(72,1,true);expect(()=>decodeSourceIteratedNativeResponse(raw,r)).toThrow();
 });
 it('accounts parsed setters and decoded response objects at the shared capacity boundary',()=>{
  const {r,wire}=encoded(),transient=sourceSymmetryNativeProcessingBytes(r.operation.automatic,r.operation.parameters),retained=SOURCE_FRAME_BUDGET-transient-wire.length*6;
  expect(retained).toBeGreaterThan(sourceSymmetryNativeResidentBytes(7,0));expect(encodeSourceIteratedNativeRequest(r,{retainedBytes:retained}).ok).toBe(true);expect(encodeSourceIteratedNativeRequest(r,{retainedBytes:retained+1})).toMatchObject({ok:false,error:{kind:'capacity'}});
 });
 it('rejects malformed aliases, values and matcher names before encoding',()=>{
  const bad=[{automatic:[{names:[],type:5124,values:[0]}]},{automatic:[{names:['x','x'],type:5124,values:[0]}]},{automatic:[{names:['stateTex'],type:5124,values:[0]}]},{automatic:[{names:['x'],type:5124,values:[.5]}]},{automatic:[{names:['x'],type:35676,values:[1]}]},{automatic:[{names:['x'],type:5126,values:[1]}]},{parameters:[{name:'bad.dot',value:1}]},{parameters:[{name:'123',value:Infinity}]},{parameters:[{name:'x',value:1},{name:'x',value:2}]}];
  for(const changed of bad){const r=request();Object.assign(r.operation,changed);expect(encodeSourceIteratedNativeRequest(r)).toMatchObject({ok:false,error:{kind:'input'}});}
 });
 it.each([104,108,112,116])('rejects oversized/truncated wire collections at %s without allocation',at=>{
  const {wire}=encoded();new DataView(wire.buffer).setUint32(at,0xffffffff,true);expect(inspectSourceFrameHeader(wire)).toMatchObject({ok:false,error:{kind:'input'}});
 });
});
