import {importSourceSurfaceParameterAction,importSourceSurfaceParameterClip,importSourceSurfaceParameterEdge,SOURCE_SURFACE_PARAMETER_EDGE_DEFAULT,type SourceSurfaceParameterResult} from './sourceSurfaceParameterConfig';
import type {SourceSurfaceParameterAction,SourceSurfaceParameterClip} from '../types';
import {importSourceSurfaceGradient,SOURCE_SURFACE_GRADIENT_SOURCE_FIELDS,type SourceSurfaceGradientImportFacts} from './sourceSurfaceGradientConfig';
import {parseSourceSurfacePalette,DEFAULT_SOURCE_SURFACE_COLORS} from './sourceSurfaceColor';
import {FRACTAL_SOURCE_COLOR_PROFILE,prepareFractalSourceColorImport} from './fractalSourceColor';
import {initializeSamilaCamera} from './samilaCamera';
import {recordingDurationError} from './recordingContract';
import {resolveFractalParameterBinding} from './fractalParameterBindings';
import {DEFAULT_EDGE_EASING,parseOscillationEdge} from './oscillation';
import type {AnimationAction,AnimationTrack,DomainParameterAction,GradientAnimation,OscillationEdgeEasing,ParameterAnimation,SceneDocument,SceneKind,Settings} from '../types';
import {supportsGradientOffsets} from './gradientOffsets';
import {supportsParticleTracking} from './sceneCamera';
import {definitions} from '../scenes';
import {createScene,parseSceneValue,serializeScene,MAX_SCENE_TEXT_LENGTH} from './document';
import {compileReal} from './expression';
import {EASING_NAMES,resolveTimeline,readAnimationValue,sceneAtTime,validateTimelineCapacity,validateTimelineExtensions} from './timeline';
import {parseSpirographLayers} from '../scenes/spirograph';
import {MAX_PALETTE_STOPS,validatePalette} from './palette';
import {defaultFormulas,validateFormulas} from './formulas';
import {importSamilaTone,samilaToneSourceFields,type SamilaToneSource} from './samilaToneImport';
import {hasSymmetryCustom,MAX_SYMMETRY_CUSTOM_SOURCE_LENGTH,symmetryCustomParameterNameError} from './symmetryCustom';
import {parseDomainSourcePalette} from './domainSourceColor';
import {parseDomainNativeParameters} from './domainNativeParameters';
import {prepareDomainNativeConstant} from './domainNativeConstants';
import {parseDomainSourceDouble,prepareDomainSourceObjectScalar,prepareDomainSourceScalar} from './domainSourceScalar';
import {parseSpirographVersion} from './spirographModel';
import {normalizeFractalDistancePower} from './fractalDistance';
import {FRACTAL_SOURCE_NUMERIC_PROFILE} from './fractalPrecision';
import {ROOTS_DENSITY_COLOR_VERSION,ROOTS_SOURCE_TONE_FIELDS,normalizeRootsSourceMetric,normalizeRootsSourceToneField,parseRootsSourcePalette,rootsSourceBackground} from './rootsDensityColor';
import {parseRootsSourceScalar} from './rootsSourceScalar';
import {prepareRootsPresentationImport} from './rootsPresentationImport';
import {withRootsPresentation} from './rootsPresentationAuthoring';
import {prepareRootsCameraTimeline,withRootsSceneTimeline} from './rootsCameraTimeline';
import {prepareRootsGradientImport} from './rootsGradientConfig';
import {lookupSourceEasing} from './sourceEasing';
import {PROJECT_RESOLUTION_SOURCE_NUMBER_PATHS,rootsTimelineNumberTokenPaths,SOURCE_SURFACE_NUMBER_FIELDS,type SourceNumberToken} from './sourceNumberTokens';
import {prepareSourceProjectResolution} from './projectResolution';
import {parseSourceJson,type SourceJsonObjectMetadata} from './sourceJson';
import {createRootsNativeMath,defaultRootNativeParameter,parseRootsMath} from './rootsMathConfig';
import {prepareRootsSourceMemberOrder,prepareRootsSourceJsonInt,prepareRootsSourceJsonLong,prepareRootsSourceJsonString} from './rootsSourceOrder';
import {isJavaBlank} from './sourceJavaText';
import {prepareOrdinarySourceScalarScope,prepareSurfaceSourceStringField,type OrdinarySourceScalarScope,type OrdinarySourceScalarResult,type OrdinarySourceCameraFamily} from './ordinarySourceCameraImport';
import {SOURCE_SURFACE_PARTICLES,prepareSourceSurfaceParticles,usesSourceSurfaceParticles} from './sourceSurfaceParticles';
import {ordinarySourceCameraGeometry} from './ordinarySourceCamera';
import {ORDINARY_CAMERA_SEQUENCE} from './ordinarySourceCameraTimeline';

type ObjectValue=Record<string,unknown>;
type SourceMetadata=WeakMap<object,SourceJsonObjectMetadata>;
type ProjectJson={source:ObjectValue;metadata:SourceMetadata;text:string};
/** String paths address format fields with legacy aliases. Segment arrays are
 * exact source paths, so dictionary names cannot become aliases or nesting. */
