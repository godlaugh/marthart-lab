import {describe,it,expect,vi} from 'vitest';
import {createScene,parseScene,persistentScene} from '../src/engine/document';
import {parseLegacyScene} from '../src/engine/legacyImport';
import {generateScene} from '../src/engine/temporal';
import {definitions,generateImplicit,transformFor} from '../src/scenes/geometry';
import {prepareImplicitJob,IMPLICIT_MAX_SEGMENTS,implicitOutputAllocation} from '../src/engine/implicitSurface';
import type {SceneDocument,Settings,SceneOutput,GenerateContext,GeometryOutput} from '../src/types';
import {gpuFormulaSampler} from '../src/engine/gpuSampler';
const def=definitions.find(d=>d.kind==='implicit')!;
const context:GenerateContext={time:0,width:64,height:48,quality:'export'};
function scene(f='x-.1',settings:Settings={}):SceneDocument{const s=createScene(def);s.parameters={};s.equations={f};s.settings={...s.settings,resolution:5,minX:-1,maxX:1,minY:-1,maxY:1,minZ:-1,maxZ:1,computeBackend:'cpu',...settings};return s;}
function geometry(out:SceneOutput){if(out.type!=='geometry')throw Error('Expected geometry');expect(out.positions.every(Number.isFinite)).toBe(true);expect(out.indices?.every(i=>i<out.positions.length/3)).not.toBe(false);return out;}
function generate(f:string,settings:Settings={}){return geometry(generateImplicit(scene(f,settings),context));}
function edgeCounts(out:GeometryOutput){const edges=new Map<string,number>();for(let i=0;i<out.indices!.length;i+=3){const[a,b,c]=out.indices!.subarray(i,i+3);for(const[u,v]of[[a,b],[b,c],[c,a]]){const key=u<v?`${u}:${v}`:`${v}:${u}`;edges.set(key,(edges.get(key)??0)+1);}}return edges;}

