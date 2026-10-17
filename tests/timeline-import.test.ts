import {describe,it,expect} from 'vitest';
import {parseLegacyScene} from '../src/engine/legacyImport';
import {parseScene} from '../src/engine/document';
import {sceneAtTime,clipDuration,resolveTimeline} from '../src/engine/timeline';
const surface=(timeline:unknown[],extra:Record<string,unknown>={})=>({config_version:'1.0.0',type:'SURFACE',name:'Original timeline',equations:{x:'a*cos(u)',y:'v',z:'a*sin(u)'},parameters:{a:0},timeline,...extra});
const parse=(value:unknown)=>parseLegacyScene(JSON.stringify(value));
const animate=(duration:number,actions:unknown[],extra:Record<string,unknown>={})=>({type:'animate',duration,easing:'LINEAR',actions,...extra});
const action=(method:string,...args:unknown[])=>({method,args});
const wait=(duration:number)=>({type:'wait',duration});

describe('original timeline Reader to real scene evaluator',()=>{
 it('keeps imported high/low centers through save/reload and interpolates below double precision',()=>{
  const result=parse({config_version:'1.0.0',type:'FRACTAL',name:'deep animation',fractal:{formula_id:'mandelbrot',center_hi_lo:[1,1e-20,2,-1e-20],zoom:1e16},timeline:[{type:'fractal_zoom',duration:2,easing:'LINEAR',center_hi_lo:[1,3e-20,2,5e-20],zoom:1e20}]});
  const restored=parseScene(JSON.stringify(result.scene)),middle=sceneAtTime(restored,1),end=sceneAtTime(restored,2);
  expect(restored.timeline.tracks[0].keyframes![1].centerXLow).toBe(3e-20);
  expect(middle.settings.centerX).toBe(1);expect(Number(middle.settings.centerXLow)).toBeCloseTo(2e-20,31);expect(Number(middle.settings.centerYLow)).toBeCloseTo(2e-20,31);expect(Number(middle.settings.zoom)/1e18).toBeCloseTo(1,12);expect(Number(end.settings.centerXLow)).toBeCloseTo(3e-20,31);
 });
 it('replaces the default wait, preserves scheduling gaps, and composes sequential zoom targets',()=>{
  const result=parse(surface([wait(2),animate(2,[action('zoom',3)]),wait(1),animate(2,[action('zoom',5)])]));
  expect(result.scene.timeline.duration).toBe(7);expect(result.scene.timeline.tracks.map(t=>t.start)).toEqual([0,2,4,5]);expect(sceneAtTime(result.scene,4).camera.zoom).toBe(3);expect(sceneAtTime(result.scene,6).camera.zoom).toBe(4);expect(parseScene(JSON.stringify(result.scene)).timeline.tracks).toHaveLength(4);
 });
 it('runs zero-duration starts and stops exactly at their scheduled boundaries',()=>{
  const result=parse(surface([animate(0,[action('ambient',0,.3,0)]),wait(2),animate(0,[action('stopAmbient')]),wait(3)]));
  expect(result.scene.timeline.tracks[0].duration).toBe(0);expect(parseScene(JSON.stringify(result.scene)).timeline.tracks[0].duration).toBe(0);
  const initial=sceneAtTime(result.scene,0),moving=sceneAtTime(result.scene,1),stopped=sceneAtTime(result.scene,2);expect(moving.camera.position).not.toEqual(initial.camera.position);expect(sceneAtTime(result.scene,4).camera.position).toEqual(stopped.camera.position);
 });
 it('maps original phi/theta/gamma positional order and explicit radians expressions',()=>{
  const result=parse(surface([animate(1,[action('rotateTo',0,'PI/2','PI')])])) ;const at=sceneAtTime(result.scene,1);
  expect(result.scene.timeline.tracks[0].actions![0].args).toEqual({phi:0,theta:Math.PI/2,gamma:Math.PI});expect(at.settings.cameraGamma).toBeCloseTo(Math.PI);expect(at.camera.position[2]).toBeCloseTo(0);
 });
 it('preserves dynamic surface index beside another camera action',()=>{
  const raw=surface([animate(2,[action('track',174),action('zoom',4)])]),result=parse(raw);expect(result.scene.timeline.tracks[0].actions!.map(a=>a.method)).toEqual(['track','zoom']);expect(sceneAtTime(result.scene,2).camera.zoom).toBe(4);expect(result.scene.timeline.tracks[0].actions![0].args).toEqual({index:174});expect(result.source).toEqual(raw);
 });
 it('keeps disabled clips editable but excludes their durations from runtime scheduling',()=>{const result=parse(surface([animate(9,[action('zoom',7)],{enabled:false}),wait(2)]));expect(result.scene.timeline.duration).toBe(2);expect(result.scene.timeline.tracks[0].enabled).toBe(false);expect(result.scene.timeline.tracks[1].start).toBe(0);expect(sceneAtTime(result.scene,2).camera.zoom).toBe(result.scene.camera.zoom);});
 it('preserves align axes individually and does not invent absent target angles',()=>{const result=parse(surface([{type:'align',duration:2,target_gamma:'PI/2',easing:'LINEAR'}]));expect(sceneAtTime(result.scene,2).settings.cameraGamma).toBeCloseTo(2*Math.PI+Math.PI/2);expect(result.scene.timeline.tracks[0].orientation).toEqual({gamma:Math.PI/2});const omitted=parse(surface([{type:'align',duration:2}]));expect(omitted.scene.timeline.tracks).toHaveLength(1);expect(omitted.scene.timeline.tracks[0].orientation).toEqual({});expect(omitted.warnings.join()).not.toContain('整周角度');expect(sceneAtTime(omitted.scene,2).camera).toEqual(omitted.scene.camera);});
 it('uses a documented 60fps conversion for legacy scalar step and preserves negative initial direction',()=>{
  const result=parse(surface([animate(0,[action('paramStart',{targetDomain:'SURFACE',parameters:{a:{min:-1,max:1,step:-.01,enable:true}}})]),wait(2)]));
  const p=result.scene.timeline.tracks[0].actions![0].parameters![0];expect(p.step).toBeCloseTo(.6);expect(p.phase).toBeCloseTo(Math.PI);expect(sceneAtTime(result.scene,1).parameters.a).toBeCloseTo(-Math.sin(.6));expect(result.warnings.join()).toContain('60 fps');
 });
 it('implements bounded param clips and freezes their result afterward',()=>{const result=parse(surface([{type:'param',duration:2,easing:'LINEAR',parameters:{a:{min:-1,max:1,step:.01,enable:true}}},wait(2)]));expect(sceneAtTime(result.scene,1).parameters.a).toBeCloseTo(Math.sin(.6));expect(sceneAtTime(result.scene,3).parameters.a).toBeCloseTo(Math.sin(1.2));});
 it('stops active parameters without substituting settings or injecting unknown targets',()=>{const result=parse(surface([animate(0,[action('paramStart',{parameters:{a:{min:-1,max:1,step:.01,enable:true},future:{min:0,max:1,step:1}}})]),wait(1),animate(0,[action('paramStop')]),wait(2)]));expect(sceneAtTime(result.scene,3).parameters.a).toBeCloseTo(Math.sin(.6));expect(result.warnings.join()).toContain('future');});
 it('applies gradient starts and stops and refuses independent-side flags it cannot honor',()=>{
  const result=parse(surface([animate(0,[action('gradientStart',{mode:'OFFSET_CYCLE',speed:.2,interpolation:'RGB'})]),wait(2),animate(0,[action('gradientStop')]),wait(2)]));expect(sceneAtTime(result.scene,1).palette.offset).toBeCloseTo(.2);expect(sceneAtTime(result.scene,4).palette.offset).toBeCloseTo(.4);
  const limited=parse(surface([animate(1,[action('gradientStart',{mode:'OFFSET_CYCLE',speed:.2,affectInside:false})])]));expect(limited.scene.timeline.tracks).toHaveLength(0);expect(limited.warnings.join()).toContain('仅内部');
 });
 it('imports all four declared gradient modes as explicit independent algorithms',()=>{for(const mode of ['OFFSET_CYCLE','HUE_ROTATE','PALETTE_MORPH','CROSS_FADE']){const result=parse(surface([animate(0,[action('gradientStart',{mode,speed:.3,interpolation:'OKLAB'})]),wait(3)]));const changed=sceneAtTime(result.scene,1).palette;expect(changed).not.toEqual(result.scene.palette);expect(result.warnings.join()).toContain('独立实现');}});
 it('sets trails state and performs a real surface mesh blend',()=>{const result=parse(surface([{type:'trails',duration:1,enable:true},{type:'surface_mode_transition',duration:2,easing:'LINEAR',to:'MESH'}]));const at=sceneAtTime(result.scene,2);expect(at.settings.recordTrails).toBe(true);expect(at.settings.surfaceBlend).toBeCloseTo(.5);expect(at.settings.renderMode).toBe('mesh');});
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
 it('routes each scene rotation to the correct setting and refuses cross-scene actions',()=>{const domain=parse({config_version:'1.0.0',type:'DOMAIN_COLORING',name:'rotate',domainColoring:{formula:'z'},timeline:[animate(0,[action('domainRotate',.25)]),wait(2)]});expect(sceneAtTime(domain.scene,2).settings.rotation).toBeCloseTo(.5);const wrong=parse(surface([animate(1,[action('domainRotate',.25)])]));expect(wrong.warnings.join()).toContain('仅适用于');});
 it('preserves source finish-wait duration as a deadline while scheduling its visual completion',()=>{const result=parse({config_version:'1.0.0',type:'SPIROGRAPH',name:'finish',settings:{layers:[{statorRadius:3,penDistance:1,speed:2,rotors:[{radius:1,mode:'INSIDE'}]}]},timeline:[{type:'spirograph_finish_wait',duration:99}]});const track=result.scene.timeline.tracks[0];expect(track).toMatchObject({duration:99,spirographWait:'visual-or-deadline-v1'});expect(result.scene.timeline.duration).toBe(.1);expect(resolveTimeline(result.scene).duration).toBe(clipDuration(track,result.scene));expect(resolveTimeline(result.scene).duration).toBeLessThan(99);});
 it('rejects malformed arrays, nonfinite expressions and overlong action lists',()=>{expect(()=>parse(surface([animate(1,[{method:'zoom',args:{value:2}}])]))).toThrow('数组');expect(()=>parse(surface([animate(1,[action('zoom','1/0')])]))).toThrow();expect(()=>parse(surface([animate(1,Array.from({length:65},()=>action('stopAmbient')))]))).toThrow('64');expect(()=>parse(surface([wait(86401)]))).toThrow('86400');});
});


it('inherits source edge easing at global, action, and per-parameter levels',()=>{const r=parse(surface([animate(0,[action('paramStart',{edgeEasing:{floor:.4},parameters:{a:{min:-1,max:1,step:.01,edgeEasing:{easing:'QUAD_OUT'}}}})]),wait(2)],{settings:{param_edge_easing:{window:.8,floor:.2,easing:'LINEAR'}}}));expect(r.scene.timeline.tracks[0].actions![0].parameters![0].edgeEasing).toEqual({window:.8,floor:.4,easing:'quad-out'});const bounded=parse(surface([{type:'param',duration:2,parameters:{a:{min:-1,max:1,step:.01}}}]));expect(bounded.scene.timeline.tracks[0].parameterClock).toBe('elapsed');expect(bounded.scene.timeline.tracks[0].parameterAnimations![0].edgeEasing).toEqual({window:.4,floor:.5,easing:'sine-out'});});
