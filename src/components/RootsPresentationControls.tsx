import {usesRootsCameraTimeline,usesRootsGradientTimeline,withRootsCameraTimeline,withRootsSceneTimeline} from '../engine/rootsCameraTimeline';
import {useEffect,useState} from 'react';
import {useI18n} from '../i18n';
import type {RasterOutput,SceneDocument} from '../types';
import {defaultRootsPendingConfiguration,defaultRootsPresentationConfiguration,type RootsPresentationConfiguration} from '../engine/rootsPresentationConfig';
import {usesRootsNativePresentation,withRootsPresentation} from '../engine/rootsPresentationAuthoring';
import type {RootsEditorIntent} from '../engine/rootsEditIntent';

type Props={scene:SceneDocument;onChange:(scene:SceneDocument,intent:RootsEditorIntent)=>void;onRestart?:()=>void;facts?:RasterOutput['rootsPresentation']};
function PresentationNumber({label,value,step,onChange}:{label:string;value:number;step:number;onChange:(value:number)=>void}){
 const [draft,setDraft]=useState(String(value));
 useEffect(()=>setDraft(String(value)),[value]);
 return <label className="field"><span>{label}</span><input aria-label={label} type="number" value={draft} step={step} onChange={event=>{
  setDraft(event.target.value);const n=event.target.valueAsNumber;
  if(event.target.value.trim()&&Number.isFinite(n))onChange(n);
 }} onBlur={()=>{if(!draft.trim()||!Number.isFinite(Number(draft)))setDraft(String(value));}}/></label>;
}
export function RootsPresentationControls({scene,onChange,onRestart,facts}:Props){
 const {t}=useI18n(),active=usesRootsNativePresentation(scene);
 const current=scene.rootsPresentation??defaultRootsPresentationConfiguration();
 const [error,setError]=useState('');
 useEffect(()=>{setError('');},[scene.id,current.mode]);
 if(scene.kind!=='roots')return null;
 function commit(next:RootsPresentationConfiguration,intent:RootsEditorIntent){try{onChange(withRootsPresentation(scene,next),intent);setError('');}catch(error){setError(error instanceof Error?error.message:String(error));}}
 function number(label:string,value:number,write:(value:number)=>RootsPresentationConfiguration,intent:RootsEditorIntent,step=.01){return <PresentationNumber key={label} label={t(label)} value={value} step={step} onChange={n=>commit(write(n),intent)}/>;}
 const camera=current.camera,transform=current.transform,cameraTimeline=usesRootsCameraTimeline(scene),sceneTimeline=usesRootsGradientTimeline(scene);
 function sceneAnimation(enabled:boolean){try{onChange(withRootsSceneTimeline(scene,enabled),'roots-apply');setError('');}catch(error){setError(error instanceof Error?error.message:String(error));}}
 function cameraAnimation(enabled:boolean){try{const next=withRootsCameraTimeline(scene,enabled);if(!enabled&&next.rootsPresentation){next.rootsPresentation={...next.rootsPresentation};delete next.rootsPresentation.previewMode;}onChange(next,'roots-apply');setError('');}catch(error){setError(error instanceof Error?error.message:String(error));}}
 return <details open className="inspector-section"><summary>{t('复根空间显示')}</summary><div className="section-body">
  {!active?<>
   <p className="muted">{t('启用空间显示会使用源系数表、源色板和渐进采样；已有本地公式与颜色保留。')}</p>
   <button onClick={()=>commit({...current,model:'mathart-1.7.8-v1',pending:current.pending??defaultRootsPendingConfiguration()},'roots-apply')}>{t('启用 MathArt 空间显示')}</button>
  </>:<>
   <label className="check-field"><input aria-label={t('后台实时采样')} type="checkbox" checked={current.previewMode==='live-worker-arrival-v1'} onChange={event=>{
    try{const configuration={...current,pending:current.pending??defaultRootsPendingConfiguration()};if(event.target.checked)configuration.previewMode='live-worker-arrival-v1';else delete configuration.previewMode;
     const next=withRootsPresentation(scene,configuration);onChange(event.target.checked?withRootsSceneTimeline(next,true):next,'roots-apply');setError('');}catch(error){setError(error instanceof Error?error.message:String(error));}
   }}/>{t('后台实时采样')}</label>
   <p className="muted">{t(current.previewMode==='live-worker-arrival-v1'?'暂停动画后仍继续计算并画完剩余点；重新开始会清除当前画面。':'此作品保留按时间顺序回放；启用后台实时采样会重新开始。')}</p>
   <label className="field"><span>{t('空间显示方式')}</span><select aria-label={t('空间显示方式')} value={current.mode} onChange={event=>commit({...current,mode:event.target.value as RootsPresentationConfiguration['mode']},'roots-stage')}><option value="density">{t('密度图')}</option><option value="point-cloud">{t('三维点云')}</option></select></label>
   {!current.pending?<>
    <p className="muted">{t('此作品保留即时绘制规则；启用批次队列会改变中间画面，并从初始采样重新开始。')}</p>
    <button onClick={()=>commit({...current,pending:defaultRootsPendingConfiguration()},'roots-apply')}>{t('启用批次队列并重新采样')}</button>
   </>:<>
    {current.mode==='density'?<>
     {number('每帧基础绘制点数',current.pending.maxSplatPointsPerFrame,value=>({...current,pending:{...current.pending!,maxSplatPointsPerFrame:value}}),'roots-apply',1)}
     <p className="muted">{t('积压较多时会自适应增加绘制点数；修改基础值会重建本地实例并重新采样。')}</p>
    </>:<p className="muted">{t('点云按已完成批次接收根点；每帧基础绘制点数仅影响密度图，保留值不应用于点云。')}</p>}
   </>}
   <p className="muted">{t('密度图的缩放、平移、空间变换和画布尺寸变化会清除已有墨迹，后续采样继续；调色和角度调整保留墨迹。')}</p>
   {(['X','Y','Z'] as const).map((axis,index)=>number('空间缩放 '+axis,transform.scale[index],value=>({...current,transform:{...transform,scale:transform.scale.map((n,i)=>i===index?value:n) as [number,number,number]}}),'roots-transform'))}
   {(['X','Y','Z'] as const).map((axis,index)=>number('空间偏移 '+axis,transform.offset[index],value=>({...current,transform:{...transform,offset:transform.offset.map((n,i)=>i===index?value:n) as [number,number,number]}}),'roots-transform'))}
   {number('复平面旋转（度）',transform.rotationDegrees,value=>({...current,transform:{...transform,rotationDegrees:value}}),'roots-transform',1)}
   {(['phi','theta','gamma'] as const).map(key=>number('相机 '+key+'（弧度）',camera[key],value=>({...current,camera:{...camera,[key]:value}}),'roots-stage'))}
   {(['X','Y','Z'] as const).map((axis,index)=>number('相机中心 '+axis,camera.center[index],value=>({...current,camera:{...camera,center:camera.center.map((n,i)=>i===index?value:n) as [number,number,number]}}),'roots-stage'))}
   {number('空间相机缩放',camera.zoom,value=>({...current,camera:{...camera,zoom:value}}),'roots-stage')}
   {number('空间相机焦距',camera.focalDistance,value=>({...current,camera:{...camera,focalDistance:value}}),'roots-stage',1)}
   {number('空间点尺寸',current.dotSize,value=>({...current,dotSize:value}),'roots-tone',.001)}
   <label className="check-field"><input aria-label={t('保留点云画面拖影')} type="checkbox" checked={current.accumulation.enabled} onChange={event=>commit({...current,accumulation:{...current.accumulation,enabled:event.target.checked}},'roots-apply')}/>{t('保留点云画面拖影')}</label>
   {current.accumulation.enabled&&number('画面淡出强度',current.accumulation.fadeAlpha,value=>({...current,accumulation:{...current.accumulation,fadeAlpha:value}}),'roots-apply',1)}
   <p className="muted">{t('点云拖影随绘制次数累积；保存作品保留参数，重新打开会从新采样开始。')}</p>
   <p className="muted">{t(sceneTimeline?'空间相机参数定义起始状态；完整源场景队列执行相机与渐变动作，数值轨道保留但不执行。':'空间相机参数定义起始状态；源相机队列只执行持续环绕、停止环绕和缩放，旧平面轨道保留。')}</p>
   {sceneTimeline?<button onClick={()=>cameraAnimation(true)}>{t('返回仅相机队列')}</button>:<>
    <button onClick={()=>cameraAnimation(!cameraTimeline)}>{t(cameraTimeline?'停用源相机队列':'启用源相机队列')}</button>
    <button onClick={()=>sceneAnimation(true)}>{t(cameraTimeline?'升级为完整源场景队列':'启用完整源场景队列')}</button>
   </>}
   {cameraTimeline&&<p className="muted">{t(sceneTimeline?'在时间线中编辑和重排片段及渐变动作；相机角速度为弧度/秒，渐变速度为度/秒。缩放可为零或负数。':'在时间线中编辑和重排相机片段；切换队列规则会保留已有片段。角速度单位为弧度/秒，缩放可为零或负数。')}</p>}
   {!sceneTimeline&&<p className="muted">{t('升级会保留已有动作；缺少渐变配置的旧动作需要明确设置后才执行。')}</p>}
   <button onClick={()=>commit({...current,model:'local-v1'},'roots-apply')}>{t('返回本地平面显示')}</button>
   {onRestart&&<button onClick={onRestart}>{t('重新开始空间采样')}</button>}
   {facts&&<p role="status" data-testid="roots-presentation-facts">{t('空间画面：{mode} · 本次新增 {count} 个根点',{mode:t(facts.mode==='density'?'密度图':'三维点云'),count:facts.newRawPoints.toLocaleString()})}</p>}
  </>}
  {error&&<p role="alert">{t(error)}</p>}
 </div></details>;
}
