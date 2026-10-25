import {describe,expect,it,vi} from 'vitest';
import {parseProjectFile} from '../src/engine/legacyImport';
import {sceneAtTime} from '../src/engine/timeline';
import {prepareIteratedFrame} from '../src/scenes/iteratedDensity';
import {prepareSourceSymmetryTone,SOURCE_SYMMETRY_PRESENT_GLSL} from '../src/engine/sourceSymmetryPresentation';
import {prepareSourceMapTone,SOURCE_MAP_PRESENT_GLSL} from '../src/engine/sourceMapPresentation';
import {prepareSourceSymmetryPalette,sourceSymmetryPaletteLut} from '../src/engine/sourceSymmetryPalette';
import {ordinarySourceCameraFrame,prepareOrdinarySourceFrame} from '../src/engine/ordinarySourceCamera';
import {prepareCapturedDensityCamera} from '../src/engine/sourceDensityCamera';
import {sourceDensityPointDiameter} from '../src/engine/sourceDensitySplat';
import {iteratedDensityGpuPrograms} from '../src/engine/iteratedDensityGpuPrograms';
import {DENSITY_PRESENT_VERTEX_GLSL} from '../src/engine/densityGpuShaders';
import {gpuShaderHeader} from '../src/engine/gpuShaderProfile';
import {createNoisePermutation} from '../src/scenes/noise';
import {applySourceIteratedRenderUniforms,prepareSourceIteratedDrawPlan,prepareSourceIteratedPresentPlan,sourceIteratedRenderPrograms,SOURCE_DENSITY_PRESENT_REDUCTION_GLSL,type SourceIteratedRenderUniform} from '../src/engine/sourceIteratedRenderPlan';
const F=Math.fround;
const scene=()=>parseProjectFile(JSON.stringify({config_version:'1.0.0',name:'Render owner',type:'SYMMETRY_CHAOS',settings:{batch_size:8,burn_in_steps:0,background_color:'#123456'}})).scene;
const target={width:32,height:24,stateWidth:4,projection:'xy' as const,bounds:{minX:-1,maxX:1,minY:-1,maxY:1}};
const values=(uniforms:readonly SourceIteratedRenderUniform[],name:string)=>{const u=uniforms.find(u=>u.name===name);if(!u||!('values'in u))throw Error(name);return u.values;};
const binding=(uniforms:readonly SourceIteratedRenderUniform[],name:string)=>uniforms.find(u=>u.name===name);
function job(){const result=prepareIteratedFrame(scene(),0,0);result.palette={name:'Source table',mode:'linear',stops:['#010203','#aabbcc'],interpolation:'rgb',cycles:1,offset:.125};result.symmetryPalette=prepareSourceSymmetryPalette(result.palette);return result;}

