import {describe,it,expect,vi} from 'vitest';
import * as THREE from 'three';
import {createSourceShaderMaterial} from '../src/engine/sourceShaderMaterial';
import {snapshotSourceDrawings,type SourceDrawingResult} from '../src/engine/sourceDrawingSnapshot';

const take=<T>(result:SourceDrawingResult<T>):T=>{if(!result.ok)throw Error(JSON.stringify(result.error));return result.value;};
function fixture(){
  const geometry=new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array([0,0,0,1,0,0,0,1,0]),3));
  const interleaved=new THREE.InstancedInterleavedBuffer(new Float32Array([2,3,4,5,6,7,8,9]),4);
  geometry.setAttribute('first',new THREE.InterleavedBufferAttribute(interleaved,2,0));
  geometry.setAttribute('second',new THREE.InterleavedBufferAttribute(interleaved,2,2));
  geometry.setIndex(new THREE.BufferAttribute(new Uint16Array([0,1,2]),1));geometry.instanceCount=2;
  const texture=new THREE.DataTexture(new Uint8Array([1,2,3,4]),1,1,THREE.RGBAFormat);
  texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.generateMipmaps=true;texture.anisotropy=4;
  const material=createSourceShaderMaterial({
    glslVersion:THREE.GLSL3,vertexShader:'in vec3 position;void main(){gl_Position=vec4(position,1.0);}',fragmentShader:'out vec4 color;void main(){color=vec4(1.0);}',
    side:THREE.DoubleSide,forceSinglePass:false,transparent:true,depthTest:true,depthWrite:true,toneMapped:false,
    blending:THREE.CustomBlending,blendEquation:THREE.AddEquation,blendSrc:THREE.SrcAlphaFactor,blendDst:THREE.OneMinusSrcAlphaFactor,
    blendEquationAlpha:THREE.AddEquation,blendSrcAlpha:THREE.OneFactor,blendDstAlpha:THREE.OneFactor,
    uniforms:{
      // Deliberately misleading names: declared kinds, not names or GLSL, win.
      perspective:{kind:'float',value:1.25},renamedMode:{kind:'int',value:2},
      pair:{kind:'ivec2',value:[0,1]},matrix:{kind:'mat4',value:new THREE.Matrix4()},
      params:{kind:'float-array',count:2,value:new Float32Array([3,4])},
      sprite:{kind:'sampler2d',value:texture},sameSprite:{kind:'sampler2d',value:texture},
    },
  });
  const mesh=new THREE.Mesh(geometry,material);
  return{mesh,geometry,material,texture,dispose(){geometry.dispose();material.dispose();texture.dispose();}};
}

