import type {SceneDocument} from '../types';
import {SYMMETRY_DEFAULT_SETTINGS} from '../scenes/symmetryParameters';

/** Local text-retention policy, not limits of the original desktop GLSL format.
 * UTF-16 code units match JavaScript string storage and document validation.
 * At 14 retained plans, raw + expanded + instrumented + key + final shader
 * (8 Ki units reserved for its wrapper) fit a conservative 16 MiB text payload.
 * JS object overhead and the driver's compiler/program memory are additional.
 */
export const MAX_SYMMETRY_CUSTOM_SOURCE_LENGTH=64*1024;
export const MAX_SYMMETRY_CUSTOM_EXPANDED_LENGTH=96*1024;
export const MAX_SYMMETRY_CUSTOM_INSTRUMENTED_LENGTH=128*1024;
export const SYMMETRY_CUSTOM_PLAN_CACHE_SIZE=14;
/** Shared by all nested/helper loops in one calculate_next invocation. This
 * permits a degree-50 squared loop (2,550 total body entries) with headroom.
 * It bounds loop entries, not driver compilation time or shader wall time. */
export const SYMMETRY_CUSTOM_LOOP_ITERATIONS=4096;
export const SYMMETRY_CUSTOM_DIALECT='webgl2-glsl-es-300-budgeted-v1' as const;

export interface PreparedSymmetryCustomSource {
 readonly rawSource:string;
 readonly expandedSource:string;
 readonly instrumentedSource:string;
 readonly compileDegree:number;
 /** Native narrow scalar-float matcher, deliberately not GL reflection. */
 readonly bindingNames:readonly string[];
 readonly programKey:string;
 readonly dialect:typeof SYMMETRY_CUSTOM_DIALECT;
 readonly loopCount:number;
}

export class SymmetryCustomSourceError extends Error {
 constructor(readonly code:'source-type'|'source-budget'|'degree'|'source-format'|'unsupported-directive'|'reserved-identifier'|'unsupported-discard',message:string){super(message);this.name='SymmetryCustomSourceError';}
}
const fail=(code:SymmetryCustomSourceError['code'],message:string):never=>{throw new SymmetryCustomSourceError(code,message);};

/** Sole absence interpretation. Nonblank caller source is never trimmed. */
export function readSymmetryCustomSource(raw:unknown):string|undefined {
 if(raw===undefined||raw===null)return undefined;
 if(typeof raw!=='string')return fail('source-type','自定义 GLSL 源码必须是文本');
 return raw.trim()?raw:undefined;
}
export function hasSymmetryCustom(scene:Pick<SceneDocument,'kind'|'equations'>):boolean {
 return scene.kind==='symmetry'&&readSymmetryCustomSource(scene.equations.glsl)!==undefined;
}
function compileDegreeValue(value:unknown):number {
 if(typeof value!=='number'||!Number.isInteger(value)||value<2||value>2147483647)fail('degree','自定义 GLSL 编译阶数必须是 2 到 2147483647 的整数');
 return value as number;
}
/** Authored scene only: callers must pass the base document, not sceneAtTime.
 * Desktop getSymmetryDegreeValue returns a signed Java int, with a minimum of
 * two. Its custom source has no built-in editor's degree-50 upper bound. */
export function symmetryCustomCompileDegree(authored:Pick<SceneDocument,'settings'>):number {
 return compileDegreeValue(authored.settings.degree??SYMMETRY_DEFAULT_SETTINGS.degree);
}
/** Document/UI identifier budget, separate from GLSL compiler name validity.
 * Coordinates, time and MathJS function names are ordinary native uniforms. */
export function symmetryCustomParameterNameError(name:string):string|undefined {
 if(!/^[A-Za-z_][A-Za-z_0-9]*$/.test(name))return 'GLSL 参数名须以字母或下划线开头，且只含字母、数字或下划线';
 if(name.length>100)return 'GLSL 参数名超过 100 字符预算';
 if(['__proto__','prototype','constructor'].includes(name))return '该参数名由项目与动画数据结构保留';
 return undefined;
}

interface Token {text:string;start:number;end:number;}
/** This lexer owns comments, delimiters and loop statements only. It is not a
 * replacement GLSL type checker: the actual ES 3.00 driver checks the language.
 * Macros are rejected because they could manufacture uninstrumented loops.
 */
