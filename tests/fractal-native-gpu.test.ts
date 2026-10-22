import {afterEach,describe,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {FractalSourceNewtonGpu,fractalSourceGpuBytes} from '../src/engine/fractalNativeNewtonGpu';
import {decodeFractalSourceTerminal} from '../src/engine/fractalNativeNewtonRaster';
import {FractalSourceGpuError,fractalSourceDevice} from '../src/engine/fractalSourceGpuFailure';
import {FRACTAL_NATIVE_NEWTON_GLSL} from '../src/engine/fractalNativeNewtonGlsl';
import {FractalGpu,unpackGpuOrbit} from '../src/engine/fractalGpu';
import {parseFractalSourceNativePlan,parseFractalSourcePlan,FRACTAL_SOURCE_NUMERIC_PROFILE,type FractalSourcePlan} from '../src/engine/fractalSourcePrecision';
import {fractalConfig} from '../src/scenes/complex';
import {createScene} from '../src/engine/document';
import mapping from './fixtures/source-fractal-mapping/source.json';
import type {SourceFractalFormulaNativeState} from '../src/engine/sourceFractalFormulaRuntime';
import {definition} from '../src/scenes';
import {parseFractalColors} from '../src/engine/fractalColor';
import {uploadFractalTrace} from '../src/engine/fractalColorGpu';
import {createDefaultFractalSourceColorConfiguration,prepareFractalSourceColor,type PreparedFractalSourceColor} from '../src/engine/fractalSourceColor';

const view={centerX:2,centerXLow:0,centerY:0,centerYLow:0,zoom:1,rotation:0};
const config=()=>fractalConfig({formula:'newton',power:2,iterations:8,fractalNumericProfile:FRACTAL_SOURCE_NUMERIC_PROFILE});
const plan=(v:Partial<typeof view>={})=>parseFractalSourcePlan(config(),{...view,...v},{logicalWidth:3,logicalHeight:2,provenance:'requested-output-local'},{precision:'high'});
const pixels=new Float32Array([0,0,2,1]);
function caught(fn:()=>unknown):unknown{try{fn();}catch(e){return e;}throw Error('Expected failure');}
type Handle={kind:string;id:number};
interface Failure {coordinatePayload?:boolean;throwAt?:string;deleteAt?:string;compile?:boolean;link?:boolean;nullAt?:string;framebuffer?:boolean;shortRead?:boolean;shortColorRead?:boolean;invalidRecord?:boolean;nanPayload?:boolean;lost?:boolean;floatAttachment?:boolean;textureLimit?:number;deleteGlError?:boolean;}
/** Protocol/resource contract double only. Real GLSL arithmetic is validated
 * separately against the retained original shaders in a real browser. */
function device(failure:Failure={}){
 const constants=new Map<string,number>(),live=new Set<Handle>(),calls:string[]=[],uniforms=new Map<string,number>(),arrayUniforms=new Map<string,number[]>(),uploads:number[]=[],textureFormats:number[]=[],textureBindings:(WebGLTexture|null)[]=[],textureUploads:{format:number;width:number;height:number;texture:WebGLTexture|null}[]=[];
 let boundTexture:WebGLTexture|null=null;let attachment=0;const scissors:number[][]=[];let nextConstant=1,nextHandle=1,tf=false,drawCount=0,error=0,currentProgram:Handle|null=null;const shaderPrograms=new Map<Handle,Handle>(),markedShaders=new Set<Handle>();
 const constant=(n:string)=>{if(!constants.has(n))constants.set(n,nextConstant++);return constants.get(n)!;};
 const op=(name:string,body:(...a:any[])=>any=()=>undefined)=>(...a:any[])=>{calls.push(name);if(failure.throwAt===name||failure.deleteAt===name)throw new Error('driver '+name);return body(...a);};
 const methods:Record<string,(...a:any[])=>any>={
  getParameter:op('getParameter',p=>p===constant('MAX_VIEWPORT_DIMS')?new Int32Array([16384,16384]):p===constant('MAX_TEXTURE_SIZE')?failure.textureLimit??16384:4096),
  isContextLost:op('isContextLost',()=>!!failure.lost),getError:op('getError',()=>{const r=error;error=0;return r||constant('NO_ERROR');}),
  getExtension:op('getExtension',name=>name==='EXT_color_buffer_float'&&failure.floatAttachment===false?null:{loseContext:op('loseContext',()=>{if(live.size)throw Error('Live objects remain before context loss');})}),
  getShaderParameter:op('getShaderParameter',()=>failure.compile!==false),getProgramParameter:op('getProgramParameter',()=>failure.link!==false),getShaderInfoLog:op('getShaderInfoLog',()=> 'compile'),getProgramInfoLog:op('getProgramInfoLog',()=> 'link'),
  useProgram:op('useProgram',p=>{currentProgram=p;}),attachShader:op('attachShader',(p,s)=>shaderPrograms.set(s,p)),
  getUniformLocation:op('getUniformLocation',(_p,name)=>({name})),uniform1i:op('uniform1i',(loc,value)=>uniforms.set(loc.name,value)),
  uniform4fv:op('uniform4fv',(loc,value)=>arrayUniforms.set(loc.name,Array.from(value))),uniform1fv:op('uniform1fv',(loc,value)=>arrayUniforms.set(loc.name,Array.from(value))),
  checkFramebufferStatus:op('checkFramebufferStatus',()=>constant(failure.framebuffer===false?'FRAMEBUFFER_UNSUPPORTED':'FRAMEBUFFER_COMPLETE')),
  beginTransformFeedback:op('beginTransformFeedback',()=>{tf=true;}),endTransformFeedback:op('endTransformFeedback',()=>{tf=false;}),
  drawArrays:op('drawArrays',(_mode,_first,n)=>{if(tf)drawCount=n;}),texImage2D:op('texImage2D',(_t,_l,format,w,h)=>{uploads.push(w*h);textureFormats.push(format);textureUploads.push({format,width:w,height:h,texture:boundTexture});}),bindTexture:op('bindTexture',(_t,texture)=>{textureBindings.push(texture);boundTexture=texture;}),
  scissor:op('scissor',(...values)=>scissors.push(values)),readBuffer:op('readBuffer',value=>{attachment=value-constant('COLOR_ATTACHMENT0');}),
  readPixels:op('readPixels',(_x,_y,width,_h,_format,_type,out:Float32Array|Uint8Array)=>{
   if(out instanceof Uint8Array){const rgba=Uint8Array.from({length:out.length},(_,i)=>(failure.coordinatePayload?[_x+(i>>2),_y,250,255]:[165,7,250,255])[i%4]);out.set(rgba.subarray(0,failure.shortColorRead?out.length-1:out.length));return;}
   const output=new Float32Array(width*4),bits=new Uint32Array(output.buffer);
   for(let i=0;i<width;i++){
    const k=i*4;const perturb=uniforms.get('u_usePerturbation')??0;
    output.set(attachment===0?(failure.coordinatePayload?[_x+i,0,_y,0]:[2,0,0,0]):attachment===1?[failure.invalidRecord?-1:0,perturb?10:0,0,1]:[1,0,0,0],k);
    if(failure.nanPayload&&attachment===0)bits[k]=0x7fc0f00d;
   }
   out.set(output.subarray(0,failure.shortRead?out.length-1:out.length));
  }),
  getBufferSubData:op('getBufferSubData',(_target,_offset,out:Float32Array|Uint32Array)=>{
   const output=new Float32Array(drawCount*40),bits=new Uint32Array(output.buffer);
   for(let i=0;i<drawCount;i++){
    const k=i*40;output.set([2,0,1,1,0,0,1,0],k);output[k+30]=0;output[k+31]=0;
    const perturb=uniforms.get('perturb')??0;output[k+33]=perturb;output[k+36]=perturb;output[k+38]=perturb?0:1;output[k+39]=perturb?1:0;
    if(failure.nanPayload){bits[k]=0x7fc0f00d;bits[k+8]=0x7fc0f00d;}
    if(failure.invalidRecord)output[k+2]=0;
   }
   const length=failure.shortRead?Math.max(1,out.length-1):out.length;
   if(out instanceof Uint32Array)out.set(bits.subarray(0,length));else out.set(output.subarray(0,length));
  }),
 };
 for(const kind of ['Program','Shader','Buffer','VertexArray','TransformFeedback','Texture','Framebuffer']){
  methods['create'+kind]=op('create'+kind,()=>{if(failure.nullAt==='create'+kind)return null;const h={kind,id:nextHandle++};live.add(h);return h;});
  methods['delete'+kind]=op('delete'+kind,h=>{if(failure.deleteGlError){error=constant('INVALID_OPERATION');return;}
   if(kind==='Program'&&h===currentProgram)return;
   if(kind==='Shader'&&live.has(shaderPrograms.get(h)!)){markedShaders.add(h);return;}
   live.delete(h);if(kind==='Program')for(const shader of markedShaders)if(shaderPrograms.get(shader)===h)live.delete(shader);
  });
 }
 const gl=new Proxy({}, {get(_t,k){const name=String(k);return name.toUpperCase()===name?constant(name):methods[name]??=op(name);}}) as WebGL2RenderingContext;
 const contexts=vi.fn(()=>gl);vi.stubGlobal('OffscreenCanvas',class{getContext(){return contexts();}});
 return{gl,live,calls,uniforms,arrayUniforms,uploads,contexts,failure,scissors,textureFormats,textureBindings,textureUploads};
}
const sample=(gpu:FractalSourceNewtonGpu,p=plan(),cancel?:()=>boolean)=>gpu.sample(pixels,3,2,view,config(),p,undefined,cancel);
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

describe('native shader provenance',()=>{
 it('retains both complete arithmetic bodies byte for byte',()=>{
  const math=FRACTAL_NATIVE_NEWTON_GLSL.split('// fractal_math.glsl SHA256 ')[1].split('\n').slice(1).join('\n').split('// formula_newton_nova.glsl SHA256 ')[0].slice(0,-1);
  const formula=FRACTAL_NATIVE_NEWTON_GLSL.split('// formula_newton_nova.glsl SHA256 ')[1].split('\n').slice(1).join('\n').slice(0,-1);
  expect(createHash('sha256').update(math).digest('hex')).toBe('e37d4e2d87c941cce9376b1b402a2e578a2f2aaf2f96e07e5382c7711b0b04dd');
  expect(createHash('sha256').update(formula).digest('hex')).toBe('4dfc7e88674c60d3be1b9b10ef116e7a7f2aab8e8805dc7b029c13f3a3c6c523');
 });
});
describe('source GPU ingress and ownership',()=>{
 it('uploads the actual mapped native integer and complete 4/32 slots',()=>{
  const native=mapping.cases.find(row=>row.input.id==='newton-native-round-and-floor')!.steps[0].native as unknown as SourceFractalFormulaNativeState;
  const p=parseFractalSourceNativePlan({formula:'newton',native,iterations:8},view,{logicalWidth:3,logicalHeight:2,provenance:'requested-output-local'},{precision:'medium'});
  const d=device(),gpu=new FractalSourceNewtonGpu();sample(gpu,p);
  expect(d.uniforms.get('u_power')).toBe(7);expect(p.shaderIntegerPower).toBe(3);
  expect(d.arrayUniforms.get('u_formulaParams')).toEqual(native.formulaParams);expect(d.arrayUniforms.get('u_dynamicParams[0]')).toEqual(native.dynamicParams);
  gpu.dispose();expect(d.live.size).toBe(0);
 });

 it('does not reinterpret an explicit source request as old independent CPU/step fallback',()=>{
  const d=device(),gpu=new FractalGpu(),c=config();expect(caught(()=>gpu.sample(pixels,3,2,view,c))).toMatchObject({kind:'input'});expect(d.contexts).not.toHaveBeenCalled();
  const old={...c};delete old.numericProfile;old.convergenceMode='step';expect(gpu.sample(pixels,3,2,view,old).warning).toContain('CPU');
  expect(caught(()=>gpu.sample(pixels,3,2,view,old,undefined,1e-4,undefined,{plan:plan()}))).toMatchObject({kind:'input'});gpu.dispose();
 });
 it('rejects forged plans, fractional/outside indices, shape and memory before any GL allocation',()=>{
  const d=device(),gpu=new FractalSourceNewtonGpu(),p=plan();
  expect(()=>sample(gpu,{...p} as FractalSourcePlan)).toThrow('prepared');
  for(const arr of [new Float32Array([.5,0]),new Float32Array([3,0]),new Float32Array([0,-1]),new Float32Array([NaN,0]),new Float32Array([0])])expect(caught(()=>gpu.sample(arr,3,2,view,config(),p))).toMatchObject({kind:'input'});
  expect(caught(()=>gpu.sample(pixels,16384,16384,view,config(),p))).toMatchObject({kind:'capacity'});expect(d.contexts).not.toHaveBeenCalled();gpu.dispose();
 });
 it('bounds complete frame, two reference/copy generations and typed TF representations',()=>{
  expect(fractalSourceGpuBytes(100,50,10,2048)).toBeGreaterThan(100*50*16+10*40*4+2048*16);
  expect(()=>fractalSourceGpuBytes(1,1,65537,1)).toThrow('65536');expect(()=>fractalSourceGpuBytes(1,1,1,2049)).toThrow('2048');
 });
 it('charges the still-owned large target before smaller-task CPU outputs and preserves the valid owner on rejection',()=>{
  const d=device(),gpu=new FractalSourceNewtonGpu(),p=plan();gpu.sample(new Float32Array([0,0]),10000,1200,view,config(),p);const before=gpu.diagnostics(),draws=d.calls.filter(c=>c==='drawArrays').length;
  expect(caught(()=>gpu.sample(new Float32Array(65536*2),1,1,view,config(),p))).toMatchObject({kind:'capacity'});
  expect(caught(()=>gpu.sampleOffsets(new Float32Array(65536*4),config(),p,undefined))).toMatchObject({kind:'capacity'});
  expect(gpu.diagnostics()).toEqual(before);expect(d.calls.filter(c=>c==='drawArrays')).toHaveLength(draws);gpu.dispose();expect(d.live.size).toBe(0);
 });
 it.each<Failure>([{compile:false},{link:false},{nullAt:'createProgram'},{nullAt:'createShader'},{nullAt:'createBuffer'},{nullAt:'createFramebuffer'},{nullAt:'createTexture'},{framebuffer:false},{floatAttachment:false},{textureLimit:1},{throwAt:'drawArrays'},{throwAt:'readPixels'},{invalidRecord:true},{shortRead:true}])('rejects a device/protocol failure and releases all owned resources (%j)',failure=>{
  const d=device(failure),gpu=new FractalSourceNewtonGpu();expect(caught(()=>sample(gpu))).toMatchObject({kind:'device'});expect(d.live.size).toBe(0);expect(gpu.diagnostics().contextOwned).toBe(false);gpu.dispose();
 });
 it('does not reject a legitimate NaN payload matching the readback sentinel',()=>{
  const d=device({nanPayload:true}),gpu=new FractalSourceNewtonGpu(),result=sample(gpu);expect(Number.isNaN(result.values![0])).toBe(true);expect(d.calls.filter(c=>c==='readPixels')).toHaveLength(10);
  const terminal=unpackGpuOrbit(result.values!,0,result.residual);expect(terminal).toMatchObject({inside:true,invalid:false,count:1});expect(Number.isNaN(terminal.z[0])).toBe(true);gpu.dispose();expect(d.live.size).toBe(0);
 });
 it('uses one reference entry/upload across probe, pixel batches and palette-only reuse',()=>{
  const d=device(),gpu=new FractalSourceNewtonGpu(),p=plan({zoom:100});expect(gpu.prepareReference(p).cacheHit).toBe(false);sample(gpu,p);sample(gpu,p);
  const colored=createScene(definition('fractal'));colored.settings.insideSolidColor='#ff0000';gpu.sample(pixels,3,2,view,config(),p,parseFractalColors(colored));
  expect(gpu.diagnostics()).toMatchObject({reference:{entries:1,builds:1,hits:3},referenceUploads:1,referenceHits:2,rasterAllocations:1,rasterDraws:6,samples:6,perturbSamples:6,ordinarySteps:0,perturbSteps:6});
  sample(gpu,plan({zoom:100,rotation:.1}));expect(gpu.diagnostics()).toMatchObject({reference:{builds:2},referenceUploads:2,rasterAllocations:1,rasterDraws:8});gpu.dispose();expect(d.live.size).toBe(0);expect(gpu.diagnostics().reference.entries).toBe(0);
 });
 it('preserves caller errors and aborts before context or after a real protocol read',()=>{
  const d=device(),gpu=new FractalSourceNewtonGpu(),error=new Error('caller cancellation callback');expect(caught(()=>sample(gpu,plan(),()=>{throw error;}))).toBe(error);expect(d.contexts).not.toHaveBeenCalled();
  expect(caught(()=>sample(gpu,plan(),()=>true))).toMatchObject({name:'AbortError'});expect(d.contexts).not.toHaveBeenCalled();
  expect(caught(()=>sample(gpu,plan(),()=>d.calls.includes('readPixels')))).toMatchObject({name:'AbortError'});expect(d.live.size).toBe(0);sample(gpu);gpu.dispose();expect(d.live.size).toBe(0);
 });
 it.each(['deleteProgram','deleteShader','deleteTexture','deleteBuffer','deleteVertexArray','deleteTransformFeedback','deleteFramebuffer'])('retains failed %s handles and blocks reuse until explicit disposal succeeds',deleteAt=>{
  const d=device(),gpu=new FractalSourceNewtonGpu();if(deleteAt==='deleteShader'){d.failure.compile=false;d.failure.deleteAt=deleteAt;expect(caught(()=>sample(gpu))).toMatchObject({kind:'cleanup'});}else{sample(gpu);d.failure.deleteAt=deleteAt;expect(caught(()=>gpu.dispose())).toMatchObject({kind:'cleanup'});}
  expect(gpu.diagnostics()).toMatchObject({cleanupPending:true,contextOwned:true});expect(d.live.size).toBeGreaterThan(0);const draws=d.calls.filter(c=>c==='drawArrays').length;expect(caught(()=>sample(gpu))).toMatchObject({kind:'cleanup'});expect(d.calls.filter(c=>c==='drawArrays')).toHaveLength(draws);
  delete d.failure.deleteAt;delete d.failure.compile;gpu.dispose();expect(d.live.size).toBe(0);expect(gpu.diagnostics()).toMatchObject({cleanupPending:false,ownedHandles:0,contextOwned:false});sample(gpu);gpu.dispose();
 });
 it('retains handles on silent GL deletion errors and owns context-loss invalidation',()=>{
  const d=device(),gpu=new FractalSourceNewtonGpu();sample(gpu);d.failure.deleteGlError=true;expect(caught(()=>gpu.dispose())).toMatchObject({kind:'cleanup'});expect(gpu.diagnostics().ownedHandles).toBeGreaterThan(0);delete d.failure.deleteGlError;gpu.dispose();expect(d.live.size).toBe(0);
  sample(gpu);d.failure.lost=true;expect(caught(()=>sample(gpu))).toMatchObject({kind:'device'});expect(gpu.diagnostics()).toMatchObject({contextOwned:false,reference:{entries:0},ownedHandles:0});
 });
 it('releases an in-use program and its attached delete-pending shaders before context loss',()=>{
  const d=device(),gpu=new FractalSourceNewtonGpu();sample(gpu);expect([...d.live].filter(h=>h.kind==='Shader')).toHaveLength(4);
  gpu.dispose();expect(d.live.size).toBe(0);expect(gpu.diagnostics().ownedHandles).toBe(0);
 });
 it('keeps all handles owned if unbinding the current program fails, then retries safely',()=>{
  const d=device(),gpu=new FractalSourceNewtonGpu();sample(gpu);const retained=gpu.diagnostics().ownedHandles;d.failure.throwAt='useProgram';
  expect(caught(()=>gpu.dispose())).toMatchObject({kind:'cleanup'});expect(gpu.diagnostics().ownedHandles).toBe(retained);
  delete d.failure.throwAt;gpu.dispose();expect(d.live.size).toBe(0);expect(gpu.diagnostics().cleanupPending).toBe(false);
 });
 it('retains a failed active feedback owner until it can be ended',()=>{
  const d=device(),gpu=new FractalSourceNewtonGpu();d.failure.throwAt='endTransformFeedback';expect(caught(()=>gpu.sampleOffsets(new Float32Array([0,0,0,0]),config(),plan(),undefined))).toMatchObject({kind:'cleanup'});expect(gpu.diagnostics().cleanupPending).toBe(true);delete d.failure.throwAt;gpu.dispose();expect(d.live.size).toBe(0);
 });
 it.each<Failure>([{throwAt:'getBufferSubData'},{shortRead:true},{invalidRecord:true}])('keeps explicit supplied-offset bridge read failures typed and owned (%j)',failure=>{
  const d=device(failure),gpu=new FractalSourceNewtonGpu();expect(caught(()=>gpu.sampleOffsets(new Float32Array([0,0,0,0]),config(),plan(),undefined))).toMatchObject({kind:'device'});expect(d.live.size).toBe(0);gpu.dispose();
 });
});
describe('fragment packing and bounded raster submission',()=>{
 it.each([
  [0,0,{iteration:0,steps:1,escaped:false,converged:false,startedPerturb:false,glitches:0,perturbSteps:0,ordinarySteps:1}],
  [0,11,{iteration:0,steps:1,escaped:false,converged:true,startedPerturb:true,glitches:0,perturbSteps:1,ordinarySteps:0}],
  [2047,16386,{iteration:2047,steps:2048,escaped:false,converged:false,startedPerturb:true,glitches:0,perturbSteps:2048,ordinarySteps:0}],
  [7,31,{iteration:7,steps:8,escaped:false,converged:true,startedPerturb:true,glitches:1,perturbSteps:3,ordinarySteps:5}],
  [0,14,{iteration:0,steps:1,escaped:false,converged:false,startedPerturb:true,glitches:1,perturbSteps:1,ordinarySteps:0}],
 ] as const)('decodes actual terminal %s/%s', (iteration,packed,expected)=>expect(decodeFractalSourceTerminal(iteration,packed,2048)).toEqual(expected));
 it.each([[0,8],[1,26],[2,4],[2048,0],[0,NaN],[0,16392]])('rejects impossible terminal %s/%s',(iteration,packed)=>expect(()=>decodeFractalSourceTerminal(iteration,packed,2048)).toThrow());
 it('coalesces bounded row spans while preserving requested sample counts and duplicates',()=>{
  const d=device(),gpu=new FractalSourceNewtonGpu(),p=plan();const points=new Float32Array([0,0,1,0,2,0,0,1,2,1,2,1]);
  gpu.sample(points,3,2,view,config(),p);expect(d.scissors).toEqual([[0,1,3,1],[0,0,3,1]]);expect(gpu.diagnostics()).toMatchObject({samples:6,draws:2,rasterDraws:2,rasterAllocations:1});gpu.dispose();
 });
});
describe('sparse raster ownership',()=>{
 it('scatters color and orbit records into caller order, including duplicate pixels',()=>{
  const d=device({coordinatePayload:true}),gpu=new FractalSourceNewtonGpu();
  const points=new Float32Array([2,1,0,0,1,0,2,1]),batch=gpu.sample(points,3,2,view,config(),plan(),undefined,undefined,colorPlan());
  expect(Array.from(batch.sourceRGBA!)).toEqual([2,0,250,255,0,1,250,255,1,1,250,255,2,0,250,255]);
  expect([0,1,2,3].map(i=>Array.from(batch.values!.slice(i*8,i*8+2)))).toEqual([[2,0],[0,1],[1,1],[2,0]]);
  expect(d.scissors).toEqual([[0,1,2,1],[2,0,1,1]]);expect(gpu.diagnostics().samples).toBe(4);gpu.dispose();expect(d.live.size).toBe(0);
 });
 it('bounds gap-inclusive draw work and readbacks at high iteration counts',()=>{
  const d=device(),gpu=new FractalSourceNewtonGpu(),c={...config(),iterations:2048};
  const p=parseFractalSourcePlan(c,view,{logicalWidth:200,logicalHeight:1,provenance:'requested-output-local'},{precision:'high'});
  const points=Float32Array.from({length:200},(_,i)=>i%2?0:i);
  gpu.sample(points,200,1,view,c,p);
  expect(d.scissors).toEqual([[0,0,61,1],[62,0,61,1],[124,0,61,1],[186,0,13,1]]);
  expect(d.scissors.every(row=>row[2]*2048*16<=2_000_000)).toBe(true);expect(gpu.diagnostics().samples).toBe(100);gpu.dispose();
 });
});
describe('shared trap texture transfer',()=>{
 it('types only actual trace GL operations; input geometry rejection is preserved',()=>{
  const scene=createScene(definition('fractal')),colors=parseFractalColors(scene),d=device({throwAt:'uniform1i'});
  expect(caught(()=>uploadFractalTrace(d.gl,{} as WebGLProgram,colors,undefined,fractalSourceDevice))).toMatchObject({kind:'device'});
  delete d.failure.throwAt;Object.assign(scene.settings,{insideColoring:'orbit_trap_index',insideTrapReal:1e10+.1,insideTrapThreshold:.001});
  const invalid=parseFractalColors(scene),error=caught(()=>uploadFractalTrace(d.gl,{} as WebGLProgram,invalid,undefined,fractalSourceDevice));
  expect(error).toBeInstanceOf(Error);expect(error).not.toBeInstanceOf(FractalSourceGpuError);expect((error as Error).message).toContain('precision');expect(d.live.size).toBe(0);
 });

 it('transfers custody before an upload failure without double deletion; omission preserves legacy cleanup',()=>{
  const scene=createScene(definition('fractal')),colors=parseFractalColors(scene),d=device({throwAt:'texImage2D'});const retained:WebGLTexture[]=[];
  expect(()=>uploadFractalTrace(d.gl,{} as WebGLProgram,colors,t=>retained.push(t))).toThrow('texImage2D');expect(retained).toHaveLength(1);expect(d.live.has(retained[0] as Handle)).toBe(true);expect(d.calls).not.toContain('deleteTexture');
  d.gl.deleteTexture(retained[0]);expect(d.live.size).toBe(0);expect(()=>uploadFractalTrace(d.gl,{} as WebGLProgram,colors)).toThrow('texImage2D');expect(d.live.size).toBe(0);
 });
 it('the source owner retains a palette whose failed upload is followed by failed deletion',()=>{
  const d=device(),gpu=new FractalSourceNewtonGpu(),colors=parseFractalColors(createScene(definition('fractal')));sample(gpu);d.failure.throwAt='texImage2D';d.failure.deleteAt='deleteTexture';
  expect(caught(()=>gpu.sample(pixels,3,2,view,config(),plan(),colors))).toMatchObject({kind:'cleanup'});expect(d.live.size).toBeGreaterThan(0);delete d.failure.throwAt;delete d.failure.deleteAt;gpu.dispose();expect(d.live.size).toBe(0);
 });
});

const colorPlan=()=>prepareFractalSourceColor({configuration:createDefaultFractalSourceColorConfiguration(),formulaPower:2,bailout:4});
const sampleColor=(gpu:FractalSourceNewtonGpu,color=colorPlan(),cancelled?:()=>boolean)=>gpu.sample(pixels,3,2,view,config(),plan(),undefined,cancelled,color);
describe('native color MRT transport and resource ownership',()=>{
 it('returns final RGBA8 bytes without interpreting color, preserving legitimate sentinel bytes and numeric diagnostics',()=>{
  const d=device(),gpu=new FractalSourceNewtonGpu(),color=colorPlan(),batch=sampleColor(gpu,color);
  expect(batch.sourceRGBA).toEqual(Uint8Array.from([165,7,250,255,165,7,250,255]));expect(batch.traps).toBeUndefined();expect(batch.values).toHaveLength(16);expect(batch.residual).toHaveLength(16);expect(batch.source).toHaveLength(8);
  expect(d.textureFormats.filter(x=>x===d.gl.RGBA8)).toHaveLength(1);expect(d.textureFormats.filter(x=>x===d.gl.RGB32F)).toHaveLength(1);expect(d.uniforms.get('u_gradientSize')).toBe(1024);expect(d.uniforms.get('u_gradientTex')).toBe(1);
  expect(gpu.diagnostics()).toMatchObject({colorSamples:2,colorUploads:1,colorHits:0,colorPlanKey:color.key,colorLutKey:color.lutKey});gpu.dispose();expect(d.live.size).toBe(0);
 });
 it('rejects forged color plans before context creation and leaves an existing owner valid',()=>{
  const d=device(),gpu=new FractalSourceNewtonGpu(),color=colorPlan();expect(()=>sampleColor(gpu,{...color} as PreparedFractalSourceColor)).toThrow();expect(d.contexts).not.toHaveBeenCalled();
  sampleColor(gpu,color);const before=gpu.diagnostics();expect(()=>sampleColor(gpu,{...color} as PreparedFractalSourceColor)).toThrow();expect(gpu.diagnostics()).toEqual(before);gpu.dispose();expect(d.live.size).toBe(0);
 });
 it('caches unchanged LUT bytes across parameter changes, uploads palette changes and reallocates only the differing target format',()=>{
  const d=device(),gpu=new FractalSourceNewtonGpu(),a=colorPlan(),configuration=createDefaultFractalSourceColorConfiguration();sampleColor(gpu,a);sampleColor(gpu,a);
  configuration.outside.density=1.75;const b=prepareFractalSourceColor({configuration,formulaPower:2,bailout:4});sampleColor(gpu,b);
  expect(gpu.diagnostics()).toMatchObject({colorUploads:1,colorHits:2,colorPlanKey:b.key,rasterAllocations:1});
  configuration.palette.colors=['#123456','#abcdef'];sampleColor(gpu,prepareFractalSourceColor({configuration,formulaPower:2,bailout:4}));expect(gpu.diagnostics()).toMatchObject({colorUploads:2,rasterAllocations:1});
  expect(sample(gpu).sourceRGBA).toBeUndefined();sampleColor(gpu,a);expect(gpu.diagnostics().rasterAllocations).toBe(3);gpu.dispose();expect(d.live.size).toBe(0);
 });
 it('restores the old trace texture after source LUT use instead of sampling the wrong palette',()=>{
  const d=device(),gpu=new FractalSourceNewtonGpu(),colors=parseFractalColors(createScene(definition('fractal'))),p=plan();
  gpu.sample(pixels,3,2,view,config(),p,colors);const oldTrace=d.textureUploads.find(t=>t.width===1025&&t.height===2)?.texture;
  const oldTextureCount=d.uploads.filter(v=>v===2050).length;sampleColor(gpu);const before=d.textureBindings.length;
  gpu.sample(pixels,3,2,view,config(),p,colors);expect(d.uploads.filter(v=>v===2050)).toHaveLength(oldTextureCount);expect(oldTrace).toBeTruthy();expect(d.textureBindings.slice(before)).toContain(oldTrace);gpu.dispose();expect(d.live.size).toBe(0);
 });
 it('detects silent partial native RGBA readback and can recover in a fresh owned context',()=>{
  const d=device({shortColorRead:true}),gpu=new FractalSourceNewtonGpu();expect(caught(()=>sampleColor(gpu))).toMatchObject({kind:'device'});expect(d.live.size).toBe(0);delete d.failure.shortColorRead;sampleColor(gpu);gpu.dispose();expect(d.live.size).toBe(0);
 });
 it('retains a failed source LUT deletion after upload failure, then retries cleanup without losing the original cause',()=>{
  const d=device(),gpu=new FractalSourceNewtonGpu();sample(gpu);d.failure.throwAt='texImage2D';d.failure.deleteAt='deleteTexture';
  const error=caught(()=>sampleColor(gpu));expect(error).toMatchObject({kind:'cleanup',cause:expect.any(AggregateError)});expect(gpu.diagnostics().cleanupPending).toBe(true);expect(d.live.size).toBeGreaterThan(0);
  delete d.failure.throwAt;delete d.failure.deleteAt;gpu.dispose();expect(d.live.size).toBe(0);
 });
 it('cancels after source color readback and disposes every target/LUT/program',()=>{
  const d=device(),gpu=new FractalSourceNewtonGpu();expect(caught(()=>sampleColor(gpu,colorPlan(),()=>d.calls.includes('readPixels')))).toMatchObject({name:'AbortError'});expect(d.live.size).toBe(0);gpu.dispose();
 });
 it('accounts for the source LUT copies and mixed target without claiming driver storage',()=>{
  const old=fractalSourceGpuBytes(100,50,10,2048),native=fractalSourceGpuBytes(100,50,10,2048,false,true);
  expect(native-old).toBe(-100*50*12+5*1024*3*4+10*4+12); // Includes the 1×1 RGB32F fallback texture.
 });
 it('charges a still-owned mixed target and LUT before a large legacy batch, retaining the owner on preflight rejection',()=>{
  const d=device(),gpu=new FractalSourceNewtonGpu();gpu.sample(new Float32Array([0,0]),10000,1500,view,config(),plan(),undefined,undefined,colorPlan());const before=gpu.diagnostics();
  expect(caught(()=>gpu.sample(new Float32Array(65536*2),1,1,view,config(),plan()))).toMatchObject({kind:'capacity'});expect(gpu.diagnostics()).toEqual(before);gpu.dispose();expect(d.live.size).toBe(0);
 });
 it('facade preserves source color bytes and rejects applying the native color plan to legacy arithmetic',()=>{
  const d=device(),gpu=new FractalGpu(),c=config();expect(gpu.sample(pixels,3,2,view,c,undefined,1e-4,undefined,{plan:plan(),colorPlan:colorPlan()}).sourceRGBA).toHaveLength(8);
  delete c.numericProfile;expect(caught(()=>gpu.sample(pixels,3,2,view,c,undefined,1e-4,undefined,{plan:plan(),colorPlan:colorPlan()}))).toMatchObject({kind:'input'});gpu.dispose();expect(d.live.size).toBe(0);
 });
});
