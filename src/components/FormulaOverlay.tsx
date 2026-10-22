import {useI18n} from '../i18n';
import {useEffect,useRef,useState} from 'react';
import type {FormulaPresentation,SceneDocument} from '../types';
import {formulaPresentation,formulaPlacement} from '../engine/formulas';
import {formulaOverlayRect} from '../engine/formulaOverlayRect';
import {prepareSourceFormulas,SourceFormulaCompositor,type SourceFormulaPresentation,type PreparedSourceFormula,formulaBasePixels} from '../engine/sourceFormulaCompositor';
export function FormulaOverlay({scene,presentation,canvas}:{scene:SceneDocument;presentation?:FormulaPresentation;canvas?:HTMLCanvasElement}){
  const {t}=useI18n();
  const host=useRef<HTMLDivElement>(null),[size,setSize]=useState({width:0,height:0,left:0,top:0}),[items,setItems]=useState<{id:string;source:string;width:number;height:number;x:number;y:number}[]>([]),[error,setError]=useState('');
  const source=presentation?.layout==='source-surface-centered-v1';
  useEffect(()=>{const element=host.current!;const measure=()=>setSize(formulaOverlayRect(element.getBoundingClientRect(),source?canvas?.getBoundingClientRect():undefined,source));const observer=new ResizeObserver(measure);observer.observe(element);if(source&&canvas)observer.observe(canvas);measure();return()=>observer.disconnect();},[source,canvas]);
  // Source scenes must wait for the producer's captured presentation. An empty
  // delivered label list is authoritative even when the draft enables labels.
  const identity=JSON.stringify(presentation??[scene.kind,scene.equations,scene.parameters,scene.settings,scene.formulas,!!scene.fractalSource]);
  useEffect(()=>{let cancelled=false;
    async function update(){try{const resolved=presentation??(scene.fractalSource||scene.formulas?.layout==='source-surface-centered-v1'?undefined:formulaPresentation(scene));const labels=resolved?.labels??[];if(source||!labels.length||size.width<=0||size.height<=0){setItems([]);setError('');return;}const {renderFormulaSvg}=await import('../engine/formulaSvg');const next=labels.map(label=>{const svg=renderFormulaSvg(label.latex,label.color),p=formulaPlacement(resolved!,label,size.width,size.height,svg);return{id:label.id,source:`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.source)}`,width:svg.width*p.scale,height:svg.height*p.scale,x:p.x,y:p.y};});if(!cancelled){setItems(next);setError('');}}catch(e){if(!cancelled){setItems([]);setError(e instanceof Error?e.message:String(e));}}}
    void update();return()=>{cancelled=true;};
  },[identity,size.width,size.height]);
  const images=items.map(item=><img key={item.id} alt={item.id==='main-equation'?t("主方程"):t("附加数学公式")} src={item.source} width={item.width} height={item.height} style={{position:'absolute',left:item.x,top:item.y}}/>);
  return <div ref={host} className="formula-overlay" aria-label={t("数学公式标注")}>{source?<div data-testid="source-formula-canvas" style={{position:'absolute',left:size.left,top:size.top,width:size.width,height:size.height,overflow:'hidden'}}>{presentation?.layout==='source-surface-centered-v1'&&size.width>0&&size.height>0&&<SourceFormulaLayer presentation={presentation} canvas={canvas} width={canvas?.width??0} height={canvas?.height??0} onError={setError}/>}</div>:images}{error&&<p className="formula-render-error" role="alert">{t(error)}</p>}</div>;
}

/** Physical pixels follow the actual art canvas, including its selected preview
 * density. CSS letterboxing is owned by formulaOverlayRect above. */
function SourceFormulaLayer({presentation,canvas,width,height,onError}:{presentation:SourceFormulaPresentation;canvas?:HTMLCanvasElement;width:number;height:number;onError:(error:string)=>void}){
 const element=useRef<HTMLDivElement>(null),renderer=useRef<SourceFormulaCompositor|undefined>(undefined),key=JSON.stringify(presentation);
 const [prepared,setPrepared]=useState<{key:string;value:PreparedSourceFormula}>();
 useEffect(()=>{
  const controller=new AbortController();
  void prepareSourceFormulas(presentation,controller.signal).then(value=>{if(!controller.signal.aborted)setPrepared({key,value});},error=>{if(!controller.signal.aborted){setPrepared(undefined);onError(error instanceof Error?error.message:String(error));}});
  return()=>controller.abort();
 },[key,onError]);
 useEffect(()=>()=>{renderer.current?.dispose();renderer.current=undefined;},[]);
 useEffect(()=>{
  const host=element.current!;host.dataset.ready='false';
  if(!canvas||!width||!height||prepared?.key!==key||!presentation.labels.length)return;
  let restore:(()=>void)|undefined;
  try{
   const base=formulaBasePixels(canvas);
   renderer.current??=new SourceFormulaCompositor();renderer.current.draw(prepared.value,width,height,base);
   const layer=renderer.current.canvas;layer.style.width='100%';layer.style.height='100%';layer.setAttribute('aria-label','源数学公式标注');host.replaceChildren(layer);
   // Complete framebuffer composition also covers translucent backgrounds.
   // Suppress the underlying copy while this matching frame is displayed.
   const previous=canvas.style.opacity;canvas.style.opacity='0';restore=()=>{if(canvas.style.opacity==='0')canvas.style.opacity=previous;};
   host.dataset.ready='true';onError('');
  }catch(error){host.replaceChildren();onError(error instanceof Error?error.message:String(error));}
  return()=>{restore?.();host.replaceChildren();host.dataset.ready='false';};
 },[prepared,key,presentation,canvas,width,height,onError]);
 return <div ref={element} data-testid="source-formula-layer" style={{width:'100%',height:'100%'}}/>;
}
