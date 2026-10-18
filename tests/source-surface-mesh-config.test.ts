import {describe,it,expect} from 'vitest';
import {importSourceSurfaceMeshConfig,parseSourceSurfaceMeshConfiguration,SOURCE_SURFACE_MESH_MATERIAL_DEFAULTS,type SourceSurfaceMeshImportFacts} from '../src/engine/sourceSurfaceMeshConfig';
function read(raw:unknown,numberToken?:(path:readonly string[])=>string|undefined):SourceSurfaceMeshImportFacts{const result=importSourceSurfaceMeshConfig(raw,{numberToken});if(!result.ok)throw new Error(JSON.stringify(result.error));return result.value;}
describe('verified JsonSurfaceConfig mesh settings contract',()=>{
 it('distinguishes constructor defaults from an empty settings object',()=>{
  const a=read(undefined),b=read({});expect(a.configuration.points).toMatchObject({uSegments:99,vSegments:99,dotRadius:Math.fround(1.68),lineWeight:1});expect(a.configuration.mesh).toMatchObject({uSegments:60,vSegments:60,lineWeight:1});expect(b.configuration.points).toMatchObject({uSegments:40,vSegments:20,dotRadius:2,lineWeight:Math.fround(1.2)});expect(b.configuration.mesh).toMatchObject({uSegments:40,vSegments:20,lineWeight:Math.fround(1.2)});expect(a.consumedPaths).toEqual([]);expect(b.consumedPaths).toEqual([[]]);
 });
 it('keeps authored point and mesh grids independent, including inactive settings',()=>{
  const {configuration:c}=read({surface_mode:'mEsH',u_segments:7,v_segments:11,mesh_v_segments:23,wireframe_decoupled:false,wireframe_u_segments:8});expect(c.mode).toBe('mesh');expect(c.points).toMatchObject({uSegments:7,vSegments:11});expect(c.mesh).toMatchObject({uSegments:7,vSegments:23,wireframeUSegments:8,wireframeDecoupled:false});
 });
 it('uses untrimmed mode and backend semantics, preserving native GPU identity',()=>{
  expect(read({surface_mode:' MESH ',render_mode:' GPU '}).configuration).toMatchObject({mode:'points',nativeBackend:'cpu'});expect(read({surface_mode:'LINES',render_mode:'gPu'}).configuration).toMatchObject({mode:'points',nativeBackend:'gpu'});expect(read({surface_mode:{},render_mode:'whatever'}).configuration.mode).toBe('points');expect(importSourceSurfaceMeshConfig({render_mode:null})).toMatchObject({ok:false,error:{kind:'input',path:['render_mode']}});
 });
 it.each([null,[],4,'settings'])('rejects malformed present settings %j',raw=>expect(importSourceSurfaceMeshConfig(raw)).toMatchObject({ok:false,error:{kind:'input',path:[]}}));
 it('distinguishes defaulting float getters from expression-capable mesh scalars',()=>{
  const {configuration:c}=read({line_weight:'PI',speed_u:'PI',mesh_line_weight:'PI',mesh_fill_opacity:'missingName',mesh_wrap_threshold:'-3'});expect(c.points.lineWeight).toBe(Math.fround(1.2));expect(c.tracking.speedU).toBe(Math.fround(.3));expect(c.mesh.lineWeight).toBe(Math.fround(Math.PI));expect(c.mesh.fillOpacity).toBe(0);expect(c.mesh.wrapThreshold).toBe(-3);
 });
 it('preserves unclamped authored values for the renderer setters',()=>{
  const c=read({mesh_fill_opacity:2,mesh_line_weight:-1,mesh_wrap_threshold:-2,mesh_u_segments:-3}).configuration;expect(c.mesh).toMatchObject({fillOpacity:2,lineWeight:-1,wrapThreshold:-2,uSegments:-3});expect(parseSourceSurfaceMeshConfiguration(c)).toEqual({ok:true,value:c});
 });
 it('uses native strict point booleans and fallback mesh booleans',()=>{
  expect(importSourceSurfaceMeshConfig({show_trails:' true '})).toMatchObject({ok:false,error:{path:['show_trails']}});expect(read({mesh_fill:' true ',mesh_wireframe:'FALSE',mesh_wrap_u:1}).configuration.mesh).toMatchObject({fillEnabled:true,wireframeEnabled:false,wrapU:false});
 });
 it('uses source Number.intValue with exact lexemes and retains numeric evidence',()=>{
  const f=read({mesh_u_segments:4294967297,mesh_v_segments:4294967297,wireframe_u_segments:'2.0'},path=>path[0]==='mesh_u_segments'?'4294967297':path[0]==='mesh_v_segments'?'4294967297.0':undefined);expect(f.configuration.mesh).toMatchObject({uSegments:1,vSegments:2147483647,wireframeUSegments:0});expect(f.numericPaths).toEqual([['mesh_u_segments'],['mesh_v_segments']]);expect(importSourceSurfaceMeshConfig({mesh_u_segments:4294967297})).toMatchObject({ok:false,error:{kind:'input'}});
 });
 it('parses bounds with empty user parameter scope and retains invalid expressions as source zero',()=>{
  const f=read({u_max:'TWO_PI',v_max:'PI',u_min:'a',v_min:null});expect(f.configuration.domain).toMatchObject({uMax:Math.fround(2*Math.PI),vMax:Math.fround(Math.PI),uMin:0,vMin:0});expect(f.diagnostics.some(x=>x.includes('u_min'))).toBe(true);
 });
 it('keeps raw numeric colors distinct from Java Double.toString color failure',()=>{
  expect(read({mesh_wireframe_color:2},()=> '2').configuration.mesh.wireframeColor).toBe(2);expect(read({mesh_wireframe_color:2},()=> '2.0').configuration.mesh.wireframeColor).toBe(0xffffffff);expect(read({mesh_wireframe_color:'#12345678'}).configuration.mesh.wireframeColor).toBe(0x12345678);expect(read({mesh_wireframe_color:'bad'}).configuration.mesh.wireframeColor).toBe(0xffffffff);expect(importSourceSurfaceMeshConfig({mesh_wireframe_color:2})).toMatchObject({ok:false,error:{kind:'input'}});
 });
 it('rejects source nonfinite values without changing them into defaults',()=>{
  for(const raw of [{dot_size:'NaN'},{speed_v:'Infinity'},{mesh_fill_opacity:'NaN'},{mesh_wrap_threshold:'Infinity'}])expect(importSourceSurfaceMeshConfig(raw)).toMatchObject({ok:false,error:{kind:'nonfinite'}});expect(importSourceSurfaceMeshConfig({mesh_fill_opacity:null})).toMatchObject({ok:false,error:{kind:'input'}});
 });
 it('leaves unparsed material options and point flags unconsumed',()=>{
  const f=read({material_shininess:100,wireframe_curve_samples:42,fade_points:false,record_trails:false});expect(f.consumedPaths).toEqual([]);expect(f.numericPaths).toEqual([]);expect(f.configuration.points.fadePoints).toBe(true);expect(SOURCE_SURFACE_MESH_MATERIAL_DEFAULTS).toMatchObject({materialShininess:32,wireframeCurveSamples:128,materialAmbientColor:0xff4d4d4d});
 });
 it('saved configuration requires all owned fields and forbids unknown or invalid values',()=>{
  const c=read({render_mode:'GPU'}).configuration;expect(parseSourceSurfaceMeshConfiguration(c)).toEqual({ok:true,value:c});expect(parseSourceSurfaceMeshConfiguration({...c,executionBackend:'cpu'})).toMatchObject({ok:false,error:{kind:'input'}});expect(parseSourceSurfaceMeshConfiguration({...c,mesh:{...c.mesh,uSegments:1.5}})).toMatchObject({ok:false,error:{kind:'input'}});expect(parseSourceSurfaceMeshConfiguration({...c,points:{...c.points,fadePoints:false}})).toMatchObject({ok:false,error:{kind:'input'}});const missing={...c} as Record<string,unknown>;delete missing.domain;expect(parseSourceSurfaceMeshConfiguration(missing)).toMatchObject({ok:false});
 });
});
