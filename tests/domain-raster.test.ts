import {afterEach,describe,expect,it,vi} from 'vitest';
import {createScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {DomainGpu,domainGpu,domainGpuSource} from '../src/engine/domainGpu';
import {parseDomainModel as parseAnyDomainModel} from '../src/engine/domainModel';
import {generateDomain} from '../src/engine/domain';
import {prepareDomainRaster,DOMAIN_TILE_WIDTH,DOMAIN_TILE_HEIGHT,MAX_DOMAIN_RASTER_SCRATCH_BYTES} from '../src/engine/domainGpuRaster';
const scene=()=>{const s=createScene(definition('domain'));s.equations={f:'z'};s.settings.domainBackend='cpu';return s;};
const parseDomainModel=(...args:Parameters<typeof parseAnyDomainModel>)=>{const m=parseAnyDomainModel(...args);if(m.colorVersion!=='local-v1')throw Error('expected local-v1 fixture');return m;};
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
describe('Domain complete raster producer',()=>{
 it('keeps compiled structure identity across viewport, palette and numeric uniform edits',()=>{const s=scene(),a=parseDomainModel(s,0);s.palette.mode='curve';s.settings.scale=2;s.parameters.a=3;const b=parseDomainModel(s,7);expect(domainGpuSource(a).fragmentLibrary).toBe(domainGpuSource(b).fragmentLibrary);expect(domainGpuSource(a).fragmentLibrary).toContain('vec2 domainEvaluate(vec2 pixel)');});
 it('accounts two MRT attachments/readbacks and exact piecewise color payload, without SS scratch expansion',()=>{const s=scene(),one=prepareDomainRaster(parseDomainModel(s,0),3840,2160);s.settings.supersampling=3;const nine=prepareDomainRaster(parseDomainModel(s,0),3840,2160);expect(one.estimatedScratchBytes).toBe(DOMAIN_TILE_WIDTH*DOMAIN_TILE_HEIGHT*16+one.color.textureBytes*2);expect(nine.estimatedScratchBytes).toBe(one.estimatedScratchBytes);expect(one.estimatedScratchBytes).toBeLessThan(MAX_DOMAIN_RASTER_SCRATCH_BYTES);});
 it('rejects invalid output/raster/precision facts before creating a context',()=>{const ctor=vi.fn();vi.stubGlobal('OffscreenCanvas',class{constructor(){ctor();}});const gpu=new DomainGpu(),m=parseDomainModel(scene(),0);for(const [w,h]of[[0,1],[1.5,1],[16384,16384]])expect(()=>gpu.render(m,w,h,new Uint8ClampedArray(),()=>0)).toThrow();expect(()=>gpu.render(m,1,1,new Uint8ClampedArray(3),()=>0)).toThrow();m.paletteFacts.offset=1e20;expect(()=>gpu.render(m,1,1,new Uint8ClampedArray(4),()=>0)).toThrow('双精度');expect(ctor).not.toHaveBeenCalled();});
 it('repairs the entire requested SS pixel and preserves valid/invalid averaging',()=>{const s=scene();s.equations.f='1/z';Object.assign(s.settings,{supersampling:3,centerX:0,centerY:0,curveMode:'NONE'});const cpu=generateDomain(s,{time:0,width:3,height:3,quality:'export'});s.settings.domainBackend='gpu';vi.spyOn(domainGpu,'render').mockImplementation((model,w,h,pixels,repair)=>{let generated=0,invalid=0,invalidSamples=0;for(let i=0;i<w*h;i++){const v=repair(i);v?generated++:invalid++;invalidSamples+=model.supersampling**2-v;}return{samples:w*h*9,generated,invalid,invalidSamples,repaired:w*h*9,tiles:1,readbackBytes:w*h*8,estimatedScratchBytes:1};});const repaired=generateDomain(s,{time:0,width:3,height:3,quality:'export'});expect(repaired).toMatchObject({type:'raster',backend:'cpu',stats:{samples:81}});expect(repaired.type==='raster'&&repaired.pixels).toEqual(cpu.type==='raster'&&cpu.pixels);expect(repaired.stats.invalid).toBe(cpu.stats.invalid);});
 it('reuses one export allocation after a GPU failure rather than retaining a second full image',()=>{const s=scene();s.settings.domainBackend='gpu';const original=Uint8ClampedArray,allocations:number[]=[];vi.stubGlobal('Uint8ClampedArray',class extends original{constructor(size:number){super(size);allocations.push(size);}});vi.spyOn(domainGpu,'render').mockImplementation(()=>{throw Error('test GPU readback failure');});const result=generateDomain(s,{time:0,width:17,height:11,quality:'export'});expect(result.backend).toBe('cpu');expect(allocations).toEqual([17*11*4]);expect(result.warnings?.join()).toContain('test GPU readback failure');});
});

/** Failure injection tests ownership only. Actual GL/precision evidence is in
 * verify-domain-fullchain*.mjs; this mock is never used for numerical claims. */
function fixture(failure:string){
 const live=new Map<object,string>(),constants=new Map<string,number>();let lost=0,textures=0;
 const token=(name:string)=>{if(!constants.has(name))constants.set(name,constants.size+1);return constants.get(name)!;};
 const gl=new Proxy({} as WebGL2RenderingContext,{get(_target,key:string){
  if(/^[A-Z_0-9]+$/.test(key))return token(key);
  if(key==='getParameter')return()=>4096;
  if(key==='getShaderParameter')return()=>failure!=='compile';if(key==='getProgramParameter')return()=>failure!=='link';
  if(key==='getShaderInfoLog'||key==='getProgramInfoLog')return()=>failure;
  if(key==='getUniformLocation')return()=>null;
  if(key==='getExtension')return()=>({loseContext(){lost++;}});
  if(key==='isContextLost')return()=>failure==='loss';
  if(key==='getError')return()=>token('NO_ERROR');
  if(key==='checkFramebufferStatus')return()=>token(failure==='framebuffer'?'FRAMEBUFFER_UNSUPPORTED':'FRAMEBUFFER_COMPLETE');
  if(key==='drawArrays')return()=>{if(failure==='draw')throw Error(failure);};
  if(key==='readPixels')return()=>{if(failure==='read')throw Error(failure);};
  if(key.startsWith('create'))return()=>{if(key==='createTexture'&&++textures===2&&failure==='allocation')return null;const value={};live.set(value,key.slice(6));return value;};
  if(key.startsWith('delete'))return(value:object|null)=>{if(value)live.delete(value);};
  return()=>{};
 }});vi.stubGlobal('OffscreenCanvas',class{getContext(){return gl;}});return{live,get lost(){return lost;}};
}
describe('Domain raster GL ownership',()=>{
 for(const error of['compile','link','allocation','framebuffer','draw','read','loss'])it(`cleans partial ${error} resources before its context owner is disposed`,()=>{const f=fixture(error),g=new DomainGpu();expect(()=>g.render(parseDomainModel(scene(),0),3,2,new Uint8ClampedArray(24),()=>0)).toThrow();expect([...f.live.values()].every(v=>v==='Program')).toBe(true);g.dispose();expect(f.live.size).toBe(0);expect(f.lost).toBe(1);});
 it('cleans cancellation after a draw without turning it into CPU fallback',()=>{const f=fixture(''),g=new DomainGpu();let calls=0;expect(()=>g.render(parseDomainModel(scene(),0),3,2,new Uint8ClampedArray(24),()=>0,()=>++calls===4)).toThrow('取消');expect([...f.live.values()]).toEqual(['Program']);g.dispose();expect(f.live.size).toBe(0);});
});

describe('Domain CPU texture presentation ownership',()=>{
 for(const error of ['compile','link','allocation','framebuffer','draw','read','loss'])it(`releases partial ${error} presentation resources`,()=>{const f=fixture(error),g=new DomainGpu();expect(()=>g.presentRgb(new Uint8ClampedArray(16),2,2,new Uint8ClampedArray(64),4,4)).toThrow();expect([...f.live.values()].every(v=>v==='Program')).toBe(true);g.dispose();expect(f.live.size).toBe(0);expect(f.lost).toBe(1);});
 it('cancels after presentation draw and releases all transient resources',()=>{const f=fixture(''),g=new DomainGpu();let calls=0;expect(()=>g.presentRgb(new Uint8ClampedArray(16),2,2,new Uint8ClampedArray(64),4,4,()=>++calls===2)).toThrow('取消');expect([...f.live.values()]).toEqual(['Program']);g.dispose();expect(f.live.size).toBe(0);});
});
