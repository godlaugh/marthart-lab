import {useRef,useState,type ReactNode,type PointerEvent as ReactPointerEvent} from 'react';
import {useI18n} from '../i18n';
import {defaultSourceCosinePalette,defaultSourceCurvePalette,generateSourceCosinePalette,generateSourceCurvePalette,normalizeSourceCosinePalette,normalizeSourceCurvePalette,randomizeSourceCosinePalette,randomizeSourceCurvePalette,type SourceCosinePaletteState,type SourceCurvePaletteState,type SourceCurvePoint,type SourceGradientPaletteMode,type SourceGradientPaletteCommit} from '../engine/sourceGradientPaletteGeneration';
import {SourceBouncingNumberField} from './SourceBouncingNumberField';
import {SourceManualPaletteGenerator} from './SourceManualPaletteGenerator';

type Mode=SourceGradientPaletteMode;
export interface SourceGradientPaletteController {
 mode:Mode;cosine:Omit<SourceCosinePaletteState,'colorCount'>;curve:Partial<Omit<SourceCurvePaletteState,'colorCount'>>;
 onCommit:(commit:SourceGradientPaletteCommit)=>string|undefined;
 description:string;
}
type Channel='red'|'green'|'blue';
const channels:readonly Channel[]=['red','green','blue'];
const channelNames={red:'红 R',green:'绿 G',blue:'蓝 B'},channelColors={red:'#f77882',green:'#68d9a4',blue:'#6daafa'};
const clamp=(n:number,a=0,b=1)=>Math.max(a,Math.min(b,n)),F=Math.fround;
const countRules={integer:true,min:2,max:25,precision:0,step:1};
const scalarRules={min:0,max:1,precision:3,step:.01},frequencyRules={...scalarRules,min:.5,max:3};

/** Default callers keep generator parameters while mounted and persist colors.
 * Controlled callers own flags/parameters and receive one atomic user action.
 * Count and Manual snapshot are always transient; hydration never commits. */
