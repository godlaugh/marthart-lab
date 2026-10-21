import {prepareDomainSourceScalar,prepareDomainSourceObjectScalar,DOMAIN_SOURCE_SCALAR_LIMITS} from './domainSourceScalar';
import {isJavaBlank,javaTrim} from './sourceJavaText';

export interface SourceFractalFormulaDefinition {
 readonly name:string;readonly kind:'float'|'complex';readonly semantic:string;
 readonly defaultValue:number|readonly[number,number];readonly min?:number;readonly max?:number;
}
export interface SourceFractalFormulaParamSet {
 readonly floats:Readonly<Record<string,number>>;
 readonly complex:Readonly<Record<string,readonly[number,number]>>;
}
export interface SourceFractalFormulaConfiguration {
 readonly formulaId?:string|null;readonly fractalType:'mandelbrot'|'julia';readonly power:number;
 readonly formulaParams:readonly[number,number,number,number];readonly bailout:number;readonly julia:readonly[number,number];
 /** Omission means the original config has no ParamSet. Empty typed maps are a supplied set. */
 readonly parameters?:SourceFractalFormulaParamSet;
}
export interface SourceFractalFormulaNativeState {
 readonly fractalType:'mandelbrot'|'julia';readonly power:number;readonly bailout:number;readonly julia:readonly[number,number];
 readonly formulaParams:readonly[number,number,number,number];readonly dynamicParams:readonly number[];
}
export interface SourceFractalFormulaRuntimeOptions {
 readonly formulaId:string;readonly fractalType:'mandelbrot'|'julia';
 readonly initialNative:{readonly power:number;readonly bailout:number;readonly julia:readonly[number,number];readonly formulaParams:readonly[number,number,number,number]};
 readonly parameters?:SourceFractalFormulaParamSet;
}
const F=Math.fround;
const scalar=(name:string,value:number,min?:number,max?:number,semantic=name):SourceFractalFormulaDefinition=>Object.freeze({name,kind:'float',semantic,defaultValue:F(value),...(min===undefined?{}:{min:F(min)}),...(max===undefined?{}:{max:F(max)})});
const complex=(name:string,re:number,im:number,semantic=name):SourceFractalFormulaDefinition=>Object.freeze({name,kind:'complex',semantic,defaultValue:Object.freeze([re,im]) as readonly[number,number]});
/** Exact StandardFormulaCatalog metadata order; slots may intentionally collide.
 * Runtime setters do not apply the binder's catalog-range validation. */
