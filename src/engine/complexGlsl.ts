import type {MathNode} from 'mathjs';
import {compileNode,nodeData,parsed,complexFunctionNames} from './complexMath';

const canonical:Record<string,string>={arcsin:'asin',arccos:'acos',arctan:'atan',ln:'log'};
export const complexGlslFunctionNames=complexFunctionNames;
/** Same bounded arithmetic AST and symbol admission as the CPU owner. No user
 * identifier becomes GLSL text; named inputs are mapped to numeric uniforms. */
export function compileComplexGlsl(source:string,parameters:readonly string[]):string {
 return compileComplexGlslNode(parsed(source),parameters);
}
/** Accept an already parsed tree while retaining the CPU arithmetic admission
 * check. Domain's structure cache owns and reuses this tree across backends. */
export function compileComplexGlslNode(tree:MathNode,parameters:readonly string[]):string {
 compileNode(tree,new Set([...parameters,'z','w','c']));
 function emit(node:MathNode):string{
  const n=nodeData(node);
  if(n.type==='ConstantNode'){const value=Number(n.value);if(!Number.isFinite(Math.fround(value))||(value!==0&&Math.abs(value)<1.1754943508222875e-38))throw new Error('复数常量超出 GPU float32 正规数范围');const literal=String(value);return `vec2(${/[.e]/i.test(literal)?literal:literal+'.0'},0.)`;}
  if(n.type==='SymbolNode'){
   const name=n.name!;if(name==='i')return 'vec2(0.,1.)';if(name==='pi'||name==='PI')return 'vec2(C_PI,0.)';
   if(name==='e'&&!parameters.includes(name))return 'vec2(2.718281828459045,0.)';
   if(['z','w','c'].includes(name))return name;
   const index=parameters.indexOf(name);if(index<0)throw new Error('GPU 未知复数变量 '+name);return `vec2(parameter${index},0.)`;
  }
  if(n.type==='ParenthesisNode')return `(${emit(n.content!)})`;
  if(n.type==='OperatorNode'){
   const args=n.args!.map(emit),names:Record<string,string>={add:'cAdd',subtract:'cSub',multiply:'cMul',divide:'cDiv',pow:'cPow'};
   if(n.fn==='unaryPlus')return args[0];if(n.fn==='unaryMinus')return `(-${args[0]})`;
   if(typeof n.fn==='string'&&names[n.fn])return `${names[n.fn]}(${args.join(',')})`;
  }
  if(n.type==='FunctionNode'){const name=typeof n.fn==='object'?n.fn.name:'',args=n.args!.map(emit);return `c_${canonical[name]??name}(${args.join(',')})`;}
  throw new Error('GPU 复数表达式不受支持');
 }
 return emit(tree);
}

/** Float32 complex principal values. Sensitive branch-cut, cancellation,
 * transcendental-range and nonfinite operations request exact CPU repair.
 * Bit classification avoids ANGLE program-cache fast-math isnan/isinf issues. */
