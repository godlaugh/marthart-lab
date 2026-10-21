import {usesSourceMapMath,prepareSourceMapExpressions,sourceMapVariables,sourceMapFunctionNames} from './sourceMapMath';
import {mapDimension} from './mapDimension';
import {usesSourceSamilaMath} from './sourceSamilaMath';
import {prepareSourceSamilaExpressions,SOURCE_SAMILA_EXPRESSION_VARIABLES,sourceSamilaFunctionNames} from './sourceSamilaExpression';
import {usesRootsNativeMath} from './rootsMathConfig';
import type {SceneDocument} from '../types';
import {compileReal,realConstantNames,realFunctionNames} from './expression';
import {compileComplex,compilePolynomial,complexConstantNames,complexFunctionNames} from '../scenes/complex';
import {parseRootParameters} from './rootParameters';
import {normalizeBouncingFormula} from '../scenes/bouncingFormula';
import {domainExpressions} from './domainExpressions';
import {prepareDomainExecution,nativeCpuExpressionFallback,parseDomainIterationVersion,normalizeDomainNativeNext} from './domainSourceIteration';
import {domainNativeConstantNames,domainNativeFunctionNames} from './domainNativeArithmetic';

export interface EquationSuggestion {name:string;kind:'function'|'variable'|'constant';}
export interface EquationAnalysis {suggestions:EquationSuggestion[];error?:{message:string;offset?:number};native?:boolean;sourceReal?:boolean;warnings?:readonly string[];effectiveSource?:string;}
/** A committed edit replaces only its changed fields. Keep unrelated pending
 * text (including invalid text) when an explicit dimension action resets z. */
export function reconcileEquationDraft(previous:Pick<SceneDocument,'id'|'equations'>,next:Pick<SceneDocument,'id'|'equations'>,draft:Record<string,string>):Record<string,string>{
 if(previous.id!==next.id)return next.equations;
 const result={...draft};
 for(const key of new Set([...Object.keys(previous.equations),...Object.keys(next.equations)]))if(previous.equations[key]!==next.equations[key]){
  if(Object.hasOwn(next.equations,key))result[key]=next.equations[key];else delete result[key];
 }
 return result;
}
/** Editor context follows each evaluator's public coordinate scope. Validation is
 * performed by that evaluator's restricted compiler, never by the token painter. */
function analyzeLocalEquation(scene:SceneDocument,key:string,source:string):EquationAnalysis{
  const complex=scene.kind==='domain'||scene.kind==='roots';
  const functions=complex?complexFunctionNames:realFunctionNames,constants=complex?complexConstantNames:realConstantNames;
  let variables=Object.keys(scene.parameters);
  const suggestions:EquationSuggestion[]=[];
  try{
    switch(scene.kind){
      case 'surface':variables.push('u','v','t','time');break;
      case 'attractor':case 'implicit':variables.push('x','y','z','t','time');break;
      case 'samila':case 'bouncing':variables.push('x','y','t');break;
      case 'map':variables.push('x','y','z','t','time');if(key==='y'||key==='z')variables.push('nx','x_next');if(key==='z')variables.push('ny','y_next');break;
      case 'domain':variables.push('z','w','c','time');break;
      case 'roots':variables.push(...parseRootParameters(scene.settings,undefined,Object.keys(scene.parameters)).map(p=>p.name),'time');break;
    }
    variables=[...new Set(variables)];
    const rootVariable=String(scene.settings.variable??'z');
    for(const name of functions)suggestions.push({name,kind:'function'});
    for(const name of constants)if(!variables.includes(name))suggestions.push({name,kind:'constant'});
    for(const name of [...variables,...(scene.kind==='roots'?[rootVariable]:[])])suggestions.push({name,kind:'variable'});
    if(scene.kind==='domain'&&key==='next'&&!source.trim())return{suggestions};
    if(scene.kind==='roots')compilePolynomial(source,rootVariable,variables);
    else if(complex)compileComplex(source,variables);
    else {
      const evaluate=compileReal(scene.kind==='bouncing'?normalizeBouncingFormula(source):source,variables);
      // Only parameter/constant-only expressions can be judged without a
      // coordinate or time. Singularities in sampled surfaces remain runtime
      // facts; choosing an arbitrary coordinate here would reject valid art.
      if(evaluate.symbols.every(name=>Object.hasOwn(scene.parameters,name)||realConstantNames.includes(name))&&!Number.isFinite(evaluate(scene.parameters)))throw new Error('当前参数下公式结果不是有限实数；请检查除零、负数开方或函数定义域');
    }
    return{suggestions};
  }catch(error){
    const e=error as {message?:string;char?:number};
    // A normalized Math namespace or π expansion changes source positions.
    // Without a source map, retain the diagnostic without inventing a location.
    const originalPosition=scene.kind!=='bouncing'&&!source.includes('π')&&typeof e.char==='number';
    return{suggestions,error:{message:e.message??String(error),...(originalPosition?{offset:Math.max(0,Math.min(source.length,e.char!-1))}:{})}};
  }
}