export const SOURCE_FRACTAL_FORMULA_METADATA:Readonly<Record<string,readonly SourceFractalFormulaDefinition[]>>=Object.freeze({
 "mandelbrot":Object.freeze([scalar("power",2.0,2.0),scalar("bailout",4.0,0),complex("start_point",0,0)]),
 "julia":Object.freeze([scalar("power",2.0,2.0),scalar("bailout",4.0,0),complex("julia_seed",-0.8,0.156)]),
 "newton":Object.freeze([complex("exponent",3.0,0,"power"),scalar("bailout",0.001,0),scalar("relaxation",1,0)]),
 "nova":Object.freeze([complex("exponent",3.0,0,"power"),scalar("bailout",0.001,0),complex("start_value",1,0),scalar("relaxation",1,0),complex("julia_seed",0,0)]),
 "phoenix":Object.freeze([complex("start_value",0,0),complex("julia_seed",0,0),scalar("exponent1",2.0,1),scalar("exponent2",0,0),complex("distortion",0,0),scalar("bailout",4.0,0)]),
 "magnet1":Object.freeze([complex("perturbation",0,0),complex("parameter",0,0,"julia_seed"),scalar("bailout",30.0,0),scalar("convergent_bailout",0.001,0)]),
 "magnet2":Object.freeze([complex("perturbation",0,0),complex("parameter",0,0,"julia_seed"),scalar("bailout",30.0,0),scalar("convergent_bailout",5e-05,0)]),
 "lambda":Object.freeze([complex("start_value",0.5,0),complex("julia_seed",0.6,0),complex("lambda",0.6,0),scalar("bailout",4.0,0)]),
 "c_sin":Object.freeze([complex("start_value",1.57079632679,0),complex("julia_seed",-0.2,0.75),scalar("bailout",16.0,0)]),
 "spiral_septagon":Object.freeze([complex("start_value",1,0),complex("julia_seed",0.2,0),scalar("exponent",7.0,0.1),scalar("singularity_guard_eps",1e-10,1e-20),scalar("bailout",32.0,0)]),
 "binocular":Object.freeze([scalar("power",4.0,2.0,24.0),complex("quad_coeff",1,0,"a"),complex("const_term",1,0,"bin_const"),complex("z0_coeff",-1.0,0,"bin_z0"),scalar("denom_offset",1,undefined,undefined,"bin_denom"),scalar("relaxation",1,0),complex("julia_seed",0,0),scalar("bailout",0.001,0)]),
 "mandelbulb_3d":Object.freeze([scalar("power",8.0,2.0,24.0),scalar("bailout",2.0,0.5,8.0),scalar("phase_shift",0,-3.141592653589793,3.141592653589793),scalar("phase_speed",0.05,-1.0,1),scalar("camera_pitch",0.78,0.15,1.45),scalar("surface_epsilon",0.001,0.0001,0.02),scalar("shadow_strength",10.0,0,32.0)]),
});
const own=(o:object,k:string)=>Object.hasOwn(o,k);
const finite=(n:number,label:string)=>{if(typeof n!=='number'||!Number.isFinite(n))throw Error(`原版分形公式${label}必须有限`);return n;};
const float=(n:number,label:string)=>finite(F(finite(n,label)),label);
const metadata=(id:string)=>{if(!own(SOURCE_FRACTAL_FORMULA_METADATA,id))throw Error(`不支持原版分形公式 ${id}`);return SOURCE_FRACTAL_FORMULA_METADATA[id];};
const pair=(p:readonly[number,number],label:string):[number,number]=>{if(!Array.isArray(p)||p.length!==2)throw Error(`原版分形公式${label}需要两个分量`);return[finite(p[0],label),finite(p[1],label)];};
const fp=(v:readonly[number,number,number,number]):[number,number,number,number]=>{if(!Array.isArray(v)||v.length!==4)throw Error('原版分形公式需要四个传统参数槽');return v.map(n=>float(n,'传统参数')) as [number,number,number,number];};
const type=(v:unknown):'mandelbrot'|'julia'=>{if(v!=='mandelbrot'&&v!=='julia')throw Error('原版分形模式无效');return v;};
const int=(n:number)=>Math.max(-2147483648,Math.min(2147483647,Math.trunc(finite(n,'整数'))));
const roundFloatInt=(n:number)=>Math.max(-2147483648,Math.min(2147483647,Math.floor(n+.5)));
const roundDoubleLongInt=(n:number)=>{const value=n>=2**63?(1n<<63n)-1n:n<-(2**63)?-(1n<<63n):BigInt(Math.floor(n+.5));return Number(BigInt.asIntN(32,value));};
const slots:Readonly<Record<string,number>>=Object.freeze({power:0,exponent:0,relaxation:2,relax:2,bailout:3,julia_seed:4,start_value:4,seed:4,parameter:4,a:6,phi:8,distortion:8,singularity_guard_eps:10,guard_eps:10,phase_shift:11,phase_speed:12,camera_radius:13,camera_pitch:14,rotation_speed:15,surface_epsilon:16,shadow_strength:17,ray_scale:18,bin_const:19,bin_z0:21,bin_denom:23});
/** Owns original typed ParamSet presence independently of native renderer fields.
 * Metadata reads provide defaults without inserting them. Every accepted registry
 * write remaps all native fields; ordinary setters never mutate or remap ParamSet. */
