import {describe,it,expect,vi} from 'vitest';
import * as THREE from 'three';
import {createSourceShaderMaterial} from '../src/engine/sourceShaderMaterial';
import {prepareSourceDrawingPlan,snapshotSourceDrawings,type SourceDrawingResult,type SourceDrawingPlan,type SourceDrawingChunk} from '../src/engine/sourceDrawingSnapshot';
import {SOURCE_DRAWING_MAX_CHUNK_BYTES,sourceDrawingChunkPeak} from '../src/engine/sourceDrawingBudget';
const take=<T>(r:SourceDrawingResult<T>):T=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
function fixture(instances=11,contract=true){
 const geometry=new THREE.InstancedBufferGeometry();
 geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array([0,0,0,1,0,0,0,1,0]),3));
 const values=new Float32Array(instances*4);for(let i=0;i<values.length;i++)values[i]=i;
 const buffer=new THREE.InstancedInterleavedBuffer(values,4);
 geometry.setAttribute('a',new THREE.InterleavedBufferAttribute(buffer,2,0));geometry.setAttribute('b',new THREE.InterleavedBufferAttribute(buffer,2,2));
 geometry.instanceCount=instances;geometry.setIndex(new THREE.BufferAttribute(new Uint16Array([0,1,2]),1));
 const texture=new THREE.DataTexture(new Uint8Array([1,2,3,4]),1,1,THREE.RGBAFormat);texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.generateMipmaps=true;
 const material=createSourceShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:'in vec3 position;void main(){gl_Position=vec4(position,1.0);}',fragmentShader:'out vec4 color;void main(){color=vec4(1.0);}',side:THREE.DoubleSide,forceSinglePass:false,transparent:true,depthTest:true,depthWrite:true,toneMapped:false,blending:THREE.CustomBlending,blendEquation:THREE.AddEquation,blendSrc:THREE.SrcAlphaFactor,blendDst:THREE.OneMinusSrcAlphaFactor,blendEquationAlpha:THREE.AddEquation,blendSrcAlpha:THREE.OneFactor,blendDstAlpha:THREE.OneFactor,uniforms:{amount:{kind:'float',value:1},sprite:{kind:'sampler2d',value:texture}}},contract?{rangeIdentity:'attribute-only'}:undefined);
 const mesh=new THREE.Mesh(geometry,material);
 return{mesh,geometry,material,texture,values,dispose(){geometry.dispose();material.dispose();texture.dispose();}};
}
function cap(f:ReturnType<typeof fixture>,instances:number){const p=take(prepareSourceDrawingPlan([f.mesh])),n=p.maxChunkBytes-f.values.byteLength+instances*16;take(p.dispose());return n;}
function drain(plan:SourceDrawingPlan,visit:(chunk:SourceDrawingChunk)=>void){for(;;){const chunk=take(plan.next());if(!chunk)break;visit(chunk);take(chunk.release());}take(plan.dispose());}
describe('complete admission and one owned source draw range',()=>{
 it('preserves command/pass/range order and exact instance words across bounded chunks',()=>{
  const f=fixture(),g=fixture(4);try{
   new Uint32Array(f.values.buffer).set([0x7fc12345,0x80000000,0x7f800000,0xff800000]);
   const full=take(snapshotSourceDrawings([f.mesh,g.mesh])),plan=take(prepareSourceDrawingPlan([f.mesh,g.mesh],{maxChunkBytes:cap(f,3)+2000}));
   // Force a small range for both declarations without assuming UTF-8 overhead.
   const fixed=plan.maxChunkBytes-f.values.byteLength;take(plan.dispose());
   const small=take(prepareSourceDrawingPlan([f.mesh,g.mesh],{maxChunkBytes:fixed+3*16})),rows:unknown[]=[],words:number[]=[];
   expect(small.schedule.map(x=>x.rangeSize)).toEqual([3,3]);
   let texture:unknown,uniforms:unknown;
   drain(small,c=>{rows.push([c.commandIndex,c.passIndex,c.offset,c.count]);const draw=c.drawing.commands[0];expect(draw.passes).toEqual([c.passIndex?'front':'back']);
    if(!texture)texture=c.drawing.textures[0];else expect(c.drawing.textures[0]).toBe(texture);
    if(c.commandIndex===0){if(!uniforms)uniforms=draw.uniforms;else expect(draw.uniforms).toBe(uniforms);if(c.passIndex===0)words.push(...new Uint32Array(draw.attributes.find(a=>a.name==='a')!.values.buffer));}
   });
   expect(rows).toEqual([[0,0,0,3],[0,0,3,3],[0,0,6,3],[0,0,9,2],[0,1,0,3],[0,1,3,3],[0,1,6,3],[0,1,9,2],[1,0,0,3],[1,0,3,1],[1,1,0,3],[1,1,3,1]]);
   expect(words).toEqual(Array.from(new Uint32Array(full.commands[0].attributes.find(a=>a.name==='a')!.values.buffer)));
  }finally{f.dispose();g.dispose();}
 });
 it('validates the final command before packing any normalized attribute or creating a chunk',()=>{
  const a=fixture(),b=fixture();try{const tint=new THREE.InstancedBufferAttribute(new Uint8Array(11*3),3,true);a.geometry.setAttribute('tint',tint);const read=vi.spyOn(tint,'getComponent');b.material.uniforms.amount.value=Infinity;
   expect(prepareSourceDrawingPlan([a.mesh,b.mesh])).toMatchObject({ok:false,error:{kind:'input'}});expect(read).not.toHaveBeenCalled();
  }finally{a.dispose();b.dispose();}
 });
 it('deduplicates mathematical backing storage and rejects one byte below the single-instance peak before packing',()=>{
  const f=fixture();try{const extra=new ArrayBuffer(31),base=take(prepareSourceDrawingPlan([f.mesh],{maxChunkBytes:cap(f,1),retainedBuffers:[f.values.buffer,extra,extra],additionalBytes:17,frameBytes:5000}));
   expect(base.retainedBytes).toBe(base.retainedBufferBytes+31+17);expect(base.peakBytes).toBe(sourceDrawingChunkPeak({retainedBytes:base.retainedBytes,frameBytes:5000,metadataBytes:base.admittedMetadataBytes,scheduleCount:base.schedule.length,maxChunkBytes:base.maxChunkBytes}));
   const boundary=base.peakBytes;take(base.dispose());expect(prepareSourceDrawingPlan([f.mesh],{retainedBuffers:[f.values.buffer,extra],additionalBytes:17,frameBytes:5000,maxBytes:boundary-1})).toMatchObject({ok:false,error:{kind:'capacity'}});
   take(take(prepareSourceDrawingPlan([f.mesh],{retainedBuffers:[f.values.buffer,extra],additionalBytes:17,frameBytes:5000,maxBytes:boundary})).dispose());
  }finally{f.dispose();}
 });
 it('shrinks ranges to the joint budget while preserving complete transparent pass order and source words',()=>{
  const f=fixture();try{
   new Uint32Array(f.values.buffer).set([0x7fc12345,0x80000000,0x7f800000,0xff800000]);
   const admitted=take(prepareSourceDrawingPlan([f.mesh],{additionalBytes:31,frameBytes:5000})),maxChunkBytes=cap(f,3);
   const limit=sourceDrawingChunkPeak({retainedBytes:admitted.retainedBytes,frameBytes:5000,metadataBytes:admitted.admittedMetadataBytes,scheduleCount:admitted.schedule.length,maxChunkBytes});take(admitted.dispose());
   const plan=take(prepareSourceDrawingPlan([f.mesh],{additionalBytes:31,frameBytes:5000,maxBytes:limit})),rows:unknown[]=[];
   expect(plan.maxChunkBytes).toBe(maxChunkBytes);expect(plan.peakBytes).toBe(limit);expect(plan.chunkCount).toBe(8);
   drain(plan,c=>{rows.push([c.passIndex,c.offset,c.count]);const d=c.drawing.commands[0];for(const [name,slot]of [['a',0],['b',2]] as const){
    const words=new Uint32Array(d.attributes.find(a=>a.name===name)!.values.buffer),expected=new Uint32Array(f.values.buffer);let mismatch=false;
    for(let i=0;i<c.count;i++)for(let k=0;k<2;k++)if(words[i*2+k]!==expected[(c.offset+i)*4+slot+k])mismatch=true;
    expect(mismatch).toBe(false);
   }});
   expect(rows).toEqual([[0,0,3],[0,3,3],[0,6,3],[0,9,2],[1,0,3],[1,3,3],[1,6,3],[1,9,2]]);
  }finally{f.dispose();}
 });
 it('defaults to the shared 4 MiB ceiling and rejects a larger caller ceiling before copying',()=>{
  const f=fixture(300000);try{
   const textureRead=vi.spyOn(f.texture.image.data,'subarray');expect(prepareSourceDrawingPlan([f.mesh],{maxChunkBytes:SOURCE_DRAWING_MAX_CHUNK_BYTES+1})).toMatchObject({ok:false,error:{kind:'input',path:['maxChunkBytes']}});expect(textureRead).not.toHaveBeenCalled();
   const plan=take(prepareSourceDrawingPlan([f.mesh]));expect(plan.maxChunkBytes).toBeGreaterThan(1024*1024);expect(plan.maxChunkBytes).toBeLessThanOrEqual(SOURCE_DRAWING_MAX_CHUNK_BYTES);expect(plan.chunkCount).toBe(4);
   const counts=[0,0];drain(plan,c=>{counts[c.passIndex]+=c.count;expect(c.count).toBeLessThanOrEqual(plan.schedule[0].rangeSize);});expect(counts).toEqual([300000,300000]);
  }finally{f.dispose();}
 });
 it('adapts to exactly one triangle and rejects one byte less without copying textures or normalized attributes',()=>{
  const f=fixture(1);try{
   f.geometry.deleteAttribute('a');f.geometry.deleteAttribute('b');f.geometry.instanceCount=1;
   const values=new Float32Array(60);f.geometry.setAttribute('position',new THREE.BufferAttribute(values,3));const tint=new THREE.BufferAttribute(new Uint8Array(60).fill(127),3,true);f.geometry.setAttribute('tint',tint);
   const index=new Uint32Array([2,0,2,1,0,1]);f.geometry.setIndex(new THREE.BufferAttribute(index,1));
   const full=take(prepareSourceDrawingPlan([f.mesh])),fixed=full.maxChunkBytes-values.byteLength-60*4-index.byteLength;
   const limit=sourceDrawingChunkPeak({retainedBytes:full.retainedBytes,frameBytes:0,metadataBytes:full.admittedMetadataBytes,scheduleCount:full.schedule.length,maxChunkBytes:fixed+3*6*4});take(full.dispose());
   const read=vi.spyOn(tint,'getComponent'),textureRead=vi.spyOn(f.texture.image.data,'subarray');
   expect(prepareSourceDrawingPlan([f.mesh],{maxBytes:limit-1})).toMatchObject({ok:false,error:{kind:'capacity'}});expect(read).not.toHaveBeenCalled();expect(textureRead).not.toHaveBeenCalled();
   const plan=take(prepareSourceDrawingPlan([f.mesh],{maxBytes:limit}));expect(plan.peakBytes).toBe(limit);expect(plan.schedule[0]).toMatchObject({rangeKind:'vertices',rangeSize:3,total:6});expect(read).not.toHaveBeenCalled();
   let vertices=0;drain(plan,c=>{vertices+=c.count;});expect(vertices).toBe(12);expect(read).toHaveBeenCalled();
  }finally{f.dispose();}
 });
 it('requires ACK release before advancing and retains a failed disposal until the in-flight range is released',()=>{
  const f=fixture();try{const p=take(prepareSourceDrawingPlan([f.mesh],{maxChunkBytes:cap(f,2)})),chunk=take(p.next())!;
   expect(p.next()).toMatchObject({ok:false,error:{kind:'input'}});expect(p.dispose()).toMatchObject({ok:false,error:{kind:'input'}});expect(chunk.drawing.commands).toHaveLength(1);
   take(chunk.release());expect(()=>chunk.drawing).toThrow('已释放');expect(chunk.release()).toMatchObject({ok:false,error:{kind:'input'}});take(p.dispose());expect(p.next()).toMatchObject({ok:false,error:{kind:'input'}});
  }finally{f.dispose();}
 });
 it('invalidates borrowed ranges after renderer revision changes, while still permitting in-flight cleanup',()=>{
  const f=fixture();try{let current=true;const p=take(prepareSourceDrawingPlan([f.mesh],{maxChunkBytes:cap(f,2),isCurrent:()=>current})),chunk=take(p.next())!;current=false;take(chunk.release());
   expect(p.next()).toMatchObject({ok:false,error:{kind:'cancelled'}});take(p.dispose());
  }finally{f.dispose();}
 });
 it('keeps immutable uniform and texture declarations across chunks even if source cells later change',()=>{
  const f=fixture();try{const p=take(prepareSourceDrawingPlan([f.mesh],{maxChunkBytes:cap(f,2)}));f.material.uniforms.amount.value=9;f.texture.image.data[0]=99;
   drain(p,c=>{expect(c.drawing.commands[0].uniforms[0]).toMatchObject({values:new Float32Array([1])});expect(c.drawing.textures[0].pixels[0]).toBe(1);});
  }finally{f.dispose();}
 });
 it('does not infer shader range independence and retains original draw identity for a small undeclared draw',()=>{
  const f=fixture(11,false);try{const full=take(snapshotSourceDrawings([f.mesh])),p=take(prepareSourceDrawingPlan([f.mesh]));expect(p.schedule[0].rangeKind).toBe('draw');
   drain(p,c=>{expect(c.drawing.commands[0]).toEqual({...full.commands[0],passes:[c.passIndex?'front':'back']});});
   expect(prepareSourceDrawingPlan([f.mesh],{maxChunkBytes:cap(f,2)})).toMatchObject({ok:false,error:{kind:'unsupported'}});
  }finally{f.dispose();}
 });
 it('deindexes only declared vertex ranges without changing duplicate index order or floating-point bits',()=>{
  const f=fixture(1);try{f.geometry.deleteAttribute('a');f.geometry.deleteAttribute('b');f.geometry.instanceCount=1;
   const values=new Float32Array(60);for(let i=0;i<values.length;i++)values[i]=i;new Uint32Array(values.buffer)[1]=0x80000000;
   f.geometry.setAttribute('position',new THREE.BufferAttribute(values,3));const indices=new Uint32Array([2,0,2,1,0,1]);f.geometry.setIndex(new THREE.BufferAttribute(indices,1));
   const full=take(prepareSourceDrawingPlan([f.mesh])),fixed=full.maxChunkBytes-values.byteLength-indices.byteLength;take(full.dispose());
   const p=take(prepareSourceDrawingPlan([f.mesh],{maxChunkBytes:fixed+36})),actual:number[]=[];
   expect(p.schedule[0]).toMatchObject({rangeKind:'vertices',total:6,rangeSize:3});
   drain(p,c=>{const d=c.drawing.commands[0];expect(d).toMatchObject({first:0,count:3,instances:1,index:undefined});if(c.passIndex===0)actual.push(...new Uint32Array(d.attributes[0].values.buffer));});
   expect(actual).toEqual(Array.from(indices).flatMap(i=>Array.from(new Uint32Array(values.buffer,i*12,3))));
  }finally{f.dispose();}
 });
 it('publishes no partial chunk when cancellation interrupts normalized packing',()=>{
  const f=fixture();try{let cancelled=false;const tint=new THREE.InstancedBufferAttribute(new Uint8Array(33),3,true);f.geometry.setAttribute('tint',tint);const p=take(prepareSourceDrawingPlan([f.mesh],{isCancelled:()=>cancelled}));const get=tint.getComponent.bind(tint);vi.spyOn(tint,'getComponent').mockImplementation((i,k)=>{cancelled=true;return get(i,k);});
   expect(p.next()).toMatchObject({ok:false,error:{kind:'cancelled'}});take(p.dispose());
  }finally{f.dispose();}
 });
 it('admits an empty frame and refuses invalid or detached retained inputs',()=>{
  const p=take(prepareSourceDrawingPlan([]));expect(p.chunkCount).toBe(0);expect(take(p.next())).toBeUndefined();take(p.dispose());
  const buffer=new ArrayBuffer(4);structuredClone(buffer,{transfer:[buffer]});expect(prepareSourceDrawingPlan([],{retainedBuffers:[buffer]})).toMatchObject({ok:false,error:{kind:'input'}});
  expect(prepareSourceDrawingPlan([],{additionalBytes:-1})).toMatchObject({ok:false,error:{kind:'input'}});
 });
 it('refuses a borrowed source transferred between ACKs instead of filling the next range with zeros',()=>{
  const f=fixture();try{const p=take(prepareSourceDrawingPlan([f.mesh],{maxChunkBytes:cap(f,2)})),first=take(p.next())!;take(first.release());structuredClone(f.values,{transfer:[f.values.buffer]});expect(p.next()).toMatchObject({ok:false,error:{kind:'input'}});take(p.dispose());}finally{f.dispose();}
 });
});
