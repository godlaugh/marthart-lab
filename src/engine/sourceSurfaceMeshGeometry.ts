/** MeshSurface parameter-grid and seam owner, derived from MathArt 1.7.8
 * (a6e1da3…24018). CPU normals retain its discarded PVector.cross result;
 * GPU positions/normals and wireframe shading belong to the shader owner. */
export type SourceMeshVector=readonly [number,number,number];
type SourceMeshUv=readonly [number,number];
export interface SourceSurfaceMeshSeams {
 wrapU:boolean;wrapV:boolean;twistedU:boolean;twistedV:boolean;shiftU:number;
}
export interface SourceSurfaceGpuMeshGeometryFrame {
 /** Retained PShape parameters, never world positions: u, v, speedU, speedV.
  * GenericSurfaceScene initializes both MeshSurface speeds to zero. */
 seeds:Float32Array;triangles:Uint32Array;sourceColorIndices:Uint32Array;
 seams:SourceSurfaceMeshSeams;
}
export interface SourceSurfaceMeshGeometryConfiguration {
 numU:number;numV:number;uMin:number;uMax:number;vMin:number;vMax:number;
 meshWrapU:boolean;meshWrapV:boolean;meshWrapThreshold:number;
 /** Return scaled Float32 coordinates. Offset must only be included when true.
  * Sampling is pure within a draw; a reused temporary result is supported. */
 sample:(u:number,v:number,includeOffset:boolean)=>SourceMeshVector;
 /** Called before allocation and bounded work. Charge formula evaluation in sample. */
 reserve:(units:number)=>void;
}
export interface SourceSurfaceMeshGeometryFrame {
 /** Independently owned buffers; the owner never mutates a returned frame. */
 positions:Float32Array;normals:Float32Array;triangles:Uint32Array;
 /** CPU coupled wireframe traverses main + V indexed triangles, then U quads.
  * The UV corner is fill-only. These preserve the original traversal order. */
 wireframeIndexedTriangles:Uint32Array;wireframeUSeamQuads:Float32Array;
 /** U-major particle indices supplying each vertex's base color. */
 sourceColorIndices:Uint32Array;
 seams:SourceSurfaceMeshSeams;
}
const F=Math.fround,FLOAT_MAX=3.4028234663852886e38;
const finite=(p:SourceMeshVector)=>p.every(Number.isFinite);
const sub=(a:SourceMeshVector,b:SourceMeshVector):SourceMeshVector=>[F(a[0]-b[0]),F(a[1]-b[1]),F(a[2]-b[2])];
const magnitude=(p:SourceMeshVector)=>F(Math.sqrt(F(F(F(p[0]*p[0])+F(p[1]*p[1]))+F(p[2]*p[2]))));
const distance=(a:SourceMeshVector,b:SourceMeshVector)=>magnitude(sub(a,b));
const clamp=(x:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,x));
const round=(x:number)=>Number.isNaN(x)?0:clamp(Math.floor(x+.5),-2147483648,2147483647);

/** Keep one owner per native MeshSurface lifetime. Parameter/palette changes do
 * not invalidate its continuous U shift. Bounds, wrap-U and threshold setters
 * do; fixed configuration changes are represented by a new owner. */