export class SourceFractalFormulaRuntime {
 readonly formulaId:string;
 private readonly floats=new Map<string,number>();private readonly pairs=new Map<string,readonly[number,number]>();
 private native:{fractalType:'mandelbrot'|'julia';power:number;bailout:number;julia:[number,number];formulaParams:[number,number,number,number];dynamicParams:number[]};
 private failed=false;
 constructor(options:SourceFractalFormulaRuntimeOptions){
  metadata(options.formulaId);this.formulaId=options.formulaId;
  this.native={fractalType:type(options.fractalType),power:int(options.initialNative.power),bailout:float(options.initialNative.bailout,'bailout'),julia:pair(options.initialNative.julia,'Julia'),formulaParams:fp(options.initialNative.formulaParams),dynamicParams:Array(32).fill(0)};
  if(options.parameters){
   for(const [name,value]of Object.entries(options.parameters.floats)){if(this.definition(name)?.kind!=='float')throw Error(`原版浮点参数元数据不匹配 ${name}`);this.floats.set(name,float(value,name));}
   for(const [name,value]of Object.entries(options.parameters.complex)){if(this.definition(name)?.kind!=='complex')throw Error(`原版复数参数元数据不匹配 ${name}`);this.pairs.set(name,pair(value,name));}
  }
 }
 private ensure(){if(this.failed)throw Error('原版分形公式状态已失败，需要重建');}
 private run(action:()=>void){this.ensure();try{action();}catch(error){this.failed=true;throw error;}}
 definitions(){this.ensure();return metadata(this.formulaId);}
 definition(name:string){return metadata(this.formulaId).find(d=>d.name===name);}
 readScalar(name:string):number|undefined {this.ensure();const d=this.definition(name);return d?.kind==='float'?this.floats.get(name)??d.defaultValue as number:undefined;}
 readComplex(name:string):readonly[number,number]|undefined {this.ensure();const d=this.definition(name);return d?.kind==='complex'?Object.freeze([...(this.pairs.get(name)??d.defaultValue as readonly[number,number])]) as readonly[number,number]:undefined;}
 writeScalar(name:string,value:number):void {this.run(()=>{if(this.definition(name)?.kind!=='float')return;this.floats.set(name,float(value,name));this.map(false);});}
 writeComplex(name:string,re:number,im:number):void {this.run(()=>{if(this.definition(name)?.kind!=='complex')return;this.pairs.set(name,pair([re,im],name));this.map(false);});}
 setBailout(value:number):void {this.run(()=>{this.native.bailout=Math.max(F(1e-6),float(value,'bailout'));});}
 setJuliaConstant(re:number,im:number):void {this.run(()=>{this.native.julia=pair([re,im],'Julia');});}
 nativeState():SourceFractalFormulaNativeState {this.ensure();return Object.freeze({...this.native,julia:Object.freeze([...this.native.julia]) as readonly[number,number],formulaParams:Object.freeze([...this.native.formulaParams]) as readonly[number,number,number,number],dynamicParams:Object.freeze([...this.native.dynamicParams])});}
 snapshot(){this.ensure();return Object.freeze({formulaId:this.formulaId,parameters:Object.freeze({floats:Object.freeze(Object.fromEntries(this.floats)),complex:Object.freeze(Object.fromEntries([...this.pairs].map(([k,v])=>[k,Object.freeze([...v])])))}),native:this.nativeState()});}
 /** Only the initial applyConfig call can receive a null supplied ParamSet. */
 remap(initialParamSetAbsent=false):void {this.run(()=>this.map(initialParamSetAbsent));}
 private map(absent:boolean){
  const n=this.native,id=this.formulaId,isJulia=n.fractalType==='julia',s=(key:string,fallback:number)=>absent?fallback:this.floats.get(key)??fallback,c=(key:string)=>absent?undefined:this.pairs.get(key),j=(value:readonly[number,number]|undefined)=>{if(value)n.julia=[...value];};
  n.dynamicParams=Array(32).fill(0);
  if(!absent)for(const d of this.definitions()){
   if(!own(slots,d.semantic))continue;const index=slots[d.semantic];
   if(d.kind==='float')n.dynamicParams[index]=this.readScalar(d.name)!;
   else{const value=this.readComplex(d.name)!;n.dynamicParams[index]=float(value[0],d.name);n.dynamicParams[index+1]=float(value[1],d.name);}
  }
  // DomainService's high-precision sync precedes the traditional mapper.
  if(id==='julia')j(c('julia_seed'));
  else if(id==='nova'||id==='phoenix'||id==='c_sin'||id==='spiral_septagon')j(c(isJulia?'julia_seed':'start_value'));
  else if(id==='magnet1'||id==='magnet2')j(c('parameter')??c('julia_seed'));
  else if(id==='lambda')j(isJulia?c('julia_seed')??c('lambda'):c('start_value'));
  const bailout=(floor:number,fallback=n.bailout)=>{n.bailout=Math.max(F(floor),s('bailout',fallback));};
  const exponent=(fallback:number)=>{const real=Math.max(2,s('power',fallback));n.power=Math.max(2,roundFloatInt(real));return real;};
  if(id==='mandelbrot'||id==='julia'){
   n.fractalType=id;const real=exponent(n.power);bailout(1e-6);if(id==='julia')j(c('julia_seed'));n.formulaParams[0]=real;
  }else if(id==='newton'||id==='nova'){
   const newton=id==='newton';if(newton)n.fractalType='mandelbrot';const value=c('exponent');if(value)n.power=roundDoubleLongInt(value[0]);else if(!absent)n.power=Math.max(2,n.power);
   bailout(1e-12);const relax=s('relaxation',1);
   if(!newton){if(isJulia)j(c('julia_seed'));else j(c('start_value')??[1,0]);}
   n.formulaParams=[F(n.power),relax,0,0];
  }else if(id==='phoenix'){
   const e1=s('exponent1',n.power),e2=s('exponent2',0);n.power=Math.max(2,roundFloatInt(e1));bailout(1e-6);const distortion=c('distortion')??[0,0];n.formulaParams=[e1,e2,float(distortion[0],'distortion'),float(distortion[1],'distortion')];j(c(isJulia?'julia_seed':'start_value'));
  }else if(id==='magnet1'||id==='magnet2'){
   bailout(1e-6);n.formulaParams=[s('convergent_bailout',F(id==='magnet2'?5e-5:.001)),0,0,0];if(!absent){if(isJulia)j(c('parameter')??c('julia_seed'));else j(c('perturbation')??[0,0]);}
  }else if(id==='lambda'||id==='c_sin'||id==='spiral_septagon'){
   bailout(1e-6);n.formulaParams=[0,0,0,0];if(id==='c_sin'){n.power=2;n.formulaParams[0]=2;}
   j(isJulia?(id==='lambda'?c('julia_seed')??c('lambda'):c('julia_seed')):c('start_value'));
  }else if(id==='binocular'){
   const real=exponent(4);bailout(1e-12,F(.001));n.formulaParams=[real,0,0,0];if(isJulia)j(c('julia_seed'));
  }else if(id==='mandelbulb_3d'){
   n.fractalType='mandelbrot';const real=exponent(8);bailout(.5,2);n.formulaParams=[real,0,0,0];
  }
 }
}
/** Initial applyConfig replacement on a fresh mobject. Source null ParamSet and
 * supplied-empty ParamSet remain distinct through packing and late overrides. */
