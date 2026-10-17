import {bouncingControlGroup} from '../engine/bouncingExperience';
import type {Settings} from '../types';
import {numberSetting} from '../engine/expression';
export type Point=[number,number];
const TAU=Math.PI*2;
const inRange=(p:Point)=>Array.isArray(p)&&p.length===2&&p.every(v=>Number.isFinite(v)&&Math.abs(v)<1e12);
function mode(s:Settings,key:string,fallback:string,allowed:string[]){const v=String(s[key]??fallback);if(!allowed.includes(v))throw new Error(`${key} 不支持 ${v}`);return v;}
function integer(s:Settings,key:string,fallback:number,min:number,max:number){const v=numberSetting(s,key,fallback,min,max);if(!Number.isInteger(v))throw new Error(`${key} 必须是整数`);return v;}
export type Boundary={kind:'circle';radius:number}|{kind:'ellipse';a:number;b:number}|{kind:'polygon';vertices:Point[]};
function cross(a:Point,b:Point):number{return a[0]*b[1]-a[1]*b[0];}
function polygonArea(v:Point[]):number {const origin=v[0];return v.reduce((sum,a,i)=>{const b=v[(i+1)%v.length];return sum+cross([a[0]-origin[0],a[1]-origin[1]],[b[0]-origin[0],b[1]-origin[1]]);},0)/2;}
/** One geometry boundary supplies simplicity, winding and convexity to physics, GPU and editing. */
export function bouncingPolygonFacts(value:unknown):{vertices:Point[];orientation:number;convex:boolean} {
  if(!Array.isArray(value)||value.length<3||value.length>64||value.some(p=>!inRange(p))||Math.abs(polygonArea(value))<1e-9)throw new Error('边界必须是 3 至 64 个顶点的非退化简单多边形');
  const vertices=value as Point[],orientation=Math.sign(polygonArea(vertices));
  // A global coordinate tolerance can merge distinct edges of a thin polygon.
  // Filter each local determinant by its arithmetic error, then resolve uncertain
  // signs using the exact dyadic values of the supplied binary64 coordinates.
  type Dyadic={n:bigint;e:number};
  const bytes=new DataView(new ArrayBuffer(8)),numbers=new Map<number,Dyadic>();
  const dyadic=(value:number):Dyadic=>{
    const cached=numbers.get(value);if(cached)return cached;
    bytes.setFloat64(0,value);const bits=bytes.getBigUint64(0),exponent=Number((bits>>52n)&2047n);
    const mantissa=(bits&0xfffffffffffffn)|(exponent?0x10000000000000n:0n);
    const result={n:bits>>63n?-mantissa:mantissa,e:exponent?exponent-1075:-1074};numbers.set(value,result);return result;
  };
  const subtract=(a:Dyadic,b:Dyadic):Dyadic=>{const e=Math.min(a.e,b.e);return{n:(a.n<<BigInt(a.e-e))-(b.n<<BigInt(b.e-e)),e};};
  const multiply=(a:Dyadic,b:Dyadic):Dyadic=>({n:a.n*b.n,e:a.e+b.e});
  const turn=(a:Point,b:Point,c:Point)=>{
    const left=(a[0]-c[0])*(b[1]-c[1]),right=(a[1]-c[1])*(b[0]-c[0]),det=left-right;
    const epsilon=Number.EPSILON/2,bound=(3+16*epsilon)*epsilon*(Math.abs(left)+Math.abs(right))+4*Number.MIN_VALUE;
    if(Math.abs(det)>bound)return{sign:Math.sign(det),roundoff:false};
    const acx=subtract(dyadic(a[0]),dyadic(c[0])),acy=subtract(dyadic(a[1]),dyadic(c[1]));
    const bcx=subtract(dyadic(b[0]),dyadic(c[0])),bcy=subtract(dyadic(b[1]),dyadic(c[1]));
    const exact=subtract(multiply(acx,bcy),multiply(acy,bcx)).n;
    return{sign:exact>0n?1:exact<0n?-1:0,roundoff:true};
  };
  const on=(a:Point,b:Point,p:Point,sign:number)=>sign===0&&p[0]>=Math.min(a[0],b[0])&&p[0]<=Math.max(a[0],b[0])&&p[1]>=Math.min(a[1],b[1])&&p[1]<=Math.max(a[1],b[1]);
  let convex=true;
  for(let i=0;i<vertices.length;i++){
    const a=vertices[i],b=vertices[(i+1)%vertices.length],c=vertices[(i+2)%vertices.length],corner=turn(a,b,c);
    if(Math.hypot(a[0]-b[0],a[1]-b[1])<1e-9)throw new Error('多边形不能有重复相邻顶点');
    // Midpoint insertion can round one ulp off its edge. Preserve weak convexity
    // for that arithmetic uncertainty; intersection checks still use exact signs.
    if(orientation*corner.sign<0&&!corner.roundoff)convex=false;
    for(let j=i+2;j<vertices.length;j++){
      if(i===0&&j===vertices.length-1)continue;
      const p=vertices[j],q=vertices[(j+1)%vertices.length],abp=turn(a,b,p).sign,abq=turn(a,b,q).sign,pqa=turn(p,q,a).sign,pqb=turn(p,q,b).sign;
      if((abp*abq<0&&pqa*pqb<0)||on(a,b,p,abp)||on(a,b,q,abq)||on(p,q,a,pqa)||on(p,q,b,pqb))throw new Error('多边形边界不能自相交');
    }
  }
  return{vertices,orientation,convex};
}
export function insideBoundary(p:Point,b:Boundary):boolean {
  if(b.kind==='circle')return Math.hypot(...p)<=b.radius+1e-8;
  if(b.kind==='ellipse')return(p[0]/b.a)**2+(p[1]/b.b)**2<=1+1e-8;
  let inside=false;for(let i=0,j=b.vertices.length-1;i<b.vertices.length;j=i++){
    const a=b.vertices[i],q=b.vertices[j],edge:Point=[q[0]-a[0],q[1]-a[1]],rel:Point=[p[0]-a[0],p[1]-a[1]];
    if(Math.abs(cross(edge,rel))<1e-8&&rel[0]*edge[0]+rel[1]*edge[1]>=-1e-8&&rel[0]*edge[0]+rel[1]*edge[1]<=edge[0]**2+edge[1]**2+1e-8)return true;
    if((a[1]>p[1])!==(q[1]>p[1])&&p[0]<(q[0]-a[0])*(p[1]-a[1])/(q[1]-a[1])+a[0])inside=!inside;
  }return inside;
}
function validateBoundary(b:Boundary):void {
  if(b.kind==='circle'){if(!Number.isFinite(b.radius)||b.radius<=0)throw new Error('圆半径必须大于 0');return;}
  if(b.kind==='ellipse'){if(!Number.isFinite(b.a)||!Number.isFinite(b.b)||b.a<=0||b.b<=0)throw new Error('椭圆半轴必须大于 0');return;}
  bouncingPolygonFacts(b.vertices);
}
/** Circle/ellipse radii are reduced per axis. Convex polygons use inward parallel half-planes.
 * The ellipse rule matches the documented axes contract, not the Euclidean offset of an ellipse. */
