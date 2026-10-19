import {usesSourceSurfaceHost} from '../engine/sourceSurfaceIdentity';
import {useState} from 'react';
import type {SceneDocument} from '../types';
import {useI18n} from '../i18n';
import {DEFAULT_SOURCE_SURFACE_COLORS,MAX_SOURCE_SURFACE_COLORS,parseSourceSurfacePalette,prepareSourceSurfaceColors} from '../engine/sourceSurfaceColor';

export function SourceSurfacePaletteEditor({scene,onChange}:{scene:SceneDocument;onChange:(scene:SceneDocument)=>void}){
 const {t}=useI18n(),[selected,setSelected]=useState(0),[error,setError]=useState('');
 const colors=scene.surfaceSourcePalette?.colors??DEFAULT_SOURCE_SURFACE_COLORS,index=Math.min(selected,colors.length-1),current=colors[index];
 const packed=prepareSourceSurfaceColors({colors:[current]},1,1,false).packed[0],rgb='#'+(packed&0xffffff).toString(16).padStart(6,'0');
 const emit=(next:readonly string[])=>{try{onChange({...scene,surfaceSourcePalette:parseSourceSurfacePalette({colors:[...next]})});setError('');}catch(e){setError(e instanceof Error?e.message:String(e));}};
 return <div data-testid="source-surface-palette" style={{display:'grid',gap:10}}>
  <p className="muted">{t(scene.surfaceSource?.nativeBackend==='gpu'?'颜色沿 U 方向排列。修改色板会重新生成点云；时间线渐变不会改变已生成的点颜色。':usesSourceSurfaceHost(scene)&&scene.surfaceSource?.mode==='mesh'?'网格颜色沿 U 方向排列；闭合接缝会平滑颜色。填充透明度由网格外观控制。':'颜色沿 U 方向排列，并跟随各自的粒子。支持带透明度的 #AARRGGBB 颜色。')}</p>
  <label className="field"><span>{t('选择颜色')}</span><input aria-label={t('曲面源颜色序号')} type="number" min={1} max={colors.length} step={1} value={index+1} onChange={e=>{const n=Number(e.target.value);if(Number.isInteger(n)&&n>=1&&n<=colors.length)setSelected(n-1);}}/></label>
  <div style={{display:'flex',gap:8,alignItems:'center'}}>
   <input aria-label={t('曲面源颜色')} type="color" value={rgb} onChange={e=>emit(colors.map((c,i)=>i===index?'#'+(packed>>>24).toString(16).padStart(2,'0')+e.target.value.slice(1):c))}/>
   <input aria-label={t('曲面源颜色原文')} value={current} onChange={e=>emit(colors.map((c,i)=>i===index?e.target.value:c))}/>
   <button disabled={colors.length===1} onClick={()=>{emit(colors.filter((_,i)=>i!==index));setSelected(Math.max(0,index-1));}}>{t('删除颜色')}</button>
  </div>
  <p className="muted">{t('无法解析的颜色原文会保留，并以白色显示；渲染警告列出该项。')}</p>
  <p className="muted">{t('已保存 {count} 个颜色',{count:colors.length})}</p>
  <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
   <button disabled={colors.length>=MAX_SOURCE_SURFACE_COLORS} onClick={()=>{emit([...colors,current]);setSelected(colors.length);}}>{t('添加颜色')}</button>
   <button disabled={colors.length<2} onClick={()=>{emit([...colors].reverse());setSelected(0);}}>{t('反转')}</button>
   <button onClick={()=>{emit(DEFAULT_SOURCE_SURFACE_COLORS);setSelected(0);}}>{t('恢复曲面六色默认')}</button>
  </div>
  {!usesSourceSurfaceHost(scene)&&<><label><input type="checkbox" aria-label={t('周期边界点渐隐')} checked={scene.settings.fadePoints!==false} onChange={e=>onChange({...scene,settings:{...scene.settings,fadePoints:e.target.checked}})}/>{t('周期边界点渐隐')}</label>
  <p className="muted">{t('流动粒子靠近周期边界时渐隐；拖尾仍使用色板中的透明度。')}</p></>}
  {error&&<p role="alert">{t(error)}</p>}
 </div>;
}
