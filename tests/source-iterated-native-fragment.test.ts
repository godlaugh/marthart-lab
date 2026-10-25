import {beforeAll,describe,expect,it,vi} from 'vitest';
import {spawnSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {parseProjectFile} from '../src/engine/legacyImport';
import {prepareIteratedFrame} from '../src/scenes/iteratedDensity';
import {prepareSourceIteratedNativeFrame} from '../src/engine/sourceIteratedNativeFrame';
import {SourceIteratedNativeBackend} from '../src/engine/sourceIteratedNativeBackend';
import {SourceProcessingContext} from '../src/engine/sourceProcessingContext';
import {prepareSourceSymmetryTone} from '../src/engine/sourceSymmetryPresentation';
import * as transport from '../src/engine/sourceNativeClient';
// @ts-expect-error Actual Node HTTP service lives outside browser contracts.
import {createExportServer} from '../server/index.mjs';

const native=process.platform==='darwin'&&process.arch==='arm64';
const value=<T>(r:{ok:true;value:T}|{ok:false;error:Error}):T=>{if(!r.ok)throw r.error;return r.value;};
const scene=(raw=`#define SHIFT .125
uniform vec2 resolution;
uniform float gain;
void calculate_next(in vec3 p,out vec3 q,out float m){q=vec3(0.);m=SHIFT+gain+resolution.x/256.;}`)=>parseProjectFile(JSON.stringify({config_version:'1.0.0',name:'Native custom production owner',type:'SYMMETRY_CHAOS',equation:{glsl:raw},parameters:{gain:.125},settings:{batch_size:7,burn_in_steps:0,iterations_per_frame:3,background_color:'#000000'},palette:['#ff0000','#ff0000']})).scene;
function frame(raw?:string){const s=scene(raw),graphics=value(SourceProcessingContext.create(32,24));value(graphics.apply({kind:'begin-draw'}));const job=prepareIteratedFrame(s,0,0,s,{symmetryDialect:'native-gl41'});job.processingContext=value(graphics.snapshot());graphics.dispose();return{s,job};}
const options={width:32,height:24,projection:'xy' as const,padding:0,bounds:{minX:-1,maxX:1,minY:-1,maxY:1},resetParticles:true,clearInk:true};
let executable:{executablePath:string;executableSha256:string};
beforeAll(()=>{
 if(!native)return;mkdirSync('.cache',{recursive:true});const dir=mkdtempSync(resolve('.cache/native-fragment-owner-')),path=join(dir,'renderer');
 const built=spawnSync('/usr/bin/xcrun',['clang','-fobjc-arc','-fblocks','-O2','-Wall','-Wextra','-Werror','-framework','Foundation','-framework','OpenGL','server/render/SourceCglRenderer.m','-o',path],{encoding:'utf8',timeout:30000,maxBuffer:65536});
 expect(built.error).toBeUndefined();expect(built.status,built.stderr).toBe(0);expect(built.stderr).toBe('');executable={executablePath:path,executableSha256:createHash('sha256').update(readFileSync(path)).digest('hex')};
});

describe('production fragment frame boundary',()=>{
 it('prepares native macros and discard without first applying the budgeted ES parser',()=>{
  const s=scene('#define GO discard\nvoid calculate_next(in vec3 p,out vec3 q,out float m){if(p.x<0.){GO;}q=p;m=1.;}');
  expect(()=>prepareIteratedFrame(s,0,0)).toThrow('预处理');
  const job=prepareIteratedFrame(s,0,0,s,{symmetryDialect:'native-gl41'});expect(job.field.kind).toBe('symmetry-custom');
  if(job.field.kind!=='symmetry-custom')throw Error('wrong field');expect(job.field.plan.dialect).toBe('mathart-1.7.8-custom-fragment-gl41-v1');expect(job.field.plan.expandedSource).toContain('#define GO discard');
 });
 it('requires explicit graphics facts and charges square padding plus completed-pass classification',()=>{
  const {job}=frame(),owner=new SourceIteratedNativeBackend();expect(owner.estimateWork(job,true)).toBe(9*4);
  expect(prepareSourceIteratedNativeFrame(job,true)).toMatchObject({stateWidth:3,program:{profile:'source-fragment'},advances:[{kind:'advance-processing-fragment',steps:3,reset:true,resetCounter:true}]});
  expect(()=>prepareSourceIteratedNativeFrame({...job,processingContext:undefined},true)).toThrow('graphics');
  const noSteps={...job,iterationFrame:{model:'symmetry-frame-1.7.8' as const,frameIndex:0,objectUpdates:0,warmupSteps:0,iterationSteps:0,warmupApplied:false}};
  expect(owner.estimateWork(noSteps,true)).toBe(9);expect(owner.estimateWork(noSteps,false)).toBe(0);
 });
});

describe.skipIf(!native)('actual HTTP production custom owner → retained ink → pixels',()=>{
 it('runs, resizes and resets native fragment state while preserving explicit diagnostics and exact cleanup',async()=>{
  const app=await createExportServer({root:mkdtempSync(resolve('.cache/native-fragment-http-')),sourceRendererBackend:executable}),realFetch=globalThis.fetch,owner=new SourceIteratedNativeBackend();
  const compute=vi.spyOn(transport,'exchangeSourceIteratedNative'),render=vi.spyOn(transport,'exchangeSourceIteratedRenderNative');let restore:(()=>void)|undefined;
  try{
   const address=await app.listen(0),base=`http://127.0.0.1:${address.port}`,spy=vi.spyOn(globalThis,'fetch').mockImplementation((input,init)=>realFetch(new URL(String(input),base),init));restore=()=>spy.mockRestore();
   const {s,job}=frame();const first=await owner.step(job,options);expect(first).toMatchObject({steps:21,invalid:0,invalidUnit:'completed-pass',accepted:7,sampleInvalid:0});
   const requests=compute.mock.calls.map(([r])=>r.operation);expect(requests[0]).toMatchObject({kind:'create-fragment',count:7});expect(requests.find(o=>o.kind==='upload')).toMatchObject({profile:'source-fragment'});expect(requests.some(o=>o.kind==='read')).toBe(false);
   const advance=requests.find(o=>o.kind==='advance-processing-fragment');expect(advance).toMatchObject({steps:3,automatic:expect.arrayContaining([{names:['resolution'],type:35664,values:[32,24]}]),parameters:[{name:'gain',value:.125}]});
   const state=requests[0].resource,read=await transport.exchangeSourceIteratedNative({generation:91,sequence:1,operation:{kind:'read',profile:'source-fragment',resource:state,expectedCount:7,expectedIndex:owner.diagnostics().index,offset:0,count:7}});
   expect(read.diagnosticUnit).toBe('completed-pass');expect([...read.positionsAndMetric!].filter((_v,i)=>i%4===1)).toEqual(Array(7).fill(0));expect([...read.positionsAndMetric!].filter((_v,i)=>i%4===3)).toEqual(Array(7).fill(.375));
   const tone=prepareSourceSymmetryTone(s,{width:32,height:24}),shown=await owner.present(tone);expect(shown.toneBackend).toBe('native');expect(shown.pixels.some((v,i)=>i%4!==3&&v>0)).toBe(true);
   const index=owner.diagnostics().index;await owner.resizeAccumulation(40,30);expect(owner.diagnostics()).toMatchObject({index,creations:1,displays:0});
   const noSteps={...job,frame:1,iterationFrame:{model:'symmetry-frame-1.7.8' as const,frameIndex:1,objectUpdates:0,warmupSteps:0,iterationSteps:0,warmupApplied:false}};
   await owner.step(noSteps,{...options,width:40,height:30,resetParticles:false});expect(owner.diagnostics().index).toBe(index);
   expect((await owner.present(tone)).pixels).toHaveLength(40*30*4);
   await owner.step({...job,frame:2},options);const replay=await owner.present(tone);expect(Buffer.from(replay.pixels)).toEqual(Buffer.from(shown.pixels));
   expect(render.mock.calls.every(([r])=>r.operation.profile==='source-fragment')).toBe(true);
   await owner.dispose();expect(owner.diagnostics()).toMatchObject({owned:false,inkOwners:0,retainedBytes:0});expect(compute.mock.calls.at(-1)![0].operation).toMatchObject({kind:'release',profile:'source-fragment'});expect(render.mock.calls.at(-1)![0].operation).toMatchObject({kind:'release',profile:'source-fragment'});
  }finally{await owner.dispose();restore?.();compute.mockRestore();render.mockRestore();await app.close();expect(app.ownedProcessCount).toBe(0);}
 });
});
