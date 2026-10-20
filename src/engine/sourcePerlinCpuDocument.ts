import {SOURCE_PERLIN_CPU_FIELDS as sourceFields} from './sourcePerlinFields';
import type { SourcePerlinParameterValues } from './sourcePerlinParameterRuntime';
import type { SourcePerlinDocumentError, SourcePerlinDocumentResult, SourcePerlinDocumentImportOptions, SourcePerlinConfigReader } from './sourcePerlinDocumentConfig';
import { attempt, fail, finite, integer, seedText, exactKeys, parsePerlinPalette, parsePerlinParameters, parsePerlinCpuStyle, defaultPerlinParameters, createPerlinConfigReader, readSourcePerlinCommonConfiguration } from './sourcePerlinDocumentConfig';
import { SOURCE_PERLIN_DEFAULT_PALETTE } from './sourcePerlinColorRuntime';

export interface SourcePerlinCpuDocumentPayload {
 seed: string;
 palette: number[];
 parameters: SourcePerlinParameterValues;
 cpuStyle: 'particles' | 'field-curves';
 particles: {
  count: number; stepSize: number; timeScale: number; respawnRate: number;
  flowMode: 'ANGLE_FIELD' | 'SWIRL_FIELD' | 'VECTOR_FIELD';
  angleMap: 'LINEAR' | 'SOFT_POWER';
 };
 curves: {
  count: number; length: number; stepSize: number; alpha: number; cellSize: number;
  noiseOctaves: number; noiseOffset: number; sampling: 'random' | 'jittered-grid';
  colorMode: 'seed-space' | 'noise' | 'index' | 'position';
  seedCircleCount: number; seedMinRadius: number; seedMaxRadius: number;
 };
 display: {
  dotSize: number; lineWeight: number; trailLifetime: number;
  fadeTrails: boolean; showTrails: boolean; accumulation: boolean;
  accumulationFadeAlpha: number; backgroundColor: number;
 };
}
export type SourcePerlinCpuDocumentError = SourcePerlinDocumentError;
export type SourcePerlinCpuDocumentResult<T> = SourcePerlinDocumentResult<T>;
export type SourcePerlinCpuDocumentImportOptions = SourcePerlinDocumentImportOptions;
export interface SourcePerlinCpuDocumentImportFacts {
 configuration: SourcePerlinCpuDocumentPayload;
 consumedPaths: string[][]; numericPaths: string[][]; diagnostics: string[];
}
const F=Math.fround;
const FLOWS={ANGLE_FIELD:'ANGLE_FIELD',SWIRL_FIELD:'SWIRL_FIELD',VECTOR_FIELD:'VECTOR_FIELD'} as const;
const ANGLES={LINEAR:'LINEAR',SOFT_POWER:'SOFT_POWER'} as const;
const SAMPLING={RANDOM:'random',JITTERED_GRID:'jittered-grid'} as const;
const COLORS={SEED_SPACE:'seed-space',NOISE:'noise',INDEX:'index',POSITION:'position'} as const;
function defaults(seed:string):SourcePerlinCpuDocumentPayload {
 return {seed,palette:[...SOURCE_PERLIN_DEFAULT_PALETTE],parameters:defaultPerlinParameters(),cpuStyle:'particles',
  particles:{count:10000,stepSize:F(.15),timeScale:0,respawnRate:0,flowMode:'ANGLE_FIELD',angleMap:'LINEAR'},
  curves:{count:3000,length:70,stepSize:2,alpha:F(.35),cellSize:20,noiseOctaves:2,noiseOffset:0,sampling:'jittered-grid',colorMode:'seed-space',seedCircleCount:50,seedMinRadius:30,seedMaxRadius:40},
  display:{dotSize:2,lineWeight:1,trailLifetime:4,fadeTrails:true,showTrails:true,accumulation:false,accumulationFadeAlpha:6,backgroundColor:0xff000000}};
}
const enumeration=<T extends string>(raw:unknown,allowed:readonly T[],path:readonly string[]):T=>{
 if(typeof raw!=='string'||!allowed.includes(raw as T))return fail('input',path,'未知原版 Perlin 枚举值');return raw as T;
};
const bool=(raw:unknown,path:readonly string[]):boolean=>{if(typeof raw!=='boolean')return fail('input',path,'需要布尔值');return raw;};
const lower=(value:number,min:number,path:readonly string[]):number=>{if(value<min)return fail('input',path,'规范配置低于原版初始化下界');return value;};
/** Canonical initialized configuration, not source JSON. It never repeats source
 * unit normalization or silently clamps authored values. Runtime owners admit
 * dimension-dependent allocations and work separately. */
