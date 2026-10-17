import {useI18n} from '../i18n';
import {useEffect,useId,useState} from 'react';
import {Plus,Copy,Trash2,ArrowUp,ArrowDown} from 'lucide-react';
import type {SceneDocument} from '../types';
import {createDefaultSpirographLayer,parseSpirographLayers,estimateSpirographCompletion,convertSingleSpirograph,exploreSpirograph,type SpirographLayer} from '../scenes/spirograph';
import {PaletteEditor} from './PaletteEditor';
import {parseSpirographVersion} from '../engine/spirographModel';
import {withSpirographVersion,withSpirographClock,withSpirographSimulationFps,spirographDrawingEvent} from '../engine/spirographAuthoring';
import {usesSpirographFrameClock,spirographSimulationFps,parseSpirographFrameEvents} from '../engine/spirographFrameConfig';

type LayerEditResult={ok:true}|{ok:false;error:string};

/** Keep incomplete text out of the authored layer document. The layer parser,
 * reached through onCommit, owns numeric ranges; this input never clamps. */
function SpirographNumberDraft({label,value,onCommit}:{label:string;value:number;onCommit:(value:number)=>LayerEditResult}){
  const {t}=useI18n(),errorId=useId();
  const [draft,setDraft]=useState(String(value)),[error,setError]=useState('');
  useEffect(()=>{setDraft(String(value));setError('');},[value]);
  function commit(){
    if(!draft.trim()||!Number.isFinite(Number(draft))){setError(t('请输入有限数值；已保存的参数未改变。'));return;}
    const next=Number(draft);
    if(Object.is(next,value)){setError('');return;}
    const result=onCommit(next);setError(result.ok?'':result.error);
  }
  return <span style={{display:'grid',gap:4,minWidth:0}}><input aria-label={label} type="text" inputMode="decimal" value={draft} aria-invalid={!!error} aria-describedby={error?errorId:undefined}
    onChange={event=>{setDraft(event.target.value);setError('');}} onBlur={commit}
    onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();commit();}else if(event.key==='Escape'){event.preventDefault();setDraft(String(value));setError('');}}}/>
    {error&&<small id={errorId} role="alert" className="export-error">{t(error)}</small>}</span>;
}

function SpirographLayerJsonRepair({raw,onCommit}:{raw:string;onCommit:(raw:string)=>LayerEditResult}){
  const {t}=useI18n(),[draft,setDraft]=useState(raw),[error,setError]=useState('');
  return <div className="field"><p className="muted">{t('图层数据无效。可修复下方 JSON 后应用；未应用的编辑不会改写文档。')}</p>
    <label><span>{t('多图层 JSON')}</span><textarea aria-label={t('多图层 JSON')} rows={8} value={draft} aria-invalid={!!error} onChange={event=>{setDraft(event.target.value);setError('');}}/></label>
    <button onClick={()=>{const result=onCommit(draft);setError(result.ok?'':result.error);}}>{t('应用图层 JSON')}</button>
    {error&&<small role="alert" className="export-error">{t(error)}</small>}
  </div>;
}

