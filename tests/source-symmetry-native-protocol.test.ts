import {describe,expect,it} from 'vitest';
import {SOURCE_FRAME_BUDGET} from '../src/engine/sourceDrawingFrame';
import {captureSourceIteratedNativeResponseBinding,decodeSourceIteratedNativeResponse,encodeSourceIteratedNativeRequest,sourceIteratedNativeProgramBytes,sourceSymmetryNativeResidentBytes,type SourceIteratedNativeOperation} from '../src/engine/sourceIteratedNativeProtocol';
import {sourceSymmetryNativeBindingsBytes} from '../src/engine/sourceSymmetryNativeBindings';
import {prepareSourceSymmetryCustomProgram} from '../src/engine/sourceSymmetryCustom';

const resource='11'.repeat(16),profile='source-fragment' as const;
const request=(operation:SourceIteratedNativeOperation)=>({generation:1,sequence:1,operation});
const program=prepareSourceSymmetryCustomProgram('uniform float steps;void calculate_next(in vec3 p,out vec3 q,out float m){q=p+steps;m=0.;}',5);
const creation=()=>request({kind:'create-fragment',resource,count:7,...program});
const advance=()=>request({kind:'advance-fragment',resource,expectedIndex:3,expectedCount:7,steps:3,reset:false,resetCounter:false,bindings:[{name:'steps',type:5126,values:[-0]},{name:'signedValue',type:5124,values:[-2147483648,2147483647]}]});
describe('source fragment wire admission and diagnostic identity',()=>{
 it('accounts square padding, matched-name ownership and parsed typed values before allocation',()=>{
  const input=creation(),encoded=encodeSourceIteratedNativeRequest(input);expect(encoded.ok).toBe(true);if(!encoded.ok)throw Error('fixture');
  const resident=sourceSymmetryNativeResidentBytes(7,sourceIteratedNativeProgramBytes(program),program.bindingNames);
  expect(resident).toBe(9*64+sourceIteratedNativeProgramBytes(program)+1024*1024+256+15);
  const retained=SOURCE_FRAME_BUDGET-resident-encoded.value.length*6;
  expect(encodeSourceIteratedNativeRequest(input,{retainedBytes:retained}).ok).toBe(true);expect(encodeSourceIteratedNativeRequest(input,{retainedBytes:retained+1})).toMatchObject({ok:false,error:{kind:'capacity'}});
  const step=advance(),wire=encodeSourceIteratedNativeRequest(step);if(!wire.ok||step.operation.kind!=='advance-fragment')throw Error('fixture');
  const boundary=SOURCE_FRAME_BUDGET-sourceSymmetryNativeBindingsBytes(step.operation.bindings)-wire.value.length*6;
  expect(encodeSourceIteratedNativeRequest(step,{retainedBytes:boundary}).ok).toBe(true);expect(encodeSourceIteratedNativeRequest(step,{retainedBytes:boundary+1})).toMatchObject({ok:false,error:{kind:'capacity'}});
  expect(encodeSourceIteratedNativeRequest(request({kind:'release',resource,profile}),{retainedBytes:SOURCE_FRAME_BUDGET+1}).ok).toBe(true);
 });
 it('rejects lossy integer values, malformed shapes, owner-controlled bindings and excessive scalar storage',()=>{
  for(const binding of [{name:'x',type:5124,values:[2147483648]},{name:'x',type:5124,values:[.5]},{name:'x',type:5126,values:[Infinity]},{name:'x',type:35675,values:[1]},{name:'x',type:35670,values:[2]},{name:'x',type:35678,values:[1]},{name:'stateTex',type:35678,values:[0]},{name:'iterations',type:5124,values:[1]},{name:'x',type:0,values:[1]},{name:'x',type:5126,values:Array(65537).fill(0)}]){
   const input=advance();Object.assign(input.operation,{bindings:[binding]});expect(encodeSourceIteratedNativeRequest(input)).toMatchObject({ok:false,error:{kind:'input'}});
  }
  const input=advance();Object.assign(input.operation,{steps:17});expect(encodeSourceIteratedNativeRequest(input)).toMatchObject({ok:false,error:{kind:'input'}});
 });
 it('binds the captured profile and completed-pass unit independently of later caller changes',()=>{
  const input=request({kind:'read',resource,profile,expectedIndex:3,expectedCount:7,offset:6,count:1}),binding=captureSourceIteratedNativeResponseBinding(input);
  const raw=new Uint8Array(88),view=new DataView(raw.buffer);[2,4,...Array(4).fill(0),3,0,7,7,6,1,0,1,1,0].forEach((n,i)=>view.setUint32(i*4,n,true));raw.set(Uint8Array.from(Array(16).fill(17)),8);view.setUint32(64,0x80000000,true);view.setUint32(80,2,true);
  Object.assign(input.operation,{profile:undefined});expect(decodeSourceIteratedNativeResponse(raw,binding)).toMatchObject({diagnosticUnit:'completed-pass',invalidCounts:new Uint32Array([2])});
  expect(()=>decodeSourceIteratedNativeResponse(raw,input)).toThrow('profile');
  for(const offset of [52,56]){const bad=raw.slice();new DataView(bad.buffer).setUint32(offset,0,true);expect(()=>decodeSourceIteratedNativeResponse(bad,binding)).toThrow('profile');}
 });
});
