import {prepareDomainViewport,domainExplorePoint} from './domainViewport';
import type {SceneDocument,Settings,RootsMathConfiguration,RootNativeParameter} from '../types';
import {random,numberSetting} from './expression';
import type {Complex} from './complexMath';
import {prepareRootsMathJob} from './rootsMathJob';
import {usesRootsNativeMath,parseRootsMath,defaultRootNativeParameter} from './rootsMathConfig';
import {prepareRootsNativeSampling} from './rootsNativeSampling';
import {javaTrim} from './sourceJavaText';
import type {RootsNativeWorkHooks} from './rootsNativeExpression';
import {domainExpressions} from './domainExpressions';
import {domainEvaluator,parseDomainModel} from './domainModel';
import {defaultRootParameter,parseRootParameters,withRootParameters} from './rootParameters';
import {withExploredDomainFormula} from './domainAuthoring';
import {parseDomainIterationVersion} from './domainSourceIteration';
export const ROOT_EXPLORER_STYLES=[['RADIAL_BLOOM','径向绽放'],['RING_CASCADE','层叠环带'],['BRANCH_WEB','分支网络'],['PHASE_WEAVE','相位编织'],['MINIMAL_SKELETON','稀疏骨架'],['HIGH_DEGREE_STORM','高次风暴']] as const;
export const DOMAIN_FORMULA_FAMILIES=[['AUTO','所有家族'],['RATIONAL_ZEROS','有理零极点'],['TRIG_WEAVE','三角编织'],['BRANCH_CUT','分支割线'],['REAL_IMAG_WEAVE','实虚编织'],['LAURENT_RING','Laurent 环带'],['POWER_FIELD','复幂场'],['EXP_LOG_FLOW','指数对数流'],['MOBIUS_ORBIT','Möbius 映射'],['POLY_TRIG_BLEND','多项式三角混合']] as const;
export type RootExplorerStyle=typeof ROOT_EXPLORER_STYLES[number][0];
export type DomainFormulaFamily=typeof DOMAIN_FORMULA_FAMILIES[number][0];
export interface RootsExploreOptions {kind:'roots';seed:number;style?:RootExplorerStyle;maxDegree?:number;termCount?:number;parameterCount?:number;parameterDomain?:'UNIT_CIRCLE'|'REAL_RANGE'|'MIXED';candidateCount?:number;evaluationSamples?:number;}
export interface DomainExploreOptions {kind:'domain';seed:number;family?:DomainFormulaFamily;candidateCount?:number;}
export type ComplexExploreOptions=RootsExploreOptions|DomainExploreOptions;
export interface ComplexExploreProgress {attempt:number;total:number;accepted:number;}
export interface ComplexExploreEvaluation {samples:number;valid:number;failed:number;finiteRatio:number;angularCoverage:number;spread:number;score:number;maximumResidual?:number;filtered?:number;iterationLimited?:number;work?:number;}
export interface ComplexExploreCandidate {formula:string;family:string;evaluation:ComplexExploreEvaluation;}
export interface ComplexExploreResult {status:'found'|'no-candidate'|'cancelled';scene?:SceneDocument;candidate?:ComplexExploreCandidate;attempted:number;accepted:number;requested:number;warnings:string[];elapsedMs:number;}
interface Callbacks {isCancelled?:()=>boolean;onProgress?:(progress:ComplexExploreProgress)=>void;}
const TAU=2*Math.PI;
function integer(value:number|undefined,fallback:number,min:number,max:number,name:string){const result=value??fallback;if(!Number.isSafeInteger(result)||result<min||result>max)throw new Error(`${name} 须为 ${min}–${max} 的整数`);return result;}
function choose<T>(values:readonly T[],rng:()=>number):T{return values[Math.floor(rng()*values.length)];}
const format=(value:number)=>String(Math.round(value*1000)/1000);
const between=(rng:()=>number,min:number,max:number)=>min+(max-min)*rng();
const complexLiteral=(rng:()=>number)=>`(${format(between(rng,-1.2,1.2))}+${format(between(rng,-1.2,1.2))}*i)`;
const angularBin=(z:Complex)=>Math.min(23,Math.floor(((Math.atan2(z[1],z[0])/TAU+1)%1)*24));
function statistics(samples:number,valid:number,failed:number,bins:Set<number>,lo:number,hi:number,score:number,maximumResidual?:number):ComplexExploreEvaluation{return {samples,valid,failed,finiteRatio:valid/Math.max(1,samples),angularCoverage:bins.size/24,spread:Number.isFinite(lo)&&Number.isFinite(hi)?hi-lo:0,score,...(maximumResidual===undefined?{}:{maximumResidual})};}

