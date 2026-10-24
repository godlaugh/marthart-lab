import {useState} from 'react';
import {useI18n} from '../i18n';
import type {RasterOutput,SceneDocument} from '../types';
import {Control} from './Fields';
import {SourceGradientPaletteEditor} from './SourceGradientPaletteEditor';
import {copyRootsManualColors,withRootsDensityColorVersion} from '../engine/rootsControls';
import {DEFAULT_ROOTS_SOURCE_COLORS,ROOTS_SOURCE_TONE_FIELDS,parseRootsDensityColorVersion,parseRootsSourcePalette,rootsSourceColorRgbHex,usesRootsSourceDensity,withRootsSourceColorRgb} from '../engine/rootsDensityColor';

import {usesRootsNativePresentation} from '../engine/rootsPresentationAuthoring';
import {usesRootsCameraTimeline,usesRootsGradientTimeline} from '../engine/rootsCameraTimeline';
type Props={scene:SceneDocument;onChange:(scene:SceneDocument)=>void};
export function RootsDensityColorControls({scene,onChange,facts}:Props&{facts?:RasterOutput['rootsColor']}){
 const {t}=useI18n();if(scene.kind!=='roots')return null;
 const version=parseRootsDensityColorVersion(scene.settings.rootDensityColorVersion),active=usesRootsSourceDensity(scene.settings);
 const pointCloud=usesRootsNativePresentation(scene)&&scene.rootsPresentation?.mode==='point-cloud';
 return <details open className="inspector-section"><summary>{t('复根密度着色规则')}</summary><div className="section-body">
  <label className="field"><span>{t('复根着色版本')}</span><select aria-label={t('复根着色版本')} disabled={usesRootsNativePresentation(scene)} value={version} onChange={e=>onChange(withRootsDensityColorVersion(scene,e.target.value))}><option value="local-rgb-v1">{t('本地 · RGB 累积')}</option><option value="mathart-1.7.8-metric-v1">{t('MathArt 1.7.8 · 度量累积')}</option></select></label>
  {!pointCloud&&<p className="muted">{t('版本只影响渐进密度；切换会保留两组色板和调色参数，不自动转换颜色。')}</p>}
  {version!=='local-rgb-v1'&&!active&&<p role="status">{t('源规则已保存，当前单次根图仍使用本地颜色。切换到渐进密度后生效。')}</p>}
  {active&&<>
   <p className="muted">{t(pointCloud?'点云逐点读取源色板并按到达顺序透明混合；亮度不使用密度点数归一化。':'每个像素先累积根度量，再按平均度量读取 256 色纹理；源亮度使用提交的有限根点数和实际画布尺寸。')}</p>
   <p role="status" className="muted">{t(usesRootsGradientTimeline(scene)?'完整源场景队列通过渐变动作更新源偏移，停止后保留最后偏移；数值与本地色板轨道保留但不执行。静态源色板与调色参数仍可编辑。':usesRootsCameraTimeline(scene)?'源相机队列中仅静态源调色参数生效；数值与渐变轨道保留但不执行。本地色板、曝光、白点及透明背景保持休眠。':'本地色板、曝光、白点、透明背景及其动画保留但不参与源密度着色。请编辑源调色参数；源偏移可使用对应数值轨道。')}</p>
   {ROOTS_SOURCE_TONE_FIELDS.map(field=><Control key={field.key} spec={{...field,type:'number',group:t('复根源调色')}} value={scene.settings[field.key]??field.default} onChange={value=>onChange({...scene,settings:{...scene.settings,[field.key]:value}})}/>)}
   <p className="muted">{t('源调色值按源范围取有效值；保存的有限原值不因显示或切换版本而改写。')}</p>
   {!pointCloud&&(facts?<p role="status" data-testid="roots-color-facts">{t('实际完成画面：{count} 个有限提交点 · 密度尺度 {scale} · {accumulation} 累积 · {tone} 调色',{count:facts.submittedFinitePointCount.toLocaleString(),scale:String(facts.exposureScale),accumulation:facts.accumulationPrecision==='float64'?'Float64':'Float32',tone:facts.toneBackend==='webgl2'?'GPU':'CPU'})}</p>:<p className="muted">{t('等待与当前作品匹配的已呈现复根密度画面。')}</p>)}
  </>}
 </div></details>;
}

