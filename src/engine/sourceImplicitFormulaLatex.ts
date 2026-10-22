import {parseSourceRealExpression} from './domainSourceScalar';
import {emitSourceRealLatex} from './sourceRealLatex';
/** JsonImplicitSurfaceConfig builds the main label from the symbolic initial
 * field, before timeline parameter updates, then appends the zero isosurface. */
export function sourceImplicitFormulaLatex(scene:{equations:Readonly<Record<string,string>>;parameters:Readonly<Record<string,number>>}):string {
 const names=['x','y','z',...Object.keys(scene.parameters).sort()],parsed=parseSourceRealExpression(scene.equations.f,names);
 if(!parsed.ok)throw new Error(`原版隐式曲面主方程：${JSON.stringify(parsed.error)}`);
 const emitted=emitSourceRealLatex(parsed.value,names);
 if(!emitted.ok)throw new Error(`原版隐式曲面主方程：${JSON.stringify(emitted.error)}`);
 return `${emitted.value} = 0`;
}
