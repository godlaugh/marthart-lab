import {describe,it,expect} from 'vitest';
import {parseLegacyScene,parseProjectFile} from '../src/engine/legacyImport';
import {parseScene,createScene} from '../src/engine/document';
import {sceneAtTime,clipDuration,resolveTimeline} from '../src/engine/timeline';
import {definition} from '../src/scenes';
import type {AnimationAction,AnimationTrack,GradientAnimation,ParameterAnimation,SceneDocument} from '../src/types';
const surface=(timeline:unknown[],extra:Record<string,unknown>={})=>({config_version:'1.0.0',type:'SURFACE',name:'Original timeline',equations:{x:'a*cos(u)',y:'v',z:'a*sin(u)'},parameters:{a:0},timeline,...extra});
const parse=(value:unknown)=>parseLegacyScene(JSON.stringify(value));
const animate=(duration:number,actions:unknown[],extra:Record<string,unknown>={})=>({type:'animate',duration,easing:'LINEAR',actions,...extra});
const action=(method:string,...args:unknown[])=>({method,args});
const wait=(duration:number)=>({type:'wait',duration});

// Explicit version-1 documents exercise the retained independent local clock.
// These fixtures never pass a native JSON document through a test-only adapter.
const localAction=(method:string,args:AnimationAction['args']={},extra:Partial<AnimationAction>={}):AnimationAction=>({id:crypto.randomUUID(),method,args,...extra});
const localClip=(start:number,duration:number,actions:AnimationAction[]=[],extra:Partial<AnimationTrack>={}):AnimationTrack=>({id:crypto.randomUUID(),type:'animate',target:'camera.actions',from:0,to:0,start,duration,easing:'linear',enabled:true,pingPong:false,actions,...extra});
const oscillator=(extra:Partial<ParameterAnimation>={}):ParameterAnimation=>({target:'parameters.a',min:-1,max:1,step:.6,enabled:true,...extra});
function local(tracks:AnimationTrack[],original?:unknown):SceneDocument {
 const scene=createScene(definition('surface'));scene.equations={x:'a*cos(u)',y:'v',z:'a*sin(u)'};scene.parameters={a:0};Object.assign(scene.settings,{renderMode:'points',surfaceBlend:0});scene.timeline.tracks=tracks;scene.timeline.duration=10;
 if(original!==undefined)scene.provenance={kind:'MathArt Studio',original:structuredClone(original),warnings:['Independent local document; native source retained as provenance only.']};
 const reopened=parseScene(JSON.stringify(scene));expect(reopened.version).toBe(1);expect(reopened.sourceCamera).toBeUndefined();expect(reopened.timeline.schedule).toBeUndefined();return reopened;
}
describe('original timeline Reader to real scene evaluator',()=>{
 it('keeps imported high/low centers through save/reload and interpolates below double precision',()=>{
  const result=parse({config_version:'1.0.0',type:'FRACTAL',name:'deep animation',fractal:{formula_id:'mandelbrot',center_hi_lo:[1,1e-20,2,-1e-20],zoom:1e16},timeline:[{type:'fractal_zoom',duration:2,easing:'LINEAR',center_hi_lo:[1,3e-20,2,5e-20],zoom:1e20}]});
  const restored=parseScene(JSON.stringify(result.scene)),middle=sceneAtTime(restored,1),end=sceneAtTime(restored,2);
  expect(restored.timeline.tracks[0].keyframes![1].centerXLow).toBe(3e-20);
  expect(middle.settings.centerX).toBe(1);expect(Number(middle.settings.centerXLow)).toBeCloseTo(2e-20,31);expect(Number(middle.settings.centerYLow)).toBeCloseTo(2e-20,31);expect(Number(middle.settings.zoom)/1e18).toBeCloseTo(1,12);expect(Number(end.settings.centerXLow)).toBeCloseTo(3e-20,31);
 });
 it('replaces default wait with a source queue and preserves full original through edited project reload',()=>{
  const raw=surface([wait(2),animate(2,[action('zoom',3)]),wait(1),animate(2,[action('zoom',5)])]),result=parseProjectFile(JSON.stringify(raw));result.scene.timeline.fps=4;
  expect(result.scene.timeline.duration).toBe(7);expect(result.scene.timeline.tracks.map(t=>t.start)).toEqual([0,0,0,0]);expect(resolveTimeline(result.scene).tracks.map(t=>t.start)).toEqual([0,2,4,5]);
  expect(sceneAtTime(result.scene,3.75).evaluatedSourceCamera!.camera.zoom).toBe(3);expect(sceneAtTime(result.scene,5.75).evaluatedSourceCamera!.camera.zoom).toBe(4);
  result.scene.timeline.tracks[1].actions![0].args={value:4};const reopened=parseScene(JSON.stringify(result.scene));expect(reopened.timeline.tracks).toHaveLength(4);expect(reopened.provenance!.original).toEqual(raw);expect(result.scene.provenance!.original).toEqual(raw);expect(sceneAtTime(reopened,3.75).evaluatedSourceCamera!.camera.zoom).toBe(4);
 });
 it('retains local scheduled zoom, full-precision rotateTo and next-turn align after saving version 1',()=>{
  const zoom=local([localClip(0,2,[],{type:'wait'}),localClip(2,2,[localAction('zoom',{value:3})]),localClip(4,1,[],{type:'wait'}),localClip(5,2,[localAction('zoom',{value:5})])]);
  expect(zoom.timeline.tracks.map(t=>t.start)).toEqual([0,2,4,5]);expect(sceneAtTime(zoom,4).camera.zoom).toBe(3);expect(sceneAtTime(zoom,6).camera.zoom).toBe(4);
  const rotation=local([localClip(0,1,[localAction('rotateTo',{phi:0,theta:Math.PI/2,gamma:Math.PI})])]),at=sceneAtTime(rotation,1);expect(rotation.timeline.tracks[0].actions![0].args).toEqual({phi:0,theta:Math.PI/2,gamma:Math.PI});expect(at.settings.cameraGamma).toBeCloseTo(Math.PI);expect(at.camera.position[2]).toBeCloseTo(0);
  const aligned=local([localClip(0,2,[],{type:'align',orientation:{gamma:Math.PI/2},alignMode:'next-turn'})]);expect(sceneAtTime(aligned,2).settings.cameraGamma).toBeCloseTo(2*Math.PI+Math.PI/2);
  const omitted=local([localClip(0,2,[],{type:'align',orientation:{},alignMode:'next-turn'})]);expect(sceneAtTime(omitted,2).camera).toEqual(omitted.camera);
 });
 it('keeps zero-duration starts/stops in version-1 local projects and rejects ambiguous native zero duration',()=>{
  const raw=surface([animate(0,[action('ambient',0,.3,0)]),wait(2),animate(0,[action('stopAmbient')]),wait(3)]);expect(()=>parse(raw)).toThrow('duration');
  const scene=local([localClip(0,0,[localAction('ambient',{phiSpeed:0,thetaSpeed:.3,gammaSpeed:0})]),localClip(0,2,[],{type:'wait'}),localClip(2,0,[localAction('stopAmbient')]),localClip(2,3,[],{type:'wait'})],raw);
  expect(scene.timeline.tracks[0].duration).toBe(0);expect(parseScene(JSON.stringify(scene)).timeline.tracks[0].duration).toBe(0);
  const initial=sceneAtTime(scene,0),moving=sceneAtTime(scene,1),stopped=sceneAtTime(scene,2);expect(moving.camera.position).not.toEqual(initial.camera.position);expect(sceneAtTime(scene,4).camera.position).toEqual(stopped.camera.position);expect(scene.provenance!.original).toEqual(raw);
 });
 it('maps source positional angles to Float32 scalars and builds relative targets against the initial camera',()=>{
  const result=parse(surface([animate(1,[action('rotateTo',0,'PI/2','PI')])])),at=sceneAtTime(parseScene(JSON.stringify(result.scene)),2);
  expect(result.scene.timeline.tracks[0].actions![0].args).toEqual({phi:0,theta:Math.fround(Math.PI/2),gamma:Math.fround(Math.PI)});expect(at.evaluatedSourceCamera!.camera).toMatchObject({phi:0,theta:Math.fround(Math.PI/2),gamma:Math.fround(Math.PI)});expect(at.camera).toEqual(result.scene.camera);
  const twice=parse(surface([animate(1,[action('rotateTheta',1)]),animate(1,[action('rotateTheta',1)])]));twice.scene.timeline.fps=4;expect(sceneAtTime(twice.scene,1.75).evaluatedSourceCamera!.camera.theta).toBe(1);
 });
 it('rejects original dynamic tracking without a provider while retaining local indexed tracking beside zoom',()=>{
  const raw=surface([animate(2,[action('track',174),action('zoom',4)])]);expect(()=>parse(raw)).toThrow('provider');
  const scene=local([localClip(0,2,[localAction('track',{index:174}),localAction('zoom',{value:4})])],raw);expect(scene.timeline.tracks[0].actions!.map(a=>a.method)).toEqual(['track','zoom']);expect(sceneAtTime(scene,2).camera.zoom).toBe(4);expect(scene.timeline.tracks[0].actions![0].args).toEqual({index:174});expect(scene.provenance!.original).toEqual(raw);
 });
 it('preserves skipped native disabled clips in source and editable local disabled clips in version-1 documents',()=>{
  const raw=surface([animate(9,[action('zoom',7)],{enabled:false}),wait(2)]),result=parse(raw);expect(result.scene.timeline.duration).toBe(2);expect(result.scene.timeline.tracks).toHaveLength(1);expect(result.scene.timeline.tracks[0].type).toBe('wait');expect(result.source).toEqual(raw);expect(sceneAtTime(result.scene,2).evaluatedSourceCamera!.camera.zoom).toBe(1);
  const scene=local([localClip(0,9,[localAction('zoom',{value:7})],{enabled:false}),localClip(0,2,[],{type:'wait'})],raw);expect(scene.timeline.tracks[0].enabled).toBe(false);expect(scene.timeline.tracks[1].start).toBe(0);expect(sceneAtTime(scene,2).camera.zoom).toBe(scene.camera.zoom);
 });
 it('preserves source align axes individually with Float32 next-turn arithmetic and no invented axes',()=>{
  const result=parse(surface([{type:'align',duration:2,target_gamma:'PI/2',easing:'LINEAR'}]));expect(sceneAtTime(result.scene,3).evaluatedSourceCamera!.camera.gamma).toBe(Math.fround(Math.fround(2*Math.PI)+Math.fround(Math.PI/2)));expect(result.scene.timeline.tracks[0].orientation).toEqual({gamma:Math.fround(Math.PI/2)});
  const omitted=parse(surface([{type:'align',duration:2}]));expect(omitted.scene.timeline.tracks).toHaveLength(1);expect(omitted.scene.timeline.tracks[0].orientation).toEqual({});expect(omitted.warnings.join()).not.toContain('整周角度');expect(sceneAtTime(omitted.scene,3).evaluatedSourceCamera!.camera).toMatchObject({phi:Math.fround(Math.PI/2),theta:0,gamma:0});
 });
 it('preserves normalized local step and negative initial direction through version-1 save/reload',()=>{
  const scene=local([localClip(0,0,[localAction('paramStart',{}, {parameters:[oscillator({phase:Math.PI})]})]),localClip(0,2,[],{type:'wait'})]);
  const p=scene.timeline.tracks[0].actions![0].parameters![0];expect(p.step).toBeCloseTo(.6);expect(p.phase).toBeCloseTo(Math.PI);expect(sceneAtTime(scene,1).parameters.a).toBeCloseTo(-Math.sin(.6));
  const imported=parse(surface([{type:'param',duration:2,easing:'LINEAR',parameters:{a:{min:-1,max:1,step:-.01,enable:true}}}]));expect(imported.scene.timeline.tracks[0].parameterAnimations![0]).toMatchObject({step:.6,phase:Math.PI});expect(imported.warnings.join()).toContain('60 fps');
 });
 it('implements saved local bounded parameter clips and freezes the exact independent-clock endpoint',()=>{const scene=local([localClip(0,2,[],{type:'param',target:'parameters.a',parameterClock:'elapsed',replaceParameters:true,parameterAnimations:[oscillator()]}),localClip(2,2,[],{type:'wait'})]);expect(sceneAtTime(scene,1).parameters.a).toBeCloseTo(Math.sin(.6));expect(sceneAtTime(scene,3).parameters.a).toBeCloseTo(Math.sin(1.2));});
 it('stops saved local parameter animation without substituting settings or injecting unknown targets',()=>{
  const scene=local([localClip(0,0,[localAction('paramStart',{}, {parameters:[oscillator()]})]),localClip(0,1,[],{type:'wait'}),localClip(1,0,[localAction('paramStop')]),localClip(1,2,[],{type:'wait'})]);expect(sceneAtTime(scene,3).parameters.a).toBeCloseTo(Math.sin(.6));expect(sceneAtTime(scene,3).parameters).not.toHaveProperty('future');
  const result=parse(surface([animate(1,[action('paramStart',{parameters:{a:{min:-1,max:1,step:.01,enable:true},future:{min:0,max:1,step:1}}})])]));expect(result.warnings.join()).toContain('future');expect(result.scene.timeline.tracks[0].actions![0].parameters!.map(p=>p.target)).toEqual(['parameters.a']);
 });
 it('preserves local gradient start/stop endpoints and rejects unsupported independent-side import flags',()=>{
  const scene=local([localClip(0,0,[localAction('gradientStart',{}, {gradient:{mode:'offset_cycle',speed:.2,interpolation:'rgb'}})]),localClip(0,2,[],{type:'wait'}),localClip(2,0,[localAction('gradientStop')]),localClip(2,2,[],{type:'wait'})]);expect(sceneAtTime(scene,1).palette.offset).toBeCloseTo(.2);expect(sceneAtTime(scene,4).palette.offset).toBeCloseTo(.4);
  const raw=surface([animate(1,[action('gradientStart',{mode:'OFFSET_CYCLE',speed:.2,affectInside:false})])]),limited=parse(raw);expect(limited.scene.timeline.tracks[0].actions).toEqual([]);expect(limited.warnings.join()).toContain('仅内部');expect(limited.source).toEqual(raw);
 });
 it('keeps all four saved local gradient algorithms and labels native import limitations',()=>{
  for(const mode of ['offset_cycle','hue_rotate','palette_morph','cross_fade'] as const){const gradient:GradientAnimation={mode,speed:.3,interpolation:'oklab'},scene=local([localClip(0,0,[localAction('gradientStart',{}, {gradient})]),localClip(0,3,[],{type:'wait'})]);expect(sceneAtTime(scene,1).palette).not.toEqual(scene.palette);
   const result=parse(surface([animate(1,[action('gradientStart',{mode:mode.toUpperCase(),speed:.3,interpolation:'OKLAB'})]),wait(3)]));expect(result.warnings.join()).toContain('独立实现');expect(result.scene.timeline.tracks[0].actions![0].gradient?.mode).toBe(mode);
  }
 });
 it('keeps saved local trails and mesh blending while refusing unresolved native instant-child timing',()=>{
  const raw=surface([{type:'trails',duration:1,enable:true},{type:'surface_mode_transition',duration:2,easing:'LINEAR',to:'MESH'}]);expect(()=>parse(raw)).toThrow('编译事实');
  const scene=local([localClip(0,1,[],{type:'trails',target:'settings.recordTrails',trailsEnabled:true}),localClip(1,2,[],{type:'surface_mode_transition',target:'settings.surfaceBlend',surfaceMode:'mesh'})],raw),at=sceneAtTime(scene,2);expect(at.settings.recordTrails).toBe(true);expect(at.settings.surfaceBlend).toBeCloseTo(.5);expect(at.settings.renderMode).toBe('mesh');expect(scene.provenance!.original).toEqual(raw);
 });
 it('interpolates fractal target centers during the clip without changing the imported initial state',()=>{
  const result=parse({config_version:'1.0.0',type:'FRACTAL',name:'zoom',fractal:{formula_id:'mandelbrot',center:[0,0],zoom:1},timeline:[wait(1),{type:'fractal_zoom',duration:2,easing:'LINEAR',center:[-1,.2],zoom:100}]});
  expect(result.scene.settings.centerX).toBe(0);const at=sceneAtTime(result.scene,2);expect(at.settings.centerX).toBeCloseTo(-.5);expect(at.settings.zoom).toBeCloseTo(10);expect(sceneAtTime(result.scene,3).settings.centerX).toBe(-1);
 });
 it('selects the greatest-time old key target, with last equal-time entry winning, and preserves high/low coordinates',()=>{
  const result=parse({config_version:'1.0.0',type:'FRACTAL',name:'keys',fractal:{formula_id:'mandelbrot',zoom:1},timeline:[{type:'fractal_zoom',duration:2,zoom:10,keys:[{time:.8,zoom:100,center:[1,2]},{time:.3,zoom:3},{time:.8,zoom:400,center_hi_lo:[3,1e-20,4,-1e-20]}]}]});
  expect(result.scene.timeline.tracks[0].keyframes).toHaveLength(2);expect(sceneAtTime(result.scene,2).settings.zoom).toBeCloseTo(400);expect(sceneAtTime(result.scene,2).settings.centerX).toBe(3);expect(result.warnings.join()).toContain('并列取后者');expect(result.scene.timeline.tracks[0].keyframes![1]).toMatchObject({centerXLow:1e-20,centerYLow:-1e-20});
 });
 it('uses previous zoom clip endpoint as the following clip start',()=>{const result=parse({config_version:'1.0.0',type:'FRACTAL',name:'sequential',fractal:{formula_id:'mandelbrot',zoom:1},timeline:[{type:'fractal_zoom',duration:1,zoom:10,center:[1,2]},{type:'fractal_zoom',duration:1,zoom:100,center:[3,4]}]});expect(result.scene.timeline.tracks[1].keyframes![0]).toEqual({time:0,zoom:Math.exp(Math.log(10)),centerX:1,centerY:2,centerXLow:0,centerYLow:0});});
 it('maps explicit fractal complex components and Newton bailout to convergence tolerance',()=>{const result=parse({config_version:'1.0.0',type:'FRACTAL',name:'params',fractal:{formula_id:'newton'},timeline:[animate(0,[action('paramStart',{targetDomain:'FRACTAL',parameters:{start_value_re:{min:-1,max:1,step:.01},bailout:{min:.001,max:.01,step:.00001}}})]),wait(1)]});expect(result.scene.timeline.tracks[0].actions![0].parameters!.map(p=>p.target)).toEqual(['settings.tolerance']);expect(result.warnings.join()).toContain('start_value_re');});
 it('routes each scene rotation to the correct setting and refuses cross-scene actions',()=>{const domain=parse({config_version:'1.0.0',type:'DOMAIN_COLORING',name:'rotate',domainColoring:{formula:'z'},timeline:[animate(0,[action('domainRotate',.25)]),wait(2)]});expect(sceneAtTime(domain.scene,2).settings.rotation).toBeCloseTo(.5);const wrong=parse(surface([animate(1,[action('domainRotate',.25)])]));expect(wrong.warnings.join()).toContain('未分派');expect(wrong.scene.timeline.tracks[0].actions).toEqual([]);});
 it('preserves source finish-wait duration as a deadline while scheduling its visual completion',()=>{const result=parse({config_version:'1.0.0',type:'SPIROGRAPH',name:'finish',settings:{layers:[{statorRadius:3,penDistance:1,speed:2,rotors:[{radius:1,mode:'INSIDE'}]}]},timeline:[{type:'spirograph_finish_wait',duration:99}]});const track=result.scene.timeline.tracks[0];expect(track).toMatchObject({duration:99,spirographWait:'visual-or-deadline-v1'});expect(result.scene.timeline.duration).toBe(.1);expect(resolveTimeline(result.scene).duration).toBe(clipDuration(track,result.scene));expect(resolveTimeline(result.scene).duration).toBeLessThan(99);});
 it('uses the source zero fallback for nonarray args while preserving the original input',()=>{const raw=surface([animate(1,[{method:'zoom',args:{value:2}}])]),result=parseProjectFile(JSON.stringify(raw));expect(result.scene.timeline.tracks[0].actions![0].args).toEqual({value:0});const reopened=parseScene(JSON.stringify(result.scene));expect(sceneAtTime(reopened,2).evaluatedSourceCamera!.camera.zoom).toBe(0);expect(reopened.provenance!.original).toEqual(raw);});
 it('rejects malformed arrays, nonfinite expressions and overlong action lists',()=>{expect(()=>parse({...surface([]),timeline:{}})).toThrow('数组');expect(()=>parse(surface([{type:'animate',duration:1,actions:{}}]))).toThrow('数组');expect(()=>parse(surface([animate(1,[action('zoom','1/0')])]))).toThrow();expect(()=>parse(surface([animate(1,Array.from({length:65},()=>action('stopAmbient')))]))).toThrow('64');expect(()=>parse(surface([wait(86401)]))).toThrow('86400');});
});


it('inherits source edge easing at global, action, and per-parameter levels',()=>{const r=parse(surface([animate(1,[action('paramStart',{edgeEasing:{floor:.4},parameters:{a:{min:-1,max:1,step:.01,edgeEasing:{easing:'QUAD_OUT'}}}})]),wait(2)],{settings:{param_edge_easing:{window:.8,floor:.2,easing:'LINEAR'}}}));expect(r.scene.timeline.tracks[0].actions![0].parameters![0].edgeEasing).toEqual({window:.8,floor:.4,easing:'quad-out'});const bounded=parse(surface([{type:'param',duration:2,parameters:{a:{min:-1,max:1,step:.01}}}]));expect(bounded.scene.timeline.tracks[0].parameterClock).toBe('elapsed');expect(bounded.scene.timeline.tracks[0].parameterAnimations![0].edgeEasing).toEqual({window:.4,floor:.5,easing:'sine-out'});});
