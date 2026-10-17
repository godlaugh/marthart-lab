import type {SceneDocument} from '../types';
import {formulaLabels,formulaPlacement} from './formulas';
export async function compositeFormulas(source:HTMLCanvasElement,scene:SceneDocument):Promise<HTMLCanvasElement>{
  const labels=formulaLabels(scene);if(!labels.length)return source;
  const {renderFormulaSvg}=await import('./formulaSvg');
  const canvas=document.createElement('canvas');canvas.width=source.width;canvas.height=source.height;
  const context=canvas.getContext('2d');if(!context)throw new Error('无法创建公式合成画布');context.drawImage(source,0,0);
  for(const label of labels){
    const rendered=renderFormulaSvg(label.latex,label.color),url=URL.createObjectURL(new Blob([rendered.source],{type:'image/svg+xml'}));
    try{const image=new Image();image.src=url;await image.decode();const p=formulaPlacement(scene.formulas!,label,canvas.width,canvas.height,rendered);context.drawImage(image,p.x,p.y,rendered.width*p.scale,rendered.height*p.scale);}finally{URL.revokeObjectURL(url);}
  }
  return canvas;
}
