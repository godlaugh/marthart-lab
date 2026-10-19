import {useState} from 'react';
import type {SceneDocument} from '../types';
import {useI18n} from '../i18n';
import {usesSourceSurfaceHost} from '../engine/sourceSurfaceIdentity';
import {parseSourceSurfaceMeshConfiguration,type SourceSurfaceMeshConfiguration} from '../engine/sourceSurfaceMeshConfig';

type Group='points'|'mesh'|'domain'|'transform'|'tracking';
type Props={scene:SceneDocument;onChange:(scene:SceneDocument)=>void};
/** Edits only the canonical saved configuration. Native source limits and local
 * allocation admission remain with their owners; this editor never clamps. */
export function SourceSurfaceControls({scene,onChange}:Props){
 const {t}=useI18n(),[error,setError]=useState('');
 if(!usesSourceSurfaceHost(scene)||!scene.surfaceSource)return null;
 const configuration=scene.surfaceSource,gpu=configuration.nativeBackend==='gpu';
 const emit=(next:SourceSurfaceMeshConfiguration)=>{
  const parsed=parseSourceSurfaceMeshConfiguration(next);
  if(!parsed.ok){setError(`${parsed.error.path.join('.')}: ${parsed.error.reason}`);return;}
  onChange({...scene,surfaceSource:parsed.value});setError('');
 };
 const patch=(group:Group,key:string,value:number|boolean)=>emit({...configuration,[group]:{...configuration[group],[key]:value}});
 const number=(group:Group,key:string,label:string,integer=false)=>{
  const value=(configuration[group] as unknown as Record<string,number>)[key];
  return <label className="field" key={key}><span>{t(label)}</span><input data-testid={`${group==='points'?'source-points':'source-mesh'}-${key}`} aria-label={t(label)} type="number" step={integer?1:'any'} value={value} onChange={event=>{if(event.target.value==='')return;const n=Number(event.target.value);if(!Number.isFinite(n)){setError(t('请输入有限数值'));return;}patch(group,key,n);}}/></label>;
 };
 const toggle=(group:Group,key:string,label:string)=> <label className="field toggle-field" key={key}><span>{t(label)}</span><input data-testid={`source-mesh-${key}`} aria-label={t(label)} type="checkbox" checked={(configuration[group] as unknown as Record<string,boolean>)[key]} onChange={event=>patch(group,key,event.target.checked)}/></label>;
 const color=(key:'wireframeColor'|'backgroundColor',label:string)=>{
  const value=key==='wireframeColor'?configuration.mesh.wireframeColor:configuration.backgroundColor;
  const replace=(packed:number)=>key==='wireframeColor'?patch('mesh',key,packed):emit({...configuration,backgroundColor:packed});
  return <div key={key} className="field"><span>{t(label)}</span><div style={{display:'flex',gap:8}}>
   <input type="color" aria-label={t('{label} RGB',{label:t(label)})} value={'#'+(value&0xffffff).toString(16).padStart(6,'0')} onChange={event=>replace(((value&0xff000000)|parseInt(event.target.value.slice(1),16))>>>0)}/>
   <input data-testid={`source-mesh-${key}`} aria-label={t(label)} type="text" key={value} defaultValue={'#'+value.toString(16).padStart(8,'0').toUpperCase()} onBlur={event=>{const text=event.target.value.trim();if(!/^#[0-9a-f]{8}$/i.test(text)){setError(t('颜色需要完整的 #AARRGGBB 十六进制值'));return;}replace(parseInt(text.slice(1),16));}} onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur();}}/>
  </div></div>;
 };
 return <div data-testid="source-surface-mesh-controls">
  <details open className="inspector-section"><summary>{t('曲面初始模式')}</summary><div className="section-body">
   <label className="field"><span>{t('初始显示')}</span><select aria-label={t('曲面初始模式')} value={configuration.mode} onChange={event=>emit({...configuration,mode:event.target.value as 'points'|'mesh'})}><option value="points">{t('点云')}</option><option value="mesh" disabled={configuration.nativeBackend==='gpu'}>{t('网格曲面')}</option></select></label>
   <p className="muted">{t(gpu?'GPU 点模式使用固定初始颜色，不显示拖尾；导入的模式切换按等待处理。':'时间线可切换点云与网格；两种模式分别使用下方的采样和外观设置。')}</p>
  </div></details>
  <details className="inspector-section"><summary>{t('曲面点云')}</summary><div className="section-body">
   {number('points','uSegments','点云 U 采样数',true)}{number('points','vSegments','点云 V 采样数',true)}
   {number('points','dotRadius','点半径')}{toggle('points','fadePoints','点边界渐隐')}
   {!gpu&&<>{number('points','lineWeight','拖尾线宽')}{number('points','trailLifetime','拖尾寿命')}{toggle('points','showTrails','显示拖尾')}{toggle('points','fadeTrails','拖尾渐隐')}</>}
  </div></details>
  <details open className="inspector-section"><summary>{t(gpu?'曲面参数域':'曲面网格')}</summary><div className="section-body">
   {!gpu&&<>{number('mesh','uSegments','网格 U 采样数',true)}{number('mesh','vSegments','网格 V 采样数',true)}
   <p className="muted">{t('采样数包含边界端点；任一方向为 1 时没有网格面。超出本机容量会显示错误，原值不会被截断。')}</p></>}
   {number('domain','uMin','U 起点')}{number('domain','uMax','U 终点')}{number('domain','vMin','V 起点')}{number('domain','vMax','V 终点')}
   <p className="muted">{t('允许反向范围；起点与终点按输入顺序保存。')}</p>
   {!gpu&&<>{toggle('mesh','wrapU','闭合 U 接缝')}{toggle('mesh','wrapV','闭合 V 接缝')}{number('mesh','wrapThreshold','网格接缝阈值')}</>}
  </div></details>
  <details open className="inspector-section"><summary>{t(gpu?'曲面背景':'网格外观')}</summary><div className="section-body">
   {!gpu&&<>{toggle('mesh','fillEnabled','显示网格填充')}{number('mesh','fillOpacity','网格填充透明度')}{toggle('mesh','wireframeEnabled','显示网格线框')}{number('mesh','lineWeight','网格线宽')}
   {color('wireframeColor','网格线框颜色 ARGB')}</>}{color('backgroundColor',gpu?'曲面背景颜色 ARGB':'网格背景颜色 ARGB')}
   <p className="muted">{t('颜色格式为 #AARRGGBB，AA 表示透明度；修改 RGB 保留 AA。完整颜色输入在离开输入框后应用。')}</p>
   {!gpu&&toggle('mesh','wireframeDecoupled','独立线框网格')}
   {!gpu&&configuration.mesh.wireframeDecoupled&&<>{number('mesh','wireframeUSegments','线框 U 分段数',true)}{number('mesh','wireframeVSegments','线框 V 分段数',true)}<p className="muted">{t('正分段数启用该方向的独立曲线；两个方向都不为正时沿网格三角形绘制线框。')}</p></>}
  </div></details>
  <details className="inspector-section"><summary>{t('曲面变换')}</summary><div className="section-body">
   {(['X','Y','Z'] as const).map(axis=>number('transform',`scale${axis}`,t('{axis} 缩放',{axis})))}
   {(['X','Y','Z'] as const).map(axis=>number('transform',`offset${axis}`,t('{axis} 位移',{axis})))}
  </div></details>
  <details className="inspector-section"><summary>{t(gpu?'点云运动与相机跟踪':'网格跟踪点')}</summary><div className="section-body">
   <p className="muted">{t(gpu?'点云沿参数域移动。相机按逐帧状态跟踪最后指定的点；周期反弹时可能与可见点位置不同。':'跟踪点沿参数域移动，网格采样位置保持不变；时间线中的跟踪动作可让相机跟随它。')}</p>
   {number('tracking','speedU','跟踪 U 速度')}{number('tracking','speedV','跟踪 V 速度')}
   {toggle('domain','periodicU','跟踪 U 周期边界')}{toggle('domain','periodicV','跟踪 V 周期边界')}{toggle('domain','flowingU','跟踪 U 流动')}{toggle('domain','flowingV','跟踪 V 流动')}
  </div></details>
  {error&&<p role="alert">{t(error)}</p>}
 </div>;
}