type ReaderPath=string|readonly string[];
const pathSegments=(path:ReaderPath):readonly string[]=>typeof path==='string'?path.split('.'):path;
const pathLabel=(path:ReaderPath):string=>typeof path==='string'?path:path.map((key,index)=>/^[A-Za-z0-9_$]+$/.test(key)?(index?'.':'')+key:'['+JSON.stringify(key)+']').join('');
const pathIdentity=(segments:readonly string[]):string=>JSON.stringify(segments);
const TYPES:Record<string,SceneKind>={SURFACE:'surface',ATTRACTOR:'attractor',MAP_ATTRACTOR:'map',IMPLICIT:'implicit',FRACTAL:'fractal',DOMAIN_COLORING:'domain',SYMMETRY_CHAOS:'symmetry',PERLIN:'perlin',NOISE:'perlin',SPIROGRAPH:'spirograph',BOUNCING_PARTICLES:'bouncing',SAMILA:'samila',COMPLEX_ROOTS:'roots'};
const isObject=(v:unknown):v is ObjectValue=>v!==null&&typeof v==='object'&&!Array.isArray(v);
function fail(message:string):never {throw new Error(`MathArt 导入失败：${message}`);}
function aliases(key:string):string[]{return [...new Set([key,key.replace(/_([a-z])/g,(_,c:string)=>c.toUpperCase()),key.replace(/[A-Z]/g,c=>'_'+c.toLowerCase())])];}
/** Strip JSON comments without modifying string contents or line positions. */
function withoutComments(text:string):string {
 let result='',quoted=false,escaped=false,line=false,block=false;
 for(let i=0;i<text.length;i++){
  const ch=text[i],next=text[i+1];
  if(line){if(ch==='\n'||ch==='\r'){line=false;result+=ch;}else result+=' ';continue;}
  if(block){if(ch==='*'&&next==='/'){result+='  ';i++;block=false;}else result+=ch==='\n'||ch==='\r'?ch:' ';continue;}
  if(quoted){result+=ch;if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch==='"')quoted=false;continue;}
  if(ch==='"'){quoted=true;result+=ch;}else if(ch==='/'&&next==='/'){line=true;result+='  ';i++;}else if(ch==='/'&&next==='*'){block=true;result+='  ';i++;}else result+=ch;
 }
 if(block)fail('未闭合的块注释');return result;
}
class Reader {
 readonly warnings:string[]=[];private used=new Set<string>();private aliasesReported=new Set<string>();
 readonly sourceNumberTokens:SourceNumberToken[]=[];private nativeOrders=new WeakMap<object,readonly string[]>();
 constructor(readonly root:ObjectValue,private readonly metadata:SourceMetadata=new WeakMap(),private readonly sourceText?:string){}
 resolve(path:ReaderPath):{value:unknown;equivalentPaths:string[][];parent?:object;key?:string}|undefined {
  let current:unknown=this.root,parts:string[]=[],equivalentPaths:string[][]=[[]];const segments=pathSegments(path),exact=typeof path!=='string';
  let parent:object|undefined,key:string|undefined;
  for(const segment of segments){
   if(!isObject(current)&&!Array.isArray(current))return undefined;
   const object=current as ObjectValue,candidates=(exact?[segment]:aliases(segment)).filter(k=>Object.hasOwn(object,k));if(!candidates.length)return undefined;
   const chosen=candidates[0],tokens=this.metadata.get(object)?.numberTokens;
   // The JSON parser may map 1 and 1.0 to the same JS number, while the source
   // background parser gives them different colors. Do not acknowledge both
   // aliases as equivalent merely because their decoded values compare equal.
   const equal=candidates.length===1||candidates.every(k=>JSON.stringify(object[k])===JSON.stringify(object[chosen])&&tokens?.get(k)===tokens?.get(chosen));
   if(candidates.length>1&&!equal){const names=candidates.map(k=>pathLabel([...parts,k])),identity=pathIdentity([...parts,chosen]);if(!this.aliasesReported.has(identity)){this.aliasesReported.add(identity);this.warnings.push(`别名冲突：${names.join(' / ')}；采用 ${names[0]}，其他值保留在 source。`);}}
   const equivalentKeys=equal?candidates:[chosen];
   if(equivalentPaths.length*equivalentKeys.length>200000)fail('文档超过 200,000 个节点或 64 层嵌套');
   equivalentPaths=equivalentPaths.flatMap(prefix=>equivalentKeys.map(key=>[...prefix,key]));
   parent=object;key=chosen;current=object[chosen];parts.push(chosen);
  }
  return{value:current,equivalentPaths,parent,key};
 }
 /** Reuse the JSON parser's number token, bound to the chosen container/key. */
 numberToken(path:ReaderPath):string|undefined {const x=this.resolve(path);return x?.parent&&x.key!==undefined?this.metadata.get(x.parent)?.numberTokens.get(x.key):undefined;}
 sourceValueText(path:ReaderPath):string {
  const x=this.resolve(path),range=x?.parent&&x.key!==undefined?this.metadata.get(x.parent)?.valueRanges.get(x.key):undefined;
  if(!range||this.sourceText===undefined)fail(`${pathLabel(path)} 缺少原始 JSON 值范围`);
  return this.sourceText.slice(range[0],range[1]);
 }
 retainNumberToken(path:ReaderPath):void {
  const x=this.resolve(path),token=this.numberToken(path);if(!x||typeof x.value!=='number'||token===undefined)return;
  this.sourceNumberTokens.push({path:[...x.equivalentPaths[0]],token});
  if(!Number.isFinite(x.value)||!Number.isSafeInteger(x.value))this.warnings.push('源 JSON 数值不能保证精确往返；sourceNumberTokens 保留已登记字段的原始数字文本。');
 }
 /** Order facts are produced once from text and resolved by the source map owner. */
 private sourceObjectKeys(object:object,label:string):readonly string[]{
  const cached=this.nativeOrders.get(object);if(cached)return cached;
  const keys=this.metadata.get(object)?.keys;if(!keys)fail(`${label} 缺少原始 JSON 成员顺序`);
  const result=prepareRootsSourceMemberOrder(keys);if(!result.ok)fail(`${label} 源对象成员无效：${JSON.stringify(result.error)}`);
  this.nativeOrders.set(object,result.value.keys);return result.value.keys;
 }
 sourceKeys(path:ReaderPath):readonly string[]{const object=this.object(path);return object?this.sourceObjectKeys(object,pathLabel(path)):[];}
 /** JSONObject.putOnce rejects duplicate keys before format-specific reads,
  * including keys in otherwise inactive or unknown source objects. */
 validateNativeObjects():void{
  const pending:unknown[]=[this.root];
  while(pending.length){const value=pending.pop();if(Array.isArray(value)){for(const item of value)pending.push(item);continue;}if(!isObject(value))continue;const keys=this.sourceObjectKeys(value,'JSON');for(const key of keys)pending.push(value[key]);}
 }
 sourceInt(path:ReaderPath,fallback:number):number{
  const result=prepareRootsSourceJsonInt(this.use(path),fallback,this.numberToken(path));
  if(!result.ok)fail(`${pathLabel(path)} 源整数转换失败：${JSON.stringify(result.error)}`);
  if(result.value.route==='fallback'&&result.value.fallbackReason!=='missing')this.warnings.push(`${pathLabel(path)} 按源整数规则使用默认值 ${fallback}；原值保留在 source。`);
  return result.value.value;
 }
 has(path:ReaderPath):boolean{return this.resolve(path)!==undefined;}
 peek(path:ReaderPath):unknown{return this.resolve(path)?.value;}
 // Looking up or validating a container does not consume its descendants.
 // Only the consumer's explicit use acknowledges equivalent alias leaves.
 use(path:ReaderPath):unknown {const x=this.resolve(path);if(x)for(const p of x.equivalentPaths)this.used.add(pathIdentity(p));return x?.value;}
 acknowledge(path:ReaderPath,reason:string):void {if(this.has(path)){this.use(path);this.warnings.push(`${pathLabel(path)}：${reason}；原值保留在 source。`);}}
 str(path:ReaderPath,required=false):string|undefined {const x=this.use(path);if(x===undefined){if(required)fail(`缺少 ${pathLabel(path)}`);return undefined;}if(typeof x!=='string')fail(`${pathLabel(path)} 应为字符串`);return x;}
 bool(path:ReaderPath):boolean|undefined {const x=this.use(path);if(x===undefined)return undefined;if(typeof x!=='boolean')fail(`${pathLabel(path)} 应为布尔值`);return x;}
 num(path:ReaderPath,scope:Record<string,number>={}):number|undefined {const x=this.use(path);return x===undefined?undefined:this.numericValue(x,pathLabel(path),scope);}
 domainScalar(path:ReaderPath,fallback:number,precision:'float64'|'float32'='float64',overload:'json'|'object'='json'):number {
  const prepare=overload==='json'?prepareDomainSourceScalar:prepareDomainSourceObjectScalar;
  const result=prepare(this.use(path),{fallback,precision});
  if(!result.ok)fail(`${pathLabel(path)} 超出本地标量解析容量 ${result.error.resource}=${result.error.limit}`);
  const facts=result.facts;
  if(facts.classification!=='finite')fail(`${pathLabel(path)} 原版标量转换结果为 ${facts.classification}；本地持久化与动画要求有限数值`);
  if(facts.route==='fallback'&&facts.fallbackReason!=='missing')this.warnings.push(`${pathLabel(path)}：按原版标量转换规则使用默认值 ${fallback}；原值保留在 source。`);
  return facts.value;
 }
 domainBoolean(path:ReaderPath,fallback=true,invalid:'fail'|'default'='fail'):boolean {
  if(!this.has(path))return fallback;
  const raw=this.use(path);if(typeof raw==='boolean')return raw;
  if(typeof raw==='string'&&/^(true|false)$/i.test(raw))return raw.toLowerCase()==='true';
  if(invalid==='default')return fallback;
  fail(`${pathLabel(path)} 应为布尔值或不含首尾空格的 true/false 字符串`);
 }
 domainDouble(path:ReaderPath,fallback:number,nonfiniteFallback=false):number {
  const raw=this.use(path);let value=fallback;
  if(typeof raw==='number')value=raw;
  else if(typeof raw==='string'){
   const result=parseDomainSourceDouble(raw);
   if(result.ok)value=result.value;
   else if(result.error.kind==='capacity')fail(`${pathLabel(path)} 超出本地标量解析容量 characters=${result.error.limit}`);
  }
  return nonfiniteFallback&&!Number.isFinite(value)?fallback:value;
 }
 /** Spirograph JSON animation scalars accept Java literals, not expressions.
  * The complete original value remains in provenance when the source defaults. */
 spiroScalar(path:ReaderPath,fallback:number,asFloat=false):number {
  const raw=this.use(path);let value=fallback,defaulted=raw!==undefined;
  if(typeof raw==='number'){value=raw;defaulted=false;}
  else if(typeof raw==='string'){
   const parsed=parseDomainSourceDouble(raw);
   if(parsed.ok){value=parsed.value;defaulted=false;}
   else if(parsed.error.kind==='capacity')fail(`${pathLabel(path)} 超出本地标量解析容量 characters=${parsed.error.limit}`);
  }
  if(asFloat)value=Math.fround(value);
  if(!Number.isFinite(value))fail(`${pathLabel(path)} 原版旋轮标量转换为非有限数值；本地文档不能保存该结果`);
  if(defaulted)this.warnings.push(`${pathLabel(path)} 未被原版旋轮数值解析接受，采用默认值 ${fallback}；原值保留在 source。`);
  return value;
 }
 /** ConfigUtils has a different malformed-string default from animation
  * parseParamValue. Both reuse the canonical source scalar grammar. */
 spiroConfigNumber(path:ReaderPath,fallback:number):number {
  return this.domainScalar(path,typeof this.peek(path)==='string'?0:fallback);
 }
 private numericValue(x:unknown,path:string,scope:Record<string,number>):number {let n:number;if(typeof x==='number')n=x;else if(typeof x==='string'){try{n=compileReal(x)(scope);}catch(e){fail(`${path} 数值表达式无效：${e instanceof Error?e.message:String(e)}`);}}else fail(`${path} 应为数值或数值表达式`);if(!Number.isFinite(n!))fail(`${path} 必须是有限数值`);return n!;}
 nativeDomainParameters(path:string):Record<string,number> {
  const source=this.object(path);if(!source)return{};
  // Only the container path has format aliases; dictionary keys are exact.
  const facts=this.resolve(path)!;
  const entries=Object.keys(source).map(key=>{
   for(const prefix of facts.equivalentPaths)this.used.add(pathIdentity([...prefix,key]));
   return[key,this.domainScalar([...facts.equivalentPaths[0],key],0)] as const;
  });
  if(!entries.length)for(const prefix of facts.equivalentPaths)this.used.add(pathIdentity(prefix));
  return parseDomainNativeParameters(Object.fromEntries(entries));
 }
 object(path:ReaderPath):ObjectValue|undefined {const x=this.peek(path);if(x===undefined)return undefined;if(!isObject(x))fail(`${pathLabel(path)} 应为对象`);return x;}
 remaining():void {
  const pending:string[]=[],stack:{value:unknown;path:string[];depth:number}[]=[{value:this.root,path:[],depth:0}];let nodes=0;
  while(stack.length){const item=stack.pop()!;if(++nodes>200000||item.depth>64)fail('文档超过 200,000 个节点或 64 层嵌套');if(this.used.has(pathIdentity(item.path)))continue;const v=item.value;if(v!==null&&typeof v==='object'){const entries=Object.entries(v);if(!entries.length)pending.push(pathLabel(item.path));for(const [k,x]of entries)stack.push({value:x,path:[...item.path,k],depth:item.depth+1});}else pending.push(pathLabel(item.path));}

  if(pending.length)this.warnings.push(`以下字段尚未映射，保留在 source，当前绘制/动画不会应用：${pending.join(', ')}。`);
 }
}
function numberTo(reader:Reader,scene:SceneDocument,path:string,key:string,options:{min?:number;max?:number;integer?:boolean;limit?:boolean}={}):void {
 let value=reader.num(path,scene.parameters);if(value===undefined)return;
 if(options.integer&&!Number.isInteger(value))fail(`${path} 必须是整数`);
 const lo=options.min??-Infinity,hi=options.max??Infinity;
 if(value<lo||value>hi){if(!options.limit||value<lo)fail(`${path}=${value} 超出当前实现支持范围 ${lo}..${hi}`);const clamped=Math.min(hi,value);reader.warnings.push(`${path}=${value} 超出当前 ${key} 资源范围，转换为 ${clamped}；原值保留在 source。`);value=clamped;}
 scene.settings[key]=value;
}
function booleanTo(r:Reader,s:SceneDocument,path:string,key:string){const v=r.bool(path);if(v!==undefined)s.settings[key]=v;}
function stringTo(r:Reader,s:SceneDocument,path:string,key:string,map?:Record<string,string>){const v=r.str(path);if(v!==undefined){s.settings[key]=map?.[v]??v;if(map&&!Object.hasOwn(map,v))r.warnings.push(`${path}=${v} 没有已验证的对应选项，原值保留；生成器可能拒绝此模式。`);}}
function equation(r:Reader,s:SceneDocument,path:string,key:string,required=true){const v=r.str(path,required);if(v!==undefined){if(!v.trim()||v.length>8192)fail(`${path} 为空或超过 8192 字符`);s.equations[key]=v;}}
function firstPath(r:Reader,paths:string[]):string|undefined{return paths.find(p=>r.has(p));}
function pair(r:Reader,s:SceneDocument,path:string,real:string,imag:string){const v=r.use(path);if(v===undefined)return;if(!Array.isArray(v)||v.length!==2||v.some(x=>typeof x!=='number'||!Number.isFinite(x)))fail(`${path} 应为 [实部, 虚部]`);s.settings[real]=v[0] as number;s.settings[imag]=v[1] as number;}
function numericParameters(r:Reader,path:string,symmetry=false):Record<string,number>{const source=r.object(path),out:Record<string,number>={};if(!source)return out;for(const k of Object.keys(source)){if(symmetry?!!symmetryCustomParameterNameError(k):!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(k)||['constructor','prototype'].includes(k))fail(`${path}.${k} 参数名无效`);out[k]=r.num(`${path}.${k}`)!;}return out;}
function count(r:Reader,s:SceneDocument,path:string,key:string,max:number,min=1){numberTo(r,s,path,key,{min,max,integer:true,limit:true});}
function seed(r:Reader,s:SceneDocument,path:string,key='seed'){const n=r.num(path);if(n===undefined)return;if(!Number.isSafeInteger(n)||n<0)fail(`${path} 应为非负安全整数`);s.settings[key]=n>>>0;if(n>0xffffffff)r.warnings.push(`${path} 的 ${n} 为超过 32 位的种子，当前随机数生成器使用低 32 位 ${n>>>0}；随机分布不保证与原版相同。`);}
function commonLocalPalette(r:Reader,s:SceneDocument){
 const palette=r.use('palette');if(palette!==undefined){if(!Array.isArray(palette)||!palette.length||palette.length>MAX_PALETTE_STOPS||palette.some(v=>typeof v!=='string'||!/^#[0-9a-f]{6}$/i.test(v)))fail(`palette 应为 1 至 ${MAX_PALETTE_STOPS} 个 #RRGGBB 色标`);const stops=palette.length===1?[palette[0],palette[0]]:palette;s.palette={name:'原版导入',stops:[...stops] as string[],mode:'linear',offset:0,cycles:1};}
 const cosineEnabled=r.bool('color.use_cosine_palette'),curveEnabled=r.bool('color.use_curve_palette');
 if(cosineEnabled&&curveEnabled)fail('color 同时启用 Cosine 和 Curve，原版优先级未知；请明确保留一种模式');
 const cosineKeys=['a','b','c','d'] as const,curveKeys=['red','green','blue'] as const;
 if(cosineEnabled||cosineKeys.some(k=>r.has('color.cosine_'+k))){
  const coefficients=Object.fromEntries(cosineKeys.map(k=>[k,r.use('color.cosine_'+k)]));
  try{s.palette=validatePalette({...s.palette,cosine:coefficients});}catch(e){fail('color.cosine 参数：'+(e instanceof Error?e.message:String(e)));}
 }
 if(curveEnabled||curveKeys.some(k=>r.has('color.curve_'+k))){
  const curves=Object.fromEntries(curveKeys.map(k=>[k,r.use('color.curve_'+k)]));
  try{s.palette=validatePalette({...s.palette,curves});}catch(e){fail('color.curve 参数：'+(e instanceof Error?e.message:String(e)));}
 }
 if(cosineEnabled)s.palette.mode='cosine';
 if(curveEnabled){s.palette.mode='curve';r.warnings.push('RGB 曲线节点已保留并用于独立的形状保持三次插值；原版曲线控制柄算法和逐点颜色未对照。');}
}
function common(r:Reader,s:SceneDocument){
 const description=r.str('description');if(description!==undefined){if(description.length>8192)fail('description 超过 8192 字符');s.description=description;}
 const bg=firstPath(r,['settings.background_color','settings.backgroundColor']);if(bg&&s.kind!=='roots'){const value=r.str(bg)!;if(!/^#[0-9a-f]{6}$/i.test(value))fail(`${bg} 应为 #RRGGBB`);s.settings.background=value;}
 if(s.kind!=='roots'&&!usesSourceSurfaceParticles(s))numberTo(r,s,'settings.dot_size','pointSize',{min:0,max:1000});
 if(!['domain','roots','fractal'].includes(s.kind)&&!usesSourceSurfaceParticles(s))commonLocalPalette(r,s);
 if(!usesSourceSurfaceParticles(s)&&['surface','attractor','implicit','map','symmetry','perlin','spirograph','bouncing','samila'].includes(s.kind))for(const axis of ['X','Y','Z']){numberTo(r,s,`settings.scale_${axis.toLowerCase()}`,`scale${axis}`);numberTo(r,s,`settings.offset_${axis.toLowerCase()}`,`offset${axis}`);}
 if(!['samila','roots','surface','implicit','attractor','perlin'].includes(s.kind)&&r.has('camera'))r.acknowledge('camera','原版 phi/theta/gamma 与当前轨道相机的约定尚未核对；使用当前相机并由视口适配几何');
 if(r.has('settings.render_mode')&&!['surface','attractor','implicit','map','symmetry','samila','domain','roots'].includes(s.kind))r.acknowledge('settings.render_mode','CPU/GPU 后端选择不移植，使用当前真实实现，不能保证密度和精度相同');
}
function formulaAnnotations(r:Reader,s:SceneDocument){
 if(!r.has('main_equation')&&!r.has('formulas'))return;
 const config=defaultFormulas();
 const latex=(path:string)=>{const value=r.str(path)??'';if(value.length>8192)fail(`${path} 超过 8192 字符`);const trimmed=value.trim();return trimmed.startsWith('\\(')&&trimmed.endsWith('\\)')||trimmed.startsWith('\\[')&&trimmed.endsWith('\\]')?trimmed.slice(2,-2).trim():value;};
 const style=(path:string,visible:boolean)=>{
  const position=r.use(path+'.position');if(position!==undefined&&(!Array.isArray(position)||position.length!==2||position.some(v=>typeof v!=='number'||!Number.isFinite(v))))fail(`${path}.position 应为两个有限坐标`);
  const [x,y]=(position??[0,200]) as number[],color=r.str(path+'.color')??'#ffffff',scale=(r.num(path+'.scale')??.25)*2.5;
  return{visible:r.bool(path+'.enabled')??visible,x:config.referenceWidth/2+x,y:config.referenceHeight/2+y,scale,color,anchor:'center' as const};
 };
 if(r.has('main_equation')){r.object('main_equation');config.main={...style('main_equation',false),...(r.has('main_equation.latex')?{latex:latex('main_equation.latex')}:{})};}
 if(r.has('formulas')){const formulas=r.peek('formulas');if(!Array.isArray(formulas)||formulas.length>32)fail('formulas 应为最多 32 条公式的数组');config.additional=formulas.map((_,i)=>{const path=`formulas.${i}`;r.object(path);return{...style(path,true),id:`imported-formula-${i+1}`,latex:latex(path+'.latex')};});if(!formulas.length)r.use('formulas');}
 try{s.formulas=validateFormulas(config);}catch(error){fail(error instanceof Error?error.message:String(error));}
 r.warnings.push('公式内容、居中锚点、颜色和相对缩放已导入；位置转换至 1280×720 参考画布，原版窗口尺寸及 JLaTeXMath 字体度量未逐帧对照，可在公式标注面板调整。');
}
function geometryMaterial(r:Reader,s:SceneDocument){
 numberTo(r,s,'settings.shininess','shininess',{min:0,max:100});
 for(const [old,key]of [['ambient','ambient'],['specular','specular'],['mesh_wireframe_color','meshWireframeColor']] as const){const value=r.str('settings.'+old);if(value!==undefined){if(!/^#[0-9a-f]{6}$/i.test(value))fail(`${old} 应为 #RRGGBB`);s.settings[key]=value;}}
 const texture=r.str('settings.procedural_texture');if(texture!==undefined){const names:Record<string,string>={none:'none',checkerboard:'checker',check:'checker',checker:'checker',metal:'metal',ceramic:'ceramic',carbon:'carbon'},mapped=names[texture.toLowerCase()];if(!mapped)fail(`未知程序纹理 ${texture}`);s.settings.proceduralTexture=mapped;r.warnings.push('程序纹理使用独立 GPU 物体坐标算法；原版纹理参数和逐像素外观未对照。');}
}
function surface(r:Reader,s:SceneDocument){
 for(const k of ['x','y','z'])equation(r,s,'equations.'+k,k);
 if(usesSourceSurfaceParticles(s)){ordinarySurfaceParticleGeometry(r,s);return;}
 numberTo(r,s,'settings.line_weight','trailWidth',{min:0});
 const original=r.str('settings.surface_mode')??'POINTS';s.settings.renderMode=original==='MESH'?'mesh':'points';if(!['MESH','POINTS'].includes(original))r.warnings.push(`settings.surface_mode=${original} 尚无等价模式；当前显示点采样。`);
 for(const axis of ['u','v']){
  numberTo(r,s,`settings.${axis}_min`,axis+'Min');numberTo(r,s,`settings.${axis}_max`,axis+'Max');
  const segments=firstPath(r,original==='MESH'?[`settings.mesh_${axis}_segments`,`settings.${axis}_segments`]:[`settings.${axis}_segments`,`settings.mesh_${axis}_segments`]);if(segments)count(r,s,segments,axis+'Segments',512,2);
  booleanTo(r,s,`settings.periodic_${axis}`,'periodic'+axis.toUpperCase());
  booleanTo(r,s,`settings.mesh_wrap_${axis}`,'wrap'+axis.toUpperCase());
  booleanTo(r,s,`settings.flowing_${axis}`,'flowing'+axis.toUpperCase());
  const speed=r.use(`settings.speed_${axis}`);if(speed!==undefined){if(typeof speed!=='number'&&typeof speed!=='string')fail(`settings.speed_${axis} 应为表达式`);s.settings['speed'+axis.toUpperCase()]=String(speed);}
 }
 booleanTo(r,s,'settings.mesh_fill','meshFill');booleanTo(r,s,'settings.mesh_wireframe','meshWireframe');numberTo(r,s,'settings.mesh_fill_opacity','opacity',{min:0,max:1});geometryMaterial(r,s);
 booleanTo(r,s,'settings.wireframe_decoupled','meshWireframeDecoupled');
 const wireWidth=firstPath(r,['settings.mesh_line_weight','settings.wireframe_weight']);if(wireWidth)numberTo(r,s,wireWidth,'meshWireframeWidth',{min:.1,max:32});
 const wireCounts:number[]=[];
 for(const axis of ['u','v']){
  const path=`settings.wireframe_${axis}_segments`,n=r.num(path);
  if(n!==undefined){if(!Number.isInteger(n)||n<0)fail(`${path} 应为非负整数`);const lines=n===0?0:n+1;wireCounts.push(lines);s.settings['meshWireframe'+axis.toUpperCase()+'Lines']=Math.min(512,lines);if(lines>512)r.warnings.push(`${path}=${n} 对应 ${lines} 条含两端曲线，超出每方向 512 条资源上限，当前采用 512；原值保留在 source。`);}
  else{wireCounts.push(0);if(s.settings.meshWireframeDecoupled===true)s.settings['meshWireframe'+axis.toUpperCase()+'Lines']=0;}
 }
 if(s.settings.meshWireframeDecoupled===true){
  if(wireCounts.every(n=>n===0)){s.settings.meshWireframeDecoupled=false;r.warnings.push('原版解耦分段数两轴均为 0 时实际回到耦合网格线，已按此行为显示；原标志保留在 source。');}
  else r.warnings.push('独立线框直接采样参数方程；原分段数 N 转换为含域两端的 N+1 条曲线。当前每条曲线默认 128 个采样点，原版曲线采样密度与外观未逐帧对照。');
 }

 const backend=r.str('settings.render_mode');if(backend){const mapped=({CPU:'cpu',GPU:'webgl2',AUTO:'auto'} as Record<string,string>)[backend];if(mapped)s.settings.computeBackend=mapped;else r.warnings.push(`曲面后端 ${backend} 尚未识别，使用当前默认后端。`);}
 for(const [old,key]of [['show_trails','showTrails'],['fade_trails','fadeTrails'],['record_trails','recordTrails']] as const)booleanTo(r,s,'settings.'+old,key);
 numberTo(r,s,'settings.trail_lifetime','trailLifetime',{min:.001,max:60});
 numberTo(r,s,'settings.mesh_wrap_threshold','wrapThreshold',{min:0,max:1});
 booleanTo(r,s,'settings.twisted_u','twistedU');
}
function attractor(r:Reader,s:SceneDocument){
 numberTo(r,s,'settings.line_weight','trailWidth',{min:0});
 for(const k of ['dx','dy','dz'])equation(r,s,'equations.'+k,k);
 s.settings.simulationMode='continuous';s.settings.renderMode='points';s.settings.colorMetric='index';
 stringTo(r,s,'settings.integration_method','integrator',{EULER:'euler',RK4:'rk4',RUNGE_KUTTA_4:'rk4'});
 const dt=firstPath(r,['settings.time_step','settings.time_step_min']);if(dt)numberTo(r,s,dt,'dt',{min:1e-6,max:1});
 const min=r.num('settings.time_step_min'),max=r.num('settings.time_step_max');
 if(min!==undefined||max!==undefined){const lo=min??Number(s.settings.dt),hi=max??lo;if(lo<1e-6||hi>1||hi<lo)fail('time_step_min/max 必须在 [0.000001,1] 且上限不小于下限');Object.assign(s.settings,{dtMin:lo,dtMax:hi,variableTimeStep:lo!==hi});}
 count(r,s,'settings.sub_steps','subSteps',1000);
 const sourceBackend=r.str('settings.render_mode'),gpu=sourceBackend?.toUpperCase()==='GPU';
 s.settings.attractorBackend=gpu?'gpu':'cpu';
 if(sourceBackend!==undefined&&!['CPU','GPU'].includes(sourceBackend.toUpperCase()))r.warnings.push(`原版吸引子 render_mode=${sourceBackend} 按其非 GPU 分支使用 CPU；原值保留在 source。`);
 // JsonAttractorConfig.parseConfig: specific counts win; generic GPU fallback
 // applies only when particle_count_cpu is absent. The unselected count remains
 // source evidence, not an extra interpretation by the generator.
 const countPath=gpu?(r.has('settings.particle_count_gpu')?'settings.particle_count_gpu':!r.has('settings.particle_count_cpu')&&r.has('settings.particle_count')?'settings.particle_count':undefined):firstPath(r,['settings.particle_count_cpu','settings.particle_count']);
 if(countPath)numberTo(r,s,countPath,'particleCount',{min:1,max:gpu?2000000:10000,integer:true});else s.settings.particleCount=gpu?200000:2000;
 for(const path of ['settings.particle_count','settings.particle_count_cpu','settings.particle_count_gpu'])if(path!==countPath&&r.has(path))r.acknowledge(path,'当前后端未选用此粒子数；按原版后端字段优先级保留在 source');
 if(gpu){s.settings.integrator='rk4';r.warnings.push('原版 GPU 更新使用 RK4，与 CPU integration_method 字段无关；已选择独立 GPU RK4 实现。');}
 count(r,s,'initialization.warmup_steps','burnIn',100000,0);
 count(r,s,'initialization.warmup_stagger_min','staggerMin',100000,0);count(r,s,'initialization.warmup_stagger_max','staggerMax',100000,0);
 if(Number(s.settings.staggerMax)<Number(s.settings.staggerMin))fail('随机预热上限小于下限');
 let bounds=0;
 for(const axis of ['x','y','z']){const lo=r.num(`initialization.bounds.min_${axis}`),hi=r.num(`initialization.bounds.max_${axis}`);if(lo!==undefined||hi!==undefined){if(lo===undefined||hi===undefined||hi<lo)fail('初始范围必须提供有序的每轴上下限');s.settings['initialMin'+axis.toUpperCase()]=lo;s.settings['initialMax'+axis.toUpperCase()]=hi;bounds++;}}
 if(bounds){s.settings.useInitialBounds=true;if(bounds!==3)r.warnings.push('初始盒未提供全部三轴；缺失轴保留当前默认边界，原值保留在 source。');}
 const initialization=r.str('initialization.mode');if(initialization!==undefined&&initialization!=='RANDOM_BOX')r.warnings.push(`初始化模式 ${initialization} 尚未等效，当前使用初始盒/坐标；原值保留在 source。`);
 for(const [old,key]of [['show_trails','showTrails'],['fade_trails','fadeTrails'],['record_trails','recordTrails']] as const)booleanTo(r,s,'settings.'+old,key);
 numberTo(r,s,'settings.trail_lifetime','trailLifetime',{min:.001,max:60});seed(r,s,'settings.seed');
 if(gpu&&s.settings.showTrails===true){s.settings.showTrails=false;r.warnings.push('原版 GPU 模式不绘制历史拖尾；show_trails 原值保留在 source，当前 GPU 点云关闭拖尾。');}
 r.warnings.push('连续粒子按固定 30 模拟帧/秒重放；dt 范围、子步、独立初始盒和预热已保留，原版实际帧节奏与随机序列未对照。');
}
function iteratedLegacy(r:Reader,s:SceneDocument){
 s.settings.iteratedMode='continuous';s.settings.iteratedFps=60;s.settings.paletteMode='source';s.settings.iteratedColor=s.kind==='samila'?'noise':'step';
 count(r,s,'settings.batch_size','batchSize',8000000);count(r,s,'settings.iterations_per_frame','iterationsPerFrame',16);seed(r,s,'settings.seed');
 for(const [old,key,min,max]of [['accumulation_decay','accumulationDecay',0,1],['step_metric_min','stepMetricMin',0,1e12],['step_metric_max','stepMetricMax',.001,1e12],['color_speed','colorSpeed',.001,100],['color_phase','colorPhase',-1e9,1e9]] as const)numberTo(r,s,'settings.'+old,key,{min,max});
 if(s.kind==='map'||s.kind==='symmetry'){
  for(const [old,key,fallback,sourceMin,sourceMax,legacyMin,legacyMax]of [['gamma','Gamma',2.2,.1,10,.1,8],['contrast','Contrast',1,.1,2,0,8],['brightness','Brightness',s.kind==='map'?.3:.5,-.5,1.5,-1,1],['saturation','Saturation',.8,0,1,0,4],['dynamic_range','DynamicRange',s.kind==='map'?.2:.5,.1,1,.001,1e9]]as const){
   const value=r.num('settings.'+old,s.parameters),effective=Math.min(sourceMax,Math.max(sourceMin,value??fallback));s.settings['normalized'+key]=effective;
   if(value!==undefined){const legacy=Math.min(legacyMax,Math.max(legacyMin,value));s.settings[key[0].toLowerCase()+key.slice(1)]=legacy;
    if(value!==effective||value!==legacy)r.warnings.push(`settings.${old}=${value}：归一模型按源运行边界使用 ${effective}，兼容白点模型使用 ${legacy}；原值保留在 source。`);
   }
  }
  r.warnings.push('已另存 Map/Symmetry 的归一调色参数与源默认值；当前仍使用兼容白点模型。可从已完成图像显式启用归一调色并保存本地参考尺寸，原应用的参考画布尺寸未知。');
  if(r.has('settings.invert'))r.warnings.push('Invert 的公开声明与包内绑定不一致：Map 固定补色，Symmetry 固定关闭 invert；该源字段未映射为可变控制。');
 }else{
  const object=r.object('settings'),source:SamilaToneSource|undefined=object===undefined?undefined:{};
  if(source)for(const key of samilaToneSourceFields){const value=r.num('settings.'+key,s.parameters);if(value!==undefined)source[key]=value;}
  const tone=importSamilaTone(source);Object.assign(s.settings,tone.normalized,tone.legacy);r.warnings.push(...tone.warnings);
  if(object&&Object.keys(object).length===0)r.use('settings');
 }
 stringTo(r,s,'settings.step_metric_normalize_mode','stepMetricNormalize',{CLAMP:'clamp',ROBUST:'robust'});
 if(Number(s.settings.stepMetricMax)-Number(s.settings.stepMetricMin)<.001)fail('步长度量上限须至少大于下限 0.001');
 if(s.kind==='samila'){numberTo(r,s,'settings.alpha','alpha',{min:0,max:1});booleanTo(r,s,'settings.show_trails','showTrails');numberTo(r,s,'settings.trail_lifetime','trailLifetime',{min:.001,max:3600});}
 else{if(r.has('settings.show_trails'))r.acknowledge('settings.show_trails','Map/Symmetry 密度由 accumulation_decay 控制；此通用拖尾标记未作为线段历史');if(r.has('settings.trail_lifetime'))r.acknowledge('settings.trail_lifetime','Map/Symmetry 的包内密度管线采用逐帧 accumulation_decay，不将通用寿命字段误作另一层衰减');}
 const custom=hasSymmetryCustom(s);
 const backend=r.str('settings.render_mode');if(backend){const mode=backend.toUpperCase();if(!['CPU','GPU','AUTO'].includes(mode))fail('未知持续批次 render_mode');s.settings.iteratedBackend=mode==='CPU'?'cpu':mode==='GPU'?'gpu':'auto';if(!custom)r.warnings.push('持续批次后端选择已保留：GPU 使用独立 float32 状态和浮点累积；设备或公式不支持时明确回退 CPU，不保证原版随机序列、像素或性能相同。');}
 r.warnings.push(custom
  ?'自定义 GLSL 源码与参数已保留；持续批次使用 WebGL2 片元着色器，最后一次 calculate_next 写出的 stepMetric 用于颜色。CPU 选择或 GPU 不可用时明确报错；不改用内置公式。GLSL ES 3.00 支持与循环预算有明确限制，原版像素、随机序列及性能未对照。'
  :'持续批次按固定 60 Hz 重放：Map/Symmetry 保留并行状态并对最后一步距离着色，Samila 每帧产生新的确定随机样本。随机序列、视口适配、噪声颜色及色调链独立实现；原版像素与帧率相关 Replay 过渡未验证。');
}
function mapAttractor(r:Reader,s:SceneDocument){
 equation(r,s,'equations.x_next','x');equation(r,s,'equations.y_next','y');
 const dimension=r.num('settings.dimension')??2;if(dimension!==2&&dimension!==3)fail('映射 dimension 必须为 2 或 3');s.settings.dimension=dimension;
 const z=r.str('equations.z_next');s.equations.z=z?.trim()?z:'z';
 if(dimension===3&&!z?.trim())r.warnings.push('3D 映射没有非空 z_next，按原版维度默认规则保持 z。');
 iteratedLegacy(r,s);count(r,s,'settings.burn_in_steps','burnIn',100000,0);
 s.settings.initialMode='box';
 for(const axis of ['X','Y'])for(const edge of ['Min','Max'])numberTo(r,s,`settings.${axis.toLowerCase()}0_${edge.toLowerCase()}`,`initial${axis}${edge}`);
 // The reference initializes 3D z uniformly in [-1,1]; it has no configurable source z0 bounds.
 s.settings.initialZMin=-1;s.settings.initialZMax=1;
 for(const axis of ['X','Y'])if(Number(s.settings['initial'+axis+'Max'])<Number(s.settings['initial'+axis+'Min']))fail('映射初始盒上限小于下限');
 r.warnings.push('已保留二维/三维坐标、逐轴初始盒与 nx/ny 级联别名；初始化采用项目保存的确定种子，不保证原版 Java Random 序列。');
}

function implicit(r:Reader,s:SceneDocument){
 equation(r,s,'equation.f','f');for(const axis of ['x','y','z'])for(const edge of ['min','max'])numberTo(r,s,`settings.${axis}_${edge}`,edge+axis.toUpperCase());
 for(const axis of ['x','y','z'])count(r,s,`settings.${axis}_segments`,'resolution'+axis.toUpperCase(),200,4);
 numberTo(r,s,'settings.iso_threshold','isoLevel');const mode=r.str('settings.render_mode');
 if(mode){const map:Record<string,string>={SOLID:'mesh',WIREFRAME:'mesh',POINTS:'points',WIREFRAME_FILL:'mesh',PREVIEW:'points'};s.settings.renderMode=map[mode]??mode;if(mode==='WIREFRAME'||mode==='WIREFRAME_FILL')s.settings.meshWireframe=true;}
 booleanTo(r,s,'settings.mesh_fill','meshFill');numberTo(r,s,'settings.mesh_fill_opacity','opacity',{min:0,max:1});geometryMaterial(r,s);
 const backend=r.str('settings.mesh_mode');if(backend!==undefined){const names:Record<string,string>={CPU:'cpu',GPU:'webgl2',AUTO:'auto'};if(!names[backend])fail(`未知隐式曲面后端 ${backend}`);s.settings.computeBackend=names[backend];r.warnings.push('标量场后端已映射；独立 Marching Tetrahedra 与原版 Marching Cubes 的网格拓扑未保证相同。');}
}
function symmetry(r:Reader,s:SceneDocument){
 const glsl=r.use('equation.glsl');if(glsl!==undefined&&glsl!==null){if(typeof glsl!=='string'||glsl.length>MAX_SYMMETRY_CUSTOM_SOURCE_LENGTH)fail('equation.glsl 应为最多 65536 字符的文本');s.equations.glsl=glsl;}
 const formula=r.use('equation.formula');if(formula!==undefined&&formula!==null){if(typeof formula!=='string'||formula.length>8192)fail('equation.formula 应为最多 8192 字符的说明文字');s.equations.formula=formula;}
 if(hasSymmetryCustom(s)){
  // Native config getter: missing -> 3, Double.intValue -> max(2, value).
  // The authored parameter itself is independent and remains the uniform input.
  const degree=s.parameters.symmetry_degree??3;
  s.settings.degree=Math.max(2,Math.min(2147483647,Math.trunc(degree)));
  if(s.settings.degree!==degree)r.warnings.push(`symmetry_degree 的编译阶数按原版整数转换为 ${s.settings.degree}；参数原值 ${degree} 保留供 uniform 使用。`);
 }else numberTo(r,s,'parameters.symmetry_degree','degree',{min:2,max:50,integer:true});
 iteratedLegacy(r,s);count(r,s,'settings.burn_in_steps','burnIn',100000,0);
 s.settings.initialMode='box';for(const axis of ['X','Y'])for(const edge of ['Min','Max']){const key='initial'+axis+edge;s.settings[key]=edge==='Min'?.001:.002;numberTo(r,s,`settings.${axis.toLowerCase()}0_${edge.toLowerCase()}`,key);}
 const template=r.str('equation.template')??'standard';s.settings.template=template;
 if(!['standard','modified'].includes(template))r.warnings.push(hasSymmetryCustom(s)?`未知对称模板 ${template} 已保留；当前使用自定义 GLSL。`:`未知对称模板 ${template}，保留标识；生成器会明确报错。`);
 if(!hasSymmetryCustom(s))numberTo(r,s,'parameters.delta_power','deltaPower',{min:1,max:6,integer:true});
 if(formula!==undefined&&formula!==null)r.warnings.push('equation.formula 已保留为只读说明；实际计算使用非空 equation.glsl 或所选模板。');
}

function perlin(r:Reader,s:SceneDocument){
 stringTo(r,s,'settings.flow_mode','flow',{ANGLE_FIELD:'angle',VECTOR_FIELD:'curl',CURL_FIELD:'curl',SWIRL_FIELD:'swirl'});stringTo(r,s,'settings.angle_map','angleMap',{LINEAR:'linear',SOFT_POWER:'soft-power'});
 const renderer=r.str('settings.render_mode'),cpuStyle=r.str('settings.cpu_render_style');if(renderer!==undefined&&!['CPU','GPU'].includes(renderer))fail('未知噪声 render_mode');
 if(cpuStyle!==undefined){const styles:Record<string,string>={PARTICLES:'continuous',FIELD_CURVES:'field-curves',CURVES:'streams'};if(!styles[cpuStyle])fail('未知噪声 cpu_render_style');s.settings.style=styles[cpuStyle];}
 const gpuStyle=r.num('settings.gpu_render_style');if(gpuStyle!==undefined&&gpuStyle!==0&&gpuStyle!==1)fail('gpu_render_style 必须为 0 或 1');if(renderer==='GPU'){s.settings.style=gpuStyle===1?'water':'filament';s.settings.perlinBackend='auto';}else if(cpuStyle===undefined)s.settings.style='continuous';
 const texture=r.num('settings.gpu_texture_style');if(texture!==undefined){if(!Number.isInteger(texture)||texture<0||texture>5)fail('gpu_texture_style 必须为 0 至 5');s.settings.textureStyle=['fiber','streak','silk','water','flame','mist'][texture];}
 count(r,s,'settings.particle_count','particleCount',20000);if(s.settings.style==='streams')count(r,s,'settings.particle_count','count',10000);numberTo(r,s,'settings.noise_scale','noiseScale',{min:s.settings.style==='continuous'?0:.001,max:100});numberTo(r,s,'settings.noise_offset','noiseOffset');numberTo(r,s,'settings.time_scale','timeSpeed',{min:-10,max:10});seed(r,s,'settings.seed');
 const fields:Record<string,[string,number,number,boolean?]>={curve_count:['curveCount',1,20000,true],curve_length:['curveLength',2,2000,true],curve_step_size:['curveStepSize',.001,100],curve_alpha:['curveAlpha',0,1],field_cell_size:['fieldCellSize',1,500,true],curve_noise_scale:['curveNoiseScale',0,100],curve_noise_octaves:['curveNoiseOctaves',1,8,true],curve_noise_offset:['curveNoiseOffset',-10000,10000],curve_angle_scale:['curveAngleScale',0,100],seed_space_circle_count:['seedSpaceCircleCount',0,500,true],seed_space_min_radius:['seedSpaceMinRadius',0,10000],seed_space_max_radius:['seedSpaceMaxRadius',0,10000],gpu_noise_frequency:['textureFrequency',.01,100],gpu_warp_amplitude:['warpAmplitude',0,10],gpu_warp_frequency:['warpFrequency',0,100],gpu_direction_offset:['directionOffset',-10000,10000],gpu_time_speed:['textureTimeSpeed',-10,10],gpu_march_steps:['marchSteps',1,128,true],gpu_step_size:['marchStepSize',.0001,.5],gpu_brightness:['textureBrightness',0,10],gpu_vignette_power:['vignettePower',0,5],gpu_fiber_strength:['fiberStrength',0,1]};
 for(const [old,[key,min,max,integer]]of Object.entries(fields))numberTo(r,s,'settings.'+old,key,{min,max,integer});
 stringTo(r,s,'settings.curve_sampling_mode','curveSampling',{RANDOM:'random',JITTERED_GRID:'jittered-grid'});stringTo(r,s,'settings.curve_color_mode','curveColor',{INDEX:'index',POSITION:'position',NOISE:'noise',SEED_SPACE:'seed-space'});
 if(cpuStyle==='FIELD_CURVES'){numberTo(r,s,'settings.line_weight','curveLineWidth',{min:.1,max:32});r.warnings.push('Field Curves 的双向积分、抖动网格和空间色圆已映射；场域使用可编辑的 800×800，原版视窗尺度、Processing 噪声序列和栅格结果不保证一致。');}
 if(renderer==='GPU')r.warnings.push('原版 GPU 噪声纹理转换为独立 WebGL2 沿场积分；不可用时明确回退 CPU。Filament/Water 和全部纹理参数可用，但不宣称原版着色器逐像素等效。');
 const step=r.num('settings.step_size');if(step!==undefined){if(step<0||step>5)fail('噪声 step_size 超出范围');s.settings.particleSpeed=step*60;s.settings.stepSize=step;if(s.settings.style==='streams'&&step===0)fail('流线 step_size 必须为正数');}
 const respawn=r.num('settings.respawn_rate');if(respawn!==undefined){if(respawn<0||respawn>1)fail('respawn_rate 必须为 0 至 1');s.settings.respawnEveryStep=respawn===1;s.settings.respawnRate=respawn===1?0:-60*Math.log1p(-respawn);r.warnings.push('原版 respawn_rate 按 60 Hz 每帧概率转换为连续时间重生强度；独立随机序列不保证相同。');}
 numberTo(r,s,'settings.accumulation_fade_alpha','accumulationFade',{min:0,max:255});numberTo(r,s,'settings.trail_lifetime','trailLifetime',{min:.001,max:3600});numberTo(r,s,'settings.dot_size','particleRadius',{min:0,max:8});booleanTo(r,s,'settings.fade_trails','fadeTrails');booleanTo(r,s,'settings.show_trails','showTrails');
 const accumulation=r.domainBoolean(['settings','use_accumulation_buffer'],false,'default');s.settings.particleDisplay=accumulation?'accumulation':s.settings.showTrails===false?'heads':'trails';
 if(s.settings.style==='continuous')r.warnings.push('持续粒子采用固定 60 Hz 独立 CPU 推进、环绕、重生和衰减累积；拖尾每 5 步采样一次以限制历史内存，原版帧时序、栅格和噪声序列未逐像素校验。');
 r.warnings.push('流场与参数探索采用独立确定性算法，不声明原版噪声/随机选择逐值等效。');
}
function spirograph(r:Reader,s:SceneDocument){
 r.object('settings');r.object('settings.sceneTransform');
 const rawLayers=r.peek('settings.layers');
 if(rawLayers!==undefined&&!Array.isArray(rawLayers))fail('settings.layers 应为数组');
 if(Array.isArray(rawLayers)&&rawLayers.length>32)fail('旋轮图层超过本地 32 层容量');
 // Explicit empty layers resets the source to its base default layer. Omission
 // instead selects the legacy top-level layer fields.
 const explicit=Array.isArray(rawLayers)&&rawLayers.length>0,legacy=rawLayers===undefined;
 const layers=explicit?rawLayers:[legacy?(r.object('settings')??{}):{}];
 if(Array.isArray(rawLayers)&&!rawLayers.length)r.use('settings.layers');
 const converted=layers.map((entry,index)=>{
  if(!isObject(entry))fail(`旋轮图层 ${index+1} 应为对象`);
  const path=explicit?`settings.layers.${index}`:legacy?'settings':undefined;
  const num=(key:string,fallback:number)=>path?r.spiroConfigNumber(path+'.'+key,fallback):fallback;
  const str=(key:string,fallback:string)=>path?r.str(path+'.'+key)??fallback:fallback;
  const bool=(key:string,fallback:boolean)=>path?r.domainBoolean(path+'.'+key,fallback):fallback;
  const out:ObjectValue={id:explicit?str('id',`import-layer-${index}`):'import-layer-0',name:explicit?str('name',`Layer ${index+1}`):'Layer 1',statorColor:explicit?str('statorColor','#B4B4B4'):'#B4B4B4',strokeColor:str('strokeColor','#2E8B57'),statorRadius:num('statorRadius',300),penDistance:num('penDistance',150),speed:num('speed',1),strokeWidth:num('strokeWidth',1),showGuides:bool('showGuides',true),autoStopOnClosure:bool('autoStopOnClosure',true),visible:explicit?bool('visible',true):true,enabled:explicit?bool('enabled',true):true};
  if(!out.id)out.id=`import-layer-${index}`;
  // These existing local extensions are retained when explicitly present;
  // they are not invented native fields or fed into the source defaults.
  if(explicit)for(const key of ['phase','direction','opacity','turns']){const v=r.num(path+'.'+key);if(v!==undefined)out[key]=v;}
  if(explicit){const value=r.bool(path+'.repeatGradient');if(value!==undefined)out.repeatGradient=value;}
  const palette=explicit?r.use(path+'.palette'):undefined;
  if(palette!==undefined&&palette!==null&&!Array.isArray(palette))fail(`${path}.palette 应为数组`);
  out.palette=Array.isArray(palette)&&palette.length?palette:[out.strokeColor];
  if(Array.isArray(palette)&&palette.length)out.strokeColor=palette[0];
  const rotors=path?r.peek(path+'.rotors'):undefined;
  if(rotors!==undefined&&!Array.isArray(rotors))fail(`${path}.rotors 应为数组`);
  if(legacy&&Array.isArray(rotors)&&!rotors.length)fail('原版旧格式显式空转子链无法生成旋轮');
  out.rotors=Array.isArray(rotors)&&rotors.length?rotors.map((entry,i)=>{
   if(!isObject(entry))fail(`${path}.rotors.${i} 应为对象`);
   const p=`${path}.rotors.${i}`,mode=r.str(p+'.mode')??'INSIDE';
   if(!['INSIDE','OUTSIDE'].includes(mode.toUpperCase()))fail(`${p}.mode 无效`);
   return{radius:r.spiroConfigNumber(p+'.radius',1),mode:mode.toLowerCase()};
  }):[{radius:150,mode:'inside'}];
  if(Array.isArray(rotors)&&!rotors.length)r.use(path+'.rotors');
  return out;
 });
 try{s.settings.layers=JSON.stringify(parseSpirographLayers(JSON.stringify(converted)));}catch(e){fail(e instanceof Error?e.message:String(e));}
 for(const key of ['startEaseEnabled','endEaseEnabled','fadeInStatorsOnStart','fadeOutStatorsOnFinish'])s.settings[key]=r.domainBoolean('settings.'+key,key!=='fadeOutStatorsOnFinish');
 for(const [field,key,fallback]of [['scale','scale',1],['offsetX','offsetX',0],['offsetY','offsetY',0],['rotationDegrees','rotation',0]] as const)s.settings[key]=r.spiroConfigNumber('settings.sceneTransform.'+field,fallback);
 s.settings.spirographVersion='mathart-1.7.8-v1';s.settings.spiroView='native';s.settings.animate=true;
 s.settings.spirographClock='source-frame-v1';s.settings.spirographSimulationFps=60;s.settings.finishTrace=false;s.spirographFrameEvents=[];
 r.warnings.push('已启用 MathArt 1.7.8 旋轮规则：场景旋转保留原度数、Y 偏移正值向下，原生视口每单位为一像素；旋转动画目标速率为弧度/秒。未运行原版应用，绘制时钟、抗锯齿与像素结果不保证一致。');
 r.warnings.push('新导入使用 60 FPS 离线逐帧算法参考；这是本地可保存的模拟时钟选择，不是原应用实时帧率。旧本地作品不会自动升级。');
}

function bouncing(r:Reader,s:SceneDocument){
 // Import policy is selected after all original timeline actions are parsed.
 s.settings.bouncingPlaybackModel='timeline-v1';
 const recordDuration=r.num('settings.record_duration',s.parameters);
 if(recordDuration!==undefined){s.settings.bouncingRecordDuration=recordDuration;if(recordingDurationError(recordDuration))r.warnings.push(`record_duration=${recordDuration} 超出本地实时录制的 0.1–3600 秒范围；原值已保留，请修改独立录制时长后录制。`);}
 stringTo(r,s,'settings.container_shape','boundary',{CIRCLE:'circle',ELLIPSE:'ellipse',POLYGON:'polygon'});
 const radius=firstPath(r,s.settings.boundary==='circle'?['settings.circle_radius','settings.boundary_radius']:['settings.boundary_radius','settings.circle_radius']);if(radius)numberTo(r,s,radius,'radius',{min:.01,max:1000});if(s.settings.boundary==='ellipse'){numberTo(r,s,'settings.ellipse_semi_major_axis','radius',{min:.01,max:1000});numberTo(r,s,'settings.ellipse_semi_minor_axis','ellipseY',{min:.01,max:1000});}
 if(s.settings.boundary==='polygon'){const polygon=r.use('polygon');if(!Array.isArray(polygon))fail('多边形边界缺少 polygon 数组');s.settings.polygon=JSON.stringify(polygon);}
 for(const axis of ['x','y']){const path=firstPath(r,s.settings.boundary==='circle'?[`settings.circle_center_${axis}`,`settings.boundary_center_${axis}`]:[`settings.boundary_center_${axis}`,`settings.circle_center_${axis}`]);if(path)numberTo(r,s,path,'boundaryCenter'+axis.toUpperCase());numberTo(r,s,`settings.initial_circle_center_${axis}`,'shapeCenter'+axis.toUpperCase());numberTo(r,s,`settings.velocity_center_${axis}`,'velocityCenter'+axis.toUpperCase());}
 stringTo(r,s,'settings.initial_position_mode','shape',{BOX:'box',CIRCLE:'circle',RING:'ring',SPIRAL:'spiral',ARCHIMEDEAN_SPIRAL:'archimedean',STAR:'star',HEART:'heart',INFINITY:'infinity',LISSAJOUS:'lissajous',ROSE:'rose',SUPERELLIPSE:'superellipse',HYPOCYCLOID:'hypocycloid',EPICYCLOID:'epicycloid',FORMULA:'formula'});
 if(s.settings.shape==='archimedean')r.warnings.push('原包配置接受 ARCHIMEDEAN_SPIRAL，但形状工厂未见专用分支；此处实现标准阿基米德曲线，不声明等同原版未验证分支行为。');
 numberTo(r,s,'settings.initial_circle_radius','initialRadius',{min:0,max:1000});numberTo(r,s,'settings.initial_speed','speed',{min:0,max:100});numberTo(r,s,'settings.initial_angle','angle');numberTo(r,s,'settings.initial_angle_spread','spread',{min:0,max:Math.PI*2});numberTo(r,s,'settings.velocity_noise','velocityNoise',{min:0,max:1});count(r,s,'settings.particle_count','count',5000000);
 stringTo(r,s,'settings.initial_velocity_mode','velocity',{UNIFORM:'uniform',RANDOM:'random',RADIAL_OUT:'out',RADIAL_IN:'in',TANGENTIAL_CW:'cw',TANGENTIAL_CCW:'ccw'});
 const formula=r.str('settings.shape_formula');if(formula?.trim())s.equations.mask=formula;const fill=r.str('settings.shape_fill_mode');if(fill){if(!['FILL','OUTLINE'].includes(fill))fail('未知 shape_fill_mode');s.settings.fill=fill==='FILL';}
 const fields:Record<string,[string,number,number,boolean?]>={shape_inner_ratio:['shapeInnerRatio',0,1],shape_num_points:['shapeDegree',2,64,true],shape_num_turns:['shapeTurns',.01,100],shape_tightness:['shapeTightness',0,100],shape_line_width:['shapeLineWidth',0,1000],shape_lissajous_a:['shapeLissajousA',1,64,true],shape_lissajous_b:['shapeLissajousB',1,64,true],shape_lissajous_delta:['shapeLissajousDelta',-10000,10000],shape_rose_k:['shapeRoseK',1,64,true],shape_superellipse_n:['shapeSuperellipseN',.1,100],shape_k:['shapeK',2,64,true]};
 for(const [old,[key,min,max,integer]]of Object.entries(fields))numberTo(r,s,'settings.'+old,key,{min,max,integer});
 if(s.settings.shape==='box'){s.settings.shapeBoxBounds=true;for(const axis of ['x','y'])for(const edge of ['min','max'])numberTo(r,s,`settings.${axis}0_${edge}`,`box${edge==='min'?'Min':'Max'}${axis.toUpperCase()}`);}
 const boundaryColor=r.str('settings.boundary_color');if(boundaryColor!==undefined)s.settings.boundaryColor=boundaryColor;booleanTo(r,s,'settings.show_boundary','showBoundary');
 const backend=r.str('settings.render_mode');if(backend){if(!['CPU','GPU'].includes(backend.toUpperCase()))fail('未知弹跳 render_mode');s.settings.bouncingBackend=backend.toUpperCase()==='CPU'?'cpu':'auto';if(backend.toUpperCase()==='GPU'){s.settings.bouncingPresentation='raster';s.settings.bouncingHistoryFps=30;r.warnings.push('原版 GPU 选择已映射为最多 500 万粒子的直接图像与固定 30 Hz 有限历史，初始随机序列、混合和色调独立实现；不保证原版像素相同。');}}
 seed(r,s,'settings.seed');booleanTo(r,s,'settings.show_trails','trails');numberTo(r,s,'settings.trail_lifetime','trailDuration',{min:.001,max:60});
 if(s.settings.shape==='formula'){s.settings.formulaDomain='disc';s.settings.formulaCoordinates='world';s.settings.formulaResolution=256;if(s.settings.shapeLineWidth!==undefined)s.settings.shapeLineWidth=Number(s.settings.shapeLineWidth)/2;r.warnings.push('公式按原版世界坐标和圆盘采样域导入；轮廓采用独立网格边界和弧长带宽采样，分布不保证等同原版随机筛选。');}
 numberTo(r,s,'settings.particle_radius','collisionRadius',{min:0,max:1000});
 if(r.has('settings.time_step')){numberTo(r,s,'settings.time_step','bouncingTimeStep',{min:.0001,max:.25});s.settings.bouncingClock='fixed-step';s.settings.bouncingFps=60;r.warnings.push('每帧 time_step 已映射到固定每秒 60 仿真帧，保证预览/导出/跳转一致；原版实时帧率并未作为可重现时钟验证。');}
 if(r.has('settings.sub_steps')){numberTo(r,s,'settings.sub_steps','bouncingSubsteps',{min:1,max:16,integer:true});r.warnings.push('sub_steps 保留为仿真来源；精确弹道解对步长细分不敏感，未伪造精度控件。');}
 r.warnings.push('弹跳形状、初始速度噪声与各中心已导入；CPU 曲线填充采用采样轮廓的奇偶内部规则，随机分布与原版不保证一致。碰撞半径已映射到圆/椭圆轴缩减或凸多边形内缩；CPU 使用精确镜面反射，GPU 弹道更新已独立实现并保留 CPU 回退；图像历史按有限寿命从种子重放，不声称原版无限时长累积或实时性能。');
}

function samila(r:Reader,s:SceneDocument){
 equation(r,s,'equations.f1','f1');equation(r,s,'equations.f2','f2');
 // Original labels use vertical-vs-horizontal ordering; project files use explicit X_Y ordering.
 const mapping:Record<string,string>={f1_vs_f2:'f2_f1',f2_vs_f1:'f1_f2',f1_vs_x1:'x_f1',f2_vs_x1:'x_f2',f1_vs_x2:'y_f1',f2_vs_x2:'y_f2',x1_vs_f1:'f1_x',x1_vs_f2:'f2_x',x2_vs_f1:'f1_y',x2_vs_f2:'f2_y',f1f2_vs_f1:'f1_product',f1f2_vs_f2:'f2_product',f1_vs_f1f2:'product_f1',f2_vs_f1f2:'product_f2',kaleidoscope_vs_x:'kaleidoscope_x',x_vs_kaleidoscope:'x_kaleidoscope',swirl_vs_x:'swirl_x',x_vs_swirl:'x_swirl',warp_vs_x:'warp_x',x_vs_warp:'x_warp',cos_mod_vs_x:'cosmod_x',x_vs_cos_mod:'x_cosmod',radial_vs_x:'radial_x',x_vs_radial:'x_radial',fold_vs_x:'fold_x',x_vs_fold:'x_fold',random:'random'};
 const m=r.str('settings.generate_mode');if(m!==undefined){s.settings.mapping=mapping[m.toLowerCase()]??m;r.warnings.push(...(mapping[m.toLowerCase()]?[]:[`未知 Samila 模式 ${m}，保留原标识；生成器会明确报错。`]));}
 const projections:Record<string,string>={rectilinear:'cartesian',polar:'polar',aitoff:'aitoff',hammer:'hammer',lambert:'lambert',mollweide:'mollweide',random:'random'};
 const p=r.str('settings.projection');if(p!==undefined){s.settings.projection=projections[p.toLowerCase()]??p;if(!projections[p.toLowerCase()])r.warnings.push(`未知 Samila 投影 ${p}，保留原标识；生成器会明确报错。`);}
 for(const key of ['start','stop','rotation'])numberTo(r,s,'settings.'+key,key);iteratedLegacy(r,s);seed(r,s,'settings.seed');seed(r,s,'settings.func_seed','funcSeed');
 r.warnings.push('Samila 的 26 个组合与随机模式已映射；使用独立的确定性采样。球面投影采用标准经纬归一化，Aitoff 横轴为标准双倍比例，与原版未归一化投影不保证像素一致；逐帧采样现可持续累积，原版 GPU 噪声着色、随机序列与色调数值仍有差异。');
}

function domain(r:Reader,s:SceneDocument){
 // This entry point follows the shipped runtime Config parser. ProjectState's
 // UI import has different missing-palette/render defaults; do not conflate them.
 r.object('domainColoring');
 const cpuSetting=r.use('settings.isCPURender'),renderMode=r.use('settings.render_mode');
 let sourceCpu=cpuSetting===true||typeof cpuSetting==='string'&&cpuSetting.toLowerCase()==='true';
 if(renderMode!==undefined&&renderMode!==null)sourceCpu=typeof renderMode!=='string'||renderMode.toUpperCase()!=='GPU';
 s.settings.domainColorVersion=sourceCpu?'mathart-1.7.8-cpu':'mathart-1.7.8-gpu';s.settings.domainViewportVersion=sourceCpu?'mathart-1.7.8-cpu':'mathart-1.7.8-gpu';s.settings.domainIterationVersion=sourceCpu?'mathart-1.7.8-cpu':'mathart-1.7.8-gpu';s.settings.domainSourceImportPath='runtime-config';
 if(!sourceCpu){s.settings.domainRenderPolicy='source-cpu-on-gpu-failure-v1';r.warnings.push('新导入的 GPU 域着色在 GPU 故障后使用原产物 CPU 公式、视口与着色整链；三项作者选择和原文保留。恢复策略为本地显式规则，旧保存作品不会自动升级。');}
 const sourcePalette=r.use('palette');if(sourcePalette!==undefined){try{s.domainSourcePalette=parseDomainSourcePalette({colors:sourcePalette});}catch(error){fail(error instanceof Error?error.message:String(error));}}
 s.settings.iterationSteps=1;s.settings.iterationMaxSteps=64;
 const rawFormula=r.use('domainColoring.formula');
 if(rawFormula===undefined||rawFormula===null)s.equations.f='z^3 - 1';
 else{if(!['string','number','boolean'].includes(typeof rawFormula)||String(rawFormula).length>8192)fail('domainColoring.formula 应为不超过 8192 字符的公式');s.equations.f=String(rawFormula);}
 const formulaParams=r.nativeDomainParameters('domainColoring.formulaParams');for(const [k,v]of Object.entries(formulaParams))if(Object.hasOwn(s.parameters,k)&&s.parameters[k]!==v)r.warnings.push(`domainColoring.formulaParams.${k} 与 parameters.${k} 冲突，使用顶层 parameters 值。`);
 s.parameters=parseDomainNativeParameters({...formulaParams,...s.parameters});
 // RuntimeConfig owns these defaults and evaluates expressions without formula
 // parameters. Keep authored finite S; the viewport owner resolves max(1e-9,S).
 // Processing's nullable scalar getter retains the current default for null.
 r.object('domainColoring.viewport');
 for(const [key,fallback]of [['centerX',0],['centerY',0],['scale',2.5]] as const){
  const path='domainColoring.viewport.'+key;
  if(r.peek(path)===null){r.use(path);s.settings[key]=fallback;}
  else s.settings[key]=r.num(path)??fallback;
 }
 s.settings.rotation=0;
 r.acknowledge('domainColoring.viewport.rotation','原版运行时忽略此字段，初始旋转为 0');
 // The source constant is a + b*i; it is distinct from per-pixel c in parameter-plane iteration.
 const constant=prepareDomainNativeConstant({formula:s.equations.f,parameters:s.parameters});
 s.settings.constantReal=constant.baseConstant[0];s.settings.constantImag=constant.baseConstant[1];r.warnings.push(...constant.diagnostics);
 for(const [old,key]of Object.entries({phaseDensity:'phaseDensity',modDensity:'modDensity',phaseSharpness:'phaseSharpness',modSharpness:'modSharpness',bias:'curveBias',mix:'curveMix'}))numberTo(r,s,'domainColoring.levelCurve.'+old,key);
 stringTo(r,s,'domainColoring.levelCurve.mode','curveMode');
 if(r.has('domainColoring.iteration')){
  r.object('domainColoring.iteration');booleanTo(r,s,'domainColoring.iteration.enabled','iterationEnabled');stringTo(r,s,'domainColoring.iteration.seedMode','seedMode');
  numberTo(r,s,'domainColoring.iteration.steps','iterationSteps',{integer:true});numberTo(r,s,'domainColoring.iteration.maxSteps','iterationMaxSteps',{integer:true});numberTo(r,s,'domainColoring.iteration.escapeRadius','bailout');r.acknowledge('domainColoring.iteration.constant','原版运行时不读取此字段；常量基值来自初始参数 a/b');
  const next=r.use('domainColoring.iteration.nextFormula');if(next!==undefined&&next!==null){if(!['string','number','boolean'].includes(typeof next)||String(next).length>8192)fail('domainColoring.iteration.nextFormula 应为不超过 8192 字符的公式');s.equations.next=String(next);}
 }else if(r.has('domainColoring.sampling')){
  r.object('domainColoring.sampling');numberTo(r,s,'domainColoring.sampling.iterations','iterationSteps',{integer:true});numberTo(r,s,'domainColoring.sampling.maxIterations','iterationMaxSteps',{integer:true});numberTo(r,s,'domainColoring.sampling.clampMagnitude','bailout');
  s.settings.iterationEnabled=Number(s.settings.iterationSteps)>1;
 }
 r.warnings.push('Domain 按 MathArt 1.7.8 运行时配置导入：缺省使用 GPU 公式、着色与视口规则、六色色板及缩放 2.5。源 CPU/GPU 规则独立于本机计算后端；原版界面导入的缺省值可能不同，尚未进行原版运行像素对照。');
}
const bulbParameterAliases:Record<string,string>={phase_shift:'bulbPhaseShift',phase_speed:'bulbPhaseSpeed',camera_pitch:'bulbCameraPitch',surface_epsilon:'bulbSurfaceEpsilon',shadow_strength:'bulbShadowStrength'};
function fractal(r:Reader,s:SceneDocument){
 const f=r.str('fractal.formula_id')??r.str('fractal.type')?.toLowerCase();if(!f)fail('缺少 fractal.formula_id');s.settings.formula=f;
 const supported=definitions.find(d=>d.kind==='fractal')!.controls.find(c=>c.key==='formula')!.options!.map(v=>v.value);if(!supported.includes(f))r.warnings.push(`分形公式 ${f} 尚未实现；保留标识，生成器会明确报错，不替换为其他公式。`);
 const variant=r.str('fractal.type');if(variant)s.settings.variant=variant.toLowerCase();Object.assign(s.settings,legacyZoomTarget(r,'fractal',{centerX:Number(s.settings.centerX),centerY:Number(s.settings.centerY),zoom:Number(s.settings.zoom)}));for(const k of ['rotation','iterations'])numberTo(r,s,'fractal.'+k,k);
 const sourceNumerics=f==='newton'||f==='nova',renderMethod=r.str('fractal.render_method'),precision=sourceNumerics&&r.peek('fractal.perturbation_precision')===null?(r.use('fractal.perturbation_precision'),undefined):r.str('fractal.perturbation_precision');
 const methods:Record<string,string>={ONEPASS:'one-pass',MULTIPASS:'multi-pass',GUESSING:'guessing'};
 if(renderMethod){if(methods[renderMethod.toUpperCase()])s.settings.renderMethod=methods[renderMethod.toUpperCase()];else r.warnings.push(`fractal.render_method=${renderMethod} 未识别，保留 source。`);}
 if(sourceNumerics){
  s.settings.fractalNumericProfile=FRACTAL_SOURCE_NUMERIC_PROFILE;
  s.settings.perturbationPrecision=precision===undefined?'medium':['LOW','MEDIUM','HIGH'].includes(precision.toUpperCase())?precision.toLowerCase():precision;
  if(precision!==undefined&&!['LOW','MEDIUM','HIGH'].includes(precision.toUpperCase()))r.warnings.push('Newton/Nova 源数值规则不支持此扰动精度；已保留原值，计算时明确报错，不替换为其他精度。');
 }else if(precision){if(['LOW','MEDIUM','HIGH','ULTRA'].includes(precision.toUpperCase()))s.settings.perturbationPrecision=precision.toLowerCase();else r.warnings.push(`fractal.perturbation_precision=${precision} 未识别，保留 source。`);}

 const power=firstPath(r,['fractal.parameters.power','fractal.parameters.exponent','fractal.power','fractal.formula_params.power']);if(power){if(Array.isArray(r.peek(power)))pair(r,s,power,'power','powerImag');else numberTo(r,s,power,'power');}
 const magnet=f==='magnet1'||f==='magnet2';
 const julia=firstPath(r,magnet?['fractal.parameters.parameter']:['fractal.parameters.julia_seed','fractal.julia_constant']);if(julia)pair(r,s,julia,'juliaReal','juliaImag');const start=firstPath(r,magnet?['fractal.parameters.perturbation']:['fractal.parameters.start_point','fractal.parameters.start_value']);if(start)pair(r,s,start,'startReal','startImag');
 if(magnet)for(const path of ['fractal.parameters.julia_seed','fractal.julia_constant','fractal.parameters.start_point','fractal.parameters.start_value'])r.acknowledge(path,'Magnet 原版 JSON 绑定器只消费注册字段 parameter / perturbation，缺省为 [0,0]；未把旧别名当作回退');
 if(f==='newton'||f==='nova'){
  if(!power){s.settings.power=3;s.settings.powerImag=0;}
  if(f==='nova'){if(!start){s.settings.startReal=1;s.settings.startImag=0;}if(!julia){s.settings.juliaReal=0;s.settings.juliaImag=0;}}
 }
 if(f==='phoenix'){
  s.settings.phoenixExponentMode='rounded';if(!julia){s.settings.juliaReal=0;s.settings.juliaImag=0;}
  if(r.peek('fractal.parameters.exponent2')===undefined)s.settings.phoenixPower2=0;
  r.warnings.push('Phoenix 指数保留浮点输入；按源运行路径取整，第一指数至少 2，历史指数 0/1 均使用前一次迭代值。');
 }
 if(f==='lambda'){
  if(!start){s.settings.startReal=.5;s.settings.startImag=0;}if(!julia){s.settings.juliaReal=.6;s.settings.juliaImag=0;}
  // The source JSON binder fills julia_seed before the runtime mapper. Its
  // legacy lambda fallback is therefore not selected by an omitted JSON key.
  if(r.peek('fractal.parameters.lambda')!==undefined){r.use('fractal.parameters.lambda');r.warnings.push('fractal.parameters.lambda 保留在 source：1.7.8 JSON 绑定器先填充 julia_seed（默认 0.6+0i），实际迭代只使用该系数或像素坐标，没有独立 lambda 加法项。');}
 }
 numberTo(r,s,'fractal.parameters.relaxation','relaxation');
 const bailout=firstPath(r,['fractal.parameters.bailout','fractal.bailout']);
 if(f==='newton'||f==='nova'){
  s.settings.convergenceMode='step';s.settings.tolerance=bailout?r.num(bailout)!:.001;
  r.warnings.push('Newton/Nova 显式使用 MathArt 1.7.8 数值规则；缺省扰动精度为 medium，原始阈值保留，需要 WebGL2，不静默回退到本地 CPU 数学。');
  r.warnings.push('Newton/Nova 使用迭代步长收敛、外部着色及残差平滑；bailout 映射为收敛阈值（省略为 0.001，计算下限 1e-12）。Nova 根据请求画布尺寸与缩放自动调整阈值；原版使用逻辑 PGraphics 尺寸，DPI 语义和原版像素一致性未验证。');
 }else if(f==='binocular'){
  s.settings.convergenceMode='residual';const requested=bailout?r.num(bailout)!:.001;s.settings.tolerance=Math.max(0,requested);
  if(requested<0)r.warnings.push(`${bailout}=${requested} 按源参数最小值归一为 0；原值保留 source。`);
  if(!power)s.settings.power=4;if(!julia){s.settings.juliaReal=0;s.settings.juliaImag=0;}
 }else if(f==='magnet1'||f==='magnet2'){
  s.settings.convergenceMode='residual';const requested=bailout?r.num(bailout)!:30;s.settings.bailout=Math.max(0,requested);
  if(requested<0)r.warnings.push(`${bailout}=${requested} 按源参数最小值归一为 0；原值保留 source。`);
  const convergence=r.num('fractal.parameters.convergent_bailout')??(f==='magnet1'?.001:.00005);s.settings.tolerance=Math.max(0,convergence);
  if(convergence<0)r.warnings.push(`fractal.parameters.convergent_bailout=${convergence} 按源参数最小值归一为 0；原值保留 source。`);
  if(!start){s.settings.startReal=0;s.settings.startImag=0;}if(!julia){s.settings.juliaReal=0;s.settings.juliaImag=0;}
 }else if(bailout)s.settings.bailout=r.num(bailout)!;
 if(['magnet1','magnet2','binocular'].includes(f))r.warnings.push('Magnet/Binocular 保留源 shader 的退出分类与残差收敛；Magnet I 着色残差为 0。本地 CPU Float64 与原版 DS/浮点运算不同，未作原版运行与像素对照。');
 if(f==='mandelbulb_3d'){if(!power)s.settings.power=8;if(!bailout)s.settings.bailout=2;s.settings.bulbPresentation='raymarch';for(const [old,key]of Object.entries(bulbParameterAliases))numberTo(r,s,'fractal.parameters.'+old,key);r.warnings.push('Mandelbulb 参数映射到独立纬度幂距离估计与真实 GPU/CPU 光线步进；光照、背景及 float32 边界未与原版逐像素比对。');}
 if(f==='phoenix'){numberTo(r,s,'fractal.parameters.exponent2','phoenixPower2');numberTo(r,s,'fractal.parameters.exponent1','power');}
 numberTo(r,s,'fractal.parameters.singularity_guard_eps','singularityGuard');pair(r,s,'fractal.parameters.quad_coeff','quadReal','quadImag');pair(r,s,'fractal.parameters.const_term','constReal','constImag');pair(r,s,'fractal.parameters.z0_coeff','z0Real','z0Imag');numberTo(r,s,'fractal.parameters.denom_offset','denomOffset');if(Array.isArray(r.peek('fractal.parameters.distortion')))pair(r,s,'fractal.parameters.distortion','feedback','feedbackImag');else numberTo(r,s,'fractal.parameters.distortion','feedback');
 if(sourceNumerics){
  const prepared=prepareFractalSourceColorImport(r.root);
  s.settings.fractalColorProfile=FRACTAL_SOURCE_COLOR_PROFILE;s.fractalSourceColor=prepared.configuration;
  for(const path of prepared.consumedPaths)r.use(path);
  r.warnings.push(...prepared.diagnostics);
 }else{
 commonLocalPalette(r,s);
 s.settings.fractalColorVersion=2;s.settings.fractalDistanceVersion='mathart-1.7.8-v1';
 for(const side of ['inside','outside'] as const){
  const prefix='color.'+side,key=(name:string)=>side+name[0].toUpperCase()+name.slice(1),params=prefix+'.algorithm_params';
  r.object(params);
  const algorithm=r.str(prefix+'.algorithm_id');if(algorithm)s.settings[key('coloring')]=algorithm;
  for(const [old,name]of Object.entries({color_density:'colorDensity',gradient_offset:'gradientOffset'}))numberTo(r,s,prefix+'.'+old,key(name));
  stringTo(r,s,prefix+'.solid_color',key('solidColor'));booleanTo(r,s,prefix+'.repeat_gradient',key('repeatGradient'));
  const transfer=r.str(prefix+'.transfer_function');if(transfer){s.settings[key('transfer')]=transfer.toLowerCase();if(transfer.toUpperCase()==='NONE'){s.settings[key('coloring')]='none';r.warnings.push(`${prefix}.transfer_function=NONE：源shader输出固定色，已映射为本区域固定色算法；原算法标识保留在source。`);}}
  const metric=r.str(params+'.metric');if(metric)s.settings[key('metric')]=metric.toLowerCase();
  const binary=r.str(params+'.type');if(binary)s.settings[key('binaryAxis')]=binary==='TYPE_1'?'quadrants':binary==='TYPE_2'?'phase':binary;
  const exponent=r.use(params+'.exponent'),power=algorithm==='distance_estimator'?undefined:r.num(params+'.power');
  if(algorithm==='smooth_mandelbrot'){
   if(exponent!==undefined){if(!Array.isArray(exponent)||exponent.length!==2||exponent.some(v=>typeof v!=='number'||!Number.isFinite(v)))fail(params+'.exponent 应为有限复数');s.settings[key('smoothReal')]=exponent[0];s.settings[key('smoothImag')]=exponent[1];s.settings[key('smoothSource')]=Math.hypot(...exponent as [number,number])<1e-6?'formula':'complex';}
   else if(power!==undefined&&power>1){s.settings[key('smoothSource')]='power';s.settings[key('smoothPower')]=power;}
   const bailout=r.num(params+'.bailout');if(bailout!==undefined)s.settings[key('smoothBailout')]=bailout>0?bailout:0;
  }else if(algorithm==='distance_estimator'){
   // The registered metadata supplies 2 even when the whole param set was
   // omitted. The lower-level packer's formula-power fallback is unreachable
   // through this normal JSON -> runtime-mapper path.
   const raw=r.use(params+'.power'),parsed=prepareDomainSourceScalar(raw,{fallback:typeof raw==='string'?0:2,precision:'float32'});
   if(!parsed.ok)fail(`${params}.power 超出本地标量解析容量 ${parsed.error.resource}=${parsed.error.limit}`);
   s.settings[key('distancePower')]=normalizeFractalDistancePower(parsed.facts.value);
   if(exponent!==undefined)r.acknowledge(params+'.exponent','Distance Estimator 只读取 power，不使用 exponent');
   r.warnings.push('Distance Estimator 使用源参数默认值 2、float32 转换和最小值 2；不支持的公式按源规则改用 Smooth，原算法与参数保留在 source。');
  }
  else if(exponent!==undefined||power!==undefined)r.warnings.push(`${params} 的power/exponent对当前算法不生效，原值保留source。`);
  for(const [old,name]of Object.entries({scale:'directScale',gamma:'directGamma',saturation:'directSaturation',trap_radius:'trapRadius',trap_center_x:'trapReal',trap_center_y:'trapImag',trap_aspect:'trapAspect',threshold:'trapThreshold',mix_factor:'directMix',merge_opacity:'trapMerge'}))numberTo(r,s,params+'.'+old,key(name));
  const rotation=r.num(params+'.trap_angle');if(rotation!==undefined)s.settings[key('trapRotation')]=rotation*Math.PI/180;
  stringTo(r,s,params+'.trap_shape',key('trapShape'));
  if(r.peek(prefix+'.repeat_gradient')===false)r.warnings.push(`${prefix}.repeat_gradient=false：当前按公开指南用固定色填充超范围索引；打包shader为clamp，视觉可能不同。`);
 }
 }
 r.acknowledge('fractal.formula','显示公式说明不作为另一套可执行实现；采用 formula_id 与显式参数');
 r.warnings.push(sourceNumerics?'MathArt 1.7.8 Newton/Nova 数值与着色规则：轨道与颜色在同一 GPU 片段计算，预览调度沿用本地实现。':'分形支持独立 GPU/CPU、多遍渲染及有限公式的 DD；精度阈值使用本实现误差估计，未声称与原版逐像素等价，内外参数已独立映射；None/二值分解/重复渐变的指南与shader差异在具体字段警告中保留。');
}
function roots(r:Reader,s:SceneDocument){
 r.validateNativeObjects();
 const math=createRootsNativeMath();
 // Source container presence selects defaults. Empty coefficients is meaningful;
 // empty root_parameters retains the Base definitions, exactly as the producer.
 if(r.has('polynomial')){
  const polynomial=r.object('polynomial')!;
  if(!Object.keys(polynomial).length)r.use('polynomial');
  const rawVariable=r.use('polynomial.variable'),numberToken=r.numberToken('polynomial.variable'),variable=prepareRootsSourceJsonString(rawVariable,'x',numberToken);
  if(!variable.ok)fail(`polynomial.variable 源标签转换失败：${JSON.stringify(variable.error)}`);
  if(variable.value.status==='known')math.polynomial.variable=variable.value.value;
  else{math.polynomial.variable={sourceJson:r.sourceValueText('polynomial.variable')};r.warnings.push('源变量标签的 Java 文本尚未确定；原值已保留，系数求根不受影响。编辑名称会显式替换该标签。');}
  if(r.has('polynomial.coefficients')){
   const coefficients=r.object('polynomial.coefficients')!,prefix=r.resolve('polynomial.coefficients')!.equivalentPaths[0];
   math.polynomial.coefficients=r.sourceKeys('polynomial.coefficients').map(exponent=>({exponent,expression:r.str([...prefix,exponent],true)!}));
   if(!Object.keys(coefficients).length)r.use('polynomial.coefficients');
  }
 }
 const definitions=r.object('root_parameters');
 if(definitions&&Object.keys(definitions).length){
  const prefix=r.resolve('root_parameters')!.equivalentPaths[0];
  math.parameters=r.sourceKeys('root_parameters').map(name=>{
   if(isJavaBlank(name))fail('复根源参数名称不能为空白');
   const p=[...prefix,name],definition=r.object(p)!;if(!definition)fail('复根源采样定义必须为对象');
   const domainRaw=r.use([...p,'domain']),domain=typeof domainRaw==='string'?domainRaw.toUpperCase():'UNIT_CIRCLE';
   const parameter=defaultRootNativeParameter(name);
   if(domain==='REAL_RANGE'){parameter.domain=domain;parameter.minRe=r.domainDouble([...p,'min'],-5);parameter.maxRe=r.domainDouble([...p,'max'],5);}
   else if(domain==='COMPLEX_RECT'){parameter.domain=domain;parameter.minRe=r.domainDouble([...p,'min_re'],-1);parameter.maxRe=r.domainDouble([...p,'max_re'],1);parameter.minIm=r.domainDouble([...p,'min_im'],-1);parameter.maxIm=r.domainDouble([...p,'max_im'],1);}
   else if(domain==='FIXED'){parameter.domain=domain;parameter.value=[r.domainDouble([...p,'re'],0),r.domainDouble([...p,'im'],0)];}
   else if(domain!=='UNIT_CIRCLE')r.warnings.push(`${pathLabel([...p,'domain'])} 按源规则采用 UNIT_CIRCLE；原值保留在 source。`);
   if(!Object.keys(definition).length)r.use(p);
   return parameter;
  });
 }else if(definitions)r.use('root_parameters');
 if(r.has('sampling'))r.object('sampling');
 math.sampling.sampleCount=Math.max(1,r.sourceInt('sampling.sample_count',math.sampling.sampleCount));
 math.sampling.batchSize=Math.max(1,r.sourceInt('sampling.batch_size',math.sampling.batchSize));
 r.retainNumberToken('sampling.batch_size');
 const seed=prepareRootsSourceJsonLong(r.use('sampling.seed'),0n,r.numberToken('sampling.seed'));
 if(!seed.ok)fail(`sampling.seed 源整数转换失败：${JSON.stringify(seed.error)}`);
 math.sampling.seed=seed.value.canonicalText;r.retainNumberToken('sampling.seed');
 if(seed.value.route==='fallback'&&seed.value.fallbackReason!=='missing')r.warnings.push('sampling.seed 按源整数规则使用默认值 0；原值保留在 source。');
 const filter=r.use('sampling.filter');math.sampling.filter=typeof filter==='string'?filter:'';
 if(r.has('settings'))r.object('settings');
 if(r.has('camera'))r.object('camera');
 math.solver.maxIterations=Math.max(1,r.sourceInt('settings.solver_max_iterations',180));
 math.solver.tolerance=Math.max(1e-16,r.domainDouble('settings.solver_tolerance',1e-9));
 math.sampling.workerCount=Math.max(1,r.sourceInt('settings.worker_count',1));
 if(!r.has('settings.worker_count'))r.warnings.push('原机器的默认复根工作器数无法恢复；本地明确采用 1 个逻辑工作器，可在源数学配置中修改。');
 s.rootsMath=parseRootsMath(math);
 s.settings.rootsMode='progressive';s.settings.presentation='density';s.settings.paletteMode='source';
 s.settings.rootDensityColorVersion=ROOTS_DENSITY_COLOR_VERSION;
 const backgroundPath=firstPath(r,['settings.background_color','settings.backgroundColor']);
 const background=rootsSourceBackground(backgroundPath?r.use(backgroundPath):undefined,{numberToken:backgroundPath?r.numberToken(backgroundPath):undefined});
 if(backgroundPath)r.retainNumberToken(backgroundPath);
 s.settings.background=background.value;r.warnings.push(...background.diagnostics);
 const metric=normalizeRootsSourceMetric(r.use('settings.color_metric'));s.settings.rootColor=metric.metric;r.warnings.push(...metric.diagnostics);
 if(r.has('palette'))s.rootsSourcePalette=parseRootsSourcePalette({colors:r.use('palette')});
 const presentation=prepareRootsPresentationImport((path,kind)=>{
  const raw=r.use(path);if(kind==='scalar'||kind==='integer')r.retainNumberToken(path);return raw;
 },{numberToken:path=>r.numberToken(path)});
 if(!presentation.ok)fail(presentation.error.message);
 Object.assign(s,withRootsPresentation(s,presentation.value.configuration));
 r.warnings.push(...presentation.value.diagnostics);
 r.warnings.push('源复根批次与待绘制队列采用本地确定性顺序；参考堆使用打包 -Xmx4096m 上限，不是原版实测堆容量，也不是本地分配预算。');
 for(const field of ROOTS_SOURCE_TONE_FIELDS){
  if(!field.sourceKey)continue;
  const path='settings.'+field.sourceKey;if(!r.has(path))continue;
  const parsed=parseRootsSourceScalar(r.use(path),field.default);r.warnings.push(...parsed.diagnostics);
  s.settings[field.key]=Number.isFinite(parsed.value)?parsed.value:normalizeRootsSourceToneField(field.key,parsed.value);
  if(!Number.isFinite(parsed.value))r.warnings.push('复根源调色经 float32 转换后超出有限范围，已保存源范围内的有效值；原值保留在 source。');
 }
 r.warnings.push(presentation.value.configuration.mode==='density'
  ?'已启用源复根度量密度：固定读取 t2 或原始根半径，按像素平均度量读取源色板；本地色板及通用调色参数保留但暂不参与此模式。'
  :'已启用源复根点云：固定读取 t2 或原始根半径，逐点读取源色板并混合透明度；本地色板及通用调色参数保留但暂不参与此模式。');
 for(const field of ['show_trails','trail_lifetime'])if(r.has('settings.'+field))r.acknowledge('settings.'+field,'当前包内 ComplexRootsMobject 未发现对此继承字段的读取；不将其误作渐进密度衰减');
 r.warnings.push('已启用源复根数学与空间显示配置：系数表、参数、64 位种子、变换、相机角和密度或点云模式独立保存；旧本地设置休眠保留。固定步播放、并行提交次序、空间时间轴与暂停导出仍未完整对齐原版。');
}
// Source lookup is exact. The persisted easing names belong to our timeline;
// case folding here is only a mapping of the 46 verified source registrations.
const domainSourceEasings=new Map(EASING_NAMES.map(name=>[name.toUpperCase().replaceAll('-','_'),name]));
function domainEasing(r:Reader,path:ReaderPath,fallback:string):string {
 const raw=r.use(path),name=typeof raw==='string'?domainSourceEasings.get(raw):undefined;
 if(raw!==undefined&&raw!==null&&!name)r.warnings.push(`${pathLabel(path)}：原版未注册此缓动名称，保留继承默认缓动 ${fallback}；原值保留在 source。`);
 return name??fallback;
}
function domainEdge(r:Reader,path:readonly string[],fallback:OscillationEdgeEasing):OscillationEdgeEasing {
 const object=r.object(path);if(!object)return{...fallback};
 if(!Object.keys(object).length)r.use(path);
 return{window:r.domainDouble([...path,'window'],fallback.window),floor:r.domainDouble([...path,'floor'],fallback.floor),easing:domainEasing(r,[...path,'easing'],fallback.easing)};
}
function domainActionWrapper(r:Reader,args:readonly string[]):readonly string[]|undefined {
 const raw=r.peek(args);
 if(isObject(raw))return args;
 if(Array.isArray(raw)&&isObject(raw[0]))return [...args,'0'];
 if(raw!==undefined)r.acknowledge(args,'原版没有从此值取得动作配置对象，采用全部参数或动作默认配置');
 return undefined;
}
function domainParameterAction(r:Reader,path:readonly string[],method:string,defaults:OscillationEdgeEasing):AnimationAction {
 const wrapper=domainActionWrapper(r,[...path,'args']),paramsPath=wrapper&&[...wrapper,'parameters'],params=paramsPath?r.object(paramsPath):undefined;
 // The source validates the wrapper edge even for All or Stop. Named Stop
 // deliberately never consumes each entry's range or edge fields.
 const inherited=wrapper?domainEdge(r,[...wrapper,'edgeEasing'],defaults):defaults;
 const operations:DomainParameterAction[]=[];
 if(!params||!Object.keys(params).length){
  if(paramsPath&&params)r.use(paramsPath);
  if(wrapper&&Object.keys(r.peek(wrapper) as ObjectValue).length===0)r.use(wrapper);
  operations.push({model:'domain-registry-1.7.8',scope:{kind:'all'}});
 }else{
  if(Object.keys(params).length>128)fail(`${pathLabel(paramsPath!)} 超过本地单动作128项参数配置容量`);
  for(const name of Object.keys(params)){
   const p=[...paramsPath!,name];
   if(!isObject(params[name])){r.acknowledge(p,'原版跳过非对象参数项');continue;}
   if(!r.domainBoolean([...p,'enable'])){r.acknowledge(p,'原版跳过禁用参数项，不修改已有参数配置');continue;}
   const operation:DomainParameterAction={model:'domain-registry-1.7.8',scope:{kind:'named',name}};
   if(method==='paramStart')operation.configuration={min:r.domainScalar([...p,'min'],-1),max:r.domainScalar([...p,'max'],1),step:r.domainScalar([...p,'step'],Math.fround(.1)),edgeEasing:domainEdge(r,[...p,'edgeEasing'],inherited)};
   if(!Object.keys(params[name] as ObjectValue).length)r.use(p);
   operations.push(operation);
  }
 }
 return{id:crypto.randomUUID(),method,enabled:true,domainParameters:operations};
}
function domainGradient(r:Reader,path:readonly string[]):GradientAnimation {
 r.warnings.push(`${pathLabel(path)}：域着色只消费 paletteOffset；偏移循环或单侧作用不移动该值。运行时循环色标，停止后恢复普通采样；函数或带位置色板保留独立采样。`);
 r.warnings.push(`${pathLabel(path)}：按 1.7.8 静态偏移公式导入，速度为度/秒；原版帧时钟与像素未运行对照。`);
 const wrapper=domainActionWrapper(r,[...path,'args']);
 const text=(key:string)=>{const raw=wrapper?r.use([...wrapper,key]):undefined;return typeof raw==='string'?raw.replace(/^[\x00-\x20]+|[\x00-\x20]+$/g,'').toUpperCase():'';};
 const mode=text('mode'),interpolation=text('interpolation');
 const modes:Record<string,GradientAnimation['mode']>={OFFSET_CYCLE:'offset_cycle',HUE_ROTATE:'hue_rotate',PALETTE_MORPH:'palette_morph',CROSS_FADE:'cross_fade'};
 const spaces:Record<string,GradientAnimation['interpolation']>={RGB:'rgb',LINEAR:'linear',OKLAB:'oklab',OKLCH:'oklch'};
 if(wrapper&&Object.keys(r.peek(wrapper) as ObjectValue).length===0)r.use(wrapper);
 return{model:'offsets',mode:Object.hasOwn(modes,mode)?modes[mode]:'hue_rotate',interpolation:Object.hasOwn(spaces,interpolation)?spaces[interpolation]:'oklab',speed:wrapper?Math.max(0,r.domainDouble([...wrapper,'speed'],60,true)):60,affectInside:wrapper?r.domainBoolean([...wrapper,'affectInside'],true,'default'):true,affectOutside:wrapper?r.domainBoolean([...wrapper,'affectOutside'],true,'default'):true};
}
function domainTimeline(r:Reader,s:SceneDocument):void {
 const defaults=domainEdge(r,['settings','param_edge_easing'],DEFAULT_EDGE_EASING),clips=r.peek(['timeline']);
 if(clips===undefined)return;
 if(!Array.isArray(clips)||clips.length>1000)fail('timeline 应为最多 1000 段的数组');
 s.timeline.tracks=[];let cursor=0;
 if(!clips.length){r.use(['timeline']);return;}
 for(let i=0;i<clips.length;i++){
  const path=['timeline',String(i)];r.object(path);
  if(!r.domainBoolean([...path,'enabled'])){r.acknowledge(path,'原版跳过禁用时间片段，不读取片段类型、时长或动作');continue;}
  const originalType=r.str([...path,'type'],true)!,type=originalType.toLowerCase(),duration=r.domainScalar([...path,'duration'],1,'float32');
  if(duration<0||duration>86400)fail(`${pathLabel(path)}.duration 超出本地 0–86400 秒容量`);
  const easing=type==='animate'?domainEasing(r,[...path,'easing'],'sine-in-out'):'sine-in-out';
  const track:AnimationTrack={id:crypto.randomUUID(),type:type==='animate'||duration===0?'animate':'wait',target:'timeline.wait',label:originalType,from:0,to:0,start:cursor,duration,easing,pingPong:false,enabled:true};
  if(type==='animate'){
   const actions=r.peek([...path,'actions']);if(actions!==undefined&&(!Array.isArray(actions)||actions.length>64))fail(`${pathLabel(path)}.actions 应为最多64个动作的数组`);
   track.actions=[];track.target='camera.actions';
   const actionList=(actions??[]) as unknown[];
   for(let j=0;j<actionList.length;j++){
    const p=[...path,'actions',String(j)];r.object(p);const method=r.str([...p,'method'],true)!;
    r.acknowledge([...p,'enabled'],'原版不读取动作级 enabled，动作仍执行；片段 enabled 与参数 enable 单独生效');
    if(method==='paramStart'||method==='paramStop')track.actions.push(domainParameterAction(r,p,method,defaults));
    else if(method==='gradientStart')track.actions.push({id:crypto.randomUUID(),method,enabled:true,gradient:domainGradient(r,p)});
    else if(method==='gradientStop')track.actions.push({id:crypto.randomUUID(),method,enabled:true,args:{}});
    else if(method==='domainRotate'){
     const args=r.peek([...p,'args']);const speed=Array.isArray(args)&&args.length?r.domainScalar([...p,'args','0'],0,'float64','object'):0;
     track.actions.push({id:crypto.randomUUID(),method,enabled:true,args:{speed}});
    }else r.acknowledge(p,'原版域着色不执行此动作方法');
   }
   if(Array.isArray(actions)&&!actions.length)r.use([...path,'actions']);
  }else if(type!=='wait')r.warnings.push(`${pathLabel(path)}：原版将 ${originalType} 作为等待片段，保留时长；原值保留在 source。`);
  // A zero-duration wait is represented as an empty instantaneous group; the
  // deterministic local clock does not model a native queue's extra frame.
  if(track.type==='animate'&&!track.actions)track.actions=[];
  try{validateTimelineExtensions(track,'domain');}catch(error){fail(`${pathLabel(path)}：${error instanceof Error?error.message:String(error)}`);}
  s.timeline.tracks.push(track);cursor+=duration;if(cursor>86400)fail('时间线超过 24 小时');
 }
 if(cursor>0)s.timeline.duration=cursor;
 try{validateTimelineCapacity(s.timeline.tracks);}catch(error){fail(error instanceof Error?error.message:String(error));}
 if(s.timeline.tracks.some(t=>t.actions?.some(a=>a.domainParameters)))r.warnings.push('域参数使用持久注册表；具名配置按本地 JSON 键顺序执行，原版 HashMap 次序未复现。采用 60 Hz 确定回放，首次 dt=0 不改写参数；原版实时帧时钟与队列帧延迟未逐帧对照。');
}
// Original positional argument order comes from AnimationRegistry and the public guide.
function legacyAction(r:Reader,s:SceneDocument,path:string,baseline:SceneDocument,ignoreActionEnabled=false):AnimationAction|undefined {
 const method=r.str(path+'.method',true)!,enabled=ignoreActionEnabled?true:r.bool(path+'.enabled')??true,raw=r.peek(path+'.args')??[];
 if(!Array.isArray(raw))fail(`${path}.args 应为数组`);
 if(raw.length>128)fail(`${path}.args 超过128项`);
 const action:AnimationAction={id:crypto.randomUUID(),method,enabled};
 const skip=(why:string)=>{r.warnings.push(`${path} ${method} 未执行：${why}；原动作保留在 source。`);return undefined;};
 const numbers=(keys:string[]):Record<string,number>|undefined=>{
  if(raw.length!==keys.length){skip(`需要 ${keys.length} 个位置参数，实际 ${raw.length}`);return undefined;}
  const result:Record<string,number>={};for(let i=0;i<keys.length;i++)result[keys[i]]=r.num(`${path}.args.${i}`,s.parameters)!;if(!keys.length)r.use(path+'.args');return result;
 };
 if(['stopTracking','stopAmbient','paramStop','gradientStop'].includes(method)){const args=numbers([]);return args?{...action,args}:undefined;}
 if(['rotateTheta','rotatePhi','rotateGamma'].includes(method)){const args=numbers(['angle']);return args?{...action,args}:undefined;}
 if(method==='rotateTo'){const args=numbers(['phi','theta','gamma']);return args?{...action,args}:undefined;}
 if(method==='ambient'){const args=numbers(['phiSpeed','thetaSpeed','gammaSpeed']);return args?{...action,args}:undefined;}
 if(method==='zoom'||method==='focal'){const args=numbers(['value']);if(args&&args.value<=0)fail(`${path} ${method} 目标必须大于零`);return args?{...action,args}:undefined;}
 if(['fractalRotate','domainRotate','spirographRotate'].includes(method)){
  const expected={fractalRotate:'fractal',domainRotate:'domain',spirographRotate:'spirograph'}[method];if(s.kind!==expected)return skip(`仅适用于 ${expected}`);
  const args=numbers(['speed']);return args?{...action,args}:undefined;
 }
 if(method==='track'){if(!supportsParticleTracking(s))return skip('当前场景尚未提供动态粒子采样合同');const args=numbers(['index']);return args?{...action,args}:undefined;}
 if(method==='paramStart'){
  if(raw.length!==1||!isObject(raw[0]))return skip('需要一个参数配置对象');
  const parameters=legacyOscillators(r,s,path+'.args.0',baseline,true);return parameters.length?{...action,parameters}:skip('没有可映射的参数振荡');
 }
 if(method==='gradientStart'){
  if(raw.length!==1||!isObject(raw[0]))return skip('需要一个渐变配置对象');const p=path+'.args.0';
  const offsets=supportsGradientOffsets(s);
  const mode=r.str(p+'.mode')?.toLowerCase()??(offsets?'hue_rotate':undefined);if(!mode||!['offset_cycle','hue_rotate','palette_morph','cross_fade'].includes(mode))return skip('渐变 mode 缺失或未知');
  const speed=r.num(p+'.speed')??(offsets?60:undefined);if(speed===undefined)return skip('缺少 speed，原默认值尚未核实');if(speed<0)fail(`${p}.speed 不可为负`);
  const interpolation=(r.str(p+'.interpolation')??'OKLAB').toLowerCase();if(!['rgb','linear','oklab','oklch'].includes(interpolation))return skip('未知颜色插值空间');
  const inside=r.bool(p+'.affectInside'),outside=r.bool(p+'.affectOutside');
  if(offsets){r.warnings.push(`${path}：按 1.7.8 静态偏移公式导入，速度为度/秒；原版帧时钟与像素未运行对照。`);return{...action,gradient:{model:'offsets',mode:mode as GradientAnimation['mode'],speed,interpolation:interpolation as GradientAnimation['interpolation'],affectInside:inside??true,affectOutside:outside??true}};}
  if(inside===false||outside===false)return skip('当前渐变作用于共享色板，尚不支持仅内部/仅外部着色');
  if(mode!=='offset_cycle'&&s.palette.mode!=='linear'&&s.palette.mode!=='sine')return skip('函数调色板当前只支持 offset_cycle');
  r.warnings.push(`${path}：渐变曲线为独立实现；原版各模式的偏移/色相/交叉变化未逐点比对。`);
  return {...action,gradient:{mode:mode as GradientAnimation['mode'],speed,interpolation:interpolation as GradientAnimation['interpolation']}};
 }
 return skip('未识别的方法');
}
function legacyOscillators(r:Reader,s:SceneDocument,path:string,baseline:SceneDocument,continuous=false):ParameterAnimation[]{
 const params=r.object(path+'.parameters');if(!params)return[];
 if(Object.keys(params).length>128)fail(`${path}.parameters 超过128项`);
 const domain=r.str(path+'.targetDomain');if(domain)r.warnings.push(`${path}.targetDomain=${domain}：按当前场景已有数值参数解析；原标签保留在 source。`);
 const result:ParameterAnimation[]=[];
 const edgeAt=(path:string,fallback:typeof DEFAULT_EDGE_EASING)=>{const object=r.object(path);if(!object)return{...fallback};const edge=parseOscillationEdge({window:r.num(path+'.window')??fallback.window,floor:r.num(path+'.floor')??fallback.floor,easing:(r.str(path+'.easing')??fallback.easing).toLowerCase().replaceAll('_','-')});if(!EASING_NAMES.includes(edge.easing)){r.warnings.push(`${path}.easing 未识别，使用继承默认值；原值保留 source。`);edge.easing=fallback.easing;}return edge;};
 const configurableEdge=['surface','implicit','fractal'].includes(s.kind),hasEdge=configurableEdge||['map','symmetry'].includes(s.kind);
 const inheritedEdge=continuous&&configurableEdge?edgeAt(path+'.edgeEasing',edgeAt('settings.param_edge_easing',DEFAULT_EDGE_EASING)):{window:.4,floor:.5,easing:'sine-out'};
 for(const name of Object.keys(params)){
  const p=path+'.parameters.'+name,config=r.object(p);if(!config)continue;
  let target=Object.hasOwn(s.parameters,name)?'parameters.'+name:undefined;
  const resolved=!target?resolveFractalParameterBinding(s,name):undefined;if(resolved)target=resolved.target;
  if(!target&&['phaseDensity','modDensity','phaseSharpness','modSharpness','colorSpeed','colorPhase'].includes(name)&&typeof s.settings[name]==='number')target='settings.'+name;
  if(!target){r.warnings.push(`${p}：没有已确认且可动画的对应数值目标，保留 source，未执行。`);continue;}
  const min=r.num(p+'.min',s.parameters),max=r.num(p+'.max',s.parameters),step=r.num(p+'.step',s.parameters),enabled=r.bool(p+'.enable')??true;
  if(min===undefined||max===undefined||step===undefined)fail(`${p} 需要 min/max/step`);
  const edgeEasing=hasEdge?(continuous&&configurableEdge?edgeAt(p+'.edgeEasing',inheritedEdge):inheritedEdge):undefined;
  if(max<min)fail(`${p} 范围必须 min ≤ max`);
  const half=(max-min)/2,initial=readAnimationValue(baseline,target),phase=half?Math.asin(Math.max(-1,Math.min(1,(initial-(min+max)/2)/half))):0;
  result.push({target,min,max,step:half>5e-7?Math.abs(step)*60/half:0,phase:step<0?Math.PI-phase:phase,enabled,edgeEasing,...(resolved?.binding?{binding:resolved.binding}:{})});
  r.warnings.push(`${p}.step=${step} 已按 60 fps 参考转换为 rad/s${edgeEasing?'，并逐步计算端点减速':''}；原版实时帧率与本地固定参考时钟可能不同。`);
 }
 return result;
}
function legacyZoomTarget(r:Reader,path:string,fallback:{centerX:number;centerY:number;centerXLow?:number;centerYLow?:number;zoom:number}){
 let centerX=r.num(path+'.centerX')??fallback.centerX,centerY=r.num(path+'.centerY')??fallback.centerY,zoom=r.num(path+'.zoom')??fallback.zoom;
 let centerXLow=r.num(path+'.centerXLo')??fallback.centerXLow??0,centerYLow=r.num(path+'.centerYLo')??fallback.centerYLow??0;
 const hiLo=r.peek(path+'.center_hi_lo');if(hiLo!==undefined){if(!Array.isArray(hiLo)||hiLo.length!==4)fail(`${path}.center_hi_lo 应为 [xHi,xLo,yHi,yLo]`);centerX=r.num(path+'.center_hi_lo.0')!;centerXLow=r.num(path+'.center_hi_lo.1')!;centerY=r.num(path+'.center_hi_lo.2')!;centerYLow=r.num(path+'.center_hi_lo.3')!;}
 const center=r.peek(path+'.center');if(center!==undefined){if(!Array.isArray(center)||center.length!==2)fail(`${path}.center 应为 [x,y]`);centerX=r.num(path+'.center.0')!;centerY=r.num(path+'.center.1')!;}
 if(zoom<=0||zoom>1e28)fail(`${path}.zoom 必须在 (0,1e28]`);
 return {centerX,centerY,centerXLow,centerYLow,zoom};
}
function ordinaryFamily(kind:SceneKind):kind is OrdinarySourceCameraFamily{return ['surface','implicit','attractor','perlin'].includes(kind);}
function ordinaryResult<T>(result:OrdinarySourceScalarResult<T>):T {
 if(!result.ok)fail(`原版相机标量 ${result.error.path}: ${JSON.stringify(result.error)}`);return result.value;
}
function ordinaryCamera(r:Reader,s:SceneDocument,scope:OrdinarySourceScalarScope):void {
 if(!ordinarySourceCameraGeometry(s)){
  r.warnings.push('当前密度或噪声纹理显示模式尚未接入原版几何相机；保留本地显示和完整源相机数据，不声明原版相机一致。');return;
 }
 const parsed=ordinaryResult(scope.camera(r.peek(['camera'])));s.sourceCamera=parsed.camera;r.warnings.push(...parsed.diagnostics);
 if(r.has(['camera'])){
  const raw=r.object(['camera'])!;if(!Object.keys(raw).length)r.use(['camera']);
  for(const axis of ['phi','theta','gamma']){r.retainNumberToken(['camera',axis]);r.use(['camera',axis]);}
 }
 // GenericScene passes isUseAccumulationBuffer to Scene. Scene.render calls
 // ortho after applyPerspective only in that branch; show_trails is unrelated.
 // Only Perlin exposes this override in these four retained JSON configs.
 const accumulation=s.kind==='perlin'?r.domainBoolean(['settings','use_accumulation_buffer'],false,'default'):false;
 s.settings.sourceCameraProjection=accumulation?'scene-fade-orthographic':'perspective';
}
function ordinarySurfaceParticleGeometry(r:Reader,s:SceneDocument):void {
 const hasSettings=r.has(['settings']);if(hasSettings)r.object(['settings']);
 const render=(r.str(['settings','render_mode'])??'CPU').toUpperCase();
 const mode=(r.str(['settings','surface_mode'])??'POINTS').toUpperCase();
 if(render==='GPU'||mode==='MESH')fail('原版曲面粒子动画当前只接入 CPU 点模式；GPU/网格的目标身份和显示仍待接入');
 const settings=s.settings;
 settings.pointSize=Math.fround(hasSettings?r.domainDouble(['settings','dot_size'],2):1.68);
 if(!Number.isFinite(settings.pointSize))fail('原版曲面点半径转换为非有限数值');
 Object.assign(settings,{surfaceGeometryVersion:SOURCE_SURFACE_PARTICLES,renderMode:'points',computeBackend:'cpu',scale:1,rotateX:0,rotateY:0,rotateZ:0,flowU:0,flowV:0});
 for(const field of SOURCE_SURFACE_NUMBER_FIELDS)r.retainNumberToken(['settings',field]);
 for(const [axis,defaultCount,maxText]of [['u',hasSettings?40:99,'TWO_PI'],['v',hasSettings?20:99,'PI']] as const){
  const upper=axis.toUpperCase();settings[axis+'Segments']=r.sourceInt(['settings',axis+'_segments'],defaultCount);
  for(const [end,fallback]of [['min','0'],['max',maxText]]){
   const path=['settings',axis+'_'+end],parsed=ordinaryResult(prepareSurfaceSourceStringField(r.use(path),pathLabel(path),fallback));
   settings[axis+(end==='min'?'Min':'Max')]=parsed.value;r.warnings.push(...parsed.diagnostics);
  }
  settings['speed'+upper]=Math.fround(r.domainDouble(['settings','speed_'+axis],.3));
  settings['periodic'+upper]=r.domainBoolean(['settings','periodic_'+axis],false);
  settings['flowing'+upper]=r.domainBoolean(['settings','flowing_'+axis],true);
 }
 for(const axis of ['x','y','z']){settings['scale'+axis.toUpperCase()]=Math.fround(r.domainDouble(['settings','scale_'+axis],55));settings['offset'+axis.toUpperCase()]=Math.fround(r.domainDouble(['settings','offset_'+axis],0));}
 settings.showTrails=r.domainBoolean(['settings','show_trails'],true);
 settings.fadeTrails=r.domainBoolean(['settings','fade_trails'],true);
 settings.fadePoints=true; // BaseSurfaceConfig default; JsonSurfaceConfig does not read fade_points.
 s.surfaceSourcePalette=parseSourceSurfacePalette({colors:r.has('palette')?r.use('palette'):[...DEFAULT_SOURCE_SURFACE_COLORS]});
 settings.trailLifetime=Math.fround(r.domainDouble(['settings','trail_lifetime'],4));
 settings.trailWidth=Math.fround(r.domainDouble(['settings','line_weight'],1));
 settings.recordTrails=true; // Native constructor records even when display is hidden; no JSON record_trails read.
 r.warnings.push('曲面动画使用源 CPU 点状态、半开参数域和原版索引；参数注册表、渐变和拖尾按源规则回放；GPU/网格尚未接入，完整原版画面尚未验收。');
}
/** Eager source setupTimeline dispatch. Preserve every native queue duration;
 * known but unimplemented animation children fail rather than become local
 * mathjs actions or silently disappear. Unknown native actions make Wait via
 * CameraAnimator.build when no camera child was constructed. */
interface OrdinaryTimelineAction {path:string[];method:string;raw:unknown;surfaceGradient?:SourceSurfaceGradientImportFacts;surfaceParameters?:SourceSurfaceParameterAction[];}
interface OrdinaryTimelineClip {path:string[];originalType:string;type:string;actions:OrdinaryTimelineAction[];surfaceParameterClip?:SourceSurfaceParameterClip;}
/** Parse structural dispatch once. Geometry selection and queue compilation use
 * the same enabled clips/actions; disabled source clips are never inspected. */
function surfaceParameterImport<T>(r:Reader,prefix:readonly string[],result:SourceSurfaceParameterResult<{configuration:T;consumedPaths:string[][];numericPaths:string[][];diagnostics:string[]}>):T {
 if(!result.ok)return fail(`${pathLabel([...prefix,...result.error.path])} 曲面源参数 ${result.error.kind}: ${result.error.reason}`);
 for(const path of result.value.consumedPaths)r.use([...prefix,...path]);
 for(const path of result.value.numericPaths)r.retainNumberToken([...prefix,...path]);
 for(const diagnostic of result.value.diagnostics)r.warnings.push(`${pathLabel(prefix)}: ${diagnostic}`);
 return result.value.configuration;
}
function ordinaryTimelineStructure(r:Reader,surface=false,parameterScope?:OrdinarySourceScalarScope):OrdinaryTimelineClip[] {
 let edgeDefaults:OscillationEdgeEasing={...SOURCE_SURFACE_PARAMETER_EDGE_DEFAULT};
 if(surface&&r.has(['settings','param_edge_easing']))edgeDefaults=surfaceParameterImport(r,['settings','param_edge_easing'],importSourceSurfaceParameterEdge(r.peek(['settings','param_edge_easing'])));
 const clips=r.peek(['timeline']);if(clips===undefined)return[];
 if(!Array.isArray(clips)||clips.length>1000)fail('timeline 应为最多 1000 段的数组');
 if(!clips.length)r.use(['timeline']);
 const result:OrdinaryTimelineClip[]=[];
 for(let i=0;i<clips.length;i++){
  const path=['timeline',String(i)];r.object(path);
  if(!r.domainBoolean([...path,'enabled'])){r.acknowledge(path,'原版跳过禁用片段，不读取类型、时长或动作');continue;}
  const originalType=r.str([...path,'type'],true)!,type=originalType.toLowerCase(),actions:OrdinaryTimelineAction[]=[];
  if(type==='animate'){
   const raw=r.peek([...path,'actions']);
   if(raw!==undefined&&(!Array.isArray(raw)||raw.length>64))fail(`${pathLabel(path)}.actions 应为最多 64 个动作的数组`);
   if(Array.isArray(raw)){
    if(!raw.length)r.use([...path,'actions']);
    for(let j=0;j<raw.length;j++){
     const actionPath=[...path,'actions',String(j)];r.object(actionPath);
     const method=r.str([...actionPath,'method'],true)!,args=r.peek([...actionPath,'args']);
     // JsonSurfaceConfig.setupTimeline first obtains an array/object argument.
     // Its null guard skips the whole action before any child builder runs.
     if(surface&&!Array.isArray(args)&&!isObject(args)){
      r.retainNumberToken([...actionPath,'args']);
      if(r.has([...actionPath,'args']))r.acknowledge([...actionPath,'args'],'原版曲面仅分派数组或对象参数，跳过此动作');
      r.warnings.push(`${pathLabel(actionPath)} ${method}：原版曲面未取得数组或对象参数，跳过此动作；片段时长和原值保留。`);
      continue;
     }
     const surfaceParameters=surface&&(method==='paramStart'||method==='paramStop')?surfaceParameterImport(r,[...actionPath,'args'],importSourceSurfaceParameterAction(method,args,{scope:parameterScope!,memberOrder:path=>r.sourceKeys([...actionPath,'args',...path]),edgeDefaults})):undefined;
     actions.push({path:actionPath,method,raw:args,...(surface&&method==='gradientStart'?{surfaceGradient:importSourceSurfaceGradient(args)}:{}),...(surfaceParameters?{surfaceParameters}:{})});
    }
   }
  }
  const surfaceParameterClip=surface&&type==='param'?surfaceParameterImport(r,[...path,'parameters'],importSourceSurfaceParameterClip(r.peek([...path,'parameters']),{scope:parameterScope!,memberOrder:relative=>r.sourceKeys([...path,'parameters',...relative])})):undefined;
  result.push({path,originalType,type,actions,...(surfaceParameterClip?{surfaceParameterClip}:{})});
 }
 return result;
}
function ordinaryCameraTimeline(r:Reader,s:SceneDocument,scope:OrdinarySourceScalarScope,structure=ordinaryTimelineStructure(r,s.kind==='surface',scope)):void {
 s.timeline={...s.timeline,schedule:ORDINARY_CAMERA_SEQUENCE,tracks:[]};let total=0;
 const field=(path:readonly string[],fallback:number)=>{
  r.retainNumberToken(path);const parsed=ordinaryResult(scope.field(r.use(path),pathLabel(path),fallback,r.has(path)));r.warnings.push(...parsed.diagnostics);return parsed.value;
 };
 for(const {path,originalType,type,actions:sourceActions,surfaceParameterClip} of structure){
  if(type==='trails'&&usesSourceSurfaceParticles(s)){
   // JsonSurfaceConfig constructs InstantAction directly: duration/easing are
   // not read, even when malformed. Preserve them in source, never parse/clamp.
   const trailsEnabled=r.domainBoolean([...path,'enable'],true);
   r.retainNumberToken([...path,'duration']);
   if(r.has([...path,'duration']))r.acknowledge([...path,'duration'],'原版拖尾开关为即时动作，不读取 duration');
   if(r.has([...path,'easing']))r.acknowledge([...path,'easing'],'原版拖尾开关不读取 easing');
   s.timeline.tracks.push({id:crypto.randomUUID(),type:'trails',target:'settings.recordTrails',label:originalType,from:0,to:0,start:0,duration:0,easing:'linear',pingPong:false,enabled:true,trailsEnabled});
   continue;
  }
  if(!['wait','animate','align'].includes(type)&&!(s.kind==='surface'&&type==='param')){
   const nativeChild=(s.kind==='surface'&&['trails','surface_mode_transition'].includes(type))||(s.kind==='perlin'&&type==='trails');
   if(nativeChild)fail(`${pathLabel(path)} ${type} 尚缺原版动画子项编译事实；不能丢弃或猜测其队列时长`);
   if(s.kind==='attractor'){r.acknowledge(path,'原版 Attractor 不执行此片段类型，不占用队列时长');continue;}
   r.warnings.push(`${pathLabel(path)} ${originalType} 按原版未识别类型分支保留为等待；原字段保留在 source。`);
  }
  const duration=field([...path,'duration'],1);
  if(duration<=0||duration>86400)fail(`${pathLabel(path)}.duration 原版值 ${duration} 超出本地源相机队列支持的 (0,86400]；不会替换或丢时长`);
  let easing='sine-in-out';if(type==='animate'||type==='align'||type==='param'&&s.kind==='surface'){
   const raw=r.use([...path,'easing']),mapped=lookupSourceEasing(raw);easing=mapped??'sine-in-out';
   if(raw!=null&&!mapped)r.warnings.push(`${pathLabel(path)}.easing 未匹配源注册名，采用 SINE_IN_OUT；原值保留。`);
  }
  const track:AnimationTrack={id:crypto.randomUUID(),type:type==='animate'?'animate':type==='align'?'align':type==='param'&&s.kind==='surface'?'param':'wait',target:'timeline.wait',label:originalType,from:0,to:0,start:0,duration,easing,pingPong:false,enabled:true};
  if(type==='param'&&s.kind==='surface'){
   track.surfaceParameterClip=surfaceParameterClip;track.target='surface.parameters';
  }else if(type==='align'){
   track.target='camera.orientation';track.alignMode='next-turn';track.orientation={};
   for(const axis of ['phi','theta','gamma'] as const)if(r.has([...path,'target_'+axis]))track.orientation[axis]=field([...path,'target_'+axis],0);
  }else if(type==='animate'){
   track.actions=[];track.target='camera.actions';
   for(const {path:actionPath,method,raw,surfaceGradient,surfaceParameters} of sourceActions){
    if(r.has([...actionPath,'enabled']))r.acknowledge([...actionPath,'enabled'],'原版不读取动作级开关，使用片段级 enabled');
    const unimplementedTracking=method==='track'&&Array.isArray(raw)&&raw.length>0&&s.kind==='attractor';
    if(unimplementedTracking)fail(`${pathLabel(actionPath)} ${method} 尚无完整原版 provider/动画编译合同；未按本地动作代替`);
    if(surfaceParameters){if(surfaceParameters.length)track.actions.push({id:crypto.randomUUID(),method,enabled:true,surfaceParameters});continue;}
    if(s.kind==='surface'&&(method==='gradientStart'||method==='gradientStop')){
     if(method==='gradientStop'){track.actions.push({id:crypto.randomUUID(),method,enabled:true});continue;}
     const facts=surfaceGradient!,argsPath=[...actionPath,'args'];
     if(facts.payloadPath!==null){
      // Retention records source numeric evidence even when applicability skips
      // execution. Consumption remains limited to the parser's named fields.
      for(const field of SOURCE_SURFACE_GRADIENT_SOURCE_FIELDS)r.retainNumberToken([...argsPath,...facts.payloadPath,field]);
      for(const field of facts.consumedFields)r.use([...argsPath,...facts.payloadPath,field]);
      if(facts.payloadEmpty)r.use([...argsPath,...facts.payloadPath]);
     }else if(r.has(argsPath)){
      r.retainNumberToken(argsPath);if(Array.isArray(raw))r.retainNumberToken([...argsPath,'0']);
      r.acknowledge(argsPath,'原版未从首个参数找到渐变对象，采用默认配置');
     }
     for(const diagnostic of facts.diagnostics)r.warnings.push(`${pathLabel(actionPath)}：${diagnostic}`);
     if(facts.kind==='start')track.actions.push({id:crypto.randomUUID(),method,enabled:true,gradient:{...facts.config}});
     continue;
    }
    const noncamera=['paramStart','paramStop'].includes(method)&&s.kind!=='attractor'||['gradientStart','gradientStop'].includes(method)&&s.kind!=='implicit';
    if(noncamera){
     // Retained child constructors forward this same duration to Animation;
     // their group therefore cannot lengthen the camera child's duration.
     // Keep the existing local noncamera effect explicitly outside parity.
     const local=Array.isArray(raw)||raw===undefined?legacyAction(r,s,actionPath.join('.'),s,true):undefined;
     if(local)track.actions.push({...local,enabled:true});
     r.warnings.push(`${pathLabel(actionPath)} ${method}：源子动画使用同一片段时长，队列时长已保留；${local?'非相机效果仍采用既有本地解析与动画，不声明原版标量或帧时钟一致':'此原版非相机参数形式尚未映射，效果未执行，完整字段保留在 source'}。`);continue;
    }
    const ignored=(reason:string)=>r.warnings.push(`${pathLabel(actionPath)} ${method}：${reason}；片段时长保留，原动作保留在 source。`);
    if(!Array.isArray(raw)&&s.kind==='attractor'){ignored('原版仅向相机分派 JSONArray 参数');continue;}
    const args=Array.isArray(raw)?raw:[];if(args.length>128)fail(`${pathLabel(actionPath)}.args 超过 128 项本地容量`);
    const arg=(index:number)=>{const p=[...actionPath,'args',String(index)];r.retainNumberToken(p);const out=ordinaryResult(scope.argument(r.use(p),pathLabel(p)));r.warnings.push(...out.diagnostics);return out.value;};
    let action:AnimationAction|undefined;
    if(method==='track'&&s.kind==='surface'&&args.length>0)action={id:crypto.randomUUID(),method,args:{index:arg(0)}};
    else if(['rotatePhi','rotateTheta','zoom','focal'].includes(method))action={id:crypto.randomUUID(),method,args:{[method.startsWith('rotate')?'angle':'value']:arg(0)}};
    else if(method==='rotateTo'&&s.kind!=='attractor'&&args.length>=3)action={id:crypto.randomUUID(),method,args:{phi:arg(0),theta:arg(1),gamma:arg(2)}};
    else if((method==='ambient'||method==='setRates'&&s.kind==='attractor')&&args.length>=(s.kind==='attractor'?2:3))action={id:crypto.randomUUID(),method:'ambient',args:{phiSpeed:arg(0),thetaSpeed:arg(1),gammaSpeed:args.length>=3?arg(2):0}};
    else if(['stopTracking','stopAmbient'].includes(method)&&s.kind!=='implicit')action={id:crypto.randomUUID(),method,args:{}};
    if(!action){ignored('原版此场景未分派该方法或参数数目不足');continue;}
    if(Array.isArray(raw)&&!raw.length)r.use([...actionPath,'args']);
    track.actions.push(action);
   }
  }
  s.timeline.tracks.push(track);total+=duration;if(total>86400)fail('源相机队列超过 24 小时');
 }
 if(total>0)s.timeline.duration=total;
 validateTimelineCapacity(s.timeline.tracks);
 if(usesSourceSurfaceParticles(s))prepareSourceSurfaceParticles(s);
}
function timeline(r:Reader,s:SceneDocument,ordinaryScope?:OrdinarySourceScalarScope,structure?:OrdinaryTimelineClip[]){
 if(s.sourceCamera&&ordinaryScope){ordinaryCameraTimeline(r,s,ordinaryScope,structure);return;}
 if(s.kind==='domain'){domainTimeline(r,s);return;}
 if(s.kind==='spirograph'&&parseSpirographVersion(s.settings.spirographVersion)!=='local-v1'){spirographTimeline(r,s);return;}
 if(s.kind==='roots'){rootsCameraTimeline(r,s);return;}
 const clips=r.peek('timeline');if(clips===undefined)return;if(!Array.isArray(clips)||clips.length>1000)fail('timeline 应为最多 1000 段的数组');let cursor=0;s.timeline.tracks=[];
 if(!clips.length){r.use('timeline');return;}
 for(let i=0;i<clips.length;i++){
  const path='timeline.'+i;if(!isObject(clips[i]))fail(`${path} 不是对象`);
  const originalType=r.str(path+'.type',true)!,type=originalType.toLowerCase(),duration=r.num(path+'.duration',s.parameters)??0,enabled=r.bool(path+'.enabled')??true,label=r.str(path+'.label')??originalType;
  if(duration<0||duration>86400)fail(`${path}.duration 超出 0–86400 秒`);
  const easingValue=r.str(path+'.easing')??'SINE_IN_OUT',easing=easingValue.toLowerCase().replaceAll('_','-');
  if(!EASING_NAMES.includes(easing)){r.warnings.push(`${path}.easing=${easingValue} 未支持，整个片段仅保留在 source。`);if(enabled)cursor+=duration;continue;}
  if(duration===0&&!['animate','spirograph_finish_wait'].includes(type)){r.warnings.push(`${path}：零时长 ${type} 未加入执行轨道，原值保留 source。`);continue;}
  const track:AnimationTrack={id:crypto.randomUUID(),type:type==='hold'?'wait':type as AnimationTrack['type'],target:'timeline.wait',label,from:0,to:0,start:cursor,duration,easing,pingPong:false,enabled};
  let cachedBaseline:SceneDocument|undefined;const before=()=>cachedBaseline??=sceneAtTime({...s,timeline:{...s.timeline,duration:Math.max(.01,cursor)}},cursor);
  let mapped=true;
  if(type==='wait'||type==='hold'){}
  else if(type==='animate'){
   const actions=r.peek(path+'.actions');if(!Array.isArray(actions)||actions.length>64)fail(`${path}.actions 应为最多64个动作的数组`);
   track.target='camera.actions';track.actions=[];
   for(let j=0;j<actions.length;j++){if(!isObject(actions[j]))fail(`${path}.actions.${j} 不是对象`);const action=legacyAction(r,s,`${path}.actions.${j}`,before());if(action)track.actions.push(action);}
   if(!actions.length)r.use(path+'.actions');if(!track.actions.length){mapped=false;r.warnings.push(`${path}：动作均未映射，仅保留时长和原数据，不创建无效动作控件。`);}
  }else if(type==='align'){
   track.target='camera.orientation';track.orientation={};for(const axis of ['theta','phi','gamma'] as const){const value=r.num(path+'.target_'+axis,s.parameters);if(value!==undefined)track.orientation[axis]=value;}
   track.alignMode='next-turn';
  }else if(type==='param'){
   track.parameterClock='elapsed';track.replaceParameters=true;track.parameterAnimations=legacyOscillators(r,s,path,before());track.target=track.parameterAnimations[0]?.target??'timeline.wait';mapped=track.parameterAnimations.length>0;
  }else if(type==='trails'){
   track.target='settings.recordTrails';track.trailsEnabled=r.bool(path+'.enable')??true;
   r.warnings.push(`${path}：拖尾使用当前本地历史缓冲实现；原版记录、衰减和粒子重生轨迹未逐帧对照。`);
  }else if(type==='surface_mode_transition'){
   const to=r.str(path+'.to')?.toLowerCase();if(s.kind!=='surface'||!to||!['points','mesh'].includes(to)){mapped=false;r.warnings.push(`${path}：需要参数曲面和明确的 POINTS/MESH 目标，未执行。`);}else{track.surfaceMode=to as 'points'|'mesh';track.target='settings.surfaceBlend';}
  }else if(type==='fractal_zoom'){
   if(s.kind!=='fractal'){mapped=false;r.warnings.push(`${path}：分形缩放仅适用于分形场景。`);}
   else{
    const state=before(),initial={centerX:Number(state.settings.centerX),centerY:Number(state.settings.centerY),centerXLow:Number(state.settings.centerXLow??0),centerYLow:Number(state.settings.centerYLow??0),zoom:Number(state.settings.zoom)};
    let target=legacyZoomTarget(r,path,initial);const keys=r.peek(path+'.keys');
    if(keys!==undefined){if(!Array.isArray(keys)||keys.length>256)fail(`${path}.keys 应为最多256个关键帧的数组`);let selected=-1,selectedTime=-Infinity;
     for(let j=0;j<keys.length;j++){if(!isObject(keys[j]))fail(`${path}.keys.${j} 不是对象`);const time=r.num(`${path}.keys.${j}.time`)??0;if(time>=selectedTime){selected=j;selectedTime=time;}}
     if(selected>=0)target=legacyZoomTarget(r,`${path}.keys.${selected}`,target);
     r.warnings.push(`${path}.keys：按 v1.7.8 静态解析语义选择最大 time（并列取后者）作为目标；其他键仍保留 source，不伪造逐关键帧播放。`);
    }
    track.target='settings.zoom';track.keyframes=[{time:0,...initial},{time:duration,...target}];track.interpolation='exponential';
    r.warnings.push(`${path}：缩放使用对数插值、中心使用线性插值；中心低位已保留；原版缩放感知中心插值尚未复现。`);
   }
  }else if(type==='spirograph_finish_wait'){
   mapped=false;r.warnings.push(`${path}：完成等待仅适用于旋轮场景。`);
  }else{mapped=false;r.warnings.push(`${path}：未支持 ${originalType}，原数据保留 source。`);}
  if(mapped)s.timeline.tracks.push(track);
  if(enabled)cursor+=track.duration;
  if(cursor>86400)fail('时间线超过 24 小时');
 }
 if(cursor>0)s.timeline.duration=cursor;
 if(s.timeline.tracks.some(t=>t.type==='animate'&&t.actions?.some(a=>['rotatePhi','rotateTheta','rotateTo','ambient','focal'].includes(a.method))))r.warnings.push('相机动作保留原方法名及声明参数顺序；公开文档的 Phi/Theta 轴约定存在矛盾，当前独立轨道坐标/焦距单位尚未与原版逐帧对照。');
}

/** JsonComplexRootsConfig.getJsonFloat / parseArg share the direct Java-number
 * then FastExpression(emptyMap) route. Keep nonfinite results until the owning
 * duration clamp: -Infinity becomes .001F there, while camera targets reject it.
 * Scalar capacity is an error, never a reason to use a parse fallback. */
function rootsCameraFloat(r:Reader,path:readonly string[],fallback:number):number {
 const result=prepareDomainSourceScalar(r.use(path),{fallback,precision:'float32'});
 if(!result.ok)fail(`${pathLabel(path)} 超出本地标量解析容量 ${result.error.resource}=${result.error.limit}`);
 if(result.facts.route==='fallback'&&result.facts.fallbackReason!=='missing')r.warnings.push(`${pathLabel(path)} 按原版复根标量规则采用默认值 ${fallback}；原值保留在 source。`);
 return result.facts.value;
}
/** Source Roots only dispatches wait/animate and three camera methods. Raw
 * actions remain in provenance; parsed camera targets keep their source order
 * so the shared queue compiler owns last-write selection and frame arithmetic. */
function rootsCameraTimeline(r:Reader,s:SceneDocument):void {
 // Absence keeps the previous imported/default timeline behavior. Presence,
 // including [], explicitly selects the source queue; null is not absence.
 if(!r.has(['timeline']))return;
 const clips=r.peek(['timeline']);
 if(!Array.isArray(clips)||clips.length>1000)fail('timeline 应为最多 1000 段的数组');
 for(const path of rootsTimelineNumberTokenPaths(clips))r.retainNumberToken(path);
 Object.assign(s,withRootsSceneTimeline(s,true));
 // Local minimum preview span, not an inferred native queue duration.
 s.timeline={...s.timeline,duration:.1,tracks:[]};
 if(!clips.length)r.use(['timeline']);
 for(let i=0;i<clips.length;i++){
  const path=['timeline',String(i)];r.object(path);
  if(!r.domainBoolean([...path,'enabled'])){r.acknowledge(path,'原版跳过禁用片段，不读取类型、时长或动作');continue;}
  const rawType=r.use([...path,'type']);
  // getString(key,default) defaults only for missing/null. Other JSON values
  // stringify to non-matching type names; no guessed Java formatting is needed.
  const type=rawType==null?'wait':typeof rawType==='string'?rawType.toLowerCase():undefined;
  if(type!=='wait'&&type!=='animate'){r.acknowledge(path,'原版复根不执行此片段类型，不将其改作等待');continue;}
  const rawDuration=type==='wait'?Math.fround(r.domainDouble([...path,'duration'],1)):rootsCameraFloat(r,[...path,'duration'],1);
  const duration=Math.max(Math.fround(.001),rawDuration);
  if(!Number.isFinite(duration)||duration>86400)fail(`${pathLabel(path)}.duration 经原版转换后超出本地有限 0–86400 秒范围`);
  if(duration!==rawDuration)r.warnings.push(`${pathLabel(path)}.duration 按原版最小时长调整为 ${duration} 秒；原值保留在 source。`);
  let easing='sine-in-out';
  if(type==='animate'){
   const raw=r.use([...path,'easing']),mapped=lookupSourceEasing(raw);
   easing=mapped??'sine-in-out';
   if(raw!=null&&!mapped)r.warnings.push(`${pathLabel(path)}.easing 未匹配原版精确注册名，采用 SINE_IN_OUT；原值保留在 source。`);
  }
  const track:AnimationTrack={id:crypto.randomUUID(),type,target:type==='wait'?'timeline.wait':'camera.actions',label:typeof rawType==='string'?rawType:type,
   from:0,to:0,start:0,duration,easing,pingPong:false,enabled:true};
  if(type==='animate'){
   const actions=r.peek([...path,'actions']);
   if(actions!==undefined&&(!Array.isArray(actions)||actions.length>64))fail(`${pathLabel(path)}.actions 应为最多64个动作的数组`);
   track.actions=[];
   if(Array.isArray(actions)&&!actions.length)r.use([...path,'actions']);
   const actionList=(actions??[]) as unknown[];
   for(let j=0;j<actionList.length;j++){
    const actionPath=[...path,'actions',String(j)];r.object(actionPath);
    const method=r.use([...actionPath,'method']);
    if(method!=='stopAmbient'&&method!=='ambient'&&method!=='zoom'&&method!=='gradientStart'&&method!=='gradientStop'){
     r.acknowledge(actionPath,'原版复根不执行此动作方法');continue;
    }
    r.acknowledge([...actionPath,'enabled'],'原版不读取动作级 enabled，动作仍按片段开关执行');
    const action:AnimationAction={id:crypto.randomUUID(),method,enabled:true};
    if(method==='gradientStop'){track.actions.push(action);continue;}
    if(method==='gradientStart'){
     const argsPath=[...actionPath,'args'],facts=prepareRootsGradientImport(r.peek(argsPath));
     if(facts.payloadPath!==null){
      for(const field of facts.consumedFields)r.use([...argsPath,...facts.payloadPath,field]);
      if(facts.payloadEmpty)r.use([...argsPath,...facts.payloadPath]);
     }else if(r.has(argsPath))r.acknowledge(argsPath,'原版未找到渐变对象参数，采用默认配置');
     for(const diagnostic of facts.diagnostics)r.warnings.push(`${pathLabel(actionPath)}：${diagnostic}`);
     if(facts.kind==='start')track.actions.push({...action,gradient:{model:'offsets',...facts.config,affectInside:true,affectOutside:true}});
     continue;
    }
    if(method==='stopAmbient'){track.actions.push({...action,args:{}});continue;}
    const args=r.peek([...actionPath,'args']);
    if(!Array.isArray(args)||(method==='ambient'&&args.length<2)){
     if(r.has([...actionPath,'args']))r.acknowledge([...actionPath,'args'],'原版未从此参数形状写入相机目标');
     continue;
    }
    const value=(index:number)=>{
     const parsed=rootsCameraFloat(r,[...actionPath,'args',String(index)],0);
     if(!Number.isFinite(parsed))fail(`${pathLabel(actionPath)}.args[${index}] 原版相机目标为非有限值；本地不能保存或回放该状态`);
     return parsed;
    };
    action.args=method==='zoom'?{value:value(0)}:{phiSpeed:value(0),thetaSpeed:value(1),gammaSpeed:args.length>=3?value(2):0};
    if(!args.length)r.use([...actionPath,'args']);
    track.actions.push(action);
   }
  }
  s.timeline.tracks.push(track);
 }
 validateTimelineCapacity(s.timeline.tracks);
 const plan=prepareRootsCameraTimeline(s);r.warnings.push(...plan.warnings);
 // Layout/queue admission is owned by the same clock as execution. Do not save
 // derived starts, or compile another duration/last-write representation here.
 resolveTimeline(s);
 r.warnings.push('复根场景时间线已按源队列逐帧回放：每帧只推进一个片段，保留相机与渐变动作顺序及两次渐变更新；本地固定帧时钟不等同原版实时帧与工作器提交次序。');
}

/** JsonSpirographConfig owns a single rotate animation per animate clip; its
 * last recognized target wins. Unknown clip types are source waits, not generic
 * camera actions. Original inputs remain in provenance independently. */
function spirographTimeline(r:Reader,s:SceneDocument):void {
 const clips=r.peek('timeline');
 s.timeline={...s.timeline,schedule:'spirograph-sequence-v1',duration:.1,tracks:[]};
 if(clips===undefined)return;
 if(!Array.isArray(clips)||clips.length>1000)fail('timeline 应为最多 1000 段的数组');
 if(!clips.length)r.use('timeline');
 for(let i=0;i<clips.length;i++){
  const path=`timeline.${i}`;if(!isObject(clips[i]))fail(`${path} 不是对象`);
  if(r.domainBoolean(path+'.enabled',true)===false){r.acknowledge(path,'原版跳过停用片段');continue;}
  const originalType=r.str(path+'.type')??'wait',type=originalType.toLowerCase();
  let duration=r.spiroScalar(path+'.duration',type==='spirograph_finish_wait'?.1:1,true);
  if(type==='spirograph_finish_wait'){
   const bounded=Math.max(Math.fround(.1),Math.min(1200,duration));
   if(bounded!==duration)r.warnings.push(`${path}.duration=${duration} 按原版完成等待范围调整为 ${bounded} 秒；原值保留在 source。`);
   duration=bounded;
  }
  if(duration<0||duration>86400)fail(`${path}.duration 超出本地 0–86400 秒范围`);
  const label=r.str(path+'.label')??originalType;
  const track:AnimationTrack={id:crypto.randomUUID(),type:'wait',target:'timeline.wait',label,start:0,duration,from:0,to:0,easing:'sine-in-out',pingPong:false,enabled:true};
  if(type==='spirograph_finish_wait'){track.type='spirograph_finish_wait';track.spirographWait='visual-or-deadline-v1';}
  else if(type==='animate'){
   track.type='animate';track.target='camera.actions';let speed:number|undefined;
   const easing=r.str(path+'.easing')??'SINE_IN_OUT',normalized=easing.toLowerCase().replaceAll('_','-');
   if(EASING_NAMES.includes(normalized))track.easing=normalized;
   else r.warnings.push(`${path}.easing=${easing} 未识别，保留原版默认 SINE_IN_OUT；原值保留在 source。`);
   const actions=r.peek(path+'.actions');
   if(actions!==undefined){
    if(!Array.isArray(actions)||actions.length>64)fail(`${path}.actions 应为最多64个动作的数组`);
    if(!actions.length)r.use(path+'.actions');
    for(let j=0;j<actions.length;j++){
     const action=`${path}.actions.${j}`;if(!isObject(actions[j]))fail(`${action} 不是对象`);
     const method=r.str(action+'.method')??'';
     if(method!=='spirographRotate'){r.acknowledge(action,'原版旋轮不执行此动作方法');continue;}
     const args=r.peek(action+'.args');
     if(Array.isArray(args)&&args.length){if(args.length>128)fail(`${action}.args 超过128项`);speed=r.spiroScalar(action+'.args.0',0,true);}
     else if(args!==undefined)r.acknowledge(action+'.args','原版未读取目标速率，保留本片段当前目标');
    }
   }
   track.actions=speed===undefined?[]:[{id:crypto.randomUUID(),method:'spirographRotate',enabled:true,args:{speed}}];
  }else if(type!=='wait')r.warnings.push(`${path}：原版将 ${originalType} 作为等待片段，保留时长；原值保留在 source。`);
  validateTimelineExtensions(track,'spirograph');s.timeline.tracks.push(track);
 }
 validateTimelineCapacity(s.timeline.tracks);
 resolveTimeline(s); // Validate the current queue budget without persisting derived starts.
}

/** Import original MathArt JSON while retaining every original value separately. */
export function parseLegacyScene(text:string,options:{samilaCamera?:'auto'|'legacy-v1'}={}):{scene:SceneDocument;warnings:string[];source:unknown;sourceNumberTokens?:SourceNumberToken[]} {
 const parsed=readProjectJson(text),imported=importLegacyValue(parsed.source,options,parsed.metadata,parsed.text);
 serializeScene(sceneWithImportedProvenance(imported));return imported;
}
function readProjectJson(text:string,selectFormat=false):ProjectJson {
 if(text.length>MAX_SCENE_TEXT_LENGTH)fail('文件超过 8 MB');
 let parsed:ReturnType<typeof parseSourceJson>;const stripped=withoutComments(text);
 try{parsed=parseSourceJson(stripped,{retainMetadata:value=>!selectFormat||!isObject(value)||value.version!==1});}catch(e){fail(e instanceof Error?e.message:String(e));}
 if(!isObject(parsed.value))fail('顶层应为 JSON 对象');
 return{source:parsed.value,metadata:parsed.metadata,text:stripped};
}
/** The file adapter delegates both format selection and decoding here so a
 * stricter header parser cannot reject a supported source before import. */
export function parseProjectFile(text:string):{format:'local'|'mathart';scene:SceneDocument;warnings:string[]} {
 const{source,metadata,text:sourceText}=readProjectJson(text,true);
 if(source.version===1){const scene=parseSceneValue(source);serializeScene(scene);return{format:'local',scene,warnings:[]};}
 const imported=importLegacyValue(source,{},metadata,sourceText);
 const scene=sceneWithImportedProvenance(imported);serializeScene(scene);
 return{format:'mathart',scene,warnings:imported.warnings};
}
function sceneWithImportedProvenance(imported:ReturnType<typeof importLegacyValue>):SceneDocument {
 return {...imported.scene,provenance:{kind:'MathArt Studio',original:imported.source,warnings:imported.warnings,...(imported.sourceNumberTokens?{sourceNumberTokens:imported.sourceNumberTokens}:{})}};
}
function projectResolution(r:Reader,scene:SceneDocument):void {
 const path=['resolution'] as const,raw=r.peek(path);
 if(!r.has(path))return;
 if(isObject(raw)){
  for(const dimension of PROJECT_RESOLUTION_SOURCE_NUMBER_PATHS){r.retainNumberToken(dimension);r.use(dimension);}
  if(Object.keys(raw).length===0)r.use(path);
 }else r.use(path);
 const prepared=prepareSourceProjectResolution(raw,{width:r.numberToken(['resolution','width']),height:r.numberToken(['resolution','height'])});
 if(!prepared.ok)fail(`resolution.${prepared.error.field} 源整数转换失败：${prepared.error.cause.kind}`);
 const facts=prepared.value;
 if(facts.status==='applied')scene.projectResolution=facts.value;
 else if(facts.status==='ignored')r.warnings.push('resolution 未同时提供源整数规则下 64 至 8192 的宽高，按原版 ProjectState 保留无分辨率覆盖；原值保留在 source。');
}
function importLegacyValue(source:ObjectValue,options:{samilaCamera?:'auto'|'legacy-v1'}={},metadata?:SourceMetadata,sourceText?:string):{scene:SceneDocument;warnings:string[];source:unknown;sourceNumberTokens?:SourceNumberToken[]} {
 const r=new Reader(source,metadata,sourceText),version=r.str('config_version',true);if(version!=='1.0.0'&&version!=='1.0')fail(`不支持 config_version=${version}`);
 const type=r.str('type',true)!,kind=TYPES[type.toUpperCase()];if(!kind)fail(`未知场景类型 ${type}`);const def=definitions.find(d=>d.kind===kind)!;const scene=createScene(def);
 if(ordinaryFamily(kind))r.validateNativeObjects();
 const ordinaryScope=ordinaryFamily(kind)?ordinaryResult(prepareOrdinarySourceScalarScope(kind,{parameters:r.peek(['parameters']),memberOrder:(kind==='surface'||kind==='implicit')&&r.has(['parameters'])?r.sourceKeys(['parameters']):undefined})):undefined;
 if(ordinaryScope)r.warnings.push(...ordinaryScope.diagnostics);
 const name=r.str('name',true)!;if(!name.trim()||name.length>300)fail('场景名称为空或超过 300 字符');scene.name=name;scene.parameters=ordinaryScope&&(kind==='surface'||kind==='implicit')?{...ordinaryScope.parameterValues}:kind==='domain'?r.nativeDomainParameters('parameters'):kind==='roots'?scene.parameters:numericParameters(r,'parameters',kind==='symmetry');if(kind!=='roots')scene.equations={};
 if(ordinaryScope&&(kind==='surface'||kind==='implicit')){r.use(['parameters']);for(const key of Object.keys(scene.parameters)){if(!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key)||['constructor','prototype'].includes(key))fail(`parameters.${key} 参数名不受本地公式模型支持`);r.retainNumberToken(['parameters',key]);}}
 // Source geometry and queue share parsed dispatch facts. Select its owner
 // before common/local geometry reads, so fallback values are never reinterpreted.
 const ordinaryStructure=kind==='surface'?ordinaryTimelineStructure(r,true,ordinaryScope):undefined;
 if(ordinaryStructure?.some(clip=>clip.type==='trails'||clip.surfaceParameterClip!==undefined||clip.actions.some(action=>action.method==='track'&&Array.isArray(action.raw)&&action.raw.length>0||action.method==='gradientStop'||action.surfaceGradient?.kind==='start'||!!action.surfaceParameters?.length)))scene.settings.surfaceGeometryVersion=SOURCE_SURFACE_PARTICLES;
 // Definitions supply explicit application defaults for omitted optional settings.
 projectResolution(r,scene);
 common(r,scene);
 ({surface,attractor,map:mapAttractor,implicit,fractal,domain,symmetry,perlin,spirograph,bouncing,samila,roots} as Record<SceneKind,(r:Reader,s:SceneDocument)=>void>)[kind](r,scene);
 // A finite explicit source theta is consumed only by the Samila scalar owner.
 // Validate the owned container even when keeping legacy behavior; never silently
 // substitute a guessed angle for malformed authored camera data.
 let samilaTheta:number|undefined;
 if(kind==='samila'&&r.has('camera')){r.object('camera');samilaTheta=r.num('camera.theta',scene.parameters);}
 if(kind==='samila'&&samilaTheta!==undefined&&options.samilaCamera!=='legacy-v1')scene.settings=initializeSamilaCamera({...scene.settings,samilaCameraTheta:samilaTheta});
 if(ordinaryScope)ordinaryCamera(r,scene,ordinaryScope);
 formulaAnnotations(r,scene);timeline(r,scene,ordinaryScope,ordinaryStructure);
 if(kind==='samila'){
  const thetaAction=scene.timeline.tracks.some(t=>t.type==='align'&&t.orientation?.theta!==undefined||t.actions?.some(a=>['rotateTheta','rotateTo','ambient'].includes(a.method)));
  if(options.samilaCamera!=='legacy-v1'&&(samilaTheta!==undefined||thetaAction)){
   scene.settings=initializeSamilaCamera({...scene.settings,samilaCameraTheta:samilaTheta??0});
   if(samilaTheta===undefined)r.warnings.push('Samila theta 动作缺少 camera.theta；采用明确的本地起始角 0，不视为原版缺省值。');
   r.warnings.push('Samila camera.theta 已映射为锚定密度相机：清空时捕获采样锚点，随后仅旋转原始密度显示。phi、gamma、缩放及其他相机分量未映射；固定采样时钟、视口、随机序列与原版不保证等效。');
  }else if(r.has('camera'))r.warnings.push('Samila 相机保持旧本地模型；未应用 camera.theta，原值保留在 source。');
  if(r.has('camera'))r.acknowledge('camera','仅已启用的 Samila 锚定模型消费 theta；其他相机字段未应用');
 }

 const sourceTimeline=kind==='bouncing'?r.use('timeline'):undefined;
 if(kind==='bouncing'&&(sourceTimeline===undefined||Array.isArray(sourceTimeline)&&sourceTimeline.every(track=>isObject(track)&&typeof track.type==='string'&&track.type.toLowerCase()==='wait'))){
  scene.settings.bouncingPlaybackModel='continuous-v2';
  r.warnings.push('仅等待的弹跳时间线已采用连续预览；等待片段保留为导出范围，录制使用独立时长。场景时钟与原版实时帧率未作等价声明。');
 }
 r.remaining();return{scene,warnings:r.warnings,source,...(r.sourceNumberTokens.length?{sourceNumberTokens:r.sourceNumberTokens}:{})};
}
