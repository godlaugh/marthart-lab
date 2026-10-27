import type {SourceCameraViewport} from './sourceCamera';
import type {FormulaStyle,FormulaLabel,FormulaConfig,FormulaPresentation} from '../types';
import {parseSourceDrawingViewport,type SourceDrawingViewport} from './sourceDrawingViewport';

const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const finite=(v:unknown,min:number,max:number)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
function finalOverlay(value:object,source:boolean):number|undefined {
 const alpha='finalBlackOverlayAlpha' in value?value.finalBlackOverlayAlpha:undefined;
 if(alpha!==undefined&&(!source||!Number.isInteger(alpha)||!finite(alpha,0,255)))throw new Error('实际帧的最终遮罩需要源布局与 0–255 整数透明度');
 return alpha as number|undefined;
}
function formulaStyle(v:Record<string,unknown>,source=false):FormulaStyle {
  if(typeof v.visible!=='boolean'||!finite(v.x,-32768,32768)||!finite(v.y,-32768,32768)||!finite(v.scale,source?.02:.05,20)||typeof v.color!=='string'||!/^#[0-9a-f]{6}$/i.test(v.color))throw new Error('公式位置、缩放或颜色无效');
  if(source&&v.anchor!=='center')throw new Error('源曲面公式必须使用居中锚点');
  if(v.anchor!==undefined&&v.anchor!=='top-left'&&v.anchor!=='center')throw new Error('公式锚点无效');
  return{visible:v.visible,x:v.x as number,y:v.y as number,scale:v.scale as number,color:v.color,...(v.anchor?{anchor:v.anchor}:{} )};
}
function formulaLabel(v:unknown,ids:Set<string>,source=false):FormulaLabel {
  if(!object(v)||typeof v.id!=='string'||!v.id||ids.has(v.id)||typeof v.latex!=='string'||v.latex.length>8192)throw new Error('附加公式标识或内容无效');
  ids.add(v.id);return{...formulaStyle(v,source),id:v.id,latex:v.latex};
}
export function validateFormulas(value:unknown):FormulaConfig {
  if(!object(value)||!object(value.main)||!Array.isArray(value.additional)||value.additional.length>32)throw new Error('公式标注配置无效，最多32个附加公式');
  const source=value.layout==='source-surface-centered-v1';
  if(value.layout!==undefined&&!source)throw new Error('公式布局版本无效');
  if(source?(value.referenceWidth!==undefined||value.referenceHeight!==undefined||value.primaryLogicalHeight!==undefined):(!finite(value.referenceWidth,1,16384)||!finite(value.referenceHeight,1,16384)))throw new Error('公式参考画布尺寸无效');
  const ids=new Set<string>();
  if(value.main.latex!==undefined&&(typeof value.main.latex!=='string'||value.main.latex.length>8192))throw new Error('主方程内容无效');
  const layout=source?{layout:'source-surface-centered-v1' as const}:{referenceWidth:value.referenceWidth as number,referenceHeight:value.referenceHeight as number};
  return{...layout,main:{...formulaStyle(value.main,source),...(value.main.latex!==undefined?{latex:value.main.latex as string}:{})},additional:value.additional.map(v=>formulaLabel(v,ids,source))};
}
export function validateFormulaPresentation(value:unknown):FormulaPresentation {
  if(!object(value)||!Array.isArray(value.labels)||value.labels.length>33)throw new Error('实际帧的公式标注无效');
  const source=value.layout==='source-surface-centered-v1';
  const overlay=finalOverlay(value,source);
  let drawingViewport:SourceDrawingViewport|undefined;
  if(value.drawingViewport!==undefined){
   if(!source)throw new Error('实际帧的绘制视口需要源公式布局');
   const parsed=parseSourceDrawingViewport(value.drawingViewport);
   if(!parsed.ok)throw new Error(parsed.error.reason);
   drawingViewport=parsed.value;
  }
  if(value.layout!==undefined&&!source)throw new Error('公式布局版本无效');
  if(source?(!Number.isSafeInteger(value.primaryLogicalHeight)||!finite(value.primaryLogicalHeight,1,16384)||value.referenceWidth!==undefined||value.referenceHeight!==undefined):(value.primaryLogicalHeight!==undefined||!finite(value.referenceWidth,1,16384)||!finite(value.referenceHeight,1,16384)))throw new Error('实际帧的公式参考尺寸无效');
  const ids=new Set<string>(),labels=value.labels.map(v=>formulaLabel(v,ids,source));
  if(labels.some(label=>!label.visible||!label.latex.trim()))throw new Error('实际帧包含未启用或空的公式标注');
  return source?{layout:'source-surface-centered-v1',primaryLogicalHeight:value.primaryLogicalHeight as number,labels,...(overlay!==undefined?{finalBlackOverlayAlpha:overlay as number}:{}),...(drawingViewport?{drawingViewport}:{})}:{referenceWidth:value.referenceWidth as number,referenceHeight:value.referenceHeight as number,labels};
}
/** Bind display-owned GL state once at the producer, without changing authored labels. */
export function withSourceFormulaDrawingViewport(presentation:FormulaPresentation,viewport:SourceDrawingViewport):FormulaPresentation {
 if(presentation.layout!=='source-surface-centered-v1')return validateFormulaPresentation(presentation);
 return validateFormulaPresentation({...presentation,drawingViewport:viewport});
}
/** Stable authored annotations. Display-owned viewport and transition facts
 * must be validated separately, not frozen to the first delivered frame. */
export function formulaAnnotations(value:FormulaPresentation|undefined):FormulaPresentation|undefined {
 if(value?.layout!=='source-surface-centered-v1')return value;
 const {finalBlackOverlayAlpha:_,drawingViewport:__,...annotations}=value;
 return annotations;
}
export function hasFormulaComposition(value:FormulaPresentation|undefined):boolean {
 if(!value)return false;const alpha=finalOverlay(value,value.layout==='source-surface-centered-v1');
 return value.labels.length>0||(alpha??0)>0;
}

/** Formula placement needs the target's primary reference, not camera optics. */
export type FormulaViewport=Pick<SourceCameraViewport,'logicalHeight'|'target'>&{readonly referenceLogicalHeight?:number};
/** Shared interpretation of the producing frame's primary logical reference. */
export function sourceFormulaPrimaryHeight(viewport:FormulaViewport|undefined):number {
 if(!viewport||viewport.target!=='primary'&&viewport.target!=='offscreen')throw new Error('源曲面公式缺少实际主画布尺寸');
 const height=viewport.target==='primary'?viewport.logicalHeight:viewport.referenceLogicalHeight;
 if(typeof height!=='number'||!Number.isSafeInteger(height)||height<1||height>16384)throw new Error('源曲面公式缺少实际主画布尺寸');
 return height;
}
export function validateFrameFormulas(value:unknown,viewport?:FormulaViewport):FormulaPresentation {
 const result=validateFormulaPresentation(value);
 if(result.layout==='source-surface-centered-v1'&&result.primaryLogicalHeight!==sourceFormulaPrimaryHeight(viewport))throw new Error('源曲面公式与实际主画布尺寸不匹配');
 return result;
}
