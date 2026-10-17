import {afterEach,describe,expect,it,vi} from 'vitest';
import {DomainGpu} from '../src/engine/domainGpu';
import {DomainGpuError,domainGpuOperation,type DomainGpuFailureStage} from '../src/engine/domainGpuFailure';
import {domainExpressions} from '../src/engine/domainExpressions';
import {NativeExpressionCapacityError} from '../src/engine/domainNativeParser';
import {parseDomainModel} from '../src/engine/domainModel';
import {createScene} from '../src/engine/document';
import {definition} from '../src/scenes';

type Handle={kind:string;id:number};
interface Failure {throwAt?:string;error?:Error;compile?:boolean;link?:boolean;nullAt?:string;textureLimit?:number;lostAfterDraw?:boolean;invalidFlags?:boolean;repair?:boolean;framebuffer?:boolean;glError?:boolean;}
/** Contract double for API boundary classification/ownership only. This does
 * not compile GLSL or establish real-driver numerical/resource behavior. */
function device(failure:Failure={}){
 const constants=new Map<string,number>(),live=new Set<Handle>(),calls:string[]=[];let nextConstant=1,nextHandle=1,current:Handle|null=null,draws=0;
 const constant=(name:string)=>{if(!constants.has(name))constants.set(name,nextConstant++);return constants.get(name)!;};
 const op=(name:string,body:(...a:any[])=>any=()=>undefined)=>(...a:any[])=>{calls.push(name);if(failure.throwAt===name)throw failure.error??new Error('driver '+name);return body(...a);};
 const methods:Record<string,(...a:any[])=>any>={
  getParameter:op('getParameter',p=>p===constant('CURRENT_PROGRAM')?current:p===constant('MAX_VIEWPORT_DIMS')?new Int32Array([16384,16384]):p===constant('MAX_TEXTURE_SIZE')?failure.textureLimit??16384:4096),
  isContextLost:op('isContextLost',()=>!!failure.lostAfterDraw&&draws>0),getError:op('getError',()=>constant(failure.glError?'INVALID_OPERATION':'NO_ERROR')),
  getShaderParameter:op('getShaderParameter',()=>failure.compile!==false),getProgramParameter:op('getProgramParameter',()=>failure.link!==false),
  getShaderInfoLog:op('getShaderInfoLog',()=> 'shader rejection'),getProgramInfoLog:op('getProgramInfoLog',()=> 'link rejection'),
  getUniformLocation:op('getUniformLocation',(_p,name)=>({name})),useProgram:op('useProgram',p=>{current=p;}),
  checkFramebufferStatus:op('checkFramebufferStatus',()=>constant(failure.framebuffer===false?'FRAMEBUFFER_UNSUPPORTED':'FRAMEBUFFER_COMPLETE')),
  drawArrays:op('drawArrays',()=>{draws++;}),
  readPixels:op('readPixels',(_x,_y,w,h,format,_type,output:Uint8Array)=>{output.fill(0);if(format===constant('RGBA_INTEGER'))for(let i=0;i<w*h;i++){output[i*4]=failure.invalidFlags?255:1;output[i*4+1]=failure.repair?1:0;}}),
  getBufferSubData:op('getBufferSubData',(_target,_offset,out:Float32Array)=>{out.fill(0);}),getExtension:op('getExtension',()=>({loseContext:op('loseContext')})),
 };
 for(const kind of ['Program','Shader','Buffer','VertexArray','TransformFeedback','Texture','Framebuffer']){
  methods['create'+kind]=op('create'+kind,()=>{if(failure.nullAt==='create'+kind)return null;const h={kind,id:nextHandle++};live.add(h);return h;});
  methods['delete'+kind]=op('delete'+kind,h=>live.delete(h));methods['is'+kind]=op('is'+kind,h=>live.has(h));
 }
 const gl=new Proxy({}, {get(_target,key){const name=String(key);if(name.toUpperCase()===name)return constant(name);return methods[name]??=op(name);}}) as WebGL2RenderingContext;
 const canvasCalls=vi.fn(()=>gl);vi.stubGlobal('OffscreenCanvas',class{getContext(){return canvasCalls();}});
 return{gl,live,calls,canvasCalls,failure,retained:()=>[...live].map(h=>h.kind)};
}
function model(native=false,formula='z'){
 const s=createScene(definition('domain'));s.equations={f:formula};s.parameters={};s.timeline.tracks=[];s.settings.iterationEnabled=false;
 if(native)Object.assign(s.settings,{domainIterationVersion:'mathart-1.7.8-gpu',domainViewportVersion:'mathart-1.7.8-gpu',domainColorVersion:'mathart-1.7.8-gpu'});
 return parseDomainModel(s,0);
}
function caught(fn:()=>unknown):unknown{try{fn();}catch(e){return e;}throw Error('Expected failure');}
const render=(gpu:DomainGpu,m=model(),callback=(_index:number)=>1,cancel?:()=>boolean)=>gpu.render(m,2,2,new Uint8ClampedArray(16),callback,cancel);
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