export function parseSourcePerlinCpuDocument(raw:unknown):SourcePerlinCpuDocumentResult<SourcePerlinCpuDocumentPayload>{return attempt(()=>{
 const input=exactKeys(raw,['seed','palette','parameters','cpuStyle','particles','curves','display'],[]);
 const result=defaults(seedText(input.seed,['seed']));
 result.palette=parsePerlinPalette(input.palette);result.parameters=parsePerlinParameters(input.parameters);result.cpuStyle=parsePerlinCpuStyle(input.cpuStyle);
 const p=exactKeys(input.particles,Object.keys(result.particles),['particles']);
 result.particles={count:integer(p.count,['particles','count']),stepSize:finite(p.stepSize,['particles','stepSize']),timeScale:finite(p.timeScale,['particles','timeScale']),respawnRate:finite(p.respawnRate,['particles','respawnRate']),flowMode:enumeration(p.flowMode,Object.values(FLOWS),['particles','flowMode']),angleMap:enumeration(p.angleMap,Object.values(ANGLES),['particles','angleMap'])};
 // JsonPerlinConfig preserves a negative count, but initParticles allocation
 // fails; reject that unusable selected mode explicitly, never change the count.
 if(result.cpuStyle==='particles'&&result.particles.count<0)return fail('unsupported',['particles','count'],'原版负粒子数在初始化分配时失败');
 const c=exactKeys(input.curves,Object.keys(result.curves),['curves']);
 const ci=(key:string,min:number)=>lower(integer(c[key],['curves',key]),min,['curves',key]);
 const cf=(key:string,min?:number)=>{const value=finite(c[key],['curves',key]);return min===undefined?value:lower(value,min,['curves',key]);};
 result.curves={count:ci('count',1),length:ci('length',2),stepSize:cf('stepSize',F(.05)),alpha:cf('alpha',F(.01)),cellSize:ci('cellSize',4),noiseOctaves:ci('noiseOctaves',1),noiseOffset:cf('noiseOffset'),sampling:enumeration(c.sampling,Object.values(SAMPLING),['curves','sampling']),colorMode:enumeration(c.colorMode,Object.values(COLORS),['curves','colorMode']),seedCircleCount:ci('seedCircleCount',0),seedMinRadius:cf('seedMinRadius',0),seedMaxRadius:cf('seedMaxRadius',0)};
 if(result.curves.alpha>1)return fail('input',['curves','alpha'],'规范曲线 alpha 超过原版初始化上界 1');
 if(result.curves.noiseOctaves>6)return fail('input',['curves','noiseOctaves'],'规范 octave 超过原版初始化上界 6');
 if(result.curves.seedMaxRadius<result.curves.seedMinRadius)return fail('input',['curves','seedMaxRadius'],'最大种子半径不能小于最小半径');
 const d=exactKeys(input.display,Object.keys(result.display),['display']);
 const df=(key:string)=>finite(d[key],['display',key]);
 const backgroundColor=d.backgroundColor;
 if(typeof backgroundColor!=='number'||!Number.isInteger(backgroundColor)||backgroundColor<0||backgroundColor>0xffffffff)return fail('input',['display','backgroundColor'],'需要无符号 32 位 ARGB');
 result.display={dotSize:df('dotSize'),lineWeight:df('lineWeight'),trailLifetime:df('trailLifetime'),fadeTrails:bool(d.fadeTrails,['display','fadeTrails']),showTrails:bool(d.showTrails,['display','showTrails']),accumulation:bool(d.accumulation,['display','accumulation']),accumulationFadeAlpha:df('accumulationFadeAlpha'),backgroundColor};
 return result;
});}
/** Static-derived JsonPerlinConfig CPU projection. Root camera and unrelated GPU
 * fields stay in source provenance; display resets camera/visual transforms.
 * Partial constructor failures are explicitly unsupported, never fabricated. */
