import {parse} from 'mathjs';
import type {SceneDocument,FormulaStyle,FormulaLabel,FormulaConfig,FormulaPresentation} from '../types';
import {fractalEquationLatex} from '../scenes/complex';
import {sourceFractalFormulaLatex} from './sourceFractalFormulaLatex';
import {symmetryEquationLatex} from '../scenes/symmetryFormula';
import {hasSymmetryCustom} from './symmetryCustom';
export type {FormulaStyle,FormulaLabel,FormulaConfig,FormulaPresentation} from '../types';
export function defaultFormulas():FormulaConfig{return{referenceWidth:1280,referenceHeight:720,main:{visible:false,x:32,y:80,scale:1,color:'#ffffff'},additional:[]};}
export {validateFormulas,validateFormulaPresentation} from './formulaConfig';
import {validateFormulas,validateFormulaPresentation} from './formulaConfig';
export function mainEquation(scene:SceneDocument):string {
  if(scene.kind==='fractal')return scene.fractalSource?sourceFractalFormulaLatex(scene.fractalSource.formula):fractalEquationLatex(scene.settings);
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
  return [...formulaPresentation(scene).labels];
}
/** Resolve text and layout once at the producing Scene boundary. Source
 * Fractal callers retain this value for the lifetime of that full-loaded Scene. */
export function formulaPresentation(scene:SceneDocument):FormulaPresentation {
  const config=scene.formulas?validateFormulas(scene.formulas):defaultFormulas(),labels=config.additional.filter(f=>f.visible&&f.latex.trim());
  return validateFormulaPresentation({referenceWidth:config.referenceWidth,referenceHeight:config.referenceHeight,labels:config.main.visible?[{...config.main,id:'main-equation',latex:config.main.latex?.trim()?config.main.latex:mainEquation(scene)},...labels]:labels});
}
export function formulaPlacement(config:Pick<FormulaConfig,'referenceWidth'|'referenceHeight'>,label:FormulaLabel,width:number,height:number,dimensions?:{width:number;height:number}){const scale=label.scale*Math.min(width/config.referenceWidth,height/config.referenceHeight),center=label.anchor==='center';return{x:label.x*width/config.referenceWidth-(center?(dimensions?.width??0)*scale/2:0),y:label.y*height/config.referenceHeight-(center?(dimensions?.height??0)*scale/2:0),scale};}
