import {useState} from 'react';
import type {SourceBouncingCheckpoint} from '../engine/sourceBouncingReplay';
import {useI18n} from '../i18n';

/** Native simulation has no clip queue. Fixed-index seeking is an explicit
 * local navigation tool, independent from the realtime playback clock. */
export function SourceBouncingTransport({checkpoint,playing,ready,fps,onPlay,onSeek}:{checkpoint:SourceBouncingCheckpoint;playing:boolean;ready:boolean;fps:number;onPlay:(value:boolean)=>void;onSeek:(updates:number)=>void}){
 const {t}=useI18n(),[draft,setDraft]=useState('0'),[error,setError]=useState('');
 const seek=()=>{const index=Number(draft);if(!draft.trim()||!Number.isSafeInteger(index)||index<0||index>10000){setError(t('更新次数须为 0–10000 的整数'));return;}setError('');onSeek(index);};
 return <section className="timeline" aria-label={t('源弹跳播放')} data-testid="source-bouncing-transport">
  <div className="timeline-toolbar">
   <button data-testid="source-bouncing-play" disabled={!playing&&!ready} onClick={()=>onPlay(!playing)}>{t(playing?'暂停':'播放')}</button>
   <button disabled={playing} onClick={()=>onSeek(0)}>{t('回到初始状态')}</button>
   <span data-testid="source-bouncing-update-count">{t('更新次数')} {checkpoint.simulationUpdates}</span>
   <span data-testid="source-bouncing-scene-time">{t('场景时间')} {checkpoint.sceneTime.toFixed(3)} s</span>
  </div>
  <div className="section-body">
   <p className="muted">{t('实时逐帧：每次完成画面推进一次，暂停不会推进粒子。')}</p>
   <label>{t('按更新次数定位')} <input data-testid="source-bouncing-seek" inputMode="numeric" value={draft} onChange={event=>setDraft(event.target.value)} onKeyDown={event=>{if(event.key==='Enter')seek();}} disabled={playing}/></label>
   <button disabled={playing} onClick={seek}>{t('定位')}</button>
   <small className="muted">{t('定位时从初始状态按固定帧率回放')} · {fps} fps</small>
   {error&&<p role="alert">{error}</p>}
  </div>
 </section>;
}