export function SpirographEditor({scene,time,completedFrame,onChange}:{scene:SceneDocument;time:number;completedFrame?:number;onChange:(next:SceneDocument)=>void}){
  const {t}=useI18n();
  const [selected,setSelected]=useState(''),[message,setMessage]=useState(''),[explorationSeed,setExplorationSeed]=useState(42);
  if(scene.kind!=='spirograph')return null;
  const version=parseSpirographVersion(scene.settings.spirographVersion);
  const frameClock=usesSpirographFrameClock(scene),simulationFps=frameClock?spirographSimulationFps(scene):60;
  const frameEvents=frameClock?parseSpirographFrameEvents(scene.spirographFrameEvents):[];
  const raw=String(scene.settings.layers??'');
  let layers:SpirographLayer[]=[];let layerProblem='';
  if(raw.trim())try{layers=parseSpirographLayers(raw);}catch(error){layerProblem=error instanceof Error?error.message:String(error);}
  let problem=layerProblem;
  const current=layers.find(l=>l.id===selected)??layers[0],index=layers.indexOf(current);
  function writeRaw(next:string):LayerEditResult{
    try{parseSpirographLayers(next);}catch(error){return{ok:false,error:error instanceof Error?error.message:String(error)};}
    onChange({...scene,settings:{...scene.settings,layers:next}});setMessage('');return{ok:true};
  }
  function write(next:SpirographLayer[],reportError=true):LayerEditResult{const result=writeRaw(JSON.stringify(next));if(!result.ok&&reportError)setMessage(result.error);return result;}
  function update(patch:Partial<SpirographLayer>,reportError=true):LayerEditResult{return write(layers.map(l=>l.id===current.id?{...l,...patch}:l),reportError);}
  function setting(key:string,value:number|string|boolean){onChange({...scene,settings:{...scene.settings,[key]:value}});}
  function drawingEvent(event:'clear'|'restart'|'finish'){
    try{
      const next=spirographDrawingEvent(scene,event,time,completedFrame);onChange(next);
      if(frameClock)setMessage(t('已记录第 {frame} 帧更新前的事件；同帧最后一条命令生效。',{frame:next.spirographFrameEvents!.at(-1)!.beforeFrame}));
      else if(event==='clear')setMessage(`已清除 ${time.toFixed(2)} 秒之前的笔迹；齿轮继续当前位置。`);
      else if(event==='restart')setMessage(`从 ${time.toFixed(2)} 秒重新开始绘制。`);
      else setMessage(version==='local-v1'?'已补齐当前清除点之后的剩余轨迹。':'已记录完成事件；可闭合图层补齐，未闭合图层保持当前位置。');
    }catch(error){setMessage(error instanceof Error?error.message:String(error));}
  }
  function add(copy=false){const layer=copy?{...structuredClone(current),id:crypto.randomUUID(),name:current.name+t(" 副本")}:{...createDefaultSpirographLayer(crypto.randomUUID()),name:t("图层 {0}",{0:layers.length+1})};write([...layers,layer]);setSelected(layer.id);}
  const number=(key:keyof SpirographLayer,label:string)=><label className="field" key={key}><span>{t(label)}</span><SpirographNumberDraft key={`${scene.id}:${current.id}:${key}`} label={t(label)} value={Number(current[key])} onCommit={value=>update({[key]:value},false)}/></label>;
  const toggle=(key:keyof SpirographLayer,label:string)=><label className="field" key={key}><span>{t(label)}</span><input aria-label={t(label)} type="checkbox" checked={!!current[key]} onChange={e=>update({[key]:e.target.checked})}/></label>;
  let completion:ReturnType<typeof estimateSpirographCompletion>|undefined;
  if(layers.length&&!frameClock)try{completion=estimateSpirographCompletion(scene.settings);}catch(error){problem=String(error);}
  const completionTime=completion?.totalSeconds==null?null:completion.totalSeconds+Number(scene.settings.traceStartTime??0);
  return <details open className="inspector-section"><summary>{t("旋轮图层")}</summary><div className="section-body">
    <label className="field"><span>{t('旋轮坐标与动画规则')}</span><select aria-label={t('旋轮坐标与动画规则')} value={version} onChange={event=>{try{onChange(withSpirographVersion(scene,event.target.value));setMessage('');}catch(error){setMessage(String(error));}}}><option value="local-v1">{t('本地原有旋轮规则')}</option><option value="mathart-1.7.8-v1" disabled={!layers.length}>{t('MathArt 1.7.8 旋轮规则')}</option></select></label>
    <p className="muted">{t('切换规则保留已保存数值和动画，并重新解释它们；不是旧作品的无损转换。')}</p>
    <p className="muted">{t('从原生像素视图切回本地规则时，将改用适配视图；其他坐标数值和动画保留。')}</p>
    {scene.spirographFrameEvents!==undefined&&<p className="muted">{t('切回本地规则会停用逐帧时钟，帧事件继续保存；兼容时钟不执行帧事件。')}</p>}
    {version!=='local-v1'&&<p className="muted">{t('场景旋转以度计，正值顺时针；Y 偏移正值向下。旋转动画目标速率以弧度/秒计，与图层绘制相位分开。')}</p>}
    {version!=='local-v1'&&<p className="muted">{t('原生视口使用像素坐标；适配、固定范围、X/Y 轴向缩放、附加旋转及图层相位是本地扩展。旋转动作运行时接管基础旋转速度。')}</p>}
    {version!=='local-v1'&&<>
      <label className="field"><span>{t('旋轮时间推进')}</span><select aria-label={t('旋轮时间推进')} value={frameClock?'source-frame-v1':'compatible'} onChange={event=>{try{onChange(withSpirographClock(scene,event.target.value==='compatible'?undefined:event.target.value));setMessage('');}catch(error){setMessage(error instanceof Error?error.message:String(error));}}}><option value="compatible">{t('兼容时钟 · 保留已有作品')}</option><option value="source-frame-v1">{t('逐帧算法参考 · 离线')}</option></select></label>
      <p className="muted">{t('逐帧参考使用所选模拟帧率推进源算法，不等同于原应用实时帧钟；切换会重新解释绘制与队列时序。')}</p>
      <p className="muted">{t('首次启用会转录仍保留的旧时间戳，无法恢复已删除的事件。旧字段保持保存；已有帧事件不会重复转录。')}</p>
      {frameClock&&<>
        <label className="field"><span>{t('旋轮模拟帧率')}</span><input type="number" aria-label={t('旋轮模拟帧率')} min={1} max={120} step={1} value={simulationFps} onChange={event=>{if(event.target.value==='')return;try{onChange(withSpirographSimulationFps(scene,Number(event.target.value)));setMessage('');}catch(error){setMessage(error instanceof Error?error.message:String(error));}}}/></label>
        <p className="muted">{t('模拟帧率与视频输出帧率不同。修改模拟帧率保留事件帧号，事件对应秒数随之改变。')}</p>
        <p className="muted">{t('绘制按钮修改当前已完成的所选帧；第 0 帧为初态，最早事件在第 1 帧更新前执行。同帧仅最后一条命令生效。')}</p>
        <p className="muted">{t('逐帧时钟持续推进绘制；有效片段时长由同一回放计算，请查看时间线。')}</p>
        <details><summary>{t('帧事件 · {count} 条',{count:frameEvents.length})}</summary>{frameEvents.slice(-20).map((event,index)=>{const position=frameEvents.length-Math.min(20,frameEvents.length)+index;return <div className="layer-toolbar" key={position}><span>{t('第 {frame} 帧前 · {seconds} 秒 · {event}',{frame:event.beforeFrame,seconds:(event.beforeFrame/simulationFps).toFixed(3),event:t(event.type==='clear'?'清除轨迹':event.type==='restart'?'重新开始':'完成轨迹')})}</span><button aria-label={t('删除帧事件 {index}',{index:position+1})} onClick={()=>onChange({...scene,spirographFrameEvents:frameEvents.filter((_,i)=>i!==position)})}><Trash2 size={12}/></button></div>;})}{frameEvents.length>20&&<small>{t('这里只显示最近 20 条；保存文件保留完整事件列表。')}</small>}</details>
      </>}
    </>}
    <div className="explore-actions"><button onClick={()=>drawingEvent('clear')}>{t("清除轨迹")}</button><button onClick={()=>drawingEvent('restart')}>{t("重新开始")}</button><button onClick={()=>drawingEvent('finish')}>{t("完成轨迹")}</button></div>
    {!raw.trim()?<><p className="muted">{t("为每一层配置独立齿轮、笔触与渐变，并按顺序绘制。")}</p><button className="apply-button" onClick={()=>add()}><Plus size={14}/>{t("启用多图层")}</button><button onClick={()=>{try{const result=convertSingleSpirograph(scene.settings);write([{...result.layer,id:crypto.randomUUID(),name:scene.name}]);setMessage(result.warnings.join(' '));}catch(error){setMessage(String(error));}}}>{t("从当前单链创建图层")}</button><small className="muted">{t("原有单链参数会保留；关闭多图层后可继续使用。")}</small></>:<>
      {problem&&<p className="export-error" role="alert">{t(problem)}</p>}
      {layerProblem&&<SpirographLayerJsonRepair key={`${scene.id}:${raw}`} raw={raw} onCommit={writeRaw}/>}
      <div className="layer-list" role="list" aria-label={t("旋轮图层列表")}>{layers.map((layer,i)=><button role="listitem" key={layer.id} aria-current={current.id===layer.id} className={current.id===layer.id?'active':''} onClick={()=>setSelected(layer.id)}><span className="layer-swatch" style={{background:layer.strokeColor}}/>{i+1} · {layer.name}<small>{!layer.enabled?t("停用"):!layer.visible?t("隐藏"):''}</small></button>)}</div>
      <div className="layer-toolbar"><button title={t("添加旋轮图层")} disabled={!!layerProblem||layers.length>=32} onClick={()=>add()}><Plus size={14}/></button>{current&&<><button title={t("复制旋轮图层")} disabled={layers.length>=32} onClick={()=>add(true)}><Copy size={14}/></button><button title={t("上移旋轮图层")} disabled={index<=0} onClick={()=>{const next=[...layers];[next[index-1],next[index]]=[next[index],next[index-1]];write(next);}}><ArrowUp size={14}/></button><button title={t("下移旋轮图层")} disabled={index>=layers.length-1} onClick={()=>{const next=[...layers];[next[index+1],next[index]]=[next[index],next[index+1]];write(next);}}><ArrowDown size={14}/></button><button title={t("删除旋轮图层")} disabled={layers.length===1} onClick={()=>write(layers.filter(l=>l.id!==current.id))}><Trash2 size={14}/></button></>}</div>
      {current&&<>
        <small className="muted">{t('数值在失焦或 Enter 时应用；Escape 恢复已保存值。')}</small>
        <label className="field"><span>{t("图层名称")}</span><input aria-label={t("旋轮图层名称")} value={current.name} onChange={e=>update({name:e.target.value})}/></label>
        {toggle('enabled',t("启用图层"))}{toggle('visible',t("显示图层"))}
        {number('statorRadius',t("定子半径"))}
        <label className="field"><span>{t("定子颜色")}</span><input type="color" aria-label={t("定子颜色")} value={current.statorColor} onChange={e=>update({statorColor:e.target.value})}/></label>
        <div className="rotor-heading"><strong>{t("转子链")}</strong><button title={t("添加转子")} disabled={current.rotors.length>=8} onClick={()=>update({rotors:[...current.rotors,{radius:25,mode:'inside'}]})}><Plus size={13}/></button></div>
        {current.rotors.map((rotor,i)=><div className="rotor-row" key={i}><span>{i+1}</span><SpirographNumberDraft key={`${scene.id}:${current.id}:rotor:${i}:${current.rotors.length}`} label={t("转子 {0} 半径",{0:i+1})} value={rotor.radius} onCommit={radius=>update({rotors:current.rotors.map((r,n)=>n===i?{...r,radius}:r)},false)}/><select aria-label={t("转子 {0} 模式",{0:i+1})} value={rotor.mode} onChange={e=>update({rotors:current.rotors.map((r,n)=>n===i?{...r,mode:e.target.value as 'inside'|'outside'}:r)})}><option value="inside">{t("内旋")}</option><option value="outside">{t("外旋")}</option></select><button title={t("删除转子 {0}",{0:i+1})} disabled={current.rotors.length===1} onClick={()=>update({rotors:current.rotors.filter((_,n)=>n!==i)})}><Trash2 size={12}/></button></div>)}
        {number('penDistance',t("笔距"))}{number('speed',t("绘制速度"))}{number('phase',t("初始相位 · 弧度"))}
        <label className="field"><span>{t("绘制方向")}</span><select aria-label={t("绘制方向")} value={current.direction} onChange={e=>update({direction:Number(e.target.value) as 1|-1})}><option value={1}>{t("正向")}</option><option value={-1}>{t("反向")}</option></select></label>
        {toggle('showGuides',t("显示引导圆"))}{toggle('autoStopOnClosure',t("闭合后停止"))}{number('turns',t("非闭合绘制周数"))}
        <label className="field"><span>{t("图层探索种子")}</span><input aria-label={t("图层探索种子")} type="number" min={0} max={4294967295} value={explorationSeed} onChange={e=>setExplorationSeed(Number(e.target.value)>>>0)}/></label>
        <button onClick={()=>{try{const result=exploreSpirograph(explorationSeed,{width:1280,height:720,rotorCount:current.rotors.length});update({...result.layer,id:current.id,name:current.name});setExplorationSeed((explorationSeed+1)>>>0);setMessage(`已应用闭合候选，周期 ${result.closureTurns.toFixed(2)} 周。`);}catch(error){setMessage(String(error));}}}>{t("探索当前图层")}</button>
        <label className="field"><span>{t("线条颜色")}</span><input type="color" aria-label={t("图层线条颜色")} value={current.strokeColor} onChange={e=>update({strokeColor:e.target.value})}/></label>
        {number('strokeWidth',t("图层线宽"))}{number('opacity',t("图层不透明度"))}{toggle('repeatGradient',t("重复图层渐变"))}
        <details><summary>{t("当前图层色板 ·")}{current.name}</summary><PaletteEditor key={current.id} palette={current.colorPalette??{name:current.name,stops:current.palette.length>1?current.palette:[current.palette[0]??current.strokeColor,current.palette[0]??current.strokeColor],mode:'linear',offset:0,cycles:1}} onChange={colorPalette=>update({colorPalette})}/><button disabled={!current.palette.length&&!current.colorPalette} onClick={()=>{const next={...current,palette:[]};delete next.colorPalette;write(layers.map(l=>l.id===current.id?next:l));}}>{t("使用纯色")}</button></details>
        {!frameClock&&<label className="field"><span>{t("按时间逐层绘制")}</span><input aria-label={t("按时间逐层绘制")} type="checkbox" checked={scene.settings.animate===true} onChange={e=>setting('animate',e.target.checked)}/></label>}
        {['startEaseEnabled','endEaseEnabled','fadeInStatorsOnStart','fadeOutStatorsOnFinish'].map((key,i)=><label className="field" key={key}><span>{[t("起笔缓动"),t("收笔缓动"),t("引导圆淡入"),t("完成后引导圆淡出")][i]}</span><input aria-label={[t("起笔缓动"),t("收笔缓动"),t("引导圆淡入"),t("完成后引导圆淡出")][i]} type="checkbox" checked={scene.settings[key]===true} onChange={e=>setting(key,e.target.checked)}/></label>)}
        {completion&&<p className="muted">{completion.totalSeconds===null?t(version==='local-v1'?'当前图层没有有限的完成时间':'在当前回放范围内尚未确认完成'):t("完整绘制约 {0} 秒",{0:completion.totalSeconds.toFixed(2)})}</p>}
        {completionTime!==null&&completionTime>0&&completionTime<=86400&&<button onClick={()=>{onChange({...scene,timeline:{...scene.timeline,duration:completionTime}});setMessage('时间线已匹配绘制起点与完整绘制时长');}}>{t("按完整绘制设置动画时长")}</button>}
        {completion?.warnings.map(w=><small className="muted" key={w}>{t(w)}</small>)}
      </>}
      <button onClick={()=>{const local=version!=='local-v1'?withSpirographVersion(scene,'local-v1'):scene;onChange({...local,settings:{...local.settings,layers:''}});if(version!=='local-v1')setMessage('已切回本地单链规则；保留的坐标数值按本地规则解释。');}}>{t(version==='local-v1'?'返回单链模式':'切回本地单链模式')}</button>
    </>}
    {message&&<p role="status" className="muted">{t(message)}</p>}
  </div></details>;
}
