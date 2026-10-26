import {parseSourceRealExpression} from './domainSourceScalar';
import {sourceAttractorVariableNames} from './sourceAttractorEquation';
import {emitSourceRealLatex} from './sourceRealLatex';

/** JsonAttractorConfig's JSONObject/reloadConfig entry uses the JSON name.
 * Its automatic label preserves symbolic initial expressions and escapes only
 * underscores in the title. File-constructor displayLabel is a separate input. */
export function sourceAttractorFormulaLatex(input:{name:string;equations:Readonly<Record<string,string>>;parameters:Readonly<Record<string,number>>}):string {
 const names=sourceAttractorVariableNames(input.parameters);
 const lines=['x','y','z'].map(axis=>{
  const parsed=parseSourceRealExpression(input.equations['d'+axis],names);
  if(!parsed.ok)throw new Error(`原版吸引子主方程 d${axis}：${JSON.stringify(parsed.error)}`);
  const emitted=emitSourceRealLatex(parsed.value,names);
  if(!emitted.ok)throw new Error(`原版吸引子主方程 d${axis}：${JSON.stringify(emitted.error)}`);
  return `\\dot{${axis}} = ${emitted.value}`;
 });
 return `\\text{${input.name.replaceAll('_','\\_')}}=\\begin{cases} ${lines.join(' \\\\ ')} \\end{cases}`;
}
