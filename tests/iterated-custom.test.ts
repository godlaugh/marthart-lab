import {describe,it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {createScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {builtInIterationResult,exploreSymmetry} from '../src/scenes/iterated';
import {IteratedDensitySession,prepareIteratedFrame,type IteratedKind,type IteratedFrameJob} from '../src/scenes/iteratedDensity';
import {IteratedDensityGpu} from '../src/engine/iteratedDensityGpu';
import {sceneAtTime} from '../src/engine/timeline';
import {generateScene,TemporalGenerationSession} from '../src/engine/temporal';
import {SYMMETRY_DEFAULT_PARAMETERS,SYMMETRY_DEFAULT_SETTINGS} from '../src/scenes/symmetryParameters';
import {withSymmetryTemplate} from '../src/engine/symmetryEditing';

const hash=(a:ArrayBufferView)=>createHash('sha256').update(new Uint8Array(a.buffer,a.byteOffset,a.byteLength)).digest('hex');
// Captured from the production CPU owner before adding the custom-field union
// and moving distance calculation into its step-result producer. Raw ink and
// pixels independently guard recurrence order, PRNG addresses and color metric.
const oldHashes:[IteratedKind,number,string,string][]=[
 ['map',0,'4458f0821f692fc662034f4b888a5375d847f64b2cd1e0bdc6e53d83039f7256','c06bbdb05b0ac0baab913c9e00be75800216a676572518614059e6efd59181f1'],
 ['map',.23,'0fdc5a2f4bac7b0d5471c1043301ba8424f1a2029a3ae099b79ca3f72039a5cd','3bc14de280ac8ac6966764ab0a836dc12b7a0f055f3884c570c6e95a30551d59'],
 ['symmetry',0,'f96f120e3ccd5e664ee3eb35d43b04604df1c38c155bf6a11cd105a2bfd4351b','8f4f55aa56d07254b97d58e9d6058014a59421739bd78dab07b82a29ea6b7a44'],
 ['symmetry',.23,'e636a513b8cbf93e65403877d1ae9a7ad6a613cd4638b67697ca7c73a23bb0f1','07b59232b16c5f370bdb7066b12d5585593b773f125a9933475f1d09bb8ce8c2'],
 ['samila',0,'57ec0a910448af7ca01dc2c2ebe149b8ff607fb99f80f2ff91c5e4b8d204b1de','c8cf0e1d8ccd5471e6fd46f58537542143c4a6056be72b5992728d191e2a3b6e'],
 ['samila',.23,'69a9e8eb89d5d45a16845540c77e07b3108ba8c317a85605cacba53fc5afe988','7df2d00213c607fa9e09ef823ece4b20d44fa9b125557d6c55cd3997abc054d6'],
];

describe('one field result owns position, metric and validity',()=>{
 it('returns the built-in three-dimensional displacement and preserves the escape boundary',()=>{
  expect(builtInIterationResult([1,2,3],[4,6,15],20)).toEqual({position:[4,6,15],metric:13,valid:true});
  expect(builtInIterationResult([0,0,0],[3,4,0],5)).toEqual({position:[3,4,0],metric:5,valid:true});
  expect(builtInIterationResult([0,0,0],[3,4,0],4.99).valid).toBe(false);
  expect(builtInIterationResult([0,0,0],[0,0,0],1)).toEqual({position:[0,0,0],metric:0,valid:true});
  for(const position of [[NaN,0,0],[Infinity,0,0],[0,-Infinity,0]] as [number,number,number][])expect(builtInIterationResult([0,0,0],position,5).valid).toBe(false);
  expect(builtInIterationResult([Infinity,0,0],[0,0,0],5).valid).toBe(false);
 });
 for(const [kind,time,pixelsHash,inkHash] of oldHashes)it(`retains ${kind} CPU output and raw history at ${time}`,()=>{
  const s=createScene(definition(kind));Object.assign(s.settings,{iteratedMode:'continuous',iteratedBackend:'cpu',batchSize:32,burnIn:7,iterationsPerFrame:3,iteratedFps:10,densityView:'manual',densitySpan:6,pointSize:1,paletteMode:'source',showTrails:false,alpha:.3,stepMetricMax:4});
  const owner=new IteratedDensitySession();try{const out=owner.generate(s,{time,width:43,height:31,quality:'export'}),ink=owner.snapshotInk();if(out.type!=='raster')throw Error('raster required');expect(hash(out.pixels)).toBe(pixelsHash);expect(hash(new Uint8Array(ink.buffer,ink.byteOffset,ink.byteLength))).toBe(inkHash);}finally{owner.reset();}
 });
});

const customCode='uniform float gain;\nuniform float symmetry_degree;\nuniform float time;\nvoid calculate_next(in vec3 pos, out vec3 nextPos, out float stepMetric){ nextPos=vec3(pos.x+gain+float({N}),pos.y+time,0.); stepMetric=-2.; }';
function customScene(){
 const s=createScene(definition('symmetry'));s.equations.glsl=customCode;s.parameters={gain:.1,symmetry_degree:3,time:0};
 Object.assign(s.settings,{iteratedMode:'continuous',iteratedBackend:'auto',batchSize:4,burnIn:0,iterationsPerFrame:1,iteratedFps:10,densityView:'manual',densitySpan:20,degree:5});return s;
}
const context={time:0,width:13,height:9,quality:'export' as const};
function budgetedPlan(job:IteratedFrameJob){if(job.field.kind!=='symmetry-custom'||job.field.plan.dialect!=='webgl2-glsl-es-300-budgeted-v1')throw Error('expected budgeted WebGL custom plan');return job.field.plan;}


describe('custom Symmetry production boundary',()=>{
 it('separates authored compilation from runtime named uniforms and preserves raw parameter identity',()=>{
  const s=customScene(),runtime=structuredClone(s);runtime.settings.degree=9;runtime.parameters.gain=.123456789;runtime.parameters.symmetry_degree=11;runtime.parameters.time=7;
  const base=prepareIteratedFrame(s,0,0,s),animated=prepareIteratedFrame(runtime,.2,2,s);
  if(base.field.kind!=='symmetry-custom'||animated.field.kind!=='symmetry-custom')throw Error('custom field required');
  expect(animated.field.plan.compileDegree).toBe(5);expect(budgetedPlan(animated).programKey).toBe(budgetedPlan(base).programKey);
  expect(animated.field.uniforms).toMatchObject({gain:Math.fround(.123456789),symmetry_degree:11,time:7});
  expect(animated.field.parameters.gain).toBe(.123456789);expect(animated.field.time).toBe(.2);
  expect(animated.fieldKey).not.toBe(base.fieldKey);
  const unused=structuredClone(runtime);unused.parameters.unused=1;const extra=prepareIteratedFrame(unused,.2,2,s);
  expect(extra.fieldKey).not.toBe(animated.fieldKey);if(extra.field.kind!=='symmetry-custom')throw Error();expect(extra.field.uniforms).toEqual(animated.field.uniforms);
  runtime.parameters={gain:1e100};const converted=prepareIteratedFrame(runtime,.2,2,s).field;if(converted.kind!=='symmetry-custom')throw Error();expect(converted.uniforms).toEqual({gain:0,symmetry_degree:0,time:0});expect(converted.parameters.gain).toBe(1e100);
 });
 it('uses the custom degree owner independently of built-in degree and delta-power limits',()=>{
  const s=customScene();s.settings.degree=2147483647;s.settings.deltaPower=999;s.parameters.delta_power=999;
  const field=prepareIteratedFrame(s,0,0).field;if(field.kind!=='symmetry-custom')throw Error();expect(field.plan.compileDegree).toBe(2147483647);expect(field.plan.expandedSource).toContain('2147483647');expect(field.parameters.delta_power).toBe(999);
  s.settings.degree=2147483648;expect(()=>prepareIteratedFrame(s,0,0)).toThrow();
 });
 it('shares omitted built-in defaults across scene creation and both producing paths',()=>{
  const explicit=createScene(definition('symmetry')),omitted=structuredClone(explicit);expect(explicit.parameters).toEqual(SYMMETRY_DEFAULT_PARAMETERS);expect(Object.isFrozen(SYMMETRY_DEFAULT_PARAMETERS)).toBe(true);expect(Object.isFrozen(SYMMETRY_DEFAULT_SETTINGS)).toBe(true);
  omitted.parameters={};for(const key of Object.keys(SYMMETRY_DEFAULT_SETTINGS))delete omitted.settings[key];
  expect(prepareIteratedFrame(omitted,0,0).field).toEqual(prepareIteratedFrame(explicit,0,0).field);
  for(const s of [explicit,omitted])Object.assign(s.settings,{count:20,burnIn:3});
  const a=definition('symmetry').generate(explicit,context),b=definition('symmetry').generate(omitted,context);if(a.type!=='geometry'||b.type!=='geometry')throw Error();expect(b.positions).toEqual(a.positions);expect(b.colors).toEqual(a.colors);
 });
 it('retains custom uniform names through a real template switch without letting unused names affect fixed mathematics',()=>{
  const custom=customScene();Object.assign(custom.parameters,{_glsl:4,time:7,x:9,sin:11});
  const fixed=withSymmetryTemplate(custom,'standard'),clean=structuredClone(fixed);clean.parameters={...SYMMETRY_DEFAULT_PARAMETERS};
  expect(fixed.parameters).toMatchObject({_glsl:4,time:7,x:9,sin:11});expect(fixed.equations.glsl).toBeUndefined();expect(custom.equations.glsl).toBe(customCode);
  expect(prepareIteratedFrame(fixed,0,0).field).toEqual(prepareIteratedFrame(clean,0,0).field);
  for(const scene of [fixed,clean])scene.settings.iteratedBackend='cpu';
  const a=generateScene(fixed,context),b=generateScene(clean,context);if(a.type!=='raster'||b.type!=='raster')throw Error();expect(a.pixels).toEqual(b.pixels);expect(a.stats.samples).toBe(b.stats.samples);
  fixed.parameters['bad-name']=1;expect(()=>prepareIteratedFrame(fixed,0,0)).toThrow();delete fixed.parameters['bad-name'];fixed.parameters._glsl=NaN;expect(()=>prepareIteratedFrame(fixed,0,0)).toThrow();
 });
 it('keeps the compile degree across actual timeline frames while uniforms animate through the parameter owner',()=>{
  const s=customScene();s.timeline.tracks=[{id:'d',target:'settings.degree',from:2,to:8,start:0,duration:.2,easing:'linear',pingPong:false,enabled:true},{id:'n',target:'parameters.symmetry_degree',from:2,to:8,start:0,duration:.2,easing:'linear',pingPong:false,enabled:true}];
  const jobs:IteratedFrameJob[]=[],step=vi.spyOn(IteratedDensityGpu.prototype,'step').mockImplementation((job,options)=>{jobs.push(job);return{bounds:options.bounds!,steps:4,invalid:0,accepted:4,clipped:0,sampleInvalid:0};});
  const present=vi.spyOn(IteratedDensityGpu.prototype,'present').mockReturnValue({pixels:new Uint8ClampedArray(context.width*context.height*4),occupiedPixels:1,maxCount:1,toneBackend:'webgl2',warnings:[]});
  const owner=new IteratedDensitySession();try{
   const out=owner.generate(s,{...context,time:.2});expect(out.backend).toBe('webgl2');expect(jobs).toHaveLength(3);
   for(const [index,job]of jobs.entries()){if(job.field.kind!=='symmetry-custom')throw Error();expect(job.field.plan.compileDegree).toBe(5);expect(job.field.uniforms.symmetry_degree).toBe([2,5,8][index]);expect(budgetedPlan(job).programKey).toBe(budgetedPlan(jobs[0]).programKey);}
   expect(prepareIteratedFrame(sceneAtTime(s,.2),.2,2,s).field).toEqual(jobs[2].field);
  }finally{owner.reset();step.mockRestore();present.mockRestore();}
 });
 it('rejects explicit CPU without allocating a GPU or silently executing the built-in template',()=>{
  const s=customScene();s.settings.iteratedBackend='cpu';const raw=JSON.stringify(s),step=vi.spyOn(IteratedDensityGpu.prototype,'step'),owner=new IteratedDensitySession();
  try{expect(()=>owner.generate(s,context)).toThrow(/不能使用 CPU 内建方程替代/);expect(step).not.toHaveBeenCalled();expect(owner.diagnostics().retainedBytes).toBe(0);expect(JSON.stringify(s)).toBe(raw);}finally{owner.reset();step.mockRestore();}
 });
 it('attempts real GPU selection even for small auto batches and never caches a builtin fallback after failure',()=>{
  const s=customScene(),step=vi.spyOn(IteratedDensityGpu.prototype,'step').mockImplementation(()=>{throw Error('custom shader compilation failed');}),owner=new IteratedDensitySession();
  try{for(let attempt=0;attempt<2;attempt++){expect(()=>owner.generate(s,context)).toThrow(/未使用内建方程替代.*custom shader compilation failed/);expect(owner.diagnostics().retainedBytes).toBe(0);}expect(step).toHaveBeenCalledTimes(2);}finally{owner.reset();step.mockRestore();}
 });
 it('discards partially progressed custom state when a later step or presentation fails, and propagates cancellation',()=>{
  const s=customScene(),owner=new IteratedDensitySession(),step=vi.spyOn(IteratedDensityGpu.prototype,'step').mockImplementation((job,options)=>{if(job.frame===1)throw Error('later custom failure');return{bounds:options.bounds!,steps:4,invalid:0,accepted:4,clipped:0,sampleInvalid:0};});
  const present=vi.spyOn(IteratedDensityGpu.prototype,'present').mockImplementation(()=>{throw Error('custom presentation failure');});
  try{
   expect(()=>owner.generate(s,{...context,time:.2})).toThrow(/later custom failure/);expect(owner.diagnostics().retainedBytes).toBe(0);expect(present).not.toHaveBeenCalled();
   expect(()=>owner.generate(s,context)).toThrow(/custom presentation failure/);expect(owner.diagnostics().retainedBytes).toBe(0);
   const cancelled=new DOMException('custom cancelled','AbortError');step.mockImplementation(()=>{throw cancelled;});expect(()=>owner.generate(s,context)).toThrow(cancelled);expect(owner.diagnostics().retainedBytes).toBe(0);
  }finally{owner.reset();step.mockRestore();present.mockRestore();}
 });
 it('keeps custom source when single-sample generation and fixed-template exploration are unavailable',()=>{
  const s=customScene();s.settings.iteratedMode='single';const raw=JSON.stringify(s);
  expect(()=>definition('symmetry').generate(s,context)).toThrow(/单次采样不可用/);
  expect(()=>exploreSymmetry(1,{customGlsl:s.equations.glsl,candidates:1})).toThrow(/不支持内建模板探索/);
  expect(JSON.stringify(s)).toBe(raw);expect(()=>exploreSymmetry(1,{customGlsl:7,candidates:1})).toThrow();
 });
 it('keeps the public temporal route from swallowing custom errors through the generic density window',()=>{
  const s=customScene();s.settings.presentation='density';s.settings.densityAccumulation='window';s.settings.iteratedBackend='cpu';const session=new TemporalGenerationSession();
  try{expect(()=>generateScene(s,context,session)).toThrow(/不能使用 CPU 内建方程替代/);expect(session.diagnostics().retainedBytes).toBe(0);s.settings.iteratedMode='single';expect(()=>generateScene(s,context,session)).toThrow(/单次采样不可用/);expect(session.diagnostics().retainedBytes).toBe(0);}finally{session.reset();}
 });
 it('replays the real session schedule after custom source edits and releases its owner on family exit',()=>{
  const s=customScene(),session=new TemporalGenerationSession(),jobs:IteratedFrameJob[]=[],step=vi.spyOn(IteratedDensityGpu.prototype,'step').mockImplementation((job,options)=>{jobs.push(job);return{bounds:options.bounds!,steps:4,invalid:0,accepted:4,clipped:0,sampleInvalid:0};}),present=vi.spyOn(IteratedDensityGpu.prototype,'present').mockReturnValue({pixels:new Uint8ClampedArray(context.width*context.height*4),occupiedPixels:1,maxCount:1,toneBackend:'webgl2',warnings:[]});
  try{
   expect(generateScene(s,{...context,time:.2},session).stats.samples).toBe(12);expect(jobs).toHaveLength(3);
   const originalKey=jobs[0].fieldKey;expect(generateScene(s,{...context,time:.25},session).stats.samples).toBe(12);expect(jobs).toHaveLength(3);
   s.equations.glsl+='\n// preserved source edit';generateScene(s,{...context,time:.2},session);expect(jobs).toHaveLength(6);expect(jobs[3].fieldKey).not.toBe(originalKey);expect(jobs.slice(3).map(j=>j.frame)).toEqual([0,1,2]);
   const map=createScene(definition('map'));map.settings.count=4;map.settings.burnIn=0;generateScene(map,context,session);expect(session.diagnostics().iterated.retainedBytes).toBe(0);
  }finally{session.reset();step.mockRestore();present.mockRestore();}
 });
 it('retains blank-source builtin behavior and reports unavailable GPU instead of producing a fake custom image',()=>{
  const s=customScene();s.equations.glsl=' \n\t ';s.parameters=createScene(definition('symmetry')).parameters;
  expect(prepareIteratedFrame(s,0,0).field.kind).toBe('symmetry');
  if(typeof OffscreenCanvas==='undefined'){s.equations.glsl=customCode;s.settings.iteratedBackend='gpu';expect(()=>definition('symmetry').generate(s,context)).toThrow(/未使用内建方程替代/);}
 });
});