interface NativeRootsCandidateBasis {config:RootsMathConfiguration;parameters:RootNativeParameter[];selectedIndices:number[];names:string[];}
/** A native candidate owns its active coefficient table. Reuse the final bound
 * t1..tN definitions (including authored ranges); do not rename arbitrary source
 * keys or translate the dormant MathJS polynomial into the native grammar. */
function nativeRootsBasis(scene:SceneDocument,count:number,hooks:RootsNativeWorkHooks):NativeRootsCandidateBasis|undefined {
 if(!usesRootsNativeMath(scene))return;
 const config=parseRootsMath(scene.rootsMath),prepared=prepareRootsNativeSampling(config.parameters,config.sampling,hooks);
 if(!prepared.ok)throw prepared.error;
 try{
  const parameters=config.parameters.map(p=>({...p,value:[...p.value] as [number,number]})),selectedIndices:number[]=[],names:string[]=[];
  for(let i=1;i<=count;i++){
   const name='t'+i;let index=-1;
   if(prepared.value.bindings.has(name))for(let j=parameters.length-1;j>=0;j--)if(javaTrim(parameters[j].name)===name){index=j;break;}
   if(index<0){index=parameters.length;parameters.push(defaultRootNativeParameter(name));}
   names.push(name);selectedIndices.push(index);
  }
  return{config,parameters,selectedIndices,names};
 }finally{prepared.value.dispose();}
}
const rootCandidateFormula=(scene:SceneDocument)=>usesRootsNativeMath(scene)?scene.rootsMath!.polynomial.coefficients.map(row=>`(${row.expression})${row.exponent==='0'?'':`*x^${row.exponent}`}`).join(' + '):scene.equations.polynomial;
class RootsExploreWorkLimit extends Error {}
const ROOTS_EXPLORE_WORK_LIMIT=100_000_000;

/** Root terms are independently composed, not copied formula strings or source
 * algorithms. Each named style changes exponent distribution and coefficient
 * coupling; every candidate is screened with the production polynomial solver. */