describe('bounded implicit grid and root ownership',()=>{
 it('preserves full requested 100-cubed cells and separates root evaluation work',()=>{
  const s=scene('x-.137',{resolution:100});const job=prepareImplicitJob(s,context,transformFor(s.settings));expect(job.cells).toBe(1_000_000);expect(job.latticeSamples).toBe(1_030_301);expect(job.planeSize).toBe(10201);
  const out=geometry(generateScene(s,context));expect(out.implicit).toMatchObject({requestedCells:1_000_000,examinedCells:1_000_000,requestedLatticeSamples:1_030_301,latticeSamples:1_030_301,rejectedEdges:0});expect(out.stats.samples).toBe(1_030_301);expect(out.implicit!.rootEvaluations).toBeGreaterThan(0);expect(out.implicit!.estimatedPeakWorkingBytes).toBeLessThan(16*1024*1024);expect(out.stats.generated).toBeGreaterThan(0);for(let i=0;i<out.positions.length;i+=3)expect(out.positions[i]).toBeCloseTo(.137,6);
 },10000);
 it('keeps shared corner/edge identities across slabs on a closed sphere',()=>{
  const out=generate('x^2+y^2+z^2-.7^2',{resolution:24,resolutionX:16,resolutionY:20,resolutionZ:28});const edges=edgeCounts(out);expect(new Set(edges.values())).toEqual(new Set([2]));expect(out.stats.generated-edges.size+out.indices!.length/3).toBe(2);expect(out.implicit!.examinedCells).toBe(16*20*28);expect(out.stats.samples).toBe(17*21*29);
 });
 it.each([{f:'x*x+y*y+z*z-1.5^2',n:40,euler:2}])('owns near-zero corner identities without cracks at $n cells',({f,n,euler})=>{
  const out=generate(f,{resolution:n,minX:-2,maxX:2,minY:-2,maxY:2,minZ:-2,maxZ:2}),edges=edgeCounts(out);expect(new Set(edges.values())).toEqual(new Set([2]));expect(out.stats.generated-edges.size+out.indices!.length/3).toBe(euler);expect(out.implicit!.rejectedEdges).toBe(0);
 });
 it('records torus rounding/uncertified-edge topology limitations while retaining accurate vertices',()=>{const out=generate('(sqrt(x*x+y*y)-1)^2+z*z-.4^2',{resolution:40,minX:-2,maxX:2,minY:-2,maxY:2,minZ:-2,maxZ:2}),edges=edgeCounts(out);expect([...edges.values()].some(n=>n!==2)).toBe(true);expect(out.implicit!.degenerateTriangles).toBeGreaterThan(0);if(out.implicit!.rejectedEdges)expect(out.warnings?.join('')).toContain('候选边');for(let i=0;i<out.positions.length;i+=3){const[x,y,z]=out.positions.subarray(i,i+3);expect(Math.abs(Math.hypot(Math.hypot(x,y)-1,z)-.4)).toBeLessThan(1e-6);}});
 it('uses input scale, not an absolute tolerance, for corner identity',()=>{
  const offset=generate('x-1e-10',{resolution:6});for(let i=0;i<offset.positions.length;i+=3)expect(Math.abs(offset.positions[i]/1e-10-1)).toBeLessThan(1e-6);
  const tiny=generate('x-1e-20',{resolution:6,minX:-1e-19,maxX:1e-19,minY:-1e-19,maxY:1e-19,minZ:-1e-19,maxZ:1e-19});expect(tiny.stats.generated).toBeGreaterThan(0);for(let i=0;i<tiny.positions.length;i+=3)expect(Math.abs(tiny.positions[i]/1e-20-1)).toBeLessThan(1e-6);
 });
 it('preserves a representable translated root rather than capturing it to a large-origin corner',()=>{
  const reference=generate('x-.015625',{resolution:5,minX:0,maxX:1}),translated=generate('x-(1e12+.015625)',{resolution:5,minX:1e12,maxX:1e12+1,offsetX:-1e12});expect(translated.stats.generated).toBe(reference.stats.generated);for(let i=0;i<translated.positions.length;i+=3)expect(translated.positions[i]).toBe(.015625);
 });
 it.each(['1/x','x<0 ? -1 : 1','x<0 ? -1e-12 : 1','x<0 ? -1e-20 : 1','x<0 ? x-1e-12 : x+1e-12','abs(x)<1e-15 ? 1e12 : (x<0 ? x-.001 : x+.001)','x<0 ? x-.001 : 1e12','x<0 ? -1e12*x*x-.001 : 1e12*x*x+.001'])('rejects the observed nonzero discontinuity %s between finite corners',f=>{
  const out=generate(f);expect(out.stats.invalid).toBe(0);expect(out.stats.generated).toBe(0);expect(out.implicit!.rejectedEdges).toBeGreaterThan(0);expect(out.implicit!.unresolvedCells).toBe(25);expect(out.warnings?.join('')).toContain('候选边');
 });
 it('does not create a zero surface at the tangent pole inside [1,2]',()=>{const out=generate('tan(x)',{minX:1,maxX:2});expect(out.stats.generated).toBe(0);expect(out.implicit!.rejectedEdges).toBeGreaterThan(0);});
 it('does not use real-expression continuity to bless floating cancellation signs',()=>{const out=generate('(x+1e16)-1e16-.1',{minX:0,maxX:2});expect(out.stats.generated).toBe(0);expect(out.implicit!.rejectedEdges).toBeGreaterThan(0);});
 it('returns a point inside the final root bracket rather than an earlier nonzero local minimum',()=>{const out=generate('((x-.275)^2+1e-30)*(x*x-.3)');expect(out.stats.generated).toBeGreaterThan(0);const signs=new Set<number>();for(let i=0;i<out.positions.length;i+=3){const x=out.positions[i];signs.add(Math.sign(x));expect(Math.abs(Math.abs(x)-Math.sqrt(.3))).toBeLessThan(1e-7);}expect(signs).toEqual(new Set([-1,1]));});
 it('retains actual roots near a pole without connecting the undefined sampled region',()=>{
  const out=generate('(x-.5)/x',{resolution:12});expect(out.stats.generated).toBeGreaterThan(0);expect(out.stats.invalid).toBeGreaterThan(0);for(let i=0;i<out.positions.length;i+=3)expect(out.positions[i]).toBeCloseTo(.5,6);
 });
 it('accepts legitimate high-gradient and very small fields at the same geometric root',()=>{
  const small=generate('1e-16*(x-.1)'),large=generate('1e16*(x-.1)');expect(large.positions).toEqual(small.positions);expect(large.indices).toEqual(small.indices);expect(large.implicit!.rejectedEdges).toBe(0);expect(small.stats.generated).toBeGreaterThan(0);
 });
 it('refines sampled thin-wall crossings but does not invent an unsampled component',()=>{
  const missing=generate('(x-.1)^2-.03^2'),resolved=generate('(x-.1)^2-.03^2',{resolution:40,resolutionY:4,resolutionZ:4});expect(missing.stats.generated).toBe(0);expect(resolved.stats.generated).toBeGreaterThan(0);expect(resolved.implicit!.refinedEdges).toBeGreaterThan(0);for(let i=0;i<resolved.positions.length;i+=3)expect(Math.min(Math.abs(resolved.positions[i]-.07),Math.abs(resolved.positions[i]-.13))).toBeLessThan(1e-7);
 });
 it('does not discard correctly bracketed high-frequency zeros',()=>{
  const out=generate('sin(12*pi*x)',{resolution:80,resolutionY:4,resolutionZ:4});expect(out.stats.generated).toBeGreaterThan(0);expect(out.implicit!.rejectedEdges).toBe(0);const roots=new Set<number>();for(let i=0;i<out.positions.length;i+=3){roots.add(Math.round(out.positions[i]*12));expect(Math.abs(Math.sin(12*Math.PI*out.positions[i]))).toBeLessThan(2e-6);}expect(roots.size).toBe(23);
 });
 it('reports zero-only / even-multiplicity samples without asserting mathematical absence',()=>{const out=generate('x^2',{resolution:6});expect(out.stats.generated).toBe(0);expect(out.warnings?.join('')).toContain('偶重根');});
 it('retains clipped boundaries, reversed orientation, wireframe uniqueness and point validity',()=>{
  const s=scene('x-.1',{resolution:6,renderMode:'wireframe'}),wire=geometry(generateImplicit(s,context));expect(wire.topology).toBe('segments');const keys=new Set<string>();for(let i=0;i<wire.indices!.length;i+=2){const a=wire.indices![i],b=wire.indices![i+1];expect(a).not.toBe(b);keys.add(a<b?`${a}:${b}`:`${b}:${a}`);}expect(keys.size).toBe(wire.indices!.length/2);
  s.settings.renderMode='points';const points=geometry(generateImplicit(s,context));expect(points.indices).toBeUndefined();expect(points.stats.generated).toBe(wire.stats.generated);s.settings.renderMode='mesh';s.settings.inside='above';const mesh=geometry(generateImplicit(s,context));expect(new Set(edgeCounts(mesh).values())).toEqual(new Set([1,2]));
 });
 it('cancels mid-sampling/refinement and recovers with no retained partial state',()=>{
  // Capacity is covered separately; a small nontrivial grid still reaches the
  // 51st cancellation checkpoint after sampling/refinement has begun.
  const s=scene('sin(17*x)+cos(19*y)+sin(21*z)',{resolution:10});let checks=0;
  expect(()=>generateScene(s,{...context,isCancelled:()=>++checks>50})).toThrow('已取消');expect(checks).toBe(51);
  const first=geometry(generateScene(s,context)),again=geometry(generateScene(s,context));
  expect(first.stats.generated).toBeGreaterThan(0);expect(first.implicit).toMatchObject({requestedCells:1000,examinedCells:1000,latticeSamples:1331});
  expect(first.positions).toEqual(again.positions);expect(first.indices).toEqual(again.indices);
 });
 it('imports 100 and 200 as actual per-axis cell counts and round-trips exact guide presets',()=>{
  for(const n of [100,IMPLICIT_MAX_SEGMENTS]){const source={config_version:'1.0.0',type:'IMPLICIT',name:'grid',parameters:{},equation:{f:'x'},settings:{x_segments:n,y_segments:n,z_segments:n}},out=parseLegacyScene(JSON.stringify(source));expect(out.scene.settings.resolutionX).toBe(n);expect(out.scene.settings.resolutionY).toBe(n);expect(out.scene.settings.resolutionZ).toBe(n);expect(out.warnings.join('')).not.toContain('转换为');expect(out.source).toEqual(source);}
  for(const [id,n,min,max]of [['chmutov-octic',80,-1,1],['klein-implicit',100,-3,3]] as const){const preset=def.presets.find(p=>p.id===id)!;expect(preset).toBeDefined();const s=createScene(def,preset),restored=parseScene(JSON.stringify(persistentScene(s)));expect(restored.equations).toEqual(s.equations);expect(restored.settings).toMatchObject({resolution:n,minX:min,maxX:max,minY:min,maxY:max,minZ:min,maxZ:max});}
 });
 it('checks final output and compaction allocations before allocating their representation',()=>{
  expect(implicitOutputAllocation(1,3,'mesh')).toEqual({outputBytes:36,futureBytes:40});expect(implicitOutputAllocation(1,3,'wireframe')).toEqual({outputBytes:48,futureBytes:52});expect(implicitOutputAllocation(1,3,'points')).toEqual({outputBytes:24,futureBytes:28});
  expect(implicitOutputAllocation(Math.floor(128*1024*1024/24),0,'points').outputBytes).toBeLessThanOrEqual(128*1024*1024);expect(()=>implicitOutputAllocation(Math.floor(128*1024*1024/24)+1,0,'points')).toThrow('128 MiB');expect(()=>implicitOutputAllocation(1,3*Math.ceil(128*1024*1024/24),'wireframe')).toThrow('128 MiB');
  for(const n of [-1,1.2,Infinity,Number.MAX_SAFE_INTEGER])expect(()=>implicitOutputAllocation(n,0,'mesh')).toThrow();expect(()=>implicitOutputAllocation(1,2,'mesh')).toThrow('计数');
 });
 it('validates noncrossing GPU cells too and counts confirmed discarded work separately from the requested grid',()=>{
  const s=scene('(x+1e8)-1e8-.1'),cpu=geometry(generateImplicit(s,context));
  const sampler=vi.spyOn(gpuFormulaSampler,'sample').mockImplementation((_sources,coordinates)=>({backend:'webgl2',values:new Float32Array(coordinates.length).fill(-.1),warnings:[]}));
  try{const out=geometry(generateImplicit({...s,settings:{...s.settings,computeBackend:'webgl2'}},context));expect(out.backend).toBe('cpu');expect(out.positions).toEqual(cpu.positions);expect(out.indices).toEqual(cpu.indices);expect(out.implicit!.requestedLatticeSamples).toBe(216);expect(out.implicit!.latticeSamples).toBe(252);expect(out.implicit!.latticeValidationSamples).toBe(4);expect(out.warnings?.join('')).toContain('实际工作可超过请求网格');}finally{sampler.mockRestore();}
 });
 it('rejects invalid dimensions, unrepresentable bounds and nonfinite transforms without allocating a full lattice',()=>{
  for(const settings of [{resolution:201},{resolutionX:3},{resolutionY:4.5},{minX:1,maxX:-1},{minX:-1e308,maxX:1e308},{minX:1e12,maxX:1e12+.0001220703125,resolutionX:200}] as Settings[])expect(()=>generateImplicit(scene('x',settings),context)).toThrow();const out=generate('x',{scale:1e308});expect(out.stats.generated).toBe(0);expect(out.warnings?.join('')).toContain('超出表示范围');
 });
});
