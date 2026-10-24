import {useEffect,useRef,useState,type PointerEvent} from 'react';
import {Plus,RotateCcw,Trash2} from 'lucide-react';
import type {Settings} from '../types';
import {useI18n} from '../i18n';
import {insetBouncingBoundary} from '../scenes/bouncing';
import {appendPolygonMidpoint,parsePolygonRows,polygonEditorView,readPolygonRows,resetPolygonRows,type PolygonRow} from '../engine/polygonEditor';

import {SOURCE_BOUNCING_DEFAULT_POLYGON,type SourceBouncingConfiguration} from '../engine/sourceBouncingConfig';
import {sourcePolygonRows,sourcePolygonCoordinate,parseSourcePolygonRows,appendSourcePolygonMidpoint,regularSourcePolygon} from '../engine/sourceBouncingPolygonEditor';

type Props={settings:Settings;source?:never;onApply:(polygon:string)=>void}|{source:SourceBouncingConfiguration;settings?:never;onApply:(vertices:number[])=>void};
/** Shared interaction surface with separate geometry owners. Source documents
 * never pass through the legacy convexity/inset validator. */
export function BouncingPolygonEditor(props:Props) {
  const {settings,source}=props;
  const {t}=useI18n();
  const [initial]=useState(()=>{try{return{rows:source?sourcePolygonRows(source.polygonVertices):readPolygonRows(settings!),error:''};}catch(e){return{rows:[] as PolygonRow[],error:e instanceof Error?e.message:String(e)};}});
  const [rows,setRows]=useState(initial.rows),[selected,setSelected]=useState(0),[view,setView]=useState(()=>polygonEditorView(initial.rows)),[message,setMessage]=useState('');
  const svg=useRef<SVGSVGElement>(null),drag=useRef<{id:number;index:number;before:PolygonRow[]}|null>(null);
  const canonical=source?JSON.stringify(source.polygonVertices):'',acknowledged=useRef(canonical);
  useEffect(()=>{if(source&&canonical!==acknowledged.current){const next=sourcePolygonRows(source.polygonVertices);setRows(next);setView(polygonEditorView(next));setSelected(0);setMessage('');acknowledged.current=canonical;}},[source,canonical]);
  function parseDraft(next:PolygonRow[]){
    if(source){const flat=parseSourcePolygonRows(source,next);return{vertices:sourcePolygonRows(flat).map(p=>[Number(p.x),Number(p.y)] as [number,number]),convex:undefined};}
    const facts=parsePolygonRows(next);insetBouncingBoundary({kind:'polygon',vertices:facts.vertices},Number(settings!.collisionRadius??0));return facts;
  }
  function apply(next:PolygonRow[],fit=false){
    setRows(next);if(fit)setView(polygonEditorView(next));
    if(!source){setMessage('');return;}
    try{const facts=parseDraft(next);if(props.source){const vertices=facts.vertices.flat();acknowledged.current=JSON.stringify(vertices);next=sourcePolygonRows(vertices);props.onApply(vertices);}setRows(next);if(fit)setView(polygonEditorView(next));setMessage('');}
    catch(e){setMessage(e instanceof Error?e.message:String(e));}
  }
  let error='';let convex:boolean|undefined;try{convex=parseDraft(rows).convex;}catch(e){error=e instanceof Error?e.message:String(e);}
  const baseline=source?sourcePolygonRows(source.polygonVertices):initial.rows;
  const dirty=JSON.stringify(rows)!==JSON.stringify(baseline);
  const px=(x:number)=>140+(x-view.x)/view.span*280,py=(y:number)=>140+(source?1:-1)*(y-view.y)/view.span*280;
  function change(index:number,key:'x'|'y',value:string,commit=false){const next=rows.map((p,i)=>i===index?{...p,[key]:source&&commit&&value.trim()&&Number.isFinite(Number(value))?String(sourcePolygonCoordinate(Number(value))):value}:p);if(commit&&source)apply(next);else setRows(next);setMessage('');}
  function remove(index:number){if(rows.length<=3)return;apply(rows.filter((_,i)=>i!==index));setSelected(Math.max(0,Math.min(index,rows.length-2)));setMessage('');}
  function begin(e:PointerEvent<SVGCircleElement>,index:number){if(drag.current)return;e.preventDefault();e.currentTarget.focus();setSelected(index);drag.current={id:e.pointerId,index,before:rows.map(p=>({...p}))};svg.current?.setPointerCapture(e.pointerId);}
  function move(e:PointerEvent<SVGSVGElement>){const active=drag.current;if(!active||e.pointerId!==active.id)return;const box=e.currentTarget.getBoundingClientRect();if(!box.width||!box.height)return;const x=view.x+((e.clientX-box.left)/box.width-.5)*view.span,y=view.y+(source?1:-1)*((e.clientY-box.top)/box.height-.5)*view.span;setRows(current=>current.map((p,i)=>i===active.index?{x:String(source?sourcePolygonCoordinate(x):Number(x.toPrecision(12))),y:String(source?sourcePolygonCoordinate(y):Number(y.toPrecision(12)))}:p));setMessage('');}
  function cancel(){if(drag.current)setRows(drag.current.before);drag.current=null;}
  return <details open className="inspector-section"><summary>{t('多边形顶点编辑')}</summary><div className="section-body polygon-editor">
    <p className="muted">{source?t('拖动结束或提交坐标后更新边界。Y 轴向下；编辑坐标范围为 −2 到 2。方向键微调，Shift 加速。'):t('拖动顶点或输入坐标。Y 轴向上；应用后更新粒子边界。方向键微调，Shift 加速。')}</p>
    {initial.error&&!dirty&&<p role="alert">{t(initial.error)}</p>}
    <svg ref={svg} role="group" aria-label={t('多边形编辑画布')} viewBox="0 0 280 280" className="polygon-canvas" onPointerMove={move} onPointerUp={e=>{if(drag.current?.id===e.pointerId){drag.current=null;if(source)apply(rows);}}} onPointerCancel={e=>{if(drag.current?.id===e.pointerId)cancel();}} onLostPointerCapture={e=>{if(drag.current?.id===e.pointerId)cancel();}} onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();cancel();}}}>
      <line x1={0} x2={280} y1={py(0)} y2={py(0)} className="polygon-axis"/><line y1={0} y2={280} x1={px(0)} x2={px(0)} className="polygon-axis"/>
      <polygon points={rows.filter(p=>p.x.trim()&&p.y.trim()&&Number.isFinite(Number(p.x))&&Number.isFinite(Number(p.y))).map(p=>`${px(Number(p.x))},${py(Number(p.y))}`).join(' ')} className={error?'polygon-outline invalid':'polygon-outline'}/>
      {rows.map((p,i)=>p.x.trim()&&p.y.trim()&&Number.isFinite(Number(p.x))&&Number.isFinite(Number(p.y))?<g key={i}><circle tabIndex={0} role="button" aria-label={t('多边形顶点 {0}',{0:i+1})} aria-pressed={selected===i} cx={px(Number(p.x))} cy={py(Number(p.y))} r={selected===i?7:5} className="polygon-point" onPointerDown={e=>begin(e,i)} onFocus={()=>setSelected(i)} onClick={()=>setSelected(i)} onKeyDown={e=>{if(e.key==='Delete'){e.preventDefault();remove(i);}if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();const step=source?(e.shiftKey ? .5 : .05):view.span*(e.shiftKey ? .05 : .005),key=e.key==='ArrowLeft'||e.key==='ArrowRight'?'x':'y',sign=e.key==='ArrowLeft'||e.key===(source?'ArrowUp':'ArrowDown')?-1:1;change(i,key,String(Number(p[key])+sign*step),!!source);}}}/><text x={px(Number(p.x))+9} y={py(Number(p.y))-9} className="polygon-number">{i+1}</text></g>:null)}
    </svg>
    <div className="explore-actions"><button onClick={()=>setView(polygonEditorView(rows))}>{t('适配顶点视图')}</button><button onClick={()=>{const next=source?sourcePolygonRows(SOURCE_BOUNCING_DEFAULT_POLYGON):resetPolygonRows();apply(next,true);setSelected(0);setMessage('');}}><RotateCcw size={13}/>{t('重置六顶点轮廓')}</button></div>
    {source&&<div className="source-polygon-presets">
      <div className="explore-actions">{([3,6] as const).map(sides=><button key={sides} data-testid={`source-polygon-${sides}`} onClick={()=>{apply(sourcePolygonRows(regularSourcePolygon(sides,.6)),true);setSelected(0);}}>{t(sides===3?'三角形容器':'正六边形容器')}</button>)}</div>
      {(rows.length===3||rows.length===6)&&<label className="field"><span>{t('规则多边形半径')}</span><input key={canonical} data-testid="source-polygon-radius" aria-label={t('规则多边形半径')} type="number" step="0.05" defaultValue={Number(Math.max(...sourcePolygonRows(source.polygonVertices).map(p=>Math.hypot(Number(p.x),Number(p.y)))).toFixed(3))} onBlur={e=>{if(e.currentTarget.value===e.currentTarget.defaultValue)return;const n=Number(e.currentTarget.value);if(!e.currentTarget.value.trim()||!Number.isFinite(n)){setMessage('请输入有限数值');return;}try{apply(sourcePolygonRows(regularSourcePolygon(rows.length as 3|6,n)),true);}catch(error){setMessage(error instanceof Error?error.message:String(error));}}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/></label>}
    </div>}
    <div className="polygon-rows" role="group" aria-label={t('多边形坐标列表')}>{rows.map((p,i)=><div className={selected===i?'polygon-row selected':'polygon-row'} key={i}><button aria-label={t('选择顶点 {0}',{0:i+1})} onClick={()=>setSelected(i)}>{i+1}</button>{(['x','y'] as const).map(key=><input key={key} type="number" step={source ? .05 : 'any'} aria-label={t('顶点 {0} {1}',{0:i+1,1:key.toUpperCase()})} value={p[key]} onFocus={()=>setSelected(i)} onChange={e=>change(i,key,e.target.value)} onBlur={e=>{if(source&&e.target.value!==baseline[i]?.[key])change(i,key,e.target.value,true);}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/>)}<button disabled={rows.length<=3} aria-label={t('删除顶点 {0}',{0:i+1})} onClick={()=>remove(i)}><Trash2 size={13}/></button></div>)}</div>
    <button disabled={rows.length>=64||!!error} onClick={()=>{try{apply(source?sourcePolygonRows(appendSourcePolygonMidpoint(parseSourcePolygonRows(source,rows))):appendPolygonMidpoint(rows));setSelected(rows.length);setMessage('');}catch(e){setMessage(e instanceof Error?e.message:String(e));}}}><Plus size={13}/>{t('添加首尾边中点')}</button>
    {!error&&convex===false&&<p role="status" className="muted">{t('当前为凹多边形，使用 CPU 点粒子碰撞；非零碰撞半径需要凸多边形。')}</p>}
    {error&&<p className="export-error" role="alert">{t(error)}</p>}
    <div className="explore-actions">{!source&&<button className="apply-button" disabled={!dirty||!!error} onClick={()=>{if(!props.source)props.onApply(JSON.stringify(parseDraft(rows).vertices));setMessage('顶点已应用');}}>{t('应用多边形')}</button>}<button disabled={!dirty} onClick={()=>{setRows(baseline);setView(polygonEditorView(baseline));setSelected(0);setMessage('');}}>{t('撤销顶点编辑')}</button></div>
    {message&&<p role="status">{t(message)}</p>}
  </div></details>;
}
