import {SourcePerlinDraftField} from './SourcePerlinDraftField';
import {SourcePerlinPaletteEditor} from './SourcePerlinPaletteEditor';
import {useState, type ReactNode} from 'react';
import type {SceneDocument} from '../types';
import {useI18n} from '../i18n';
import {parseSourcePerlinGpuDocument, type SourcePerlinGpuDocumentPayload} from '../engine/sourcePerlinGpuDocument';

import {usesSourcePerlinGpu,sourcePerlinGpuConfiguration} from '../engine/sourcePerlinIdentity';

type Props = {scene:SceneDocument; onChange:(scene:SceneDocument,intent?:'perlin-palette')=>void; tab?:'geometry'|'appearance'|'all'};
type Commit = (text:string)=>string|undefined;
type UniformKey = keyof SourcePerlinGpuDocumentPayload['uniforms'];

const textureLabels=['纤维','条纹','丝绸','水波','火焰','迷雾'] as const;
const flowFields:readonly (readonly [UniformKey,string])[]=[
 ['noiseFrequency','流场频率'],['warpAmplitude','扭曲幅度'],['warpFrequency','扭曲频率'],
 ['directionOffset','方向偏移（弧度）'],['timeSpeed','动画速度'],
 ['marchSteps','沿场采样步数'],['stepSize','沿场步长'],
];
const appearanceFields:readonly (readonly [UniformKey,string])[]=[
 ['brightness','亮度'],['vignettePower','暗角强度'],['fiberStrength','纹理混合强度'],
];

/** Canonical source GPU authoring only: no local Perlin settings are rewritten. */
export function SourcePerlinGpuControls({scene,onChange,tab='all'}:Props){
 const {t}=useI18n(),[error,setError]=useState('');
 const source=sourcePerlinGpuConfiguration(scene);
 if(!usesSourcePerlinGpu(scene)||!source)return null;
 const emit=(candidate:SourcePerlinGpuDocumentPayload,intent?:'perlin-palette'):string|undefined=>{
  const parsed=parseSourcePerlinGpuDocument(candidate);
  if(!parsed.ok){const path=parsed.error.path.join('.');return path?`${path}: ${t(parsed.error.reason)}`:t(parsed.error.reason);}
  const {textureStyle,uniforms,...common}=parsed.value;
  onChange(scene.perlinSource?{...scene,perlinSource:{...scene.perlinSource,...common,gpu:{textureStyle,uniforms}}}:{...scene,perlinGpuSource:parsed.value},intent);setError('');return undefined;
 };
 const field=(id:string,label:string,value:string,commit:Commit,multiline=false,numeric=false)=><SourcePerlinDraftField
  key={`${id}:${value}`} id={id} label={t(label)} value={value} commit={commit} multiline={multiline} numeric={numeric}/>;
 const uniform=(key:UniformKey,label:string)=>field(key,label,Object.is(source.uniforms[key],-0)?'-0':String(source.uniforms[key]),raw=>{
  if(raw.trim()==='')return t('请输入数值');
  const value=Number(raw);
  if(!Number.isFinite(value))return t('请输入有限数值');
  return emit({...source,uniforms:{...source.uniforms,[key]:value}});
 },false,true);
 const section=(id:string,label:string,children:ReactNode)=><details key={id} className="inspector-section" open>
  <summary>{t(label)}</summary><div className="section-body">{children}</div>
 </details>;
 const renderStyle=source.uniforms.renderStyle;
 return <div key={scene.id} data-testid="source-perlin-gpu-controls">
  {(tab==='all'||tab==='geometry')&&<>
   {section('texture','纹理与流动',<>
    {field('seed','64 位整数种子',source.seed,seed=>emit({...source,seed}))}
    <label className="field"><span>{t('纹理风格')}</span><select data-testid="source-perlin-gpu-textureStyle" aria-label={t('纹理风格')} value={source.textureStyle}
     onChange={event=>setError(emit({...source,textureStyle:Number(event.target.value) as SourcePerlinGpuDocumentPayload['textureStyle']})??'')}>
     {textureLabels.map((name,index)=><option key={index} value={index}>{t(name)}</option>)}
     {(source.textureStyle<0||source.textureStyle>5)&&<option value={source.textureStyle}>{t('保留纹理值 {value}',{value:String(source.textureStyle)})}</option>}
    </select></label>
    <label className="field"><span>{t('流动方式')}</span><select data-testid="source-perlin-gpu-renderStyle" aria-label={t('流动方式')} value={renderStyle}
     onChange={event=>setError(emit({...source,uniforms:{...source.uniforms,renderStyle:Number(event.target.value)}})??'')}>
     <option value={0}>{t('纤维流动')}</option><option value={1}>{t('水流')}</option>
     {renderStyle!==0&&renderStyle!==1&&<option value={renderStyle}>{t('纤维流动（保留值 {value}）',{value:String(renderStyle)})}</option>}
    </select></label>
   </>)}
   {section('flow','流场参数',<>{flowFields.map(([key,label])=>uniform(key,label))}</>)}
  </>}
  {(tab==='all'||tab==='appearance')&&<>
   {section('appearance','画面外观',<>{appearanceFields.map(([key,label])=>uniform(key,label))}</>)}
   {section('palette','纹理色板',<>
    <SourcePerlinPaletteEditor palette={source.palette} prefix="source-perlin-gpu" onChange={palette=>emit({...source,palette},'perlin-palette')}/>
    <p className="muted">{t('每行一个颜色，也可用空格或逗号分隔。前两位为透明度；此画面最终输出为不透明。')}</p>
   </>)}
  </>}
  <p className="muted">{t('输入后按 Enter 或移出输入框应用；颜色列表使用 Ctrl / ⌘ + Enter。')}</p>
  {error&&<p role="alert">{error}</p>}
 </div>;
}
