import {useI18n} from '../i18n';
import {sourceConfigPackedColor} from '../engine/sourceConfigColor';
import {SourceGradientPaletteEditor} from './SourceGradientPaletteEditor';
import {SourcePerlinDraftField} from './SourcePerlinDraftField';

/** The caller owns canonical packed ARGB and validation. Generator RGB goes
 * through the source parser once; Manual snapshots retain every alpha byte. */
export function SourcePerlinPaletteEditor({palette,onChange,prefix}:{palette:number[];onChange:(palette:number[])=>string|undefined;prefix:'source-perlin-cpu'|'source-perlin-gpu'}){
 const {t}=useI18n();
 const text=palette.map(c=>'#'+c.toString(16).padStart(8,'0').toUpperCase()).join('\n');
 const colors=palette.map(c=>'#'+(c&0xffffff).toString(16).padStart(6,'0').toUpperCase());
 return <SourceGradientPaletteEditor source={palette} colors={colors} onGenerate={next=>onChange(next.map(sourceConfigPackedColor))} onRestore={onChange}>
  <SourcePerlinDraftField key={text} prefix={prefix} id="palette" label={t('颜色列表（#AARRGGBB）')} value={text} multiline commit={raw=>{
   const tokens=raw.trim()?raw.trim().split(/[\s,]+/):[];
   const invalid=tokens.findIndex(token=>!/^#[\da-f]{8}$/i.test(token));
   if(invalid!==-1)return t('第 {index} 项需要完整的 #AARRGGBB 颜色',{index:invalid+1});
   return onChange(tokens.map(sourceConfigPackedColor));
  }}/>
  <p className="muted">{t('已保存 {count} 个颜色',{count:palette.length})}</p>
 </SourceGradientPaletteEditor>;
}