describe('shared prepared source iterated drawing/presentation owner (CPU only)',()=>{
 it('owns complete sampler, global particle and common stats/draw bindings',()=>{
  const frame=job(),plan=prepareSourceIteratedDrawPlan(frame,target);
  expect(plan.count).toBe(8);expect(plan.stateHeight).toBe(2);expect(plan.primitive).toBe('points');expect(plan.verticesPerInstance).toBe(1);
  for(const [name,unit,kind]of [['states',0,'sampler2d'],['counters',1,'usampler2d'],['palette',2,'sampler2d'],['noisePermutation',3,'usampler2d']])expect(binding(plan.drawUniforms,name as string)).toEqual({name,texture:unit,kind});
  expect(values(plan.drawUniforms,'particleOffset')).toEqual([0]);expect(values(plan.drawUniforms,'count')).toEqual([8]);expect(values(plan.drawUniforms,'stateWidth')).toEqual([4]);
  for(const u of plan.sharedUniforms){expect(plan.drawUniforms.find(v=>v.name===u.name)).toBe(u);expect(plan.statsUniforms.find(v=>v.name===u.name)).toBe(u);}
  expect(values(plan.drawUniforms,'radius')).toEqual([2]);expect(values(plan.statsUniforms,'radius')).toEqual([.5]);
  expect(binding(plan.statsUniforms,'sourceSize')).toBeUndefined();expect(plan.layout.states.channels).toEqual(['x','y','z','metric']);expect(plan.layout.counters.channels).toEqual(['invalid','validity']);
  expect(values(plan.drawUniforms,'capturedProjection')).toEqual(Array(16).fill(0));expect(values(plan.statsUniforms,'capturedModelView')).toEqual(Array(16).fill(0));expect(binding(plan.beforeTextures,'capturedProjection')).toBeUndefined();
  expect(plan.noisePermutation).toEqual(createNoisePermutation(frame.config.seed));expect(plan.blend).toMatchObject({source:'one',destination:'one'});
 });
 it('preserves raw quad size while stats use the same resolved footprint',()=>{
  const frame=job();frame.densitySplat!.path='quad';const plan=prepareSourceIteratedDrawPlan(frame,target);
  expect(plan.primitive).toBe('triangles');expect(plan.verticesPerInstance).toBe(6);expect(values(plan.drawUniforms,'radius')).toEqual([frame.densitySplat!.radius]);expect(values(plan.statsUniforms,'radius')).toEqual([F(sourceDensityPointDiameter(frame.densitySplat!)/2-.5)]);expect(values(plan.statsUniforms,'sourcePointClip')).toEqual([0]);
 });
 it('snapshots prepared camera matrices and scalar uniforms without changing the frame',()=>{
  const s=scene(),frame=job(),cameraPlan=prepareOrdinarySourceFrame(ordinarySourceCameraFrame(sceneAtTime(s,0),{time:0,width:32,height:24,quality:'preview',sourceViewport:{logicalWidth:32,logicalHeight:24,referenceLogicalHeight:24,target:'primary',projectionPass:'perspective'}}));
  frame.sourceCamera=prepareCapturedDensityCamera('symmetry',cameraPlan);const original=Array.from(frame.sourceCamera.anchor.projection.columnMajor),plan=prepareSourceIteratedDrawPlan(frame,target);
  expect(values(plan.drawUniforms,'capturedProjection')).toEqual(original.map(F));expect(values(plan.drawUniforms,'capturedModelView')).toEqual(Array.from(frame.sourceCamera.anchor.modelView.columnMajor));
  frame.config.colorSpeed=123;frame.sourceCamera.anchor.projection.columnMajor[0]=999;expect(values(plan.drawUniforms,'capturedProjection')).toEqual(original.map(F));expect(values(plan.drawUniforms,'colorSpeed')).not.toEqual([123]);
 });
 it('materializes the authoritative RGB1024 LUT lazily from a captured palette',()=>{
  const frame=job(),expected=sourceSymmetryPaletteLut(frame.palette),plan=prepareSourceIteratedDrawPlan(frame,target);
  expect(plan.palette).toMatchObject({format:'source-rgb1024',width:1024,height:1,filter:'linear',wrapS:'repeat',wrapT:'clamp-to-edge'});
  frame.palette.stops[0]='#ffffff';frame.palette.offset=.9;
  expect(plan.palette.createValues()).toEqual(expected);expect(plan.palette.createValues()).not.toBe(plan.palette.createValues());
 });
 it('keeps local extended palettes and the existing key omission rules',()=>{
  const frame=job();frame.palette.cycles=2;frame.symmetryPalette=prepareSourceSymmetryPalette(frame.palette);const plan=prepareSourceIteratedDrawPlan(frame,target),changed=job();changed.palette={...frame.palette,name:'renamed',offset:.5,cycles:3};changed.symmetryPalette=prepareSourceSymmetryPalette(changed.palette);
  expect(plan.palette).toMatchObject({format:'local-rgba4097',width:4097,filter:'nearest',wrapS:'clamp-to-edge'});expect(plan.palette.createValues()).toHaveLength(4097*4);expect(prepareSourceIteratedDrawPlan(changed,target).palette.key).toBe(plan.palette.key);expect(values(plan.drawUniforms,'symmetryLut')).toEqual([0]);
 });
 it('keeps record=false independent from decay, without adding a draw',()=>{
  const frame=job();frame.config.record=false;frame.config.decay=.7;const plan=prepareSourceIteratedDrawPlan(frame,target);expect(plan.record).toBe(false);expect(plan.decay).toBe(F(.7));expect(values(plan.statsUniforms,'recording')).toEqual([0]);
 });
 it.each(['webgl2','native-gl41'] as const)('uses unchanged shared shader bodies with the %s preamble',profile=>{
  const plan=sourceIteratedRenderPrograms(profile),original=iteratedDensityGpuPrograms(profile),header=profile==='webgl2'?'#version 300 es\nprecision highp float;precision highp int;precision highp sampler2D;precision highp usampler2D;\n':'#version 410 core\n';
  expect(plan.draw).toEqual({vertex:original.DRAW_VERTEX,fragment:original.DRAW_FRAGMENT});expect(plan.statsFirst.fragment).toBe(original.STATS_FIRST);expect(plan.statsReduce.fragment).toBe(original.STATS_REDUCE);expect(plan.present.vertex).toBe(header+DENSITY_PRESENT_VERTEX_GLSL);expect(plan.present.fragment).toBe(header+SOURCE_SYMMETRY_PRESENT_GLSL);expect(plan.presentReduce.fragment).toBe(header+SOURCE_DENSITY_PRESENT_REDUCTION_GLSL);expect(sourceIteratedRenderPrograms(profile,'map').present.fragment).toBe(header+SOURCE_MAP_PRESENT_GLSL);expect(sourceIteratedRenderPrograms(profile)).toBe(plan);
 });
 it.each(['points','quad'] as const)('selects the source %s fragment without changing geometry or statistics',path=>{
  const frame=job();frame.densitySplat!.path=path;const plan=prepareSourceIteratedDrawPlan(frame,target);
  expect(plan.sourceSplatProgram).toBe(path);
  for(const profile of ['webgl2','native-gl41'] as const){
   const programs=iteratedDensityGpuPrograms(profile),generic=sourceIteratedRenderPrograms(profile),source=sourceIteratedRenderPrograms(profile,'symmetry',plan.sourceSplatProgram);
   expect(source.draw.vertex).toBe(generic.draw.vertex);expect(source.draw.fragment).toBe(path==='points'?programs.SOURCE_DENSITY_POINTS_FRAGMENT:programs.SOURCE_DENSITY_QUAD_FRAGMENT);
   expect(source.draw.fragment).not.toBe(generic.draw.fragment);for(const stage of ['statsFirst','statsReduce','present','presentReduce','decay'] as const)expect(source[stage]).toEqual(generic[stage]);
   expect(sourceIteratedRenderPrograms(profile,'symmetry',path)).toBe(source);
   expect(source).not.toBe(sourceIteratedRenderPrograms(profile,'symmetry',path==='points'?'quad':'points'));
  }
 });
 it.each(['index','radius','angle','height','noise'])('keeps %s coloring on the generic program even with a source LUT',color=>{
  const frame=job();frame.config.color=color;
  for(const path of ['points','quad'] as const){frame.densitySplat!.path=path;const plan=prepareSourceIteratedDrawPlan(frame,target);expect(plan.palette.format).toBe('source-rgb1024');expect(plan.sourceSplatProgram).toBeUndefined();expect(sourceIteratedRenderPrograms('webgl2','symmetry',plan.sourceSplatProgram).draw.fragment).toBe(iteratedDensityGpuPrograms('webgl2').DRAW_FRAGMENT);}
 });
 it('switches source/local palette program selection independently from cached LUT contents',()=>{
  const frame=job(),source=prepareSourceIteratedDrawPlan(frame,target),compiled=sourceIteratedRenderPrograms('webgl2','symmetry',source.sourceSplatProgram);
  frame.palette.cycles=2;frame.symmetryPalette=prepareSourceSymmetryPalette(frame.palette);const local=prepareSourceIteratedDrawPlan(frame,target);
  expect(local.sourceSplatProgram).toBeUndefined();expect(local.palette.format).toBe('local-rgba4097');expect(local.palette.key).not.toBe(source.palette.key);expect(values(local.drawUniforms,'paletteCycles')).toEqual([2]);
  expect(sourceIteratedRenderPrograms('webgl2','symmetry',local.sourceSplatProgram).draw.fragment).toBe(iteratedDensityGpuPrograms('webgl2').DRAW_FRAGMENT);
  frame.palette.cycles=1;frame.palette.offset=.25;frame.symmetryPalette=prepareSourceSymmetryPalette(frame.palette);const restored=prepareSourceIteratedDrawPlan(frame,target);
  expect(restored.palette.key).not.toBe(source.palette.key);expect(restored.sourceSplatProgram).toBe('points');expect(sourceIteratedRenderPrograms('webgl2','symmetry',restored.sourceSplatProgram)).toBe(compiled);
 });
 it('binds both Float32 metric endpoints so source subtraction is not replaced by a CPU range',()=>{
  const frame=job();
  // This is a prepared-binding stress case, not a claim that source Symmetry
  // authoring exposes these values (its normal producer uses 0, 2, robust).
  frame.config.metricMin=100000003;frame.config.metricMax=100000005;
  const plan=prepareSourceIteratedDrawPlan(frame,target);
  expect(binding(plan.drawUniforms,'metricMin')).toEqual({name:'metricMin',kind:'float',values:[100000000]});
  expect(binding(plan.drawUniforms,'metricMax')).toEqual({name:'metricMax',kind:'float',values:[100000008]});
  expect(values(plan.drawUniforms,'metricRange')).toEqual([2]);expect(F(values(plan.drawUniforms,'metricMax')[0]-values(plan.drawUniforms,'metricMin')[0])).toBe(8);
  expect(new Set(plan.drawUniforms.map(u=>u.name)).size).toBe(plan.drawUniforms.length);
  for(const profile of ['webgl2','native-gl41'] as const)for(const path of ['points','quad'] as const){const fragment=sourceIteratedRenderPrograms(profile,'symmetry',path).draw.fragment;expect(fragment).toContain('metricMax-metricMin');expect(fragment).not.toMatch(/\bmetricRange\b/);}
  frame.config.metricMax=Infinity;expect(()=>prepareSourceIteratedDrawPlan(frame,target)).toThrow('Float32');
 });
 it('preserves the source fragment body and raw metric varying across profiles and primitive caches',()=>{
  const header=(profile:'webgl2'|'native-gl41')=>gpuShaderHeader(profile,'precision highp float;precision highp int;precision highp sampler2D;precision highp usampler2D;\n');
  for(const path of ['points','quad'] as const){
   const web=sourceIteratedRenderPrograms('webgl2','symmetry',path),native=sourceIteratedRenderPrograms('native-gl41','symmetry',path);
   expect(web).not.toBe(native);expect(web.draw.vertex.slice(header('webgl2').length)).toBe(native.draw.vertex.slice(header('native-gl41').length));expect(web.draw.fragment.slice(header('webgl2').length)).toBe(native.draw.fragment.slice(header('native-gl41').length));
   // Original points and quads both pass the unnormalized metric as a smooth
   // varying. The fragment owns normalization and LUT sampling.
   expect(web.draw.vertex).toContain('sourceStepMetric=particle.w;');expect(web.draw.fragment).toContain('in float sourceStepMetric;');expect(web.draw.fragment).not.toContain('flat in float sourceStepMetric');expect(web.draw.fragment).not.toContain('flat in vec3 tint');
   expect(web.draw.fragment).toContain(path==='points'?'gl_PointCoord*2.-1.':'localPoint');
  }
 });
 it('owns brightness, original scene clear, raw alpha and opaque final display independently',()=>{
  const tone=prepareSourceSymmetryTone(scene(),{width:32,height:24}),plan=prepareSourceIteratedPresentPlan(tone,32,24);
  expect(values(plan.uniforms,'origin')).toEqual([0,0]);expect(binding(plan.setupUniforms,'origin')).toBeUndefined();expect(plan.uniforms.at(-1)).toBe(plan.originUniform);
  expect(values(plan.uniforms,'brightness')).toEqual([F(1-F(.3))]);expect(plan.clear).toEqual(Float32Array.from([...tone.background,1]));expect(plan.filter).toBe('linear');expect(plan.blend).toMatchObject({source:'src-alpha',destination:'one-minus-src-alpha'});expect(plan.output).toBe('rgba8');expect(plan.display).toBe('opaque-rgb-copy');expect(plan.readbackOrigin).toBe('top-left');
  const toneWithAlpha={...tone,sceneBackground:[.1,.2,.3,.4] as const};expect(prepareSourceIteratedPresentPlan(toneWithAlpha,32,24).clear).toEqual(Float32Array.from([.1,.2,.3,.4]));expect(tone.tone.brightness).toBe(F(.3));
 });
 it.each([2,3] as const)('prepares source Map %iD cosine drawing with a family-bound captured camera',dimension=>{
  const s=parseProjectFile(JSON.stringify({config_version:'1.0.0',name:'Map draw',type:'MAP_ATTRACTOR',equations:{x_next:'x',y_next:'y',z_next:'z'},settings:{dimension,batch_size:8,burn_in_steps:0}})).scene;
  const frame=prepareIteratedFrame(s,0,0),camera=prepareOrdinarySourceFrame(ordinarySourceCameraFrame(sceneAtTime(s,0),{time:0,width:32,height:24,quality:'preview',sourceViewport:{logicalWidth:32,logicalHeight:24,referenceLogicalHeight:24,target:'primary',projectionPass:'perspective'}}));
  frame.sourceCamera=prepareCapturedDensityCamera('map',camera);
  for(const path of ['points','quad'] as const){frame.densitySplat!.path=path;const plan=prepareSourceIteratedDrawPlan(frame,target);expect(plan.family).toBe('map');expect(plan.sourceSplatProgram).toBe(path);expect(values(plan.drawUniforms,'mapCosine')).toEqual([1]);expect(values(plan.drawUniforms,'symmetryLut')).toEqual([0]);
   const program=sourceIteratedRenderPrograms('native-gl41',plan.family,plan.sourceSplatProgram);expect(program.draw.fragment).not.toContain('uniform sampler2D palette');expect(program.draw.fragment).toContain('in float sourceStepMetric;');expect(program.present.fragment).toContain(SOURCE_MAP_PRESENT_GLSL);
  }
  frame.sourceCamera={...frame.sourceCamera,anchor:{...frame.sourceCamera.anchor,family:'symmetry'}};expect(()=>prepareSourceIteratedDrawPlan(frame,target)).toThrow('相机');
 });
 it('keeps source Map nearest presentation and packed background alpha',()=>{
  const s=parseProjectFile(JSON.stringify({config_version:'1.0.0',name:'Map tone',type:'MAP_ATTRACTOR',equations:{x_next:'x',y_next:'y'},settings:{batch_size:8,background_color:0x80123456}})).scene,tone=prepareSourceMapTone(s,{width:32,height:24}),plan=prepareSourceIteratedPresentPlan(tone,32,24);
  expect(plan.family).toBe('map');expect(plan.filter).toBe('nearest');expect(plan.clear).toEqual(Float32Array.from(tone.sceneBackground!));
 });
 it('rejects malformed prepared identity, dimensions, transforms and clear colors',()=>{
  const frame=job();expect(()=>prepareSourceIteratedDrawPlan({...frame,kind:'map'},target)).toThrow('Symmetry');expect(()=>prepareSourceIteratedDrawPlan(frame,{...target,stateWidth:0})).toThrow('尺寸');expect(()=>prepareSourceIteratedDrawPlan(frame,{...target,bounds:{minX:1,maxX:1,minY:0,maxY:1}})).toThrow('退化');expect(()=>prepareSourceIteratedDrawPlan({...frame,transform:{...frame.transform,sx:Infinity}},target)).toThrow('Float32');
  const tone=prepareSourceSymmetryTone(scene(),{width:32,height:24});expect(()=>prepareSourceIteratedPresentPlan(tone,0,24)).toThrow('尺寸');expect(()=>prepareSourceIteratedPresentPlan({...tone,sceneBackground:[0,0,0,NaN]},32,24)).toThrow('清屏');expect(()=>prepareSourceIteratedPresentPlan({...tone,sourceSymmetryPresentation:undefined},32,24)).toThrow('身份');
 });
 it('binds typed prepared records in order through public WebGL uniform calls only',()=>{
  const gl={uniform1i:vi.fn(),uniform1f:vi.fn(),uniform2i:vi.fn(),uniform2f:vi.fn(),uniform3f:vi.fn(),uniform4f:vi.fn(),uniformMatrix4fv:vi.fn()},records:SourceIteratedRenderUniform[]=[{name:'counter',kind:'usampler2d',texture:1},{name:'flag',kind:'bool',values:[1]},{name:'weight',kind:'float',values:[F(.3)]},{name:'size',kind:'ivec2',values:[32,24]},{name:'matrix',kind:'mat4',values:Array.from({length:16},(_,i)=>i)}],names:string[]=[];
  applySourceIteratedRenderUniforms(gl as unknown as WebGL2RenderingContext,name=>{names.push(name);return null;},records);
  expect(names).toEqual(records.map(u=>u.name));expect(gl.uniform1i.mock.calls).toEqual([[null,1],[null,1]]);expect(gl.uniform1f).toHaveBeenCalledWith(null,F(.3));expect(gl.uniform2i).toHaveBeenCalledWith(null,32,24);expect(gl.uniformMatrix4fv).toHaveBeenCalledWith(null,false,Array.from({length:16},(_,i)=>i));
 });
});
