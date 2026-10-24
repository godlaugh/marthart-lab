import {useState} from 'react';
import type {SceneDocument} from '../types';
import {useI18n} from '../i18n';
import {SourcePerlinDraftField} from './SourcePerlinDraftField';
import {SourcePerlinPaletteEditor} from './SourcePerlinPaletteEditor';
import {usesSourcePerlinCpu,sourcePerlinCpuConfiguration} from '../engine/sourcePerlinIdentity';
import {parseSourcePerlinCpuDocument,type SourcePerlinCpuDocumentPayload as Config} from '../engine/sourcePerlinCpuDocument';

type Props={scene:SceneDocument;onChange:(scene:SceneDocument)=>void;tab?:'geometry'|'appearance'|'all'};
export function SourcePerlinCpuControls({scene,onChange,tab='all'}:Props){
 const {t}=useI18n(),[error,setError]=useState('');
 const source=sourcePerlinCpuConfiguration(scene);
 if(!usesSourcePerlinCpu(scene)||!source)return null;
 const emit=(candidate:Config)=>{const parsed=parseSourcePerlinCpuDocument(candidate);if(!parsed.ok)return `${parsed.error.path.join('.')}: ${t(parsed.error.reason)}`;onChange(scene.perlinSource?{...scene,perlinSource:{...scene.perlinSource,...parsed.value}}:{...scene,perlinCpuSource:parsed.value});setError('');return undefined;};
 const field=(id:string,label:string,value:string,commit:(text:string)=>string|undefined,multiline=false)=><SourcePerlinDraftField key={`${id}:${value}`} prefix="source-perlin-cpu" id={id} label={t(label)} value={value} commit={commit} multiline={multiline}/>;
 const numeric=<K extends 'particles'|'curves'|'display'|'parameters'>(group:K,key:keyof Config[K],id:string,label:string)=>field(id,label,String(source[group][key]),raw=>{
  if(!raw.trim()||!Number.isFinite(Number(raw)))return t('请输入有限数值');
  return emit({...source,[group]:{...source[group],[key]:Number(raw)}});
 });
 const select=<K extends 'particles'|'curves'>(group:K,key:keyof Config[K],id:string,label:string,choices:readonly(readonly[string,string])[])=><label className="field" key={id}><span>{t(label)}</span><select data-testid={`source-perlin-cpu-${id}`} aria-label={t(label)} value={String(source[group][key])} onChange={e=>setError(emit({...source,[group]:{...source[group],[key]:e.target.value}})??'')}>{choices.map(([value,label])=><option key={value} value={value}>{t(label)}</option>)}</select></label>;
 const flag=(key:'fadeTrails'|'showTrails'|'accumulation',label:string)=><label className="field" key={key}><span>{t(label)}</span><input data-testid={`source-perlin-cpu-${key}`} type="checkbox" checked={source.display[key]} onChange={e=>setError(emit({...source,display:{...source.display,[key]:e.target.checked}})??'')}/></label>;
 return <div data-testid="source-perlin-cpu-controls">
 {(tab==='geometry'||tab==='all')&&<details className="inspector-section" open><summary>{t('流场与运动')}</summary><div className="section-body">
 {field('seed','64 位整数种子',source.seed,seed=>emit({...source,seed}))}
 <label className="field"><span>{t('CPU 绘制方式')}</span><select data-testid="source-perlin-cpu-style" value={source.cpuStyle} onChange={e=>setError(emit({...source,cpuStyle:e.target.value as Config['cpuStyle']})??'')}><option value="particles">{t('运动粒子')}</option><option value="field-curves">{t('流场曲线')}</option></select></label>
 {source.cpuStyle==='particles'?<>
 {numeric('particles','count','particle-count','粒子数量')}{numeric('particles','stepSize','step-size','运动步长')}
 {numeric('particles','timeScale','time-scale','时间比例')}{numeric('particles','respawnRate','respawn-rate','重生率')}
 {select('particles','flowMode','flow-mode','运动流场',[['ANGLE_FIELD','角度场'],['SWIRL_FIELD','旋涡场'],['VECTOR_FIELD','向量场']])}
 {select('particles','angleMap','angle-map','角度映射',[['LINEAR','线性'],['SOFT_POWER','平滑幂函数']])}
 {numeric('parameters','noise_scale','noise-scale','噪声尺度')}
 </>:<>
 {numeric('curves','count','curve-count','曲线数量')}{numeric('curves','length','curve-length','每条曲线点数')}{numeric('curves','stepSize','curve-step-size','曲线步长')}
 {numeric('curves','cellSize','cell-size','流场网格间距')}{numeric('curves','noiseOctaves','noise-octaves','噪声层数')}{numeric('curves','noiseOffset','curve-noise-offset','曲线噪声偏移')}
 {numeric('parameters','curve_noise_scale','curve-noise-scale','曲线噪声尺度')}{numeric('parameters','curve_angle_scale','curve-angle-scale','曲线角度比例')}
 {select('curves','sampling','sampling','起点采样',[['random','随机'],['jittered-grid','抖动网格']])}
 {select('curves','colorMode','color-mode','曲线配色',[['seed-space','种子色块'],['noise','噪声'],['index','曲线顺序'],['position','位置']])}
 {numeric('curves','seedCircleCount','seed-circle-count','种子色块数量')}{numeric('curves','seedMinRadius','seed-min-radius','色块最小半径')}{numeric('curves','seedMaxRadius','seed-max-radius','色块最大半径')}
 </>}
 {numeric('parameters','noise_offset','noise-offset','方向偏移')}
 </div></details>}
 {(tab==='appearance'||tab==='all')&&<details className="inspector-section" open><summary>{t('画面与轨迹')}</summary><div className="section-body">
 {numeric('display','lineWeight','line-weight','线宽')}
 {source.cpuStyle==='particles'?<>{numeric('display','dotSize','dot-size','点大小')}{numeric('display','trailLifetime','trail-lifetime','轨迹保留时长')}{flag('showTrails','显示与记录轨迹')}{flag('fadeTrails','轨迹渐隐')}</>:numeric('curves','alpha','curve-alpha','曲线透明度')}
 {flag('accumulation','累积画面')}{source.display.accumulation&&numeric('display','accumulationFadeAlpha','fade-alpha','每帧背景淡出（0–255）')}
 {field('background','背景颜色（#AARRGGBB）','#'+source.display.backgroundColor.toString(16).padStart(8,'0').toUpperCase(),raw=>/^#[\da-f]{8}$/i.test(raw)?emit({...source,display:{...source.display,backgroundColor:parseInt(raw.slice(1),16)}}):t('请输入完整的 #AARRGGBB 颜色'))}
 <SourcePerlinPaletteEditor palette={source.palette} prefix="source-perlin-cpu" onChange={palette=>emit({...source,palette})}/>
 </div></details>}
 <p className="muted">{t('输入后按 Enter 或移出输入框应用；颜色列表使用 Ctrl / ⌘ + Enter。')}</p>
 {error&&<p role="alert">{error}</p>}
 </div>;
}
