import {sourceIteratedPreviewPixelDensity} from '../src/engine/sourceIteratedPresentation';
import {sourceIteratedNativeKind} from '../src/engine/sourceIteratedNativeEligibility';
import {describe,expect,it,vi} from 'vitest';
import {IteratedDensitySession,type IteratedFrameJob} from '../src/scenes/iteratedDensity';
import {parseProjectFile} from '../src/engine/legacyImport';
import {ordinarySourceViewport} from '../src/engine/ordinarySourceCamera';
import {estimateSourceIteratedNativeWork,prepareSourceIteratedNativeFrame} from '../src/engine/sourceIteratedNativeFrame';
import {SOURCE_SYMMETRY_CUSTOM_DIALECT} from '../src/engine/sourceSymmetryCustom';
import type {IteratedDensitySourceAsyncBackend} from '../src/engine/iteratedDensityAsyncBackend';
import type {GenerateContext,SceneDocument} from '../src/types';

const raw=`#define SHIFT .125
uniform mat4 transform;
uniform vec2 resolution;
uniform float gain;
void calculate_next(in vec3 p,out vec3 q,out float m){q=p+vec3(gain,transform[0][0],0.);m=SHIFT+resolution.x;}`;
function scene(){return parseProjectFile(JSON.stringify({config_version:'1.0.0',name:'Cold native custom',type:'SYMMETRY_CHAOS',equation:{glsl:raw},parameters:{gain:.125},settings:{batch_size:7,burn_in_steps:2,iterations_per_frame:3,background_color:'#000000'},palette:['#ff0000','#ff0000'],timeline:[{type:'wait',duration:1}]})).scene;}
function context(s:SceneDocument):GenerateContext{return{time:.07,width:34,height:26,quality:'export',sourceViewport:ordinarySourceViewport(s,34,26,'offscreen',13),sourceSymmetryToneReference:{width:17,height:13},sourcePointPixelDensity:1};}
function facts(job:IteratedFrameJob){return{bounds:{minX:-1,maxX:1,minY:-1,maxY:1},steps:job.config.count*(job.iterationFrame!.warmupSteps+job.iterationFrame!.iterationSteps),accepted:job.config.record?job.config.count:0,invalid:0,invalidUnit:'completed-pass' as const,clipped:0,sampleInvalid:0};}
function backend(){let width=0,height=0;return{
 kind:'source-iterated' as const,
 estimateWork:vi.fn<IteratedDensitySourceAsyncBackend['estimateWork']>(estimateSourceIteratedNativeWork),
 step:vi.fn<IteratedDensitySourceAsyncBackend['step']>(async(job,options)=>{prepareSourceIteratedNativeFrame(job,options.resetParticles);width=options.width;height=options.height;return facts(job);}),
 present:vi.fn<IteratedDensitySourceAsyncBackend['present']>(async()=>({pixels:new Uint8ClampedArray(width*height*4),occupiedPixels:0,maxCount:0,toneBackend:'native',warnings:[]})),
 reset:vi.fn(async()=>{}),cancel:vi.fn(),
};}
const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>resolve=r);return{promise,resolve};}

