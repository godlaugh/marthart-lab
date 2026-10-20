import {DOMAIN_SOURCE_SCALAR_LIMITS,parseDomainSourceDouble,parseDomainSourceFloat,prepareDomainSourceObjectScalar,prepareDomainSourceScalar,type DomainSourceScalarResult} from './domainSourceScalar';
import {SOURCE_CAMERA_MODEL,type SourceCameraInput} from './sourceCamera';

export type OrdinarySourceCameraFamily='surface'|'implicit'|'attractor'|'perlin'|'map'|'symmetry';
export interface OrdinarySourceCameraImportOptions {
 /** Original top-level parameters. Only Surface/Implicit bind these names. */
 readonly parameters?:unknown;
 /** Already resolved JSONObject iteration order, from Reader.sourceKeys. Not textual insertion order. */
 readonly memberOrder?:readonly string[];
}
export type OrdinarySourceCameraImportError=
 | {readonly kind:'input';readonly path:string;readonly reason:'object-required'|'invalid-family'|'source-order-required'|'invalid-member-order'|'parameter-string-required'|'source-number-text-unknown'|'field-string-required'}
 | {readonly kind:'capacity';readonly path:string;readonly resource:string;readonly limit:number;readonly actual:number}
 | {readonly kind:'nonfinite';readonly path:string;readonly value:number};
export type OrdinarySourceCameraImportResult={readonly ok:true;readonly value:{readonly camera:SourceCameraInput;readonly diagnostics:string[]}}|
 {readonly ok:false;readonly error:OrdinarySourceCameraImportError};
/** Local admission, not MathArt file-format limits. Bound scope construction as
 * well as individual expression work. Capacity is never source fallback zero. */
export const ORDINARY_SOURCE_CAMERA_IMPORT_LIMITS=Object.freeze({parameters:8192,scopeCharacters:65536});
class ImportFailure extends Error {constructor(readonly detail:OrdinarySourceCameraImportError){super(detail.kind);}}
function fail(error:OrdinarySourceCameraImportError):never{throw new ImportFailure(error);}
function record(raw:unknown,path:string):Record<string,unknown>{
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||(Object.getPrototypeOf(raw)!==Object.prototype&&Object.getPrototypeOf(raw)!==null))return fail({kind:'input',path,reason:'object-required'});
 return raw as Record<string,unknown>;
}
function unwrap(result:DomainSourceScalarResult,path:string,diagnostics:string[]):number{
 if(!result.ok)return fail({...result.error,path});
 if(result.facts.route==='fallback')diagnostics.push(`${path}: 原版表达式解析失败，按 MathArt 1.7.8 返回 0。`);
 return result.facts.value;
}
function surfaceString(raw:string,path:string,bindings:ReadonlyMap<string,number>,diagnostics:string[]):number{
 const direct=parseDomainSourceFloat(raw);
 if(direct.ok)return direct.value;
 if(direct.error.kind==='capacity')return fail({...direct.error,path});
 return unwrap(prepareDomainSourceObjectScalar(raw,{fallback:0,precision:'float32',bindings}),path,diagnostics);
}
/** Any shortest binary64-roundtrip decimal stays on the same side of a float
 * rounding boundary except when the binary64 value is that exact boundary.
 * Retain that narrow unresolved Java Number.toString case explicitly. */
function numericSurface(raw:number,path:string):number{
 const rounded=Math.fround(raw);
 if(Number.isFinite(raw)&&!Number.isSafeInteger(raw)&&raw!==rounded){
  const buffer=new ArrayBuffer(4),view=new DataView(buffer);view.setFloat32(0,Math.abs(rounded));
  const bits=view.getUint32(0),magnitude=Math.abs(raw),base=Math.abs(rounded);
  view.setUint32(0,bits+(magnitude>base?1:-1));const neighbor=view.getFloat32(0);
  const midpoint=Number.isFinite(base)&&Number.isFinite(neighbor)?(base+neighbor)/2:2**128-2**103;
  if(magnitude===midpoint)fail({kind:'input',path,reason:'source-number-text-unknown'});
 }
 return rounded;
}
function surfaceFieldValue(raw:unknown,path:string,fallback:string,bindings:ReadonlyMap<string,number>,diagnostics:string[]):number {
 const value=raw??fallback;
 if(typeof value==='string'||typeof value==='boolean')return surfaceString(String(value),path,bindings,diagnostics);
 if(typeof value==='number')return numericSurface(value,path);
 diagnostics.push(`${path}: 原版 getString 后表达式无效，返回 0。`);return 0;
}
/** Surface bounds are parsed before the parameter map is constructed, so their
 * default scope is empty. Shares the exact getString/Float.parseFloat owner
 * with initial Surface camera fields, including numeric midpoint limitations. */
