import { describe, expect, it } from 'vitest';
import { importSourcePerlinCpuDocument, parseSourcePerlinCpuDocument } from '../src/engine/sourcePerlinCpuDocument';
import { importSourcePerlinGpuDocument } from '../src/engine/sourcePerlinGpuDocument';
const F=Math.fround;
function imported(settings:Record<string,unknown>={},palette:unknown=undefined,options:Parameters<typeof importSourcePerlinCpuDocument>[2]={defaultSeed:'999'}){
 const result=importSourcePerlinCpuDocument(settings,palette,options);
 if(!result.ok)throw new Error(JSON.stringify(result.error));return result.value;
}
const canonical=()=>imported({seed:'1'}).configuration;

describe('original Perlin CPU document configuration',()=>{
 it('transcribes JsonPerlinConfig and AbstractVisualConfig initialized defaults',()=>{
  const value=canonical();
  expect(value).toMatchObject({seed:'1',cpuStyle:'particles',parameters:{noise_offset:0,noise_scale:8,curve_noise_scale:F(1.2),curve_angle_scale:4},
   particles:{count:10000,stepSize:F(.15),timeScale:0,respawnRate:0,flowMode:'ANGLE_FIELD',angleMap:'LINEAR'},
   curves:{count:3000,length:70,stepSize:2,alpha:F(.35),cellSize:20,noiseOctaves:2,noiseOffset:0,sampling:'jittered-grid',colorMode:'seed-space',seedCircleCount:50,seedMinRadius:30,seedMaxRadius:40},
   display:{dotSize:2,lineWeight:1,trailLifetime:4,fadeTrails:true,showTrails:true,accumulation:false,accumulationFadeAlpha:6,backgroundColor:0xff000000}});
  expect(value.palette).toHaveLength(6);
 });
 it('only exact case-insensitive GPU selects the other backend; missing and malformed render modes use CPU',()=>{
  for(const render_mode of ['GPU','gpu','gPu'])expect(importSourcePerlinCpuDocument({seed:'1',render_mode},undefined)).toMatchObject({ok:false,error:{kind:'unsupported',path:['settings','render_mode']}});
  for(const render_mode of ['CPU',' GPU ',undefined,null,true,1,{},[]])expect(imported({seed:'1',render_mode}).configuration.cpuStyle).toBe('particles');
  for(const settings of [null,[],1,'CPU'])expect(importSourcePerlinCpuDocument(settings,undefined)).toMatchObject({ok:false,error:{kind:'input',path:['settings']}});
  expect(importSourcePerlinCpuDocument(undefined,undefined,{defaultSeed:'7'})).toMatchObject({ok:true,value:{configuration:{seed:'7'}}});
 });
 it('uses source enum defaults and Java trim, with exactly two sampling values',()=>{
  const value=imported({cpu_render_style:' field_curves\t',flow_mode:' swirl_field ',angle_map:'soft_power',curve_sampling_mode:' random ',curve_color_mode:' position '}).configuration;
  expect(value.cpuStyle).toBe('field-curves');expect(value.particles).toMatchObject({flowMode:'SWIRL_FIELD',angleMap:'SOFT_POWER'});expect(value.curves).toMatchObject({sampling:'random',colorMode:'position'});
  const fallback=imported({cpu_render_style:'wat',flow_mode:'vector',angle_map:'nope',curve_sampling_mode:'HALTON',curve_color_mode:false}).configuration;
  expect(fallback.particles).toMatchObject({flowMode:'ANGLE_FIELD',angleMap:'LINEAR'});expect(fallback.curves).toMatchObject({sampling:'jittered-grid',colorMode:'seed-space'});
  expect(imported({cpu_render_style:'\u00a0FIELD_CURVES\u00a0'}).configuration.cpuStyle).toBe('particles');
  expect(imported({curve_color_mode:'İNDEX'}).configuration.curves.colorMode).toBe('seed-space');
  expect(imported({curve_color_mode:'ındex'}).configuration.curves.colorMode).toBe('index');
 });
 it('applies constructor curve clamps once and keeps two independent noise offsets',()=>{
  const value=imported({curve_count:-2,curve_length:0,curve_step_size:-1,curve_alpha:2,field_cell_size:0,curve_noise_octaves:99,curve_noise_scale:-1,curve_angle_scale:-1,seed_space_circle_count:-3,seed_space_min_radius:12,seed_space_max_radius:4,noise_scale:.001,noise_offset:3,curve_noise_offset:5}).configuration;
  expect(value.parameters).toEqual({noise_offset:3,noise_scale:1,curve_noise_scale:F(.01),curve_angle_scale:F(.1)});
  expect(value.curves).toMatchObject({count:1,length:2,stepSize:F(.05),alpha:1,cellSize:4,noiseOctaves:6,noiseOffset:5,seedCircleCount:0,seedMinRadius:12,seedMaxRadius:12});
  const result=parseSourcePerlinCpuDocument(value);expect(result).toEqual({ok:true,value});
  const tiny={...value,parameters:{...value.parameters,noise_scale:.001}};const again=parseSourcePerlinCpuDocument(tiny);
  expect(again).toMatchObject({ok:true,value:{parameters:{noise_scale:F(.001)}}});
 });
 it('performs expression/default interpretation before clamps, including finite results of infinity clamps',()=>{
  const value=imported({particle_count:'6*7',step_size:'bad-name',curve_count:'bad-name',curve_alpha:'Infinity',curve_step_size:'-Infinity',curve_noise_scale:'-Infinity',curve_angle_scale:'-Infinity',seed_space_min_radius:'-Infinity',seed_space_max_radius:'-Infinity'});
  expect(value.configuration.particles).toMatchObject({count:42,stepSize:0});
  expect(value.configuration.curves).toMatchObject({count:1,alpha:1,stepSize:F(.05),seedMinRadius:0,seedMaxRadius:0});
  expect(value.configuration.parameters).toMatchObject({curve_noise_scale:F(.01),curve_angle_scale:F(.1)});
  expect(value.diagnostics).toHaveLength(3); // seed fallback plus two invalid expressions
 });
 it('retains raw signed display/motion values until their drawing or update owner applies clamps',()=>{
  const value=imported({particle_count:0,step_size:-1,time_scale:-2,respawn_rate:-3,dot_size:-4,line_weight:-5,trail_lifetime:-6,accumulation_fade_alpha:999}).configuration;
  expect(value.particles).toMatchObject({count:0,stepSize:-1,timeScale:-2,respawnRate:-3});expect(value.display).toMatchObject({dotSize:-4,lineWeight:-5,trailLifetime:-6,accumulationFadeAlpha:999});
  expect(parseSourcePerlinCpuDocument(value)).toEqual({ok:true,value});
 });
 it('does not fabricate successful negative particle allocation, but preserves dormant count for curves',()=>{
  expect(importSourcePerlinCpuDocument({seed:'1',particle_count:-1},undefined)).toMatchObject({ok:false,error:{kind:'unsupported',path:['settings','particle_count']}});
  const value=imported({seed:'1',particle_count:-1,cpu_render_style:'FIELD_CURVES'}).configuration;
  expect(value.particles.count).toBe(-1);expect(parseSourcePerlinCpuDocument(value).ok).toBe(true);
  expect(parseSourcePerlinCpuDocument({...value,cpuStyle:'particles'})).toMatchObject({ok:false,error:{kind:'unsupported',path:['particles','count']}});
 });
 it('uses JSONObject default boolean semantics rather than JS truthiness',()=>{
  expect(imported({fade_trails:'FALSE',show_trails:'false',use_accumulation_buffer:'TrUe'}).configuration.display).toMatchObject({fadeTrails:false,showTrails:false,accumulation:true});
  expect(imported({fade_trails:0,show_trails:' false ',use_accumulation_buffer:1}).configuration.display).toMatchObject({fadeTrails:true,showTrails:true,accumulation:false});
 });
 it('shares exact source seed tokens and requires explicit captured-clock fallback',()=>{
  expect(imported({seed:Number('9007199254740993')},undefined,{numberToken:path=>path.join('.')==='settings.seed'?'9007199254740993':undefined}).configuration.seed).toBe('9007199254740993');
  expect(importSourcePerlinCpuDocument({},undefined)).toMatchObject({ok:false,error:{path:['settings','seed']}});
  expect(imported({seed:' 1 '}).configuration.seed).toBe('999');
  expect(importSourcePerlinCpuDocument({seed:Number('9007199254740993')},undefined)).toMatchObject({ok:false,error:{kind:'input'}});
 });
 it('preserves int token conversion independently from expression integer casts',()=>{
  expect(imported({particle_count:4294967297},undefined,{defaultSeed:'1',numberToken:()=> '4294967297'}).configuration.particles.count).toBe(1);
  expect(imported({particle_count:'5.9'}).configuration.particles.count).toBe(5);
  expect(importSourcePerlinCpuDocument({seed:'1',particle_count:4294967297},undefined)).toMatchObject({ok:false,error:{kind:'input'}});
 });
 it('uses packed colors, source color errors and explicit partial-palette rejection',()=>{
  expect(imported({background_color:'#80123456'},['#102030','invalid']).configuration).toMatchObject({palette:[0xff102030,0xffffffff],display:{backgroundColor:0x80123456}});
  expect(imported({background_color:'invalid'}).configuration.display.backgroundColor).toBe(0xffffffff);
  expect(imported({background_color:1},undefined,{defaultSeed:'1',numberToken:()=> '1'}).configuration.display.backgroundColor).toBe(1);
  expect(imported({background_color:1},undefined,{defaultSeed:'1',numberToken:()=> '1.0'}).configuration.display.backgroundColor).toBe(0xffffffff);
  expect(imported({background_color:{nested:1}}).configuration.display.backgroundColor).toBe(0xffffffff);
  for(const palette of [null,{},['#fff',2]])expect(importSourcePerlinCpuDocument({seed:'1'},palette)).toMatchObject({ok:false,error:{kind:'unsupported'}});
  expect(imported({},[]).configuration.palette).toEqual(canonical().palette);
 });
 it('returns selected CPU consumed paths; inherited transform and shader fields remain raw provenance',()=>{
  const result=imported({particle_count:3,line_weight:2,scale_x:4,gpu_noise_frequency:7,unknown:9});
  expect(result.consumedPaths).toContainEqual(['settings','particle_count']);expect(result.numericPaths).toContainEqual(['settings','line_weight']);
  for(const key of ['scale_x','gpu_noise_frequency','unknown'])expect(result.consumedPaths).not.toContainEqual(['settings',key]);
 });
 it('shares seed/parameter/palette interpretation with GPU without consuming CPU fields there',()=>{
  const settings={seed:'-9223372036854775808',noise_scale:.01,noise_offset:'2*pi',curve_noise_scale:'3/2',curve_angle_scale:7,cpu_render_style:'FIELD_CURVES',particle_count:3};
  const cpu=imported(settings,['#fedcba']).configuration;
  const gpu=importSourcePerlinGpuDocument({...settings,render_mode:'GPU'},['#fedcba']);expect(gpu.ok).toBe(true);if(!gpu.ok)return;
  for(const key of ['seed','parameters','palette','cpuStyle'] as const)expect(gpu.value.configuration[key]).toEqual(cpu[key]);
  expect(gpu.value.consumedPaths).not.toContainEqual(['settings','particle_count']);
 });
 it('rejects unresolved nonfinite values and local parsing capacity without fallback geometry',()=>{
  for(const settings of [{step_size:'NaN'},{noise_offset:'Infinity'},{curve_noise_offset:'Infinity'},{curve_alpha:'NaN'},{seed_space_min_radius:'Infinity'}])expect(importSourcePerlinCpuDocument({seed:'1',...settings},undefined)).toMatchObject({ok:false,error:{kind:'nonfinite'}});
  expect(importSourcePerlinCpuDocument({seed:'1',step_size:'1'.repeat(65537)},undefined)).toMatchObject({ok:false,error:{kind:'capacity'}});
  expect(importSourcePerlinCpuDocument({seed:'1'},Array(65537).fill('#fff'))).toMatchObject({ok:false,error:{kind:'capacity'}});
 });
 it('strict canonical validation rejects missing/extra keys, alias enums, invalid bounds and wrong scalar kinds',()=>{
  const base=canonical();
  for(const value of [{...base,extra:1},{...base,curves:{...base.curves,length:1}},{...base,curves:{...base.curves,sampling:'RANDOM'}},{...base,curves:{...base.curves,noiseOctaves:7}},{...base,curves:{...base.curves,alpha:0}},{...base,curves:{...base.curves,seedMaxRadius:1}},{...base,display:{...base.display,showTrails:'true'}},{...base,display:{...base.display,backgroundColor:-1}},{...base,particles:{...base.particles,count:.1}},{...base,palette:[]},{...base,seed:1}])expect(parseSourcePerlinCpuDocument(value).ok).toBe(false);
 });
 it('returns detached canonical objects so mutation cannot reinterpret retained configuration',()=>{
  const base=canonical(),parsed=parseSourcePerlinCpuDocument(base);expect(parsed.ok).toBe(true);if(!parsed.ok)return;
  base.particles.count=17;base.palette[0]=0;base.parameters={...base.parameters,noise_scale:9};base.display.showTrails=false;base.curves.count=3;
  expect(parsed.value.particles.count).toBe(10000);expect(parsed.value.palette[0]).not.toBe(0);expect(parsed.value.parameters.noise_scale).toBe(8);expect(parsed.value.display.showTrails).toBe(true);expect(parsed.value.curves.count).toBe(3000);
 });
});
