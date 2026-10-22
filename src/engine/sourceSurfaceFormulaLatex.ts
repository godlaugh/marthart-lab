import {parseSourceRealExpression} from './domainSourceScalar';
import {emitSourceRealLatex} from './sourceRealLatex';

/** JsonSurfaceConfig's automatic label uses symbolic initial equations, not
 * sampled positions or parameter values. Only underscores in the label name
 * are escaped by the original builder. Explicit local TeX is handled upstream. */
export function sourceSurfaceFormulaLatex(input:{name:string;equations:Readonly<Record<string,string>>;parameters:Readonly<Record<string,number>>}):string {
 const names=['u','v',...Object.keys(input.parameters).sort()];
 const lines=['x','y','z'].map(axis=>{
  const parsed=parseSourceRealExpression(input.equations[axis],names);
  if(!parsed.ok)throw new Error(`原版曲面主方程 ${axis}：${JSON.stringify(parsed.error)}`);
  const emitted=emitSourceRealLatex(parsed.value,names);
  if(!emitted.ok)throw new Error(`原版曲面主方程 ${axis}：${JSON.stringify(emitted.error)}`);
  return `${axis} = ${emitted.value}`;
 });
 return `\\text{${input.name.replaceAll('_','\\_')}}=\\begin{cases} ${lines.join(' \\\\ ')} \\end{cases}`;
}
