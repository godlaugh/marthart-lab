import {useState} from 'react';
import type {SceneDocument} from '../types';
import {useI18n} from '../i18n';
import {Control} from './Fields';
import {SourceGradientPaletteEditor,type SourceGradientPaletteController} from './SourceGradientPaletteEditor';
import {sourceSamilaEditableColors,sourceSamilaPaletteEditorState,sourceSamilaPaletteEditorMode,openSourceSamilaPaletteEditor,commitSourceSamilaPalette,restoreSourceSamilaManualPalette,changeSourceSamilaPalette,sourceSamilaManualColorRgb,sourceSamilaManualRgbText,syncSourceSamilaPaletteSession,SOURCE_SAMILA_DEFAULT_COLORS} from '../engine/sourceSamilaPaletteEditing';
import {insertSourceBouncingColor} from '../engine/sourceBouncingPaletteEditing';
import {usesSourceSamilaSplat} from '../engine/sourceSamilaSplat';
import type {SourcePaletteGenerationResult} from '../engine/sourceGradientPaletteGeneration';
import {MAX_PALETTE_STOPS} from '../engine/palette';

/** One user commit issues the source palette+continuous setters, including
 * equal values. Offset edits only refresh LUT and do not clear accumulation. */
export function SourceSamilaPaletteEditor({scene,onChange}:{scene:SceneDocument;onChange:(scene:SceneDocument,dirty?:boolean)=>void}){
 const {t}=useI18n(),[selected,setSelected]=useState(0),[error,setError]=useState('');
 if(!usesSourceSamilaSplat(scene))return null;
 const editable=openSourceSamilaPaletteEditor(scene),colors=sourceSamilaEditableColors(editable),state=sourceSamilaPaletteEditorState(editable),index=Math.min(selected,Math.max(0,colors.length-1)),current=colors[index];
 const accept=(result:SourcePaletteGenerationResult<SceneDocument>)=>{if(!result.ok){setError(result.error.reason);return result.error.reason;}onChange(result.value,true);setError('');return undefined;};
 const emit=(next:readonly string[],resetSelection=false)=>{const failure=accept(changeSourceSamilaPalette(editable,next));if(!failure&&resetSelection)setSelected(0);return failure;};
 const controller:SourceGradientPaletteController={ownsManualSnapshot:true,mode:sourceSamilaPaletteEditorMode(state),colorCount:state.colorCount,cosine:state.cosine,curve:state.curves??{},onCommit:commit=>accept(commitSourceSamilaPalette(editable,commit)),description:'生成参数只保留在当前打开项目中；保存颜色，重新打开回到手动模式。'};
 const preview=(colors.length===1?[colors[0],colors[0]]:colors).slice(0,16).map(sourceSamilaManualColorRgb);
 return <div data-testid="source-samila-palette" style={{display:'grid',gap:10}}>
  <SourceGradientPaletteEditor source={colors} colors={colors} onGenerate={emit} onRestore={()=>accept(restoreSourceSamilaManualPalette(editable))} controller={controller}>
   <div role="img" aria-label={t('前 16 个颜色预览')} style={{height:25,borderRadius:5,background:preview.length?`linear-gradient(90deg,${preview.join(',')})`:'#000000',border:'1px solid var(--border)'}}/>
   <p className="muted">{t('已保存 {count} 个颜色',{count:colors.length})}</p>
   {current!==undefined&&<>
    <label className="field"><span>{t('选择颜色')}</span><input aria-label={t('源颜色序号')} type="number" min={1} max={colors.length} step={1} value={index+1} onChange={e=>{const n=Number(e.target.value);if(Number.isInteger(n)&&n>=1&&n<=colors.length)setSelected(n-1);}}/></label>
    <div style={{display:'flex',gap:8,alignItems:'center'}}><input aria-label={t('源颜色')} type="color" value={sourceSamilaManualColorRgb(current)} onChange={e=>emit(colors.map((c,i)=>i===index?sourceSamilaManualRgbText(e.target.value):c))}/><input aria-label={t('源颜色原文')} value={current} onChange={e=>emit(colors.map((c,i)=>i===index?e.target.value:c))}/><button onClick={()=>{if(!emit(colors.filter((_,i)=>i!==index)))setSelected(Math.max(0,index-1));}}>{t('删除颜色')}</button></div>
   </>}
   <div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button disabled={colors.length>=MAX_PALETTE_STOPS} onClick={()=>{const next=insertSourceBouncingColor(colors,index);if(!emit(next.colors))setSelected(next.selected);}}>{t('添加颜色')}</button><button disabled={colors.length<2} onClick={()=>emit([...colors].reverse(),true)}>{t('反转')}</button><button onClick={()=>emit(SOURCE_SAMILA_DEFAULT_COLORS,true)}>{t('恢复六色默认')}</button></div>
  </SourceGradientPaletteEditor>
  <Control spec={{key:'samila-palette-offset',label:t('颜色偏移'),type:'number',group:'palette'}} value={scene.palette.offset} onChange={value=>onChange(syncSourceSamilaPaletteSession(editable,{...editable,palette:{...scene.palette,offset:Number(value)}}),false)}/>
  {error&&<p role="alert">{t(error)}</p>}
 </div>;
}
