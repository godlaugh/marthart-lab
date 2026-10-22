import {DOMAIN_SOURCE_SCALAR_LIMITS,type SourceRealExpressionNode} from './domainSourceScalar';

/** Local output admission, not a restriction in the native expression grammar.
 * A rope keeps left-associated expressions linear without repeated string copies. */
export const SOURCE_REAL_LATEX_LIMITS=Object.freeze({characters:131072,nodes:DOMAIN_SOURCE_SCALAR_LIMITS.nodes});
export type SourceRealLatexResult={readonly ok:true;readonly value:string}|{readonly ok:false;readonly error:
 {readonly kind:'capacity';readonly resource:'characters'|'nodes';readonly limit:number;readonly actual:number}|
 {readonly kind:'input'|'unsupported';readonly reason:string}};
type Failure=Extract<SourceRealLatexResult,{ok:false}>['error'];
class EmissionFailure extends Error {constructor(readonly detail:Failure){super(detail.kind);}}
const fail=(reason:string):never=>{throw new EmissionFailure({kind:'input',reason});};
type Piece=string|Rope;
interface Rope {readonly parts:readonly Piece[];readonly length:number;readonly first:string;}
const greek=new Set('alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega'.split(' '));
const constants:Readonly<Record<string,string>>={PI:'\\pi',TWO_PI:'2\\pi',TAU:'\\tau',HALF_PI:'\\frac{\\pi}{2}',E:'e'};
const precedence=(node:SourceRealExpressionNode)=>node.kind==='binary'?(node.op==='+'||node.op==='-'?1:node.op==='^'?4:2):node.kind==='unary'?3:5;
/** Constant.toLatex uses a saturating Java long cast before Double.toString.
 * Decimal spelling follows the modern JDK shortest-round-trip representation;
 * scientific notation uses Java's exponent threshold and mandatory fraction. */
function constant(value:number):string {
 if(Number.isInteger(value)&&value>=-(2**63)&&value<=2**63)return value===2**63?'9223372036854775807':BigInt(value).toString();
 if(!Number.isFinite(value))return String(value);
 const magnitude=Math.abs(value);
 if(magnitude!==0&&(magnitude<.001||magnitude>=1e7)){
  let [mantissa,exponent]=value.toExponential().split('e');
  // Java selects the closest decimal with at least two significant digits
  // here; appending '.0' to JS's one-digit spelling loses subnormal identity.
  if(!mantissa.includes('.'))[mantissa,exponent]=value.toExponential(1).split('e');
  return `${mantissa}E${Number(exponent)}`;
 }
 return String(value);
}
/** Native FastExpression.toLatex from the shared source-parser AST. This emits
 * source quirks literally (including raw '%' and unknown TeX commands such as
 * '\\round'); it does not reinterpret an expression with the local math parser.
 * Variable names must be the same ordered slot names used to parse the AST. */
