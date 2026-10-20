import type {SceneDocument} from '../types';
import {usesSourcePerlin} from '../engine/sourcePerlinIdentity';
import {useI18n} from '../i18n';

export function SourcePerlinBackendControls({scene,onChange}:{scene:SceneDocument;onChange:(scene:SceneDocument)=>void}){
 const {t}=useI18n();
 if(!usesSourcePerlin(scene))return null;
 if(!scene.perlinSource)return <p className="muted">{t('此旧作品只保留单一后端设置；重新导入原版文件后可切换 CPU / GPU。')}</p>;
 return <label className="field"><span>{t('绘制后端')}</span>
  <select data-testid="source-perlin-backend" value={scene.perlinSource.backend} onChange={event=>{
   const backend=event.target.value;
   if(backend==='cpu'||backend==='gpu')onChange({...scene,perlinSource:{...scene.perlinSource!,backend}});
  }}><option value="cpu">CPU</option><option value="gpu">GPU</option></select>
 </label>;
}
