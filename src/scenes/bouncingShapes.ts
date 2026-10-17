import type {Settings} from '../types';
import {numberSetting} from '../engine/expression';
import {createBouncingFormulaSampler,type BouncingFormulaSampler} from './bouncingFormula';
type Point=[number,number];
export type BouncingShapeSampler=((rng:()=>number,scope:Record<string,number>)=>Point|null)&{diagnostics?:BouncingFormulaSampler['diagnostics'];outline:(scope:Record<string,number>,segments?:number)=>Float64Array};
export const BOUNCING_SHAPES=['box','circle','ring','spiral','archimedean','star','heart','lissajous','rose','infinity','superellipse','hypocycloid','epicycloid','formula'] as const;
function integer(s:Settings,k:string,f:number,lo:number,hi:number){const n=numberSetting(s,k,f,lo,hi);if(!Number.isInteger(n))throw new Error(`${k} 必须为整数`);return n;}
/** Flat XY pairs, two points per segment; exact corners are retained rather than joining random particles. */
function polyline(points:Point[],closed:boolean):Float64Array {
  const data:number[]=[];for(let i=1;i<points.length;i++)data.push(...points[i-1],...points[i]);
  if(closed&&points.length>1&&Math.hypot(points.at(-1)![0]-points[0][0],points.at(-1)![1]-points[0][1])>1e-12)data.push(...points.at(-1)!,...points[0]);return new Float64Array(data);
}
function contour(curve:(u:number)=>Point,segments=1024,closed=true):Float64Array {
  if(!Number.isInteger(segments)||segments<16||segments>16384)throw new Error('形状轮廓需要 16 至 16384 段');
  return polyline(Array.from({length:segments+1},(_,i)=>curve(i/segments)),closed);
}
function inside(p:Point,vertices:Point[]):boolean {let yes=false;for(let i=0,j=vertices.length-1;i<vertices.length;j=i++){const a=vertices[i],b=vertices[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;}
/** Compile shape geometry once. Outline width is the half-width of a normal strip, in scene units. */
export function createBouncingShapeSampler(shape:string,s:Settings,formula='sin(8*x)*sin(8*y)>0.5',options:{isCancelled?:()=>boolean}={}):BouncingShapeSampler {
  if(!(BOUNCING_SHAPES as readonly string[]).includes(shape))throw new Error(`未知初始形状 ${shape}`);
  const radius=numberSetting(s,'initialRadius',2,0,1000),cx=numberSetting(s,'shapeCenterX',0,-1e6,1e6),cy=numberSetting(s,'shapeCenterY',0,-1e6,1e6),width=numberSetting(s,'shapeLineWidth',0,0,1000),fill=s.fill===true;
  const local=(p:Point):Point=>[p[0]+cx,p[1]+cy];
  if(shape==='box'){
    const useBounds=s.shapeBoxBounds===true,xmin=useBounds?numberSetting(s,'boxMinX',-1):-radius+cx,xmax=useBounds?numberSetting(s,'boxMaxX',1):radius+cx,ymin=useBounds?numberSetting(s,'boxMinY',-1):-radius+cy,ymax=useBounds?numberSetting(s,'boxMaxY',1):radius+cy;
    if(xmax<xmin||ymax<ymin)throw new Error('初始矩形上限小于下限');return Object.assign((r:()=>number):Point=>[xmin+r()*(xmax-xmin),ymin+r()*(ymax-ymin)],{outline:()=>polyline([[xmin,ymin],[xmax,ymin],[xmax,ymax],[xmin,ymax]],true)});
  }
  if(shape==='formula')return createBouncingFormulaSampler(formula,s,options);
  const TAU=Math.PI*2,inner=numberSetting(s,'shapeInnerRatio',.4,0,1),turns=numberSetting(s,'shapeTurns',5,.01,100),tightness=numberSetting(s,'shapeTightness',0,0,100),starN=integer(s,'shapeDegree',5,2,64),roseK=integer(s,'shapeRoseK',Number(s.shapeDegree??5),1,64),k=integer(s,'shapeK',shape==='epicycloid'?2:4,2,64),la=integer(s,'shapeLissajousA',3,1,64),lb=integer(s,'shapeLissajousB',4,1,64),delta=numberSetting(s,'shapeLissajousDelta',Math.PI/2,-10000,10000),exponent=numberSetting(s,'shapeSuperellipseN',4,.1,100);
  if(radius===0&&!(shape==='spiral'&&tightness>0))return Object.assign(():Point=>[cx,cy],{outline:()=>new Float64Array()});
  if(shape==='circle'||shape==='ring')return Object.assign((r:()=>number):Point=>{
    const theta=TAU*r();let rr:number;
    if(fill){const insideRadius=shape==='ring'?inner*radius:0;rr=Math.sqrt(insideRadius*insideRadius+r()*(radius*radius-insideRadius*insideRadius));}
    else rr=Math.max(0,radius*(shape==='ring'?(1+inner)/2:1)+(r()*2-1)*width);
    return local([rr*Math.cos(theta),rr*Math.sin(theta)]);
  },{outline:(_scope:Record<string,number>,segments=1024)=>{const radii=shape==='ring'?(fill?(inner>0?[radius,inner*radius]:[radius]):[radius*(1+inner)/2]):[radius],parts=radii.map(rr=>contour(u=>local([rr*Math.cos(TAU*u),rr*Math.sin(TAU*u)]),segments)),out=new Float64Array(parts.reduce((n,p)=>n+p.length,0));let cursor=0;for(const p of parts){out.set(p,cursor);cursor+=p.length;}return out;}});
  let star:Point[]|undefined;if(shape==='star')star=Array.from({length:starN*2},(_,i)=>{const a=i*Math.PI/starN,rr=radius*(i%2?inner:1);return[rr*Math.cos(a),rr*Math.sin(a)];});
  const curve=(u:number):Point=>{
    const a=TAU*u,co=Math.cos(a),si=Math.sin(a);
    switch(shape){
      case 'spiral':case 'archimedean':{const theta=a*turns,rr=radius*u+(shape==='spiral'?theta*tightness*.05:0);return[rr*Math.cos(theta),rr*Math.sin(theta)];}
      case 'star':{const t=((u%1)+1)%1*star!.length,i=Math.floor(t),f=t-i,p=star![i],q=star![(i+1)%star!.length];return[p[0]+(q[0]-p[0])*f,p[1]+(q[1]-p[1])*f];}
      case 'heart':return[radius*si**3,radius*(13*co-5*Math.cos(2*a)-2*Math.cos(3*a)-Math.cos(4*a))/17];
      case 'lissajous':return[radius*Math.sin(la*a+delta),radius*Math.sin(lb*a)];
      case 'rose':{const rr=radius*Math.cos(roseK*a);return[rr*co,rr*si];}
      case 'infinity':return[radius*co/(1+si*si),radius*si*co/(1+si*si)];
      case 'superellipse':return[radius*Math.sign(co)*Math.abs(co)**(2/exponent),radius*Math.sign(si)*Math.abs(si)**(2/exponent)];
      case 'hypocycloid':return[radius*((k-1)*co+Math.cos((k-1)*a))/k,radius*((k-1)*si-Math.sin((k-1)*a))/k];
      case 'epicycloid':return[radius*((k+1)*co-Math.cos((k+1)*a))/(k+2),radius*((k+1)*si-Math.sin((k+1)*a))/(k+2)];
      default:throw new Error('不可达的形状');
    }
  };
  if(fill){
    // Even-odd interior of the closed sampled contour; open spirals close along their endpoint chord.
    const n=Math.min(4096,Math.max(256,32*Math.max(la,lb,k,roseK),Math.ceil(turns*64))),polygon=star??Array.from({length:n},(_,i)=>curve(i/(n-1))),xmin=Math.min(...polygon.map(p=>p[0])),xmax=Math.max(...polygon.map(p=>p[0])),ymin=Math.min(...polygon.map(p=>p[1])),ymax=Math.max(...polygon.map(p=>p[1]));
    return Object.assign((r:()=>number)=>{const p:Point=[xmin+r()*(xmax-xmin),ymin+r()*(ymax-ymin)];return inside(p,polygon)?local(p):null;},{outline:()=>polyline(polygon.map(local),true)});
  }
  return Object.assign((r:()=>number)=>{const u=r(),p=curve(u);if(width===0)return local(p);const h=1e-5,left=curve(Math.max(0,u-h)),right=curve(Math.min(1,u+h)),dx=right[0]-left[0],dy=right[1]-left[1],len=Math.hypot(dx,dy),offset=(r()*2-1)*width;return local(len>1e-12?[p[0]-dy/len*offset,p[1]+dx/len*offset]:p);},{outline:(_scope:Record<string,number>,segments=1024)=>star?polyline(star.map(local),true):contour(u=>local(curve(u)),segments,!['spiral','archimedean'].includes(shape))});
}
/** Initial velocity noise is an angular perturbation, not an unadvertised time-varying force. */
export function createBouncingVelocitySampler(s:Settings):(point:Point,rng:()=>number)=>Point {
  const speed=numberSetting(s,'speed',1,0,100),angle=numberSetting(s,'angle',Math.PI/2,-10000,10000),spread=numberSetting(s,'spread',0,0,Math.PI*2),noise=numberSetting(s,'velocityNoise',0,0,1),cx=numberSetting(s,'velocityCenterX',0,-1e6,1e6),cy=numberSetting(s,'velocityCenterY',0,-1e6,1e6),mode=String(s.velocity??'uniform');
  if(!['uniform','random','out','in','cw','ccw'].includes(mode))throw new Error(`未知速度方向 ${mode}`);
  return (point,rng)=>{
  if(!Array.isArray(point)||point.length!==2||!point.every(Number.isFinite))throw new Error('初始位置必须有限');
  const dx=point[0]-cx,dy=point[1]-cy,radial=Math.hypot(dx,dy)>1e-6?Math.atan2(dy,dx):angle;
  const base=mode==='uniform'?angle:mode==='random'?Math.PI*2*rng():Math.hypot(dx,dy)<=1e-6?angle:radial+(mode==='in'?Math.PI:mode==='cw'?-Math.PI/2:mode==='ccw'?Math.PI/2:0),a=base+(rng()-.5)*(spread+noise*Math.PI*2);
  return[speed*Math.cos(a),speed*Math.sin(a)];
  };
}
export function bouncingInitialVelocity(point:Point,s:Settings,rng:()=>number):Point {return createBouncingVelocitySampler(s)(point,rng);}
