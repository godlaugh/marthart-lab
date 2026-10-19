import {useState} from 'react';
import type {SceneDocument} from '../types';
import {useI18n} from '../i18n';
import {usesSourceAttractor} from '../engine/sourceAttractorDocument';
import {parseSourceAttractorConfiguration,type SourceAttractorConfiguration} from '../engine/sourceAttractorConfig';
import {parseSourceAttractorVisualConfiguration,type SourceAttractorGpuTone} from '../engine/sourceAttractorVisualConfig';
type Props={scene:SceneDocument;onChange:(scene:SceneDocument)=>void};
/** Canonical authoring only: bounds/order/signs survive edits. The execution
 * owner performs native count normalization and local capacity admission. */
export function SourceAttractorControls({scene,onChange}:Props){
 const {t}=useI18n(),[error,setError]=useState('');
 if(!usesSourceAttractor(scene)||!scene.attractorSource)return null;
 const source=scene.attractorSource,c=source.configuration,v=source.visual,gpu=c.nativeBackend==='gpu';
 const emit=(configuration:SourceAttractorConfiguration,visual=v,backgroundColor=source.backgroundColor)=>{
  const motion=parseSourceAttractorConfiguration(configuration),appearance=parseSourceAttractorVisualConfiguration(visual);
  if(!motion.ok){setError(`${motion.error.path.join('.')}: ${motion.error.reason}`);return;}
  if(!appearance.ok){setError(`${appearance.error.path.join('.')}: ${appearance.error.reason}`);return;}
  onChange({...scene,attractorSource:{configuration:motion.value,visual:appearance.value,backgroundColor}});setError('');
 };
 const number=(key:string,label:string,value:number,change:(n:number)=>void,integer=false)=><label className="field" key={key}><span>{t(label)}</span><input data-testid={`source-attractor-${key}`} aria-label={t(label)} type="number" step={integer?1:'any'} value={value} onChange={event=>{if(event.target.value==='')return;const n=Number(event.target.value);if(!Number.isFinite(n)){setError(t('请输入有限数值'));return;}change(n);}}/></label>;
 const groupNumber=(group:'dtRange'|'warmup'|'bounds'|'transform',key:string,label:string,integer=false)=>number(`${group}-${key}`,label,(c[group] as unknown as Record<string,number>)[key],n=>emit({...c,[group]:{...c[group],[key]:n}}),integer);
 const visualNumber=(group:'points'|'trails',key:string,label:string)=>number(`${group}-${key}`,label,(v[group] as unknown as Record<string,number>)[key],n=>emit(c,{...v,[group]:{...v[group],[key]:n}}));
 const toggle=(key:'show'|'fade',label:string)=><label className="field toggle-field"><span>{t(label)}</span><input data-testid={`source-attractor-trails-${key}`} aria-label={t(label)} type="checkbox" checked={v.trails[key]} onChange={event=>emit(c,{...v,trails:{...v.trails,[key]:event.target.checked}})}/></label>;
 return <div data-testid="source-attractor-controls">
  <details open className="inspector-section"><summary>{t('吸引子模拟')}</summary><div className="section-body">
   <p className="muted">{t('原版普通吸引子没有参数动画。修改参数会从初始状态重新计算。')}</p>
   <label className="field"><span>{t('吸引子计算后端')}</span><select data-testid="source-attractor-nativeBackend" aria-label={t('吸引子计算后端')} value={c.nativeBackend} onChange={event=>emit({...c,nativeBackend:event.target.value as 'cpu'|'gpu'})}><option value="cpu">CPU</option><option value="gpu">GPU</option></select></label>
   {gpu?number('particleCountGPU','GPU 粒子数',c.particleCountGPU,n=>emit({...c,particleCountGPU:n}),true):number('particleCountCPU','CPU 粒子数',c.particleCountCPU,n=>emit({...c,particleCountCPU:n}),true)}
   {number('stepsPerFrame','每帧积分次数',c.stepsPerFrame,n=>emit({...c,stepsPerFrame:n}),true)}
   {groupNumber('dtRange','min','积分步长下限')}{groupNumber('dtRange','max','积分步长上限')}
   {!gpu&&<p className="muted">{t('CPU 最多绘制 10000 个粒子；复杂公式、预热和拖尾还受计算预算限制。每帧积分次数与时间线帧率共同影响运动。')}</p>}
  </div></details>
  <details className="inspector-section"><summary>{t('初始粒子与预热')}</summary><div className="section-body">
   {groupNumber('warmup','steps','预热次数',true)}{groupNumber('warmup','staggerMin','交错预热下限',true)}{groupNumber('warmup','staggerMax','交错预热上限',true)}
   {(['X','Y','Z'] as const).map(axis=><div key={axis}>{groupNumber('bounds',`min${axis}`,`${axis} 初始下限`)}{groupNumber('bounds',`max${axis}`,`${axis} 初始上限`)}</div>)}
   <p className="muted">{t('范围端点按输入顺序保存。预热只改变初始位置，不生成拖尾。')}</p>
  </div></details>
  <details open className="inspector-section"><summary>{t('吸引子点与拖尾')}</summary><div className="section-body">
   {visualNumber('points','dotRadius','点半径')}
   {gpu?<p className="muted">{t('GPU 按当前帧叠加粒子密度，不绘制拖尾，也不执行渐变动画。CPU 的拖尾设置仍保留。')}</p>:<>{toggle('show','显示拖尾')}{visualNumber('trails','lineWeight','拖尾线宽')}{visualNumber('trails','lifetime','拖尾寿命')}{toggle('fade','拖尾渐隐')}
   <p className="muted">{t('拖尾记录每次积分的位置。渐变动画在显示拖尾时更新点与拖尾颜色；关闭拖尾会暂停颜色更新。')}</p></>}
  </div></details>
  {gpu&&<details open className="inspector-section"><summary>{t('GPU 色调')}</summary><div className="section-body">
   {(Object.entries({exposure:'GPU 曝光',contrast:'GPU 对比度',gamma:'GPU 伽马',saturation:'GPU 饱和度',densityScale:'GPU 密度比例'}) as [keyof SourceAttractorGpuTone,string][]).map(([key,label])=>number(`gpuTone-${key}`,label,v.gpuTone[key],n=>emit(c,{...v,gpuTone:{...v.gpuTone,[key]:n}})))}
   <p className="muted">{t('色调数值按原版范围限制。密度比例控制当前帧的叠加亮度，不延长轨迹。')}</p>
  </div></details>}
  <details className="inspector-section"><summary>{t('吸引子显示变换')}</summary><div className="section-body">
   {(['X','Y','Z'] as const).map(axis=>groupNumber('transform',`scale${axis}`,t('{axis} 缩放',{axis})))}{(['X','Y','Z'] as const).map(axis=>groupNumber('transform',`offset${axis}`,t('{axis} 位移',{axis})))}
  </div></details>
  {error&&<p role="alert">{t(error)}</p>}
 </div>;
}
export function SourceAttractorBackground({scene,onChange}:Props){
 const {t}=useI18n(),[error,setError]=useState('');if(!usesSourceAttractor(scene)||!scene.attractorSource)return null;
 const source=scene.attractorSource,value=source.backgroundColor,emit=(backgroundColor:number)=>{onChange({...scene,attractorSource:{...source,backgroundColor}});setError('');};
 return <div className="field"><span>{t('背景颜色')}</span><div style={{display:'flex',gap:8}}>
  <input type="color" data-testid="source-attractor-background-rgb" aria-label={t('吸引子背景 RGB')} value={'#'+(value&0xffffff).toString(16).padStart(6,'0')} onChange={event=>emit(((value&0xff000000)|parseInt(event.target.value.slice(1),16))>>>0)}/>
  <input type="text" data-testid="source-attractor-backgroundColor" aria-label={t('吸引子背景 ARGB')} key={value} defaultValue={'#'+value.toString(16).padStart(8,'0').toUpperCase()} onBlur={event=>{const text=event.target.value.trim();if(!/^#[0-9a-f]{8}$/i.test(text)){setError(t('颜色需要完整的 #AARRGGBB 十六进制值'));return;}emit(parseInt(text.slice(1),16));}} onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur();}}/>
 </div><p className="muted">{t('颜色格式为 #AARRGGBB，AA 表示透明度；修改 RGB 保留 AA。')}</p>{error&&<p role="alert">{t(error)}</p>}</div>;
}
