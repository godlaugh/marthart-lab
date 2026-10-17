import type {Settings} from '../types';

export interface SymmetryFormulaToken {text:string;latex:string;key?:string;target?:string}
const literal=(text:string,latex=text):SymmetryFormulaToken=>({text,latex});
const variable=(key:string,text:string,latex:string,target=`param-${key}`):SymmetryFormulaToken=>({key,text,latex,target});
/** Presentation of symmetryStep's complex form. Both the inspector and exported
 * main equation consume these tokens, including the modified radial term. */
export function symmetryFormula(settings:Settings):SymmetryFormulaToken[]{
 const template=settings.template??'standard';
 if(template!=='standard'&&template!=='modified')throw new Error('未知对称方程模板');
 const degree=()=>variable('degree','n','n','control-degree');
 return[
  literal('z′ = [','z_{k+1}=\\left['),variable('lambda','λ','\\lambda'),literal(' + '),variable('alpha','α','\\alpha'),literal('|z|²','|z_k|^2'),literal(' + '),variable('beta','β','\\beta'),literal(' Re(z^','\\operatorname{Re}(z_k^{'),degree(),literal(')', '})'),
  ...(template==='modified'?[
   literal(' + '),variable('delta','δ','\\delta'),literal('|z| cos(','|z_k|\\cos('),degree(),literal('·','\\,'),variable('deltaPower','p','p','control-deltaPower'),literal('·arg(z))','\\,\\arg z_k)')
  ]:[]),
  literal(' + i','+i'),variable('omega','ω','\\omega'),literal('] z + ', '\\right]z_k+'),variable('gamma','γ','\\gamma'),literal(' conj(z)^(', '\\overline{z_k}^{'),degree(),literal('−1)', '-1}')
 ];
}
export const symmetryEquationLatex=(settings:Settings)=>symmetryFormula(settings).map(t=>t.latex).join('');
