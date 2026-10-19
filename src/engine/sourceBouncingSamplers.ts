import {prepareSourceRealExpression,type SourceRealExpression} from './domainSourceScalar';
import type {JavaSourceRandom48} from './javaSourceRandom';
import type {SourceBouncingConfiguration,SourceBouncingResult} from './sourceBouncingConfig';
import {javaTrim} from './sourceJavaText';

export type SourceBouncingSamplerConfiguration=Readonly<Pick<SourceBouncingConfiguration,
 'initialPositionMode'|'initialCircleCenterX'|'initialCircleCenterY'|'initialCircleRadius'|
 'initialXMin'|'initialXMax'|'initialYMin'|'initialYMax'|'shapeFillMode'|'shapeLineWidth'|
 'shapeInnerRatio'|'shapeNumPoints'|'shapeNumTurns'|'shapeTightness'|'shapeLissajousA'|
 'shapeLissajousB'|'shapeLissajousDelta'|'shapeRoseK'|'shapeSuperellipseN'|'shapeK'|'shapeFormula'>>;
export interface SourceBouncingSamplingHooks {
 /** One unit before each candidate, plus AST nodes before each formula eval.
  * Cancellation/budget exceptions belong to the caller and propagate unchanged. */
 consume(work:number):void;
}
export interface SourceBouncingSampler {sample(rng:JavaSourceRandom48,hooks?:SourceBouncingSamplingHooks):[number,number];}
const F=Math.fround;
const angle=(rng:JavaSourceRandom48)=>rng.nextDouble()*Math.PI*2;
const randomInRange=(rng:JavaSourceRandom48,min:number,max:number)=>F(min+F(rng.nextFloat()*F(max-min)));
/** Shared source outline sequence: sqrt(dx*dx+dy*dy), not hypot; small
 * tangents use denominator 1. These are unscaled normals even for anisotropy. */
function normal(dx:number,dy:number):[number,number]{let length=Math.sqrt(dx*dx+dy*dy);if(length<1e-6)length=1;return[-dy/length,dx/length];}
const operators=['>=','<=','!=','==','>','<'] as const;
type Comparison=typeof operators[number];
interface Predicate {left?:SourceRealExpression;right?:SourceRealExpression;op?:Comparison;}
function preparePredicate(formula:string):SourceBouncingResult<Predicate>{
 if(formula==='')return{ok:true,value:{}};
 // FormulaSampler.splitComparison PC64–66 requires index > 0, and uses
 // operator priority rather than the leftmost operator or nesting awareness.
 let op:Comparison|undefined,index=-1;
 for(const candidate of operators){const found=formula.indexOf(candidate);if(found>0){op=candidate;index=found;break;}}
 const left=prepareSourceRealExpression(op?javaTrim(formula.slice(0,index)):formula,['x','y']);
 if(!left.ok)return{ok:false,error:{kind:left.error.kind,path:['shapeFormula'],reason:JSON.stringify(left.error)}};
 if(!op)return{ok:true,value:{left:left.value}};
 const right=prepareSourceRealExpression(javaTrim(formula.slice(index+op.length)),['x','y']);
 if(!right.ok)return{ok:false,error:{kind:right.error.kind,path:['shapeFormula'],reason:JSON.stringify(right.error)}};
 return{ok:true,value:{left:left.value,right:right.value,op}};
}
function evaluatePredicate(predicate:Predicate,x:number,y:number,hooks?:SourceBouncingSamplingHooks):boolean{
 if(!predicate.left)return true;
 const values=[x,y];
 hooks?.consume(predicate.left.operations);
 let left:number;
 try{left=predicate.left.evaluate(values);}catch{return true;}
 if(!predicate.op)return left!==0;
 hooks?.consume(predicate.right!.operations);
 let right:number;
 try{right=predicate.right!.evaluate(values);}catch{return true;}
 switch(predicate.op){case '>=':return left>=right;case '<=':return left<=right;case '!=':return left!==right;case '==':return left===right;case '>':return left>right;case '<':return left<right;}
}
/** MathArt 1.7.8 ShapeSamplerFactory and concrete sample(Random) bytecode.
 * Fixed JAR SHA256 a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018.
 * Input is already parsed canonical configuration; only native constructor
 * clamps are repeated here. Returned tuple components have Java float rounding.
 * JS/Java transcendental last bits and whole native images are not certified.
 * Source nonfinite arithmetic and 512-attempt center fallback are preserved. */
