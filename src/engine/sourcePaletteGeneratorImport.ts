import {defaultSourceCosinePalette,SOURCE_GENERATOR_POINT_BUDGET,type SourceCosinePaletteState,type SourceCurvePoint,type SourcePaletteGenerationResult} from './sourceGradientPaletteGeneration';
import {parseDomainSourceFloat,prepareDomainSourceScalar} from './domainSourceScalar';

/** ProjectState editor facts, independent of any renderer's palette runtime. */
export interface SourcePaletteGeneratorConfiguration {
 useCosine:boolean;useCurve?:boolean;
 cosine:Omit<SourceCosinePaletteState,'colorCount'>;
 curves?:Partial<Record<'red'|'green'|'blue',SourceCurvePoint[]>>;
}
class Failure extends Error {constructor(readonly kind:'input'|'capacity',readonly path:string,reason:string){super(reason);}}
const fail=(path:string,reason:string):never=>{throw new Failure('input',path,reason);};
const object=(value:unknown,path:string):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:fail(path,'object required');
function sourceFloat(raw:unknown,path:string):number {
 if(typeof raw==='number'&&Number.isFinite(raw)&&Number.isFinite(Math.fround(raw)))return Math.fround(raw);
 if(typeof raw==='string'){
  const parsed=parseDomainSourceFloat(raw);
  if(parsed.ok&&parsed.classification==='finite')return parsed.value;
  if(!parsed.ok&&parsed.error.kind==='capacity')throw new Failure('capacity',path,'source float text budget exceeded');
 }
 return fail(path,'finite source Float required');
}
/** Import only generator fields. ProjectState uses JSONArray.getFloat; direct
 * runtime configuration uses ConfigUtils scalar expressions for cosine vec3.
 * Neither entry normalizes/clamps/sorts authored values or generates colors. */
export function importSourcePaletteGenerator(raw:unknown,entry:'project'|'runtime-config'):SourcePaletteGenerationResult<{configuration:SourcePaletteGeneratorConfiguration;consumedPaths:string[][]}> {
 try{
  const {a,b,c,d}=defaultSourceCosinePalette(),configuration:SourcePaletteGeneratorConfiguration={useCosine:entry==='runtime-config',cosine:{a,b,c,d}},consumedPaths:string[][]=[];
  if(raw===undefined)return{ok:true,value:{configuration,consumedPaths}};
  const color=object(raw,'color');
  const has=(key:string)=>Object.hasOwn(color,key),read=(key:string)=>{consumedPaths.push(['color',key]);return color[key];};
  for(const [field,key]of [['use_cosine_palette','useCosine'],['use_curve_palette','useCurve']] as const)if(has(field)){
   const v=read(field);configuration[key]=typeof v==='boolean'?v:typeof v==='string'&&/^(true|false)$/i.test(v)?v.toLowerCase()==='true':fail('color.'+field,'source boolean required');
  }
  let points=0;
  for(const channel of ['red','green','blue'] as const){
   const field='curve_'+channel;if(!has(field))continue;
   const list=read(field);if(!Array.isArray(list))return fail('color.'+field,'source array required');
   points+=list.length;if(points+6>SOURCE_GENERATOR_POINT_BUDGET)throw new Failure('capacity','color.'+field,'local 65536-point preparation budget exceeded');
   (configuration.curves??={})[channel]=list.map((raw,i)=>{const path=`color.${field}[${i}]`,p=object(raw,path);return{id:crypto.randomUUID(),x:sourceFloat(p.x,path+'.x'),y:sourceFloat(p.y,path+'.y')};});
  }
  for(const key of ['a','b','c','d'] as const){
   const field='cosine_'+key;if(!has(field))continue;
   const vector=read(field);if(!Array.isArray(vector))return fail('color.'+field,'source array required');
   if(vector.length<3)continue;
   configuration.cosine[key]=vector.slice(0,3).map((v,i)=>{
    const path=`color.${field}[${i}]`;if(entry==='project')return sourceFloat(v,path);
    const scalar=prepareDomainSourceScalar(v==null||typeof v==='object'||typeof v==='boolean'?String(v):v,{fallback:configuration.cosine[key][i],precision:'float32'});
    if(!scalar.ok)throw new Failure('capacity',path,`source scalar ${scalar.error.resource} budget exceeded`);
    const value=scalar.facts.fallbackReason==='invalid-expression'?0:scalar.facts.value;
    return Number.isFinite(value)?value:fail(path,'finite number required');
   }) as [number,number,number];
  }
  return{ok:true,value:{configuration,consumedPaths}};
 }catch(e){if(e instanceof Failure)return{ok:false,error:{kind:e.kind,path:e.path,reason:e.message}};throw e;}
}
