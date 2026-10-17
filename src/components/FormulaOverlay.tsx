import {useI18n} from '../i18n';
import {useEffect,useRef,useState} from 'react';
import type {SceneDocument} from '../types';
import {formulaLabels,formulaPlacement} from '../engine/formulas';
export function FormulaOverlay({scene}:{scene:SceneDocument}){
  const {t}=useI18n();
  const host=useRef<HTMLDivElement>(null),[size,setSize]=useState({width:0,height:0}),[items,setItems]=useState<{id:string;source:string;width:number;height:number;x:number;y:number}[]>([]),[error,setError]=useState('');
  useEffect(()=>{const observer=new ResizeObserver(([entry])=>setSize({width:entry.contentRect.width,height:entry.contentRect.height}));observer.observe(host.current!);return()=>observer.disconnect();},[]);
  const identity=JSON.stringify([scene.kind,scene.equations,scene.parameters,scene.settings,scene.formulas]);
  useEffect(()=>{let cancelled=false;
    async function update(){try{const labels=formulaLabels(scene);if(!labels.length){setItems([]);setError('');return;}const {renderFormulaSvg}=await import('../engine/formulaSvg');const next=labels.map(label=>{const svg=renderFormulaSvg(label.latex,label.color),p=formulaPlacement(scene.formulas!,label,size.width,size.height,svg);return{id:label.id,source:`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.source)}`,width:svg.width*p.scale,height:svg.height*p.scale,x:p.x,y:p.y};});if(!cancelled){setItems(next);setError('');}}catch(e){if(!cancelled){setItems([]);setError(e instanceof Error?e.message:String(e));}}}
    void update();return()=>{cancelled=true;};
  },[identity,size.width,size.height]);
  return <div ref={host} className="formula-overlay" aria-label={t("数学公式标注")}>{items.map(item=><img key={item.id} alt={item.id==='main-equation'?t("主方程"):t("附加数学公式")} src={item.source} width={item.width} height={item.height} style={{position:'absolute',left:item.x,top:item.y}}/>)}{error&&<p className="formula-render-error" role="alert">{t(error)}</p>}</div>;
}
