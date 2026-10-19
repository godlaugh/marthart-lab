import {describe,it,expect} from 'vitest';
import {importSourceBouncingVisualConfig,parseSourceBouncingVisualConfiguration,prepareSourceBouncingDisplay,SOURCE_BOUNCING_DEFAULT_PALETTE,SOURCE_BOUNCING_TRAIL_FACTS,type SourceBouncingVisualConfiguration} from '../src/engine/sourceBouncingVisualConfig';
import {sourceBouncingBoundaryPackedColor,sourceConfigPackedColor} from '../src/engine/sourceConfigColor';
const F=Math.fround;
function imported(raw:unknown={}){const r=importSourceBouncingVisualConfig(raw);if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;}
function display(c:SourceBouncingVisualConfiguration,speed=1,scale=1){const r=prepareSourceBouncingDisplay(c,{initialSpeed:speed},scale);if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;}

describe('source Bouncing visual configuration',()=>{
 it('retains independent Base palette/defaults and never maps ignored trail or boundary switches',()=>{
  const c=imported().configuration;
  expect(c).toMatchObject({settingsPresence:'absent',dotSize:1.25,lineWeight:1,transform:{scaleX:360,scaleY:360,scaleZ:1,offsetX:0,offsetY:0,offsetZ:0},backgroundColor:0xff000000,boundaryColor:'#FFFFFF',palette:{kind:'absent'}});
  expect(SOURCE_BOUNCING_DEFAULT_PALETTE).toEqual([-236971,-31185,-12958,-8142489,-10959651,-6655316].map(n=>n>>>0));
  const r=imported({settings:{show_trails:false,trail_lifetime:99,fade_trails:true,fade_points:true,show_boundary:false,boundary_stroke:20,use_accumulation_buffer:true}});
  expect(r.configuration).toEqual({...c,settingsPresence:'object'});expect(r.consumedPaths).toEqual([]);
  expect(SOURCE_BOUNCING_TRAIL_FACTS).toEqual({showTrails:true,trailLifetime:4,fadeTrails:false,fadePoints:false,useAccumulationBuffer:false,accumulationFadeAlpha:6});
  const uniforms=display(c);expect(uniforms.paletteCount).toBe(6);expect(uniforms.radius).toBe(1.25);expect(uniforms.boundaryStrokeWeight).toBe(F(1.6));
 });
 it('parses visual fields using empty-scope ConfigUtils and preserves constructor consumption order',()=>{
  const r=imported({palette:['#804080c0'],parameters:{x:5},settings:{dot_size:'1/2',line_weight:'-2',scale_x:'PI',scale_y:-2,scale_z:0,offset_x:'x',offset_y:'1/4',offset_z:3,background_color:'#12345678',boundary_color:' #12#3456 '}});
  expect(r.configuration).toMatchObject({dotSize:.5,lineWeight:-2,transform:{scaleX:F(Math.PI),scaleY:-2,scaleZ:0,offsetX:0,offsetY:.25,offsetZ:3},backgroundColor:0x12345678,boundaryColor:' #12#3456 '});
  expect(r.consumedPaths).toEqual([['palette'],...['dot_size','line_weight','scale_x','scale_y','scale_z','offset_x','offset_y','offset_z','background_color','boundary_color'].map(s=>['settings',s])]);
  expect(r.numericPaths).toEqual(['scale_y','scale_z','offset_z'].map(s=>['settings',s]));expect(r.diagnostics).toHaveLength(1);
  const u=display(r.configuration,4,.5);expect(u.radius).toBe(.5);expect(u.speedScale).toBe(.25);expect(u.boundaryStrokeWeight).toBe(1);expect(u.boundaryPackedColor).toBe(0xd2123456);expect(u.backgroundColor).toBe(0x12345678);
 });
 it('uses strict palette array/string getters before settings and source white recovery for malformed color strings',()=>{
  for(const palette of [null,false,{},[null],[5]])expect(importSourceBouncingVisualConfig({palette,settings:null})).toMatchObject({ok:false,error:{kind:'input',path:palette instanceof Array?['palette','0']:['palette']}});
  for(const settings of [null,[],false,'x'])expect(importSourceBouncingVisualConfig({settings})).toMatchObject({ok:false,error:{path:['settings']}});
  expect(importSourceBouncingVisualConfig(null)).toMatchObject({ok:false,error:{path:[]}});
  const r=imported({palette:['garbage'],settings:{background_color:'bad',boundary_color:null}});expect(r.configuration.backgroundColor).toBe(0xffffffff);expect(r.configuration.boundaryColor).toBe('#FFFFFF');expect(r.diagnostics).toHaveLength(2);expect(Array.from(display(r.configuration).paletteRgb)).toEqual(Array(75).fill(1));
 });
 it('does not turn empty palettes into default palettes, truncates uniforms to25, and repeats last color',()=>{
  const empty=display(imported({palette:[]}).configuration);expect(empty.paletteCount).toBe(1);expect(Array.from(empty.paletteRgb)).toEqual(Array(75).fill(1));
  const two=display(imported({palette:['#00000000','#80336699']}).configuration);expect(two.paletteCount).toBe(2);expect(Array.from(two.paletteRgb.slice(0,6))).toEqual([0,0,0,F(.2),F(.4),F(.6)]);expect(Array.from(two.paletteRgb.slice(72))).toEqual([F(.2),F(.4),F(.6)]);
  const many=display(imported({palette:Array.from({length:30},(_,i)=>'#'+i.toString(16).padStart(6,'0'))}).configuration);expect(many.paletteCount).toBe(25);expect(many.paletteRgb[74]).toBe(F(24/255));
 });
 it('retains the two radius clamps as separate CPU and shader operations and derived Float32 infinity',()=>{
  const c={...imported().configuration,dotSize:-5};expect(display(c,0,.25).radius).toBe(.25);expect(display(c,-1).speedScale).toBe(1);expect(display(c,3).speedScale).toBe(F(1/3));expect(display(c,F(2**-149)).speedScale).toBe(Infinity);
  expect(display({...c,dotSize:F(3e38)},1,2).radius).toBe(Infinity);
  expect(prepareSourceBouncingDisplay(c,{initialSpeed:NaN},1)).toMatchObject({ok:false,error:{kind:'nonfinite'}});
 });
 it('preserves ConfigUtils ARGB background and keeps its color grammar separate from the boundary parser',()=>{
  expect(imported({settings:{background_color:'#00336699'}}).configuration.backgroundColor).toBe(0x00336699);
  expect(imported({settings:{background_color:'128'}}).configuration.backgroundColor).toBe(128);
  expect(sourceConfigPackedColor('#80123456')).toBe(0x80123456);
  expect(sourceBouncingBoundaryPackedColor('#80123456')).toBe(0xffffffff);
  expect(sourceBouncingBoundaryPackedColor('#7f123456')).toBe(0x7f123456);
  expect(display(imported({settings:{boundary_color:'#7f123456'}}).configuration).boundaryPackedColor).toBe(0xd2123456);
 });
 it('implements boundary Java trim/hash removal and signed radix16 with Java BMP digits',()=>{
  expect(sourceBouncingBoundaryPackedColor(' \t#12#3456\n')).toBe(0xff123456);
  expect(sourceBouncingBoundaryPackedColor('#１２Ａｂ٣٤')).toBe(0xff12ab34);
  expect(sourceBouncingBoundaryPackedColor('-12345')).toBe(0xfffedcbb);
  expect(sourceBouncingBoundaryPackedColor('-1234567')).toBe(0xfedcba99);
  for(const value of ['', '#fff','#0x123456','#ffffffff','\u00a0#123456','12345g','𝟙23456'])expect(sourceBouncingBoundaryPackedColor(value)).toBe(0xffffffff);
 });
 it('deep copies strict canonical facts and rejects malformed/capacity inputs instead of silently repairing',()=>{
  const c=imported({palette:['#123456']}).configuration,r=parseSourceBouncingVisualConfiguration(c);expect(r.ok).toBe(true);if(!r.ok)throw Error('parse');c.transform.scaleX=4;if(c.palette.kind==='colors')c.palette.colors[0]='#ffffff';expect(r.value.transform.scaleX).toBe(360);expect(r.value.palette).toEqual({kind:'colors',colors:['#123456']});
  for(const bad of [{...c,extra:1},{...c,dotSize:NaN},{...c,backgroundColor:-1},{...c,backgroundColor:1.5},{...c,transform:{...c.transform,offsetX:Infinity}},{...c,palette:{kind:'absent',colors:[]}},{...c,boundaryColor:1}])expect(parseSourceBouncingVisualConfiguration(bad).ok).toBe(false);
  expect(importSourceBouncingVisualConfig({palette:Array(65537).fill('#000000')})).toMatchObject({ok:false,error:{kind:'capacity'}});
  expect(importSourceBouncingVisualConfig({settings:{boundary_color:'x'.repeat(1048577)}})).toMatchObject({ok:false,error:{kind:'capacity'}});
  expect(importSourceBouncingVisualConfig({settings:{dot_size:'1/0'}})).toMatchObject({ok:false,error:{kind:'nonfinite'}});
 });
});