export function insetBouncingBoundary(source:Boundary,radius:number):Boundary {
  validateBoundary(source);
  if(!Number.isFinite(radius)||radius<0)throw new Error('碰撞半径必须是非负有限数');
  if(source.kind==='circle'){
    const r=source.radius-radius;if(r<=1e-9*source.radius)throw new Error('碰撞半径使圆边界退化');return{kind:'circle',radius:r};
  }
  if(source.kind==='ellipse'){
    const a=source.a-radius,b=source.b-radius;if(Math.min(a,b)<=1e-9*Math.max(source.a,source.b))throw new Error('碰撞半径使椭圆边界退化');return{kind:'ellipse',a,b};
  }
  let vertices:Point[]=source.vertices.map(p=>[...p]);if(radius===0)return{kind:'polygon',vertices};
  const {orientation,convex}=bouncingPolygonFacts(vertices);
  if(!convex)throw new Error('非零碰撞半径需要凸多边形');
  for(let i=0;i<source.vertices.length;i++){
    const a=source.vertices[i],b=source.vertices[(i+1)%source.vertices.length],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy),nx=orientation*dy/length,ny=-orientation*dx/length,limit=nx*a[0]+ny*a[1]-radius;
    const clipped:Point[]=[];
    for(let j=0;j<vertices.length;j++){
      const p=vertices[j],q=vertices[(j+1)%vertices.length],dp=nx*p[0]+ny*p[1]-limit,dq=nx*q[0]+ny*q[1]-limit;
      if(dp<=0)clipped.push(p);
      if((dp<0&&dq>0)||(dp>0&&dq<0)){const t=dp/(dp-dq);clipped.push([p[0]+t*(q[0]-p[0]),p[1]+t*(q[1]-p[1])]);}
    }
    vertices=clipped;if(vertices.length<3)throw new Error('碰撞半径使多边形边界退化');
  }
  const result:Boundary={kind:'polygon',vertices};validateBoundary(result);return result;
}
/** Prepared boundary is owned and copied once; repeated particle flights do not reparse polygon JSON. */
export function prepareBilliard(source:Boundary,radius=0){
  const boundary=insetBouncingBoundary(source,radius);
  if(boundary.kind==='polygon'){boundary.vertices.forEach(Object.freeze);Object.freeze(boundary.vertices);}Object.freeze(boundary);
  const advance=(position:Point,velocity:Point,duration:number)=>{
    if(!inRange(position)||!inRange(velocity)||!Number.isFinite(duration)||duration<0)throw new Error('弹跳位置、速度和时间无效');
    if(!insideBoundary(position,boundary))throw new Error('粒子初始位置必须在碰撞边界内部');
    return advanceBilliardUnchecked(position,velocity,duration,boundary);
  };
  return{boundary,advance};
}
export function advanceBilliard(position:Point,velocity:Point,duration:number,boundary:Boundary,collisionRadius=0):{position:Point;velocity:Point;collisions:number} {
  return prepareBilliard(boundary,collisionRadius).advance(position,velocity,duration);
}
function advanceBilliardUnchecked(position:Point,velocity:Point,duration:number,boundary:Boundary):{position:Point;velocity:Point;collisions:number} {
  let p:Point=[...position],v:Point=[...velocity],remaining=duration,collisions=0;
  if(duration===0||(velocity[0]===0&&velocity[1]===0))return{position:p,velocity:v,collisions:0};
  // A tiny inward offset makes boundary starts well-defined, including tangent rays.
  if(boundary.kind==='circle'&&Math.hypot(...p)>boundary.radius-1e-9){const factor=(boundary.radius-Math.min(1e-9,boundary.radius*1e-9))/(Math.hypot(...p)||1);p=[p[0]*factor,p[1]*factor];}
  if(boundary.kind==='ellipse'&&(p[0]/boundary.a)**2+(p[1]/boundary.b)**2>1-1e-9){p=[p[0]*(1-1e-9),p[1]*(1-1e-9)];}
  while(remaining>0){
    let hit=Infinity,normal:Point=[0,0];
    if(boundary.kind==='circle'||boundary.kind==='ellipse'){
      const a=boundary.kind==='circle'?boundary.radius:boundary.a,b=boundary.kind==='circle'?boundary.radius:boundary.b;
      const A=(v[0]/a)**2+(v[1]/b)**2,B=2*(p[0]*v[0]/(a*a)+p[1]*v[1]/(b*b)),C=(p[0]/a)**2+(p[1]/b)**2-1;
      if(A>0){const disc=B*B-4*A*C;if(disc>=0){const roots=[(-B-Math.sqrt(disc))/(2*A),(-B+Math.sqrt(disc))/(2*A)];for(const root of roots)if(root>0&&root<hit)hit=root;if(Number.isFinite(hit))normal=[(p[0]+v[0]*hit)/(a*a),(p[1]+v[1]*hit)/(b*b)];}}
    }else{
      const vertices=boundary.vertices,orientation=Math.sign(polygonArea(vertices));
      for(let i=0;i<vertices.length;i++){const a=vertices[i],b=vertices[(i+1)%vertices.length],e:Point=[b[0]-a[0],b[1]-a[1]],delta:Point=[a[0]-p[0],a[1]-p[1]],den=cross(v,e);if(Math.abs(den)<1e-12)continue;const t=cross(delta,e)/den,u=cross(delta,v)/den;const length=Math.hypot(...e),outward:Point=[orientation*e[1]/length,-orientation*e[0]/length];if(t>=-1e-10&&u>=-1e-9&&u<=1+1e-9&&(t>1e-9||v[0]*outward[0]+v[1]*outward[1]>1e-10)){if(t<hit-1e-9){hit=Math.max(0,t);normal=outward;}else if(Math.abs(t-hit)<1e-9){normal=[normal[0]+outward[0],normal[1]+outward[1]];}}}
    }
    if(hit>remaining||!Number.isFinite(hit)){p=[p[0]+v[0]*remaining,p[1]+v[1]*remaining];break;}
    p=[p[0]+v[0]*hit,p[1]+v[1]*hit];remaining-=hit;
    const norm=Math.hypot(...normal);normal=[normal[0]/norm,normal[1]/norm];const dot=v[0]*normal[0]+v[1]*normal[1];v=[v[0]-2*dot*normal[0],v[1]-2*dot*normal[1]];
    collisions++;if(collisions>2048)throw new Error('单次弹跳超过 2048 次碰撞，请减小时间或速度');
    const nudge=Math.min(remaining,1e-9/(Math.hypot(...v)||1));p=[p[0]+v[0]*nudge,p[1]+v[1]*nudge];remaining-=nudge;
  }
  return{position:p,velocity:v,collisions};
}
export function boundaryFromSettings(s:Settings):Boundary {
  const kind=mode(s,'boundary','circle',['circle','ellipse','polygon']);let result:Boundary;
  if(kind==='circle')result={kind,radius:numberSetting(s,'radius',3,.01,1000)};
  else if(kind==='ellipse')result={kind,a:numberSetting(s,'radius',3,.01,1000),b:numberSetting(s,'ellipseY',2,.01,1000)};
  else {const raw=String(s.polygon??'').trim();if(raw.length>8192)throw new Error('多边形 JSON 过长');if(raw){let parsed:unknown;try{parsed=JSON.parse(raw);}catch{throw new Error('多边形必须是坐标数组 JSON');}if(!Array.isArray(parsed))throw new Error('多边形必须是坐标数组 JSON');result={kind:'polygon',vertices:parsed};}else{const n=integer(s,'sides',6,3,64),radius=numberSetting(s,'radius',3,.01,1000);result={kind:'polygon',vertices:Array.from({length:n},(_,i)=>[radius*Math.cos(TAU*i/n),radius*Math.sin(TAU*i/n)] as Point)};}}
  validateBoundary(result);return result;
}

