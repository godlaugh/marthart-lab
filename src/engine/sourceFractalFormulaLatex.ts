import {SOURCE_FRACTAL_FORMULA_METADATA,type SourceFractalFormulaConfiguration} from './sourceFractalFormulaRuntime';
import {sourceFractalFormulaIdentity} from './sourceFractalIdentity';

const templates:Readonly<Record<string,string>>={
 newton:String.raw`z_{n+1} = z_n - {relaxation} \frac{z_n^{{{exponent}}} - 1}{{{exponent}} z_n^{{{exponent}}-1}}`,
 nova:String.raw`z_{n+1} = z_n - {relaxation} \frac{z_n^{{{exponent}}} - 1}{{{exponent}} z_n^{{{exponent}}-1}} + {julia_seed}`,
};
const decimals=new Intl.NumberFormat('en-US',{useGrouping:false,minimumFractionDigits:4,maximumFractionDigits:4});
/** JsonComplexFractalConfig.formatReal. Decimal formatting is checked against
 * the retained JVM oracle; it does not assert every Java printf rounding edge. */
export function sourceFractalFormulaReal(value:number):string {
 if(!Number.isFinite(value))return '0';
 if(Math.abs(value-Math.round(value))<1e-6){
  if(value>=2**63)return '9223372036854775807';
  if(value<=-(2**63))return '-9223372036854775808';
  return BigInt(Math.round(value)).toString();
 }
 return decimals.format(value).replace(/0+$/,'').replace(/\.$/,'');
}
export function sourceFractalFormulaComplex(value:readonly number[]|null):string {
 if(!value||value.length<2)return '0';
 const [re,im]=value,real=sourceFractalFormulaReal(re),imaginary=sourceFractalFormulaReal(Math.abs(im));
 if(Math.abs(im)<1e-6)return real;
 if(Math.abs(re)<1e-6)return`${im<0?'-':''}${imaginary}i`;
 return`${real} ${im<0?'-':'+'} ${imaginary}i`;
}
/** Source text is constructed from the initial typed ParamSet and metadata,
 * before the Mobject maps native slots. Animation and hot Mobject changes do
 * not rewrite the Scene's existing TexMobject. Explicit custom text is owned
 * by the separate local formula configuration. */
export function sourceFractalFormulaLatex(configuration:SourceFractalFormulaConfiguration):string {
 const id=sourceFractalFormulaIdentity(configuration),template=Object.hasOwn(templates,id)?templates[id]:undefined;
 if(template===undefined)throw Error(`原版分形公式 ${id} 的主方程标注尚未验证`);
 let result=template;
 for(const definition of SOURCE_FRACTAL_FORMULA_METADATA[id]){
  const value=definition.kind==='complex'
   ?sourceFractalFormulaComplex(configuration.parameters?.complex[definition.name]??definition.defaultValue as readonly[number,number])
   :sourceFractalFormulaReal(Math.fround(configuration.parameters?.floats[definition.name]??definition.defaultValue as number));
  for(const count of [3,2,1])result=result.replaceAll('{'.repeat(count)+definition.name+'}'.repeat(count),value);
 }
 return result;
}