export function SourceGradientPaletteEditor<T>({source,colors,onGenerate,onRestore,children,controller}:{controller?:SourceGradientPaletteController;source:T;colors:readonly string[];onGenerate:(colors:string[],resetSelection?:boolean)=>string|undefined;onRestore:(source:T)=>string|undefined;children:ReactNode}){
 const {t}=useI18n(),[localMode,setMode]=useState<Mode>('manual'),[count,setCount]=useState(()=>clamp(colors.length>=2?colors.length:8,2,25));
 const [localCosine,setCosine]=useState(defaultSourceCosinePalette),[localCurve,setCurve]=useState(defaultSourceCurvePalette),[channel,setChannel]=useState<Channel>('red'),[selected,setSelected]=useState<string|null>(null),[error,setError]=useState('');
 // Missing authored channels use constructor ramps, never a previous edit.
 // Keep this seed separate from the transient draft owned by generic callers.
 const curveDefaults=useRef(localCurve);
 const mode=controller?.mode??localMode,cosine:SourceCosinePaletteState=controller?{...controller.cosine,colorCount:count}:localCosine,curve:SourceCurvePaletteState=controller?{...curveDefaults.current,...controller.curve,colorCount:count}:localCurve;
 const manual=useRef<{value:T}|null>(null),svg=useRef<SVGSVGElement>(null),drag=useRef<string|null>(null);
 const current=useRef({curve,channel});current.current={curve,channel};
 const preview=mode==='cosine'?generateSourceCosinePalette({...cosine,colorCount:count}):mode==='curve'?generateSourceCurvePalette({...curve,colorCount:count}):undefined;
 const previewColors=preview?.ok?preview.value:colors;
 const points=curve[channel],selectedIndex=Math.max(0,points.findIndex(p=>p.id===selected)),selectedPoint=points[selectedIndex];
 function apply(nextMode:Exclude<Mode,'manual'>,nextCosine=cosine,nextCurve=curve,nextCount=count,kind:SourceGradientPaletteCommit['kind']='change'):boolean {
  const normalized=nextMode==='cosine'?normalizeSourceCosinePalette({...nextCosine,colorCount:nextCount}):normalizeSourceCurvePalette({...nextCurve,colorCount:nextCount});
  if(!normalized.ok){setError(normalized.error.reason);return false;}
  const generated=nextMode==='cosine'?generateSourceCosinePalette(normalized.value):generateSourceCurvePalette(normalized.value);
  if(!generated.ok){setError(generated.error.reason);return false;}
  const commit:SourceGradientPaletteCommit=nextMode==='cosine'?{kind,mode:nextMode,state:normalized.value as SourceCosinePaletteState,colors:generated.value}:{kind,mode:nextMode,state:normalized.value as SourceCurvePaletteState,colors:generated.value};
  const failure=controller?controller.onCommit(commit):onGenerate(generated.value);if(failure){setError(failure);return false;}
  if(!controller){if(nextMode==='cosine')setCosine(normalized.value as SourceCosinePaletteState);else setCurve(normalized.value as SourceCurvePaletteState);}
  setCount(nextCount);setError('');return true;
 }
 function changeMode(next:Mode){
  if(next===mode)return;
  if(next==='manual'){
   const failure=manual.current?onRestore(manual.current.value):controller?onRestore(source):undefined;if(failure){setError(failure);return;}
   manual.current=null;setMode(next);setError('');return;
  }
  const snapshot=mode==='manual'?{value:structuredClone(source)}:manual.current;
  const nextCurve=next==='curve'&&[curve.red,curve.green,curve.blue].every(points=>points.length===0)?randomizeSourceCurvePalette(curve):undefined;
  if(nextCurve&&!nextCurve.ok){setError(nextCurve.error.reason);return;}
  if(apply(next,cosine,nextCurve?.ok?nextCurve.value:curve,count,'mode')){manual.current=snapshot;setMode(next);}
 }
 function editPoint(id:string,x:number,y:number){
  const {curve:latest,channel:key}=current.current,list=latest[key],i=list.findIndex(p=>p.id===id);if(i<0)return t('色板生成失败');
  const lo=i>0?F(list[i-1].x+F(.002)):0,hi=i<list.length-1?F(list[i+1].x-F(.002)):1;
  const moved=list.map((p,j)=>j===i?{...p,x:F(clamp(clamp(F(x)),Math.min(lo,hi),Math.max(lo,hi))),y:F(clamp(F(y)))}:p);
  if(!apply('curve',cosine,{...latest,[key]:moved}))return t('色板生成失败');
  setSelected(id);return undefined;
 }
 function coordinates(e:{clientX:number;clientY:number}):[number,number]{const box=svg.current!.getBoundingClientRect();return[F(clamp((e.clientX-box.left)/box.width)),F(clamp(1-(e.clientY-box.top)/box.height))];}
 function addPoint(x=.5,y=.5){const next:SourceCurvePoint={id:crypto.randomUUID(),x:F(clamp(x)),y:F(clamp(y))};if(apply('curve',cosine,{...curve,[channel]:[...points,next]}))setSelected(next.id);}
 function removePoint(id:string){if(points.length<=2)return;if(apply('curve',cosine,{...curve,[channel]:points.filter(p=>p.id!==id)}))setSelected(null);}
 function startDrag(e:ReactPointerEvent<SVGCircleElement>,id:string){if(e.button!==0)return;e.preventDefault();e.stopPropagation();drag.current=id;setSelected(id);e.currentTarget.setPointerCapture(e.pointerId);}
 function randomize(){
  if(mode==='manual')return;
  const next=mode==='cosine'?randomizeSourceCosinePalette({...cosine,colorCount:count}):randomizeSourceCurvePalette({...curve,colorCount:count});
  if(!next.ok){setError(next.error.reason);return;}
  if(mode==='cosine')apply(mode,next.value as SourceCosinePaletteState);else{apply(mode,cosine,next.value as SourceCurvePaletteState);setSelected(null);}
 }
 return <div className="source-palette-editor" data-testid="source-gradient-palette-editor">
  <label className="field"><span>{t('调色板模式')}</span><select aria-label={t('源色板生成模式')} value={mode} onChange={e=>changeMode(e.target.value as Mode)}><option value="manual">{t('手动 Manual')}</option><option value="cosine">{t('余弦 Cosine')}</option><option value="curve">{t('RGB 曲线')}</option></select></label>
  {mode==='manual'?<>{children}<SourceManualPaletteGenerator colors={colors} onGenerate={(next,resetSelection)=>setError(onGenerate(next,resetSelection)??'')}/></>:<>
   <SourceBouncingNumberField id="generator-count" label={t('生成颜色数量')} value={count} rules={countRules} onCommit={n=>apply(mode,cosine,curve,n)?undefined:t('色板生成失败')}/>
   <div role="img" aria-label={t('生成色板预览')} className="source-generated-swatches">{previewColors.map((color,i)=><span key={i} style={{background:color}} title={color}/>)}</div>
   {mode==='cosine'?<>
    <p className="muted">{t('RGB(t) = A + B × cos(2π × (C × t + D))；输出限制在 0–1。')}</p>
    {(['a','b','c','d'] as const).map(key=><fieldset key={key}><legend>{t('余弦参数 {name}',{name:key.toUpperCase()})}</legend>{([0,1,2] as const).map(i=><SourceBouncingNumberField key={i} id={`generator-${key}-${i}`} label={`${key.toUpperCase()} ${['R','G','B'][i]}`} value={cosine[key][i]} rules={key==='c'?frequencyRules:scalarRules} onCommit={n=>{const next=structuredClone(cosine);next[key][i]=n;return apply('cosine',next)?undefined:t('色板生成失败');}}/>)}</fieldset>)}
   </>:<>
    <label className="field"><span>{t('曲线通道')}</span><select aria-label={t('曲线通道')} value={channel} onChange={e=>{setChannel(e.target.value as Channel);setSelected(null);}}>{channels.map(key=><option key={key} value={key}>{t(channelNames[key])}</option>)}</select></label>
    <svg ref={svg} data-testid="source-gradient-curve" aria-label={t('RGB 曲线编辑区')} viewBox="0 0 300 160" preserveAspectRatio="none" className="source-generator-curve" onClick={e=>{if(e.target!==e.currentTarget)return;const [x,y]=coordinates(e),box=e.currentTarget.getBoundingClientRect();let near:SourceCurvePoint|undefined,best=14;for(const p of points){const distance=Math.hypot((p.x-x)*box.width,(p.y-y)*box.height);if(distance<=best&&(!near||distance<best)){near=p;best=distance;}}if(near)setSelected(near.id);else addPoint(x,y);}}>
     {channels.map(key=><polyline key={key} pointerEvents="none" fill="none" stroke={channelColors[key]} strokeOpacity={channel===key?1:.2} strokeWidth="2" points={curve[key].map(p=>`${p.x*300},${(1-p.y)*160}`).join(' ')}/>)}
     {points.map((p,i)=><circle key={p.id} data-point-id={p.id} tabIndex={0} role="button" aria-label={t('源曲线节点 {0}',{0:i+1})} cx={p.x*300} cy={(1-p.y)*160} r={p.id===selected?6:5} fill={channelColors[channel]} stroke="var(--panel)" onClick={e=>{e.stopPropagation();setSelected(p.id);}} onDoubleClick={e=>{e.stopPropagation();removePoint(p.id);}} onPointerDown={e=>startDrag(e,p.id)}
      onPointerMove={e=>{if(drag.current===p.id){const [x,y]=coordinates(e);editPoint(p.id,x,y);}}}
      onPointerUp={e=>{drag.current=null;e.currentTarget.releasePointerCapture(e.pointerId);}} onPointerCancel={()=>{drag.current=null;}}
      onKeyDown={e=>{if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();removePoint(p.id);}else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();const delta=e.shiftKey?.1:.01;editPoint(p.id,p.x+(e.key==='ArrowLeft'?-delta:e.key==='ArrowRight'?delta:0),p.y+(e.key==='ArrowDown'?-delta:e.key==='ArrowUp'?delta:0));}}}/>)}
    </svg>
    {selectedPoint&&<><SourceBouncingNumberField id="generator-point-x" label={t('曲线 X')} value={selectedPoint.x} rules={scalarRules} onCommit={n=>editPoint(selectedPoint.id,n,selectedPoint.y)}/>
    <SourceBouncingNumberField id="generator-point-y" label={t('曲线 Y')} value={selectedPoint.y} rules={scalarRules} onCommit={n=>editPoint(selectedPoint.id,selectedPoint.x,n)}/></>}
    <div className="explore-actions"><button type="button" onClick={()=>addPoint()}>{t('添加节点')}</button><button type="button" disabled={points.length<=2} onClick={()=>{if(selectedPoint)removePoint(selectedPoint.id);}}>{t('删除节点')}</button></div>
    <p className="muted">{t('曲线按直线连接各节点。单击空白处添加、拖动调整、双击删除；缺少端点时延续最近颜色。')}</p>
   </>}
   <div className="explore-actions"><button type="button" onClick={randomize}>{t('随机生成参数')}</button><button type="button" onClick={()=>{if(apply(mode,cosine,curve,count,'bake')){manual.current=null;setMode('manual');}}}>{t('应用为手动色板')}</button></div>
   <p className="muted">{t(controller?.description??'参数修改立即更新作品。切回手动可恢复原色板；应用为手动会保留生成结果。重新打开项目保留颜色，生成参数恢复默认。')}</p>
  </>}
  {preview&&!preview.ok&&<p role="alert">{t(preview.error.reason)}</p>}
  {error&&<p role="alert">{t(error)}</p>}
 </div>;
}