/** A fixed simulation clock makes seeking/export independent of preview frame rate. Substeps divide a
 * physical step, never multiply it. Exact ballistic trajectories are invariant to that subdivision. */
export function bouncingElapsedTime(s:Settings,time:number):number {
  if(!Number.isFinite(time))throw new Error('弹跳时间必须有限');
  const clock=String(s.bouncingClock??'seconds');if(!['seconds','fixed-step'].includes(clock))throw new Error('未知弹跳时钟');
  const elapsed=Math.max(0,time)*(clock==='fixed-step'?numberSetting(s,'bouncingTimeStep',.012,.0001,.25)*numberSetting(s,'bouncingFps',60,1,240):1);
  if(!Number.isFinite(elapsed))throw new Error('弹跳派生时间溢出');return elapsed;
}

/** UI consumes the producer's relevance rules; hidden settings remain serialized for later mode switches. */
export function visibleBouncingControls<T extends {key:string}>(controls:T[],s:Settings):T[] {
  const shape=String(s.shape??'ring'),boundary=String(s.boundary??'circle'),velocity=String(s.velocity??'uniform');
  const only:Record<string,string[]>={shapeInnerRatio:['ring','star'],shapeTurns:['spiral','archimedean'],shapeTightness:['spiral'],shapeDegree:['star'],shapeLissajousA:['lissajous'],shapeLissajousB:['lissajous'],shapeLissajousDelta:['lissajous'],shapeRoseK:['rose'],shapeSuperellipseN:['superellipse'],shapeK:['hypocycloid','epicycloid'],shapeBoxBounds:['box'],formulaDomain:['formula'],formulaCoordinates:['formula'],formulaResolution:['formula']};
  return controls.filter(({key})=>{
    const raster=s.bouncingPresentation==='raster';
    if(['bouncingHistoryFps','bouncingHistoryFade'].includes(key))return raster&&s.trails===true;
    if(['bouncingExposure','bouncingView'].includes(key))return raster;
    if(['bouncingViewWidth','bouncingViewCenterX','bouncingViewCenterY'].includes(key))return raster&&s.bouncingView==='fixed';
    if(key==='trailSteps'&&raster)return false;

    for(const [prefix,show]of [['boundary','showBoundary'],['collisionBoundary','showCollisionBoundary'],['initialShape','showInitialShape']])if([prefix+'Color',prefix+'Width',prefix+'Opacity'].includes(key)&&!(s[show]??show==='showBoundary'))return false;
    if(key==='guideResolution')return ((s.showBoundary??true)||s.showCollisionBoundary===true)&&boundary!=='polygon'||s.showInitialShape===true&&!['formula','box','star'].includes(shape)&&(s.fill!==true||['circle','ring'].includes(shape));
    if(only[key]&&!only[key].includes(shape))return false;
    if(['boxMinX','boxMinY','boxMaxX','boxMaxY'].includes(key))return shape==='box'&&s.shapeBoxBounds===true;
    if(key==='ellipseY')return boundary==='ellipse';if(key==='sides'||key==='polygon')return boundary==='polygon';
    if(key==='sides'&&boundary==='polygon'&&String(s.polygon??'').trim())return false;
    if(key==='radius'&&boundary==='polygon'&&String(s.polygon??'').trim())return false;
    if(key==='formulaResolution')return s.fill===false;
    if(key==='shapeLineWidth')return shape!=='box'&&s.fill!==true;
    if(key==='fill')return shape!=='box';
    if(['initialRadius','shapeCenterX','shapeCenterY'].includes(key)&&shape==='box'&&s.shapeBoxBounds===true)return false;
    if(['velocityCenterX','velocityCenterY'].includes(key))return !['uniform','random'].includes(velocity);
    if(key==='angle')return velocity!=='random';
    if(key==='bouncingTimeStep'||key==='bouncingFps')return s.bouncingClock==='fixed-step';
    if(key==='trailSteps'||key==='trailDuration')return s.trails===true;
    return true;
  }).map(control=>({...control,group:bouncingControlGroup(control.key)}));
}