function rootCandidate(scene:SceneDocument,options:Required<RootsExploreOptions>,rng:()=>number,native?:NativeRootsCandidateBasis):SceneDocument {
 const degree=options.maxDegree,terms=options.termCount,powers=new Set<number>([degree,0]);
 const preferred:number[]=[];
 switch(options.style){
  case 'RADIAL_BLOOM':{const step=Math.max(1,Math.floor(degree/(terms-1)));for(let p=step;p<degree;p+=step)preferred.push(p);break;}
  case 'RING_CASCADE':for(let i=1;i<terms-1;i++)preferred.push(Math.max(1,Math.round(degree*(i/(terms-1))**.6)));break;
  case 'BRANCH_WEB':preferred.push(1,2,degree-1);break;
  case 'PHASE_WEAVE':for(let p=1;p<degree;p+=2)preferred.push(p);break;
  case 'MINIMAL_SKELETON':preferred.push(1,Math.floor(degree/2));break;
  case 'HIGH_DEGREE_STORM':for(let p=degree-1;p>=1;p--)preferred.push(p);break;
 }
 const pool=[...new Set([...preferred,...Array.from({length:degree-1},(_,i)=>i+1)])];
 // Seeded shuffle only within the preferred pattern's first few slots; avoids
 // engine-dependent Array.sort comparators driven by a PRNG.
 if(options.style==='BRANCH_WEB'||options.style==='PHASE_WEAVE')for(let i=pool.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]];}
 for(const p of pool){if(powers.size>=terms)break;powers.add(p);}
 const variable=native?'x':String(scene.settings.variable??'z'),parameters=native?[]:parseRootParameters(scene.settings,variable,Object.keys(scene.parameters));
 if(!native)for(let i=1;parameters.length<options.parameterCount;i++){const name='t'+i;if(name!==variable&&!Object.hasOwn(scene.parameters,name)&&!parameters.some(p=>p.name===name))parameters.push(defaultRootParameter(name));}
 const sourceParameters=native?.parameters.map(p=>({...p,value:[...p.value] as [number,number]}));
 const selected=native?native.selectedIndices.map(i=>sourceParameters![i]):parameters.slice(0,options.parameterCount),names=native?.names??selected.map(p=>p.name);
 const coefficients=[`${variable}^${degree}`],sourceCoefficients=[{exponent:String(degree),expression:'1'}],used=new Set<string>();
 for(const p of [...powers].filter(p=>p!==degree).sort((a,b)=>b-a)){
  const a=names[Math.floor(rng()*options.parameterCount)],b=names[Math.floor(rng()*options.parameterCount)],exponent=1+Math.floor(rng()*3),scale=format(between(rng,.35,1.25));
  let coefficient:string;
  switch(options.style){
   case 'RADIAL_BLOOM':coefficient=`${scale}*${a}^${exponent}`;break;
   case 'RING_CASCADE':coefficient=`${format((.5+p/degree)*between(rng,.5,1.4))}*(${a}+0.2*${b}^2)`;break;
   case 'BRANCH_WEB':coefficient=`${scale}*(${a}^2+i*${b})`;break;
   case 'PHASE_WEAVE':coefficient=`${scale}*(i*${a}^${exponent}+${b}^${1+exponent%3})`;break;
   case 'MINIMAL_SKELETON':coefficient=`${format(between(rng,.1,.6))}*${a}${p===0?'+1':''}`;break;
   case 'HIGH_DEGREE_STORM':coefficient=`${scale}*(${a}^${exponent}+i*${b}^${exponent+1}+${complexLiteral(rng)})`;break;
  }
  for(const name of names)if(new RegExp('\\b'+name+'\\b').test(coefficient))used.add(name);
  if(p===0)for(const name of names)if(!used.has(name))coefficient+=`+0.25*${name}`;
  coefficients.push(`(${coefficient})${p?`*${variable}^${p}`:''}`);sourceCoefficients.push({exponent:String(p),expression:coefficient});
 }
 selected.forEach((p,i)=>{p.domain=options.parameterDomain==='MIXED'?(i%2?'REAL_RANGE':'UNIT_CIRCLE'):options.parameterDomain;});
 if(native)return{...scene,rootsMath:{...native.config,polynomial:{...native.config.polynomial,coefficients:sourceCoefficients},parameters:sourceParameters!}};
 const settings:Settings=withRootParameters(scene.settings,parameters,Object.keys(scene.parameters));
 return {...scene,equations:{...scene.equations,polynomial:coefficients.join(' + ')},settings};
}
function evaluateRoots(scene:SceneDocument,requestedSamples:number,seed:number,cancelled:(()=>boolean)|undefined,onWork:(n:number)=>void):ComplexExploreEvaluation {
 const job=prepareRootsMathJob(scene,{isCancelled:cancelled,onWork}),rng=random(seed),samples=Math.min(requestedSamples,job.ensemble?.sampleCount??requestedSamples);
 let valid=0,failed=0,filtered=0,iterationLimited=0,totalRoots=0,goodRoots=0,minRadius=Infinity,maxRadius=-Infinity,maximumResidual:number|undefined=job.model==='local-v1'?0:undefined;const bins=new Set<number>();
 try{
  for(let i=0;i<samples;i++){
   if(cancelled?.())throw new DOMException('Roots search cancelled','AbortError');
   const result=job.sample(i,0,{sample:rng,phase:()=>rng()*TAU},{isCancelled:cancelled,onWork});
   if(result.status==='filtered'){filtered++;continue;}
   if(result.status==='invalid'){failed++;continue;}
   totalRoots+=result.rootCount;if(job.model==='mathart-1.7.8-v1'&&result.iterationLimit)iterationLimited++;
   if(!result.admitted){failed++;continue;}valid++;if(result.residual!==null)maximumResidual=Math.max(maximumResidual??0,result.residual);
   for(let k=0;k<result.rootCount;k++){
    const z:Complex=[result.roots[k*2],result.roots[k*2+1]],radius=Math.hypot(...z);if(!Number.isFinite(radius)||radius>1e4)continue;
    goodRoots++;bins.add(angularBin(z));minRadius=Math.min(minRadius,radius);maxRadius=Math.max(maxRadius,radius);
   }
  }
 }finally{job.dispose();}
 const finiteRatio=goodRoots/Math.max(1,totalRoots),spread=Number.isFinite(minRadius)?Math.log1p(maxRadius)-Math.log1p(minRadius):0;
 const score=finiteRatio*2+bins.size/24+Math.min(1,spread)-failed/Math.max(1,samples-filtered)-Math.max(0,maxRadius-20)/20;
 return {...statistics(samples,valid,failed,bins,Math.log1p(minRadius),Math.log1p(maxRadius),score,maximumResidual),finiteRatio,...(filtered?{filtered}:{}),...(iterationLimited?{iterationLimited}:{})};
}
function domainCandidate(scene:SceneDocument,family:DomainFormulaFamily,rng:()=>number):SceneDocument {
 const p=2+Math.floor(rng()*5),q=1+Math.floor(rng()*3),a=complexLiteral(rng),b=complexLiteral(rng),t=format(between(rng,.4,1.6));let formula='z';
 switch(family){
  case 'RATIONAL_ZEROS':formula=`(z^${p}-${a})*(z+${b})/(z^${q}+${a})`;break;
  case 'TRIG_WEAVE':formula=choose([`sin(${t}*z^${q})/cos(z+${a})`,`cos(z^${q}+${b})*sin(${t}*z)`,`tan(z/${t})+sin(z^${q})`],rng);break;
  case 'BRANCH_CUT':formula=choose([`sqrt((z-${a})/(z-${b}))`,`log(z^${p}+${a})/sqrt(z+${b})`,`sqrt(sin(z^${q})+${a})`],rng);break;
  case 'REAL_IMAG_WEAVE':formula=`sin(${t}*re(z^${q}))+i*cos(im(z^${p})+re(z))`;break;
  case 'LAURENT_RING':formula=`z^${p}+${a}/z^${q}+${b}/z`;break;
  case 'POWER_FIELD':formula=`(z+${a})^(${t}+${format(between(rng,-2,2))}*i)`;break;
  case 'EXP_LOG_FLOW':formula=choose([`exp(${t}*z)/(z^${q}+${a})`,`log(exp(z/${t})+z^${q}+${a})`,`exp(i*z)+log(z^${p}+${b})`],rng);break;
  case 'MOBIUS_ORBIT':formula=`((${a}*z+1)/(z+${b}))^${q}`;break;
  case 'POLY_TRIG_BLEND':formula=`z^${p}+${a}*sin(${t}*z^${q})+${b}`;break;
 }
 return withExploredDomainFormula(scene,formula);
}
function evaluateDomain(scene:SceneDocument,cancelled?:()=>boolean):ComplexExploreEvaluation {
 const version=parseDomainIterationVersion(scene.settings.domainIterationVersion),native=version==='mathart-1.7.8-cpu'||version==='mathart-1.7.8-gpu',s=scene.settings;
 const nativeEvaluate=native?domainEvaluator(parseDomainModel(scene,0)):undefined;
 const f=native?undefined:domainExpressions.get({formula:scene.equations.f,parameters:{...scene.parameters,time:0}}).f;
 const view=prepareDomainViewport(s);
 const constant:[number,number]=[numberSetting(s,'constantReal',0),numberSetting(s,'constantImag',0)];let valid=0,failed=0,min=Infinity,max=-Infinity;const bins=new Set<number>();
 const samples=17*13;
 for(let y=0;y<13;y++)for(let x=0;x<17;x++){
  if(cancelled?.())return statistics(valid+failed,valid,failed,bins,min,max,0);
  const z:Complex=domainExplorePoint(x,y,17,13,view);
  try{const result=nativeEvaluate?nativeEvaluate(z):f!({...scene.parameters,time:0,z,w:z,c:constant}),radius=Math.hypot(...result);if(!Number.isFinite(radius)||radius>1e100)throw new Error('nonfinite');valid++;bins.add(angularBin(result));const magnitude=Math.log1p(radius);min=Math.min(min,magnitude);max=Math.max(max,magnitude);}catch{failed++;}
 }
 const score=2*valid/samples+bins.size/24+Math.min(2,max-min)/2-failed/samples;
 return statistics(samples,valid,failed,bins,min,max,score);
}
/** Bounded numeric search. Rejected candidates never replace the document;
 * cancellation returns no candidate. Camera, palette, viewport and explicit
 * sampling ranges remain unchanged; domain formula apply disables old iteration. */
