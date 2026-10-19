import {describe,it,expect} from 'vitest';
import {parseLegacyScene,parseProjectFile} from '../src/engine/legacyImport';
import {createScene,parseScene,serializeScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {SOURCE_BOUNCING_SETTING_NUMBER_FIELDS,parseSourceNumberTokens} from '../src/engine/sourceNumberTokens';
import {generateSourceBouncingSeeds} from '../src/engine/sourceBouncingSeeds';
const F=Math.fround;
const raw=(extra:Record<string,unknown>={})=>({config_version:'1.0.0',type:'BOUNCING_PARTICLES',name:'Native bouncing',...extra});
const imported=(extra:Record<string,unknown>={})=>parseLegacyScene(JSON.stringify(raw(extra)));
const publicImport=(extra:Record<string,unknown>={})=>parseProjectFile(JSON.stringify(raw(extra))).scene;

describe('native Bouncing public import owner',()=>{
 it('selects source defaults before local settings/parameters/equations/timeline interpretation',()=>{
  const source=raw({parameters:{constructor:{bad:true}},equations:false,annotations:'bad',formula_annotations:{bad:'('},timeline:{duration:'1/0'},animations:[{what:'unknown'}],camera:{phi:'1/0'},polygon:'unread without settings'});
  const r=parseLegacyScene(JSON.stringify(source));expect(r.source).toEqual(source);
  expect(r.scene.bouncingSource).toMatchObject({configuration:{particleCount:200000,seed:'1',settingsPresence:'absent'},visual:{settingsPresence:'absent'},camera:{phi:0,theta:0,gamma:0},recordDuration:10});
  expect(r.scene.settings).toEqual({});expect(r.scene.parameters).toEqual({});expect(r.scene.equations).toEqual({});expect(r.scene.sourceCamera).toBeUndefined();
  expect(r.scene.timeline).toEqual({duration:10,fps:30,loop:false,tracks:[]});
  for(const field of ['parameters.constructor.bad','equations','annotations','formula_annotations.bad','timeline.duration','animations.0.what','camera.phi','polygon'])expect(r.warnings.join()).toContain(field);
 });
 it('ignores even malformed queues/annotations/parameter containers and retains them through save/reopen',()=>{
  for(const ignored of [null,false,5,'not an array',{duration:null},[{type:'animate',duration:-1,actions:[{method:'track',args:null}]}]]){
   const scene=publicImport({settings:{particle_count:3},parameters:ignored,timeline:ignored,animations:ignored,annotations:ignored});
   const reopened=parseScene(serializeScene(scene));expect(reopened.timeline).toEqual({duration:10,fps:30,loop:false,tracks:[]});
   expect(reopened.provenance?.original).toEqual(raw({settings:{particle_count:3},parameters:ignored,timeline:ignored,animations:ignored,annotations:ignored}));
  }
 });
 it('consumes only exact native settings spelling, without old aliases or local CPU/history remapping',()=>{
  const source=raw({settings:{particleCount:99,particle_count:7,circleRadius:5,boundary_radius:2,render_mode:'CPU',show_boundary:false,show_trails:true,trail_lifetime:4,time_step:.02,sub_steps:4,particle_radius:.1,initial_position_mode:'FORMULA',shape_formula:'Math.sin(10*x)>0.5',shape_fill_mode:'OUTLINE',shape_line_width:.02}});
  const r=parseLegacyScene(JSON.stringify(source));expect(r.scene.bouncingSource?.configuration).toMatchObject({particleCount:7,circleRadius:F(.95),timeStep:F(.02),subSteps:4,particleRadius:F(.1),initialPositionMode:'FORMULA',shapeFormula:'Math.sin(10*x)>0.5',shapeFillMode:'OUTLINE',shapeLineWidth:F(.02)});
  for(const key of ['particleCount','circleRadius','boundary_radius','render_mode','show_boundary','show_trails','trail_lifetime'])expect(r.warnings.join()).toContain('settings.'+key);
  expect(r.scene.settings).toEqual({});expect(r.source).toEqual(source);
 });
 it('preserves large requested counts and canonical shape/display facts without geometry generation or local caps',()=>{
  for(const particle_count of [2_000_000,5_000_000])expect(imported({settings:{particle_count}}).scene.bouncingSource?.configuration.particleCount).toBe(particle_count);
  const r=imported({settings:{particle_count:1,initial_position_mode:'STAR',initial_circle_radius:0,initial_circle_center_x:2,initial_circle_center_y:3,circle_center_x:4,circle_center_y:5,boundary_center_x:6,boundary_center_y:7,shape_num_points:7,shape_lissajous_delta:1.5,velocity_center_x:8,shape_fill_mode:'OUTLINE',boundary_color:'#12aBcD',dot_size:8,particle_radius:.1}});
  expect(r.scene.bouncingSource?.configuration).toMatchObject({initialPositionMode:'STAR',initialCircleRadius:0,initialCircleCenterX:2,initialCircleCenterY:3,circleCenterX:4,circleCenterY:5,boundaryCenterX:6,boundaryCenterY:7,shapeNumPoints:7,shapeLissajousDelta:1.5,velocityCenterX:8,shapeFillMode:'OUTLINE',particleRadius:F(.1)});
  expect(r.scene.bouncingSource?.visual).toMatchObject({boundaryColor:'#12aBcD',dotSize:8});
  expect(imported({settings:{initial_position_mode:'ARCHIMEDEAN_SPIRAL'}}).scene.bouncingSource?.configuration.initialPositionMode).toBe('ARCHIMEDEAN_SPIRAL');
 });
 it('uses source empty scope and record clamp, independently from the local browse range',()=>{
  for(const value of [-5,0,.05,'p*30',true,[]])expect(imported({settings:{record_duration:value},parameters:{p:2}}).scene.bouncingSource?.recordDuration).toBe(F(.1));
  expect(imported({settings:{record_duration:null}}).scene.bouncingSource?.recordDuration).toBe(10);
  expect(imported({settings:{record_duration:3601}}).scene.bouncingSource?.recordDuration).toBe(3601);
  expect(()=>imported({settings:{record_duration:'1/0'}})).toThrow(/record_duration/);
  expect(imported({settings:{record_duration:3601}}).scene.timeline.duration).toBe(10);
 });
 it('keeps signed64 integer lexemes, signed zero and source color-number classes across public save/reopen',()=>{
  const text='{"config_version":"1.0","type":"BOUNCING_PARTICLES","name":"Exact", "settings":{"seed":9223372036854775807,"particle_count":3,"offset_x":-0,"boundary_color":123456,"record_duration":1e1},"camera":{"phi":-0,"theta":0.25},"resolution":{"width":640.0,"height":480},"polygon":[[-0,0],[1,0],[0,1]]}';
  const scene=parseProjectFile(text).scene,p=scene.bouncingSource!;
  expect(p.configuration.seed).toBe('9223372036854775807');expect(Object.is(p.configuration.polygonVertices[0],-0)).toBe(true);expect(Object.is(p.visual.transform.offsetX,-0)).toBe(true);expect(Object.is(p.camera.phi,-0)).toBe(true);
  expect(scene.projectResolution).toEqual({width:640,height:480});
  const tokens=scene.provenance!.sourceNumberTokens!;expect(tokens).toContainEqual({path:['settings','seed'],token:'9223372036854775807'});expect(tokens).toContainEqual({path:['settings','boundary_color'],token:'123456'});expect(tokens).toContainEqual({path:['polygon','0','0'],token:'-0'});expect(tokens).toContainEqual({path:['resolution','width'],token:'640.0'});
  const reopened=parseScene(serializeScene(scene));expect(reopened.bouncingSource).toEqual(p);expect(reopened.provenance?.sourceNumberTokens).toEqual(tokens);expect(Object.is(reopened.bouncingSource!.camera.phi,-0)).toBe(true);expect(Object.is((reopened.provenance!.original as {camera:{phi:number}}).camera.phi,-0)).toBe(true);
  expect(()=>parseProjectFile(text.replace('"boundary_color":123456','"boundary_color":123456.0'))).toThrow(/java-double-format/);
  const minimum=parseProjectFile(text.replace('9223372036854775807','-9223372036854775808')).scene;expect(minimum.bouncingSource?.configuration.seed).toBe('-9223372036854775808');
 });
 it('registers every numeric source getter and only selected first64 polygon entries',()=>{
  const settings=Object.fromEntries(SOURCE_BOUNCING_SETTING_NUMBER_FIELDS.map(key=>[key,1]));
  const polygon=Array.from({length:65},(_,i)=>i%2?[i,2]:{x:i,y:2});
  const r=imported({settings:{...settings,polygon:[[-1,-1],[1,-1],[0,1]]},polygon,camera:{phi:1,theta:2,gamma:3}});
  const tokens=r.sourceNumberTokens!;for(const key of SOURCE_BOUNCING_SETTING_NUMBER_FIELDS)expect(tokens).toContainEqual({path:['settings',key],token:'1'});
  expect(tokens.filter(t=>t.path[0]==='polygon')).toHaveLength(128);expect(tokens.some(t=>t.path.join('.').startsWith('settings.polygon'))).toBe(false);expect(tokens.some(t=>t.path[1]==='64')).toBe(false);
  expect(parseSourceNumberTokens(tokens,'bouncing')).toEqual(tokens);
  const fallback=publicImport({settings:{polygon:[[-1,-1],[1,-1],[0,1]]}});expect(fallback.bouncingSource?.configuration.polygonSource).toBe('settings');expect(parseScene(serializeScene(fallback)).provenance?.sourceNumberTokens).toContainEqual({path:['settings','polygon','0','0'],token:'-1'});
 });
 it('rejects malformed owned settings/camera/polygon and duplicate JSONObject members while ignoring absent-setting camera',()=>{
  for(const settings of [null,false,[],3])expect(()=>imported({settings})).toThrow(/settings/);
  expect(()=>imported({settings:{},camera:null})).toThrow(/camera/);expect(()=>imported({settings:{},polygon:null})).toThrow(/polygon/);
  expect(()=>parseLegacyScene('{"config_version":"1.0","type":"BOUNCING_PARTICLES","name":"d","parameters":{"x":1,"x":2}}')).toThrow();
  expect(imported({camera:null}).scene.bouncingSource?.camera).toEqual({phi:0,theta:0,gamma:0});
 });
 it('produces true zero-radius/zero-speed seeds from imported canonical source facts',()=>{
  const p=imported({settings:{initial_circle_radius:0,particle_count:3,container_shape:'CIRCLE',circle_radius:1,initial_position_mode:'STAR',initial_speed:0}}).scene.bouncingSource!;
  const seeds=generateSourceBouncingSeeds(p.configuration);expect(seeds.ok).toBe(true);if(!seeds.ok)throw Error(seeds.error.reason);expect(seeds.value.state).toHaveLength(12);expect([...seeds.value.state].every(x=>x===0)).toBe(true);
 });
 it('keeps old local saved documents local even if provenance contains native Bouncing',()=>{
  const local=createScene(definition('bouncing'));local.settings.count=1800;local.provenance={kind:'MathArt Studio',original:raw({settings:{particle_count:200000}}),warnings:[]};
  const reopened=parseProjectFile(serializeScene(local));expect(reopened.format).toBe('local');expect(reopened.scene.bouncingSource).toBeUndefined();expect(reopened.scene.settings.count).toBe(1800);
 });
});

describe('Bouncing persisted numeric token boundary',()=>{
 it('rejects unknown aliases/inert fields, invalid indices, duplicate coordinates and mixed polygon ownership',()=>{
  const token=(path:unknown[])=>({path,token:'-0'});
  for(const path of [['settings','particleCount'],['settings','render_mode'],['settings','trail_lifetime'],['timeline','0','duration'],['parameters','x'],['camera','zoom'],['polygon','64','0'],['polygon','00','0'],['polygon','0',0],['settings','polygon','0','z']])expect(()=>parseSourceNumberTokens([token(path)],'bouncing')).toThrow();
  for(const paths of [[['polygon','0','x'],['polygon','0','0']],[['polygon','0','0'],['settings','polygon','1','1']],[['settings','seed'],['settings','seed']]])expect(()=>parseSourceNumberTokens(paths.map(token),'bouncing')).toThrow();
  expect(()=>parseSourceNumberTokens([{path:['settings','seed'],token:'01'}],'bouncing')).toThrow();
 });
});
