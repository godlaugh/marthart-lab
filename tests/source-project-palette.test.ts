import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {prepareSourceProjectPalette,SOURCE_PROJECT_PALETTE_COLORS} from '../src/engine/sourceProjectPalette';
import {parseProjectFile,parseLegacyScene} from '../src/engine/legacyImport';
import {parseScene,serializeScene} from '../src/engine/document';
import {DEFAULT_SOURCE_SURFACE_COLORS} from '../src/engine/sourceSurfaceColor';
import type {SceneDocument} from '../src/types';
const oracle=JSON.parse(readFileSync(new URL('./fixtures/source-project-palette/oracle.json',import.meta.url),'utf8')) as {cases:{input:{id:string;document:{type:string;palette?:unknown}};output:{palette?:string[];savedPalette?:string[];errorClass?:string}}[]};
const extras:Record<string,Record<string,unknown>>={
 SURFACE:{equations:{x:'u',y:'v',z:'u*v'},settings:{surface_mode:'MESH',render_mode:'CPU',u_segments:4,v_segments:4}},
 ATTRACTOR:{equations:{dx:'y',dy:'-x',dz:'0'},settings:{particle_count_cpu:2}},
 IMPLICIT:{equation:{f:'x*x+y*y+z*z-1'},settings:{x_segments:8,y_segments:8,z_segments:8,render_mode:'SOLID',mesh_mode:'CPU'}},
 FRACTAL:{fractal:{formula_id:'mandelbrot',iterations:10}},
 PERLIN:{settings:{particle_count:4}},DOMAIN_COLORING:{domainColoring:{formula:'z'}},SYMMETRY_CHAOS:{settings:{batch_size:32}},SAMILA:{settings:{batch_size:32}},COMPLEX_ROOTS:{},
};
function source(type:string,patch:Record<string,unknown>={}){return{config_version:'1.0.0',name:'Project palette '+type,type,...extras[type],...patch};}
function palette(s:SceneDocument):unknown{
 switch(s.kind){
  case 'surface':return s.surfaceSourcePalette?.colors;
  case 'attractor':return s.attractorSource?.visual.palette.kind==='colors'?s.attractorSource.visual.palette.colors:undefined;
  case 'roots':return s.rootsSourcePalette?.colors;
  case 'domain':return s.domainSourcePalette?.colors;
  case 'implicit':return s.implicitSourcePalette?.colors;
  case 'fractal':return s.fractalSourceColor?.palette.colors;
  case 'perlin':return s.perlinSource?.palette;
  default:return s.palette.stops;
 }
}
describe('ProjectState palette production boundary',()=>{
 for(const {input,output} of oracle.cases)it('original '+input.id,()=>{
  const actual=prepareSourceProjectPalette(input.document.palette);
  if(output.errorClass){expect(actual).toMatchObject({ok:false,error:{kind:'input'}});return;}
  expect(actual).toEqual({ok:true,value:{origin:'palette'in input.document?'authored':'default',colors:output.palette}});
  expect(output.savedPalette).toEqual(output.palette);
 });
 it('bounds allocation and UTF-16 bytes without normalizing or aliasing authored strings',()=>{
  expect(prepareSourceProjectPalette(Array(65537).fill(''))).toMatchObject({ok:false,error:{kind:'capacity'}});
  expect(prepareSourceProjectPalette(['😀'.repeat(262145)])).toMatchObject({ok:false,error:{kind:'capacity'}});
  const raw=['',' not-a-color ','#80AbCdEf'],r=prepareSourceProjectPalette(raw);expect(r.ok).toBe(true);
  if(r.ok){expect(r.value.colors).toEqual(raw);r.value.colors.push('new');expect(raw).toHaveLength(3);}
 });
});
describe('public project file pipeline, canonical save and runtime isolation',()=>{
 for(const type of Object.keys(extras))it(type+' imports seven defaults, preserves omission provenance, saves and reopens',()=>{
  const raw=source(type),s=parseProjectFile(JSON.stringify(raw)).scene;
  const expected=type==='PERLIN'?SOURCE_PROJECT_PALETTE_COLORS.map(s=>(0xff000000|parseInt(s.slice(1),16))>>>0):[...SOURCE_PROJECT_PALETTE_COLORS];
  expect(palette(s)).toEqual(type==='SAMILA'||type==='SYMMETRY_CHAOS'?expected.map(c=>String(c).toLowerCase()):expected);
  expect(s.provenance?.original).toEqual(raw);expect(s.provenance?.original).not.toHaveProperty('palette');
  expect(palette(parseScene(serializeScene(s)))).toEqual(palette(s));
  expect(palette(parseProjectFile(serializeScene(s)).scene)).toEqual(palette(s));
  if(type==='FRACTAL')expect(s.fractalSourceColor?.palette.useCosine).toBe(false);
 });
 for(const type of ['SURFACE','ATTRACTOR','FRACTAL','DOMAIN_COLORING','COMPLEX_ROOTS'])for(const colors of (type==='DOMAIN_COLORING'?[[],['#80112233']]:[[],['#80112233'],['not-a-color','-65536','#AbCdEf','']]))it(type+' retains raw palette '+JSON.stringify(colors),()=>{
  if(type==='SURFACE'&&!colors.length){expect(()=>parseProjectFile(JSON.stringify(source(type,{palette:colors})))).toThrow('至少需要一种颜色');return;}
  const s=parseProjectFile(JSON.stringify(source(type,{palette:colors}))).scene;
  expect(palette(s)).toEqual(colors);expect(palette(parseScene(serializeScene(s)))).toEqual(colors);expect(s.provenance?.original).toMatchObject({palette:colors});
 });
 it('keeps direct runtime defaults and previously saved absent palettes',()=>{
  for(const type of ['ATTRACTOR','DOMAIN_COLORING','COMPLEX_ROOTS']){const s=parseLegacyScene(JSON.stringify(source(type))).scene;expect(palette(s)).toBeUndefined();expect(palette(parseProjectFile(serializeScene(s)).scene)).toBeUndefined();}
  for(const type of ['SURFACE','FRACTAL','SAMILA']){const s=parseLegacyScene(JSON.stringify(source(type))).scene;expect(palette(s)).toEqual(type==='SAMILA'?DEFAULT_SOURCE_SURFACE_COLORS.map(s=>s.toLowerCase()):[...DEFAULT_SOURCE_SURFACE_COLORS]);}
  const f=parseLegacyScene(JSON.stringify(source('FRACTAL'))).scene;expect(f.fractalSourceColor?.palette.useCosine).toBe(true);
  expect(()=>parseLegacyScene(JSON.stringify(source('SURFACE',{palette:null})))).toThrow();
 });
 it('does not bake or override explicit Fractal cosine flags on file load',()=>{
  const raw=source('FRACTAL',{palette:['#123456'],color:{use_cosine_palette:true,cosine_a:[.2,.3,.4]}}),s=parseProjectFile(JSON.stringify(raw)).scene;
  expect(s.fractalSourceColor?.palette).toMatchObject({useCosine:true,colors:['#123456'],cosine:{a:[Math.fround(.2),Math.fround(.3),Math.fround(.4)]}});
 });
 it('rejects malformed palette even in a scene that ignores its colors',()=>{
  for(const type of ['MAP_ATTRACTOR','BOUNCING_PARTICLES'])for(const invalid of [null,{},false,['#123456',1]])expect(()=>parseProjectFile(JSON.stringify(source(type,{palette:invalid})))).toThrow(/palette/);
 });
});