export function emitSourceRealLatex(root:SourceRealExpressionNode,names:readonly string[]):SourceRealLatexResult {
 try{
  const rope=(...parts:Piece[]):Rope=>{
   let length=0,first='';for(const part of parts){length+=part.length;if(!first&&part.length)first=typeof part==='string'?part[0]:part.first;}
   if(length>SOURCE_REAL_LATEX_LIMITS.characters)throw new EmissionFailure({kind:'capacity',resource:'characters',limit:SOURCE_REAL_LATEX_LIMITS.characters,actual:length});
   return{parts,length,first};
  };
  const parens=(part:Rope)=>rope('\\left(',part,'\\right)');
  const pending:{node:SourceRealExpressionNode;ready:boolean;count?:number}[]=[{node:root,ready:false}],values:Rope[]=[];
  let visited=0;
  while(pending.length){
   const {node,ready,count=0}=pending.pop()!;
   if(!ready&&++visited>SOURCE_REAL_LATEX_LIMITS.nodes)throw new EmissionFailure({kind:'capacity',resource:'nodes',limit:SOURCE_REAL_LATEX_LIMITS.nodes,actual:visited});
   if(node.kind==='number'){
    if(node.name&&!Object.hasOwn(constants,node.name))return{ok:false,error:{kind:'unsupported',reason:`Unknown named source constant ${node.name}`}};
    values.push(rope(node.name?constants[node.name]:constant(node.value)));continue;
   }
   if(node.kind==='variable'){
    const name=names[node.slot];if(typeof name!=='string')fail('Source formula variable slot has no matching name');
    if(name.length>SOURCE_REAL_LATEX_LIMITS.characters)throw new EmissionFailure({kind:'capacity',resource:'characters',limit:SOURCE_REAL_LATEX_LIMITS.characters,actual:name.length});
    const lower=name.toLowerCase();values.push(rope(greek.has(lower)?'\\'+lower:name));continue;
   }
   if(!ready){
    let children:readonly SourceRealExpressionNode[];
    if(node.kind==='unary'){if(!['+','-'].includes(node.op))fail('Unknown source unary operator');children=[node.argument];}
    else if(node.kind==='binary'){if(!['+','-','*','/','%','^'].includes(node.op))fail('Unknown source binary operator');children=[node.left,node.right];}
    else {
     // These four native branches directly index arguments, while every other
     // function prints joinArgs(), even when evaluation ignores extra arguments.
     const take=node.name==='pow'?2:['sqrt','abs','exp'].includes(node.name)?1:node.args.length;
     if(node.args.length<take)fail(`Source ${node.name}.toLatex requires ${take} arguments`);
     if(take>SOURCE_REAL_LATEX_LIMITS.nodes-visited)throw new EmissionFailure({kind:'capacity',resource:'nodes',limit:SOURCE_REAL_LATEX_LIMITS.nodes,actual:visited+take});
     children=node.args.slice(0,take);
    }
    pending.push({node,ready:true,count:children.length});for(let i=children.length-1;i>=0;i--)pending.push({node:children[i],ready:false});continue;
   }
   const args=values.splice(values.length-count,count);let [left,right]=args,result:Rope;
   if(node.kind==='unary')result=rope(node.op,precedence(node.argument)<3?parens(left):left);
   else if(node.kind==='binary'){
    const rank=precedence(node);
    if(node.op==='/')result=rope('\\frac{',left,'}{',right,'}');
    else if(node.op==='^')result=rope('{',precedence(node.left)<5?parens(left):left,'}^{',right,'}');
    else{
     if(precedence(node.left)<rank)left=parens(left);
     if(precedence(node.right)<rank||precedence(node.right)===rank&&node.op==='-')right=parens(right);
     result=node.op==='*'?rope(left,/^[0-9]$/.test(right.first)?' \\cdot ':' ',right):rope(left,' ',node.op,' ',right);
    }
   }else if(node.name==='sqrt')result=rope('\\sqrt{',left,'}');
   else if(node.name==='abs')result=rope('\\left|',left,'\\right|');
   else if(node.name==='pow')result=rope('{',left,'}^{',right,'}');
   else if(node.name==='exp')result=rope('e^{',left,'}');
   else{
    const commands:Readonly<Record<string,string>>={asin:'\\arcsin',acos:'\\arccos',atan:'\\arctan',atan2:'\\operatorname{atan2}',ln:'\\ln',log:'\\log',log10:'\\log_{10}',sign:'\\operatorname{sign}'};
    const joined:Piece[]=[];for(const arg of args){if(joined.length)joined.push(', ');joined.push(arg);}
    result=rope(commands[node.name]??'\\'+node.name,'(',...joined,')');
   }
   values.push(result);
  }
  const output:string[]=[],pieces:Piece[]=[values[0]];
  while(pieces.length){const piece=pieces.pop()!;if(typeof piece==='string')output.push(piece);else for(let i=piece.parts.length-1;i>=0;i--)pieces.push(piece.parts[i]);}
  return{ok:true,value:output.join('')};
 }catch(error){if(error instanceof EmissionFailure)return{ok:false,error:error.detail};throw error;}
}