export function RootsSourcePaletteEditor({scene,onChange}:Props){
 const {t}=useI18n(),[selected,setSelected]=useState(0),[error,setError]=useState('');
 const colors=scene.rootsSourcePalette?.colors??DEFAULT_ROOTS_SOURCE_COLORS,index=Math.min(selected,Math.max(0,colors.length-1)),current=colors[index];
 const emit=(next:readonly string[],resetSelection=false)=>{try{onChange({...scene,rootsSourcePalette:parseRootsSourcePalette({colors:[...next]})});if(resetSelection)setSelected(0);setError('');return undefined;}catch(e){const message=e instanceof Error?e.message:String(e);setError(message);return message;}};
 const previewColors=(colors.length===1?[colors[0],colors[0]]:colors).slice(0,32).map(rootsSourceColorRgbHex);
 return <SourceGradientPaletteEditor source={scene.rootsSourcePalette} colors={colors} onGenerate={emit} onRestore={palette=>{onChange({...scene,rootsSourcePalette:palette});setError('');return undefined;}}><div data-testid="source-roots-palette" style={{display:'grid',gap:10}}>
  <p className="muted">{t('源色板保留颜色原文与顺序；所有颜色生成 256 色纹理，透明度不参与根密度。无色板时用四个默认颜色，显式空色板为白色。')}</p>
  <div role="img" aria-label={t('复根源色板预览')} style={{height:25,borderRadius:5,background:previewColors.length?`linear-gradient(90deg,${previewColors.join(',')})`:'#ffffff',border:'1px solid var(--border)'}}/>
  {colors.length>32&&<p className="muted">{t('预览仅展示前 32 色，实际纹理使用完整色板。')}</p>}
  <p className="muted">{t('已保存 {count} 个颜色',{count:colors.length})}</p>
  {current!==undefined?<>
   <label className="field"><span>{t('选择颜色')}</span><input aria-label={t('复根源颜色序号')} type="number" min={1} max={colors.length} step={1} value={index+1} onChange={e=>{const n=Number(e.target.value);if(Number.isInteger(n)&&n>=1&&n<=colors.length)setSelected(n-1);}}/></label>
   <div style={{display:'flex',gap:8,alignItems:'center'}}><input aria-label={t('复根源颜色')} type="color" value={rootsSourceColorRgbHex(current)} onChange={e=>emit(colors.map((c,i)=>i===index?withRootsSourceColorRgb(c,e.target.value):c))}/><input aria-label={t('复根源颜色原文')} value={current} onChange={e=>emit(colors.map((c,i)=>i===index?e.target.value:c))}/><button onClick={()=>{emit(colors.filter((_,i)=>i!==index));setSelected(Math.max(0,index-1));}}>{t('删除颜色')}</button></div>
   <p className="muted">{t('无法解析的颜色原文会保留，并以白色显示；渲染警告列出该项。')}</p>
  </>:<p role="status">{t('空源色板使用白色纹理；密度调色仍然生效。')}</p>}
  <div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button onClick={()=>{emit([...colors,current??'#ffffff']);setSelected(colors.length);}}>{t('添加颜色')}</button><button disabled={colors.length<2} onClick={()=>{emit([...colors].reverse());setSelected(0);}}>{t('反转')}</button><button onClick={()=>{emit(DEFAULT_ROOTS_SOURCE_COLORS);setSelected(0);}}>{t('恢复四色默认')}</button><button onClick={()=>{try{onChange(copyRootsManualColors(scene));setSelected(0);setError('');}catch(e){setError(e instanceof Error?e.message:String(e));}}}>{t('拷贝本地手动颜色一次')}</button></div>
  <p className="muted">{t('拷贝仅使用保存的手动色标，不采样余弦、HSV、曲线或带位置色板；本地色板保持不变。')}</p>
  {error&&<p role="alert">{t(error)}</p>}
 </div></SourceGradientPaletteEditor>;
}
