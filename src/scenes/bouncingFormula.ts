import {parse,SymbolNode,type MathNode} from 'mathjs';
import {compileReal,numberSetting,type Scope} from '../engine/expression';
import type {Settings} from '../types';
export type FormulaPoint=[number,number];
export type BouncingFormulaSampler=((rng:()=>number,scope:Scope)=>FormulaPoint|null)&{diagnostics:()=>{segments:number;invalid:number;warnings:string[]};outline:(scope:Scope,segments?:number)=>Float64Array};
/** Accept only the Java Math namespace's scalar names. The restricted evaluator owns function permission. */
export function normalizeBouncingFormula(source:string):string {
  if(typeof source!=='string'||source.length>8192||!source.trim())throw new Error('公式需要 1 至 8192 个字符');
  let nodes=0;
  const tree=parse(source.replaceAll('π','pi')).transform((node:MathNode)=>{
    if(++nodes>512)throw new Error('公式过于复杂（超过 512 个节点）');
    if(node.type!=='AccessorNode')return node;
    const n=node as unknown as {object:{type:string;name:string};index:{dotNotation:boolean;dimensions:{type:string;value:unknown}[]}};
    const dimensions=n.index.dimensions;
    if(n.object.type!=='SymbolNode'||n.object.name!=='Math'||!n.index.dotNotation||dimensions.length!==1||dimensions[0].type!=='ConstantNode')throw new Error('公式不允许访问对象或数组');
    const name=String(dimensions[0].value);if(!/^[a-zA-Z]+$/.test(name)||['constructor','prototype'].includes(name))throw new Error('公式不允许此 Math 成员');
    return new SymbolNode(name==='E'?'e':name);
  });
  const normalized=tree.toString();compileReal(normalized);return normalized;
}
function unparenthesize(node:MathNode):MathNode {return node.type==='ParenthesisNode'?unparenthesize((node as unknown as {content:MathNode}).content):node;}
/** Predicate fill and implicit boundary sampling. Contours are independently reconstructed by a finite grid;
 * no claim of the reference sampler's random distribution or pixel parity is made. */
