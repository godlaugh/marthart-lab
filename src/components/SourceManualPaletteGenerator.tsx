import {useState} from 'react';
import {useI18n} from '../i18n';
import {sourceManualPalettePackedColor} from '../engine/sourceConfigColor';
import {generateSourceManualMainTones,generateSourceManualPalette,type SourceManualPaletteStrategy} from '../engine/sourceManualPaletteGeneration';
import {SourceBouncingNumberField} from './SourceBouncingNumberField';

const strategies:readonly[SourceManualPaletteStrategy,string][]=[
 ['monochromatic','单色 · Monochromatic'],['analogous','类似色 · Analogous'],
 ['complementary','互补色 · Complementary'],['split-complementary','分裂互补色 · Split Complementary'],
];
const countRules={integer:true,min:2,max:25,precision:0,step:1};
const mainRules={integer:true,min:3,max:6,precision:0,step:1};

/** Generator settings are local UI drafts. Display padding must not turn into
 * authored main tones until a user edits a tone; Generate reads the raw draft. */
export function SourceManualPaletteGenerator({colors,onGenerate}:{colors:readonly string[];onGenerate:(colors:string[],resetSelection:boolean)=>void}){
 const {t}=useI18n(),[count,setCount]=useState(16),[strategy,setStrategy]=useState<SourceManualPaletteStrategy>('analogous');
 const [mainCount,setMainCount]=useState(5),[mainTones,setMainTones]=useState(['#FF7A59','#F9C74F','#43AA8B','#577590']),[error,setError]=useState('');
 const displayed=Array.from({length:mainCount},(_,i)=>{
  const at=Math.floor(Math.fround(Math.fround(i/(mainCount-1))*(colors.length-1))+.5);
  return mainTones[i]??colors[at]??'#FFFFFF';
 });
 function generate(randomizeMain=false){
  let tones=mainTones;
  if(randomizeMain){
   const result=generateSourceManualMainTones(mainCount);
   if(!result.ok){setError(result.error.reason);return;}
   tones=result.value;
  }
  const result=generateSourceManualPalette({count,strategy,mainToneCount:mainCount,mainTones:strategy==='split-complementary'?tones:undefined});
  if(!result.ok){setError(result.error.reason);return;}
  if(randomizeMain)setMainTones(tones);
  setError('');onGenerate(result.value,!randomizeMain);
 }
 const editTone=(index:number,value:string)=>setMainTones(displayed.map((tone,i)=>i===index?value:tone));
 return <details data-testid="source-manual-random" className="source-palette-random">
  <summary>{t('随机配色')}</summary>
  <div className="source-palette-editor">
   <label className="field"><span>{t('随机配色策略')}</span><select aria-label={t('随机配色策略')} value={strategy} onChange={e=>setStrategy(e.target.value as SourceManualPaletteStrategy)}>{strategies.map(([value,label])=><option key={value} value={value}>{t(label)}</option>)}</select></label>
   <SourceBouncingNumberField id="random-count" label={t('随机颜色数量')} value={count} rules={countRules} onCommit={n=>{setCount(n);return undefined;}}/>
   {strategy==='split-complementary'&&<>
    <SourceBouncingNumberField id="random-main-count" label={t('主色数量')} value={mainCount} rules={mainRules} onCommit={n=>{setMainCount(n);return undefined;}}/>
    <div className="source-palette-main-tones">{displayed.map((tone,i)=><label key={i} className="field"><span>{t('主色 {0}',{0:i+1})}</span><span className="source-palette-color">
     <input type="color" aria-label={t('主色 {0} RGB',{0:i+1})} value={'#'+(sourceManualPalettePackedColor(tone)&0xffffff).toString(16).padStart(6,'0')} onChange={e=>editTone(i,e.target.value.toUpperCase())}/>
     <input type="text" aria-label={t('主色 {0}',{0:i+1})} value={tone} onChange={e=>editTone(i,e.target.value)}/>
    </span></label>)}</div>
    <button type="button" onClick={()=>generate(true)}>{t('随机主色并替换色板')}</button>
   </>}
   <button type="button" onClick={()=>generate()}>{t('生成并替换色板')}</button>
   <p className="muted">{t('生成会替换整套色板，包含导入的额外颜色。设置仅作草稿，不随项目保存。')}</p>
   {error&&<p role="alert">{t(error)}</p>}
  </div>
 </details>;
}
