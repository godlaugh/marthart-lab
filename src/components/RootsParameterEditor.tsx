import {useI18n} from '../i18n';
import {useEffect,useState} from 'react';
import {Plus,Trash2} from 'lucide-react';
import type {RootParameter,RootParameterDomain,SceneDocument} from '../types';
import {defaultRootParameter,MAX_ROOT_PARAMETERS,parseRootParameters,ROOT_PARAMETER_DOMAINS,validateRootParameters} from '../engine/rootParameters';
import {updateRootParameters} from '../scenes/complex';

type Draft={id:string;originalName?:string;name:string;domain:RootParameterDomain;minRe:string;maxRe:string;minIm:string;maxIm:string;real:string;imag:string};
const labels:Record<RootParameterDomain,string>={UNIT_CIRCLE:'单位圆',REAL_RANGE:'实数区间',COMPLEX_RECT:'复平面矩形',FIXED:'固定复数'};
const draft=(p:RootParameter,original=true):Draft=>({id:crypto.randomUUID(),...(original?{originalName:p.name}:{}),name:p.name,domain:p.domain,minRe:String(p.minRe),maxRe:String(p.maxRe),minIm:String(p.minIm),maxIm:String(p.maxIm),real:String(p.value[0]),imag:String(p.value[1])});

export function RootsParameterEditor({scene,onChange}:{scene:SceneDocument;onChange:(next:SceneDocument)=>void}){
  const {t}=useI18n();
 const [rows,setRows]=useState<Draft[]>([]),[error,setError]=useState(''),[dirty,setDirty]=useState(false),[display,setDisplay]=useState('');
 let source='',problem='';try{source=JSON.stringify(parseRootParameters(scene.settings,String(scene.settings.variable??'z'),Object.keys(scene.parameters)));}catch(e){problem=String(e);}
 function restore(){if(source){const next=(JSON.parse(source) as RootParameter[]).map(p=>draft(p));setRows(next);setDisplay(next.find(p=>p.name===String(scene.settings.rootDisplayParameter??'t2'))?.id??'');setDirty(false);setError('');}}
 useEffect(restore,[source,scene.id,scene.settings.rootDisplayParameter]);
 if(scene.kind!=='roots')return null;
 function patch(id:string,changes:Partial<Draft>){setRows(old=>old.map(p=>p.id===id?{...p,...changes}:p));setDirty(true);setError('');}
 function apply(){try{
  const numeric=(value:string,label:string)=>{if(!value.trim()||!Number.isFinite(Number(value)))throw new Error(t('{label} 必须是有限数字',{label}));return Number(value);};
  const parameters=validateRootParameters(rows.map(p=>({name:p.name,domain:p.domain,minRe:numeric(p.minRe,p.name+t(" 实部下限")),maxRe:numeric(p.maxRe,p.name+t(" 实部上限")),minIm:numeric(p.minIm,p.name+t(" 虚部下限")),maxIm:numeric(p.maxIm,p.name+t(" 虚部上限")),value:[numeric(p.real,p.name+t(" 固定实部")),numeric(p.imag,p.name+t(" 固定虚部"))]})),String(scene.settings.variable??'z'),Object.keys(scene.parameters));
  const renames=new Map(rows.filter(p=>p.originalName&&p.originalName!==p.name).map(p=>[p.originalName!,p.name]));
  onChange(updateRootParameters(scene,parameters,renames,rows.find(p=>p.id===display)?.name??''));setDirty(false);setError('');
 }catch(e){setError(e instanceof Error?e.message:String(e));}}
 function add(){let i=1;while(rows.some(p=>p.name==='t'+i)||Object.hasOwn(scene.parameters,'t'+i)||scene.settings.variable==='t'+i)i++;setRows([...rows,draft(defaultRootParameter('t'+i),false)]);setDirty(true);}
 const field=(row:Draft,key:'minRe'|'maxRe'|'minIm'|'maxIm'|'real'|'imag',label:string)=><label className="field" key={key}><span>{label}</span><input aria-label={`${row.name} ${label}`} type="number" step="any" value={row[key]} onChange={e=>patch(row.id,{[key]:e.target.value})}/></label>;
 return <details open className="inspector-section"><summary>{t("复根采样参数")}</summary><div className="section-body">
  <small className="muted">{t("各参数独立抽样。名称可用于多项式系数；改名后会同步替换系数变量。固定参数不消耗随机样本。")}</small>
  {problem&&<p className="export-error" role="alert">{t(problem)}</p>}
  {rows.map(row=><fieldset key={row.id} style={{minWidth:0,margin:'10px 0',padding:8,border:'1px solid var(--border)'}}><legend>{row.name||t("未命名参数")}</legend>
   <label className="field"><span>{t("名称")}</span><input aria-label={t("{0} 参数名称",{0:row.originalName??row.id})} value={row.name} onChange={e=>patch(row.id,{name:e.target.value})}/></label>
   <label className="field"><span>{t("采样域")}</span><select aria-label={t("{0} 采样域",{0:row.name})} value={row.domain} onChange={e=>patch(row.id,{domain:e.target.value as RootParameterDomain})}>{ROOT_PARAMETER_DOMAINS.map(d=><option value={d} key={d}>{t(labels[d])}</option>)}</select></label>
   {(row.domain==='REAL_RANGE'||row.domain==='COMPLEX_RECT')&&<>{field(row,'minRe',t("实部下限"))}{field(row,'maxRe',t("实部上限"))}</>}
   {row.domain==='COMPLEX_RECT'&&<>{field(row,'minIm',t("虚部下限"))}{field(row,'maxIm',t("虚部上限"))}</>}
   {row.domain==='FIXED'&&<>{field(row,'real',t("固定实部"))}{field(row,'imag',t("固定虚部"))}</>}
   {row.domain==='UNIT_CIRCLE'&&<p className="muted">{t("角度在 0–2π 均匀抽样，模长为 1。")}</p>}
   <button aria-label={t("删除参数 {0}",{0:row.name})} onClick={()=>{setRows(rows.filter(p=>p.id!==row.id));setDirty(true);}}><Trash2 size={13}/>{t("删除参数")}</button>
  </fieldset>)}
  <button disabled={rows.length>=MAX_ROOT_PARAMETERS||!!problem} onClick={add}><Plus size={14}/>{t("添加采样参数")}</button>
  <label className="field"><span>{t("颜色 / 深度参数")}</span><select aria-label={t("颜色 / 深度参数")} value={display} onChange={e=>{setDisplay(e.target.value);setDirty(true);}}>{!rows.some(p=>p.id===display)&&<option value={display}>{t("请选择参数")}</option>}{rows.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
  <small className="muted">{t("仅参数实部/虚部着色与深度模式使用此项。删除仍被公式使用的参数会提示错误。")}</small>
  <div className="explore-actions"><button className="apply-button" disabled={!dirty||!!problem} onClick={apply}>{t("应用采样参数")}</button><button disabled={!dirty||!source} onClick={restore}>{t("撤销参数编辑")}</button></div>
  {error&&<p className="export-error" role="alert">{t(error)}</p>}
 </div></details>;
}