export function importSourcePerlinCpuDocument(rawSettings:unknown,rawPalette:unknown,options:SourcePerlinCpuDocumentImportOptions={}):SourcePerlinCpuDocumentResult<SourcePerlinCpuDocumentImportFacts>{return attempt(()=>{
 const r=createPerlinConfigReader(rawSettings,options);
 if(r.backend()==='gpu')return fail('unsupported',['settings','render_mode'],'原版 render_mode 选择了 GPU 路径');
 const result={...readSourcePerlinCommonConfiguration(r,rawPalette),...readSourcePerlinCpuSettings(r)};
 if(result.cpuStyle==='particles'&&result.particles.count<0)return fail('unsupported',['settings',sourceFields.particles.count],'原版负粒子数在初始化分配时失败');
 return {configuration:result,consumedPaths:r.consumedPaths,numericPaths:r.numericPaths,diagnostics:r.diagnostics};
});}
/** Owns CPU-only field interpretation, reusable by complete import and legacy recovery. */
export function readSourcePerlinCpuSettings(r:SourcePerlinConfigReader):Pick<SourcePerlinCpuDocumentPayload,'particles'|'curves'|'display'>{
 const result=defaults('0');
 result.particles={count:r.int(sourceFields.particles.count,10000),stepSize:r.scalar(sourceFields.particles.stepSize,F(.15)),timeScale:r.scalar(sourceFields.particles.timeScale,0),respawnRate:r.scalar(sourceFields.particles.respawnRate,0),flowMode:r.enumValue(sourceFields.particles.flowMode,FLOWS,'ANGLE_FIELD'),angleMap:r.enumValue(sourceFields.particles.angleMap,ANGLES,'LINEAR')};
 const bounded=(key:string,fallback:number,lo:number,hi=Infinity)=>finite(Math.max(lo,Math.min(hi,r.scalar(key,fallback,true))),['settings',key]);
 const minRadius=bounded(sourceFields.curves.seedMinRadius,30,0);
 result.curves={count:Math.max(1,r.int(sourceFields.curves.count,3000)),length:Math.max(2,r.int(sourceFields.curves.length,70)),stepSize:bounded(sourceFields.curves.stepSize,2,F(.05)),alpha:bounded(sourceFields.curves.alpha,F(.35),F(.01),1),cellSize:Math.max(4,r.int(sourceFields.curves.cellSize,20)),noiseOctaves:Math.max(1,Math.min(6,r.int(sourceFields.curves.noiseOctaves,2))),noiseOffset:r.scalar(sourceFields.curves.noiseOffset,0),sampling:r.enumValue(sourceFields.curves.sampling,SAMPLING,'jittered-grid'),colorMode:r.enumValue(sourceFields.curves.colorMode,COLORS,'seed-space'),seedCircleCount:Math.max(0,r.int(sourceFields.curves.seedCircleCount,50)),seedMinRadius:minRadius,seedMaxRadius:bounded(sourceFields.curves.seedMaxRadius,40,minRadius)};
 result.display={dotSize:r.scalar(sourceFields.display.dotSize,2),lineWeight:r.scalar(sourceFields.display.lineWeight,1),trailLifetime:r.scalar(sourceFields.display.trailLifetime,4),fadeTrails:r.boolean(sourceFields.display.fadeTrails,true),showTrails:r.boolean(sourceFields.display.showTrails,true),accumulation:r.boolean(sourceFields.display.accumulation,false),accumulationFadeAlpha:r.scalar(sourceFields.display.accumulationFadeAlpha,6),backgroundColor:r.packedColor(sourceFields.display.backgroundColor,'#000000')};
 return {particles:result.particles,curves:result.curves,display:result.display};
}
