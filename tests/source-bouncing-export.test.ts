import {describe,it,expect} from 'vitest';
import {prepareSourceBouncingExport,sourceBouncingExportContext,assertSourceBouncingExportFrame,type SourceBouncingPresentedExport} from '../src/engine/sourceBouncingExport';
import {importSourceBouncingDocument,sourceBouncingCameraInput} from '../src/engine/sourceBouncingDocument';
import {planSourceBouncingFixedReplay,type SourceBouncingCheckpoint} from '../src/engine/sourceBouncingReplay';
import {prepareSourceCamera} from '../src/engine/sourceCamera';
import {createScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import type {SceneDocument,SceneOutput} from '../src/types';
function unwrap<T>(r:{ok:true;value:T}|{ok:false;error:unknown}):T{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;}
function fixture(updates=17){
 const payload=unwrap(importSourceBouncingDocument({settings:{particle_count:1,record_duration:1}})).payload;
 const scene:SceneDocument={...createScene(definition('bouncing')),settings:{},equations:{},parameters:{},bouncingSource:payload,timeline:{duration:90,fps:30,loop:true,tracks:[]}};
 const viewport={logicalWidth:640,logicalHeight:360,referenceLogicalHeight:360,target:'primary' as const,projectionPass:'perspective' as const};
 const camera=unwrap(prepareSourceCamera(sourceBouncingCameraInput(payload),viewport));if(camera.kind!=='known')throw Error('camera');
 const checkpoint=unwrap(planSourceBouncingFixedReplay({updates,fps:30})).checkpoint;
 const presented:SourceBouncingPresentedExport={ready:true,frame:{checkpoint,camera:camera.plan.camera.value,viewport}};
 return{scene,presented};
}
const options={kind:'video' as const,start:'current' as const,width:320,height:180,fps:30};

describe('source Bouncing export contract',()=>{
 it('keeps the displayed PNG physical index and clock while changing only the output viewport',()=>{
  const {scene,presented}=fixture(),plan=unwrap(prepareSourceBouncingExport(scene,presented,{...options,kind:'image'}));
  expect(plan.warmup).toBeUndefined();expect(plan.frames).toEqual([presented.frame.checkpoint]);
  expect(plan.viewport).toEqual({logicalWidth:320,logicalHeight:180,referenceLogicalHeight:360,target:'offscreen',projectionPass:'perspective'});
  const request=sourceBouncingExportContext(plan,plan.frames[0]);
  expect(request).toMatchObject({time:presented.frame.checkpoint.sceneTime,sourceBouncingFrame:{simulationUpdates:17},quality:'export',width:320,height:180});
  expect(request.sourceViewport).not.toBe(plan.viewport);expect(plan.viewport.logicalWidth).toBe(320);
  expect(plan.camera).not.toBe(presented.frame.camera);expect(plan.camera.phi).toBe(0);
 });
 it('starts video from current N, warms up N+1, then encodes N+2 through the Float32 stopping frame',()=>{
  const {scene,presented}=fixture(),plan=unwrap(prepareSourceBouncingExport(scene,presented,options));
  expect(plan.warmup).toMatchObject({simulationUpdates:18,sceneTime:Math.fround(1/30)});
  expect(plan.frames[0]).toMatchObject({simulationUpdates:19,sceneTime:Math.fround(2/30)});
  expect(plan.frames).toHaveLength(29);expect(plan.frames.at(-1)).toMatchObject({simulationUpdates:47,sceneTime:1.0000003576278687});
  expect(plan.frames.some(f=>f.simulationUpdates===plan.warmup!.simulationUpdates)).toBe(false);
  // The scene's unrelated duration90/loop:true never selects an encoded frame.
  expect(plan.frames.length).not.toBe(scene.timeline.duration*options.fps);
 });
 it('explicit seed start ignores the current physical index but preserves camera and reference height',()=>{
  const {scene,presented}=fixture(300),plan=unwrap(prepareSourceBouncingExport(scene,presented,{...options,start:'seed'}));
  expect(plan.warmup?.simulationUpdates).toBe(1);expect(plan.frames[0].simulationUpdates).toBe(2);expect(plan.frames.at(-1)?.simulationUpdates).toBe(30);
  expect(plan.viewport.referenceLogicalHeight).toBe(360);expect(plan.camera).toEqual(presented.frame.camera);
 });
 it('encodes one frame even when the real warmup crossed the source duration',()=>{
  const {scene,presented}=fixture();scene.bouncingSource!.recordDuration=Math.fround(.1);
  const plan=unwrap(prepareSourceBouncingExport(scene,presented,{...options,fps:1}));
  expect(plan.warmup?.sceneTime).toBe(1);expect(plan.frames).toHaveLength(1);expect(plan.frames[0].sceneTime).toBe(2);
 });
 it('rejects unready or mismatched presented camera facts and malformed paired clocks',()=>{
  const {scene,presented}=fixture();
  for(const p of [undefined,{...presented,ready:false}])expect(prepareSourceBouncingExport(scene,p,options)).toMatchObject({ok:false,error:{path:['frame']}});
  expect(prepareSourceBouncingExport(scene,{...presented,frame:{...presented.frame,camera:{...presented.frame.camera,phi:1}}},options)).toMatchObject({ok:false,error:{path:['camera']}});
  expect(prepareSourceBouncingExport(scene,{...presented,frame:{...presented.frame,checkpoint:{...presented.frame.checkpoint,sceneTime:.1} as SourceBouncingCheckpoint}},options).ok).toBe(false);
  expect(prepareSourceBouncingExport(scene,{...presented,frame:{...presented.frame,viewport:{...presented.frame.viewport,referenceLogicalHeight:0}}},options).ok).toBe(false);
 });
 it('rejects unusable recording requests and excessive replay capacity before opening a server export',()=>{
  const {scene,presented}=fixture(9999);
  expect(prepareSourceBouncingExport(scene,presented,options)).toMatchObject({ok:false,error:{kind:'capacity'}});
  for(const fps of [0,121,1.5,NaN])expect(prepareSourceBouncingExport(scene,presented,{...options,fps}).ok).toBe(false);
  for(const width of [0,15,1.5,NaN])expect(prepareSourceBouncingExport(scene,presented,{...options,width}).ok).toBe(false);
  scene.timeline.tracks=[{id:'x',type:'wait',start:0,duration:1,target:'timeline.wait',from:0,to:0,easing:'linear',pingPong:false,enabled:true}];
  expect(prepareSourceBouncingExport(scene,presented,{...options,kind:'image'}).ok).toBe(false);
 });
 it('checks warmup and every delivered frame before PNG encoding or upload',()=>{
  const {scene,presented}=fixture(),plan=unwrap(prepareSourceBouncingExport(scene,presented,options));
  const frame=plan.frames[0];
  const output:SceneOutput={type:'raster',width:320,height:180,pixels:new Uint8ClampedArray(320*180*4),cameraResolved:true,backend:'webgl2',sourceBouncingFrame:{checkpoint:frame,camera:plan.camera,viewport:plan.viewport},stats:{samples:1,generated:1,invalid:0}};
  expect(()=>assertSourceBouncingExportFrame(output,plan,frame)).not.toThrow();
  expect(()=>assertSourceBouncingExportFrame(output,plan,plan.warmup!)).toThrow('不一致');
  for(const patch of [{backend:'cpu'},{cameraResolved:undefined},{width:100},{pixels:new Uint8ClampedArray(4)},{sourceBouncingFrame:undefined},{sourceBouncingFrame:{...output.sourceBouncingFrame,viewport:{...plan.viewport,target:'primary'}}},{sourceBouncingFrame:{...output.sourceBouncingFrame,camera:{...plan.camera,zoom:2}}}])expect(()=>assertSourceBouncingExportFrame({...output,...patch} as SceneOutput,plan,frame)).toThrow('不一致');
 });
});
