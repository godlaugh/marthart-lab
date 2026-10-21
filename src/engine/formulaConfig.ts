import type {FormulaStyle,FormulaLabel,FormulaConfig,FormulaPresentation} from '../types';

const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const finite=(v:unknown,min:number,max:number)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
function formulaStyle(v:Record<string,unknown>):FormulaStyle {
  if(typeof v.visible!=='boolean'||!finite(v.x,-32768,32768)||!finite(v.y,-32768,32768)||!finite(v.scale,.05,20)||typeof v.color!=='string'||!/^#[0-9a-f]{6}$/i.test(v.color))throw new Error('公式位置、缩放或颜色无效');
  if(v.anchor!==undefined&&v.anchor!=='top-left'&&v.anchor!=='center')throw new Error('公式锚点无效');
  return{visible:v.visible,x:v.x as number,y:v.y as number,scale:v.scale as number,color:v.color,...(v.anchor?{anchor:v.anchor}:{} )};
}
function formulaLabel(v:unknown,ids:Set<string>):FormulaLabel {
  if(!object(v)||typeof v.id!=='string'||!v.id||ids.has(v.id)||typeof v.latex!=='string'||v.latex.length>8192)throw new Error('附加公式标识或内容无效');
  ids.add(v.id);return{...formulaStyle(v),id:v.id,latex:v.latex};
}
export function validateFormulas(value:unknown):FormulaConfig {
  if(!object(value)||!object(value.main)||!Array.isArray(value.additional)||value.additional.length>32)throw new Error('公式标注配置无效，最多32个附加公式');
  if(!finite(value.referenceWidth,1,16384)||!finite(value.referenceHeight,1,16384))throw new Error('公式参考画布尺寸无效');
  const ids=new Set<string>();
  if(value.main.latex!==undefined&&(typeof value.main.latex!=='string'||value.main.latex.length>8192))throw new Error('主方程内容无效');
  return{referenceWidth:value.referenceWidth as number,referenceHeight:value.referenceHeight as number,main:{...formulaStyle(value.main),...(value.main.latex!==undefined?{latex:value.main.latex as string}:{})},additional:value.additional.map(v=>formulaLabel(v,ids))};
}
export function validateFormulaPresentation(value:unknown):FormulaPresentation {
  if(!object(value)||!finite(value.referenceWidth,1,16384)||!finite(value.referenceHeight,1,16384)||!Array.isArray(value.labels)||value.labels.length>33)throw new Error('实际帧的公式标注无效');
  const ids=new Set<string>(),labels=value.labels.map(v=>formulaLabel(v,ids));
  if(labels.some(label=>!label.visible||!label.latex.trim()))throw new Error('实际帧包含未启用或空的公式标注');
  return{referenceWidth:value.referenceWidth as number,referenceHeight:value.referenceHeight as number,labels};
}
