import {useI18n} from '../i18n';
import {Plus,Trash2} from 'lucide-react';
import type {SceneDocument,FormulaStyle,FormulaLabel} from '../types';
import {defaultFormulas} from '../engine/formulas';
export function FormulaEditor({scene,onChange}:{scene:SceneDocument;onChange:(next:SceneDocument)=>void}){
  const {t}=useI18n();
  const config=scene.formulas??defaultFormulas();
  function main(patch:Partial<FormulaStyle>&{latex?:string}){onChange({...scene,formulas:{...config,main:{...config.main,...patch}}});}
  function label(id:string,patch:Partial<FormulaLabel>){onChange({...scene,formulas:{...config,additional:config.additional.map(l=>l.id===id?{...l,...patch}:l)}});}
  function style(value:FormulaStyle,prefix:string,change:(patch:Partial<FormulaStyle>)=>void){return <>
    <label className="field"><span>{t("显示")}</span><input type="checkbox" aria-label={t("{0}显示",{0:prefix})} checked={value.visible} onChange={e=>change({visible:e.target.checked})}/></label>
    {(['x','y','scale'] as const).map((key,i)=><label className="field" key={key}><span>{[t("水平位置"),t("垂直位置"),t("缩放")][i]}</span><input type="number" aria-label={`${prefix} ${[t("水平位置"),t("垂直位置"),t("缩放")][i]}`} min={key==='scale'?.05:-32768} max={key==='scale'?20:32768} step={key==='scale'?.05:1} value={value[key]} onChange={e=>{if(e.target.value&&Number.isFinite(Number(e.target.value)))change({[key]:Number(e.target.value)});}}/></label>)}
    <label className="field"><span>{t("公式颜色")}</span><input type="color" aria-label={t("{0}颜色",{0:prefix})} value={value.color} onChange={e=>change({color:e.target.value})}/></label>
    <label className="field"><span>{t("位置锚点")}</span><select aria-label={t("{0}位置锚点",{0:prefix})} value={value.anchor??'top-left'} onChange={e=>change({anchor:e.target.value as FormulaStyle['anchor']})}><option value="top-left">{t("左上角")}</option><option value="center">{t("居中")}</option></select></label>
  </>;}
  return <details className="inspector-section"><summary>{t("公式标注")}</summary><div className="section-body">
    <p className="muted">{t("位置按 {width} × {height} 参考画布设置，预览与导出等比例排版。",{width:config.referenceWidth,height:config.referenceHeight})}</p>
    <strong>{t("主方程")}</strong>{style(config.main,t("主方程"),main)}
    <label className="equation-field"><span>{t("主方程 LaTeX · 留空时自动生成")}</span><textarea aria-label={t("主方程 LaTeX")} spellCheck={false} value={config.main.latex??''} onChange={e=>main({latex:e.target.value})}/></label>
    {config.additional.map((l,index)=><details className="formula-item" key={l.id} open><summary>{t("附加公式 {0}",{0:index+1})}<button title={t("删除附加公式 {0}",{0:index+1})} onClick={e=>{e.preventDefault();onChange({...scene,formulas:{...config,additional:config.additional.filter(x=>x.id!==l.id)}});}}><Trash2 size={12}/></button></summary><label className="equation-field"><span>LaTeX</span><textarea aria-label={t("附加公式 {0} LaTeX",{0:index+1})} spellCheck={false} value={l.latex} onChange={e=>label(l.id,{latex:e.target.value})}/></label>{style(l,t("附加公式 {0}",{0:index+1}),patch=>label(l.id,patch))}</details>)}
    <button className="apply-button" disabled={config.additional.length>=32} onClick={()=>onChange({...scene,formulas:{...config,additional:[...config.additional,{id:crypto.randomUUID(),latex:'e^{i\\pi}+1=0',visible:true,x:32,y:220+config.additional.length*60,scale:1,color:'#ffffff'}]}})}><Plus size={14}/>{t("添加公式")}</button>
  </div></details>;
}