export function createSourceSurfaceMeshGeometry(config:SourceSurfaceMeshGeometryConfiguration){
 const {numU,numV,sample,reserve}=config;
 if(![numU,numV].every(n=>Number.isInteger(n)&&n>=1&&n<=512))throw new Error('原版网格每轴采样数必须在 1–512');
 for(const n of [config.uMin,config.uMax,config.vMin,config.vMax,config.meshWrapThreshold])if(!Number.isFinite(F(n)))throw new Error('原版网格边界与接缝阈值需要有限 Float32');
 if(typeof config.meshWrapU!=='boolean'||typeof config.meshWrapV!=='boolean')throw new Error('原版网格接缝开关需要布尔值');
 const uMin=F(config.uMin),uMax=F(config.uMax),vMin=F(config.vMin),vMax=F(config.vMax);
 const explicitU=config.meshWrapU,explicitV=config.meshWrapV,threshold=Math.max(0,F(config.meshWrapThreshold));
 const uRange=F(uMax-uMin),vRange=F(vMax-vMin),slices=numU-1,stacks=numV-1;
 const atU=(i:number)=>F(uMin+F(uRange*F(i/slices)));
 const atV=(j:number)=>F(vMin+F(vRange*F(j/stacks)));
 let twistedU=false,twistedV=false,shiftU=0,shiftDirty=true,failed=false,failure:unknown;
 function guarded<T>(operation:()=>T):T {
  if(failed)throw failure;
  try{return operation();}catch(error){failed=true;failure=error;throw error;}
 }
 function position(u:number,v:number,includeOffset=true):SourceMeshVector {
  reserve(1);const p=sample(u,v,includeOffset);return[F(p[0]),F(p[1]),F(p[2])];
 }
 function isSeamClosed(axis:'u'|'v'):boolean {
  reserve(1);if(numU<2||numV<2)return false;
  const isU=axis==='u',step=F((isU?uRange:vRange)/(isU?slices:stacks));
  if(!(Math.abs(step)>F(1e-6)))return false;
  let same=0,twist=0,spacing=0;
  for(let k=0;k<6;k++){
   const t=F(k/5),other=isU?F(vMin+F(vRange*t)):F(uMin+F(uRange*t));
   const reflected=isU?F(vMax-F(vRange*t)):F(uMax-F(uRange*t));
   const a=isU?position(uMin,other,false):position(other,vMin,false);
   const b=isU?position(uMax,other,false):position(other,vMax,false);
   const c=isU?position(uMax,reflected,false):position(reflected,vMax,false);
   const d=isU?position(F(uMin+step),other,false):position(other,F(vMin+step),false);
   same=F(same+distance(a,b));twist=F(twist+distance(a,c));spacing=F(spacing+distance(a,d));
  }
  same=F(same/6);twist=F(twist/6);spacing=F(spacing/6);
  if(spacing>0){
   const limit=F(spacing*threshold);
   if(same<=limit){if(isU)twistedU=false;else twistedV=false;return true;}
   if(twist<=limit){if(isU)twistedU=true;else twistedV=true;return true;}
  }
  // The original V method leaves its previous twist flag intact on failure.
  if(isU)twistedU=false;return false;
 }
 function shouldWrapU(){const closed=isSeamClosed('u');return explicitU||closed;}
 function shouldWrapV(){isSeamClosed('v');return explicitV||isSeamClosed('v');}
 function normalize(index:number,period:number,wrap:boolean){
  if(period<=0)return 0;
  if(!wrap)return clamp(index,0,period);
  let result=F(index%period);if(result<0)result=F(result+period);return result;
 }
 function mappedIndex(index:number,shift:number,wrap:boolean){
  const period=Math.max(1,stacks);let result=normalize(F(index+shift),period,wrap);
  if(twistedU)result=normalize(F(period-result),period,wrap);return result;
 }
 function mapV(index:number){return F(vMin+F(vRange*F(mappedIndex(F(index),shiftU,shouldWrapV())/Math.max(1,stacks))));}
 function shiftScore(shift:number){
  reserve(1);const count=Math.min(18,Math.max(16,numV*2)),period=Math.max(1,stacks),wrap=shouldWrapV();
  let sum=0,valid=0;
  for(let i=0;i<count;i++){
   const t=F(i/(count-1)),v=F(vMin+F(vRange*t));
   const mapped=F(vMin+F(vRange*F(mappedIndex(F(t*period),shift,wrap)/period)));
   const a=position(uMax,v),b=position(uMin,mapped);
   if(finite(a)&&finite(b)){sum=F(sum+distance(a,b));valid++;}
  }
  return valid?F(sum/valid):FLOAT_MAX;
 }
 function ensureShift(){
  if(!shiftDirty)return;
  shiftU=0;shiftDirty=false;
  if(numU<2||numV<2)return;
  const period=Math.max(1,stacks),divisions=Math.max(32,period*2);let best=FLOAT_MAX;
  for(let i=0;i<=divisions;i++){
   const shift=F(-period+F(F(2*period)*F(i/divisions))),score=shiftScore(shift);
   if(score<best){best=score;shiftU=shift;}
  }
  const radius=Math.max(1,F(period*F(.25)));
  for(let i=0;i<=64;i++){
   // Deliberately use the live best shift as the moving refinement center.
   const shift=F(F(shiftU-radius)+F(F(2*radius)*F(i/64))),score=shiftScore(shift);
   if(score<best){best=score;shiftU=shift;}
  }
 }
 function normal(u:number,v:number,p:SourceMeshVector,param:boolean):SourceMeshVector {
  let du:number,dv:number;
  if(param){du=F(uRange*F(.001));dv=F(vRange*F(.001));if(du===0)du=F(.0001);if(dv===0)dv=F(.0001);}
  else{du=Math.max(F(Math.abs(uRange)*F(1e-5)),F(1e-6));dv=Math.max(F(Math.abs(vRange)*F(1e-5)),F(1e-6));}
  const backU=param?!(F(u+du)<=uMax):F(u-du)>=uMin;
  const neighbor=position(backU?F(u-du):F(u+du),v),tangent=backU?sub(p,neighbor):sub(neighbor,p);
  const backV=param?!(F(v+dv)<=vMax):F(v-dv)>=vMin;
  // The V derivative is evaluated by the native code even though cross's
  // returned vector is discarded. Keep its evaluation and resource charge.
  position(u,backV?F(v-dv):F(v+dv));
  const mag=magnitude(tangent);
  if(param)return mag!==0&&mag!==1?[F(tangent[0]/mag),F(tangent[1]/mag),F(tangent[2]/mag)]:tangent;
  if(!(mag>F(1e-8)))return[0,0,1];
  const reciprocal=F(1/mag);return[F(tangent[0]*reciprocal),F(tangent[1]*reciprocal),F(tangent[2]*reciprocal)];
 }
 function nearestColor(u:number,v:number){
  const i=round(F(clamp(F(F(u-uMin)/Math.max(Math.abs(uRange),F(1e-6))),0,1)*slices));
  const j=round(F(clamp(F(F(v-vMin)/Math.max(Math.abs(vRange),F(1e-6))),0,1)*stacks));
  const index=clamp(j*numU+i,0,numU*numV-1);return(index%numU)*numV+Math.floor(index/numU);
 }
 function paletteShiftDistance(twist:boolean){
  const n=Math.max(2,numV),count=Math.min(6,n);let best=FLOAT_MAX;
  for(let shift=1-n;shift<n;shift++){
   let sum=0,valid=0;
   for(let k=0;k<count;k++){
    const i=round(F((n-1)*F(k/(count-1))));let j=((i+shift)%n+n)%n;if(twist)j=((n-1-j)%n+n)%n;
    const a=position(uMin,F(vMin+F(vRange*F(i/(n-1)))),false);
    const b=position(uMax,F(vMin+F(vRange*F(j/(n-1)))),false);
    if(finite(a)&&finite(b)){sum=F(sum+distance(a,b));valid++;}
   }
   if(valid)best=Math.min(best,F(sum/valid));
  }
  return best;
 }
 function cyclicPaletteU(){
  if(shouldWrapU())return true;
  if(numU<2||numV<2)return false;const step=F(uRange/slices);
  if(!(Math.abs(step)>F(1e-6)))return false;
  let sum=0,valid=0;
  for(let k=0;k<6;k++){
   const v=F(vMin+F(vRange*F(k/5))),a=position(uMin,v,false),b=position(F(uMin+step),v,false);
   if(finite(a)&&finite(b)){sum=F(sum+distance(a,b));valid++;}
  }
  if(!valid)return false;const spacing=F(sum/valid);if(!(spacing>0))return false;
  const best=Math.min(paletteShiftDistance(false),paletteShiftDistance(true));
  return Number.isFinite(best)&&best<=F(spacing*Math.max(threshold,F(.35)));
 }
 function gridVertices(visit:(index:number,u:number,v:number,colorIndex:number)=>void){
  for(let j=0;j<numV;j++)for(let i=0;i<numU;i++)visit(j*numU+i,atU(i),atV(j),i*numV+j);
 }
 function diagonal(points:readonly SourceMeshVector[]):boolean {
  // GPU useACDiagonal/Param selects AC for an invalid corner; callers on the
  // CPU path perform their separate omit-invalid admission before reaching here.
  return !points.every(finite)||distance(points[0],points[2])<=distance(points[1],points[3]);
 }
 function quadIndices(a:number,b:number,c:number,d:number,points:readonly SourceMeshVector[]){
  return diagonal(points)?[a,b,c,a,c,d]:[a,b,d,b,c,d];
 }
 /** The native main/U/V/UV traversals are shared by both retained GPU shapes
  * and immediate CPU fill. Keep repeated closure calls and lazy shift search:
  * closure mutates twist flags, while only the U-seam traversal owns ensureShift. */
 function traverseQuads(indexed:(a:number,b:number,c:number,d:number)=>void,param:(uv:readonly SourceMeshUv[],uSeam:boolean)=>void):SourceSurfaceMeshSeams {
  for(let j=0;j<stacks;j++)for(let i=0;i<slices;i++){const a=j*numU+i;indexed(a,a+1,a+numU+1,a+numU);}
  const wrapU=shouldWrapU();
  if(wrapU){ensureShift();for(let j=0;j<stacks;j++)param([[uMax,atV(j)],[uMin,mapV(j)],[uMin,mapV(j+1)],[uMax,atV(j+1)]],true);}
  const wrapV=shouldWrapV();
  if(wrapV)for(let i=0;i<slices;i++)indexed(stacks*numU+i,stacks*numU+i+1,twistedV?slices-i-1:i+1,twistedV?slices-i:i);
  if(shouldWrapU()&&shouldWrapV())param([[uMax,vMax],[uMin,mapV(stacks)],[uMin,mapV(0)],[uMax,vMin]],false);
  return{wrapU,wrapV,twistedU,twistedV,shiftU};
 }
 /** drawMeshGPU PC156–236 checks live closures for uniforms, without forcing
  * shape reconstruction or the continuous-shift search. */
 function sampleSeams():SourceSurfaceMeshSeams {
  const wrapU=shouldWrapU(),wrapV=shouldWrapV();return{wrapU,wrapV,twistedU,twistedV,shiftU};
 }
 function render():SourceSurfaceMeshGeometryFrame {
  if(numU<2||numV<2){reserve(1);return{positions:new Float32Array(),normals:new Float32Array(),triangles:new Uint32Array(),wireframeIndexedTriangles:new Uint32Array(),wireframeUSeamQuads:new Float32Array(),sourceColorIndices:new Uint32Array(),seams:{wrapU:false,wrapV:false,twistedU,twistedV,shiftU}};}
  const grid=numU*numV,maxVertices=grid+4*stacks+4,maxIndices=6*grid;
  // Includes returned copies; limits are established before any large allocation.
  reserve(2*(7*maxVertices+2*maxIndices+12*stacks));
  const positions=new Float32Array(maxVertices*3),normals=new Float32Array(maxVertices*3),colors=new Uint32Array(maxVertices),triangles=new Uint32Array(maxIndices);
  const indexedWire=new Uint32Array(maxIndices),uWire=new Float32Array(12*stacks);
  let vertices=grid,indexCount=0,indexedWireCount=0,uWireCount=0;
  const put=(index:number,p:SourceMeshVector,n:SourceMeshVector,color:number)=>{positions.set(p,index*3);normals.set(n,index*3);colors[index]=color;};
  const get=(i:number):SourceMeshVector=>[positions[i*3],positions[i*3+1],positions[i*3+2]];
  gridVertices((index,u,v,color)=>{const p=position(u,v);put(index,p,normal(u,v,p,false),color);});
  function quad(a:number,b:number,c:number,d:number,indexed=true){
   reserve(1);const pa=get(a),pb=get(b),pc=get(c),pd=get(d);if(![pa,pb,pc,pd].every(finite))return;
   const indices=quadIndices(a,b,c,d,[pa,pb,pc,pd]);
   triangles.set(indices,indexCount);indexCount+=6;
   if(indexed){indexedWire.set(indices,indexedWireCount);indexedWireCount+=6;}
  }
  function paramQuad(uv:readonly SourceMeshUv[],uSeam=false){
   reserve(1);const points=uv.map(([u,v])=>position(u,v));if(!points.every(finite))return;
   if(uSeam)for(const p of points){uWire.set(p,uWireCount);uWireCount+=3;}
   const first=vertices;
   for(let k=0;k<4;k++){
    const [u,v]=uv[k];put(vertices++,points[k],normal(u,v,points[k],true),nearestColor(u,v));
   }
   quad(first,first+1,first+2,first+3,false);
  }
  const seams=traverseQuads(quad,paramQuad);
  return{positions:positions.slice(0,vertices*3),normals:normals.slice(0,vertices*3),triangles:triangles.slice(0,indexCount),wireframeIndexedTriangles:indexedWire.slice(0,indexedWireCount),wireframeUSeamQuads:uWire.slice(0,uWireCount),sourceColorIndices:colors.slice(0,vertices),seams};
 }
 function renderGpu():SourceSurfaceGpuMeshGeometryFrame {
  if(numU<2||numV<2){reserve(1);return{seeds:new Float32Array(),triangles:new Uint32Array(),sourceColorIndices:new Uint32Array(),seams:{wrapU:false,wrapV:false,twistedU,twistedV,shiftU}};}
  const grid=numU*numV,maxVertices=grid+4*stacks+4,maxIndices=6*grid;
  // Includes independent result copies and CPU diagonal-sample storage. CPU
  // evaluations choose topology only; no positioned geometry is published.
  reserve(2*(5*maxVertices+maxIndices)+3*grid);
  const seeds=new Float32Array(maxVertices*4),colors=new Uint32Array(maxVertices),triangles=new Uint32Array(maxIndices),samples=new Float32Array(grid*3);
  let vertices=grid,indexCount=0;
  const put=(index:number,u:number,v:number,color:number)=>{seeds[index*4]=u;seeds[index*4+1]=v;colors[index]=color;};
  gridVertices((index,u,v,color)=>{put(index,u,v,color);samples.set(position(u,v),index*3);});
  const get=(index:number):SourceMeshVector=>[samples[index*3],samples[index*3+1],samples[index*3+2]];
  function emit(a:number,b:number,c:number,d:number,points:readonly SourceMeshVector[]){
   reserve(1);triangles.set(quadIndices(a,b,c,d,points),indexCount);indexCount+=6;
  }
  function indexed(a:number,b:number,c:number,d:number){emit(a,b,c,d,[get(a),get(b),get(c),get(d)]);}
  function param(uv:readonly SourceMeshUv[]){
   const points=uv.map(([u,v])=>position(u,v)),first=vertices;
   for(const [u,v] of uv)put(vertices++,u,v,nearestColor(u,v));
   emit(first,first+1,first+2,first+3,points);
  }
  const seams=traverseQuads(indexed,param);
  return{seeds:seeds.slice(0,vertices*4),triangles:triangles.slice(0,indexCount),sourceColorIndices:colors.slice(0,vertices),seams};
 }
 // An interrupted first shift search has changed native mutable state. Do not
 // permit a caller to reuse that partial state after a resource/cancel failure.
 return{render:()=>guarded(render),renderGpu:()=>guarded(renderGpu),sampleSeams:()=>guarded(sampleSeams),cyclicPaletteU:()=>guarded(cyclicPaletteU),invalidateWrapShift:()=>guarded(()=>{shiftDirty=true;}),sampleParameterNormal:(u:number,v:number)=>guarded(()=>normal(F(u),F(v),position(F(u),F(v)),true))};
}
export type SourceSurfaceMeshGeometry=ReturnType<typeof createSourceSurfaceMeshGeometry>;
