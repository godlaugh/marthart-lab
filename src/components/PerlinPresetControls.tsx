import {RefreshCw} from 'lucide-react';
import type {Preset, SceneDocument} from '../types';
import {refreshPerlinSeed} from '../engine/perlinPreset';
import {useI18n} from '../i18n';

export function PerlinPresetControls({scene,preset,onChange}:{scene:SceneDocument;preset:Preset|undefined;onChange:(scene:SceneDocument)=>void}) {
  const {t}=useI18n();
  return <div className="section-body perlin-preset-controls">
    <p className="muted" role="status" aria-label={t('当前流场预设')}>{t('当前流场预设')} · <strong>{preset?t(preset.name):t('自定义')}</strong></p>
    <button onClick={()=>onChange({...scene,settings:refreshPerlinSeed(scene.settings,crypto.getRandomValues(new Uint32Array(1))[0])})}><RefreshCw size={13}/>{t('刷新噪声种子')}</button>
  </div>;
}
