import {describe,it,expect} from 'vitest';
import {parseSourceRealExpression,type SourceRealExpressionNode} from '../src/engine/domainSourceScalar';
import {emitSourceRealLatex,SOURCE_REAL_LATEX_LIMITS} from '../src/engine/sourceRealLatex';
import fixture from './fixtures/source-real-latex-native.json';
function render(source:string,names:readonly string[]=['u','v']){
 const parsed=parseSourceRealExpression(source,names);return parsed.ok?emitSourceRealLatex(parsed.value,names):parsed;
}
describe('source FastExpression.toLatex native compatibility',()=>{
 it.each(fixture.cases)('$id: $source',item=>{
  const result=render(item.source,item.names);
  if('error' in item)expect(result.ok).toBe(false);
  else expect(result).toEqual({ok:true,value:item.latex});
 });
 it('retains exact slot names and parameter shadowing instead of folding values',()=>{
  expect(render('PI+pi+u',['PI','u','u'])).toEqual({ok:true,value:'\\pi + \\pi + u'});
  expect(emitSourceRealLatex({kind:'variable',slot:0},[])).toMatchObject({ok:false,error:{kind:'input'}});
 });
 it('handles a long left-associated AST without recursive stack or quadratic text expansion',()=>{
  const source=Array.from({length:4000},()=> 'u').join('+');
  expect(render(source)).toEqual({ok:true,value:Array.from({length:4000},()=> 'u').join(' + ')});
 });
 it('bounds rendered expansion before flattening repeated long variable names',()=>{
  const name='a'.repeat(1024),source=Array.from({length:200},()=>name).join('+');
  let ast:SourceRealExpressionNode={kind:'variable',slot:0};
  for(let i=1;i<200;i++)ast={kind:'binary',op:'+',left:ast,right:{kind:'variable',slot:0}};
  expect(emitSourceRealLatex(ast,[name])).toMatchObject({ok:false,error:{kind:'capacity',resource:'characters',limit:SOURCE_REAL_LATEX_LIMITS.characters}});
  // The parser independently owns its input admission.
  expect(render(source,[name])).toMatchObject({ok:false,error:{kind:'capacity'}});
 });
 it('bounds malformed cyclic or excessive AST traversal',()=>{
  const node:{kind:'unary';op:string;argument:SourceRealExpressionNode}={kind:'unary',op:'-',argument:{kind:'number',value:1}};node.argument=node;
  expect(emitSourceRealLatex(node,[])).toMatchObject({ok:false,error:{kind:'capacity',resource:'nodes'}});
 });
});
