import {useI18n} from '../i18n';
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import type { Palette, PaletteCurvePoint, PaletteCurves } from '../types';
import { PALETTES, DEFAULT_COSINE, DEFAULT_CURVES, MAX_CURVE_POINTS, MAX_EDITABLE_PALETTE_STOPS, MAX_PALETTE_IMPORT_BYTES, bakePalette, curveValue, insertPaletteStop, movePaletteStop, paletteBaseColor, paletteColor, palettePositions, parsePalette, randomCosinePalette, randomizePalette, randomPrimaryColors, removePaletteStop, reversePalette, rgbHex, serializePalette, validatePalette, type PaletteStrategy } from '../engine/palette';

type Props = { palette: Palette; onChange: (palette: Palette) => void };
const row: CSSProperties = {display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'};
const grid: CSSProperties = {display:'grid',gap:10,minWidth:0};
const help: CSSProperties = {fontSize:11,color:'var(--muted)',lineHeight:1.6,margin:0};
const channelNames = { red:'红 R', green:'绿 G', blue:'蓝 B' };
const channelColors = { red:'#f77882', green:'#68d9a4', blue:'#6daafa' };
function Numeric({label,value,onChange,min,max,disabled=false,step='any'}:{label:string;value:number;onChange:(n:number)=>void;min?:number;max?:number;disabled?:boolean;step?:number|'any'}) {
  const {t}=useI18n();
  const [text,setText]=useState(String(value));useEffect(()=>setText(String(value)),[value]);
  const valid=(s:string)=>s.trim()!==''&&Number.isFinite(Number(s))&&(min===undefined||Number(s)>=min)&&(max===undefined||Number(s)<=max);
  return <label style={{display:'grid',gap:4,flex:'1 1 75px',minWidth:0,fontSize:11}}>{t(label)}<input aria-label={t(label)} type="number" step={step} min={min} max={max} disabled={disabled} value={text} style={{width:'100%'}} onChange={e=>{setText(e.target.value);if(valid(e.target.value))onChange(Number(e.target.value));}} onBlur={()=>{if(!valid(text))setText(String(value));}} /></label>;
}
const preview=(p:Palette,mapped=false)=>`linear-gradient(90deg,${Array.from({length:97},(_,i)=>`${rgbHex(mapped?paletteColor(p,i/96):paletteBaseColor(p,i/96))} ${i/96*100}%`).join(',')})`;

export function PaletteEditor({palette,onChange}:Props) {
  const {t}=useI18n();
  const [selected,setSelected]=useState(0),[channel,setChannel]=useState<keyof PaletteCurves>('red'),[curveSelected,setCurveSelected]=useState(0);
  const [strategy,setStrategy]=useState<PaletteStrategy>('analogous'),[count,setCount]=useState(5),[seed,setSeed]=useState(42),[primary,setPrimary]=useState(()=>randomPrimaryColors(42));
  const [error,setError]=useState(''),[notice,setNotice]=useState('');
  const upload=useRef<HTMLInputElement>(null),stopRail=useRef<HTMLDivElement>(null),curveSvg=useRef<SVGSVGElement>(null);
  const latest=useRef({palette,onChange});latest.current={palette,onChange};const dragCleanup=useRef<(()=>void)|null>(null);
  useEffect(()=>()=>dragCleanup.current?.(),[]);
  const index=Math.min(selected,palette.stops.length-1),positions=palettePositions(palette),stopBased=palette.mode==='linear'||palette.mode==='sine';
  const curves=palette.curves??DEFAULT_CURVES,points=curves[channel],pointIndex=Math.max(0,Math.min(curveSelected,points.length-1)),point=points[pointIndex];
  const emit=(next:Palette)=>{try{onChange(validatePalette(next));setError('');setNotice('');}catch(e){setError(e instanceof Error?e.message:String(e));}};
  const perform=(operation:()=>Palette)=>{try{emit(operation());}catch(e){setError(e instanceof Error?e.message:String(e));}};
  const patch=(update:Partial<Palette>)=>emit({...palette,...update});
  function startDrag(e:ReactPointerEvent<Element>,move:(event:PointerEvent)=>void){
    if(e.button!==0)return;e.preventDefault();e.stopPropagation();dragCleanup.current?.();const element=e.currentTarget;element.setPointerCapture(e.pointerId);
    const end=()=>{element.removeEventListener('pointermove',move as EventListener);element.removeEventListener('pointerup',end);element.removeEventListener('pointercancel',end);element.removeEventListener('lostpointercapture',end);dragCleanup.current=null;};
    element.addEventListener('pointermove',move as EventListener);element.addEventListener('pointerup',end);element.addEventListener('pointercancel',end);element.addEventListener('lostpointercapture',end);dragCleanup.current=end;
  }
  function dragStop(e:ReactPointerEvent<HTMLButtonElement>,i:number){setSelected(i);startDrag(e,event=>{const box=stopRail.current!.getBoundingClientRect();try{latest.current.onChange(movePaletteStop(latest.current.palette,i,(event.clientX-box.left)/box.width));}catch(error){setError(String(error));}});}
  function changeCurve(next:PaletteCurvePoint[]){emit({...palette,curves:{...curves,[channel]:next}});}
  function moveCurvePoint(i:number,x:number,y:number,current=latest.current.palette){
    const currentCurves=current.curves??DEFAULT_CURVES,copy=currentCurves[channel].map(p=>({...p}));
    copy[i]={x:Math.max(i===0?0:copy[i-1].x+1e-6,Math.min(i===copy.length-1?1:copy[i+1].x-1e-6,x)),y:Math.max(0,Math.min(1,y))};
    return {...current,curves:{...currentCurves,[channel]:copy}};
  }
  function dragCurve(e:ReactPointerEvent<SVGCircleElement>,i:number){setCurveSelected(i);startDrag(e,event=>{const box=curveSvg.current!.getBoundingClientRect();try{latest.current.onChange(validatePalette(moveCurvePoint(i,(event.clientX-box.left)/box.width,1-(event.clientY-box.top)/box.height)));}catch(error){setError(String(error));}});}
  function addCurvePoint(x?:number,y?:number){
    if(points.length>=MAX_CURVE_POINTS){setError(`每条曲线最多 ${MAX_CURVE_POINTS} 个节点`);return;}
    if(x===undefined){let i=0;for(let j=1;j<points.length-1;j++)if(points[j+1].x-points[j].x>points[i+1].x-points[i].x)i=j;x=(points[i].x+points[i+1].x)/2;y=curveValue(points,x);}
    if(points.some(p=>Math.abs(p.x-x!)<1e-6)){setError('新节点的 X 不能与已有节点重叠');return;}
    const next=[...points,{x:Math.max(0,Math.min(1,x)),y:Math.max(0,Math.min(1,y??0))}].sort((a,b)=>a.x-b.x);setCurveSelected(Math.max(0,next.findIndex(p=>p.x===x)));changeCurve(next);
  }
  function removeCurvePoint(i:number){if(points.length>2){changeCurve(points.filter((_,j)=>i!==j));setCurveSelected(Math.max(0,i-1));}}
  function changeMode(mode:Palette['mode']){patch({mode,cosine:mode==='cosine'?(palette.cosine??DEFAULT_COSINE):palette.cosine,curves:mode==='curve'?(palette.curves??DEFAULT_CURVES):palette.curves});}
  function generate(nextSeed=seed){perform(()=>randomizePalette(palette,{strategy,count,seed:nextSeed,primaryColors:strategy==='split-complementary'?primary:undefined}));}
  function exportFile(){const url=URL.createObjectURL(new Blob([serializePalette(palette)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download=`${palette.name.replace(/[^\p{L}\p{N} _-]/gu,'_')||'palette'}.palette.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setNotice('调色板 JSON 已交给浏览器下载。');}
  return <div aria-label={t("调色板编辑器")} style={grid}>
    <div style={row}><label style={{display:'grid',gap:4,flex:1,fontSize:11}}>{t("调色板名称")}<input aria-label={t("调色板名称")} value={palette.name} maxLength={256} onChange={e=>patch({name:e.target.value})} /></label><select aria-label={t("调色板预设")} value="" onChange={e=>{const p=PALETTES[Number(e.target.value)];if(p)emit({...p,offset:palette.offset,cycles:palette.cycles});}} style={{maxWidth:150}}><option value="" disabled>{t("选择预设…")}</option>{PALETTES.map((p,i)=><option key={p.name} value={i}>{t(p.name)}</option>)}</select></div>
    <div style={row}><label style={{fontSize:11}}>{t("编辑模式")}<select aria-label={t("调色板模式")} value={palette.mode} onChange={e=>changeMode(e.target.value as Palette['mode'])}><option value="linear">{t("手动 Manual")}</option><option value="cosine">{t("余弦 Cosine")}</option><option value="curve">{t("RGB 曲线")}</option><option value="sine">{t("手动 · 正弦往返")}</option><option value="hsv">{t("HSV 色轮")}</option></select></label><button onClick={()=>perform(()=>reversePalette(palette))}>{t("反转")}</button></div>
    <div aria-label={t("基础调色板预览")} role="img" style={{height:25,borderRadius:5,background:preview(palette),border:'1px solid var(--border)'}} />
    {stopBased&&<>
      <div ref={stopRail} aria-label={t("色标位置")} style={{position:'relative',height:28,margin:'0 9px',touchAction:'none'}}>{positions.map((x,i)=><button key={i} aria-label={t("色标 {0}",{0:i+1})} aria-pressed={index===i} title={t("{0} · {1}%（双击删除）",{0:i+1,1:(x*100).toFixed(2)})} onPointerDown={e=>dragStop(e,i)} onClick={()=>setSelected(i)} onDoubleClick={()=>{if(palette.stops.length>2)perform(()=>removePaletteStop(palette,i));}} onKeyDown={e=>{if(e.key==='Delete'&&palette.stops.length>2){e.preventDefault();perform(()=>removePaletteStop(palette,i));}if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();perform(()=>movePaletteStop(palette,i,x+(e.key==='ArrowRight'?1:-1)*(e.shiftKey ? .1 : .01)));}}} style={{position:'absolute',left:`${x*100}%`,top:3,transform:'translateX(-50%)',width:17,height:23,minWidth:0,padding:0,background:palette.stops[i],border:`2px solid ${index===i?'var(--accent)':'var(--border)'}`,borderRadius:4}} />)}</div>
      <div style={row}><label style={{fontSize:11}}>{t("色标")}<select aria-label={t("选择色标")} value={index} onChange={e=>setSelected(Number(e.target.value))}>{palette.stops.map((_,i)=><option key={i} value={i}>{i+1}</option>)}</select></label><input aria-label={t("色标颜色")} type="color" value={palette.stops[index]} onChange={e=>patch({stops:palette.stops.map((c,i)=>i===index?e.target.value:c)})} /><Numeric label={t("色标位置 %")} disabled={index===0||index===palette.stops.length-1} value={positions[index]*100} min={0} max={100} onChange={v=>perform(()=>movePaletteStop(palette,index,v/100))}/><button aria-label={t("添加色标")} disabled={palette.stops.length>=MAX_EDITABLE_PALETTE_STOPS} onClick={()=>perform(()=>insertPaletteStop(palette))}>＋</button><button aria-label={t("删除色标")} disabled={palette.stops.length<=2} onClick={()=>{perform(()=>removePaletteStop(palette,index));setSelected(Math.max(0,index-1));}}>{t("删除")}</button></div>
      <label style={{fontSize:11}}>{t("色标插值")}<select aria-label={t("色标插值空间")} value={palette.interpolation??'rgb'} onChange={e=>patch({interpolation:e.target.value as 'rgb'|'hsv'})}><option value="rgb">RGB</option><option value="hsv">{t("HSV · 最短色相路径")}</option></select></label>
      <p style={help}>{t("拖动内部色标或使用方向键移动。首尾固定为 0% 和 100%；双击节点删除，至少保留两个。手动最多 25 色标，导入或动画生成的更多色标会完整保留。")}</p>
    </>}
    {palette.mode==='cosine'&&<div style={grid}><p style={help}>{t("RGB(t) = A + B × cos(2π × (C × t + D))；输出限制在 0–1。")}</p>{(['a','b','c','d'] as const).map((key,i)=><div key={key} style={grid}><span style={{fontSize:11}}>{[t("A · 基准"),t("B · 幅度"),t("C · 频率"),t("D · 相位")][i]}</span><div style={{display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:8}}>{[0,1,2].map(c=><Numeric key={c} label={`${key.toUpperCase()} ${['R','G','B'][c]}`} value={(palette.cosine??DEFAULT_COSINE)[key][c]} onChange={value=>{const cosine=structuredClone(palette.cosine??DEFAULT_COSINE);cosine[key][c]=value;patch({cosine});}} />)}</div></div>)}<button onClick={()=>patch({cosine:randomCosinePalette(seed)})}>{t("按下方种子生成余弦参数")}</button></div>}
    {palette.mode==='curve'&&<div style={grid}>
      <div style={row}>{(Object.keys(channelNames) as (keyof PaletteCurves)[]).map(key=><button key={key} aria-pressed={channel===key} onClick={()=>{setChannel(key);setCurveSelected(0);}} style={{color:channelColors[key],borderColor:channel===key?channelColors[key]:undefined}}>{t(channelNames[key])}</button>)}</div>
      <svg ref={curveSvg} aria-label={t("RGB 曲线编辑区")} viewBox="0 0 300 160" preserveAspectRatio="none" style={{width:'100%',height:160,background:'var(--input)',border:'1px solid var(--border)',touchAction:'none',overflow:'visible'}} onClick={e=>{if(e.target!==e.currentTarget)return;const box=e.currentTarget.getBoundingClientRect();addCurvePoint((e.clientX-box.left)/box.width,1-(e.clientY-box.top)/box.height);}}>
        {[.25,.5,.75].map(v=><g key={v} pointerEvents="none" stroke="var(--border)" strokeWidth=".5"><path d={`M ${v*300} 0 V 160 M 0 ${v*160} H 300`} /></g>)}
        {(Object.keys(channelNames) as (keyof PaletteCurves)[]).map(key=><path key={key} pointerEvents="none" fill="none" stroke={channelColors[key]} strokeOpacity={channel===key?1:.22} strokeWidth="2" d={Array.from({length:129},(_,i)=>`${i?'L':'M'} ${i/128*300} ${160-curveValue(curves[key],i/128)*160}`).join(' ')} />)}
        {points.map((p,i)=><circle key={i} tabIndex={0} role="button" aria-label={t("{0} 节点 {1}",{0:t(channelNames[channel]),1:i+1})} cx={p.x*300} cy={(1-p.y)*160} r={pointIndex===i?5:4} fill={channelColors[channel]} stroke="var(--bg)" strokeWidth="1.5" onPointerDown={e=>dragCurve(e,i)} onClick={e=>{e.stopPropagation();setCurveSelected(i);}} onDoubleClick={e=>{e.stopPropagation();removeCurvePoint(i);}} onKeyDown={e=>{if(e.key==='Delete'){e.preventDefault();removeCurvePoint(i);}const step=e.shiftKey ? .1 : .01;if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();perform(()=>moveCurvePoint(i,p.x+(e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0),p.y+(e.key==='ArrowUp'?step:e.key==='ArrowDown'?-step:0)));}}} />)}
      </svg>
      <div style={row}><Numeric label={t("曲线 X")} value={point.x} min={0} max={1} onChange={v=>perform(()=>moveCurvePoint(pointIndex,v,point.y))}/><Numeric label={t("曲线 Y")} value={point.y} min={0} max={1} onChange={v=>perform(()=>moveCurvePoint(pointIndex,point.x,v))}/><button onClick={()=>addCurvePoint()} disabled={points.length>=MAX_CURVE_POINTS}>{t("添加节点")}</button><button onClick={()=>removeCurvePoint(pointIndex)} disabled={points.length<=2}>{t("删除节点")}</button></div>
      <p style={help}>{t("单击空白区域添加，拖动或方向键移动，双击删除。曲线穿过各节点，范围外延伸端点颜色。")}</p>
    </div>}
    {!stopBased&&<button onClick={()=>perform(()=>bakePalette(palette))}>{t("转换为 25 个手动色标")}</button>}
    <div style={{...grid,borderTop:'1px solid var(--border)',paddingTop:12}}>
      <div style={row}><Numeric label={t("颜色偏移")} value={palette.offset} onChange={offset=>patch({offset})}/><Numeric label={t("颜色周期")} value={palette.cycles} onChange={cycles=>patch({cycles})}/></div><div role="img" aria-label={t("实际颜色映射预览")} style={{height:15,borderRadius:4,background:preview(palette,true)}} />
      <details><summary style={{cursor:'pointer',fontSize:12}}>{t("随机配色")}</summary><div style={{...grid,paddingTop:10}}>
        {palette.mode!=='cosine'&&<select aria-label={t("随机配色策略")} value={strategy} onChange={e=>setStrategy(e.target.value as PaletteStrategy)}><option value="monochromatic">{t("单色 · Monochromatic")}</option><option value="analogous">{t("类似色 · Analogous")}</option><option value="complementary">{t("互补色 · Complementary")}</option><option value="split-complementary">{t("分裂互补色 · Split Complementary")}</option></select>}
        <div style={row}><Numeric label={t(palette.mode==='curve'?"每通道曲线节点数":"随机颜色数量")} disabled={palette.mode==='cosine'} value={count} min={2} max={16} step={1} onChange={v=>{if(Number.isInteger(v))setCount(v);}}/><Numeric label={t("随机种子")} value={seed} step={1} onChange={v=>{if(Number.isSafeInteger(v))setSeed(v);}}/></div>
        {palette.mode!=='cosine'&&strategy==='split-complementary'&&<><div style={row}><Numeric label={t("主色数量")} value={primary.length} min={3} max={6} step={1} onChange={v=>{if(Number.isInteger(v))setPrimary(old=>Array.from({length:v},(_,i)=>old[i]??randomPrimaryColors(seed,v)[i]));}}/><button onClick={()=>{const next=seed===Number.MAX_SAFE_INTEGER?0:seed+1;setSeed(next);setPrimary(randomPrimaryColors(next,primary.length));}}>{t("随机主色")}</button></div><div style={row}>{primary.map((color,i)=><input key={i} aria-label={t("主色 {0}",{0:i+1})} type="color" value={color} onChange={e=>setPrimary(primary.map((c,j)=>j===i?e.target.value:c))} />)}</div></>}
        <div style={row}><button onClick={()=>generate()}>{t(palette.mode==='curve'?"按种子生成曲线":palette.mode==='cosine'?"按种子生成余弦参数":palette.mode==='hsv'?"生成手动色板":"按种子生成色板")}</button><button onClick={()=>{const next=seed===Number.MAX_SAFE_INTEGER?0:seed+1;setSeed(next);generate(next);}}>{t("换一组")}</button></div>
      </div></details>
      <div style={row}><button onClick={()=>upload.current?.click()}>{t("导入色板")}</button><button onClick={exportFile}>{t("导出色板")}</button><input ref={upload} aria-label={t("导入调色板文件")} hidden type="file" accept="application/json,.json" onChange={async e=>{const file=e.target.files?.[0];e.target.value='';if(!file)return;try{if(file.size>MAX_PALETTE_IMPORT_BYTES)throw new Error('调色板文件不得超过 256 KiB');const next=parsePalette(await file.text());emit(next);setSelected(0);setCurveSelected(0);setNotice(`已导入 ${file.name}`);}catch(error){setError(error instanceof Error?error.message:String(error));}}} /></div>
    </div>
    {error&&<p role="alert" style={{...help,color:'var(--danger,#f77882)'}}>{t(error)}</p>}{notice&&<p role="status" style={help}>{t(notice)}</p>}
  </div>;
}