/** Analyze a complete draft together: native f/next share the execution owner's
 * parsed facts and recovery decisions. Do not validate native text as MathJS,
 * infer next applicability from UI visibility, or recalculate its constant. */
export function analyzeEquationDraft(scene:SceneDocument,draft:Record<string,string>):Record<string,EquationAnalysis>{
 const entries=Object.entries(draft);
 if(usesRootsNativeMath(scene))return Object.fromEntries(entries.map(([key])=>[key,{suggestions:[],warnings:['本地多项式保留但未使用；源数学使用独立系数表，不验证休眠的本地公式。']}]));
 if(scene.settings.mapMathModel!==undefined&&scene.settings.mapMathModel!=='legacy-v1'){
  const result=Object.fromEntries(entries.map(([key])=>[key,{sourceReal:true,suggestions:[...sourceMapFunctionNames.map(name=>({name,kind:'function' as const})),...sourceMapVariables(Object.keys(scene.parameters),key==='y'?'y':key==='z'?'z':'x').map(name=>({name,kind:'variable' as const}))]} as EquationAnalysis]));
  try{usesSourceMapMath(scene);const equations={...scene.equations,...draft};prepareSourceMapExpressions({x:equations.x??'',y:equations.y??'',z:equations.z},Object.keys(scene.parameters),mapDimension(scene.settings));}
  catch(error){for(const analysis of Object.values(result))analysis.error={message:error instanceof Error?error.message:String(error)};}
  return result;
 }
 if(scene.settings.samilaMathModel!==undefined){
  const variables=[...new Set([...SOURCE_SAMILA_EXPRESSION_VARIABLES,...Object.keys(scene.parameters)])],suggestions:EquationSuggestion[]=[...sourceSamilaFunctionNames.map(name=>({name,kind:'function' as const})),...variables.map(name=>({name,kind:'variable' as const}))];
  const result=Object.fromEntries(entries.map(([key])=>[key,{suggestions,sourceReal:true} as EquationAnalysis]));
  try{usesSourceSamilaMath(scene);const equations={...scene.equations,...draft};if(typeof equations.f1!=='string'||typeof equations.f2!=='string')throw Error('源 Samila 数学需要显式 f1/f2 公式');prepareSourceSamilaExpressions({f1:equations.f1,f2:equations.f2},Object.keys(scene.parameters));}
  catch(error){for(const analysis of Object.values(result))analysis.error={message:error instanceof Error?error.message:String(error)};}
  return result;
 }
 if(scene.kind!=='domain')return Object.fromEntries(entries.map(([key,source])=>[key,analyzeLocalEquation(scene,key,source)]));
 let execution:ReturnType<typeof prepareDomainExecution>;
 try{
  const version=parseDomainIterationVersion(scene.settings.domainIterationVersion);
  if(version==='local-v1'||version==='mathart-1.7.8')return Object.fromEntries(entries.map(([key,source])=>[key,analyzeLocalEquation(scene,key,source)]));
  execution=prepareDomainExecution(scene.settings);
 }catch(error){return Object.fromEntries(entries.map(([key])=>[key,{suggestions:[],error:{message:error instanceof Error?error.message:String(error)}}]));}
 const constants=new Set<string>(domainNativeConstantNames),reserved=new Set(['z','w','c',...constants]);
 const suggestions:EquationSuggestion[]=[
  ...domainNativeFunctionNames.map(name=>({name,kind:'function' as const})),
  ...domainNativeConstantNames.map(name=>({name,kind:'constant' as const})),
  ...['z','w','c',...Object.keys(scene.parameters).filter(name=>!reserved.has(name)&&name===name.toLowerCase()&&/^[\p{L}_][\p{L}\p{Nd}_]*$/u.test(name))].map(name=>({name,kind:'variable' as const})),
 ];
 const result=Object.fromEntries(entries.map(([key])=>[key,{suggestions,native:true} as EquationAnalysis]));
 const equations={...scene.equations,...draft},formula=equations.f??'z^3-1',next=execution.iteration?equations.next:undefined;
 try{
  let facts=domainExpressions.get({formula,next,parameters:scene.parameters,iterationVersion:execution.version,nextEnabled:execution.nextEnabled});
  if(execution.arithmetic==='native-gpu'&&facts.nativeGpuFailure){
   execution=nativeCpuExpressionFallback(execution,facts.nativeGpuFailure);
   facts=domainExpressions.get({formula,next,parameters:scene.parameters,iterationVersion:execution.version,nextEnabled:execution.nextEnabled});
  }
  const warnings=[...facts.warnings,...(execution.fallbackReason?[execution.fallbackReason]:[])];
  const diagnosticKey=Object.hasOwn(result,'f')?'f':entries[0]?.[0];
  if(diagnosticKey&&warnings.length)result[diagnosticKey].warnings=warnings;
  if(result.f&&facts.effectiveFormula!==formula)result.f.effectiveSource=facts.effectiveFormula;
  const requestedNext=normalizeDomainNativeNext(next);
  if(result.next&&execution.nextEnabled&&requestedNext!==undefined&&facts.effectiveNext!==requestedNext)result.next.effectiveSource=facts.effectiveNext??facts.effectiveFormula;
  return result;
 }catch(error){
  // Resource/capacity failures are not native syntax recovery and still block
  // Apply. Source and its diagnostic remain visible rather than being replaced.
  const message=error instanceof Error?error.message:String(error);
  for(const analysis of Object.values(result))analysis.error={message};
  return result;
 }
}
export function analyzeEquation(scene:SceneDocument,key:string,source:string):EquationAnalysis{
 return analyzeEquationDraft(scene,{[key]:source})[key];
}

