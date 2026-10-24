import {useState} from 'react';
import type {SceneDocument} from '../types';
import {useI18n} from '../i18n';
import {SourceGradientPaletteEditor,type SourceGradientPaletteController} from './SourceGradientPaletteEditor';
import {implicitEditableColors,implicitPaletteEditorState,implicitPaletteEditorMode,openImplicitPaletteEditor,commitImplicitSourcePalette,restoreImplicitSourceManualPalette,changeImplicitSourcePalette,implicitManualColorRgb,implicitManualRgbText,SOURCE_IMPLICIT_DEFAULT_COLORS} from '../engine/implicitPaletteEditing';
import {insertSourceBouncingColor} from '../engine/sourceBouncingPaletteEditing';
import {usesSourceImplicitCpuMesh} from '../engine/sourceImplicitPresentation';
import type {SourcePaletteGenerationResult} from '../engine/sourceGradientPaletteGeneration';

type Props={scene:SceneDocument;onChange:(next:SceneDocument,intent:'implicit-palette')=>void};
export function SourceImplicitPaletteEditor({scene,onChange}:Props){
 const {t}=useI18n(),[selected,setSelected]=useState(0),[error,setError]=useState('');
 if(!usesSourceImplicitCpuMesh(scene))return null;
 // App commits this initializer as metadata. This pure fallback also makes the
 // first paint correct without a mount effect issuing an unintended hot edit.
 const editable=openImplicitPaletteEditor(scene),colors=implicitEditableColors(editable),state=implicitPaletteEditorState(editable),index=Math.min(selected,Math.max(0,colors.length-1)),current=colors[index];
 const accept=(result:SourcePaletteGenerationResult<SceneDocument>)=>{if(!result.ok){setError(result.error.reason);return result.error.reason;}onChange(result.value,'implicit-palette');setError('');return undefined;};
 const emit=(next:readonly string[],resetSelection=false)=>{const failure=accept(changeImplicitSourcePalette(editable,next));if(!failure&&resetSelection)setSelected(0);return failure;};
 const controller:SourceGradientPaletteController={ownsManualSnapshot:true,mode:implicitPaletteEditorMode(state),colorCount:state.colorCount,cosine:state.cosine,curve:state.curves??{},onCommit:commit=>accept(commitImplicitSourcePalette(editable,commit)),description:'生成参数只保留在当前打开项目中；保存颜色，重新打开回到手动模式。'};
 const preview=(colors.length===1?[colors[0],colors[0]]:colors).slice(0,16).map(implicitManualColorRgb);
 return <div data-testid="source-implicit-palette" style={{display:'grid',gap:10}}>
  <SourceGradientPaletteEditor source={colors} colors={colors} onGenerate={emit} onRestore={()=>accept(restoreImplicitSourceManualPalette(editable))} controller={controller}>
   <p className="muted">{t('源色板保留全部颜色原文与顺序；热改色不改变时间线。空列表保留当前配色，应用场景后按冷色板读取。')}</p>
   <div role="img" aria-label={t('前 16 个颜色预览')} style={{height:25,borderRadius:5,background:preview.length?`linear-gradient(90deg,${preview.join(',')})`:'#ffffff',border:'1px solid var(--border)'}}/>
   <p className="muted">{t('已保存 {count} 个颜色',{count:colors.length})}</p>
   {current!==undefined&&<>
    <label className="field"><span>{t('选择颜色')}</span><input aria-label={t('源颜色序号')} type="number" min={1} max={colors.length} step={1} value={index+1} onChange={e=>{const n=Number(e.target.value);if(Number.isInteger(n)&&n>=1&&n<=colors.length)setSelected(n-1);}}/></label>
    <div style={{display:'flex',gap:8,alignItems:'center'}}><input aria-label={t('源颜色')} type="color" value={implicitManualColorRgb(current)} onChange={e=>emit(colors.map((c,i)=>i===index?implicitManualRgbText(e.target.value):c))}/><input aria-label={t('源颜色原文')} value={current} onChange={e=>emit(colors.map((c,i)=>i===index?e.target.value:c))}/><button onClick={()=>{if(!emit(colors.filter((_,i)=>i!==index)))setSelected(Math.max(0,index-1));}}>{t('删除颜色')}</button></div>
   </>}
   <div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button onClick={()=>{const next=insertSourceBouncingColor(colors,index);if(!emit(next.colors))setSelected(next.selected);}}>{t('添加颜色')}</button><button disabled={colors.length<2} onClick={()=>emit([...colors].reverse(),true)}>{t('反转')}</button><button onClick={()=>emit(SOURCE_IMPLICIT_DEFAULT_COLORS,true)}>{t('恢复六色默认')}</button></div>
  </SourceGradientPaletteEditor>
  {error&&<p role="alert">{t(error)}</p>}
 </div>;
}
