import {describe,it,expect} from 'vitest';
import {importSourceBouncingConfig,parseSourceBouncingConfiguration,SOURCE_BOUNCING_MODEL,SOURCE_BOUNCING_POSITION_MODES,type SourceBouncingImportOptions} from '../src/engine/sourceBouncingConfig';
const F=Math.fround;
function imported(raw:unknown={},options:SourceBouncingImportOptions={}){const r=importSourceBouncingConfig(raw,options);if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;}
const settings=(value:Record<string,unknown>)=>imported({settings:value}).configuration;

describe('source Bouncing initialization configuration',()=>{
 it('retains exact Base defaults and section absence without consuming root polygon or camera',()=>{
  const result=imported({polygon:'invalid but unread',camera:5}),c=result.configuration;
  expect(c).toMatchObject({model:SOURCE_BOUNCING_MODEL,settingsPresence:'absent',polygonSource:'default',particleCount:200000,seed:'1',subSteps:2,timeStep:F(.012),particleRadius:F(.006),containerShape:'POLYGON',circleRadius:F(.95),ellipseSemiMajorAxis:F(.95),ellipseSemiMinorAxis:F(.55),initialPositionMode:'BOX',initialVelocityMode:'UNIFORM',initialSpeed:1,initialAngle:F(Math.PI/2),shapeFillMode:'FILL',shapeFormula:'',shapeNumTurns:5.5});
  expect(c.polygonVertices).toEqual([-.95,-.5,-.38,-.88,.75,-.65,.95,.25,.28,.82,-.82,.58].map(F));
  expect(c.initialXMin).toBe(F(-.45));expect(c.shapeInnerRatio).toBe(F(.62));expect(c.shapeTightness).toBe(F(.16));expect(c.shapeLineWidth).toBe(F(.02));
  expect(result.consumedPaths).toEqual([]);expect(imported(null).configuration).toEqual(c);
  expect(imported({settings:{}}).configuration).toEqual({...c,settingsPresence:'object'});
  for(const invalid of [null,[],false,5,'x'])expect(importSourceBouncingConfig({settings:invalid})).toMatchObject({ok:false,error:{kind:'input',path:['settings']}});
 });
 it('uses JSONObject integer getters without evaluating expressions, and preserves Java numeric narrowing',()=>{
  expect(settings({particle_count:-9,sub_steps:20,shape_num_points:1,shape_lissajous_a:0,shape_lissajous_b:-5,shape_rose_k:0,shape_k:0})).toMatchObject({particleCount:1,subSteps:16,shapeNumPoints:3,shapeLissajousA:1,shapeLissajousB:1,shapeRoseK:1,shapeK:2});
  expect(settings({particle_count:'2^10',sub_steps:'3.5',shape_num_points:null})).toMatchObject({particleCount:200000,subSteps:2,shapeNumPoints:5});
  const token=(key:string,value:number,text:string)=>imported({settings:{[key]:value}},{numberToken:path=>path[1]===key?text:undefined}).configuration;
  expect(token('particle_count',4294967297,'4294967297').particleCount).toBe(1);
  expect(token('particle_count',4294967297,'4294967297.0').particleCount).toBe(2147483647);
  expect(token('sub_steps',3.9,'3.9').subSteps).toBe(3);
  expect(importSourceBouncingConfig({settings:{sub_steps:3.9}})).toMatchObject({ok:false,error:{kind:'input',path:['settings','sub_steps']}});
 });
 it('uses ConfigUtils empty-scope expressions and native clamps, not scene parameters or Attractor nonfinite recovery',()=>{
  const c=settings({time_step:'1/100',particle_radius:-1,circle_radius:20,ellipse_semi_major_axis:0,ellipse_semi_minor_axis:'1/0',initial_circle_radius:-5,initial_speed:500,velocity_noise:2,initial_angle_spread:10,shape_inner_ratio:-1,shape_tightness:3,shape_num_turns:-2,shape_line_width:0,shape_superellipse_n:0,initial_angle:'PI/4'});
  expect(c).toMatchObject({timeStep:F(.01),particleRadius:0,circleRadius:10,ellipseSemiMajorAxis:F(.001),ellipseSemiMinorAxis:10,initialCircleRadius:0,initialSpeed:100,velocityNoise:1,initialAngleSpread:F(2*Math.PI),shapeInnerRatio:0,shapeTightness:1,shapeNumTurns:F(.1),shapeLineWidth:F(.001),shapeSuperellipseN:F(.01),initialAngle:F(Math.PI/4)});
  expect(settings({time_step:'-1/0',particle_radius:'1/0'})).toMatchObject({timeStep:F(.0001),particleRadius:F(.25)});
  const fallback=imported({parameters:{speed:2},settings:{initial_speed:'speed',time_step:'garbage'}});expect(fallback.configuration.initialSpeed).toBe(0);expect(fallback.configuration.timeStep).toBe(F(.0001));expect(fallback.diagnostics).toHaveLength(2);
  expect(importSourceBouncingConfig({settings:{time_step:'0/0'}})).toMatchObject({ok:false,error:{kind:'nonfinite'}});
  expect(importSourceBouncingConfig({settings:{initial_angle:'1/0'}})).toMatchObject({ok:false,error:{kind:'nonfinite'}});
 });
 it('normalizes enums with Java trim, retains accepted unmatched factory mode, and does not trim fill mode',()=>{
  expect(settings({container_shape:' circle ',initial_position_mode:' archimedean_spiral ',initial_velocity_mode:' tangential_ccw ',shape_fill_mode:'outline'})).toMatchObject({containerShape:'CIRCLE',initialPositionMode:'ARCHIMEDEAN_SPIRAL',initialVelocityMode:'TANGENTIAL_CCW',shapeFillMode:'OUTLINE'});
  expect(settings({container_shape:'\u00a0CIRCLE\u00a0',initial_position_mode:'unknown',initial_velocity_mode:'x',shape_fill_mode:' OUTLINE '})).toMatchObject({containerShape:'POLYGON',initialPositionMode:'BOX',initialVelocityMode:'UNIFORM',shapeFillMode:'FILL'});
  // Constructor PC789 invokes Java equalsIgnoreCase, not uppercase + equality.
  for(const shape_fill_mode of ['outlİne','outlıne'])expect(settings({shape_fill_mode}).shapeFillMode).toBe('OUTLINE');
  for(const mode of SOURCE_BOUNCING_POSITION_MODES)expect(settings({initial_position_mode:mode}).initialPositionMode).toBe(mode);
 });
 it('keeps circle and boundary centers separate, and normalizes both initial bound pairs',()=>{
  const c=settings({circle_center_x:9,circle_center_y:8,boundary_center_x:2,boundary_center_y:3,x0_min:7,x0_max:-1,y0_min:8,y0_max:-2});
  expect(c).toMatchObject({circleCenterX:9,circleCenterY:8,boundaryCenterX:2,boundaryCenterY:3,initialXMin:-1,initialXMax:7,initialYMin:-2,initialYMax:8});
 });
 it('reads seed strictly and preserves complete signed64 bits with authoritative JSON numeric tokens',()=>{
  for(const seed of ['9223372036854775807','-9223372036854775808','+00012','１２'])expect(settings({seed}).seed).toBe(seed==='１２'?'12':BigInt(seed).toString());
  for(const seed of [null,true,'1/2',' 1 ','9223372036854775808'])expect(importSourceBouncingConfig({settings:{seed}})).toMatchObject({ok:false,error:{kind:'input',path:['settings','seed']}});
  const raw=Number('9223372036854775807');expect(importSourceBouncingConfig({settings:{seed:raw}}).ok).toBe(false);
  expect(imported({settings:{seed:raw}},{numberToken:()=> '9223372036854775807'}).configuration.seed).toBe('9223372036854775807');
  expect(imported({settings:{seed:2.9}},{numberToken:()=> '2.9'}).configuration.seed).toBe('2');
 });
 it('selects root polygon before settings and preserves fallback without interpreting losing input',()=>{
  const defaults=imported().configuration.polygonVertices;
  // JSONObject.NULL is not Java null: getJSONArray throws before parsePolygon.
  expect(importSourceBouncingConfig({settings:{polygon:[[0,0],[1,0],[0,1]]},polygon:null})).toMatchObject({ok:false,error:{kind:'input',path:['polygon']}});
  expect(importSourceBouncingConfig({settings:{polygon:null}})).toMatchObject({ok:false,error:{kind:'input',path:['settings','polygon']}});
  expect(imported({settings:{polygon:'invalid losing field'},polygon:[]}).configuration).toMatchObject({polygonSource:'root',polygonVertices:defaults});
  expect(imported({settings:{polygon:[[0,0],[1,0],[0,1]]},polygon:[[5,6]]}).configuration).toMatchObject({polygonSource:'root',polygonVertices:defaults});
  expect(imported({settings:{polygon:[[0,0],[1,0],[0,1]]}}).configuration).toMatchObject({polygonSource:'settings',polygonVertices:[0,0,1,0,0,1]});
  expect(importSourceBouncingConfig({settings:{},polygon:{bad:1}})).toMatchObject({ok:false,error:{path:['polygon']}});
 });
 it('matches array strict getFloat versus object default getFloat and first64 input-entry cap',()=>{
  const r=imported({settings:{},polygon:[['0x1.8p0','2'],{x:'PI',y:'3'},[],false,{x:null,y:4},[8,9,10]]});
  expect(r.configuration.polygonVertices).toEqual([1.5,2,0,3,0,4,8,9]);expect(r.numericPaths).toContainEqual(['polygon','5','0']);
  expect(importSourceBouncingConfig({settings:{},polygon:[[0,0],['PI',0],[0,1]]})).toMatchObject({ok:false,error:{kind:'input',path:['polygon','1','0']}});
  const entries=[...Array(62).fill(false),[0,0],[1,0],[0,1]];expect(imported({settings:{},polygon:entries}).configuration.polygonVertices).toEqual(imported().configuration.polygonVertices);
  expect(imported({settings:{},polygon:Array.from({length:65},(_,i)=>[i,i+1])}).configuration.polygonVertices).toHaveLength(128);
 });
 it('retains scalar/seed consumption order and leaves unrelated visual fields to their owner',()=>{
  const r=imported({palette:['bad'],settings:{particle_count:7,initial_angle:'PI',seed:'2',shape_tightness:.4,shape_fill_mode:'FILL',shape_formula:'x>0',background_color:'#FFF',dot_size:5},camera:{phi:'bad'}});
  expect(r.consumedPaths).toEqual(['particle_count','initial_angle','seed','shape_tightness','shape_fill_mode','shape_formula'].map(key=>['settings',key]));
  expect(r.numericPaths).toEqual([['settings','particle_count'],['settings','shape_tightness']]);expect(r.configuration.shapeFormula).toBe('x>0');
 });
 it('strictly parses detached canonical finite facts and normalizes signed64 text for RNG consumers',()=>{
  const original=settings({seed:'1'}),r=parseSourceBouncingConfiguration({...original,seed:'１２'});expect(r.ok).toBe(true);if(!r.ok)throw Error('parse');expect(r.value.seed).toBe('12');
  original.polygonVertices[0]=999;expect(r.value.polygonVertices[0]).toBe(F(-.95));
  for(const bad of [{...original,extra:1},{...original,model:'local-v1'},{...original,seed:1},{...original,timeStep:NaN},{...original,timeStep:0},{...original,particleCount:0},{...original,subSteps:17},{...original,initialXMin:99},{...original,polygonVertices:[0,0]},{...original,polygonVertices:[0,0,1,1,2,Infinity]},{...original,shapeFormula:null},{...original,settingsPresence:'absent',polygonSource:'root'}])expect(parseSourceBouncingConfiguration(bad).ok).toBe(false);
  expect(parseSourceBouncingConfiguration(r.value)).toEqual(r);
 });
 it('reports parser capacities without substituting defaults or truncating formulas',()=>{
  expect(importSourceBouncingConfig({settings:{initial_angle:'x'.repeat(65537)}})).toMatchObject({ok:false,error:{kind:'capacity'}});
  expect(importSourceBouncingConfig({settings:{shape_formula:'x'.repeat(65537)}})).toMatchObject({ok:false,error:{kind:'capacity'}});
 });
});
