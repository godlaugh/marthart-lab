import {describe,it,expect} from 'vitest';
import {parseProjectFile} from '../src/engine/legacyImport';
import {parseScene,serializeScene} from '../src/engine/document';
import {usesSourceSurfaceHost,usesSourceSurfaceParticles} from '../src/engine/sourceSurfaceIdentity';
import {parseSourceNumberTokens} from '../src/engine/sourceNumberTokens';

const source=(settings:Record<string,unknown>={},timeline:unknown[]=[])=>({config_version:'1.0.0',type:'SURFACE',name:'Native CPU mesh',parameters:{a:2},equations:{x:'u+a',y:'v',z:'u+v'},settings:{surface_mode:'MESH',render_mode:'CPU',mesh_u_segments:3,mesh_v_segments:4,...settings},timeline});
const read=(settings:Record<string,unknown>={},timeline:unknown[]=[])=>parseProjectFile(JSON.stringify(source(settings,timeline))).scene;

describe('public original CPU mesh import and saved document boundary',()=>{
 it('selects source mesh without a timeline and preserves one editable configuration through reopening',()=>{
  const raw=source({mesh_fill_opacity:1.5,scale_x:7,offset_z:-2,mesh_wrap_u:true,mesh_line_weight:-2});
  const scene=parseProjectFile(JSON.stringify(raw)).scene;
  expect(usesSourceSurfaceHost(scene)).toBe(true);expect(usesSourceSurfaceParticles(scene)).toBe(false);
  expect(scene.surfaceSource).toMatchObject({mode:'mesh',nativeBackend:'cpu',mesh:{uSegments:3,vSegments:4,fillOpacity:1.5,lineWeight:-2,wrapU:true},transform:{scaleX:7,offsetZ:-2}});
  expect(scene.settings).toMatchObject({surfaceGeometryVersion:'mathart-1.7.8-surface-v1',renderMode:'mesh',computeBackend:'cpu',opacity:1,scale:1,rotateX:0,rotateY:0,rotateZ:0});
  expect(scene.settings.scaleX).not.toBe(7);expect(scene.settings.offsetZ).not.toBe(-2);
  expect(scene.provenance!.original).toEqual(raw);
  const reopened=parseScene(serializeScene(scene));expect(reopened.surfaceSource).toEqual(scene.surfaceSource);expect(reopened.surfaceSourcePalette).toEqual(scene.surfaceSourcePalette);expect(reopened.sourceCamera).toEqual(scene.sourceCamera);
 });
 it('uses source settings defaults and mesh fallback counts, accepting one sample without clamping to two',()=>{
  const raw=source();delete (raw.settings as Record<string,unknown>).mesh_u_segments;delete (raw.settings as Record<string,unknown>).mesh_v_segments;
  const scene=parseProjectFile(JSON.stringify(raw)).scene;
  expect(scene.surfaceSource).toMatchObject({settingsPresence:'object',points:{uSegments:40,vSegments:20},mesh:{uSegments:40,vSegments:20,fillOpacity:Math.fround(.9),lineWeight:Math.fround(1.2)},transform:{scaleX:55,scaleY:55,scaleZ:55}});
  expect(read({u_segments:7,v_segments:8,mesh_u_segments:1}).surfaceSource!.mesh).toMatchObject({uSegments:1,vSegments:4});
 });
 it('preserves original mode/backend spelling, source numeric lexemes, and fallback diagnostics',()=>{
  const raw=source({surface_mode:'mesh',render_mode:'cpu',mesh_fill_opacity:.5,mesh_wireframe_color:255,background_color:1,mesh_wrap_u:7,wireframe_u_segments:0});
  const text=JSON.stringify(raw).replace('"mesh_u_segments":3','"mesh_u_segments":3e0').replace('"mesh_fill_opacity":0.5','"mesh_fill_opacity":5e-1').replace('"mesh_wireframe_color":255','"mesh_wireframe_color":255.0').replace('"background_color":1','"background_color":1.00');
  const imported=parseProjectFile(text),scene=parseScene(serializeScene(imported.scene));
  expect(scene.provenance!.original).toEqual(raw);expect(scene.provenance!.sourceNumberTokens).toEqual(expect.arrayContaining([
   {path:['settings','mesh_u_segments'],token:'3e0'},{path:['settings','mesh_fill_opacity'],token:'5e-1'},
   {path:['settings','mesh_wireframe_color'],token:'255.0'},{path:['settings','background_color'],token:'1.00'},
   {path:['settings','mesh_wrap_u'],token:'7'},
  ]));
  expect(scene.surfaceSource!.mesh.wrapU).toBe(false);expect(imported.warnings.some(w=>w.includes('mesh_wrap_u'))).toBe(true);
 });
 it('keeps source scalar conversion and settings scope separate from custom parameters',()=>{
  const scene=read({u_max:'a',mesh_fill_opacity:'a',mesh_line_weight:'2*3',scale_x:'invalid'});
  expect(scene.surfaceSource).toMatchObject({domain:{uMax:0},mesh:{fillOpacity:0,lineWeight:6},transform:{scaleX:55}});
 });
 it('admits source parameter, gradient and instant trails actions without substituting local actions',()=>{
  const scene=read({},[{type:'animate',duration:.25,actions:[{method:'paramStart',args:{parameters:{a:{min:1,max:3,step:.1}}}},{method:'gradientStart',args:[{mode:'HUE_ROTATE'}]},{method:'track',args:[2]}]},{type:'trails',enable:false},{type:'param',duration:.25,parameters:{a:3}}]);
  expect(scene.timeline.tracks[0].actions![0].surfaceParameters).toHaveLength(1);
  expect(scene.timeline.tracks[0].actions![0].parameters).toBeUndefined();
  expect(scene.timeline.tracks[0].actions![1].gradient).toBeDefined();
  expect(scene.timeline.tracks[1]).toMatchObject({type:'trails',duration:0,trailsEnabled:false});
  expect(scene.timeline.tracks[2].surfaceParameterClip).toBeDefined();
  expect(parseScene(serializeScene(scene)).timeline).toEqual(scene.timeline);
 });
 it.each([-1,0,513])('rejects active mesh count %s instead of replacing or clamping it',mesh_u_segments=>{
  expect(()=>read({mesh_u_segments})).toThrow(/1–512|采样数/);
 });
 it('retains inactive negative point counts and accepted negative wire counts as source facts',()=>{
  const scene=read({u_segments:-9,wireframe_u_segments:-5,wireframe_v_segments:-4});
  expect(scene.surfaceSource!.points.uSegments).toBe(-9);expect(scene.surfaceSource!.mesh.wireframeUSegments).toBe(-5);
  expect(parseScene(serializeScene(scene)).surfaceSource).toEqual(scene.surfaceSource);
 });
 it('rejects nonfinite scalars, malformed backend and unsupported GPU',()=>{
  expect(()=>read({render_mode:3})).toThrow('render_mode');
  expect(()=>read({render_mode:'GPU'})).toThrow('GPU');
  expect(()=>read({mesh_fill_opacity:'1e999'})).toThrow();
  expect(read({},[{type:'surface_mode_transition',duration:1,to:'POINTS'}]).timeline.tracks[0]).toMatchObject({type:'surface_mode_transition',surfaceMode:'points'});
  const scene=read({},[{enabled:false,type:'surface_mode_transition',duration:{bad:true}}]);expect(scene.timeline.tracks).toHaveLength(0);
 });
 it('rejects missing or mismatched saved source mesh configuration and palette',()=>{
  const original=read();
  for(const mutate of [
   (s:typeof original)=>{delete s.surfaceSource;},
   (s:typeof original)=>{delete s.surfaceSourcePalette;},
   (s:typeof original)=>{(s.surfaceSource as unknown as {mode:string}).mode='unknown';},
   (s:typeof original)=>{s.surfaceSource!.nativeBackend='gpu';},
   (s:typeof original)=>{s.settings.surfaceGeometryVersion='mathart-1.7.8-points-v1';},
   (s:typeof original)=>{s.settings.computeBackend='webgl2';},
   (s:typeof original)=>{s.surfaceSource!.mesh.uSegments=0;},
  ]){const scene=structuredClone(original);mutate(scene);expect(()=>parseScene(serializeScene(scene))).toThrow();}
 });
 it('keeps only registered numeric evidence paths',()=>{
  expect(parseSourceNumberTokens([{path:['settings','mesh_fill_opacity'],token:'-0'}],'surface')).toEqual([{path:['settings','mesh_fill_opacity'],token:'-0'}]);
  expect(()=>parseSourceNumberTokens([{path:['settings','unrelated_mesh'],token:'1'}],'surface')).toThrow();
  expect(()=>parseSourceNumberTokens([{path:['settings','mesh_fill_opacity'],token:'1'}],'attractor')).toThrow();
 });
 it('does not upgrade existing point scenes or change their source defaults',()=>{
  const local=read({surface_mode:'POINTS'});expect(usesSourceSurfaceHost(local)).toBe(false);expect(local.surfaceSource).toBeUndefined();expect(usesSourceSurfaceParticles(local)).toBe(false);
  const native=read({surface_mode:'POINTS'},[{type:'animate',duration:.25,actions:[{method:'track',args:[1]}]}]);
  expect(usesSourceSurfaceParticles(native)).toBe(true);expect(native.surfaceSource).toBeUndefined();expect(native.settings.uSegments).toBe(40);
 });
});