function lex(source:string):{tokens:Token[];close:Map<number,number>} {
 const tokens:Token[]=[],close=new Map<number,number>(),stack:number[]=[];
 for(let i=0;i<source.length;){
  const c=source[i];if(/\s/.test(c)){i++;continue;}
  if(source.startsWith('//',i)){i+=2;while(i<source.length&&source[i]!=='\n'&&source[i]!=='\r')i++;continue;}
  if(source.startsWith('/*',i)){const end=source.indexOf('*/',i+2);if(end<0)fail('source-format','自定义 GLSL 注释未闭合');i=end+2;continue;}
  if(c==='#')fail('unsupported-directive','自定义 GLSL 暂不支持预处理指令或宏；请提供 GLSL ES 3.00 函数源码');
  if(c==='"'||c==="'"||c==='\\')fail('source-format','自定义 GLSL 包含不支持的字符串或转义语法');
  const start=i;if(/[A-Za-z_]/.test(c)){i++;while(i<source.length&&/[A-Za-z_0-9]/.test(source[i]))i++;}else i++;
  const token={text:source.slice(start,i),start,end:i},index=tokens.length;tokens.push(token);
  if(token.text.startsWith('rea_'))fail('reserved-identifier','自定义 GLSL 的 rea_ 前缀由渲染器保留');
  if(token.text==='discard')fail('unsupported-discard','自定义 GLSL 不支持 discard：它会跳过粒子状态与错误输出');
  if(['(','[','{'].includes(token.text))stack.push(index);
  else if([')',']','}'].includes(token.text)){
   const open=stack.pop();if(open===undefined||'([{'.indexOf(tokens[open].text)!==')]}'.indexOf(token.text))fail('source-format','自定义 GLSL 括号不匹配');
   close.set(open!,index);
  }
 }
 if(stack.length)fail('source-format','自定义 GLSL 括号未闭合');
 return {tokens,close};
}

function instrumentLoops(source:string):{source:string;loopCount:number} {
 const {tokens,close}=lex(source),inserts=new Map<number,string[]>(),doConditions=new Set<number>();
 const at=(i:number)=>tokens[i]?.text;
 const afterGroup=(i:number,opening:string)=>{if(at(i)!==opening||!close.has(i))return fail('source-format','自定义 GLSL 控制语句缺少括号');return close.get(i)!+1;};
 const ends=new Map<number,number>();
 const statementEnd=(start:number,depth=0):number=>{
  const known=ends.get(start);if(known!==undefined)return known;
  // A local parser stack budget, checked before recursive descent; no shader
  // executes on this path. The source is retained unchanged in the document.
  if(depth>256)fail('source-format','自定义 GLSL 控制语句嵌套超过解析预算（256 层）');
  let end:number;const first=at(start);
  if(first==='{')end=afterGroup(start,'{');
  else if(first==='if') {end=statementEnd(afterGroup(start+1,'('),depth+1);if(at(end)==='else')end=statementEnd(end+1,depth+1);}
  else if(first==='for'||first==='while'||first==='switch')end=statementEnd(afterGroup(start+1,'('),depth+1);
  else if(first==='do'){
   const condition=statementEnd(start+1,depth+1);if(at(condition)!=='while')return fail('source-format','自定义 GLSL do 缺少 while 条件');
   end=afterGroup(condition+1,'(');if(at(end)!==';')return fail('source-format','自定义 GLSL do/while 缺少分号');end++;
  }else{
   end=start;while(end<tokens.length&&at(end)!==';'){
    if(at(end)==='}')return fail('source-format','自定义 GLSL 循环体缺少语句分号');
    if(close.has(end))end=close.get(end)!+1;else end++;
   }
   if(end===tokens.length)return fail('source-format','自定义 GLSL 循环体未结束');end++;
  }
  ends.set(start,end);return end;
 };
 for(let i=0;i<tokens.length;i++)if(at(i)==='do'){statementEnd(i);doConditions.add(statementEnd(i+1));}
 const insert=(offset:number,text:string)=>{const list=inserts.get(offset)??[];list.push(text);inserts.set(offset,list);};
 let loopCount=0;
 for(let i=0;i<tokens.length;i++){
  const keyword=at(i);if(!['for','while','do'].includes(keyword)||doConditions.has(i))continue;
  const body=keyword==='do'?i+1:afterGroup(i+1,'('),end=statementEnd(body);loopCount++;
  const guard='if(!rea_customLoopTick())break;';
  if(at(body)==='{')insert(tokens[body].end,guard);
  else {insert(tokens[body].start,'{'+guard);insert(tokens[end-1].end,'}');}
 }
 const growth=[...inserts.values()].reduce((sum,parts)=>sum+parts.reduce((n,s)=>n+s.length,0),0);
 if(source.length+growth>MAX_SYMMETRY_CUSTOM_INSTRUMENTED_LENGTH)fail('source-budget','自定义 GLSL 插桩后的源码超过 128 Ki 字符预算');
 const parts:string[]=[];let previous=0;
 for(const [offset,values] of [...inserts].sort((a,b)=>a[0]-b[0])){parts.push(source.slice(previous,offset),...values);previous=offset;}
 parts.push(source.slice(previous));return {source:parts.join(''),loopCount};
}