export function createBouncingFormulaSampler(source:string,s:Settings,options:{isCancelled?:()=>boolean}={}):BouncingFormulaSampler {
  const formula=normalizeBouncingFormula(source),predicate=compileReal(formula),root=unparenthesize(parse(formula));
  const node=root as unknown as {fn?:string;args?:MathNode[]};
  const compare=['smaller','larger','smallerEq','largerEq','equal','unequal'].includes(node.fn??'');
  const lhs=compare?compileReal(node.args![0].toString()):undefined,rhs=compare?compileReal(node.args![1].toString()):undefined;
  const logical=node.fn==='and'||node.fn==='or';
  const radius=numberSetting(s,'initialRadius',2,0,1000),cx=numberSetting(s,'shapeCenterX',0,-1e6,1e6),cy=numberSetting(s,'shapeCenterY',0,-1e6,1e6),width=numberSetting(s,'shapeLineWidth',0,0,1000),resolution=numberSetting(s,'formulaResolution',128,16,1024),fill=s.fill!==false;
  if(!Number.isInteger(resolution))throw new Error('公式轮廓分辨率必须是整数');
  const domain=String(s.formulaDomain??'square'),coordinates=String(s.formulaCoordinates??'local');
  if(!['square','disc'].includes(domain)||!['local','world'].includes(coordinates))throw new Error('公式采样域或坐标模式无效');
  let key='',segments=new Float64Array(0),lengths=new Float64Array(0),totalLength=0,invalid=0;
  const warnings:string[]=[];
  function scopeAt(scope:Scope,x:number,y:number){return{...scope,x:x+(coordinates==='world'?cx:0),y:y+(coordinates==='world'?cy:0)};}
  const value=(scope:Scope,x:number,y:number)=>{const p=scopeAt(scope,x,y);return compare?lhs!(p)-rhs!(p):logical?(predicate(p)!==0?1:-1):predicate(p);};
  function build(scope:Scope){
    const nextKey=JSON.stringify(Object.entries(scope).sort(([a],[b])=>a.localeCompare(b)));if(nextKey===key&&segments.length)return;
    for(const v of Object.values(scope))if(!Number.isFinite(v))throw new Error('公式参数必须为有限数');
    warnings.length=0;invalid=0;totalLength=0;
    if(radius===0)throw new Error('零半径采样域没有可采样公式轮廓');
    const step=2*radius/resolution,grid=new Float64Array((resolution+1)**2),at=(x:number,y:number)=>y*(resolution+1)+x;
    for(let y=0;y<=resolution;y++){
      if((y&15)===0&&options.isCancelled?.())throw new Error('公式轮廓采样已取消');
      for(let x=0;x<=resolution;x++){const v=value(scope,x*step-radius,y*step-radius);grid[at(x,y)]=v;if(!Number.isFinite(v))invalid++;}
    }
    let data=new Float64Array(4096),cursor=0;const maxSegments=262144;
    const append=(p:FormulaPoint,q:FormulaPoint)=>{
      if(domain==='disc'){
        const dx=q[0]-p[0],dy=q[1]-p[1],A=dx*dx+dy*dy,B=2*(p[0]*dx+p[1]*dy),C=p[0]*p[0]+p[1]*p[1]-radius*radius,D=B*B-4*A*C;
        if(A===0||D<0)return;const low=Math.max(0,(-B-Math.sqrt(D))/(2*A)),high=Math.min(1,(-B+Math.sqrt(D))/(2*A));if(low>=high)return;
        q=[p[0]+high*dx,p[1]+high*dy];p=[p[0]+low*dx,p[1]+low*dy];
      }
      if(Math.hypot(p[0]-q[0],p[1]-q[1])<radius*1e-12)return;
      if(cursor>=maxSegments*4)throw new Error(`公式轮廓超过 ${maxSegments} 段资源预算，请减小分辨率或简化公式`);
      if(cursor+4>data.length){const larger=new Float64Array(Math.min(maxSegments*4,data.length*2));larger.set(data);data=larger;}
      data.set([...p,...q],cursor);cursor+=4;
    };
    const crossing=(a:FormulaPoint,b:FormulaPoint,va:number,vb:number):FormulaPoint=>{
      if(va===0)return a;if(vb===0)return b;
      let left=a,right=b,lv=va,rv=vb;
      // Bisection also resolves composite predicates; a discontinuity is a predicate boundary, not a pole contour.
      for(let i=0;i<12;i++){
        const fraction=logical?.5:Math.max(.05,Math.min(.95,lv/(lv-rv))),m:FormulaPoint=[left[0]+(right[0]-left[0])*fraction,left[1]+(right[1]-left[1])*fraction],v=value(scope,...m);
        if(!Number.isFinite(v)){invalid++;return[NaN,NaN];}if(v===0)return m;
        if((v<0)===(lv<0)){left=m;lv=v;}else{right=m;rv=v;}
      }
      // Poles can change sign without a zero. Reject unresolved nonlogical jumps instead of drawing fake contours.
      if(!logical&&Math.min(Math.abs(lv),Math.abs(rv))>Math.max(1,Math.min(Math.abs(va),Math.abs(vb)))*.01)return[NaN,NaN];
      const f=logical?.5:lv/(lv-rv);return[left[0]+(right[0]-left[0])*f,left[1]+(right[1]-left[1])*f];
    };
    const zeroEdges=new Set<number>();
    const triangle=(points:FormulaPoint[],values:number[],ids:number[])=>{
      if(values.some(v=>!Number.isFinite(v))||values.every(v=>v===0))return;
      const intersections:FormulaPoint[]=[];
      for(let i=0;i<3;i++){const j=(i+1)%3,a=values[i],b=values[j];if(a===0&&b===0){const edge=Math.min(ids[i],ids[j])*grid.length+Math.max(ids[i],ids[j]);if(!zeroEdges.has(edge)){zeroEdges.add(edge);append(points[i],points[j]);}return;}if((a<0)!==(b<0)||a===0||b===0){const p=crossing(points[i],points[j],a,b);if(p.every(Number.isFinite)&&!intersections.some(q=>Math.hypot(p[0]-q[0],p[1]-q[1])<radius*1e-12))intersections.push(p);}}
      if(intersections.length===2)append(intersections[0],intersections[1]);
    };
    for(let y=0;y<resolution;y++){
      if((y&15)===0&&options.isCancelled?.())throw new Error('公式轮廓采样已取消');
      for(let x=0;x<resolution;x++){
        const p:FormulaPoint=[x*step-radius,y*step-radius],q:FormulaPoint=[p[0]+step,p[1]],r:FormulaPoint=[p[0]+step,p[1]+step],u:FormulaPoint=[p[0],p[1]+step];
        triangle([p,q,r],[grid[at(x,y)],grid[at(x+1,y)],grid[at(x+1,y+1)]],[at(x,y),at(x+1,y),at(x+1,y+1)]);triangle([p,r,u],[grid[at(x,y)],grid[at(x+1,y+1)],grid[at(x,y+1)]],[at(x,y),at(x+1,y+1),at(x,y+1)]);
      }
    }
    if(cursor===0)throw new Error('采样域内没有可解析公式轮廓；请检查条件、采样域或增加轮廓分辨率');
    segments=data.slice(0,cursor);lengths=new Float64Array(cursor/4);
    for(let i=0;i<lengths.length;i++){totalLength+=Math.hypot(segments[i*4+2]-segments[i*4],segments[i*4+3]-segments[i*4+1]);lengths[i]=totalLength;}
    warnings.push(`公式轮廓采用 ${resolution}×${resolution} 网格和 ${lengths.length} 段边界的弧长采样；小于网格尺度的细节可能遗漏。`);
    if(invalid)warnings.push(`公式轮廓跳过 ${invalid} 个非有限采样值；没有将其替换为有效区域。`);
    key=nextKey;
  }
  const sampler:BouncingFormulaSampler=Object.assign((rng:()=>number,scope:Scope):FormulaPoint|null=>{
    if(fill){let x:number,y:number;if(domain==='disc'){const angle=rng()*2*Math.PI,r=Math.sqrt(rng())*radius;x=r*Math.cos(angle);y=r*Math.sin(angle);}else{x=(rng()*2-1)*radius;y=(rng()*2-1)*radius;}const v=predicate(scopeAt(scope,x,y));return Number.isFinite(v)&&v!==0?[x+cx,y+cy]:null;}
    build(scope);const distance=rng()*totalLength;let low=0,high=lengths.length-1;while(low<high){const mid=(low+high)>>>1;if(lengths[mid]<distance)low=mid+1;else high=mid;}
    const i=low*4,dx=segments[i+2]-segments[i],dy=segments[i+3]-segments[i+1],length=lengths[low]-(low?lengths[low-1]:0),f=(distance-(low?lengths[low-1]:0))/length,offset=(rng()*2-1)*width,x=segments[i]+f*dx-dy/length*offset,y=segments[i+1]+f*dy+dx/length*offset;
    if(domain==='disc'&&Math.hypot(x,y)>radius)return null;
    return[x+cx,y+cy];
  },{diagnostics:()=>({segments:lengths.length,invalid,warnings:[...warnings]}),outline:(scope:Scope)=>{build(scope);const result=segments.slice();for(let i=0;i<result.length;i+=2){result[i]+=cx;result[i+1]+=cy;}return result;}});
  return sampler;
}
