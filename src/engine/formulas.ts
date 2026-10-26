import {usesRootsNativePresentation} from './rootsPresentationAuthoring';
import {usesSourceCenteredFormulaLayout} from './sourceFormulaIdentity';
import {usesSourceImplicitPresentation} from './sourceImplicitPresentation';
import {sourceImplicitFormulaLatex} from './sourceImplicitFormulaLatex';
import {parse} from 'mathjs';
import type {FormulaViewport} from './formulaConfig';
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
  if(usesSourceImplicitPresentation(scene)&&scene.formulas?.layout==='source-surface-centered-v1')return sourceImplicitFormulaLatex(scene);
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
  const main=config.main.visible?[{...config.main,id:'main-equation',latex:config.main.latex?.trim()?config.main.latex:mainEquation(scene)}]:[];
  // ComplexRootsConfig appends its main equation after authored extra formulas.
  // Frame order owns overlap for preview, capture and recording alike. Existing
  // generic saved layouts keep their original main-first ordering.
  const labels=config.layout==='source-surface-centered-v1'&&usesRootsNativePresentation(scene)?[...extra,...main]:[...main,...extra];
  if(config.layout==='source-surface-centered-v1'){
    if(!usesSourceCenteredFormulaLayout(scene))throw new Error('源曲面公式布局需要已确认的源曲面项目');
    return{layout:config.layout,labels};
  }
  return{referenceWidth:config.referenceWidth,referenceHeight:config.referenceHeight,labels};
}
/** The producing frame binds the source's primary logical height once. A
 * consumer never derives it from document resolution, target aspect or DPR. */
export function presentFormulas(content:FormulaContent,viewport?:FormulaViewport):FormulaPresentation {
  return validateFormulaPresentation(content.layout==='source-surface-centered-v1'?{...content,primaryLogicalHeight:sourceFormulaPrimaryHeight(viewport)}:content);
}
export function formulaPresentation(scene:SceneDocument,viewport?:FormulaViewport):FormulaPresentation {return presentFormulas(resolveFormulaContent(scene),viewport);}
export function formulaPlacement(config:FormulaPresentation|FormulaConfig,label:FormulaLabel,width:number,height:number,dimensions?:{width:number;height:number;fontSize?:number;centerAnchor?:'integer-half-size'}){
  if(config.layout==='source-surface-centered-v1'){
    if(!('primaryLogicalHeight' in config)||!Number.isFinite(config.primaryLogicalHeight)||config.primaryLogicalHeight<=0)throw new Error('源曲面公式缺少实际主画布尺寸');
    const fontSize=dimensions?.fontSize??20;if(!Number.isFinite(fontSize)||fontSize<=0)throw new Error('公式字号无效');
    const ratio=height/config.primaryLogicalHeight,scale=label.scale*(50/fontSize)*ratio;
    // Source glyphs use 50 units; legacy SVG consumers use 20. This is a
    // font-unit conversion, independent of viewport size and aspect ratio.
    const halfWidth=(dimensions?.width??0)/2,halfHeight=(dimensions?.height??0)/2;
    // PGraphics.image(PImage,x,y) in CENTER mode shifts by integer half
    // dimensions before applying the transform; SVGs use geometric centers.
    const integerCenter=dimensions?.centerAnchor==='integer-half-size';
    return{x:width/2+label.x*ratio-(integerCenter?Math.floor(halfWidth):halfWidth)*scale,y:height/2+label.y*ratio-(integerCenter?Math.floor(halfHeight):halfHeight)*scale,scale};
  }
  const scale=label.scale*Math.min(width/config.referenceWidth,height/config.referenceHeight),center=label.anchor==='center';
  return{x:label.x*width/config.referenceWidth-(center?(dimensions?.width??0)*scale/2:0),y:label.y*height/config.referenceHeight-(center?(dimensions?.height??0)*scale/2:0),scale};
}

/** Source TexMobject transforms image corners on the CPU before the orthographic
 * shader projection. Keep each Java float operation: moving division and
 * centering into a screen-space shader changes subpixel texture sampling. */
export function sourceFormulaQuad(presentation:Extract<FormulaPresentation,{layout:'source-surface-centered-v1'}>,label:FormulaLabel,width:number,height:number,glyph:{width:number;height:number}):Float32Array {
  const F=Math.fround,ratio=F(height/presentation.primaryLogicalHeight),scale=F(F(label.scale)*ratio);
  const centerX=F(F(F(width/2)+F(F(label.x)*ratio))-F(width/2));
  const centerY=F(F(F(height/2)+F(F(label.y)*ratio))-F(height/2));
  const left=F(F(-Math.floor(glyph.width/2)*scale)+centerX),right=F(F((glyph.width-Math.floor(glyph.width/2))*scale)+centerX);
  const top=F(F(-Math.floor(glyph.height/2)*scale)+centerY),bottom=F(F((glyph.height-Math.floor(glyph.height/2))*scale)+centerY);
  return new Float32Array([left,top,left,bottom,right,bottom,right,top]);
}