export function equationTokens(source:string,suggestions:EquationSuggestion[],native=false){
  const names=new Map(suggestions.map(s=>[s.name,s.kind]));
  // Lexical color only. Every character, including invalid input, is retained.
  if(native){
   const functions=new Set<string>(domainNativeFunctionNames),constants=new Set<string>(domainNativeConstantNames);
   return [...source.matchAll(/[0-9.]+|[\p{L}_][\p{L}\p{Nd}_]*|\s+|./gsu)].map(match=>{
    const text=match[0],name=text.toLowerCase(),identifier=/^[\p{L}_]/u.test(text);
    const kind=identifier?(constants.has(name)?'constant':functions.has(name)&&source[match.index+text.length]==='('?'function':'variable'):/^[0-9.]/.test(text)?'number':/^\s+$/.test(text)?'space':'operator';
    return{text,kind};
   });
  }
  return [...source.matchAll(/(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z_\u0370-\u03ff][A-Za-z_\d\u0370-\u03ff]*|\s+|./gs)].map(match=>({text:match[0],kind:names.get(match[0])??(match[0]==='π'?'constant':/^(?:\d|\.\d)/.test(match[0])?'number':/^\s+$/.test(match[0])?'space':'operator')}));
}
export function equationCompletion(source:string,caret:number,suggestions:EquationSuggestion[],showAll=false,native=false){
  const before=source.slice(0,caret),prefix=before.match(native?/[\p{L}_][\p{L}\p{Nd}_]*$/u:/[A-Za-z_][A-Za-z_\d]*$/)?.[0]??'';
  const after=source.slice(caret).match(native?/^[\p{L}\p{Nd}_]*/u:/^[A-Za-z_\d]*/)?.[0]??'';
  return{start:caret-prefix.length,end:caret+after.length,items:(!prefix&&!showAll?[]:suggestions.filter(s=>s.name.toLowerCase().startsWith(prefix.toLowerCase())&&(showAll||s.name!==prefix))).slice(0,12)};
}
export function insertEquationCompletion(source:string,range:{start:number;end:number},suggestion:EquationSuggestion,native=false){
  let suffix=source.slice(range.end);
  if(native&&suggestion.kind==='function'&&/^ *\(/.test(suffix))suffix=suffix.replace(/^ +/,'');
  const addParens=suggestion.kind==='function'&&!(native?/^\(/:/^\s*\(/).test(suffix),insert=suggestion.name+(addParens?'()':'');
  return{source:source.slice(0,range.start)+insert+suffix,caret:range.start+insert.length-(addParens?1:0)};
}
