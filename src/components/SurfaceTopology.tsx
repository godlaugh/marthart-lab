import {useI18n} from '../i18n';
import type {SceneDocument} from '../types';
import {Control} from './Fields';
export function SurfaceTopology({scene,onChange}:{scene:SceneDocument;onChange:(scene:SceneDocument)=>void}){
  const {t}=useI18n();
  if(scene.kind!=='surface')return null;
  function setting(key:string,value:number|string|boolean|undefined){const settings={...scene.settings};if(value===undefined)delete settings[key];else settings[key]=value;onChange({...scene,settings});}
  return <details className="inspector-section"><summary>{t("网格接缝与拓扑")}</summary><div className="section-body">
    {['U','V'].map(axis=><label key={axis} className="field"><span>{axis.toLowerCase()} {t("方向接缝")}</span><select aria-label={t("{0} 方向网格接缝",{0:axis.toLowerCase()})} value={scene.settings[`wrap${axis}`]===undefined?'inherit':scene.settings[`wrap${axis}`]?'closed':'open'} onChange={e=>setting(`wrap${axis}`,e.target.value==='inherit'?undefined:e.target.value==='closed')}><option value="inherit">{t("沿用周期边界")}</option><option value="closed">{t("闭合网格")}</option><option value="open">{t("保持开放")}</option></select></label>)}
    <Control spec={{key:'wrapThreshold',label:t("接缝距离阈值"),group:'',type:'number',min:0,max:1,step:.01,help:t("以曲面包围盒对角线为单位，距离更大的端点保持分离。")}} value={scene.settings.wrapThreshold??.25} onChange={v=>setting('wrapThreshold',v)}/>
    <Control spec={{key:'twistedU',label:t("u 绕行翻转 v"),group:'',type:'toggle'}} value={scene.settings.twistedU??false} onChange={v=>setting('twistedU',v)}/>
  </div></details>;
}
