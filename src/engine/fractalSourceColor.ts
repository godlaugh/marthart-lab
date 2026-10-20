import {sourcePaletteRuntimeLut,type SourcePaletteRuntimeConfiguration,type SourcePaletteRuntimeState} from './sourcePaletteRuntime';
import {sourceConfigPackedColor,SOURCE_COLOR_TEXT_BUDGET,SourceConfigColorError} from './sourceConfigColor';
import {prepareDomainSourceScalar} from './domainSourceScalar';
import {javaTrim,isJavaBlank} from './sourceJavaText';

export const FRACTAL_SOURCE_COLOR_PROFILE='mathart-1.7.8-v1' as const;
export const FRACTAL_SOURCE_COLOR_ALGORITHMS=['none','basic','smooth_mandelbrot','decomposition','binary_decomposition','distance_estimator','direct_domain','direct_orbit_trap','direct_normalized_z','orbit_trap_index'] as const;
export const FRACTAL_SOURCE_COLOR_TRANSFERS=['none','linear','sqr','sqrt','cube','cuberoot','log','exp','sin','arctan'] as const;
export type FractalSourceColorAlgorithm=typeof FRACTAL_SOURCE_COLOR_ALGORITHMS[number];
export type FractalSourceColorTransfer=typeof FRACTAL_SOURCE_COLOR_TRANSFERS[number];
export type FractalSourceColorParameter=number|string|[number,number];
export interface FractalSourceColorSideConfiguration {
 algorithm:string;parameters:Record<string,FractalSourceColorParameter>;solidColor:string;
 transfer:string;density:number;offset:number;repeat:boolean;
}
export type FractalSourcePaletteConfiguration=SourcePaletteRuntimeConfiguration;
export interface FractalSourceColorConfiguration {
 inside:FractalSourceColorSideConfiguration;outside:FractalSourceColorSideConfiguration;palette:FractalSourcePaletteConfiguration;
}
export type FractalSourcePaletteRuntime=SourcePaletteRuntimeState;
export type FractalSourceColorVec4=readonly[number,number,number,number];
export interface PreparedFractalSourceColorSide {
 readonly algorithm:FractalSourceColorAlgorithm;readonly algorithmId:number;
 readonly p0:FractalSourceColorVec4;readonly p1:FractalSourceColorVec4;readonly p2:FractalSourceColorVec4;
 readonly solid:readonly[number,number,number];readonly transferId:number;readonly density:number;readonly offset:number;readonly repeat:boolean;
}
export interface PreparedFractalSourceColor {
 readonly profile:typeof FRACTAL_SOURCE_COLOR_PROFILE;readonly key:string;readonly lutKey:string;
 /** Owned 1024-entry RGB32F PaletteRuntime LUT. Consumers must not mutate it. */
 readonly lut:Float32Array;readonly lutSize:1024;
 readonly inside:PreparedFractalSourceColorSide;readonly outside:PreparedFractalSourceColorSide;
 readonly diagnostics:readonly string[];
}
export interface FractalSourceColorInput {
 configuration:FractalSourceColorConfiguration;
 /** Source runtime's mapped integer power (not the author's complex exponent). */
 formulaPower:number;bailout:number;runtime?:FractalSourcePaletteRuntime;
}

