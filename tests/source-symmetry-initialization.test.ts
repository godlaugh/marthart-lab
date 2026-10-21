import {symmetryCustomCompileDegree} from '../src/engine/symmetryCustom';
import {describe,it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import fixture from './fixtures/symmetry/initialization-source.json';
import {createSourceSymmetryConfiguration,sourceSymmetryInitialSeed,parseSourceSymmetryConfiguration,editSourceSymmetryConfiguration,sourceSymmetryTemplate} from '../src/engine/sourceSymmetryConfig';
import {iteratedInitialChunk} from '../src/engine/iteratedSeed';
import {JavaSourceRandom48} from '../src/engine/javaSourceRandom';
import {parseProjectFile,parseLegacyScene} from '../src/engine/legacyImport';
import {parseScene,serializeScene} from '../src/engine/document';
import {prepareIteratedFrame} from '../src/scenes/iteratedDensity';
import {iteratedBaselineKey} from '../src/engine/iteratedIdentity';
const f32=(hex:string)=>new Float32Array(new Uint32Array([parseInt(hex,16)]).buffer)[0];
const bits=(v:Float32Array)=>Array.from(new Uint32Array(v.buffer,v.byteOffset,v.length),n=>n.toString(16).padStart(8,'0'));
const imported=(raw:object={})=>parseProjectFile(JSON.stringify({config_version:'1.0.0',name:'Initialization fixture',type:'SYMMETRY_CHAOS',...raw})).scene;
describe('source Symmetry constructor and Random stream',()=>{
 for(const row of fixture.directOrderedRuntimeParameters)it(row.id,()=>{
  const cfg=createSourceSymmetryConfiguration(row.batchSize,row.orderedParameters.map(([k,v])=>[String(k),Number(v)]));if(!cfg.ok)throw Error(cfg.error.reason);
  const seed=sourceSymmetryInitialSeed(cfg.value);expect(seed).toBe(row.initialStateSeedSignedDecimal);
  const config={sourceSymmetrySeed:seed,seed:0,dimension:2 as const,count:row.batchSize,bounds:[row.xBoundsFloat32Bits.map(f32),row.yBoundsFloat32Bits.map(f32),[0,0]] as [number,number][]};
  for(const point of row.selected)expect(bits(iteratedInitialChunk(config,point.particle,1))).toEqual(point.xyzmFloat32Bits);
  const hash=createHash('sha256');for(let offset=0;offset<row.examinedPrefixParticles;offset+=65536){const block=iteratedInitialChunk(config,offset,Math.min(65536,row.examinedPrefixParticles-offset));hash.update(new Uint8Array(block.buffer));}
  expect(hash.digest('hex')).toBe(row.prefixRgbaFloat32LittleEndianSha256);
 });
 for(const row of fixture.boundedJsonFixtures)it('public import/save/reopen: '+row.id,()=>{
  const scene=imported(row.rawSourceInput),reopened=parseScene(serializeScene(scene));
  expect(reopened.symmetrySource).toEqual(scene.symmetrySource);
  expect(sourceSymmetryInitialSeed(reopened.symmetrySource!)).toBe(row.initialStateSeedSignedDecimal);
  const config=prepareIteratedFrame(reopened,0,0).config;expect(config.count).toBe(row.batchSize);expect(reopened.settings.degree).toBe(row.runtimeSymmetryDegree);
  for(const point of row.selected)expect(bits(iteratedInitialChunk(config,point.particle,1))).toEqual(point.xyzmFloat32Bits);
 });
 it('uses source defaults, minimum clamps and explicit local resource limits',()=>{
  const cfg=prepareIteratedFrame(imported(),0,0).config;expect(cfg).toMatchObject({count:262144,burn:100,iterations:1});
  expect(prepareIteratedFrame(imported({settings:{batch_size:0,burn_in_steps:-4,iterations_per_frame:-1}}),0,0).config).toMatchObject({count:1,burn:0,iterations:1});
  expect(()=>imported({settings:{iterations_per_frame:17}})).toThrow('16');expect(()=>imported({settings:{burn_in_steps:100001}})).toThrow('100000');
  expect(parseLegacyScene(JSON.stringify({config_version:'1.0.0',name:'Initialization fixture',type:'SYMMETRY_CHAOS'}),{iteratedMath:'legacy-v1'}).scene.symmetrySource).toBeUndefined();
 });
 it('separates missing uniforms from constructor degree; flag removal does not refill defaults',()=>{
  const scene=imported({parameters:{use_modified_equation:false}}),job=prepareIteratedFrame(scene,0,0);
  expect(scene.parameters).toEqual({});expect(scene.settings.degree).toBe(3);
  expect(job.field).toMatchObject({parameters:{n:0,lambda:0,deltaPower:0}});
 });
 it('uses exact template dispatch and numeric legacy flag semantics',()=>{
  for(const template of ['Modified',' modified',null,1,{}])expect(sourceSymmetryTemplate({template},true,{use_modified_equation:1})).toEqual({ok:true,value:'standard'});
  expect(sourceSymmetryTemplate({template:'modified'},true,{})).toEqual({ok:true,value:'modified'});
  for(const value of [true,'true',false])expect(sourceSymmetryTemplate(undefined,false,{use_modified_equation:value})).toEqual({ok:true,value:'standard'});
  for(const value of [1,'0x1p0'])expect(sourceSymmetryTemplate(undefined,false,{use_modified_equation:value})).toEqual({ok:true,value:'modified'});
  expect(sourceSymmetryTemplate(null,true,{}).ok).toBe(false);
 });
 it('preserves signed zero and detaches construction facts at the document boundary',()=>{
  const scene=imported({parameters:{omega:'-0'}}),saved=parseScene(serializeScene(scene));expect(Object.is(saved.parameters.omega,-0)).toBe(true);
  expect(sourceSymmetryInitialSeed(saved.symmetrySource!)).toBe(sourceSymmetryInitialSeed(scene.symmetrySource!));
  const positive=editSourceSymmetryConfiguration(scene,{...scene,parameters:{omega:0}});expect(iteratedBaselineKey(positive)).not.toBe(iteratedBaselineKey(scene));
  const parsed=parseSourceSymmetryConfiguration(scene.symmetrySource);if(!parsed.ok)throw Error(parsed.error.reason);
  parsed.value.construction.parameters[0]=['omega',1];expect(scene.symmetrySource!.construction.parameters[0][1]).toBe(-0);
  const corrupt=structuredClone(scene.symmetrySource!);corrupt.construction.parameters.push(['omega',0]);expect(parseSourceSymmetryConfiguration(corrupt).ok).toBe(false);
 });
 it('rebuilds after inspector coefficients, but preserves the authored anchor during runtime parameter evaluation',()=>{
  const scene=imported(),seed=prepareIteratedFrame(scene,0,0).config.sourceSymmetrySeed;
  const changed={...scene,parameters:{...scene.parameters,alpha:-2.5}};
  const runtime=prepareIteratedFrame(changed,0,0);expect(runtime.config.sourceSymmetrySeed).toBe(seed);
  const rebuilt=editSourceSymmetryConfiguration(scene,changed);expect(prepareIteratedFrame(rebuilt,0,0).config.sourceSymmetrySeed).not.toBe(seed);
  expect(iteratedBaselineKey(rebuilt)).not.toBe(iteratedBaselineKey(scene));
  const batch=editSourceSymmetryConfiguration(scene,{...scene,settings:{...scene.settings,batchSize:17}});expect(prepareIteratedFrame(batch,0,0).config.count).toBe(17);
  const camera=editSourceSymmetryConfiguration(scene,{...scene,camera:{...scene.camera}});expect(camera.symmetrySource).toBe(scene.symmetrySource);
  expect(parseScene(serializeScene(rebuilt)).symmetrySource).toEqual(rebuilt.symmetrySource);
 });
 it('uses native literal/fallback bounds and normalizes reversed axes',()=>{
  const config=prepareIteratedFrame(imported({settings:{batch_size:3,x0_min:'0x1p-1',x0_max:'0.25',y0_min:'sin(1)',y0_max:'0.003'}}),0,0).config;
  expect(config.bounds[0]).toEqual([.25,.5]);expect(config.bounds[1]).toEqual([Math.fround(.001),Math.fround(.003)]);
  expect(()=>imported({parameters:null})).toThrow('parameters');expect(()=>imported({settings:{x0_min:'Infinity'}})).toThrow('float32');
 });
 it('retains native arbitrary parameter keys without mutating object prototypes',()=>{
  for(const name of ['__proto__','prototype','constructor','bad-name','']){
   const scene=imported({parameters:{[name]:1}}),saved=parseScene(serializeScene(scene));
   expect(Object.hasOwn(saved.parameters,name)).toBe(true);expect(saved.parameters[name]).toBe(1);expect(Object.getPrototypeOf(saved.parameters)).toBe(Object.prototype);
   expect(prepareIteratedFrame(saved,0,0).field).toMatchObject({parameters:{lambda:0}});
  }
 });
 it('keeps custom compile-time degree on the construction snapshot during runtime updates',()=>{
  const scene=imported(),runtime={...scene,parameters:{...scene.parameters,symmetry_degree:17}};
  expect(symmetryCustomCompileDegree(runtime)).toBe(3);
  expect(symmetryCustomCompileDegree(editSourceSymmetryConfiguration(scene,runtime))).toBe(17);
 });
 it('jumps one draw per float, including odd offsets and huge ordinals, without mutating on rejection',()=>{
  for(const count of [0,1,7,1025]){const a=new JavaSourceRandom48(-7n),b=new JavaSourceRandom48(-7n);for(let i=0;i<count;i++)a.nextFloat();b.skipFloatDraws((1n<<200n)+BigInt(count));expect(b.state48).toBe(a.state48);expect(b.nextFloat()).toBe(a.nextFloat());}
  const a=new JavaSourceRandom48(0n),before=a.state48;for(const value of [-1,NaN,1.5,-1n])expect(()=>a.skipFloatDraws(value)).toThrow();expect(a.state48).toBe(before);
 });
});
