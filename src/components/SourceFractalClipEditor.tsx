import {sourceFractalFormulaIdentity} from '../engine/sourceFractalIdentity';
import {useState} from 'react';
import type {AnimationTrack,SceneDocument} from '../types';
import {Control} from './Fields';
import {useI18n} from '../i18n';
import {parseSourceFractalActionsPayload,type SourceFractalActionsPayload} from '../engine/sourceFractalDocument';
import type {SourceFractalAnimationTargets} from '../engine/sourceFractalSceneClock';
import type {SourceFractalParameterAction} from '../engine/sourceFractalParameterRuntime';
import type {SourceGradientConfiguration} from '../engine/sourceGradientRuntime';
import {SOURCE_FRACTAL_FORMULA_METADATA,createSourceFractalFormulaFromConfig} from '../engine/sourceFractalFormulaRuntime';
import {SOURCE_EASING_NAMES} from '../engine/sourceEasing';

type Props={track:AnimationTrack;onChange:(track:AnimationTrack)=>void;scene:SceneDocument};
const targetLabels:Record<keyof SourceFractalAnimationTargets,string>={center:'中心',zoom:'缩放',rotation:'旋转（弧度）',rotationRate:'旋转速度',ambientRates:'环境旋转速度',iterations:'最大迭代',bailout:'阈值',julia:'Julia 常数'};
const targetKeys=Object.keys(targetLabels) as (keyof SourceFractalAnimationTargets)[];
const defaultConfiguration=()=>({min:0,max:1,step:.1,edgeEasing:{window:.5,floor:.25,easing:'sine-out'}});
const defaultGradient=():SourceGradientConfiguration=>({mode:'offset_cycle',speed:30,interpolation:'linear',affectInside:true,affectOutside:true});
export function SourceFractalClipEditor({track,onChange,scene}:Props){
 const {t}=useI18n(),[error,setError]=useState(''),payload=track.fractalSource;
 if(track.type!=='animate'||!payload)return null;
 const emit=(next:SourceFractalActionsPayload)=>{const parsed=parseSourceFractalActionsPayload(next);if(!parsed.ok){setError(parsed.error.reason);return;}setError('');onChange({...track,fractalSource:parsed.value});};
 const number=(key:string,label:string,value:number,write:(n:number)=>void,min?:number,max?:number)=><Control key={key} spec={{key:`source-fractal-clip-${track.id}-${key}`,label,type:'number',group:'分形动画',min,max}} value={value} onChange={v=>{const n=Number(v);if(Number.isFinite(n))write(n);}}/>;
 const select=(key:string,label:string,value:string,options:readonly {value:string;label:string}[],write:(v:string)=>void)=><Control spec={{key:`source-fractal-clip-${track.id}-${key}`,label,type:'select',group:'分形动画',options:[...options]}} value={value} onChange={v=>write(String(v))}/>;
 const toggle=(label:string,checked:boolean,write:(v:boolean)=>void)=><label className="field toggle-field"><span>{t(label)}</span><input type="checkbox" aria-label={t(label)} checked={checked} onChange={e=>write(e.target.checked)}/></label>;
 const native=scene.fractalSource?createSourceFractalFormulaFromConfig(scene.fractalSource.formula).snapshot().native:undefined;
 const defaults:Required<SourceFractalAnimationTargets>={center:[Number(scene.settings.centerX??0),Number(scene.settings.centerY??0)],zoom:Number(scene.settings.zoom??1),rotation:Number(scene.settings.rotation??0),rotationRate:0,ambientRates:[0,0,0],iterations:Number(scene.settings.iterations??200),bailout:native?.bailout??4,julia:native?.julia??[0,0]};
 const writeTarget=(key:keyof SourceFractalAnimationTargets,value:number|readonly number[]|undefined)=>{const targets={...payload.targets};if(value===undefined)delete targets[key];else Object.assign(targets,{[key]:value});emit({...payload,targets});};
 const definitions=SOURCE_FRACTAL_FORMULA_METADATA[scene.fractalSource?sourceFractalFormulaIdentity(scene.fractalSource.formula):'']??[];
 const parameterNames=definitions.flatMap(d=>d.kind==='complex'?[d.name,`${d.name}_re`,`${d.name}_im`]:[d.name]);
 const writeAction=(index:number,action:SourceFractalParameterAction)=>emit({...payload,parameters:payload.parameters.map((p,i)=>i===index?action:p)});
 const reorder=(index:number,offset:number)=>{const next=[...payload.parameters],other=index+offset;if(other<0||other>=next.length)return;[next[index],next[other]]=[next[other],next[index]];emit({...payload,parameters:next});};
 const writeGradient=(patch:Partial<SourceGradientConfiguration>)=>{if(payload.gradient?.kind==='start')emit({...payload,gradient:{kind:'start',config:{...payload.gradient.config,...patch}}});};
 return <div className="source-fractal-clip-editor" data-testid="source-fractal-clip-editor">
  {error&&<p role="alert">{t(error)}</p>}
  <fieldset><legend>{t('普通动画目标')}</legend><p className="muted">{t('只启用需要改变的目标。每段从开始时的画面状态过渡。')}</p>
   {targetKeys.map(key=>{const value=payload.targets[key],label=t(targetLabels[key]);return <div key={key}>
    {toggle(t('改变{0}',{0:label}),value!==undefined,enabled=>writeTarget(key,enabled?defaults[key]:undefined))}
    {value!==undefined&&(Array.isArray(value)?value.map((v,i)=>number(`${key}-${i}`,`${label} · ${key==='ambientRates'?['φ','θ','γ'][i]:i===0?'X':'Y'}`,v,n=>{const next=[...value];next[i]=n;writeTarget(key,next);})):number(key,label,value as number,n=>writeTarget(key,n)))}
   </div>;})}
  </fieldset>
  <fieldset><legend>{t('参数启停（按顺序执行）')}</legend>
   <datalist id={`fractal-parameter-names-${track.id}`}>{parameterNames.map(name=><option key={name} value={name}/>)}</datalist>
   {payload.parameters.map((action,index)=>{const prefix=t('参数动作 {number}',{number:index+1}),scope=action.scope,configuration=action.kind==='start'?action.configuration:undefined;
    const switchAction=(kind:'start'|'stop',nextScope=scope)=>writeAction(index,kind==='stop'?{kind,scope:nextScope}:{kind,scope:nextScope,...(nextScope.kind==='named'?{configuration:configuration??defaultConfiguration()}:{})});
    const config=(patch:Partial<NonNullable<typeof configuration>>)=>{if(action.kind==='start'&&configuration)writeAction(index,{...action,configuration:{...configuration,...patch}});};
    return <fieldset key={index}><legend>{prefix}</legend>
     {select(`${index}-kind`,`${prefix} · ${t('操作')}`,action.kind,[{value:'start',label:'开始'},{value:'stop',label:'停止'}],v=>switchAction(v as 'start'|'stop'))}
     {select(`${index}-scope`,`${prefix} · ${t('范围')}`,scope.kind,[{value:'named',label:'指定参数'},{value:'all',label:'全部已配置参数'}],v=>switchAction(action.kind,v==='all'?{kind:'all'}:{kind:'named',name:parameterNames[0]??'exponent'}))}
     {scope.kind==='named'&&<label className="field"><span>{t('参数名称')}</span><input aria-label={`${prefix} · ${t('参数名称')}`} list={`fractal-parameter-names-${track.id}`} value={scope.name} onChange={e=>switchAction(action.kind,{kind:'named',name:e.target.value})}/></label>}
     {configuration&&<>
      {(['min','max','step'] as const).map((key,i)=>number(`${index}-${key}`,`${prefix} · ${t(['最小值','最大值','步进'][i])}`,configuration[key],n=>config({[key]:n})))}
      {toggle(`${prefix} · ${t('自定义端点缓动')}`,configuration.edgeEasing!==undefined,enabled=>{const next={...configuration};if(enabled)next.edgeEasing=defaultConfiguration().edgeEasing;else delete next.edgeEasing;writeAction(index,{kind:'start',scope:action.scope,configuration:next});})}
      {configuration.edgeEasing&&<>
       {number(`${index}-window`,`${prefix} · ${t('端点窗口')}`,configuration.edgeEasing.window,n=>config({edgeEasing:{...configuration.edgeEasing!,window:n}}),0)}
       {number(`${index}-floor`,`${prefix} · ${t('端点速度下限')}`,configuration.edgeEasing.floor,n=>config({edgeEasing:{...configuration.edgeEasing!,floor:n}}),0,1)}
       {select(`${index}-edge`,`${prefix} · ${t('端点缓动')}`,configuration.edgeEasing.easing,SOURCE_EASING_NAMES.map(value=>({value,label:value})),v=>config({edgeEasing:{...configuration.edgeEasing!,easing:v}}))}
      </>}
     </>}
     <div className="button-row"><button disabled={index===0} aria-label={`${prefix} · ${t('上移')}`} onClick={()=>reorder(index,-1)}>{t('上移')}</button><button disabled={index===payload.parameters.length-1} aria-label={`${prefix} · ${t('下移')}`} onClick={()=>reorder(index,1)}>{t('下移')}</button><button aria-label={`${prefix} · ${t('删除')}`} onClick={()=>emit({...payload,parameters:payload.parameters.filter((_,i)=>i!==index)})}>{t('删除')}</button></div>
    </fieldset>;
   })}
   <button onClick={()=>emit({...payload,parameters:[...payload.parameters,{kind:'start',scope:{kind:'named',name:parameterNames[0]??'exponent'},configuration:defaultConfiguration()}]})}>{t('添加参数动作')}</button>
  </fieldset>
  <fieldset><legend>{t('渐变动画')}</legend>
   {select('gradient-kind','渐变操作',payload.gradient?.kind??'none',[{value:'none',label:'不改变'},{value:'start',label:'开始'},{value:'stop',label:'停止'}],v=>{const next={...payload};if(v==='none')delete next.gradient;else next.gradient=v==='stop'?{kind:'stop'}:{kind:'start',config:payload.gradient?.kind==='start'?payload.gradient.config:defaultGradient()};emit(next);})}
   {payload.gradient?.kind==='start'&&<>
    {select('gradient-mode','渐变模式',payload.gradient.config.mode,[{value:'offset_cycle',label:'偏移循环'},{value:'hue_rotate',label:'色相旋转'},{value:'palette_morph',label:'色板变形'},{value:'cross_fade',label:'交叉淡化'}],v=>writeGradient({mode:v as SourceGradientConfiguration['mode']}))}
    {number('gradient-speed','渐变速度',payload.gradient.config.speed,n=>writeGradient({speed:n}))}
    {select('gradient-space','渐变插值',payload.gradient.config.interpolation,['rgb','linear','oklab','oklch'].map(value=>({value,label:value})),v=>writeGradient({interpolation:v as SourceGradientConfiguration['interpolation']}))}
    {toggle('影响内部',payload.gradient.config.affectInside??true,v=>writeGradient({affectInside:v}))}
    {toggle('影响外部',payload.gradient.config.affectOutside??true,v=>writeGradient({affectOutside:v}))}
   </>}
  </fieldset>
 </div>;
}