export function exploreComplex(scene:SceneDocument,options:ComplexExploreOptions,callbacks:Callbacks={}):ComplexExploreResult {
 const started=performance.now(),seed=integer(options.seed,42,0,4294967295,'探索种子');
 if(scene.kind!==options.kind||!['roots','domain'].includes(scene.kind))throw new Error('公式探索类型与场景不一致');
 const count=integer(options.candidateCount,12,1,24,'候选数量'),warnings:string[]=[];let attempted=0,accepted=0,work=0,actualWork=0,best:SceneDocument|undefined,candidate:ComplexExploreCandidate|undefined;
 let roots:Required<RootsExploreOptions>|undefined,native:NativeRootsCandidateBasis|undefined;
 const charge=(n:number)=>{actualWork+=n;if(actualWork>ROOTS_EXPLORE_WORK_LIMIT)throw new RootsExploreWorkLimit();};
 if(options.kind==='roots'){
  const maxDegree=integer(options.maxDegree,18,4,36,'最高次数'),termCount=integer(options.termCount,5,3,Math.min(10,maxDegree+1),'公式项数'),parameterCount=integer(options.parameterCount,2,1,3,'变化因子数量'),evaluationSamples=integer(options.evaluationSamples,12,4,24,'评估样本');
  const style=options.style??'RADIAL_BLOOM',parameterDomain=options.parameterDomain??'UNIT_CIRCLE';if(!ROOT_EXPLORER_STYLES.some(([name])=>name===style)||!['UNIT_CIRCLE','REAL_RANGE','MIXED'].includes(parameterDomain))throw new Error('未知复根探索风格或变化范围');
  roots={kind:'roots',seed,style,maxDegree,termCount,parameterCount,parameterDomain,candidateCount:count,evaluationSamples};
  try{native=nativeRootsBasis(scene,parameterCount,{isCancelled:callbacks.isCancelled,onWork:charge});}
  catch(error){
   if(error instanceof RootsExploreWorkLimit)return{status:'no-candidate',attempted,accepted,requested:count,warnings:['达到求根筛选工作预算；原场景保持不变。'],elapsedMs:performance.now()-started};
   if(error instanceof DOMException&&error.name==='AbortError')return{status:'cancelled',attempted,accepted,requested:count,warnings,elapsedMs:performance.now()-started};
   throw error;
  }
  if(!native)parseRootParameters(scene.settings,String(scene.settings.variable??'z'),Object.keys(scene.parameters));
 }else if(options.family&&!DOMAIN_FORMULA_FAMILIES.some(([name])=>name===options.family))throw new Error('未知域着色公式家族');
 for(let i=0;i<count;i++){
  if(callbacks.isCancelled?.())return {status:'cancelled',attempted,accepted,requested:count,warnings,elapsedMs:performance.now()-started};
  const candidateSeed=(seed+Math.imul(i+1,0x9e3779b9))>>>0,rng=random(candidateSeed);
  const family=roots?.style??(options.kind==='domain'&&options.family&&options.family!=='AUTO'?options.family:choose(DOMAIN_FORMULA_FAMILIES.slice(1).map(([id])=>id),rng));
  if(roots&&!native){const estimated=roots.maxDegree**2*Number(scene.settings.rootIterations??150)*roots.evaluationSamples;if(work+estimated>ROOTS_EXPLORE_WORK_LIMIT){warnings.push(`达到求根筛选工作预算；已检查 ${attempted} / ${count} 个候选。`);break;}work+=estimated;}
  const proposed=roots?rootCandidate(scene,roots,rng,native):domainCandidate(scene,family as DomainFormulaFamily,rng);let evaluation:ComplexExploreEvaluation;
  const beforeWork=actualWork;
  try{evaluation=roots?evaluateRoots(proposed,roots.evaluationSamples,candidateSeed,callbacks.isCancelled,charge):evaluateDomain(proposed,callbacks.isCancelled);}
  catch(error){
   if(error instanceof RootsExploreWorkLimit){warnings.push(`达到求根筛选工作预算；已检查 ${attempted} / ${count} 个候选。`);break;}
   if(error instanceof DOMException&&error.name==='AbortError')return{status:'cancelled',attempted,accepted,requested:count,warnings,elapsedMs:performance.now()-started};
   throw error;
  }
  attempted++;if(roots)evaluation={...evaluation,work:actualWork-beforeWork};
  const usable=roots?evaluation.valid/Math.max(1,evaluation.samples-(evaluation.filtered??0))>=.8&&evaluation.finiteRatio>=.95&&evaluation.angularCoverage>=.25&&evaluation.score>1.5:evaluation.finiteRatio>=.9&&(evaluation.angularCoverage>=.25||evaluation.spread>.2);
  if(usable){accepted++;if(!candidate||evaluation.score>candidate.evaluation.score){best=proposed;candidate={formula:roots?rootCandidateFormula(proposed):proposed.equations.f,family,evaluation};}}
  callbacks.onProgress?.({attempt:attempted,total:count,accepted});
 }
 if(callbacks.isCancelled?.())return {status:'cancelled',attempted,accepted,requested:count,warnings,elapsedMs:performance.now()-started};
 if(!best||!candidate)return {status:'no-candidate',attempted,accepted,requested:count,warnings:[...warnings,'本轮未找到通过有限数值筛选的候选；原场景保持不变。'],elapsedMs:performance.now()-started};
 if(options.kind==='domain'){
  if(scene.settings.domainIterationVersion==='mathart-1.7.8-gpu')warnings.push('GPU 公式探索使用分阶段 float32 CPU 参考筛选；实际设备的迭代结果可能不同。');
  if(parseDomainIterationVersion(scene.settings.domainIterationVersion)!=='local-v1')warnings.push('新公式已设为单步像素映射，并清空旧迭代公式；可撤销恢复原场景。');
  else if(scene.settings.iterationEnabled)warnings.push('新公式已关闭旧迭代，保留 next 文本；可手动重新启用，避免旧 next 遮蔽新 f。');
 }
 if(native){warnings.push('候选使用独立探索种子生成；系数表按保留的源采样配置筛选有限前缀，不保证其余样本都收敛。');if(candidate.evaluation.iterationLimited)warnings.push('部分筛选样本达到迭代上限；有限近似根按源规则参与筛选。');}
 else warnings.push('独立种子生成与有限样本筛选；不保证全域无奇点或所有参数都收敛，也不复现原版随机序列。');
 return {status:'found',scene:best,candidate,attempted,accepted,requested:count,warnings,elapsedMs:performance.now()-started};
}
