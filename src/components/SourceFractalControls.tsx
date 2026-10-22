import {sourceFractalFormulaIdentity} from '../engine/sourceFractalIdentity';
import {useState} from 'react';
import type {SceneDocument} from '../types';
import {Control} from './Fields';
import {FractalSourceColorControls} from './FractalSourceColorControls';
import {useI18n} from '../i18n';
import {parseSourceFractalDocument} from '../engine/sourceFractalDocument';
import {SOURCE_FRACTAL_FORMULA_METADATA,bindSourceFractalFormulaParameters,type SourceFractalFormulaConfiguration,type SourceFractalFormulaParamSet} from '../engine/sourceFractalFormulaRuntime';

type Props={scene:SceneDocument;onChange:(scene:SceneDocument,intent?:'hot'|'apply'|'stage')=>void;section?:'formula'|'color'|'all'};
const names:Record<string,string>={power:'幂次',exponent:'指数',bailout:'退出阈值',relaxation:'松弛系数',start_value:'初始复数',julia_seed:'Julia 常数'};
export function SourceFractalControls({scene,onChange,section='all'}:Props){
 const {t}=useI18n(),[error,setError]=useState(''),source=scene.fractalSource;
 if(!source)return null;
 const change=(next:SceneDocument,intent:'hot'|'apply'|'stage'='hot')=>onChange(next,intent);
 const formula=source.formula,id=sourceFractalFormulaIdentity(formula),definitions=SOURCE_FRACTAL_FORMULA_METADATA[id]??[],parameters=formula.parameters;
 const emit=(next:SourceFractalFormulaConfiguration)=>{const parsed=parseSourceFractalDocument({...source,formula:next});if(!parsed.ok){setError(parsed.error.reason);return;}setError('');change({...scene,fractalSource:parsed.value});};
 const defaults=(formulaId=id)=>{const bound=bindSourceFractalFormulaParameters(formulaId,{});if(!bound.ok){setError(bound.error.reason);return;}return bound.value.parameters;};
 const number=(key:string,label:string,value:number,write:(value:number)=>void,min?:number,max?:number,step?:number)=><Control key={key} spec={{key:`fractal-source-${key}`,label,type:'number',group:'原版分形',min,max,step}} value={value} onChange={v=>{const n=Number(v);if(Number.isFinite(n))write(n);}}/>;
 const writeParameters=(next:SourceFractalFormulaParamSet)=>emit({...formula,parameters:next});
 const precision=String(scene.settings.perturbationPrecision??'high'),precisionOptions=[{value:'low',label:'低'},{value:'medium',label:'中'},{value:'high',label:'高'},{value:'ultra',label:'ULTRA（源阈值与中相同）'}];
 if(!precisionOptions.some(option=>option.value===precision))precisionOptions.push({value:precision,label:precision||'空值（保留）'});
 return <div data-testid="source-fractal-controls">
  {section!=='color'&&<>
   <details open className="inspector-section"><summary>{t('原版分形公式')}</summary><div className="section-body">
    {error&&<p role="alert">{t(error)}</p>}
    <label className="field"><span>{t('原版公式')}</span><select aria-label={t('原版公式')} value={id} onChange={e=>{const next=e.target.value;if(next===id)return;if(parameters===undefined)emit({...formula,formulaId:next});else{const bound=defaults(next);if(bound)emit({...formula,formulaId:next,parameters:bound});}}}>{!['newton','nova','mandelbrot','julia'].includes(id)&&<option value={id}>{id||t('未指定')}</option>}<option value="mandelbrot">Mandelbrot</option><option value="julia">Julia</option><option value="newton">Newton</option><option value="nova">Nova</option></select></label>
    <p className="muted">{t('切换公式会将已启用的公式参数恢复为该公式默认值。动画片段保留，可继续检查参数名称。')}</p>
    <label className="field"><span>{t('分形变体')}</span><select aria-label={t('分形变体')} value={formula.fractalType} onChange={e=>emit({...formula,fractalType:e.target.value as 'mandelbrot'|'julia'})}><option value="mandelbrot">{t('参数平面')}</option><option value="julia">Julia</option></select></label>
    {id==='newton'&&<p className="muted">{t('Newton 使用参数平面；保留的 Julia 变体不参与画面计算。')}</p>}
    <label className="field toggle-field"><span>{t('启用公式参数集')}</span><input type="checkbox" aria-label={t('启用公式参数集')} checked={parameters!==undefined} onChange={e=>{if(e.target.checked){const bound=defaults();if(bound)writeParameters(bound);}else{const next={...formula};delete next.parameters;emit(next);}}}/></label>
    {parameters===undefined?<p className="muted">{t('当前保留原文件未提供参数集的状态。启用后填入公式默认参数。')}</p>:<>
     <div className="button-row"><button onClick={()=>writeParameters({floats:{},complex:{}})}>{t('保留空参数集')}</button><button onClick={()=>{const bound=defaults();if(bound)writeParameters(bound);}}>{t('填入公式默认参数')}</button></div>
     {definitions.map(d=>{const label=t(names[d.name]??d.name),present=Object.hasOwn(d.kind==='float'?parameters.floats:parameters.complex,d.name),value=d.kind==='float'?parameters.floats[d.name]:parameters.complex[d.name];return <fieldset key={d.name}><legend>{label} <small>{d.name}</small></legend>
      <label className="field toggle-field"><span>{t('设置 {name}',{name:label})}</span><input type="checkbox" aria-label={t('设置 {name}',{name:label})} checked={present} onChange={e=>{const floats={...parameters.floats},complex={...parameters.complex};if(d.kind==='float'){if(e.target.checked)floats[d.name]=d.defaultValue as number;else delete floats[d.name];}else{if(e.target.checked)complex[d.name]=[...(d.defaultValue as readonly[number,number])];else delete complex[d.name];}writeParameters({floats,complex});}}/></label>
      {present&&(d.kind==='float'?number(d.name,label,value as number,n=>writeParameters({...parameters,floats:{...parameters.floats,[d.name]:Math.fround(Math.max(d.min??-Infinity,Math.min(d.max??Infinity,n)))}}),d.min,d.max):([0,1] as const).map(i=>number(`${d.name}-${i}`,`${label} · ${t(i===0?'实部':'虚部')}`,(value as readonly[number,number])[i],n=>{const pair:[number,number]=[...(value as readonly[number,number])];pair[i]=n;writeParameters({...parameters,complex:{...parameters.complex,[d.name]:pair}});})))}
     </fieldset>;})}
    </>}
    <details open={parameters===undefined}><summary>{t('原文件传统参数')}</summary>
     <p className="muted">{t('保留原文件的初始参数。启用公式参数集后，对应数值由公式参数决定。')}</p>
     {number('legacy-power','传统幂次',formula.power,n=>emit({...formula,power:Math.trunc(n)}),2,undefined,1)}
     {number('legacy-bailout','传统阈值',formula.bailout,n=>emit({...formula,bailout:n}))}
     {([0,1] as const).map(i=>number(`legacy-julia-${i}`,t(i===0?'传统 Julia 实部':'传统 Julia 虚部'),formula.julia[i],n=>{const pair:[number,number]=[...formula.julia];pair[i]=n;emit({...formula,julia:pair});}))}
     {formula.formulaParams.map((value,i)=>number(`legacy-param-${i}`,t('传统参数 {number}',{number:i+1}),value,n=>{const values:[number,number,number,number]=[...formula.formulaParams];values[i]=n;emit({...formula,formulaParams:values});}))}
    </details>
   </div></details>
   <details open className="inspector-section"><summary>{t('分形视口与计算')}</summary><div className="section-body">
    {([['centerX','中心 X',0],['centerY','中心 Y',0],['centerXLow','中心 X 低位',0],['centerYLow','中心 Y 低位',0],['zoom','缩放',1],['rotation','旋转（弧度）',0],['iterations','最大迭代',200]] as const).map(([key,label,fallback])=>number(key,label,Number(scene.settings[key]??fallback),n=>change({...scene,settings:{...scene.settings,[key]:key==='iterations'?Math.max(1,Math.trunc(n)):n}}),key==='zoom'?1e-6:key==='iterations'?1:undefined,key==='zoom'?1e28:undefined,key==='iterations'?1:undefined))}
    <Control spec={{key:'fractal-source-backend',label:'计算后端',type:'select',group:'计算',options:[{value:'auto',label:'自动'},{value:'webgl2',label:'WebGL2'},{value:'cpu',label:'CPU'}]}} value={String(scene.settings.fractalBackend??'auto')} onChange={v=>change({...scene,settings:{...scene.settings,fractalBackend:v}},'apply')}/>
    {scene.settings.fractalBackend==='cpu'&&<p role="alert">{t(id==='newton'||id==='nova'?'当前选择 CPU；源 Newton/Nova 需要 WebGL2。请选择自动或 WebGL2 后端，或切回本地数值规则。':'当前选择 CPU；源分形需要 WebGL2。请选择自动或 WebGL2 后端，或切回本地数值规则。')}</p>}
    <Control spec={{key:'fractal-source-render-method',label:'渲染方法',type:'select',group:'计算',options:[{value:'multi-pass',label:'多遍渲染'},{value:'one-pass',label:'单遍渲染'},{value:'guessing',label:'猜测填充'}]}} value={String(scene.settings.renderMethod??'multi-pass')} onChange={v=>change({...scene,settings:{...scene.settings,renderMethod:v}},'stage')}/>
    <Control spec={{key:'fractal-source-precision',label:'扰动精度',type:'select',group:'计算',options:precisionOptions}} value={precision} onChange={v=>change({...scene,settings:{...scene.settings,perturbationPrecision:v}},'stage')}/>
    <p className="muted">{t('原版分形使用 WebGL2。动画按队列执行，前一片段结束后下一帧开始后续片段。')}</p>
   </div></details>
  </>}
  {section!=='formula'&&<FractalSourceColorControls scene={scene} onChange={next=>change(next,'apply')} onStage={next=>change(next,'stage')}/>}
 </div>;
}
