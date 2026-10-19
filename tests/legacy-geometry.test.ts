import {describe,it,expect} from 'vitest';
import {parseLegacyScene} from '../src/engine/legacyImport';
import {generateScene} from '../src/engine/temporal';
const parse=(type:string,extra:Record<string,unknown>)=>parseLegacyScene(JSON.stringify({config_version:'1.0.0',type,name:'geometry import',parameters:{},...extra}));
const context={time:1,width:32,height:24,quality:'preview' as const,sourceViewport:{logicalWidth:32,logicalHeight:24,referenceLogicalHeight:24,target:'primary' as const,projectionPass:'perspective' as const}};
describe('legacy continuous geometry import',()=>{
 it('maps CPU surface trail settings to real historical segments without changing source data',()=>{
  const input={equations:{x:'u+t',y:'v',z:'0'},settings:{surface_mode:'POINTS',u_segments:2,v_segments:2,show_trails:true,fade_trails:true,trail_lifetime:.5,periodic_u:false,periodic_v:false,speed_u:'0',speed_v:'0'}};
  const result=parse('SURFACE',input),out=generateScene(result.scene,context);
  expect(result.scene.settings).toMatchObject({showTrails:true,fadeTrails:true,trailLifetime:.5});expect(out.type).toBe('geometry');if(out.type==='geometry'){expect(out.trails!.indices!.length).toBe(120);expect(out.trails!.alphas[0]).toBe(0);}
  expect(result.warnings.join()).not.toContain('不模拟随帧衰减');expect((result.source as any).settings).toEqual(input.settings);
 });
 it('keeps independent initialization bounds, dt range, substeps, stagger and actual particle counts',()=>{
  const result=parse('ATTRACTOR',{equations:{dx:'1',dy:'0',dz:'0'},timeline:[{type:'wait',duration:2}],settings:{particle_count:300,time_step_min:.01,time_step_max:.02,sub_steps:2,show_trails:true,fade_trails:true,trail_lifetime:.5},initialization:{mode:'RANDOM_BOX',warmup_steps:0,warmup_stagger_min:0,warmup_stagger_max:0,bounds:{min_x:0,max_x:0,min_y:2,max_y:2,min_z:3,max_z:3}}});
  expect(result.scene.attractorSource!.configuration).toMatchObject({particleCountCPU:300,dtRange:{min:Math.fround(.01),max:Math.fround(.02)},stepsPerFrame:2,bounds:{minX:0,maxX:0,minY:2,maxY:2}});
  const out=generateScene(result.scene,context);if(out.type!=='geometry')throw new Error('geometry');expect(out.particleIds).toHaveLength(300);expect(out.positions[0]).toBeGreaterThanOrEqual(.6);expect(out.positions[0]).toBeLessThanOrEqual(1.25);expect(out.positions[1]).toBe(2);expect(out.positions[2]).toBe(3);expect(out.trails!.indices!.length).toBeGreaterThan(9000);
  expect(result.warnings.join()).not.toContain('统一最大半径');expect(result.warnings.join()).not.toContain('所有轨迹使用');
 });
 it('keeps source temporal coercion/defaults while rejecting malformed native sections',()=>{
  const result=parse('ATTRACTOR',{equations:{dx:'1',dy:'0',dz:'0'},settings:{trail_lifetime:0,time_step_min:.1,time_step_max:.01,sub_steps:1.2},initialization:{bounds:{min_x:0}}});
  expect(result.scene.attractorSource!.configuration).toMatchObject({stepsPerFrame:1,dtRange:{min:Math.fround(.01),max:Math.fround(.1)},bounds:{minX:0,maxX:1,minY:-1,maxY:1}});
  expect(result.scene.attractorSource!.visual.trails.lifetime).toBe(0);
  for(const extra of [{settings:null},{initialization:[]},{settings:{show_trails:17}}])expect(()=>parse('ATTRACTOR',{equations:{dx:'1',dy:'0',dz:'0'},...extra})).toThrow();
 });
 it('imports independent source wire intervals as formula-sampled line counts',()=>{
  const result=parse('SURFACE',{equations:{x:'u',y:'v',z:'u*v'},settings:{surface_mode:'MESH',mesh_u_segments:2,mesh_v_segments:2,mesh_wireframe:true,wireframe_decoupled:true,wireframe_u_segments:4,wireframe_v_segments:0,mesh_line_weight:3,u_min:0,u_max:1,v_min:0,v_max:1}});
  expect(result.scene.surfaceSource!.mesh).toMatchObject({wireframeDecoupled:true,wireframeUSegments:4,wireframeVSegments:0,lineWeight:3});
  const output=generateScene(result.scene,context);if(output.type!=='geometry')throw new Error();expect(output.sourceMeshWireframe!.mode).toBe('decoupled');expect(output.sourceMeshWireframe!.positions.length/6).toBe(5*128);
  expect(result.scene.surfaceSource!.mesh.wireframeUSegments).toBe(4);expect(result.warnings.join()).not.toMatch(/尚未映射[^。]*wireframe/);
 });
 it('preserves the source zero-zero fallback to coupled grid edges',()=>{
  const result=parse('SURFACE',{equations:{x:'u',y:'v',z:'0'},settings:{surface_mode:'MESH',mesh_wireframe:true,wireframe_decoupled:true,wireframe_u_segments:0,wireframe_v_segments:0}});
  expect(result.scene.surfaceSource!.mesh.wireframeDecoupled).toBe(true);const out=generateScene(result.scene,context);if(out.type!=='geometry')throw Error('geometry');expect(out.sourceMeshWireframe!.mode).toBe('coupled');
 });

});
