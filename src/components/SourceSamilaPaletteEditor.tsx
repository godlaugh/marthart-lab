import {sourceSamilaUsesPaletteLut} from '../engine/sourceSamilaSplat';
import {useState} from 'react';
import type {Palette,SceneDocument,CosinePalette} from '../types';
import {useI18n} from '../i18n';
import {Control} from './Fields';
import {DEFAULT_SOURCE_SURFACE_COLORS} from '../engine/sourceSurfaceColor';
import {MAX_PALETTE_STOPS} from '../engine/palette';
const cosineDefault:CosinePalette={a:[.5,.5,.5],b:[.5,.5,.5],c:[1,1,1],d:[0,Math.fround(.333),Math.fround(.667)]};
export function SourceSamilaPaletteEditor({scene,onChange}:{scene:SceneDocument;onChange:(scene:SceneDocument,dirty?:boolean)=>void}){
 const {t}=useI18n(),[selected,setSelected]=useState(0),palette=scene.palette,index=Math.min(selected,palette.stops.length-1),mode=sourceSamilaUsesPaletteLut(scene.settings,palette)?palette.mode:'fallback';
 const emit=(next:Palette,useLut=true,dirty=true)=>onChange({...scene,palette:next,settings:{...scene.settings,samilaUsePaletteLut:useLut}},dirty);
 return <div data-testid="source-samila-palette" style={{display:'grid',gap:10}}>
  <label className="field"><span>{t('调色板模式')}</span><select aria-label={t('调色板模式')} value={mode} onChange={e=>emit({...palette,mode:e.target.value==='cosine'?'cosine':'linear',cosine:palette.cosine??structuredClone(cosineDefault)},e.target.value!=='fallback')}>
   <option value="linear">{t('手动 Manual')}</option><option value="cosine">{t('余弦 Cosine')}</option><option value="fallback">{t('空色板 · 默认余弦')}</option>
  </select></label>
  {mode==='linear'&&<>
   <p className="muted">{t('色标等距排列，使用 RGB 插值。')}</p>
   <label className="field"><span>{t('选择色标')}</span><select aria-label={t('选择色标')} value={index} onChange={e=>setSelected(Number(e.target.value))}>{palette.stops.map((_,i)=><option key={i} value={i}>{i+1}</option>)}</select></label>
   <div style={{display:'flex',gap:8}}><input type="color" aria-label={t('色标颜色')} value={palette.stops[index]} onChange={e=>emit({...palette,stops:palette.stops.map((c,i)=>i===index?e.target.value:c)})}/>
    <button disabled={palette.stops.length>=MAX_PALETTE_STOPS} onClick={()=>{emit({...palette,stops:[...palette.stops,palette.stops[index]]});setSelected(palette.stops.length);}}>{t('添加色标')}</button>
    <button disabled={palette.stops.length<=2} onClick={()=>{emit({...palette,stops:palette.stops.filter((_,i)=>i!==index)});setSelected(Math.max(0,index-1));}}>{t('删除色标')}</button>
    <button onClick={()=>emit({...palette,stops:[...palette.stops].reverse()})}>{t('反转')}</button>
   </div>
  </>}
  {mode==='cosine'&&(['a','b','c','d']as const).map(key=><div key={key} style={{display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:8}}>{[0,1,2].map(channel=><Control key={channel} spec={{key:`samila-cosine-${key}-${channel}`,label:`${key.toUpperCase()} ${['R','G','B'][channel]}`,type:'number',group:'palette'}} value={(palette.cosine??cosineDefault)[key][channel]} onChange={value=>{const cosine=structuredClone(palette.cosine??cosineDefault);cosine[key][channel]=Number(value);emit({...palette,cosine});}}/>)}</div>)}
  {mode!=='fallback'&&<Control spec={{key:'samila-palette-offset',label:t('颜色偏移'),type:'number',group:'palette'}} value={palette.offset} onChange={value=>emit({...palette,offset:Number(value)},true,false)}/>}
  <button onClick={()=>emit({name:palette.name,mode:'linear',offset:0,cycles:1,stops:[...DEFAULT_SOURCE_SURFACE_COLORS]})}>{t('恢复默认六色')}</button>
 </div>;
}