export function createSourceFractalFormulaFromConfig(config:SourceFractalFormulaConfiguration):SourceFractalFormulaRuntime {
 const fractalType=type(config.fractalType),raw=config.formulaId,formulaId=raw==null||isJavaBlank(raw)?fractalType:raw;
 const runtime=new SourceFractalFormulaRuntime({formulaId,fractalType,initialNative:{power:Math.max(2,int(config.power)),bailout:0,julia:[0,0],formulaParams:config.formulaParams},...(raw!=null&&config.parameters?{parameters:config.parameters}:{})});
 if(raw!=null)runtime.remap(config.parameters===undefined);
 if(raw==null||config.parameters===undefined){runtime.setBailout(config.bailout);runtime.setJuliaConstant(...config.julia);}
 return runtime;
}
export type SourceFractalFormulaBindingResult<T>={ok:true;value:T}|{ok:false;error:{kind:'input'|'capacity'|'unsupported';path:readonly string[];reason:string}};
export interface SourceFractalFormulaBindingFacts {parameters:SourceFractalFormulaParamSet;consumedPaths:string[][];numericPaths:string[][];diagnostics:string[];}
/** JsonFormulaParamBinder's finite canonical result; source nonfinite parsed
 * values are normalized to zero by its validation before bounds are applied. */
