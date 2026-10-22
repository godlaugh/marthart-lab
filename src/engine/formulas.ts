import {parse} from 'mathjs';
import type {SourceCameraViewport} from './sourceCamera';
import {usesSourceSurfaceGeometry} from './sourceSurfaceIdentity';
import type {SceneDocument,FormulaStyle,FormulaLabel,FormulaConfig,FormulaPresentation,FormulaContent} from '../types';
import {fractalEquationLatex} from '../scenes/complex';
import {sourceFractalFormulaLatex} from './sourceFractalFormulaLatex';
import {sourceSurfaceFormulaLatex} from './sourceSurfaceFormulaLatex';
import {symmetryEquationLatex} from '../scenes/symmetryFormula';
import {hasSymmetryCustom} from './symmetryCustom';
export type {FormulaStyle,FormulaLabel,FormulaConfig,FormulaPresentation,FormulaContent} from '../types';
export function defaultFormulas():Extract<FormulaConfig,{layout?:undefined}>{return{referenceWidth:1280,referenceHeight:720,main:{visible:false,x:32,y:80,scale:1,color:'#ffffff'},additional:[]};}
export {validateFormulas,validateFormulaPresentation} from './formulaConfig';
import {validateFormulas,validateFormulaPresentation,sourceFormulaPrimaryHeight} from './formulaConfig';
export function mainEquation(scene:SceneDocument):string {
  if(usesSourceSurfaceGeometry(scene))return sourceSurfaceFormulaLatex(scene);
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
export function formulaLabels(scene:SceneDocument):FormulaLabel[]{return [...resolveFormulaContent(scene).labels];}
/** Text parsing belongs to Scene construction/Apply, not animation draws. */
export function resolveFormulaContent(scene:SceneDocument):FormulaContent {
  const config=scene.formulas?validateFormulas(scene.formulas):defaultFormulas(),extra=config.additional.filter(f=>f.visible&&f.latex.trim());
  const labels=config.main.visible?[{...config.main,id:'main-equation',latex:config.main.latex?.trim()?config.main.latex:mainEquation(scene)},...extra]:extra;
  if(config.layout==='source-surface-centered-v1'){
    if(!usesSourceSurfaceGeometry(scene))throw new Error('源曲面公式布局需要源曲面项目');
    return{layout:config.layout,labels};
  }
  return{referenceWidth:config.referenceWidth,referenceHeight:config.referenceHeight,labels};
}
/** The producing frame binds the source's primary logical height once. A
 * consumer never derives it from document resolution, target aspect or DPR. */
export function presentFormulas(content:FormulaContent,viewport?:SourceCameraViewport):FormulaPresentation {
  return validateFormulaPresentation(content.layout==='source-surface-centered-v1'?{...content,primaryLogicalHeight:sourceFormulaPrimaryHeight(viewport)}:content);
}
export function formulaPresentation(scene:SceneDocument,viewport?:SourceCameraViewport):FormulaPresentation {return presentFormulas(resolveFormulaContent(scene),viewport);}
export function formulaPlacement(config:FormulaPresentation|FormulaConfig,label:FormulaLabel,width:number,height:number,dimensions?:{width:number;height:number}){
  if(config.layout==='source-surface-centered-v1'){
    if(!('primaryLogicalHeight' in config)||!Number.isFinite(config.primaryLogicalHeight)||config.primaryLogicalHeight<=0)throw new Error('源曲面公式缺少实际主画布尺寸');
    const ratio=height/config.primaryLogicalHeight,scale=label.scale*2.5*ratio;
    // JLaTeXMath's 50-unit font versus MathJax's 20-unit SVG. This is a
    // font-unit conversion, independent of viewport size and aspect ratio.
    return{x:width/2+label.x*ratio-(dimensions?.width??0)*scale/2,y:height/2+label.y*ratio-(dimensions?.height??0)*scale/2,scale};
  }
  const scale=label.scale*Math.min(width/config.referenceWidth,height/config.referenceHeight),center=label.anchor==='center';
  return{x:label.x*width/config.referenceWidth-(center?(dimensions?.width??0)*scale/2:0),y:label.y*height/config.referenceHeight-(center?(dimensions?.height??0)*scale/2:0),scale};
}
