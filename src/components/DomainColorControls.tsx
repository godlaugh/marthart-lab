import {useState} from 'react';
import {useI18n} from '../i18n';
import type {SceneDocument,RasterOutput} from '../types';
import {withDomainColorVersion,withDomainIterationVersion,withDomainViewportVersion,withDomainRenderPolicy} from '../engine/domainAuthoring';
import {parseDomainRenderPolicy} from '../engine/domainRenderPolicy';
import {parseDomainIterationVersion} from '../engine/domainSourceIteration';
import {parseDomainModel} from '../engine/domainModel';
import {parseDomainViewportVersion} from '../engine/domainViewport';
import {DEFAULT_DOMAIN_SOURCE_COLORS,domainSourceColorRgbHex,parseDomainColorVersion,parseDomainSourcePalette,withDomainSourceColorRgb} from '../engine/domainSourceColor';
import {PALETTES} from '../engine/palette';

type Props={scene:SceneDocument;onChange:(next:SceneDocument)=>void};
type RenderFacts=NonNullable<RasterOutput['domainRender']>;
export function DomainRenderSummary({facts,time}:{facts:RenderFacts;time?:number}){
 const {t}=useI18n();
 const label=(value:string)=>value==='local-v1'?t('本地原有规则'):value==='mathart-1.7.8'?t('旧兼容规则'):value==='mathart-1.7.8-cpu'?'MathArt 1.7.8 CPU':'MathArt 1.7.8 GPU';
 return <div role="status" data-testid="domain-render-summary">
  <p>{t('实际完成画面：{backend} · 公式 {formula} · 视口 {viewport} · 着色 {color}',{backend:facts.effective.backend==='webgl2'?'GPU':'CPU',formula:label(facts.effective.formula),viewport:label(facts.effective.viewport),color:label(facts.effective.color)})}{time!==undefined&&` · ${time.toFixed(3)} s`}</p>
  {facts.route==='source-cpu-failure'&&<p>{t('GPU 故障后整幅图使用原产物 CPU 规则；保存的三项选择未改变。')}</p>}
  {facts.route==='source-cpu-forced'&&<p>{t('已固定使用 CPU 整链；保存的三项规则暂未使用，可随时恢复。')}</p>}
  {facts.trigger&&<details><summary>{t('GPU 故障详情')}</summary><p>{facts.trigger.stage}: {t(facts.trigger.reason)}</p></details>}
  {facts.sticky&&<p>{t('当前计算会话保持 CPU 回退；普通编辑不会重新尝试 GPU。')}</p>}
 </div>;
}
export function DomainColorControls({scene,onChange,renderFacts,renderTime,onRetry,retryDisabled}:{scene:SceneDocument;onChange:Props['onChange'];renderFacts?:RenderFacts;renderTime?:number;onRetry?:()=>void;retryDisabled?:boolean}){
 const {t}=useI18n();if(scene.kind!=='domain')return null;
 const version=parseDomainColorVersion(scene.settings.domainColorVersion),iterationVersion=parseDomainIterationVersion(scene.settings.domainIterationVersion),viewportVersion=parseDomainViewportVersion(scene.settings.domainViewportVersion);
 const nativeExecution=iterationVersion==='mathart-1.7.8-cpu'||iterationVersion==='mathart-1.7.8-gpu';
 const policy=parseDomainRenderPolicy(scene.settings.domainRenderPolicy);
 let constantText='',constantError='';if(renderFacts||nativeExecution)try{const constant=renderFacts?.constant??parseDomainModel(scene,0).constant;constantText=t('有效常量 c：{real} + ({imag})i',{real:String(constant[0]),imag:String(constant[1])});}catch(error){constantError=error instanceof Error?error.message:String(error);}
 return <details open className="inspector-section"><summary>{t('Domain 着色规则')}</summary><div className="section-body">
  <label className="field"><span>{t('渲染恢复规则')}</span><select aria-label={t('渲染恢复规则')} value={policy} onChange={e=>onChange(withDomainRenderPolicy(scene,e.target.value))}><option value="selected-rules-1723">{t('保持所选规则 · 旧作品兼容')}</option><option value="source-cpu-on-gpu-failure-v1">{t('GPU 故障后使用 CPU 整链')}</option><option value="source-cpu-always-v1">{t('固定使用 CPU 整链')}</option></select></label>
  <p className="muted">{t('恢复策略保留公式、视口和着色选择。CPU 整链使用原产物 CPU 三项规则；显式选择 CPU 后端不会触发故障回退。')}</p>
  {renderFacts?<DomainRenderSummary facts={renderFacts} time={renderTime}/>:<p className="muted">{t('等待与当前作品匹配的已呈现画面；下方规则仍为保存的作者选择。')}</p>}
  <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
   {onRetry&&<button disabled={retryDisabled} onClick={onRetry}>{t(policy==='source-cpu-always-v1'?'恢复 GPU 并重试':'重试 GPU')}</button>}
   {policy!=='source-cpu-always-v1'&&<button onClick={()=>onChange(withDomainRenderPolicy(scene,'source-cpu-always-v1'))}>{t('固定使用 CPU 整链')}</button>}
   {policy!=='selected-rules-1723'&&<button onClick={()=>onChange(withDomainRenderPolicy(scene,'selected-rules-1723'))}>{t('恢复所选规则')}</button>}
  </div>
  {policy!=='selected-rules-1723'&&<details><summary>{t('CPU 回退色板')}</summary><p className="muted">{t('CPU 整链使用此原产物色板的全部颜色；未保存时使用六色默认。编辑不会覆盖本地色板，也不会改变着色选择。')}</p><DomainSourcePaletteEditor scene={scene} onChange={onChange} usage="cpu-fallback"/></details>}
  <label className="field"><span>{t('着色版本')}</span><select aria-label={t('着色版本')} value={version} onChange={e=>onChange(withDomainColorVersion(scene,e.target.value))}>
   <option value="local-v1">{t('本地 · 原有颜色')}</option><option value="mathart-1.7.8-gpu">{t('MathArt 1.7.8 · GPU 着色')}</option><option value="mathart-1.7.8-cpu">{t('MathArt 1.7.8 · CPU 着色')}</option>
  </select></label>
  <p className="muted">{t('着色规则与计算后端分别选择。切换版本会保留各自的色板。')}</p>
  <label className="field"><span>{t('公式执行规则')}</span><select aria-label={t('公式执行规则')} value={iterationVersion} onChange={e=>onChange(withDomainIterationVersion(scene,e.target.value))}><option value="local-v1">{t('本地 · 原有迭代')}</option><option value="mathart-1.7.8">{t('MathArt 1.7.8 · 旧兼容迭代')}</option><option value="mathart-1.7.8-cpu">{t('MathArt 1.7.8 · CPU 公式')}</option><option value="mathart-1.7.8-gpu">{t('MathArt 1.7.8 · GPU 公式')}</option></select></label>
  {(iterationVersion==='mathart-1.7.8'||iterationVersion==='mathart-1.7.8-cpu')&&<p className="muted">{t('单步也会应用初始种子和迭代公式；留空迭代公式时使用 f(z)。')}</p>}
  {iterationVersion==='mathart-1.7.8-gpu'&&<p className="muted">{t('GPU 公式单步应用初始种子；关闭迭代时忽略 next，开启时使用非空 next。')}</p>}
  {(iterationVersion==='mathart-1.7.8-cpu'||iterationVersion==='mathart-1.7.8-gpu')&&<><p className="muted">{t('原产物公式规则使用独立解析与算术。语法错误保留原文，主公式回退到 z^3 - 1，next 回退到主公式。')}</p><p className="muted">{t(policy==='selected-rules-1723'?'GPU 主公式引用 w 时采用源 CPU 公式回退；颜色和视口规则保持所选版本。':'GPU 主公式引用 w 等源程序故障按恢复策略处理；实际采用的三项规则见完成画面说明。')}</p></>}
  {(nativeExecution||renderFacts)&&<><p className="muted" data-testid="domain-effective-constant">{constantText||t(constantError)}</p><p className="muted">{t(renderFacts?'此常量来自实际完成画面。':'此常量仅按作者规则预计算，尚非完成画面的执行结果。')}</p><p className="muted">{t('常量基值在导入时从 a/b 捕获；参数动画不改常量。主公式文字可能覆盖 c，显式常量控件保留为本地扩展。')}</p>{iterationVersion==='mathart-1.7.8-gpu'&&<p className="muted">{t('源 GPU 仅在主公式或启用的 next 引用 c 时上传常量，否则新程序的有效常量为零。')}</p>}</>}
  <label className="field"><span>{t('视口坐标规则')}</span><select aria-label={t('视口坐标规则')} value={viewportVersion} onChange={e=>onChange(withDomainViewportVersion(scene,e.target.value))}><option value="local-v1">{t('本地 · 原有视口')}</option><option value="mathart-1.7.8-cpu">{t('MathArt 1.7.8 · CPU 视口')}</option><option value="mathart-1.7.8-gpu">{t('MathArt 1.7.8 · GPU 视口')}</option></select></label>
  <p className="muted">{t('切换视口规则会保留中心、缩放和角度数值；画面范围与纵轴方向可能改变。')}</p>
  {viewportVersion!=='local-v1'&&<p className="muted">{t('源视口的虚轴向下，正角度让图案逆时针旋转；缩放越大，显示范围越小。')}</p>}
  {viewportVersion!=='local-v1'&&<p className="muted">{t('旋转动作从现有转速按片段缓动过渡到目标转速；跳转采用确定性积分。')}</p>}
 </div></details>;
}

