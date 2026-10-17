import type {SceneDocument} from '../types';
import {symmetryFormula} from '../scenes/symmetryFormula';
import {useI18n} from '../i18n';
import {hasSymmetryCustom,prepareSymmetryCustomSource,symmetryCustomCompileDegree} from '../engine/symmetryCustom';
import {withSymmetryTemplate,symmetryTemplateSelectionError} from '../engine/symmetryEditing';

export function SymmetryFormula({scene,onChange}:{scene:SceneDocument;onChange?:(next:SceneDocument)=>void}){
 const {t}=useI18n();
 if(scene.kind!=='symmetry')return null;
 if(hasSymmetryCustom(scene)){
  const templateError=symmetryTemplateSelectionError(scene);
  let bindings:readonly string[]|undefined,error:string|undefined;
  try{bindings=prepareSymmetryCustomSource(scene.equations.glsl,symmetryCustomCompileDegree(scene)).bindingNames;}catch(e){error=e instanceof Error?e.message:String(e);}
  return <details open className="inspector-section symmetry-formula"><summary>{t('自定义 GLSL 方程')}</summary><div className="section-body">
   {scene.equations.formula&&<p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{scene.equations.formula}</p>}
   <pre aria-label={t('自定义 GLSL 源码')} style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',fontSize:'inherit'}}>{scene.equations.glsl}</pre>
   <p className="muted">{t('参数按声明的 float uniform 传入；缺失值为 0。源码与说明文字会随项目保存。')}</p>
   {bindings&&<p className="muted">{t('匹配到的参数：{names}',{names:bindings.length?bindings.join(', '):t('无')})}</p>}
   {bindings&&<p className="muted">{t('匹配列表不代表每个参数都影响结果；未被公式使用的参数仍会保留。')}</p>}
   {error&&<p role="alert" className="export-error">{t(error)}</p>}
   <p className="muted">{t('自定义公式需要 GPU。切换模板会停用当前源码，保留已有参数；可撤销恢复。')}</p>
   {onChange&&<button disabled={!!templateError} onClick={()=>onChange(withSymmetryTemplate(scene,scene.settings.template==='modified'?'modified':'standard'))}>{t('使用模板公式')}</button>}
   {templateError&&<p role="status" className="muted">{t(templateError)}</p>}
  </div></details>;
 }
 const tokens=symmetryFormula(scene.settings),keys=[...new Set(tokens.flatMap(v=>v.key?[v.key]:[]))];
 // Fixed owner-generated keys only; user formula text is never a CSS selector.
 const style=keys.map(key=>{
  const token=tokens.find(v=>v.key===key)!;
  return `.inspector-scroll:has([data-symmetry-key="${key}"]:hover) #${token.target},.inspector-scroll:has([data-symmetry-key="${key}"]:focus-visible) #${token.target}{outline:2px solid var(--accent,#65dec9);outline-offset:2px}.inspector-scroll:has(#${token.target}:focus) [data-symmetry-key="${key}"]{background:#244e47;color:#c7fff0}`;
 }).join('');
 return <details open className="inspector-section symmetry-formula"><summary>{t('只读方程')}</summary><div className="section-body">
  <style>{style}</style>
  <div className="symmetry-equation" aria-label={t('只读方程')}>{tokens.map((token,i)=>token.key?<button type="button" key={i} data-symmetry-key={token.key} title={t('定位参数 {value0}',{value0:token.key})} onClick={()=>{const field=document.getElementById(token.target!);field?.closest('details')?.setAttribute('open','');field?.focus();field?.scrollIntoView({block:'nearest'});}}>{token.text}</button>:<span key={i}>{token.text}</span>)}</div>
  <p className="muted">{t('悬停高亮对应参数；点击变量可跳到输入框。')}</p>
 </div></details>;
}