export function prepareSurfaceSourceStringField(raw:unknown,path:string,fallback:string):OrdinarySourceScalarResult<{value:number;diagnostics:string[]}>{return attempt(()=>{
 const diagnostics:string[]=[];return{value:finite(surfaceFieldValue(raw,path,fallback,new Map(),diagnostics),path),diagnostics};
});}
function parameters(raw:unknown,order:readonly string[]|undefined,diagnostics:string[]):ReadonlyMap<string,number>{
 const scope=new Map<string,number>();if(raw===undefined)return scope;
 const source=record(raw,'parameters'),keys=Object.keys(source);
 if(keys.length>ORDINARY_SOURCE_CAMERA_IMPORT_LIMITS.parameters)fail({kind:'capacity',path:'parameters',resource:'parameters',limit:ORDINARY_SOURCE_CAMERA_IMPORT_LIMITS.parameters,actual:keys.length});
 let characters=0,requiresOrder=false;
 for(const key of keys){
  const value=source[key];characters+=key.length+(typeof value==='string'?value.length:0);
  if(characters>ORDINARY_SOURCE_CAMERA_IMPORT_LIMITS.scopeCharacters)fail({kind:'capacity',path:'parameters',resource:'scopeCharacters',limit:ORDINARY_SOURCE_CAMERA_IMPORT_LIMITS.scopeCharacters,actual:characters});
  if(typeof value==='number')continue;
  if(typeof value!=='string')fail({kind:'input',path:`parameters.${key}`,reason:'parameter-string-required'});
  const direct=parseDomainSourceDouble(value);if(!direct.ok){if(direct.error.kind==='capacity')fail({...direct.error,path:`parameters.${key}`});requiresOrder=true;}
 }
 if(order&&(order.length!==keys.length||new Set(order).size!==keys.length||order.some(key=>!Object.hasOwn(source,key))))fail({kind:'input',path:'parameters',reason:'invalid-member-order'});
 if(requiresOrder&&!order)fail({kind:'input',path:'parameters',reason:'source-order-required'});
 for(const key of order??keys){
  const rawValue=source[key];
  if(typeof rawValue==='number'){scope.set(key,rawValue);continue;}
  const direct=parseDomainSourceDouble(rawValue as string);
  if(direct.ok)scope.set(key,direct.value);
  else scope.set(key,surfaceString(rawValue as string,`parameters.${key}`,scope,diagnostics));
 }
 // Source sorts currently defined names to allocate parser slots; binding exact
 // names directly has the same lookup result and avoids a second order owner.
 return scope;
}
export type OrdinarySourceScalarResult<T>={readonly ok:true;readonly value:T}|{readonly ok:false;readonly error:OrdinarySourceCameraImportError};
export interface OrdinarySourceScalarScope {
 readonly parameterValues:Readonly<Record<string,number>>;
 readonly diagnostics:readonly string[];
 camera(raw:unknown):OrdinarySourceCameraImportResult;
 /** JSONArray action read. Numeric values already passed through getFloat. */
 argument(raw:unknown,path:string):OrdinarySourceScalarResult<{value:number;diagnostics:string[]}>;
 /** getJsonFloat: direct getFloat first; missing uses caller default. */
 field(raw:unknown,path:string,fallback:number,present:boolean):OrdinarySourceScalarResult<{value:number;diagnostics:string[]}>;
}
function attempt<T>(run:()=>T):OrdinarySourceScalarResult<T>{try{return{ok:true,value:run()};}catch(error){if(error instanceof ImportFailure)return{ok:false,error:error.detail};throw error;}}
function finite(value:number,path:string):number{if(!Number.isFinite(value))fail({kind:'nonfinite',path,value});return value;}
/** Prepared scope owns source parameter construction once per import. Initial
 * fields, action arguments and timeline fields have distinct source overloads.
 * Raw provenance belongs to the file reader. No target methods are executed. */