export class FractalSourceColorError extends Error {
 constructor(readonly kind:'input'|'capacity',readonly field:string,reason:string){super(`${field}: ${reason}`);this.name='FractalSourceColorError';}
}
const fail=(field:string,reason:string):never=>{throw new FractalSourceColorError('input',field,reason);};
const F=Math.fround,clamp=(x:number,lo=0,hi=1)=>Math.max(lo,Math.min(hi,x));
const MAX_COLORS=65_536,MAX_TEXT=SOURCE_COLOR_TEXT_BUDGET;
const own=(x:object,k:string)=>Object.hasOwn(x,k);
function object(value:unknown,field:string):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))return fail(field,'object required');return value as Record<string,unknown>;}
function number(value:unknown,field:string):number{if(typeof value!=='number'||!Number.isFinite(value))return fail(field,'finite number required');return value;}
function f32(value:number,field:string):number{const v=F(value);if(!Number.isFinite(v))return fail(field,'value is outside finite float32 execution range');return v;}
function string(value:unknown,field:string):string{if(typeof value!=='string')return fail(field,'string required');if(value.length>MAX_TEXT)throw new FractalSourceColorError('capacity',field,'local 1 MiB text budget exceeded');return value;}
function bool(value:unknown,field:string):boolean{if(typeof value!=='boolean')return fail(field,'boolean required');return value;}
function triple(value:unknown,field:string):[number,number,number]{if(!Array.isArray(value)||value.length!==3)return fail(field,'three numbers required');return value.map((v,i)=>number(v,`${field}[${i}]`)) as [number,number,number];}
export function parseFractalSourceColorProfile(value:unknown):typeof FRACTAL_SOURCE_COLOR_PROFILE|undefined {
 if(value===undefined)return undefined;if(value===FRACTAL_SOURCE_COLOR_PROFILE)return value;return fail('fractalColorProfile','unsupported source color profile');
}
export interface FractalSourceColorParameterDescriptor {
 readonly key:string;readonly type:'number'|'complex'|'select';readonly default:number|readonly[number,number]|string;
 readonly min?:number;readonly max?:number;readonly choices?:readonly string[];readonly unit?:'degrees';
}
const n=(key:string,value:number,min?:number,max?:number,unit?:'degrees'):FractalSourceColorParameterDescriptor=>Object.freeze({key,type:'number',default:value,...(min===undefined?{}:{min}),...(max===undefined?{}:{max}),...(unit?{unit}:{})});
const e=(key:string,choices:readonly string[]):FractalSourceColorParameterDescriptor=>Object.freeze({key,type:'select',default:choices[0],choices:Object.freeze([...choices])});
const trap=[n('trap_radius',.5,1e-6),e('trap_shape',['point','ring','cross']),n('threshold',.25,1e-6),n('trap_center_x',0),n('trap_center_y',0),n('trap_angle',0,undefined,undefined,'degrees'),n('trap_aspect',1,1e-6)];
const descriptors:Readonly<Record<FractalSourceColorAlgorithm,readonly FractalSourceColorParameterDescriptor[]>>=Object.freeze({
 none:Object.freeze([]),basic:Object.freeze([e('metric',['ITERATION','REAL','IMAGINARY','SUM'])]),
 smooth_mandelbrot:Object.freeze([Object.freeze({key:'exponent',type:'complex' as const,default:Object.freeze([0,0] as const)}),n('power',0,0),n('bailout',0,0)]),
 decomposition:Object.freeze([]),binary_decomposition:Object.freeze([e('type',['TYPE_1','TYPE_2'])]),distance_estimator:Object.freeze([n('power',2,2)]),
 direct_domain:Object.freeze([n('scale',1,1e-6),n('gamma',1,1e-6),n('saturation',.8,0,1)]),
 direct_orbit_trap:Object.freeze([n('gamma',1,1e-6),n('saturation',.8,0,1),...trap,n('mix_factor',0,0,1),n('merge_opacity',.2,0,1)]),
 direct_normalized_z:Object.freeze([n('scale',1,0),n('gamma',1,1e-6),n('saturation',.8,0,1)]),orbit_trap_index:Object.freeze(trap),
});
function algorithm(value:string):FractalSourceColorAlgorithm {const id=value;if((FRACTAL_SOURCE_COLOR_ALGORITHMS as readonly string[]).includes(id))return id as FractalSourceColorAlgorithm;return fail('algorithm','unsupported source coloring algorithm: '+value);}
export function fractalSourceColorParameterDescriptors(value:string):readonly FractalSourceColorParameterDescriptor[]{return descriptors[algorithm(value)];}
export function createDefaultFractalSourceColorConfiguration():FractalSourceColorConfiguration {
 const side=(algorithm:string):FractalSourceColorSideConfiguration=>({algorithm,parameters:{},solidColor:'#000000',transfer:'linear',density:1,offset:0,repeat:true});
 return{inside:side('none'),outside:side('smooth_mandelbrot'),palette:{colors:['#FC6255','#FF862F','#FFCD62','#83C167','#58C4DD','#9A72AC'],offset:0,gamma:1,space:'rgb',useCosine:true,cosine:{a:[.5,.5,.5],b:[.5,.5,.5],c:[1,1,1],d:[0,F(.333),F(.667)]}}};
}
/** Shape-only saved-value boundary. Unknown algorithm/transfer selections and
 * inactive parameter spellings survive; execution semantics are prepared later. */