export function bindSourceFractalFormulaParameters(formulaId:string,raw:unknown):SourceFractalFormulaBindingResult<SourceFractalFormulaBindingFacts>{
 if(!own(SOURCE_FRACTAL_FORMULA_METADATA,formulaId))return{ok:false,error:{kind:'unsupported',path:[],reason:'未注册的原版公式'}};
 if(raw===null||typeof raw!=='object'||Array.isArray(raw))return{ok:false,error:{kind:'input',path:[],reason:'原版 parameters 必须是 JSON 对象'}};
 const input=raw as Record<string,unknown>,floats:Record<string,number>={},complex:Record<string,readonly[number,number]>={},consumedPaths:string[][]=[],numericPaths:string[][]=[],diagnostics:string[]=[];
 const parse=(value:unknown,precision:'float32'|'float64',path:string[])=>{
  if(typeof value==='number')numericPaths.push(path);
  const parsed=prepareDomainSourceScalar(value,{fallback:0,precision});
  if(!parsed.ok)throw{kind:'capacity',path,reason:`公式参数超过 ${parsed.error.resource} 预算`} as const;
  if(parsed.facts.route==='fallback'&&typeof value==='string')diagnostics.push(`${path.join('.')}: 原版表达式解析失败，采用 0。`);
  return Number.isFinite(parsed.facts.value)?parsed.facts.value:0;
 };
 try{
  for(const d of metadata(formulaId)){
   const present=own(input,d.name),value=present?input[d.name]:undefined,path=[d.name];
   if(d.kind==='float'){
    if(present)consumedPaths.push(path);let v=typeof value==='number'||typeof value==='string'?parse(value,'float32',path):d.defaultValue as number;
    if(d.min!==undefined&&v<d.min)v=d.min;if(d.max!==undefined&&v>d.max)v=d.max;floats[d.name]=v;
   }else{
    let v:readonly[number,number];
    if(Array.isArray(value)&&value.length>=2){consumedPaths.push([...path,'0'],[...path,'1']);v=[parse(value[0],'float64',[...path,'0']),parse(value[1],'float64',[...path,'1'])];}
    else if(value!==null&&typeof value==='object'&&!Array.isArray(value)){
     const o=value as Record<string,unknown>;for(const component of ['re','im'])if(own(o,component))consumedPaths.push([...path,component]);
     if(!Object.keys(o).length)consumedPaths.push(path);v=[parse(o.re,'float64',[...path,'re']),parse(o.im,'float64',[...path,'im'])];
    }else{if(present)consumedPaths.push(path);v=d.defaultValue as readonly[number,number];}
    complex[d.name]=[...v];
   }
  }
  if(!Object.keys(input).length)consumedPaths.push([]);
  return{ok:true,value:{parameters:{floats,complex},consumedPaths,numericPaths,diagnostics}};
 }catch(error){return{ok:false,error:error as Extract<SourceFractalFormulaBindingResult<never>,{ok:false}>['error']};}
}
export interface SourceFractalFormulaImportFacts {configuration:SourceFractalFormulaConfiguration;consumedPaths:string[][];numericPaths:string[][];diagnostics:string[];}
/** Formula-related JsonComplexFractalConfig ingress. Object input cannot recover
 * Java Long versus Double token identity for out-of-int32 integer JSON numbers;
 * that ambiguous case is explicitly unsupported rather than guessed. */
