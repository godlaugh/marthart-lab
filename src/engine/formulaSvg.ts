import {mathjax} from '@mathjax/src/js/mathjax.js';
import {TeX} from '@mathjax/src/js/input/tex.js';
import {SVG} from '@mathjax/src/js/output/svg.js';
import {liteAdaptor} from '@mathjax/src/js/adaptors/liteAdaptor.js';
import {RegisterHTMLHandler} from '@mathjax/src/js/handlers/html.js';
import {MathJaxTexFont} from '@mathjax/mathjax-tex-font/js/svg.js';
import '@mathjax/src/js/input/tex/base/BaseConfiguration.js';
import '@mathjax/src/js/input/tex/ams/AmsConfiguration.js';
import '@mathjax/src/js/input/tex/newcommand/NewcommandConfiguration.js';

const adaptor=liteAdaptor();
RegisterHTMLHandler(adaptor);
const svg=new SVG({fontData:new MathJaxTexFont(),fontCache:'none'});
export interface FormulaSvg {source:string;width:number;height:number;}
const cache=new Map<string,FormulaSvg>();
/** SVG paths embed glyphs; no external font fetch or HTML content is needed. */
export function renderFormulaSvg(latex:string,color:string):FormulaSvg {
  if(latex.length>8192||!/^#[0-9a-f]{6}$/i.test(color))throw new Error('公式内容或颜色无效');
  const key=JSON.stringify([latex,color]);const cached=cache.get(key);if(cached)return cached;
  // Definitions inside one annotation cannot alter another annotation or export.
  const tex=new TeX({packages:['base','ams','newcommand'],maxMacros:1000,maxBuffer:16384,formatError(_jax:unknown,error:Error){throw new Error(`LaTeX：${error.message}`);}});
  const document=mathjax.document('',{InputJax:tex,OutputJax:svg});
  const node=document.convert(latex,{display:true,em:20,ex:10,containerWidth:1280});
  const root=adaptor.tags(node,'svg')[0];if(!root)throw new Error('公式排版没有生成SVG');
  const viewBox=adaptor.getAttribute(root,'viewBox')?.split(/\s+/).map(Number);
  if(!viewBox||viewBox.length!==4||!viewBox.every(Number.isFinite))throw new Error('公式SVG尺寸无效');
  const width=Math.max(1,viewBox[2]/50),height=Math.max(1,viewBox[3]/50);
  if(width>16384||height>16384)throw new Error('公式排版尺寸过大');
  adaptor.setAttribute(root,'width',String(width));adaptor.setAttribute(root,'height',String(height));adaptor.setAttribute(root,'color',color);adaptor.setStyle(root,'color',color);
  const result={source:adaptor.outerHTML(root),width,height};
  if(cache.size>=128)cache.delete(cache.keys().next().value!);cache.set(key,result);return result;
}
