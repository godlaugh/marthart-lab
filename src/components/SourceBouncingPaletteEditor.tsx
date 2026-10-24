import {useRef,useState} from 'react';
import {useI18n} from '../i18n';
import {sourceBouncingPaletteColor,type SourceBouncingPalette} from '../engine/sourceBouncingVisualConfig';
import {insertSourceBouncingColor,moveSourceBouncingColor,sourceBouncingEditableColors,sourceBouncingPaletteRgb,sourceBouncingReplaceRgb} from '../engine/sourceBouncingPaletteEditing';
import {SourceManualPaletteGenerator} from './SourceManualPaletteGenerator';
/** Source strings are the authored palette. Selection/drag state never changes
 * spelling, alpha, omitted/empty distinction or unedited imported tail colors. */
export function SourceBouncingPaletteEditor({palette,onChange}:{palette:SourceBouncingPalette;onChange:(palette:SourceBouncingPalette)=>void}){
 const {t}=useI18n(),[selected,setSelected]=useState(0),drag=useRef<{index:number;palette:SourceBouncingPalette}|null>(null),indexInput=useRef<HTMLInputElement>(null);
 const colors=sourceBouncingEditableColors(palette),index=Math.max(0,Math.min(selected,colors.length-1)),current=colors[index];
 const emit=(next:readonly string[])=>onChange({kind:'colors',colors:[...next]});
 const move=(from:number,to:number)=>{if(from!==to)emit(moveSourceBouncingColor(colors,from,to));setSelected(to);};
 return <div data-testid="source-bouncing-palette-editor" className="source-palette-editor">
  <div className="source-palette-swatches" aria-label={t('色板颜色顺序')}>{colors.slice(0,25).map((color,i)=><button key={i} type="button" draggable aria-label={t('色板颜色 {0}',{0:i+1})} aria-pressed={i===index} style={{background:sourceBouncingPaletteRgb(color)}} onClick={()=>setSelected(i)}
   onDragStart={e=>{drag.current={index:i,palette};e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',String(i));}} onDragOver={e=>{if(drag.current?.palette===palette){e.preventDefault();e.dataTransfer.dropEffect='move';}}} onDrop={e=>{e.preventDefault();const from=drag.current;drag.current=null;if(from?.palette===palette)move(from.index,i);}} onDragEnd={()=>{drag.current=null;}}
   onKeyDown={e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();const to=i+(e.key==='ArrowLeft'?-1:1);if(to>=0&&to<colors.length){move(i,to);const target=e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button')[to]??indexInput.current;target?.focus();}}}}>{i+1}</button>)}</div>
  {palette.kind==='absent'&&<p role="status">{t('色板未指定：使用默认六色')}</p>}
  {colors.length===0?<p role="status">{t('色板为空：使用白色')}</p>:<>
   <label className="field"><span>{t('选择颜色')}</span><input ref={indexInput} type="number" aria-label={t('弹跳颜色序号')} min={1} max={colors.length} step={1} value={index+1} onChange={e=>{const n=Number(e.target.value);if(Number.isInteger(n)&&n>=1&&n<=colors.length)setSelected(n-1);}}/></label>
   <div className="source-palette-color"><input type="color" aria-label={t('弹跳颜色 RGB')} value={sourceBouncingPaletteRgb(current)} onChange={e=>{const next=sourceBouncingReplaceRgb(current,e.target.value);if(next!==current)emit(colors.map((c,i)=>i===index?next:c));}}/>
    <input key={`${index}:${current}`} data-testid="source-bouncing-palette-text" aria-label={t('弹跳颜色原文')} defaultValue={current} onBlur={e=>{if(e.target.value!==current)emit(colors.map((c,i)=>i===index?e.target.value:c));}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/></div>
   {!sourceBouncingPaletteColor(current).valid&&<p role="status">{t('无法解析的颜色原文会保留，并以白色显示；渲染警告列出该项。')}</p>}
   <div className="explore-actions"><button disabled={index===0} onClick={()=>move(index,index-1)}>{t('颜色前移')}</button><button disabled={index===colors.length-1} onClick={()=>move(index,index+1)}>{t('颜色后移')}</button><button disabled={colors.length<=2} onClick={()=>{emit(colors.filter((_,i)=>i!==index));setSelected(Math.min(index,colors.length-2));}}>{t('删除颜色')}</button></div>
  </>}
  <div className="explore-actions"><button disabled={colors.length>=25} onClick={()=>{const next=insertSourceBouncingColor(colors,index);emit(next.colors);setSelected(next.selected);}}>{t('添加颜色')}</button><button disabled={colors.length<2} onClick={()=>{emit([...colors].reverse());setSelected(0);}}>{t('反转')}</button><button onClick={()=>{emit([]);setSelected(0);}}>{t('清空色板')}</button><button onClick={()=>{onChange({kind:'absent'});setSelected(0);}}>{t('恢复默认六色')}</button></div>
  <p className="muted">{t('拖拽颜色或用方向键排序。显示前 25 色；更多导入颜色保留，可按序号编辑。')}</p>
  <p className="muted">{t('已保存 {count} 个颜色',{count:palette.kind==='colors'?colors.length:0})}</p>
  <SourceManualPaletteGenerator colors={colors} onGenerate={(next,resetSelection)=>{emit(next);if(resetSelection)setSelected(0);}}/>
 </div>;
}