describe('native custom cold owner: real frame/context producers with mocked renderer ACKs, no GPU claim',()=>{
 it('uses original GL41 for every ordered field and primary update facts before offscreen rendering',async()=>{
  const s=scene(),c=context(s),b=backend(),owner=new IteratedDensitySession({asyncBackend:b});
  try{
   expect(sourceIteratedNativeKind(s)).toBe('symmetry');const out=await owner.generateAsync(s,c);expect(b.step).toHaveBeenCalledTimes(3);expect(out.stats.invalidUnit).toBe('completed-pass');
   for(const [job]of b.step.mock.calls){
    expect(job.field.kind).toBe('symmetry-custom');for(const field of [job.field,...job.iterationUpdates!]){if(field.kind!=='symmetry-custom')throw Error('wrong field');expect(field.plan.dialect).toBe(SOURCE_SYMMETRY_CUSTOM_DIALECT);expect(field.plan.expandedSource).toContain('#define SHIFT .125');}
    expect(job.iterationUpdates).toHaveLength(2);expect(job.processingContext!.viewport).toEqual([0,0,17,13]);expect(job.processingContext!.modelview).toEqual(identity);
   }
   const snapshots=b.step.mock.calls.map(([job])=>job.processingContext!);expect(snapshots[0].projection).not.toEqual(snapshots[1].projection);expect(snapshots[1]).toEqual(snapshots[2]);
   expect(owner.diagnostics().processing).toMatchObject({drawing:false,rendering:false,current:'none',shaderOwner:'primary',retainedGraphics:2});
  }finally{await owner.resetAsync();}expect(owner.diagnostics().processing).toBeUndefined();
 });
 it('retains primary camera state between real frames without inventing an offscreen target',async()=>{
  const s=scene(),b=backend(),owner=new IteratedDensitySession({asyncBackend:b}),c:GenerateContext={time:0,width:17,height:13,quality:'preview',sourceViewport:ordinarySourceViewport(s,17,13,'primary',13)};
  try{
   await owner.generateAsync(s,c);expect(b.step.mock.calls[0][0].processingContext!.modelview).toEqual(identity);
   await owner.generateAsync(s,{...c,time:.04});expect(b.step).toHaveBeenCalledTimes(2);expect(b.step.mock.calls[1][0].processingContext!.modelview).not.toEqual(identity);
   expect(owner.diagnostics().processing).toMatchObject({current:'none',shaderOwner:'primary',retainedGraphics:1});
  }finally{await owner.resetAsync();}
 });
 it('does not initialize graphics before a delayed cold start or suppress updates when recording is disabled',async()=>{
  const s=scene(),b=backend(),owner=new IteratedDensitySession({asyncBackend:b});s.settings.iteratedStartTime=1;s.settings.recordTrails=false;
  try{
   const blank=await owner.generateAsync(s,context(s));expect(blank.stats.samples).toBe(0);expect(b.step).not.toHaveBeenCalled();expect(owner.diagnostics().processing).toBeUndefined();
   await owner.generateAsync(s,{...context(s),time:1});expect(b.step).toHaveBeenCalledOnce();expect(b.step.mock.calls[0][0].config.record).toBe(false);expect(b.step.mock.calls[0][0].processingContext!.modelview).toEqual(identity);
  }finally{await owner.resetAsync();}
 });
 it('publishes measured primary density for delayed blank and record-disabled cold previews',async()=>{
  const s=scene(),b=backend(),owner=new IteratedDensitySession({asyncBackend:b});s.settings.iteratedStartTime=1;s.settings.recordTrails=false;
  const c={...context(s),sourceViewport:ordinarySourceViewport(s,17,13,'primary',13),sourcePointPixelDensity:2,sourceSymmetryToneReference:{width:34,height:26}};
  try{expect(sourceIteratedPreviewPixelDensity(await owner.generateAsync(s,c))).toBe(2);expect(sourceIteratedPreviewPixelDensity(await owner.generateAsync(s,{...c,time:1}))).toBe(2);}finally{await owner.resetAsync();}
 });
 it('keeps cache hits frame-free and reproduces the same contexts after backward seek and explicit reset',async()=>{
  const s=scene(),c=context(s),b=backend(),owner=new IteratedDensitySession({asyncBackend:b});
  try{
   await owner.generateAsync(s,c);const original=b.step.mock.calls.map(([j])=>j.processingContext),held=owner.diagnostics().processing;
   await owner.generateAsync(s,{...c,time:.075});expect(b.step).toHaveBeenCalledTimes(3);expect(owner.diagnostics().processing).toEqual(held);
   await owner.generateAsync(s,{...c,time:0});expect(b.step.mock.calls.at(-1)![0].processingContext).toEqual(original[0]);
   await owner.generateAsync(s,c);expect(b.step.mock.calls.slice(-3).map(([j])=>j.processingContext)).toEqual(original);
   await owner.resetAsync();await owner.generateAsync(s,c);expect(b.step.mock.calls.slice(-3).map(([j])=>j.processingContext)).toEqual(original);
   const calls=b.step.mock.calls.length;await owner.generateAsync({...s,id:s.id+'-replacement'},c);expect(b.step).toHaveBeenCalledTimes(calls+3);expect(b.step.mock.calls.slice(-3).map(([j])=>j.processingContext)).toEqual(original);
  }finally{await owner.resetAsync();}
 });
 it('invalidates custom math when primary dimensions change independently of the offscreen target',async()=>{
  const s=scene(),c={...context(s),time:0},b=backend(),owner=new IteratedDensitySession({asyncBackend:b});
  try{
   await owner.generateAsync(s,c);await owner.generateAsync(s,{...c,sourceSymmetryToneReference:{width:19,height:13}});
   expect(b.step).toHaveBeenCalledTimes(2);expect(b.step.mock.calls[1][1].resetParticles).toBe(true);expect(b.step.mock.calls[1][0].processingContext!.viewport).toEqual([0,0,19,13]);
   expect(b.step.mock.calls[1][0].processingContext!.modelview).toEqual(identity);
  }finally{await owner.resetAsync();}
 });
 it('rejects missing offscreen primary facts before any custom step and excludes legacy custom',async()=>{
  const s=scene(),b=backend(),owner=new IteratedDensitySession({asyncBackend:b});
  try{
   await expect(owner.generateAsync(s,{...context(s),sourceSymmetryToneReference:undefined})).rejects.toThrow('主画布');expect(b.step).not.toHaveBeenCalled();expect(owner.diagnostics().processing).toBeUndefined();
   const legacy={...s,symmetrySource:undefined};expect(sourceIteratedNativeKind(legacy)).toBeUndefined();await expect(owner.generateAsync(legacy,context(s))).rejects.toThrow('完整源');expect(b.step).not.toHaveBeenCalled();
  }finally{await owner.resetAsync();}
 });
 it('keeps failed renderer and graphics ownership together until exact cleanup succeeds',async()=>{
  const s=scene(),c=context(s),b=backend(),owner=new IteratedDensitySession({asyncBackend:b});
  await owner.generateAsync(s,{...c,time:0});b.step.mockRejectedValueOnce(Error('unknown native commit'));b.reset.mockRejectedValueOnce(Error('release unavailable'));
  await expect(owner.generateAsync(s,c)).rejects.toThrow('清理未完成');expect(owner.diagnostics()).toMatchObject({frame:0,cleanupPending:true,processing:{rendering:true,retainedGraphics:2}});
  await expect(owner.generateAsync(s,c)).rejects.toThrow('等待清理');await owner.resetAsync();expect(owner.diagnostics().processing).toBeUndefined();expect(b.cancel).not.toHaveBeenCalled();
 });
 it('soft cancellation waits for a custom step ACK and releases without another frame or shared abort',async()=>{
  const s=scene(),b=backend(),gate=deferred<ReturnType<typeof facts>>(),owner=new IteratedDensitySession({asyncBackend:b});b.step.mockImplementationOnce(()=>gate.promise);
  const drawing=owner.generateAsync(s,context(s)),rejected=expect(drawing).rejects.toMatchObject({name:'AbortError'});await vi.waitFor(()=>expect(b.step).toHaveBeenCalledOnce());
  const cleanup=owner.resetAsync();expect(owner.diagnostics().processing).toMatchObject({rendering:true});gate.resolve(facts(b.step.mock.calls[0][0]));await rejected;await cleanup;
  expect(b.step).toHaveBeenCalledOnce();expect(b.present).not.toHaveBeenCalled();expect(b.cancel).not.toHaveBeenCalled();expect(owner.diagnostics().processing).toBeUndefined();
 });
});
