import {useEffect,useState} from 'react';
import {useI18n} from '../i18n';
import type {RootNativeParameter,RootsMathConfiguration,SceneDocument} from '../types';
import {createRootsNativeMath,defaultRootNativeParameter,parseRootsMath,usesRootsNativeMath,withRootsMathModel} from '../engine/rootsMathConfig';
import {usesRootsNativePresentation} from '../engine/rootsPresentationAuthoring';
type Props={scene:SceneDocument;onChange:(scene:SceneDocument)=>void};
type ParameterDraft=Omit<RootNativeParameter,'minRe'|'maxRe'|'minIm'|'maxIm'|'value'>&{minRe:string;maxRe:string;minIm:string;maxIm:string;value:[string,string]};
type Draft={polynomial:RootsMathConfiguration['polynomial'];parameters:ParameterDraft[];solver:{maxIterations:string;tolerance:string};sampling:{sampleCount:string;batchSize:string;workerCount:string;seed:string;filter:string}};
function draftOf(c:RootsMathConfiguration):Draft{return{polynomial:structuredClone(c.polynomial),parameters:c.parameters.map(p=>({...p,minRe:String(p.minRe),maxRe:String(p.maxRe),minIm:String(p.minIm),maxIm:String(p.maxIm),value:p.value.map(String) as [string,string]})),solver:{maxIterations:String(c.solver.maxIterations),tolerance:String(c.solver.tolerance)},sampling:{...c.sampling,sampleCount:String(c.sampling.sampleCount),batchSize:String(c.sampling.batchSize),workerCount:String(c.sampling.workerCount)}};}
export function RootsMathControls({scene,onChange}:Props){
 const {t}=useI18n(),[draft,setDraft]=useState<Draft>(()=>draftOf(scene.rootsMath??createRootsNativeMath())),[dirty,setDirty]=useState(false),[error,setError]=useState('');
 const identity=JSON.stringify(scene.rootsMath);
 useEffect(()=>{setDraft(draftOf(scene.rootsMath??createRootsNativeMath()));setDirty(false);setError('');},[identity,scene.id]);
 if(scene.kind!=='roots')return null;
 const active=usesRootsNativeMath(scene),version=scene.rootsMath?.model??'local-v1';
 const patch=(next:Draft)=>{setDraft(next);setDirty(true);setError('');};
 const number=(value:string)=>{if(!value.trim()||!Number.isFinite(Number(value)))throw new Error('复根源数值必须为有限数字');return Number(value);};
 function apply(){try{const next=parseRootsMath({model:version,polynomial:draft.polynomial,parameters:draft.parameters.map(p=>({...p,minRe:number(p.minRe),maxRe:number(p.maxRe),minIm:number(p.minIm),maxIm:number(p.maxIm),value:p.value.map(number)})),solver:{maxIterations:number(draft.solver.maxIterations),tolerance:number(draft.solver.tolerance)},sampling:{...draft.sampling,sampleCount:number(draft.sampling.sampleCount),batchSize:number(draft.sampling.batchSize),workerCount:number(draft.sampling.workerCount)}});onChange({...scene,rootsMath:next});setDirty(false);setError('');}catch(e){setError(e instanceof Error?e.message:String(e));}}
 const field=(label:string,value:string,change:(v:string)=>void,type='text')=><label className="field"><span>{t(label)}</span><input aria-label={t(label)} type={type} step={type==='number'?'any':undefined} value={value} onChange={e=>change(e.target.value)}/></label>;
 const patchParameter=(index:number,change:Partial<ParameterDraft>)=>patch({...draft,parameters:draft.parameters.map((p,i)=>i===index?{...p,...change}:p)});
 return <details open className="inspector-section"><summary>{t('复根数学与采样规则')}</summary><div className="section-body">
  <label className="field"><span>{t('复根数学版本')}</span><select aria-label={t('复根数学版本')} disabled={usesRootsNativePresentation(scene)} value={version} onChange={e=>{try{onChange(withRootsMathModel(scene,e.target.value as RootsMathConfiguration['model']));setError('');}catch(e){setError(e instanceof Error?e.message:String(e));}}}><option value="local-v1">{t('本地兼容公式')}</option><option value="mathart-1.7.8-v1">{t('MathArt 1.7.8 · 系数表与采样')}</option></select></label>
  <p className="muted">{t('首次启用使用源默认系数表，不转换本地公式。切换保留两组数学输入，色彩与投影规则保持独立。')}</p>
  {!active&&scene.rootsMath&&<p role="status">{t('源系数表、参数和种子已保留，当前使用本地公式。')}</p>}
  {active&&<>
   <p role="status">{t('本地整式、通用参数和旧采样设置保留但不参与求根；系数只能引用下面的源采样参数及源常量。')}</p>
   {typeof draft.polynomial.variable!=='string'&&<p role="status">{t('源变量标签的 Java 文本尚未确定；原值已保留，系数求根不受影响。编辑名称会显式替换该标签。')}</p>}
   {field('源多项式变量名称',typeof draft.polynomial.variable==='string'?draft.polynomial.variable:'',variable=>patch({...draft,polynomial:{...draft.polynomial,variable}}))}
   <p className="muted">{t('变量名称用于显示，不会自动成为系数参数。显式零系数与次数原文均保留。')}</p>
   {draft.polynomial.coefficients.map((row,i)=><div key={i} className="equation-field" style={{display:'grid',gap:5,marginBottom:8}}>
    <label><span>{t('系数次数 {index}',{index:i+1})}</span><input aria-label={t('系数次数 {index}',{index:i+1})} value={row.exponent} onChange={e=>patch({...draft,polynomial:{...draft.polynomial,coefficients:draft.polynomial.coefficients.map((r,j)=>j===i?{...r,exponent:e.target.value}:r)}})}/></label>
    <label><span>{t('系数表达式 {index}',{index:i+1})}</span><textarea rows={2} aria-label={t('系数表达式 {index}',{index:i+1})} value={row.expression} onChange={e=>patch({...draft,polynomial:{...draft.polynomial,coefficients:draft.polynomial.coefficients.map((r,j)=>j===i?{...r,expression:e.target.value}:r)}})}/></label>
    <button onClick={()=>patch({...draft,polynomial:{...draft.polynomial,coefficients:draft.polynomial.coefficients.filter((_,j)=>j!==i)}})}>{t('删除系数')}</button>
   </div>)}
   {!draft.polynomial.coefficients.length&&<p role="status">{t('空系数表表示零常量，产生空根集合。')}</p>}
   <button onClick={()=>patch({...draft,polynomial:{...draft.polynomial,coefficients:[...draft.polynomial.coefficients,{exponent:'0',expression:'0'}]}})}>{t('添加系数')}</button>
   <p className="muted">{t('系数支持 re、im、abs、conj、sin、cos、exp；参数区分大小写，不隐式绑定时间。修改名称不会自动改写表达式。')}</p>
   {draft.parameters.map((p,i)=><fieldset key={i} style={{minWidth:0,padding:8,margin:'10px 0',border:'1px solid var(--border)'}}><legend>{t('源采样参数 {index}',{index:i+1})}</legend>
    {field('源参数名称',p.name,name=>patchParameter(i,{name}))}
    <label className="field"><span>{t('采样域')}</span><select aria-label={t('源采样域 {index}',{index:i+1})} value={p.domain} onChange={e=>patchParameter(i,{domain:e.target.value as RootNativeParameter['domain']})}>{([['UNIT_CIRCLE','单位圆'],['REAL_RANGE','实数区间'],['COMPLEX_RECT','复平面矩形'],['FIXED','固定复数']] as const).map(([value,label])=><option key={value} value={value}>{t(label)}</option>)}</select></label>
    {(p.domain==='REAL_RANGE'||p.domain==='COMPLEX_RECT')&&<>{field('源实部端点一',p.minRe,minRe=>patchParameter(i,{minRe}),'number')}{field('源实部端点二',p.maxRe,maxRe=>patchParameter(i,{maxRe}),'number')}</>}
    {p.domain==='COMPLEX_RECT'&&<>{field('源虚部端点一',p.minIm,minIm=>patchParameter(i,{minIm}),'number')}{field('源虚部端点二',p.maxIm,maxIm=>patchParameter(i,{maxIm}),'number')}</>}
    {p.domain==='FIXED'&&<>{field('源固定实部',p.value[0],v=>patchParameter(i,{value:[v,p.value[1]]}),'number')}{field('源固定虚部',p.value[1],v=>patchParameter(i,{value:[p.value[0],v]}),'number')}</>}
    <button onClick={()=>patch({...draft,parameters:draft.parameters.filter((_,j)=>j!==i)})}>{t('删除采样定义')}</button>
   </fieldset>)}
   <button onClick={()=>patch({...draft,parameters:[...draft.parameters,draftOf({...createRootsNativeMath(),parameters:[defaultRootNativeParameter('t'+(draft.parameters.length+1))]}).parameters[0]]})}>{t('添加源采样参数')}</button>
   <p className="muted">{t('参数名称和范围原值保留；有效名称按源规则处理，范围在采样时排序。固定参数不消耗随机数，重复有效名称仍分别采样。')}</p>
   {field('源求解迭代上限',draft.solver.maxIterations,maxIterations=>patch({...draft,solver:{...draft.solver,maxIterations}}),'number')}
   {field('源求解容差',draft.solver.tolerance,tolerance=>patch({...draft,solver:{...draft.solver,tolerance}}),'number')}
   {field('源多项式样本数',draft.sampling.sampleCount,sampleCount=>patch({...draft,sampling:{...draft.sampling,sampleCount}}),'number')}
   {field('源提交批大小',draft.sampling.batchSize,batchSize=>patch({...draft,sampling:{...draft.sampling,batchSize}}),'number')}
   {field('逻辑采样工作器数',draft.sampling.workerCount,workerCount=>patch({...draft,sampling:{...draft.sampling,workerCount}}),'number')}
   {field('源 64 位整数种子',draft.sampling.seed,seed=>patch({...draft,sampling:{...draft.sampling,seed}}))}
   {field('源样本过滤',draft.sampling.filter,filter=>patch({...draft,sampling:{...draft.sampling,filter}}))}
   <p className="muted">{t('原机器的默认工作器数无法恢复；首次启用采用本地选择 1。工作器数会改变随机流，固定步预览频率是独立的本地播放设置。')}</p>
   <div className="explore-actions"><button className="apply-button" disabled={!dirty} onClick={apply}>{t('应用源数学配置')}</button><button disabled={!dirty} onClick={()=>{setDraft(draftOf(scene.rootsMath!));setDirty(false);setError('');}}>{t('撤销源数学编辑')}</button></div>
  </>}
  {error&&<p role="alert" className="export-error">{t(error)}</p>}
 </div></details>;
}