/** Source palettes intentionally have no positioned/analytic local-palette
 * controls. An edit writes the single source array that every renderer consumes. */
export function DomainSourcePaletteEditor({scene,onChange,usage}:Props&{usage?:'cpu-fallback'}){
 const {t}=useI18n(),[selected,setSelected]=useState(0),[error,setError]=useState('');
 const colors=scene.domainSourcePalette?.colors??DEFAULT_DOMAIN_SOURCE_COLORS,index=Math.min(selected,Math.max(0,colors.length-1)),current=colors[index];
 const emit=(next:readonly string[])=>{try{onChange({...scene,domainSourcePalette:parseDomainSourcePalette({colors:[...next]})});setError('');}catch(e){setError(e instanceof Error?e.message:String(e));}};
 const version=usage==='cpu-fallback'?'mathart-1.7.8-cpu':parseDomainColorVersion(scene.settings.domainColorVersion);
 const preview=colors.length?`linear-gradient(90deg,${(colors.length===1?[colors[0],colors[0]]:colors).slice(0,16).map(domainSourceColorRgbHex).join(',')})`:'#000000';
 return <div style={{display:'grid',gap:10}}>
  <p className="muted">{t(version==='mathart-1.7.8-gpu'?'GPU 着色使用前 16 色；渐变运行时按所选插值补色。':'CPU 着色使用完整色板；渐变运行时循环插值。')}</p>
  <div role="img" aria-label={t('前 16 个颜色预览')} style={{height:25,borderRadius:5,background:preview,border:'1px solid var(--border)'}}/>
  <label className="field"><span>{t('色板预设')}</span><select aria-label={t('源色板预设')} value="" onChange={e=>{const p=PALETTES[Number(e.target.value)];if(p){emit(p.stops);setSelected(0);}}}><option value="" disabled>{t('选择预设…')}</option>{PALETTES.map((p,i)=><option key={p.name} value={i}>{t(p.name)}</option>)}</select></label>
  <p className="muted">{t('已保存 {count} 个颜色',{count:colors.length})}</p>
  {current!==undefined?<>
   <label className="field"><span>{t('选择颜色')}</span><input aria-label={t('源颜色序号')} type="number" min={1} max={colors.length} step={1} value={index+1} onChange={e=>{const n=Number(e.target.value);if(Number.isInteger(n)&&n>=1&&n<=colors.length)setSelected(n-1);}}/></label>
   <div style={{display:'flex',gap:8,alignItems:'center'}}><input aria-label={t('源颜色')} type="color" value={domainSourceColorRgbHex(current)} onChange={e=>emit(colors.map((c,i)=>i===index?withDomainSourceColorRgb(c,e.target.value):c))}/><code style={{overflowWrap:'anywhere'}}>{current}</code><button onClick={()=>{emit(colors.filter((_,i)=>i!==index));setSelected(Math.max(0,index-1));}}>{t('删除颜色')}</button></div>
  </>:<p className="muted">{t('空色板以黑色为基色；亮度偏置仍会应用。')}</p>}
  <div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button onClick={()=>{emit([...colors,current??'#ffffff']);setSelected(colors.length);}}>{t('添加颜色')}</button><button onClick={()=>{emit([...colors].reverse());setSelected(0);}} disabled={colors.length<2}>{t('反转')}</button><button onClick={()=>{emit(DEFAULT_DOMAIN_SOURCE_COLORS);setSelected(0);}}>{t('恢复六色默认')}</button></div>
  {error&&<p role="alert" className="export-error">{t(error)}</p>}
 </div>;
}
