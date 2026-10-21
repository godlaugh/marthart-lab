import {parse} from 'mathjs';
import type {SceneDocument,FormulaStyle,FormulaLabel,FormulaConfig} from '../types';
import {fractalEquationLatex} from '../scenes/complex';
import {sourceFractalRenderInput} from './sourceFractalRender';
import {symmetryEquationLatex} from '../scenes/symmetryFormula';
import {hasSymmetryCustom} from './symmetryCustom';
export type {FormulaStyle,FormulaLabel,FormulaConfig} from '../types';
export function defaultFormulas():FormulaConfig{return{referenceWidth:1280,referenceHeight:720,main:{visible:false,x:32,y:80,scale:1,color:'#ffffff'},additional:[]};}
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
export function validateFormulas(value:unknown):FormulaConfig {
  if(!object(value)||!object(value.main)||!Array.isArray(value.additional)||value.additional.length>32)throw new Error('公式标注配置无效，最多32个附加公式');
  const finite=(v:unknown,min:number,max:number)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
  if(!finite(value.referenceWidth,1,16384)||!finite(value.referenceHeight,1,16384))throw new Error('公式参考画布尺寸无效');
  const style=(v:Record<string,unknown>):FormulaStyle=>{
    if(typeof v.visible!=='boolean'||!finite(v.x,-32768,32768)||!finite(v.y,-32768,32768)||!finite(v.scale,.05,20)||typeof v.color!=='string'||!/^#[0-9a-f]{6}$/i.test(v.color))throw new Error('公式位置、缩放或颜色无效');
    if(v.anchor!==undefined&&v.anchor!=='top-left'&&v.anchor!=='center')throw new Error('公式锚点无效');
    return{visible:v.visible,x:v.x as number,y:v.y as number,scale:v.scale as number,color:v.color,...(v.anchor?{anchor:v.anchor}:{} )};
  };
  const ids=new Set<string>();
  if(value.main.latex!==undefined&&(typeof value.main.latex!=='string'||value.main.latex.length>8192))throw new Error('主方程内容无效');
  return{referenceWidth:value.referenceWidth as number,referenceHeight:value.referenceHeight as number,main:{...style(value.main),...(value.main.latex!==undefined?{latex:value.main.latex as string}:{})},additional:value.additional.map(v=>{if(!object(v)||typeof v.id!=='string'||!v.id||ids.has(v.id)||typeof v.latex!=='string'||v.latex.length>8192)throw new Error('附加公式标识或内容无效');ids.add(v.id);return{...style(v),id:v.id,latex:v.latex};})};
}
export function mainEquation(scene:SceneDocument):string {
  if(scene.kind==='fractal')return fractalEquationLatex(scene.settings,scene.fractalSource?sourceFractalRenderInput(scene.evaluatedFractalScene):undefined);
  if(scene.kind==='symmetry')return hasSymmetryCustom(scene)?'z_{k+1}=\\operatorname{calculate\\_next}(z_k)':symmetryEquationLatex(scene.settings);
  const symbol=(s:string)=>s.replace(/[^a-zA-Z0-9_]/g,'');
  const lines=Object.entries(scene.equations).filter(([,value])=>value.trim()).map(([key,value])=>{
    const tex=parse(value.replaceAll('π','pi')).toTex({parenthesis:'auto',implicit:'hide'});
    const left=scene.kind==='attractor'&&/^d[xyz]$/.test(key)?`\\frac{d${key[1]}}{dt}`:scene.kind==='implicit'?'F(x,y,z)':key==='next'?'w_{n+1}':key==='polynomial'?'P(z)':symbol(key);
    return `${left}&=${tex}`;
  });
  if(!lines.length)return `\\text{${scene.kind}}`;
  return `\\begin{aligned}${lines.join('\\\\')}\\end{aligned}`;
}
export function formulaLabels(scene:SceneDocument):FormulaLabel[]{
  if(!scene.formulas)return[];
  const config=validateFormulas(scene.formulas),labels=config.additional.filter(f=>f.visible&&f.latex.trim());
  return config.main.visible?[{...config.main,id:'main-equation',latex:config.main.latex?.trim()?config.main.latex:mainEquation(scene)},...labels]:labels;
}
export function formulaPlacement(config:FormulaConfig,label:FormulaLabel,width:number,height:number,dimensions?:{width:number;height:number}){const scale=label.scale*Math.min(width/config.referenceWidth,height/config.referenceHeight),center=label.anchor==='center';return{x:label.x*width/config.referenceWidth-(center?(dimensions?.width??0)*scale/2:0),y:label.y*height/config.referenceHeight-(center?(dimensions?.height??0)*scale/2:0),scale};}
