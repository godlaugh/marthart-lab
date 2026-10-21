import {sourceQueuePresentedScene} from '../src/engine/sourceQueuePresentation';
import {describe,it,expect} from 'vitest';
import {createScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {importSourceAttractorConfig} from '../src/engine/sourceAttractorConfig';
import {importSourceAttractorVisualConfig} from '../src/engine/sourceAttractorVisualConfig';
import {generateScene,TemporalGenerationSession} from '../src/engine/temporal';
import {sceneAtTime,resolveTimeline,validateTimelineExtensions} from '../src/engine/timeline';
import {outputBuffers} from '../src/engine/outputBuffers';
import {gradientAnimationCapabilities} from '../src/engine/gradientOffsets';
import {supportsParticleTracking} from '../src/engine/sceneCamera';
import {SOURCE_CAMERA_MODEL} from '../src/engine/sourceCamera';
import type {GenerateContext,SceneOutput} from '../src/types';

function source(){
 const scene=createScene(definition('attractor'));
 const settings={particle_count_cpu:1,time_step:1,sub_steps:3,scale_x:2,offset_x:1};
 const config=importSourceAttractorConfig(settings,{bounds:{min_x:0,max_x:0,min_y:0,max_y:0,min_z:0,max_z:0}});
 const visual=importSourceAttractorVisualConfig(settings,['#ff0000','#00ff00','#0000ff']);
 if(!config.ok||!visual.ok)throw Error('fixture');
 scene.attractorSource={configuration:config.value.configuration,visual:visual.value.configuration,backgroundColor:0xff102030};
 scene.sourceCamera={model:SOURCE_CAMERA_MODEL,configuration:{kind:'absent'}};
 Object.assign(scene.settings,{sourceCameraProjection:'perspective',computeBackend:'cpu',presentation:'points',scale:1,rotateX:0,rotateY:0,rotateZ:0});
 scene.equations={dx:'speed',dy:'0',dz:'0'};scene.parameters={speed:1};
 scene.timeline={duration:1,fps:4,loop:false,schedule:'ordinary-camera-sequence-v1',tracks:[{id:'g',type:'animate',target:'camera.actions',from:0,to:0,start:0,duration:.5,easing:'linear',enabled:true,pingPong:false,actions:[{id:'g',method:'gradientStart',gradient:{model:'offsets',mode:'hue_rotate',interpolation:'rgb',speed:90,affectInside:true,affectOutside:true}},{id:'t',method:'track',args:{index:0}}]},{id:'w',type:'wait',target:'timeline.wait',from:0,to:0,start:0,duration:.5,easing:'linear',enabled:true,pingPong:false}]};
 return scene;
}
const context:GenerateContext={time:.25,width:200,height:100,quality:'preview',sourceViewport:{logicalWidth:200,logicalHeight:100,referenceLogicalHeight:100,target:'primary',projectionPass:'perspective'}};
function geometry(output:SceneOutput){if(output.type!=='geometry')throw Error('geometry expected');return output;}
function facts(output:SceneOutput){const out=geometry(output);return{positions:out.positions,colors:out.colors,alphas:out.pointAlphas,ids:out.particleIds,trails:out.trails,camera:out.sourceCameraFrame,background:out.sourceBackgroundColor};}

describe('public native CPU Attractor dispatch',()=>{
 it('uses source Euler substeps and native point/trail contracts, with camera querying the same state',()=>{
  const scene=source(),out=geometry(generateScene(scene,context));
  expect(Array.from(out.positions)).toEqual([13,0,0]);expect(out.temporal!.recordedPoints).toBe(6);
  expect(out.sourcePointAppearance!.model).toBe('mathart-1.7.8-cpu-billboard-v1');
  expect(out.trails!.appearance!.model).toBe('processing-lines-1.7.8');
  expect(out.sourceBackgroundColor).toBe(0xff102030);
  expect(out.sourceCameraFrame!.camera).toEqual(sceneAtTime(scene,.25).evaluatedSourceCamera!.camera);
  expect(out.sourceCameraFrame!.camera.center).toEqual(Array.from(out.positions));
  expect(supportsParticleTracking(scene)).toBe(true);
 });
 it('does not apply the local palette timeline a second time, and owns evaluated snapshots',()=>{
  const scene=source(),before=structuredClone(scene),evaluated=sceneAtTime(scene,.25);
  expect(evaluated.palette).toEqual(before.palette);expect(evaluated.parameters).toEqual(before.parameters);
  evaluated.attractorSource!.configuration.transform.offsetX=999;expect(scene).toEqual(before);
  expect(gradientAnimationCapabilities(scene)).toMatchObject({localPalette:false,offsets:true,defaultAnimation:{model:'offsets'}});
  expect(resolveTimeline(scene).tracks[1].start).toBe(.5);
 });
 it('rebuilds exact fresh outputs on reverse seek, export quality and transferred Worker buffers',()=>{
  const scene=source(),session=new TemporalGenerationSession();
  try{
   const first=generateScene(scene,context,session),expected=facts(structuredClone(first));
   structuredClone(first,{transfer:outputBuffers(first)});expect(geometry(first).positions.byteLength).toBe(0);
   generateScene(scene,{...context,time:.75},session);
   expect(facts(generateScene(scene,{...context,quality:'export'},session))).toEqual(expected);
   expect(facts(generateScene(scene,context))).toEqual(expected);
   const before=geometry(generateScene(scene,{...context,time:.5})).positions;
   scene.attractorSource!.configuration.transform.offsetX=11;
   const after=geometry(generateScene(scene,{...context,time:.5},session)).positions;
   expect(after[0]-before[0]).toBe(10);
  }finally{session.reset();}
 });
 it('freezes motion and history at queue completion and retains CPU source count at every quality',()=>{
  const scene=source(),end=geometry(generateScene(scene,{...context,time:1})),later=geometry(generateScene(scene,{...context,time:2}));
  expect(later.positions).toEqual(end.positions);expect(later.trails).toEqual(end.trails);expect(later.colors).toEqual(end.colors);
  scene.attractorSource!.configuration.particleCountCPU=7;
  for(const quality of ['preview','export'] as const)expect(geometry(generateScene(scene,{...context,quality})).positions.length).toBe(21);
 });
 it('rejects wrong projection and cancellation without poisoning later independent generation',()=>{
  const scene=source();expect(()=>generateScene(scene,{...context,sourceViewport:undefined})).toThrow('逻辑画布');
  expect(()=>generateScene(scene,{...context,sourceViewport:{...context.sourceViewport!,projectionPass:'scene-fade-orthographic'}})).toThrow('投影');
  expect(()=>generateScene(scene,{...context,isCancelled:()=>true})).toThrow('取消');
  expect(geometry(generateScene(scene,context)).positions[0]).toBe(13);
 });
 it('validates dormant source gradients and keeps unsupported source parameter actions explicit',()=>{
  const scene=source(),track=structuredClone(scene.timeline.tracks[0]);track.enabled=false;
  track.actions![0].gradient!.speed=-1;
  expect(()=>validateTimelineExtensions(track,'attractor','ordinary-camera-sequence-v1','attractor')).toThrow();
  scene.timeline.tracks[0].actions=[{id:'p',method:'paramStart',parameters:[{target:'parameters.speed',min:0,max:10,step:1,enabled:true}]}];
  expect(()=>generateScene(scene,context)).toThrow();
 });
});

describe('retained source CPU Attractor request lifetime',()=>{
 it('presents the exact delivered camera without another replay or local gradient pass',()=>{
  const scene=source(),out=generateScene(scene,context),presented=sourceQueuePresentedScene(scene,out)!;
  expect(presented.evaluatedSourceCamera).toBe(out.sourceCameraFrame);
  expect(presented.evaluatedSourceCamera!.camera).toEqual(sceneAtTime(scene,context.time).evaluatedSourceCamera!.camera);
  expect(presented.palette).toEqual(scene.palette);expect(presented.parameters).toEqual(scene.parameters);
  expect(sourceQueuePresentedScene(createScene(definition('surface')),out)).toBeUndefined();
 });
 it('shares motion and camera across forward/same-frame requests, with detached transferable outputs',()=>{
  const scene=source(),session=new TemporalGenerationSession();
  try{
   for(const time of [0,.25,.25,.5,.75,1,2]){
    const out=generateScene(scene,{...context,time},session);
    expect(facts(out)).toEqual(facts(generateScene(scene,{...context,time})));
    expect(session.diagnostics().sourceAttractor.constructions).toBe(1);
    structuredClone(out,{transfer:outputBuffers(out)});
   }
   expect(session.diagnostics().sourceAttractor.retainedBytes).toBeGreaterThan(0);
  }finally{session.reset();}
  expect(session.diagnostics().sourceAttractor.retainedBytes).toBe(0);
 });
 it('reuses motion when only resolution/quality changes, rebuilding for reverse or edited author input',()=>{
  const scene=source(),session=new TemporalGenerationSession();
  try{
   generateScene(scene,context,session);
   const sized={...context,width:400,height:200,quality:'export' as const,sourcePointPixelDensity:2,sourceViewport:{...context.sourceViewport!,logicalWidth:400,logicalHeight:200}};
   expect(facts(generateScene(scene,sized,session))).toEqual(facts(generateScene(scene,sized)));
   expect(session.diagnostics().sourceAttractor.constructions).toBe(1);
   generateScene(scene,{...context,time:0},session);expect(session.diagnostics().sourceAttractor.constructions).toBe(2);
   for(const edit of [()=>scene.parameters.speed=2,()=>scene.equations.dx='speed*3',()=>scene.timeline.tracks[0].duration=0,()=>scene.id+='-copy',()=>scene.attractorSource!.visual.trails.lifetime=0]){
    edit();expect(facts(generateScene(scene,context,session))).toEqual(facts(generateScene(scene,context)));
    expect(session.diagnostics().sourceAttractor.constructions).toBe(1);
   }
  }finally{session.reset();}
 });
 it('discards partial cancelled state, rejects malformed edits and releases state on leaving the family',()=>{
  const scene=source(),session=new TemporalGenerationSession();
  try{
   generateScene(scene,{...context,time:0},session);
   let polls=0;expect(()=>generateScene(scene,{...context,time:.75,isCancelled:()=>++polls>12},session)).toThrow('取消');
   expect(session.diagnostics().sourceAttractor.retainedBytes).toBe(0);
   expect(facts(generateScene(scene,context,session))).toEqual(facts(generateScene(scene,context)));
   scene.parameters.speed=Infinity;expect(()=>generateScene(scene,context,session)).toThrow();
   expect(session.diagnostics().sourceAttractor.retainedBytes).toBe(0);
   scene.parameters.speed=1;generateScene(scene,context,session);
   session.select(createScene(definition('surface')),context);
   expect(session.diagnostics().sourceAttractor.retainedBytes).toBe(0);
  }finally{session.reset();}
 });
});

describe('public source Attractor combined request capacity',()=>{
 it('rejects a seek whose final snapshot exceeds the request budget, clears state and recovers',()=>{
  const scene=source(),session=new TemporalGenerationSession(),settings={particle_count_cpu:1000,time_step:.005,sub_steps:5,show_trails:true,fade_trails:true,trail_lifetime:3};
  const config=importSourceAttractorConfig(settings,{warmup_steps:200}),visual=importSourceAttractorVisualConfig(settings,['#ff0000','#00ff00','#0000ff']);
  if(!config.ok||!visual.ok)throw Error('fixture');
  scene.attractorSource={configuration:config.value.configuration,visual:visual.value.configuration,backgroundColor:0xff000000};
  scene.equations={dx:'10*(y-x)',dy:'x*(28-z)-y',dz:'x*y-8/3*z'};scene.parameters={};
  scene.timeline.fps=30;scene.timeline.tracks=[{...scene.timeline.tracks[1],duration:10}];
  try{
   expect(()=>generateScene(scene,{...context,time:61/30},session)).toThrow('2000 万');
   expect(session.diagnostics().sourceAttractor.retainedBytes).toBe(0);
   expect(facts(generateScene(scene,{...context,time:0},session))).toEqual(facts(generateScene(scene,{...context,time:0})));
  }finally{session.reset();}
 });
});
