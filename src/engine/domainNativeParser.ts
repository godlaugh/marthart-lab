import {ConstantNode,FunctionNode,OperatorNode,SymbolNode,type MathNode} from 'mathjs';
import {domainNativeFunctionNames} from './domainNativeArithmetic';

/** Syntax recovery is part of native applyConfig; resource failures are not. */
export class NativeExpressionSyntaxError extends Error {
 constructor(message:string){super(message);this.name='NativeExpressionSyntaxError';}
}
export class NativeExpressionCapacityError extends Error {
 constructor(message:string){super(message);this.name='NativeExpressionCapacityError';}
}

/** Source parser grammar from retained ComplexExpressionParser$Parser bytecode.
 * This deliberately does not pass native text through MathJS's language: native
 * 1e3 is 1*e3, sin (z) is sin*z, and implicit multiplication shares the
 * left-associative multiplication/division level. MathJS nodes are only the AST shape.
 * Original default-locale lowercasing is approximated with Unicode lowercasing;
 * locale-sensitive non-ASCII identifier equivalence is not established. */
export function parseDomainNativeExpression(raw:string):MathNode {
 if(raw.length>8192)throw new NativeExpressionCapacityError('复数公式超过 8192 字符');
 if(raw.replace(/^[\x00-\x20]+|[\x00-\x20]+$/g,'')==='')return new ConstantNode(0);
 const source=raw.toLowerCase(),known=new Set<string>(domainNativeFunctionNames);let at=0,nodes=0,depth=0;
 if(source.length>8192)throw new NativeExpressionCapacityError('复数公式超过 8192 字符');
 const node=<T extends MathNode>(value:T):T=>{if(++nodes>512)throw new NativeExpressionCapacityError('复数公式超过 512 个节点');return value;};
 const syntax=(message:string):never=>{throw new NativeExpressionSyntaxError(`${message}（位置 ${at+1}）`);};
 const spaces=()=>{while(source[at]===' ')at++;};
 const eat=(character:string)=>{spaces();if(source[at]===character){at++;return true;}return false;};
 const letter=(character:string|undefined)=>character!==undefined&&/\p{L}/u.test(character);
 const digit=(character:string|undefined)=>character!==undefined&&character>='0'&&character<='9';
 const identifierPart=(character:string|undefined)=>character!==undefined&&(character==='_'||/[\p{L}\p{Nd}]/u.test(character));
 const operator=(op:'+'|'-'|'*'|'/'|'^',a:MathNode,b:MathNode)=>node(new OperatorNode(op,({'+':'add','-':'subtract','*':'multiply','/':'divide','^':'pow'} as const)[op],[a,b]));
 function expression():MathNode {
  let result=term();while(true){if(eat('+'))result=operator('+',result,term());else if(eat('-'))result=operator('-',result,term());else return result;}
 }
 function term():MathNode {
  let result=factor();while(true){
   if(eat('*'))result=operator('*',result,factor());
   else if(eat('/'))result=operator('/',result,factor());
   else{spaces();const c=source[at];if(c==='('||c==='.'||digit(c)||letter(c)||c==='_')result=operator('*',result,factor());else return result;}
  }
 }
 function factor():MathNode {
  if(++depth>512)throw new NativeExpressionCapacityError('复数公式嵌套超过 512 层');
  try{
   if(eat('+'))return factor();
   if(eat('-'))return node(new OperatorNode('-','unaryMinus',[factor()]));
   let result=primary();if(eat('^'))result=operator('^',result,factor());return result;
  }finally{depth--;}
 }
 function primary():MathNode {
  if(eat('|')){const result=expression();if(!eat('|'))syntax('缺少绝对值结束符');return node(new FunctionNode(new SymbolNode('abs'),[result]));}
  if(eat('(')){const result=expression();if(!eat(')'))syntax('缺少右括号');return result;}
  spaces();const start=at,c=source[at];
  if(digit(c)||c==='.'){
   while(digit(source[at])||source[at]==='.')at++;
   const text=source.slice(start,at);if(!/^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$/.test(text))syntax('数值格式无效');
   return node(new ConstantNode(Number(text)));
  }
  if(letter(c)||c==='_'){
   while(identifierPart(source[at]))at++;
   const name=source.slice(start,at);
   if(known.has(name)&&source[at]==='('){
    at++;const args:MathNode[]=[expression()];while(eat(','))args.push(expression());if(!eat(')'))syntax('缺少函数右括号');
    if(args.length!==(name==='pow'?2:1))syntax('复函数参数数量无效：'+name);
    return node(new FunctionNode(new SymbolNode(name),args));
   }
   return node(new SymbolNode(name));
  }
  return syntax('无法解析复数公式');
 }
 const result=expression();spaces();if(at!==source.length)syntax('公式中存在未解析内容');
 let retained=0;result.traverse(()=>{if(++retained>512)throw new NativeExpressionCapacityError('复数公式超过 512 个节点');});
 return result;
}