export function createSourceBouncingSampler(config:SourceBouncingSamplerConfiguration):SourceBouncingResult<SourceBouncingSampler>{
 const mode=config.initialPositionMode,cx=config.initialCircleCenterX,cy=config.initialCircleCenterY;
 const radius=Math.max(0,config.initialCircleRadius),width=Math.max(F(.001),config.shapeLineWidth),outline=config.shapeFillMode==='OUTLINE';
 const ratio=Math.max(0,Math.min(1,config.shapeInnerRatio)),points=Math.max(3,config.shapeNumPoints);
 const turns=Math.max(F(.1),config.shapeNumTurns),tightness=Math.max(0,Math.min(1,config.shapeTightness));
 const a=Math.max(1,config.shapeLissajousA),b=Math.max(1,config.shapeLissajousB),delta=config.shapeLissajousDelta;
 const roseK=Math.max(1,config.shapeRoseK),n=Math.max(F(.01),config.shapeSuperellipseN),k=Math.max(2,config.shapeK);
 const xmin=Math.min(config.initialXMin,config.initialXMax),xmax=Math.max(config.initialXMin,config.initialXMax);
 const ymin=Math.min(config.initialYMin,config.initialYMax),ymax=Math.max(config.initialYMin,config.initialYMax);
 const predicate=mode==='FORMULA'?preparePredicate(config.shapeFormula):{ok:true as const,value:{}};
 if(!predicate.ok)return predicate;
 const world=(x:number,y:number):[number,number]=>[F(cx+F(x)),F(cy+F(y))];
 const jitter=(rng:JavaSourceRandom48)=>(rng.nextDouble()-.5)*width*2;
 return{ok:true,value:{sample(rng,hooks){
  // Rejection samplers charge every inner candidate, including their first.
  if(mode==='FORMULA'){
   for(let attempt=0;attempt<512;attempt++){
    hooks?.consume(1);
    const t=angle(rng),r=Math.sqrt(rng.nextDouble())*radius,x=F(Math.cos(t)*r),y=F(Math.sin(t)*r);
    const wx=F(cx+x),wy=F(cy+y);
    if(evaluatePredicate(predicate.value,wx,wy,hooks)){
     if(!outline)return[wx,wy];
     const half=width*.5,jx=(rng.nextDouble()-.5)*half,jy=(rng.nextDouble()-.5)*half;
     return[F(wx+F(jx)),F(wy+F(jy))];
    }
   }
   return[cx,cy];
  }
  if((mode==='HEART'||mode==='INFINITY')&&!outline){
   for(let attempt=0;attempt<512;attempt++){
    hooks?.consume(1);
    if(mode==='HEART'){
     const x=randomInRange(rng,F(-1.35),F(1.35)),y=randomInRange(rng,F(-1.2),F(1.35));
     const aa=F(F(F(x*x)+F(y*y))-1),value=F(F(F(aa*aa)*aa)-F(F(F(F(x*x)*y)*y)*y));
     if(value<=0)return[F(cx+F(F(x*radius)*F(.74))),F(cy+F(F(y*radius)*F(.74)))];
    }else{
     const x=randomInRange(rng,F(-1.2),F(1.2)),y=randomInRange(rng,F(-.8),F(.8));
     const value=F(x*x)*(F(x*x)+2*y*y-1)+F(F(F(y*y)*y)*y);
     if(value<0)return[F(cx+F(x*radius)),F(cy+F(y*radius))];
    }
   }
   return[cx,cy];
  }
  hooks?.consume(1);
  switch(mode){
   // Factory has no ARCHIMEDEAN_SPIRAL branch: it reaches BoxSampler.
   case 'BOX':case 'ARCHIMEDEAN_SPIRAL':return[randomInRange(rng,xmin,xmax),randomInRange(rng,ymin,ymax)];
   case 'CIRCLE':{
    const t=angle(rng),r=outline?radius+jitter(rng):Math.sqrt(rng.nextDouble())*radius;
    return world(Math.cos(t)*r,Math.sin(t)*r);
   }
   case 'RING':{
    const t=angle(rng),inner=F(radius*ratio);
    const r=outline?F(inner+radius)/2+jitter(rng):Math.sqrt(rng.nextDouble()*F(F(radius*radius)-F(inner*inner))+F(inner*inner));
    return world(Math.cos(t)*r,Math.sin(t)*r);
   }
   case 'STAR':{
    const t=angle(rng),modulation=ratio+(1-ratio)*Math.cos(points*t);
    const r=outline?radius*modulation+jitter(rng):Math.sqrt(rng.nextDouble())*radius*modulation;
    return world(Math.cos(t)*r,Math.sin(t)*r);
   }
   case 'SPIRAL':{
    let u=rng.nextDouble(),t=u*Math.PI*2*turns,r=u*radius+t*tightness*.05;
    if(outline){
     const dr=radius/(6.283185307179586*turns)+tightness*.05;
     const [nx,ny]=normal(-Math.sin(t)*r+Math.cos(t)*dr,Math.cos(t)*r+Math.sin(t)*dr),j=jitter(rng);
     return world(Math.cos(t)*r+nx*j,Math.sin(t)*r+ny*j);
    }
    u=rng.nextDouble();t=u*Math.PI*2*turns;r=u*radius+t*tightness*.05;
    return world(Math.cos(t)*r,Math.sin(t)*r);
   }
   case 'LISSAJOUS':{
    let t=angle(rng);
    if(outline){const [nx,ny]=normal(a*Math.cos(a*t+delta)*radius,b*Math.cos(b*t)*radius),j=jitter(rng);return world(Math.sin(a*t+delta)*radius+nx*j,Math.sin(b*t)*radius+ny*j);}
    t=angle(rng);const radial=Math.sqrt(rng.nextDouble());return world(radial*Math.sin(a*t+delta)*radius,radial*Math.sin(b*t)*radius);
   }
   case 'ROSE':{
    let t=angle(rng),r=Math.cos(roseK*t)*radius;
    if(outline){
     const dr=-roseK*Math.sin(roseK*t)*radius;
     // Retained RoseSampler PC84–127 has the extra cos/sin products.
     const [nx,ny]=normal(-Math.sin(t)*r+Math.cos(t)*dr*Math.cos(t),Math.cos(t)*r+Math.sin(t)*dr*Math.sin(t)),j=jitter(rng);
     return world(Math.cos(t)*r+nx*j,Math.sin(t)*r+ny*j);
    }
    t=angle(rng);r=Math.sqrt(rng.nextDouble())*Math.cos(roseK*t)*radius;return world(Math.cos(t)*r,Math.sin(t)*r);
   }
   case 'SUPERELLIPSE':{
    let t=angle(rng),c=Math.cos(t),s=Math.sin(t),factor=Math.pow(Math.pow(Math.abs(c),n)+Math.pow(Math.abs(s),n),-1/n);
    const power=2/n-1;
    let x=factor*Math.sign(c)*Math.pow(Math.abs(c),power),y=factor*Math.sign(s)*Math.pow(Math.abs(s),power);
    if(outline){const [nx,ny]=normal(-y,x),j=jitter(rng);return world(x*radius+nx*j,y*radius+ny*j);}
    const radial=Math.pow(rng.nextDouble(),1/F(n+2));t=angle(rng);c=Math.cos(t);s=Math.sin(t);factor=Math.pow(Math.pow(Math.abs(c),n)+Math.pow(Math.abs(s),n),-1/n);
    x=radial*factor*Math.sign(c)*Math.pow(Math.abs(c),power);y=radial*factor*Math.sign(s)*Math.pow(Math.abs(s),power);
    return world(x*radius,y*radius);
   }
   case 'HYPOCYCLOID':case 'EPICYCLOID':{
    const epi=mode==='EPICYCLOID',lobes=(k+(epi?1:-1))|0,ratio=lobes/k;
    let t=angle(rng)*(epi?k:1);
    if(outline){
     const x=epi?ratio*Math.cos(t)-1/k*Math.cos(lobes*t):ratio*Math.cos(t)+1/k*Math.cos(lobes*t),y=ratio*Math.sin(t)-1/k*Math.sin(lobes*t);
     const dx=epi?-ratio*Math.sin(t)+lobes*1/k*Math.sin(lobes*t):-ratio*Math.sin(t)-lobes*1/k*Math.sin(lobes*t),dy=ratio*Math.cos(t)-lobes*1/k*Math.cos(lobes*t);
     const [nx,ny]=normal(dx,dy),j=jitter(rng);return world(radius*(x+nx*j),radius*(y+ny*j));
    }
    const radial=Math.sqrt(rng.nextDouble());t=angle(rng)*(epi?k:1);
    const x=radial*(epi?ratio*Math.cos(t)-1/k*Math.cos(lobes*t):ratio*Math.cos(t)+1/k*Math.cos(lobes*t)),y=radial*(ratio*Math.sin(t)-1/k*Math.sin(lobes*t));return world(radius*x,radius*y);
   }
   case 'HEART':{
    const t=angle(rng),s=Math.sin(t),c=Math.cos(t),x=16*s*s*s,y=-(13*c-5*Math.cos(2*t)-2*Math.cos(3*t)-Math.cos(4*t));
    const [nx,ny]=normal(48*s*s*c,13*s-10*Math.sin(2*t)-6*Math.sin(3*t)-4*Math.sin(4*t)),j=jitter(rng);
    return world(x*radius*.05+nx*j,y*radius*.05+ny*j);
   }
   case 'INFINITY':{
    const t=angle(rng),s=Math.sin(t),c=Math.cos(t),[nx,ny]=normal(c,c*c-s*s),j=jitter(rng);
    return world(s*radius*.8+nx*j,s*c*radius*.8+ny*j);
   }
  }
 }} };
}
