import {describe,it,expect} from 'vitest';
import {prepareSourceBouncingExport,sourceBouncingExportContext,assertSourceBouncingExportFrame,type SourceBouncingPresentedExport} from '../src/engine/sourceBouncingExport';
import {importSourceBouncingDocument,sourceBouncingCameraInput} from '../src/engine/sourceBouncingDocument';
import {planSourceBouncingFixedReplay,type SourceBouncingCheckpoint} from '../src/engine/sourceBouncingReplay';
import {sourceBouncingViewFromCamera} from '../src/engine/sourceBouncingNavigation';
import {prepareSourceCamera} from '../src/engine/sourceCamera';
import {sourceBouncingViewInput} from '../src/engine/sourceBouncingNavigation';
import {prepareSourceBouncingDisplay} from '../src/engine/sourceBouncingVisualConfig';
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
 const presented:SourceBouncingPresentedExport={ready:true,frame:{pixelDensity:1,checkpoint,camera:camera.plan.camera.value,viewport}};
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
  expect(plan.view).toEqual(unwrap(sourceBouncingViewFromCamera(presented.frame.camera)));
  expect(request.sourceBouncingView).toEqual(plan.view);expect(request.sourceBouncingView).not.toBe(plan.view);
 });
 it('inherits measured density into logical projection while retaining requested and actual physical sizes',()=>{
  const {scene,presented}=fixture();
  presented.frame={...presented.frame,pixelDensity:2,viewport:{...presented.frame.viewport,referenceLogicalHeight:486}};
  const before=structuredClone(scene);
  const plan=unwrap(prepareSourceBouncingExport(scene,presented,{...options,kind:'image',width:500,height:600}));
  expect(plan).toMatchObject({requestedSize:{width:500,height:600},width:500,height:600,pixelDensity:2,viewport:{logicalWidth:250,logicalHeight:300,referenceLogicalHeight:486}});
  const camera=unwrap(prepareSourceCamera(sourceBouncingViewInput(plan.view),plan.viewport));if(camera.kind!=='known')throw Error('camera');
  const display=unwrap(prepareSourceBouncingDisplay(scene.bouncingSource!.visual,{initialSpeed:scene.bouncingSource!.configuration.initialSpeed},camera.plan.displayScale));
  expect(display.radius).toBe(Math.fround(1.25*Math.fround(300/486)));
  expect(sourceBouncingExportContext(plan,plan.frames[0]).sourcePointPixelDensity).toBe(2);
  for(const kind of ['image','video'] as const){
   const rounded=unwrap(prepareSourceBouncingExport(scene,presented,{...options,kind,width:321,height:181}));
   expect(rounded).toMatchObject({requestedSize:{width:321,height:181},width:322,height:182,viewport:{logicalWidth:161,logicalHeight:91}});
  }
  // Density is delivered runtime state, not an authored or migrated scene field.
  expect(scene).toEqual(before);expect(scene.bouncingSource).not.toHaveProperty('pixelDensity');
 });
 it('rejects missing or malformed delivered density instead of assuming a monitor configuration',()=>{
  const {scene,presented}=fixture();
  for(const pixelDensity of [undefined,null,0,-1,1.5,NaN,Infinity])expect(prepareSourceBouncingExport(scene,{...presented,frame:{...presented.frame,pixelDensity} as never},options)).toMatchObject({ok:false,error:{path:['frame','pixelDensity']}});
  expect(prepareSourceBouncingExport(scene,presented,{...options,width:16384,height:16384})).toMatchObject({ok:false,error:{kind:'capacity'}});
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
 it('native seed video rebuilds author angles and zoom1 instead of retaining the paused view',()=>{
  const {scene,presented}=fixture(300);scene.bouncingSource!.camera={phi:.25,theta:-.5,gamma:.75};
  presented.frame={...presented.frame,camera:{...presented.frame.camera,phi:1,theta:2,gamma:3,zoom:4}};
  const plan=unwrap(prepareSourceBouncingExport(scene,presented,{...options,start:'seed'}));
  expect(plan.warmup?.simulationUpdates).toBe(1);expect(plan.frames[0].simulationUpdates).toBe(2);expect(plan.frames.at(-1)?.simulationUpdates).toBe(30);
  expect(plan.viewport.referenceLogicalHeight).toBe(360);expect(plan.view).toMatchObject({phi:.25,theta:-.5,gamma:.75,zoom:1});
  expect(sourceBouncingExportContext(plan,plan.frames[0]).sourceBouncingView).toEqual(plan.view);
 });
 it('PNG and current-state video retain detached paused camera facts without changing the author document',()=>{
  const {scene,presented}=fixture(),before=structuredClone(scene);
  const deliveredCamera={...presented.frame.camera,phi:-0,theta:Math.fround(.3),gamma:-.5,zoom:2};
  presented.frame={...presented.frame,camera:deliveredCamera};
  for(const selection of [{kind:'image' as const,start:'seed' as const},{kind:'video' as const,start:'current' as const}]){
   const plan=unwrap(prepareSourceBouncingExport(scene,presented,{...options,...selection}));
   expect(plan.view).toEqual(unwrap(sourceBouncingViewFromCamera(presented.frame.camera)));
   expect(Object.is(plan.view.phi,-0)).toBe(true);
   const context=sourceBouncingExportContext(plan,plan.frames[0]);
   expect(context.sourceBouncingView).toEqual(plan.view);expect(context.sourceBouncingView).not.toBe(plan.view);
   expect(plan.frames[0].simulationUpdates).toBe(selection.kind==='image'?17:19);
  }
  expect(scene).toEqual(before);
  const retained=unwrap(prepareSourceBouncingExport(scene,presented,{...options,kind:'image'}));
  deliveredCamera.zoom=3;expect(retained.view.zoom).toBe(2);
 });
 it('encodes one frame even when the real warmup crossed the source duration',()=>{
  const {scene,presented}=fixture();scene.bouncingSource!.recordDuration=Math.fround(.1);
  const plan=unwrap(prepareSourceBouncingExport(scene,presented,{...options,fps:1}));
  expect(plan.warmup?.sceneTime).toBe(1);expect(plan.frames).toHaveLength(1);expect(plan.frames[0].sceneTime).toBe(2);
 });
 it('rejects unready or unrepresentable presented camera facts and malformed paired clocks',()=>{
  const {scene,presented}=fixture();
  for(const p of [undefined,{...presented,ready:false}])expect(prepareSourceBouncingExport(scene,p,options)).toMatchObject({ok:false,error:{path:['frame']}});
  for(const patch of [{phi:NaN},{phi:.1},{zoom:0},{center:[1,0,0] as const},{center:[-0,0,0] as const},{focalDistance:21}])expect(prepareSourceBouncingExport(scene,{...presented,frame:{...presented.frame,camera:{...presented.frame.camera,...patch}}},options).ok).toBe(false);
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
  const frame=plan.frames[0],camera={phi:plan.view.phi,theta:plan.view.theta,gamma:plan.view.gamma,zoom:plan.view.zoom,center:[0,0,0] as [number,number,number],focalDistance:20};
  const output:SceneOutput={type:'raster',width:320,height:180,pixels:new Uint8ClampedArray(320*180*4),cameraResolved:true,backend:'webgl2',sourceBouncingFrame:{pixelDensity:plan.pixelDensity,checkpoint:frame,camera,viewport:plan.viewport},stats:{samples:1,generated:1,invalid:0}};
  expect(()=>assertSourceBouncingExportFrame(output,plan,frame)).not.toThrow();
  expect(()=>assertSourceBouncingExportFrame(output,plan,plan.warmup!)).toThrow('不一致');
  for(const patch of [{sourceBouncingFrame:{...output.sourceBouncingFrame,pixelDensity:2}},{backend:'cpu'},{cameraResolved:undefined},{width:100},{pixels:new Uint8ClampedArray(4)},{sourceBouncingFrame:undefined},{sourceBouncingFrame:{...output.sourceBouncingFrame,viewport:{...plan.viewport,target:'primary'}}},{sourceBouncingFrame:{...output.sourceBouncingFrame,camera:{...camera,zoom:2}}},{sourceBouncingFrame:{...output.sourceBouncingFrame,camera:{...camera,phi:-0}}},{sourceBouncingFrame:{...output.sourceBouncingFrame,camera:{...camera,center:[1,0,0]}}},{sourceBouncingFrame:{...output.sourceBouncingFrame,camera:{...camera,focalDistance:21}}}])expect(()=>assertSourceBouncingExportFrame({...output,...patch} as SceneOutput,plan,frame)).toThrow('不一致');
 });
});