// One bounded facts cache avoids re-lexing unchanged authored source for every
// animation frame. Values and animated degree uniforms never enter this key.
const plans:PreparedSymmetryCustomSource[]=[];
export function prepareSymmetryCustomSource(rawSource:string,compileDegree:number):PreparedSymmetryCustomSource {
 const raw=readSymmetryCustomSource(rawSource);if(raw===undefined)fail('source-type','自定义 GLSL 源码为空');
 if(raw!.length>MAX_SYMMETRY_CUSTOM_SOURCE_LENGTH)fail('source-budget','自定义 GLSL 源码超过 64 Ki 字符预算');
 compileDegreeValue(compileDegree);
 const cachedIndex=plans.findIndex(plan=>plan.compileDegree===compileDegree&&plan.rawSource===raw);
 if(cachedIndex>=0){const [cached]=plans.splice(cachedIndex,1);plans.push(cached);return cached;}
 const degree=String(compileDegree),minusTwo=String(compileDegree-2),placeholder=/\{N\}|\{N_MINUS_2\}/g;
 let expandedLength=raw!.length;for(const match of raw!.matchAll(placeholder))expandedLength+=(match[0]==='{N}'?degree:minusTwo).length-match[0].length;
 if(expandedLength>MAX_SYMMETRY_CUSTOM_EXPANDED_LENGTH)fail('source-budget','自定义 GLSL 展开后的源码超过 96 Ki 字符预算');
 const expandedSource=raw!.replace(placeholder,value=>value==='{N}'?degree:minusTwo),instrumented=instrumentLoops(expandedSource);
 // The original matcher includes comments and excludes precision-qualified or
 // grouped declarations. Reflection may skip inactive names, never add names.
 const bindingNames=Object.freeze([...new Set([...expandedSource.matchAll(/uniform\s+float\s+(\w+)\s*;/g)].map(match=>match[1]))]);
 if(bindingNames.some(name=>name.startsWith('rea_')))fail('reserved-identifier','自定义 GLSL uniform 的 rea_ 前缀由渲染器保留（包括注释中的原生匹配）');
 const plan=Object.freeze({rawSource:raw!,expandedSource,instrumentedSource:instrumented.source,compileDegree,bindingNames,programKey:SYMMETRY_CUSTOM_DIALECT+'\n'+instrumented.source,dialect:SYMMETRY_CUSTOM_DIALECT,loopCount:instrumented.loopCount});
 if(plans.length>=SYMMETRY_CUSTOM_PLAN_CACHE_SIZE)plans.shift();plans.push(plan);return plan;
}

/** Native safeFloat: missing, nonfinite and float32 overflow become zero.
 * No implicit time/degree/coordinate values are injected. */
export function bindSymmetryCustomParameters(plan:PreparedSymmetryCustomSource,parameters:Readonly<Record<string,number>>):Readonly<Record<string,number>> {
 return Object.freeze(Object.fromEntries(plan.bindingNames.map(name=>{const value=Object.hasOwn(parameters,name)?Math.fround(parameters[name]):0;return [name,Number.isFinite(value)?value:0];})));
}