describe('Domain GPU failures preserve their producing boundary',()=>{
 it('carries immutable stage/reason and original cause',()=>{
  const cause=new Error('driver'),error=new DomainGpuError('compile','compile failed',{cause});
  expect(error).toMatchObject({name:'DomainGpuError',message:'compile failed',cause,failure:{stage:'compile',reason:'compile failed'}});expect(Object.isFrozen(error.failure)).toBe(true);
  expect(caught(()=>domainGpuOperation('render','draw',()=>{throw error;}))).toBe(error);
 });
 it.each(['missing','null','throw'] as const)('classifies %s context availability without manufacturing output',mode=>{
  if(mode==='missing')vi.stubGlobal('OffscreenCanvas',undefined);
  else vi.stubGlobal('OffscreenCanvas',class{getContext(){if(mode==='throw')throw Error('context unavailable');return null;}});
  const gpu=new DomainGpu(),error=caught(()=>render(gpu));expect(error).toBeInstanceOf(DomainGpuError);expect((error as DomainGpuError).failure.stage).toBe('context');expect(gpu.diagnostics()).toMatchObject({programs:0,context:false,lastRaster:undefined});gpu.dispose();
 });
 it.each<[string,Failure,DomainGpuFailureStage]>([
  ['uniform/texture capability',{textureLimit:1},'capability'],['compile status',{compile:false},'compile'],['link status',{link:false},'link'],
  ['program allocation',{nullAt:'createProgram'},'allocation'],['shader allocation',{nullAt:'createShader'},'allocation'],['texture allocation',{nullAt:'createTexture'},'allocation'],['framebuffer allocation',{nullAt:'createFramebuffer'},'allocation'],
  ['incomplete framebuffer',{framebuffer:false},'render'],['draw throw',{throwAt:'drawArrays'},'render'],['read throw',{throwAt:'readPixels'},'readback'],['GL readback status',{glError:true},'readback'],['context lost after draw',{lostAfterDraw:true},'context'],['invalid GPU-produced flags',{invalidFlags:true},'render'],
 ])('classifies %s, releases pass handles and can recover',(_name,failure,stage)=>{
  const d=device(failure),gpu=new DomainGpu(),error=caught(()=>render(gpu));expect(error).toBeInstanceOf(DomainGpuError);expect((error as DomainGpuError).failure.stage).toBe(stage);
  expect(d.retained().every(kind=>kind==='Program')).toBe(true);gpu.dispose();expect(d.live.size).toBe(0);
  for(const key of Object.keys(failure))delete failure[key as keyof Failure];expect(render(gpu)).toMatchObject({generated:4,invalid:0});gpu.dispose();expect(d.live.size).toBe(0);
 });
 it('does not classify request shape, local capacity, or shader emitter errors',()=>{
  const d=device(),gpu=new DomainGpu(),m=model();
  for(const fn of [()=>gpu.render(m,16385,1,new Uint8ClampedArray(),()=>1),()=>gpu.render(m,1,1,new Uint8ClampedArray(),()=>1),()=>gpu.sample(m,new Float32Array(8193*2))])expect(caught(fn)).not.toBeInstanceOf(DomainGpuError);
  expect(d.canvasCalls).not.toHaveBeenCalled();
  const error=new NativeExpressionCapacityError('native AST capacity'),original=domainExpressions.get(m);
  vi.spyOn(domainExpressions,'get').mockReturnValue({...original,gpuSource(){throw error;}});
  expect(caught(()=>render(gpu,m))).toBe(error);expect(d.canvasCalls).not.toHaveBeenCalled();gpu.dispose();
 });
 it('does not relabel an unexpected emitter exception as source-program failure',()=>{
  const d=device(),gpu=new DomainGpu(),m=model(),original=domainExpressions.get(m),error=new Error('emitter invariant');
  vi.spyOn(domainExpressions,'get').mockReturnValue({...original,gpuSource(){throw error;}});
  expect(caught(()=>render(gpu,m))).toBe(error);expect(d.canvasCalls).not.toHaveBeenCalled();gpu.dispose();
 });
 it.each(['plain','capacity','abort'] as const)('leaves %s CPU repair callback failure unchanged even after native captures',kind=>{
  const d=device({repair:true}),gpu=new DomainGpu(),error=kind==='capacity'?new NativeExpressionCapacityError('CPU capacity'):kind==='abort'?new DOMException('cancelled','AbortError'):new Error('CPU color invariant');
  expect(caught(()=>render(gpu,model(true),()=>{throw error;}))).toBe(error);expect(error).not.toBeInstanceOf(DomainGpuError);
  expect(d.calls.filter(c=>c==='drawArrays').length).toBe(3);expect(d.retained()).toEqual(['Program']);gpu.dispose();expect(d.live.size).toBe(0);
 });
 it('propagates cancellation before context creation and after a submitted draw',()=>{
  const d=device(),gpu=new DomainGpu();expect(caught(()=>render(gpu,model(),()=>1,()=>true))).toMatchObject({name:'AbortError'});expect(d.canvasCalls).not.toHaveBeenCalled();
  const error=caught(()=>render(gpu,model(),()=>1,()=>d.calls.includes('drawArrays')));expect(error).toMatchObject({name:'AbortError'});expect(error).not.toBeInstanceOf(DomainGpuError);expect(d.retained()).toEqual(['Program']);gpu.dispose();
  const abort=new DOMException('cancelled','AbortError');expect(caught(()=>domainGpuOperation('render','draw',()=>{throw abort;}))).toBe(abort);
 });
 it('clears last raster facts before a failed or cancelled next attempt',()=>{
  device();const gpu=new DomainGpu();render(gpu);expect(gpu.diagnostics().lastRaster?.generated).toBe(4);
  expect(caught(()=>gpu.render(model(),0,1,new Uint8ClampedArray(),()=>1))).not.toBeInstanceOf(DomainGpuError);expect(gpu.diagnostics().lastRaster).toBeUndefined();
  render(gpu);expect(caught(()=>render(gpu,model(),()=>1,()=>true))).toMatchObject({name:'AbortError'});expect(gpu.diagnostics().lastRaster).toBeUndefined();gpu.dispose();
 });
 it.each<[string,DomainGpuFailureStage]>([['drawArrays','render'],['getBufferSubData','readback']])('classifies TF %s while deleting temporary buffers', (throwAt,stage)=>{
  const d=device({throwAt}),gpu=new DomainGpu(),error=caught(()=>gpu.sample(model(true),new Float32Array([.1,.2])));
  expect(error).toBeInstanceOf(DomainGpuError);expect((error as DomainGpuError).failure.stage).toBe(stage);expect(d.retained()).toEqual(['Program']);gpu.dispose();expect(d.live.size).toBe(0);
 });
 it('retains only the bounded program cache across successful requests and releases it on dispose',()=>{
  const d=device(),gpu=new DomainGpu();for(let i=0;i<10;i++)render(gpu,model(false,'z+'+i));expect(gpu.diagnostics().programs).toBe(8);expect(d.retained()).toEqual(Array(8).fill('Program'));gpu.dispose();gpu.dispose();expect(d.live.size).toBe(0);
 });
 it.each(['useProgram','deleteProgram','loseContext'])('keeps owner references if dispose fails at %s, permitting explicit retry',throwAt=>{
  const d=device(),gpu=new DomainGpu();render(gpu);const error=new Error('cleanup '+throwAt);Object.assign(d.failure,{throwAt,error});
  expect(caught(()=>gpu.dispose())).toBe(error);expect(gpu.diagnostics()).toMatchObject({context:true,programs:0,pendingCleanup:1});
  if(throwAt!=='loseContext')expect(d.retained()).toEqual(['Program']);
  delete d.failure.throwAt;gpu.dispose();expect(d.live.size).toBe(0);expect(gpu.diagnostics()).toMatchObject({context:false,programs:0,lastRaster:undefined});
 });
 it.each(['deleteShader','detachShader','deleteProgram'])('retains failed build cleanup at %s without publishing a reusable program',throwAt=>{
  const d=device({compile:throwAt==='detachShader'?true:false,throwAt}),gpu=new DomainGpu();
  const error=caught(()=>render(gpu));expect(error).not.toBeInstanceOf(DomainGpuError);expect(gpu.diagnostics()).toMatchObject({programs:0,pendingCleanup:1,context:true});
  expect(d.live.size).toBeGreaterThan(0);const creates=d.calls.filter(c=>c==='createProgram').length;
  expect(caught(()=>render(gpu))).not.toBeInstanceOf(DomainGpuError);expect(d.calls.filter(c=>c==='createProgram')).toHaveLength(creates);
  delete d.failure.throwAt;delete d.failure.compile;gpu.dispose();expect(d.live.size).toBe(0);expect(gpu.diagnostics().pendingCleanup).toBe(0);
  render(gpu);expect(d.calls.filter(c=>c==='createProgram')).toHaveLength(creates+1);gpu.dispose();
 });
 it('retires the evicted and failed new program without retaining reusable invalid entries',()=>{
  const d=device(),gpu=new DomainGpu();for(let i=0;i<8;i++)render(gpu,model(false,'z+'+i));Object.assign(d.failure,{throwAt:'deleteProgram'});
  expect(caught(()=>render(gpu,model(false,'z+8')))).not.toBeInstanceOf(DomainGpuError);expect(gpu.diagnostics()).toMatchObject({programs:7,pendingCleanup:2});expect(d.retained()).toEqual(Array(9).fill('Program'));
  delete d.failure.throwAt;gpu.dispose();expect(d.live.size).toBe(0);expect(gpu.diagnostics().pendingCleanup).toBe(0);
 });
 it.each(['deleteTexture','deleteFramebuffer','deleteVertexArray'])('retains raster resources when %s fails and blocks reuse until retry',throwAt=>{
  const d=device({throwAt}),gpu=new DomainGpu();expect(caught(()=>render(gpu))).not.toBeInstanceOf(DomainGpuError);expect(gpu.diagnostics().pendingCleanup).toBe(1);expect(gpu.diagnostics().lastRaster).toBeUndefined();
  const draws=d.calls.filter(c=>c==='drawArrays').length;expect(caught(()=>render(gpu))).not.toBeInstanceOf(DomainGpuError);expect(d.calls.filter(c=>c==='drawArrays')).toHaveLength(draws);
  delete d.failure.throwAt;gpu.dispose();expect(d.live.size).toBe(0);expect(gpu.diagnostics().pendingCleanup).toBe(0);
 });
 it.each(['deleteBuffer','deleteTransformFeedback'])('retains TF resources after %s failure for dispose retry',throwAt=>{
  const d=device({throwAt}),gpu=new DomainGpu();expect(caught(()=>gpu.sample(model(true),new Float32Array([.1,.2])))).not.toBeInstanceOf(DomainGpuError);expect(gpu.diagnostics().pendingCleanup).toBe(1);
  delete d.failure.throwAt;gpu.dispose();expect(d.live.size).toBe(0);expect(gpu.diagnostics().pendingCleanup).toBe(0);
 });

 it('retains raster ownership when state unwinding fails before object deletion',()=>{
  const d=device({repair:true}),gpu=new DomainGpu();const error=new Error('unbind failed');
  expect(caught(()=>render(gpu,model(),()=>{Object.assign(d.failure,{throwAt:'bindFramebuffer',error});return 1;}))).toBe(error);
  expect(gpu.diagnostics()).toMatchObject({pendingCleanup:1,lastRaster:undefined});expect(d.retained()).toContain('Texture');
  delete d.failure.throwAt;gpu.dispose();expect(d.live.size).toBe(0);
 });
 it('retains TF ownership when ending an active pass fails',()=>{
  const d=device({throwAt:'endTransformFeedback'}),gpu=new DomainGpu();expect(caught(()=>gpu.sample(model(true),new Float32Array([.1,.2])))).not.toBeInstanceOf(DomainGpuError);expect(gpu.diagnostics().pendingCleanup).toBe(1);
  delete d.failure.throwAt;gpu.dispose();expect(d.live.size).toBe(0);
 });
 it('does not reuse cache programs after a failed disposal when the next request retries cleanup',()=>{
  const d=device(),gpu=new DomainGpu();render(gpu);Object.assign(d.failure,{throwAt:'deleteProgram'});caught(()=>gpu.dispose());delete d.failure.throwAt;
  render(gpu);expect(d.calls.filter(c=>c==='createProgram')).toHaveLength(2);expect(d.canvasCalls).toHaveBeenCalledTimes(2);gpu.dispose();expect(d.live.size).toBe(0);
 });

});