export function importSourceFractalFormulaConfiguration(raw:unknown):SourceFractalFormulaBindingResult<SourceFractalFormulaImportFacts>{
 const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
 if(raw!==undefined&&!object(raw))return{ok:false,error:{kind:'input',path:[],reason:'原版 fractal 必须为 JSON 对象'}};
 const input=(raw??{}) as Record<string,unknown>,consumedPaths:string[][]=[],numericPaths:string[][]=[],diagnostics:string[]=[];
 type ErrorDetail=Extract<SourceFractalFormulaBindingResult<never>,{ok:false}>['error'];
 const fail=(kind:ErrorDetail['kind'],path:string[],reason:string):never=>{throw{kind,path,reason} satisfies ErrorDetail;};
 const consume=(path:string[],value:unknown)=>{consumedPaths.push(path);if(typeof value==='number')numericPaths.push(path);};
 const bounded=(s:string,path:string[])=>{if(s.length>DOMAIN_SOURCE_SCALAR_LIMITS.characters)fail('capacity',path,'公式配置超过本地字符预算');return s;};
 const finiteValue=(v:number,path:string[])=>Number.isFinite(v)?v:fail('unsupported',path,'本地不能保存非有限原版公式配置');
 const parsed=(value:unknown,precision:'float32'|'float64',path:string[],expressionOnly=false)=>{
  const r=(expressionOnly?prepareDomainSourceObjectScalar:prepareDomainSourceScalar)(value,{fallback:0,precision});
  if(!r.ok)return fail('capacity',path,`公式配置超过 ${r.error.resource} 预算`);
  if(r.facts.route==='fallback')diagnostics.push(`${path.join('.')}: 原版解析失败，采用 0。`);
  return finiteValue(r.facts.value,path);
 };
 const configFloat=(o:Record<string,unknown>,key:string,fallback:number,path:string[])=>{
  if(!own(o,key))return fallback;const p=[...path,key],v=o[key];consume(p,v);
  if(v===null){const f=F(fallback);return Math.abs(f)>=1e7||f!==0&&Math.abs(f)<1e-3?0:f;}
  return parsed(v,'float32',p);
 };
 try{
  let fractalType:'mandelbrot'|'julia'='mandelbrot',formulaId:string|null=null,power=2,formulaParams:[number,number,number,number]=[2,0,0,0],bailout=F(4),julia:[number,number]=[-.8,.156],parameters:SourceFractalFormulaParamSet|undefined;
  if(own(input,'type')){consume(['type'],input.type);if(typeof input.type==='string'&&javaTrim(bounded(input.type,['type'])).toUpperCase()==='JULIA')fractalType='julia';}
  const idKey=own(input,'formula_id')?'formula_id':own(input,'formulaId')?'formulaId':undefined;
  if(idKey){const value=input[idKey];consume([idKey],value);if(value!=null){if(typeof value!=='string')return fail('unsupported',[idKey],'原版非字符串公式 ID 未注册');formulaId=bounded(value,[idKey]);if(!isJavaBlank(formulaId)&&!own(SOURCE_FRACTAL_FORMULA_METADATA,formulaId))return fail('unsupported',[idKey],'原版公式 ID 未注册或大小写不匹配');}}
  if(own(input,'formula')){
   consume(['formula'],input.formula);if(typeof input.formula!=='string')return fail('input',['formula'],'原版 formula 需要字符串');
   const text=javaTrim(bounded(input.formula,['formula'])).toUpperCase(),caret=text.indexOf('^');let extracted=2;
   if(caret>=0){const space=text.indexOf(' ',caret+1),token=text.slice(caret+1,space>caret?space:undefined).replace(/[^0-9-]/g,'');if(/^-?\d+$/.test(token)){const n=Number(token);if(n>=-2147483648&&n<=2147483647)extracted=n;}}
   power=Math.max(2,extracted);formulaParams[0]=F(power);
  }
  if(own(input,'power')){
   const v=input.power,p=['power'];consume(p,v);
   if(v===null){/* JSONObject.NULL uses the current integer fallback string. */}
   else if(typeof v==='number'){
    finiteValue(v,p);if(Number.isInteger(v)&&(v<-2147483648||v>2147483647))return fail('unsupported',p,'原始整数 token 的 Java Long/Double 身份已丢失，不能确定 intValue');power=int(v);
   }else if(typeof v==='string'&&/^[+-]?\d+$/.test(v)&&Number(v)>=-2147483648&&Number(v)<=2147483647)power=Number(v);
   else power=int(parsed(v,'float64',p,true));
  }
  if(own(input,'formula_params')){
   const v=input.formula_params;if(!object(v))return fail('input',['formula_params'],'原版 formula_params 需要对象');if(!Object.keys(v).length)consumedPaths.push(['formula_params']);
   const real=configFloat(v,'power',F(power),['formula_params']);if(real>=2){power=Math.max(2,roundFloatInt(real));formulaParams[0]=real;}
   for(let i=1;i<4;i++)formulaParams[i]=configFloat(v,`param${i}`,formulaParams[i],['formula_params']);
  }else formulaParams[0]=F(power);
  bailout=configFloat(input,'bailout',bailout,[]);
  if(own(input,'julia_constant')){
   const v=input.julia_constant;if(!Array.isArray(v))return fail('input',['julia_constant'],'原版 julia_constant 需要数组');
   if(v.length<2)consume(['julia_constant'],v);else for(let i=0;i<2;i++){const p=['julia_constant',String(i)];consume(p,v[i]);julia[i]=parsed(v[i],'float64',p);}
  }
  if(formulaId!==null&&own(input,'parameters')){
   // getJSONObject occurs before registry lookup, even for a blank ID.
   if(!object(input.parameters))return fail('input',['parameters'],'原版 parameters 需要对象');
   if(own(SOURCE_FRACTAL_FORMULA_METADATA,formulaId)){
    const bound=bindSourceFractalFormulaParameters(formulaId,input.parameters);if(!bound.ok)return{ok:false,error:{...bound.error,path:['parameters',...bound.error.path]}};
    parameters=bound.value.parameters;consumedPaths.push(...bound.value.consumedPaths.map(p=>['parameters',...p]));numericPaths.push(...bound.value.numericPaths.map(p=>['parameters',...p]));diagnostics.push(...bound.value.diagnostics.map(s=>'parameters.'+s));
   }
  }
  return{ok:true,value:{configuration:{formulaId,fractalType,power,formulaParams,bailout,julia,...(parameters?{parameters}:{})},consumedPaths,numericPaths,diagnostics}};
 }catch(error){
  if(error&&typeof error==='object'&&'kind'in error&&'path'in error&&'reason'in error)return{ok:false,error:error as ErrorDetail};throw error;
 }
}