export const complexGlslPrelude=`
const float C_PI=3.141592653589793;
bool complexRepair=false;
float cNaN(){return uintBitsToFloat(0x7fc00000u);}
bool cFinite(float v){return (floatBitsToUint(v)&0x7f800000u)!=0x7f800000u;}
bool cFinite2(vec2 v){return cFinite(v.x)&&cFinite(v.y);}
vec2 cChecked(vec2 v){if(!cFinite2(v)||(v.x!=0.&&abs(v.x)<1.17549435e-38)||(v.y!=0.&&abs(v.y)<1.17549435e-38))complexRepair=true;return v;}
float cMagnitude(vec2 z){float m=max(abs(z.x),abs(z.y));return m==0.?0.:m*length(z/m);}
void cCut(vec2 z){if(z.x<=0.&&abs(z.y)<=max(1.,abs(z.x))*4e-6)complexRepair=true;}
float cArgument(vec2 z){if(z.x==0.&&z.y==0.){bool sx=(floatBitsToUint(z.x)&0x80000000u)!=0u,sy=(floatBitsToUint(z.y)&0x80000000u)!=0u;return sx?(sy?-C_PI:C_PI):(sy?-0.:0.);}return atan(z.y,z.x);}
// Guard each produced component, not just the vector magnitude: re()/im()
// may later expose a cancelled component hidden by the other one. This 2%
// sensitivity heuristic is not a propagated/formal error bound. Keep the
// existing arithmetic expressions unchanged; never quantize their result.
void cCancellation(float a,float b,float value){float base=max(abs(a),abs(b));if(base>0.&&abs(value)<base*.02)complexRepair=true;}
vec2 cAdd(vec2 a,vec2 b){vec2 v=a+b;cCancellation(a.x,b.x,v.x);cCancellation(a.y,b.y,v.y);return cChecked(v);}
vec2 cSub(vec2 a,vec2 b){return cAdd(a,-b);}
vec2 cMul(vec2 a,vec2 b){float size=cMagnitude(a)*cMagnitude(b);if(cMagnitude(a)>0.&&cMagnitude(b)>0.&&size<1.17549435e-38)complexRepair=true;vec2 v=vec2(a.x*b.x-a.y*b.y,a.x*b.y+a.y*b.x);cCancellation(a.x*b.x,-a.y*b.y,v.x);cCancellation(a.x*b.y,a.y*b.x,v.y);return cChecked(v);}
vec2 cDiv(vec2 a,vec2 b){if(b.x==0.&&b.y==0.){complexRepair=true;return vec2(cNaN());}if(cMagnitude(b)<1e-6)complexRepair=true;vec2 v;if(abs(b.x)>=abs(b.y)){float r=b.y/b.x,d=b.x+b.y*r;v=vec2((a.x+a.y*r)/d,(a.y-a.x*r)/d);cCancellation(a.x,a.y*r,a.x+a.y*r);cCancellation(a.y,-a.x*r,a.y-a.x*r);}else{float r=b.x/b.y,d=b.y+b.x*r;v=vec2((a.x*r+a.y)/d,(a.y*r-a.x)/d);cCancellation(a.x*r,a.y,a.x*r+a.y);cCancellation(a.y*r,-a.x,a.y*r-a.x);}return cChecked(v);}
// Relative conditioning of individual transcendental components matters even
// when the enclosing complex magnitude is normal. A later re()/im() and scale
// can expose rounded trigonometric zeros or log(unit magnitude). Use the same
// condition-number threshold50 as arithmetic cancellation. This remains a
// local sensitivity guard, not a forward-error proof for arbitrary composites.
void cPhaseCondition(float phase){float s=sin(phase),c=cos(phase),scale=abs(phase)*.02;if(abs(s)<scale*abs(c)||abs(c)<scale*abs(s))complexRepair=true;}
vec2 c_exp(vec2 z){if(abs(z.x)>80.||abs(z.y)>1024.)complexRepair=true;cPhaseCondition(z.y);return cChecked(exp(z.x)*vec2(cos(z.y),sin(z.y)));}
vec2 c_log(vec2 z){cCut(z);float real=log(cMagnitude(z));if(abs(real)<.02)complexRepair=true;return cChecked(vec2(real,cArgument(z)));}
// Compute the small component by division instead of subtracting nearly equal
// magnitudes. Keep CPU repair where the existing double owner also loses that
// small component: its branch and zeros remain the compatibility contract.
vec2 c_sqrt(vec2 z){cCut(z);float r=cMagnitude(z);if(r==0.)return vec2(0.);if(min(abs(r+z.x),abs(r-z.x))<r*4e-6&&z.y!=0.)complexRepair=true;float large=sqrt(r*.5+abs(z.x)*.5);return cChecked(z.x>=0.?vec2(large,z.y/(2.*large)):vec2(abs(z.y)/(2.*large),(z.y<0.?-1.:1.)*large));}
vec2 cPow(vec2 z,vec2 p){if(p.y==0.&&p.x==floor(p.x)&&abs(p.x)<=128.){int n=int(abs(p.x));vec2 a=vec2(1.,0.),b=z;for(int i=0;i<8;i++){if(n==0)break;if((n&1)==1)a=cMul(a,b);b=cMul(b,b);n=n>>1;}return p.x<0.?cDiv(vec2(1.,0.),a):a;}if(z.x==0.&&z.y==0.)return p.y==0.&&p.x>0.?vec2(0.):vec2(cNaN());return c_exp(cMul(p,c_log(z)));}
vec2 c_pow(vec2 z,vec2 p){return cPow(z,p);}
void cTrig(vec2 z){if(abs(z.x)>1024.||abs(z.y)>80.)complexRepair=true;cPhaseCondition(z.x);}
vec2 c_sin(vec2 z){cTrig(z);return cChecked(vec2(sin(z.x)*cosh(z.y),cos(z.x)*sinh(z.y)));}
vec2 c_cos(vec2 z){cTrig(z);return cChecked(vec2(cos(z.x)*cosh(z.y),-sin(z.x)*sinh(z.y)));}
vec2 c_tan(vec2 z){return cDiv(c_sin(z),c_cos(z));}
vec2 c_sinh(vec2 z){cTrig(z.yx);return cChecked(vec2(sinh(z.x)*cos(z.y),cosh(z.x)*sin(z.y)));}
vec2 c_cosh(vec2 z){cTrig(z.yx);return cChecked(vec2(cosh(z.x)*cos(z.y),sinh(z.x)*sin(z.y)));}
vec2 c_tanh(vec2 z){return cDiv(c_sinh(z),c_cosh(z));}
vec2 c_asin(vec2 z){return cMul(vec2(0.,-1.),c_log(cAdd(cMul(vec2(0.,1.),z),c_sqrt(cSub(vec2(1.,0.),cMul(z,z))))));}
vec2 c_acos(vec2 z){return cSub(vec2(C_PI/2.,0.),c_asin(z));}
vec2 c_atan(vec2 z){return cMul(vec2(0.,.5),cSub(c_log(cSub(vec2(1.,0.),cMul(vec2(0.,1.),z))),c_log(cAdd(vec2(1.,0.),cMul(vec2(0.,1.),z)))));}
vec2 c_acot(vec2 z){return c_atan(cDiv(vec2(1.,0.),z));}
vec2 c_asec(vec2 z){return c_acos(cDiv(vec2(1.,0.),z));}
vec2 c_acsc(vec2 z){return c_asin(cDiv(vec2(1.,0.),z));}
vec2 c_asinh(vec2 z){return c_log(cAdd(z,c_sqrt(cAdd(cMul(z,z),vec2(1.,0.)))));}
vec2 c_acosh(vec2 z){return c_log(cAdd(z,cMul(c_sqrt(cAdd(z,vec2(1.,0.))),c_sqrt(cSub(z,vec2(1.,0.))))));}
vec2 c_atanh(vec2 z){return .5*cSub(c_log(cAdd(vec2(1.,0.),z)),c_log(cSub(vec2(1.,0.),z)));}
vec2 c_acoth(vec2 z){return c_atanh(cDiv(vec2(1.,0.),z));}
vec2 c_arsech(vec2 z){return c_acosh(cDiv(vec2(1.,0.),z));}
vec2 c_abs(vec2 z){return cChecked(vec2(cMagnitude(z),0.));}
vec2 c_arg(vec2 z){cCut(z);return vec2(cArgument(z),0.);}
vec2 c_conj(vec2 z){return vec2(z.x,-z.y);}
vec2 c_re(vec2 z){return vec2(z.x,0.);}
vec2 c_im(vec2 z){return vec2(z.y,0.);}
`;