export function prepareOrdinarySourceScalarScope(family:OrdinarySourceCameraFamily,options:OrdinarySourceCameraImportOptions={}):OrdinarySourceScalarResult<OrdinarySourceScalarScope>{return attempt(()=>{
 if(!['surface','implicit','attractor','perlin','map','symmetry'].includes(family))fail({kind:'input',path:'family',reason:'invalid-family'});
 const surface=family==='surface'||family==='implicit',scopeDiagnostics:string[]=[];
 const bindings=surface?parameters(options.parameters,options.memberOrder,scopeDiagnostics):new Map<string,number>();
 return {
  parameterValues:Object.freeze(Object.fromEntries(bindings)),diagnostics:scopeDiagnostics,
  camera(rawCamera:unknown):OrdinarySourceCameraImportResult{return attempt(()=>{
   const diagnostics:string[]=[];
   if(rawCamera===undefined)return{camera:{model:SOURCE_CAMERA_MODEL,configuration:{kind:'absent'}},diagnostics};
   const raw=record(rawCamera,'camera');
  const angles:{phi?:number;theta?:number;gamma?:number}={};
  for(const key of ['phi','theta','gamma'] as const){
   // getString(default) maps JSON null and omission to the same native default.
   // Surface defaults are expressions too: a bound PI affects default phi.
   // ConfigUtils defaults are numeric and can retain their origin as omission.
   const original=Object.hasOwn(raw,key)?raw[key]:undefined;
   if(original==null&&!surface)continue;
   const value=original??(key==='phi'?'PI/2':'0');
   const path=`camera.${key}`;
   let parsed:number;
   if(surface)parsed=surfaceFieldValue(value,path,'0',bindings,diagnostics);
   else parsed=unwrap(prepareDomainSourceScalar(value,{fallback:0,precision:'float32'}),path,diagnostics);
   if(!Number.isFinite(parsed))fail({kind:'nonfinite',path,value:parsed});
   angles[key]=parsed;
  }
  return {camera:{model:SOURCE_CAMERA_MODEL,configuration:{kind:'angles',family,...angles}},diagnostics};

  });},
  argument(raw:unknown,path:string){return attempt(()=>{
   const diagnostics:string[]=[];
   // getArgAsString catches non-string getString, then getFloat; Float.toString
   // followed by Float.parseFloat preserves the already rounded Float bits.
   const value=typeof raw==='number'?Math.fround(raw):['attractor','map','symmetry'].includes(family)
    ?unwrap(prepareDomainSourceScalar(raw,{fallback:0,precision:'float32'}),path,diagnostics)
    :typeof raw==='string'?surfaceString(raw,path,bindings,diagnostics):0;
   return{value:finite(value,path),diagnostics};
  });},
  field(raw:unknown,path:string,fallback:number,present:boolean){return attempt(()=>{
   const diagnostics:string[]=[];
   if(!present)return{value:Math.fround(fallback),diagnostics};
   if(typeof raw==='number')return{value:finite(Math.fround(raw),path),diagnostics};
   if(typeof raw==='string'){
    const direct=parseDomainSourceDouble(raw);if(direct.ok)return{value:finite(Math.fround(direct.value),path),diagnostics};
    if(direct.error.kind==='capacity')fail({...direct.error,path});
   }
   if(['attractor','map','symmetry'].includes(family)){
    const parsed=prepareDomainSourceObjectScalar(raw,{fallback,precision:'float32'});
    if(!parsed.ok)fail({...parsed.error,path});
    if(parsed.facts.route==='fallback')diagnostics.push(`${path}: 原版 getJsonFloat 采用默认值 ${fallback}。`);
    return{value:finite(parsed.facts.value,path),diagnostics};
   }
   if(typeof raw!=='string')fail({kind:'input',path,reason:'field-string-required'});
   return{value:finite(surfaceString(raw,path,bindings,diagnostics),path),diagnostics};
  });},
 };
});}
/** Convenience boundary for initial camera only. The prepared scope is shared
 * by production import with all timeline reads to avoid repeated construction. */
export function prepareOrdinarySourceCameraImport(rawCamera:unknown,family:OrdinarySourceCameraFamily,options:OrdinarySourceCameraImportOptions={}):OrdinarySourceCameraImportResult{
 const prepared=prepareOrdinarySourceScalarScope(family,options);if(!prepared.ok)return prepared;
 const result=prepared.value.camera(rawCamera);if(result.ok)result.value.diagnostics.unshift(...prepared.value.diagnostics);return result;
}
