import {createHash} from 'node:crypto';
import {describe,expect,it} from 'vitest';
import capture from './fixtures/source-domain-draw-boundary/native.json';
import {createScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {parseDomainModel,type DomainModel,type SourceDomainModel} from '../src/engine/domainModel';
import {domainExpressions} from '../src/engine/domainExpressions';
import {domainNativeGlslPrelude} from '../src/engine/domainNativeArithmetic';
import {prepareDomainNativeDrawing,supportsDomainNativeModel} from '../src/engine/sourceDomainNativeDrawing';
import {encodeSourceDrawingFrame} from '../src/engine/sourceDrawingFrame';
import {SourceProcessingContext,type SourceProcessingContextResult} from '../src/engine/sourceProcessingContext';
import {writeSourceEyePosition} from '../src/engine/sourceProcessingGeometry';
import type {SourceDrawingCommand,SourceDrawingUniform} from '../src/engine/sourceDrawingSnapshot';

const dimensions={width:500,height:600,logicalWidth:250,logicalHeight:300};
const hash=(source:string|ArrayBufferView)=>createHash('sha256').update(typeof source==='string'?source:new Uint8Array(source.buffer,source.byteOffset,source.byteLength)).digest('hex');
const scene=()=>{
 const s=createScene(definition('domain'));s.parameters={};s.equations={f:'z',next:'sin(w +z^2)'};s.timeline.tracks=[];
 Object.assign(s.settings,{domainIterationVersion:'mathart-1.7.8-gpu',domainColorVersion:'mathart-1.7.8-gpu',domainViewportVersion:'mathart-1.7.8-gpu',domainBackend:'gpu',supersampling:1,iterationEnabled:true,iterationSteps:27,iterationMaxSteps:64,seedMode:'ZERO',bailout:1024,centerX:0,centerY:0,scale:1.2000000476837158,rotation:0,curveMode:'PHASE_MODULUS',phaseDensity:9,modDensity:5,phaseSharpness:.3499999940395355,modSharpness:.699999988079071,curveBias:0,curveMix:.8500000238418579,paletteOffset:0});
 s.domainSourcePalette={colors:['#1D3557','#457B9D','#A8DADC','#F1FAEE','#F4A261','#E76F51','#A4243B']};return s;
};
const model=()=>parseDomainModel(scene(),0) as SourceDomainModel;
const command=(m=model(),size=dimensions)=>prepareDomainNativeDrawing(m,size).commands[0];
const numeric=(u:SourceDrawingUniform)=>{if(u.kind==='sampler2d')throw new Error('unexpected texture');return u;};
const uniform=(d:SourceDrawingCommand,name:string)=>numeric(d.uniforms.find(u=>u.name===name)!);
const value=<T>(r:SourceProcessingContextResult<T>)=>{if(!r.ok)throw r.error;return r.value;};

describe('Domain source native mathematical drawing producer',()=>{
 it('preserves the complete captured original shader template and old WebGL prelude bytes',()=>{
  const d=command();
  expect(d.fragmentShader.split('\n').slice(0,4)).toEqual(['#define USE_DYNAMIC_FORMULA 1','#define DYNAMIC_EVAL_FORMULA (z)','#define USE_DYNAMIC_ITERATION_FORMULA 1','#define DYNAMIC_ITERATION_EVAL_FORMULA (c_sin(c_add(w,c_pow(z,vec2(2.0,0.0)))))']);
  expect(hash('#version 150\n'+d.vertexShader)).toBe(capture.vertexShader.sha256);
  // Raw MathArt 1.7.8 fragment asset. Dynamic macros use existing shared AST
  // spelling (commas lack the original spaces), not a second lowerer. Removing
  // those complete lines leaves the unchanged template, not a pixel proof.
  const template=d.fragmentShader.split('\n').filter(line=>!line.startsWith('#define ')).join('\n');
  expect(hash('#version 150\n'+template)).toBe('23aba61177f1534df6b9f6523ce854e3528e1ff13f40e13c7d1a34dfd98b4fbc');
  expect(hash(domainNativeGlslPrelude)).toBe('acc72f9fb89ae8709619ebe9daecb9455c7e70161ae7b774a01b707eb097398c');
 });
 it('matches the original observed pretransformed VBO, exact UVs, indices and every active uniform',()=>{
  const d=command();
  for(const attribute of capture.attributes){const actual=d.attributes.find(a=>a.name===attribute.name)!;expect(actual.size).toBe(attribute.size);expect(Array.from(actual.values)).toEqual(Array.from(new Float32Array(attribute.littleEndianFloat32Values)));}
  expect(hash(d.index!)).toBe(capture.draw.indexBytesSha256);
  for(const u of capture.uniforms){
   const actual=uniform(d,u.name.replace('[0]','')),expected=u.type===5124?new Int32Array(u.values.flat()):new Float32Array(u.values.flat());
   // The summarized fixture normalized these zeros; the original draw-capture
   // JSON retains -0.0 for the two orthographic translation components.
   if(u.name==='transform'){expected[12]=-0;expected[13]=-0;}
   expect(Array.from(actual.values)).toEqual(Array.from(expected));
  }
  expect(d).toMatchObject({primitive:'triangles',first:0,count:6,instances:1,depthTest:false,depthWrite:false,passes:['both'],blend:'source-alpha-over'});
 });
 it.each([[1,3],[257,193],[7,19],[509,511]])('retains the shared Processing camera sequence at logical %i × %i', (w,h)=>{
  const ctx=value(SourceProcessingContext.create(w,h));
  try{
   for(const event of [{kind:'begin-draw'},{kind:'reset-matrix'},{kind:'default-camera'},{kind:'ortho'},{kind:'translate',x:Math.fround(w*.5),y:Math.fround(h*.5),z:0}] as const)value(ctx.apply(event));
   const facts=value(ctx.snapshot()),d=command(model(),{width:w*2,height:h*2,logicalWidth:w,logicalHeight:h}),m=Array.from({length:16},(_,i)=>facts.modelview[i%4*4+Math.floor(i/4)]),expected=new Float32Array(16);
   [[-w/2,-h/2],[w/2,-h/2],[w/2,h/2],[-w/2,h/2]].forEach(([x,y],i)=>writeSourceEyePosition(m,x,y,0,expected,i*4));
   expect(d.attributes[0].values).toEqual(expected);expect(Array.from(uniform(d,'transform').values)).toEqual(facts.projection);expect(Array.from(uniform(d,'u_resolution').values)).toEqual([w,h]);
  }finally{ctx.dispose();}
 });
 it('keeps physical dimensions separate and admits the generated snapshot through the real frame codec',()=>{
  const drawing=prepareDomainNativeDrawing(model(),dimensions),again=prepareDomainNativeDrawing(model(),{...dimensions,width:250,height:300});
  expect(drawing).toEqual(again);expect(drawing.textures).toEqual([]);expect(drawing.retainedBufferBytes).toBe(0);
  const d=drawing.commands[0],bytes=d.attributes.reduce((n,a)=>n+a.values.byteLength,0)+d.index!.byteLength+d.uniforms.reduce((n,u)=>n+numeric(u).values.byteLength,0);
  expect(drawing.copiedBufferBytes).toBe(bytes);expect(drawing.admittedBytes).toBeGreaterThan(bytes);
  const packet=encodeSourceDrawingFrame({generation:1,sequence:1,width:500,height:600,samples:0,clear:[0,0,0,1],drawing});expect(packet.ok).toBe(true);if(packet.ok)expect(new DataView(packet.value.buffer).getUint32(4,true)).toBe(3);
 });
 it.each(['cpu-backend','cpu-formula','cpu-color','cpu-view','local-formula','local-color','local-view','supersampling'])('rejects a mixed or local rule: %s',rule=>{
  const m=model();if(rule==='cpu-backend')m.backend='cpu';else if(rule==='supersampling')m.supersampling=2;else if(rule.endsWith('formula'))m.iterationVersion=rule.startsWith('cpu')?'mathart-1.7.8-cpu':'local-v1';else if(rule.endsWith('view'))m.view={...m.view,version:rule.startsWith('cpu')?'mathart-1.7.8-cpu':'local-v1'};else (m as DomainModel).colorVersion=rule.startsWith('cpu')?'mathart-1.7.8-cpu':'local-v1';
  expect(supportsDomainNativeModel(m)).toBe(false);expect(()=>command(m)).toThrow(/完整原版 GPU/);
 });
 it('reuses AST lower facts and preserves slots while excluding inactive and constant-like parameter names',()=>{
  const s=scene();s.parameters={a:2,e:1e300,pi:1e300,unused:1e300,z:1e300};s.equations={f:'z+a+pi+e',next:'w+a'};const m=parseDomainModel(s,0) as SourceDomainModel;
  domainExpressions.clear();const owner=domainExpressions.get(m),source=owner.gpuSource(),before=domainExpressions.diagnostics(),d=command(m),after=domainExpressions.diagnostics();
  expect(source.referencedParameterIndices).toEqual([0]);expect(source.formulaSource).toContain('parameter0');expect(source.iterationSource).toContain('parameter0');
  expect(after.parses).toBe(before.parses);expect(after.sourceBuilds).toBe(before.sourceBuilds);
  expect(d.uniforms.filter(u=>u.name.startsWith('parameter')).map(u=>u.name)).toEqual(['parameter0']);expect(Array.from(uniform(d,'parameter0').values)).toEqual([2]);expect(d.fragmentShader).not.toContain('uniform float parameter1');
  m.parameters.a=1e300;expect(()=>command(m)).toThrow(/有限 float32/);
 });
 it('honors disabled-next and recovered syntax from the existing expression owner',()=>{
  const s=scene();s.settings.iterationEnabled=false;s.equations.next='w+100';let d=command(parseDomainModel(s,0) as SourceDomainModel);
  expect(d.fragmentShader).not.toContain('#define USE_DYNAMIC_ITERATION_FORMULA');expect(Array.from(uniform(d,'u_iter_steps').values)).toEqual([1]);
  s.settings.iterationEnabled=true;s.equations={f:'sin(',next:'pow(z)'};const m=parseDomainModel(s,0) as SourceDomainModel;d=command(m);
  expect(m.executionWarnings.filter(s=>s.includes('无法解析'))).toHaveLength(2);expect(d.fragmentShader).toContain('#define DYNAMIC_EVAL_FORMULA (c_sub(c_pow(z,vec2(3.0,0.0)),vec2(1.0,0.0)))');expect(d.fragmentShader).not.toContain('#define USE_DYNAMIC_ITERATION_FORMULA');
 });
 it.each([0,1,7,20])('uses prepared source palette facts with sixteen owned slots for %i authored colors',count=>{
  const s=scene();s.domainSourcePalette={colors:Array.from({length:count},(_,i)=>i%2?'#FF0000':'#0088CC')};const m=parseDomainModel(s,0) as SourceDomainModel,d=command(m),p=uniform(d,'u_palette');
  expect(p.kind).toBe('vec3-array');expect(p.count).toBe(16);expect(p.values.length).toBe(48);expect(Array.from(p.values.slice(0,Math.min(count,16)*3))).toEqual(m.sourceColor.facts.palette.entries.flat());expect(Array.from(p.values.slice(Math.min(count,16)*3))).toEqual(Array((16-Math.min(count,16))*3).fill(0));expect(Array.from(uniform(d,'u_palette_size').values)).toEqual([Math.min(count,16)]);
  p.values.fill(99);expect(command(m).uniforms.find(u=>u.name==='u_palette')).not.toEqual(p);
 });
 it.each([{width:0},{height:16385},{width:4001,height:4000},{logicalWidth:0},{logicalHeight:2.5},{logicalHeight:2147483648}])('rejects invalid dimensions before creating a drawing: %j',patch=>{
  expect(()=>command(model(),{...dimensions,...patch})).toThrow(/尺寸/);
 });
});