describe('owned source drawing snapshots',()=>{
  it('preserves declared types, interleaved instance identity, index width and face passes',()=>{
    const f=fixture();try{
      f.material.uniforms.renamedMode.value=7;
      const snapshot=take(snapshotSourceDrawings([f.mesh])),draw=snapshot.commands[0];
      expect(draw.index).toBeInstanceOf(Uint16Array);expect(draw.instances).toBe(2);
      expect(draw.passes).toEqual(['back','front']);expect(draw.frontFace).toBe('counter-clockwise');
      expect(Array.from(draw.attributes.find(a=>a.name==='first')!.values)).toEqual([2,3,6,7]);
      expect(Array.from(draw.attributes.find(a=>a.name==='second')!.values)).toEqual([4,5,8,9]);
      expect(draw.attributes.find(a=>a.name==='first')!.divisor).toBe(1);
      expect(draw.uniforms.find(u=>u.name==='perspective')).toMatchObject({kind:'float',values:new Float32Array([1.25])});
      expect(draw.uniforms.find(u=>u.name==='renamedMode')).toMatchObject({kind:'int',values:new Int32Array([7])});
      expect(draw.uniforms.find(u=>u.name==='pair')).toMatchObject({kind:'ivec2',values:new Int32Array([0,1])});
      expect(draw.uniforms.find(u=>u.name==='params')).toMatchObject({kind:'float-array',count:2,values:new Float32Array([3,4])});
      expect(snapshot.textures).toHaveLength(1);expect(snapshot.textures[0].anisotropy).toBe(4);
      expect(draw.uniforms.filter(u=>u.kind==='sampler2d').map(u=>u.texture)).toEqual([0,0]);
      expect(snapshot.retainedBufferBytes).toBe(36+32+6+8+4);
      f.geometry.getAttribute('position').setX(0,99);f.texture.image.data[0]=200;f.material.uniforms.params.value[0]=50;f.dispose();
      expect(draw.attributes.find(a=>a.name==='position')!.values[0]).toBe(0);
      expect(snapshot.textures[0].pixels[0]).toBe(1);
      expect(draw.uniforms.find(u=>u.name==='params')).toMatchObject({values:new Float32Array([3,4])});
      expect(snapshotSourceDrawings([f.mesh])).toMatchObject({ok:false,error:{kind:'unsupported'}});
    }finally{f.dispose();}
  });

  it('preserves raw Float32 words, nonfinite slots and caller draw range',()=>{
    const f=fixture();try{
      const position=f.geometry.getAttribute('position').array as Float32Array;
      const bits=new Uint32Array(position.buffer);bits[0]=0x7fc12345;bits[1]=0x80000000;bits[2]=0x7f800000;
      f.geometry.setIndex(new THREE.BufferAttribute(new Uint32Array([2,1,0,0,1,2]),1));f.geometry.setDrawRange(3,3);f.material.forceSinglePass=true;
      const draw=take(snapshotSourceDrawings([f.mesh])).commands[0],values=draw.attributes.find(a=>a.name==='position')!.values;
      expect(Array.from(new Uint32Array(values.buffer).subarray(0,3))).toEqual([0x7fc12345,0x80000000,0x7f800000]);
      expect(draw).toMatchObject({first:3,count:3,passes:['both']});expect(draw.index).toBeInstanceOf(Uint32Array);
    }finally{f.dispose();}
  });

  it('admits the complete snapshot before copying any normalized attribute',()=>{
    const a=fixture(),b=fixture();try{
      const colors=new THREE.BufferAttribute(new Uint8Array([255,0,128,0,255,64,0,0,255]),3,true);a.geometry.setAttribute('tint',colors);
      const first=take(snapshotSourceDrawings([a.mesh]));const read=vi.spyOn(colors,'getComponent');
      const result=snapshotSourceDrawings([a.mesh,b.mesh],{maxBytes:first.admittedBytes+1});
      expect(result).toMatchObject({ok:false,error:{kind:'capacity'}});expect(read).not.toHaveBeenCalled();
    }finally{a.dispose();b.dispose();}
  });

  it('returns no partial snapshot when cancellation arrives during packing',()=>{
    const f=fixture();try{
      const colors=new THREE.BufferAttribute(new Uint8Array(9),3,true);f.geometry.setAttribute('tint',colors);
      let cancelled=false;const original=colors.getComponent.bind(colors);
      vi.spyOn(colors,'getComponent').mockImplementation((i,k)=>{cancelled=true;return original(i,k);});
      expect(snapshotSourceDrawings([f.mesh],{isCancelled:()=>cancelled})).toMatchObject({ok:false,error:{kind:'cancelled'}});
    }finally{f.dispose();}
  });

  it.each(['index','stride','integer','float','array','numeric-text'] as const)('rejects malformed %s before delivery',kind=>{
    const f=fixture();try{
      if(kind==='index')f.geometry.index!.setX(0,99);
      if(kind==='stride')(f.geometry.getAttribute('first') as THREE.InterleavedBufferAttribute).offset=4;
      if(kind==='integer')f.material.uniforms.renamedMode.value=1.5;
      if(kind==='float')f.material.uniforms.perspective.value=Infinity;
      if(kind==='numeric-text')f.material.uniforms.perspective.value='1' as unknown as number;
      if(kind==='array')f.material.uniforms.params.value=new Float32Array([1]);
      expect(snapshotSourceDrawings([f.mesh])).toMatchObject({ok:false,error:{kind:'input'}});
    }finally{f.dispose();}
  });

  it.each(['stencil','defines','foreign','replaced-cells','shader-callback','draw-callback','float64-attribute'] as const)('does not silently omit unsupported %s state',kind=>{
    const f=fixture();let replacement:THREE.RawShaderMaterial|undefined;
    try{
      if(kind==='stencil')f.material.stencilWrite=true;
      if(kind==='float64-attribute')f.geometry.setAttribute('position',new THREE.BufferAttribute(new Float64Array(9),3));
      if(kind==='shader-callback')f.material.onBeforeCompile=()=>{};
      if(kind==='draw-callback')f.mesh.onBeforeRender=()=>{};
      if(kind==='defines')f.material.defines={CHANGED:1};
      if(kind==='foreign'){replacement=new THREE.RawShaderMaterial();f.mesh.material=replacement as typeof f.material;}
      if(kind==='replaced-cells')f.material.uniforms={...f.material.uniforms};
      expect(snapshotSourceDrawings([f.mesh])).toMatchObject({ok:false,error:{kind:'unsupported'}});
    }finally{replacement?.dispose();f.dispose();}
  });

  it('retains non-indexed draws and skips explicitly hidden meshes',()=>{
    const f=fixture();try{
      f.geometry.setIndex(null);const snapshot=take(snapshotSourceDrawings([f.mesh]));
      expect(snapshot.commands[0]).toMatchObject({index:undefined,first:0,count:3});
      f.mesh.visible=false;expect(take(snapshotSourceDrawings([f.mesh])).commands).toEqual([]);
    }finally{f.dispose();}
  });
});
