import {useState} from 'react';
import type {SceneDocument} from '../types';
import {useI18n} from '../i18n';
import {writeSourcePackedColor} from '../engine/sourceProcessingGeometry';
import {usesSourceAttractor} from '../engine/sourceAttractorDocument';
import {prepareSourceAttractorInitialColors,parseSourceAttractorVisualConfiguration,SOURCE_ATTRACTOR_PALETTE_LIMITS,type SourceAttractorPalette} from '../engine/sourceAttractorVisualConfig';
export function SourceAttractorPaletteEditor({scene,onChange}:{scene:SceneDocument;onChange:(scene:SceneDocument)=>void}){
 const {t}=useI18n(),[selected,setSelected]=useState(0),[error,setError]=useState('');
 if(!usesSourceAttractor(scene)||!scene.attractorSource)return null;
 const source=scene.attractorSource,palette=source.visual.palette,colors=palette.kind==='colors'?palette.colors:[],index=Math.max(0,Math.min(selected,colors.length-1)),current=colors[index];
 const prepared=prepareSourceAttractorInitialColors(current===undefined?palette:{kind:'colors',colors:[current]},1),packed=prepared.ok?prepared.value.packedPalette[0]:0xffffffff;
 const rgba=new Float32Array(4);writeSourcePackedColor(packed,rgba,0);const previewRgb='#'+Array.from(rgba.slice(0,3),n=>Math.round(n*255).toString(16).padStart(2,'0')).join(''),previewAlpha=Math.round(rgba[3]*255);
 const emit=(palette:SourceAttractorPalette)=>{const parsed=parseSourceAttractorVisualConfiguration({...source.visual,palette});if(!parsed.ok){setError(parsed.error.reason);return;}onChange({...scene,attractorSource:{...source,visual:parsed.value}});setError('');};
 return <div data-testid="source-attractor-palette" style={{display:'grid',gap:10}}>
  <p className="muted">{t('颜色按粒子序号排列，支持 #AARRGGBB。未指定或空色板使用原版默认六色。')}</p>
  {colors.length>0?<><label className="field"><span>{t('选择颜色')}</span><input aria-label={t('吸引子颜色序号')} type="number" min={1} max={colors.length} step={1} value={index+1} onChange={event=>{const n=Number(event.target.value);if(Number.isInteger(n)&&n>=1&&n<=colors.length)setSelected(n-1);}}/></label>
  <div style={{display:'flex',gap:8}}><input aria-label={t('吸引子颜色 RGB')} type="color" value={previewRgb} onChange={event=>emit({kind:'colors',colors:colors.map((c,i)=>i===index?'#'+previewAlpha.toString(16).padStart(2,'0')+event.target.value.slice(1):c)})}/>
   <input data-testid="source-attractor-palette-text" aria-label={t('吸引子颜色原文')} value={current} onChange={event=>emit({kind:'colors',colors:colors.map((c,i)=>i===index?event.target.value:c)})}/>
   <button onClick={()=>{emit({kind:'colors',colors:colors.filter((_,i)=>i!==index)});setSelected(Math.max(0,index-1));}}>{t('删除颜色')}</button></div></>:<p role="status">{t(palette.kind==='absent'?'色板未指定：使用默认六色':'色板为空：使用默认六色')}</p>}
  <p className="muted">{t('无法解析的颜色原文会保留，并以白色显示；渲染警告列出该项。')}</p>
  <div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button disabled={colors.length>=SOURCE_ATTRACTOR_PALETTE_LIMITS.colors} onClick={()=>{emit({kind:'colors',colors:[...colors,current??'#FFFFFFFF']});setSelected(colors.length);}}>{t('添加颜色')}</button><button disabled={colors.length<2} onClick={()=>{emit({kind:'colors',colors:[...colors].reverse()});setSelected(0);}}>{t('反转')}</button><button onClick={()=>{emit({kind:'absent'});setSelected(0);}}>{t('恢复默认六色')}</button></div>
  {error&&<p role="alert">{t(error)}</p>}
 </div>;
}