export function parseFractalSourceColorConfiguration(value:unknown):FractalSourceColorConfiguration {
 const root=object(value,'fractalSourceColor');let text=0;
 const str=(v:unknown,p:string)=>{const s=string(v,p);text+=s.length;if(text>MAX_TEXT)throw new FractalSourceColorError('capacity',p,'local 1 MiB aggregate color text budget exceeded');return s;};
 function side(key:'inside'|'outside'):FractalSourceColorSideConfiguration {
  const s=object(root[key],key),raw=object(s.parameters,key+'.parameters'),parameters:Record<string,FractalSourceColorParameter>=Object.create(null);
  for(const[k,v]of Object.entries(raw)){str(k,key+'.parameters.key');parameters[k]=typeof v==='string'?str(v,key+'.'+k):Array.isArray(v)&&v.length===2?[number(v[0],k),number(v[1],k)]:number(v,k);}
  return{algorithm:str(s.algorithm,key+'.algorithm'),parameters,solidColor:str(s.solidColor,key+'.solidColor'),transfer:str(s.transfer,key+'.transfer'),density:number(s.density,key+'.density'),offset:number(s.offset,key+'.offset'),repeat:bool(s.repeat,key+'.repeat')};
 }
 const p=object(root.palette,'palette'),c=object(p.cosine,'palette.cosine');if(!Array.isArray(p.colors))return fail('palette.colors','array required');
 if(p.colors.length>MAX_COLORS)throw new FractalSourceColorError('capacity','palette.colors','local 65536-color preparation budget exceeded');
 if(p.space!=='rgb'&&p.space!=='hsv')return fail('palette.space','RGB or HSV required');
 return{inside:side('inside'),outside:side('outside'),palette:{colors:p.colors.map((v,i)=>str(v,`palette.colors[${i}]`)),offset:number(p.offset,'palette.offset'),gamma:number(p.gamma,'palette.gamma'),space:p.space,useCosine:bool(p.useCosine,'palette.useCosine'),cosine:{a:triple(c.a,'cosine.a'),b:triple(c.b,'cosine.b'),c:triple(c.c,'cosine.c'),d:triple(c.d,'cosine.d')}}};
}
function scalar(raw:unknown,fallback:number,precision:'float32'|'float64'='float32'):number {
 // ConfigUtils invalid expressions recover to zero, whereas missing/wrong type
 // uses its caller default. This is independent of local MathJS authoring.
 const parsed=prepareDomainSourceScalar(raw,{fallback,precision});if(!parsed.ok)throw new FractalSourceColorError('capacity','parameter',`source scalar ${parsed.error.resource} budget exceeded`);
 return parsed.facts.fallbackReason==='invalid-expression'?0:parsed.facts.value;
}
function bindParameter(d:FractalSourceColorParameterDescriptor,raw:unknown):FractalSourceColorParameter {
 if(d.type==='number'){
  let value=scalar(raw,d.default as number);if(!Number.isFinite(value))value=0;
  if(d.min!==undefined)value=Math.max(value,F(d.min));if(d.max!==undefined)value=Math.min(value,F(d.max));return value;
 }
 if(d.type==='select'){
  const text=typeof raw==='string'?raw:String(d.default);return d.choices!.find(x=>x.toLowerCase()===text.toLowerCase())??d.choices![0];
 }
 const pair=Array.isArray(raw)&&raw.length>=2?raw:raw&&typeof raw==='object'&&!Array.isArray(raw)?[(raw as Record<string,unknown>).re,(raw as Record<string,unknown>).im]:[0,0];
 return pair.slice(0,2).map(v=>{const value=scalar(v,0,'float64');return Number.isFinite(value)?value:0;}) as [number,number];
}
function parameters(s:FractalSourceColorSideConfiguration,id:FractalSourceColorAlgorithm):Record<string,FractalSourceColorParameter>{
 const result:Record<string,FractalSourceColorParameter>=Object.create(null);
 for(const descriptor of descriptors[id])result[descriptor.key]=bindParameter(descriptor,own(s.parameters,descriptor.key)?s.parameters[descriptor.key]:undefined);
 return result;
}
function packed(raw:string,diagnostics:string[],solid=false):number {
 // parseColorSafely keeps the previous black for a Java blank solid string;
 // normal PApplet ConfigUtils catches malformed nonblank colors as white.
 if(solid&&isJavaBlank(raw))return 0xff000000;
 try{return sourceConfigPackedColor(raw);}catch(error){if(!(error instanceof SourceConfigColorError))throw error;diagnostics.push('Source color could not be parsed; the retained parser uses white. Original text is preserved.');return 0xffffffff;}
}
const rgb=(v:number):[number,number,number]=>[F(((v>>>16)&255)/255),F(((v>>>8)&255)/255),F((v&255)/255)];
export function fractalSourceColorRgbHex(value:string):string{return'#'+(packed(value,[])&0xffffff).toString(16).padStart(6,'0').toUpperCase();}
export function withFractalSourceColorRgb(value:string,rgbHex:string):string{if(!/^#[0-9a-fA-F]{6}$/.test(rgbHex))return fail('color','six-digit RGB replacement required');return'#'+(((packed(value,[])&0xff000000)|parseInt(rgbHex.slice(1),16))>>>0).toString(16).padStart(8,'0').toUpperCase();}
function prepareSide(s:FractalSourceColorSideConfiguration,power:number,bailout:number,diagnostics:string[]):PreparedFractalSourceColorSide {
 const id=algorithm(s.algorithm),p=parameters(s,id),v=(key:string,fallback:number)=>typeof p[key]==='number'?p[key] as number:F(fallback);
 const p0:[number,number,number,number]=[0,1,F(Math.max(2,power)),Math.max(F(1e-12),bailout)],p1:[number,number,number,number]=[0,0,0,1],p2:[number,number,number,number]=[.25,0,0,0];
 if(id==='basic')p0[0]=['ITERATION','REAL','IMAGINARY','SUM'].indexOf(p.metric as string);
 else if(id==='binary_decomposition')p0[0]=p.type==='TYPE_2'?1:0;
 else if(id==='smooth_mandelbrot'){
  let re=v('power',p0[2]),im=0;const exponent=p.exponent as [number,number];
  if(Number.isFinite(F(exponent[0]))&&Number.isFinite(F(exponent[1]))){re=F(exponent[0]);im=F(exponent[1]);}
  if(!Number.isFinite(re)||!Number.isFinite(im)||(Math.abs(re)<F(1e-6)&&Math.abs(im)<F(1e-6))){re=p0[2];im=0;}
  const radius=v('bailout',p0[3]);p0[0]=re;p0[1]=im;p0[2]=Math.max(F(1e-12),Number.isFinite(radius)&&radius>0?radius:p0[3]);p0[3]=0;
 }else if(id==='distance_estimator')p0[2]=Math.max(2,v('power',2));
 else if(id==='direct_domain'||id==='direct_normalized_z'||id==='direct_orbit_trap'){
  p0[0]=id==='direct_orbit_trap'?clamp(v('mix_factor',0)):Math.max(id==='direct_domain'?F(1e-6):0,v('scale',1));
  p0[1]=Math.max(F(1e-6),v('gamma',1));p0[2]=clamp(v('saturation',.8));p0[3]=Math.max(F(1e-6),v('trap_radius',.5));
 }
 if(id==='direct_orbit_trap'||id==='orbit_trap_index'){
  if(id==='orbit_trap_index'){p0[0]=1;p0[3]=Math.max(F(1e-6),v('trap_radius',.5));}
  p1[0]=v('trap_center_x',0);p1[1]=v('trap_center_y',0);p1[2]=v('trap_angle',0);p1[3]=Math.max(F(1e-6),v('trap_aspect',1));
  p2[0]=Math.max(F(1e-6),v('threshold',.25));p2[1]=['point','ring','cross'].indexOf(p.trap_shape as string);if(id==='direct_orbit_trap')p2[2]=clamp(v('merge_opacity',.2));
 }
 const transfer=javaTrim(s.transfer).toLowerCase(),transferId=(FRACTAL_SOURCE_COLOR_TRANSFERS as readonly string[]).indexOf(transfer);if(transferId<0)return fail('transfer','unsupported source transfer: '+s.transfer);
 return Object.freeze({algorithm:id,algorithmId:FRACTAL_SOURCE_COLOR_ALGORITHMS.indexOf(id)+1,p0:Object.freeze(p0),p1:Object.freeze(p1),p2:Object.freeze(p2),solid:Object.freeze(rgb(packed(s.solidColor,diagnostics,true))),transferId,density:Math.max(F(1e-6),f32(s.density,'density')),offset:f32(s.offset,'offset'),repeat:s.repeat});
}
// Keys retain every authored input and runtime override. This is intentionally
// stronger than PaletteRuntime's 32-bit hash, so hash collisions cannot reuse a
// different LUT. Object property order cannot change the identity.
function keyOf(value:unknown):string {if(typeof value==='number')return Object.is(value,-0)?'-0':String(value);if(Array.isArray(value))return'['+value.map(keyOf).join(',')+']';if(value&&typeof value==='object')return'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+keyOf((value as Record<string,unknown>)[k])).join(',')+'}';return JSON.stringify(value)??'undefined';}
const owned=new WeakMap<PreparedFractalSourceColor,{lut:Float32Array;bits:Uint32Array}>();
export function prepareFractalSourceColor(input:FractalSourceColorInput):PreparedFractalSourceColor {
 const config=parseFractalSourceColorConfiguration(input.configuration),power=number(input.formulaPower,'formulaPower'),bailout=f32(number(input.bailout,'bailout'),'bailout');
 if(!Number.isInteger(power)||power< -2147483648||power>2147483647)return fail('formulaPower','mapped source signed int required');
 const diagnostics:string[]=[],inside=prepareSide(config.inside,power,bailout,diagnostics),outside=prepareSide(config.outside,power,bailout,diagnostics),lut=sourcePaletteRuntimeLut(config.palette,input.runtime,diagnostics);
 const plan:PreparedFractalSourceColor=Object.freeze({profile:FRACTAL_SOURCE_COLOR_PROFILE,key:keyOf({config,power,bailout,runtime:input.runtime}),lutKey:keyOf({palette:config.palette,runtime:input.runtime}),lut,lutSize:1024,inside,outside,diagnostics:Object.freeze(diagnostics)});owned.set(plan,{lut,bits:new Uint32Array(lut.buffer.slice(0))});return plan;
}
export function validatePreparedFractalSourceColor(plan:PreparedFractalSourceColor):void {
 const state=plan&&owned.get(plan);
 if(!state||state.lut!==plan.lut||plan.lut.length!==3072||plan.lut.byteLength!==12288)return fail('colorPlan','prepared source color ownership or storage is invalid');
 const bits=new Uint32Array(plan.lut.buffer,plan.lut.byteOffset,plan.lut.length);
 for(let i=0;i<bits.length;i++)if(bits[i]!==state.bits[i])return fail('colorPlan.lut','owned LUT was mutated after preparation');
}

export interface FractalSourceColorImport {
 configuration:FractalSourceColorConfiguration;
 /** Exact source member paths examined by this owner, relative to the supplied
  * native root. Containers do not imply that unknown descendants were read. */
 consumedPaths:string[][];
 diagnostics:string[];
}
/** Native JsonComplexFractalConfig color boundary. Raw source remains the
 * document importer's provenance; this returns its independently usable,
 * JSON-safe runtime configuration without interpreting the local color model. */
export function prepareFractalSourceColorImport(value:unknown):FractalSourceColorImport {
 const root=object(value,'source'),configuration=createDefaultFractalSourceColorConfiguration(),consumedPaths:string[][]=[],diagnostics:string[]=[];
 const read=(o:Record<string,unknown>,key:string,path:string[])=>{if(!own(o,key))return undefined;const value=o[key];if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length===0)consumedPaths.push([...path,key]);return value;};
 const has=(o:Record<string,unknown>,key:string)=>own(o,key);
 const getString=(raw:unknown,fallback:string)=>typeof raw==='string'?raw:raw==null?fallback:typeof raw==='boolean'?String(raw):'';
 const getBoolean=(raw:unknown,fallback:boolean,field:string)=>{if(raw===undefined)return fallback;if(typeof raw==='boolean')return raw;if(typeof raw==='string'&&/^(true|false)$/i.test(raw))return raw.toLowerCase()==='true';return fail(field,'source boolean required');};
 const finiteScalar=(raw:unknown,fallback:number,field:string)=>number(scalar(raw,fallback),field);
 function importParameters(raw:Record<string,unknown>|undefined,id:FractalSourceColorAlgorithm,path?:string[]):Record<string,FractalSourceColorParameter>{
  const values:Record<string,FractalSourceColorParameter>=Object.create(null);
  for(const d of descriptors[id]){
   const value=raw?(path?read(raw,d.key,path):raw[d.key]):undefined;
   if(path&&d.type==='complex'&&value&&typeof value==='object'&&!Array.isArray(value)){read(value as Record<string,unknown>,'re',[...path,d.key]);read(value as Record<string,unknown>,'im',[...path,d.key]);}
   values[d.key]=bindParameter(d,value);
  }
  return values;
 }
 if(has(root,'color')){
  const color=object(read(root,'color',[]),'color'),path=['color'],p=configuration.palette;
  const offset=scalar(read(color,'palette_offset',path),p.offset);if(Number.isFinite(offset))p.offset=offset;else diagnostics.push('Nonfinite source palette offset retains its default.');
  const gamma=scalar(read(color,'palette_gamma',path),p.gamma);if(Number.isFinite(gamma))p.gamma=Math.max(F(.01),gamma);else diagnostics.push('Nonfinite source palette gamma retains its default.');
  if(has(color,'palette_space')){const raw=string(read(color,'palette_space',path),'color.palette_space'),space=javaTrim(raw).toLowerCase();if(space==='rgb'||space==='hsv')p.space=space;else diagnostics.push('Unknown source palette space retains RGB.');}
  if(has(color,'use_cosine_palette'))p.useCosine=getBoolean(read(color,'use_cosine_palette',path),p.useCosine,'color.use_cosine_palette');
  if(has(color,'use_curve_palette')){getBoolean(read(color,'use_curve_palette',path),false,'color.use_curve_palette');diagnostics.push('The retained GPU PaletteRuntime does not consume use_curve_palette. The source field is preserved in provenance.');}
  for(const key of ['a','b','c','d'] as const){
   const field='cosine_'+key;if(!has(color,field))continue;const raw=read(color,field,path);if(!Array.isArray(raw))return fail('color.'+field,'source array required');
   if(raw.length>=3)p.cosine[key]=raw.slice(0,3).map((v,i)=>number(scalar(v==null?String(v):typeof v==='object'||typeof v==='boolean'?String(v):v,p.cosine[key][i]),'color.'+field)) as [number,number,number];
  }
  const mode=getString(read(color,'coloring_mode',path),'NORMAL');
  let directId:FractalSourceColorAlgorithm='direct_domain',directParams:Record<string,unknown>={};
  if(has(color,'direct')){
   const direct=object(read(color,'direct',path),'color.direct'),directPath=[...path,'direct'],rawId=getString(read(direct,'algorithm',directPath),'DOMAIN');
   directId=rawId.toUpperCase()==='ORBIT_TRAP'?'direct_orbit_trap':rawId.toUpperCase()==='NORMALIZED_Z'?'direct_normalized_z':'direct_domain';
   for(const[key,defaultValue]of [['scale',1],['gamma',1],['saturation',F(.8)],['trap_radius',.5]] as const)directParams[key]=scalar(read(direct,key,directPath),defaultValue);
  }
  for(const sideName of ['inside','outside'] as const){
   const side=configuration[sideName];
   if(!has(color,sideName)){side.offset=p.offset;continue;}
   const raw=object(read(color,sideName,path),'color.'+sideName),sidePath=[...path,sideName];
   function interpretation(o:Record<string,unknown>,at:string[]){
    side.density=finiteScalar(read(o,'color_density',at),side.density,at.join('.')+'.color_density');
    const transfer=getString(read(o,'transfer_function',at),side.transfer),canonical=javaTrim(transfer).toLowerCase();side.transfer=(FRACTAL_SOURCE_COLOR_TRANSFERS as readonly string[]).includes(canonical)?canonical:'linear';
    if(side.transfer!==canonical)diagnostics.push('Unknown source transfer function uses LINEAR.');
    side.offset=finiteScalar(read(o,'gradient_offset',at),side.offset,at.join('.')+'.gradient_offset');
    // getBoolean(key,default) catches invalid values and retains the fallback.
    const repeat=read(o,'repeat_gradient',at);if(typeof repeat==='boolean')side.repeat=repeat;else if(typeof repeat==='string'&&/^(true|false)$/i.test(repeat))side.repeat=repeat.toLowerCase()==='true';
    if(has(o,'solid_color')){const solid=string(read(o,'solid_color',at),at.join('.')+'.solid_color');if(!isJavaBlank(solid))side.solidColor=solid;}
   }
   interpretation(raw,sidePath);
   const requested=getString(read(raw,'algorithm_id',sidePath),side.algorithm),recognized=(FRACTAL_SOURCE_COLOR_ALGORITHMS as readonly string[]).includes(requested);
   const rawParams=has(raw,'algorithm_params')?object(read(raw,'algorithm_params',sidePath),sidePath.join('.')+'.algorithm_params'):undefined;
   if(recognized){side.algorithm=requested;side.parameters=importParameters(rawParams,requested as FractalSourceColorAlgorithm,[...sidePath,'algorithm_params']);}
   else{diagnostics.push('Unknown source coloring algorithm uses the side default. Original selection is preserved in provenance.');side.parameters=importParameters(undefined,side.algorithm as FractalSourceColorAlgorithm,[]);}
   if(has(raw,'interpretation'))interpretation(object(read(raw,'interpretation',sidePath),sidePath.join('.')+'.interpretation'),[...sidePath,'interpretation']);
  }
  if(mode.toUpperCase()==='DIRECT')for(const key of ['inside','outside'] as const){configuration[key].algorithm=directId;configuration[key].parameters=importParameters(directParams,directId);}
 }
 if(has(root,'palette')){const raw=read(root,'palette',[]);if(!Array.isArray(raw))return fail('palette','source array required');if(raw.length>MAX_COLORS)throw new FractalSourceColorError('capacity','palette','local 65536-color preparation budget exceeded');configuration.palette.colors=raw.map((v,i)=>string(v,`palette[${i}]`));}
 // Preserve valid source color spelling, including invalid strings whose source
 // parser recovers to white; diagnostics are observed without baking RGB.
 const parsed=parseFractalSourceColorConfiguration(configuration);
 for(const color of parsed.palette.colors)packed(color,diagnostics);
 for(const side of [parsed.inside,parsed.outside])packed(side.solidColor,diagnostics,true);
 return{configuration:parsed,consumedPaths,diagnostics:[...new Set(diagnostics)]};
}
