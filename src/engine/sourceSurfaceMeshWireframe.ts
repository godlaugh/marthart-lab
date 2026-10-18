import type {SourceMeshVector,SourceSurfaceMeshGeometryConfiguration,SourceSurfaceMeshGeometryFrame} from './sourceSurfaceMeshGeometry';

export interface SourceSurfaceMeshWireframeConfiguration extends Pick<SourceSurfaceMeshGeometryConfiguration,'numU'|'numV'|'uMin'|'uMax'|'vMin'|'vMax'|'sample'|'reserve'> {
 /** Geometry owner supplies the native parametric normal, including its retained
  * discarded-cross behavior. Never recalculate closure or derivatives here. */
 parameterNormal:(u:number,v:number)=>SourceMeshVector;
 scaleX:number;scaleY:number;scaleZ:number;
 wireframeUSegments:number;wireframeVSegments:number;
 curveSamples?:number;fillEnabled:boolean;lineWeight:number;packedColor:number;depthBias?:number;
}
export interface SourceSurfaceMeshWireframeFrame {
 positions:Float32Array;packedColor:number;lineWidth:number;mode:'coupled'|'decoupled';
}
const F=Math.fround,MAX_FLOATS=16_777_216;
const finite=(p:SourceMeshVector)=>p.every(Number.isFinite);
const distance=(a:SourceMeshVector,b:SourceMeshVector)=>{
 const x=F(a[0]-b[0]),y=F(a[1]-b[1]),z=F(a[2]-b[2]);
 return F(Math.sqrt(F(F(F(x*x)+F(y*y))+F(z*z))));
};
const int32=(v:number)=>Number.isInteger(v)&&v>=-2147483648&&v<=2147483647;
const hash=(value:bigint)=>{
 let key=value;key^=key>>33n;key=BigInt.asUintN(64,key*-49064778989728563n);
 key^=key>>33n;key=BigInt.asUintN(64,key*-4265267296055464877n);key^=key>>33n;
 return Number(BigInt.asUintN(32,key));
};
/** MeshSurface.drawMeshWireframeThreejs CPU route. Coupled edges retain the
 * native long hash-table slot order, then append U seam lines without dedup.
 * Decoupled curves use ordered inclusive parameter samples and break on invalid
 * positions. Shader wireframe attenuation/fresnel belongs to the GPU route. */
export function createSourceSurfaceMeshWireframe(config:SourceSurfaceMeshWireframeConfiguration){
 const {numU,numV,reserve}=config;
 if(![numU,numV].every(n=>Number.isInteger(n)&&n>=1&&n<=512))throw new Error('原版线框网格每轴必须为 1–512');
 const uSeg=config.wireframeUSegments,vSeg=config.wireframeVSegments,requestedSamples=config.curveSamples??128;
 if(![uSeg,vSeg,requestedSamples].every(int32))throw new Error('原版线框段数必须为 int32');
 const samples=Math.max(16,requestedSamples),mode=uSeg>0||vSeg>0?'decoupled':'coupled';
 for(const value of [config.uMin,config.uMax,config.vMin,config.vMax,config.scaleX,config.scaleY,config.scaleZ,config.lineWeight,config.depthBias??.001])if(!Number.isFinite(F(value)))throw new Error('原版线框配置必须为有限 Float32');
 if(!Number.isInteger(config.packedColor)||config.packedColor<0||config.packedColor>0xffffffff)throw new Error('原版线框颜色必须为 uint32');
 const uMin=F(config.uMin),uRange=F(F(config.uMax)-uMin),vMin=F(config.vMin),vRange=F(F(config.vMax)-vMin);
 const weight=Math.max(F(.1),F(config.lineWeight)),bias=Math.max(0,F(config.depthBias??.001));
 const sumScale=F(F(F(config.scaleX)+F(config.scaleY))+F(config.scaleZ));
 const displacement=Math.max(F(.01),F(F(F(bias*sumScale)/F(3))*F(2)));
 const sample=(u:number,v:number):SourceMeshVector=>{reserve(1);const p=config.sample(u,v,true);return[F(p[0]),F(p[1]),F(p[2])];};
 function allocate(floats:number){
  if(!Number.isSafeInteger(floats)||floats<0||floats>MAX_FLOATS)throw new Error('原版线框超过本地 64 MiB 输出缓冲容量');
  reserve(floats*2);return new Float32Array(floats);
 }
 function resolveLineWidth(lineScale=1){const scale=F(lineScale);return Math.max(F(.1),F(weight*(Number.isFinite(scale)&&scale>0?F(.95):1)));}
 function render(frame:SourceSurfaceMeshGeometryFrame|undefined,lineScale=1):SourceSurfaceMeshWireframeFrame {
  const lineWidth=resolveLineWidth(lineScale);
  let positions:Float32Array,used=0;
  const emit=(a:SourceMeshVector,b:SourceMeshVector)=>{reserve(1);positions.set(a,used);positions.set(b,used+3);used+=6;};
  if(mode==='decoupled'){
   const curves=(uSeg>0?uSeg+1:0)+(vSeg>0?vSeg+1:0);
   positions=allocate(curves*samples*6);
   const curve=(constantU:boolean,fixed:number)=>{
    let previous:SourceMeshVector=[NaN,NaN,NaN];
    for(let k=0;k<=samples;k++){
     const t=F(k/samples),u=constantU?fixed:F(uMin+F(uRange*t)),v=constantU?F(vMin+F(vRange*t)):fixed;
     let p=sample(u,v);
     if(!finite(p)){previous=[NaN,previous[1],previous[2]];continue;}
     if(config.fillEnabled&&bias>0){
      const n=config.parameterNormal(u,v);
      p=[F(p[0]+F(n[0]*displacement)),F(p[1]+F(n[1]*displacement)),F(p[2]+F(n[2]*displacement))];
     }
     // Native tests only previous.x for NaN, and does not validate again after
     // normal displacement. Preserve post-bias nonfinite evidence for its owner.
     if(!Number.isNaN(previous[0]))emit(previous,p);
     previous=p;
    }
   };
   if(uSeg>0)for(let i=0;i<=uSeg;i++)curve(true,F(uMin+F(uRange*F(i/uSeg))));
   if(vSeg>0)for(let j=0;j<=vSeg;j++)curve(false,F(vMin+F(vRange*F(j/vSeg))));
  }else{
   if(!frame)throw new Error('耦合线框需要同帧原版网格事实');
   const indices=frame.wireframeIndexedTriangles,quads=frame.wireframeUSeamQuads;
   if(indices.length%3||quads.length%12)throw new Error('原版线框共享几何事实不完整');
   if(numU<2||numV<2)return{positions:new Float32Array(),packedColor:config.packedColor,lineWidth,mode};
   positions=allocate(indices.length*6+quads.length/12*30);
   let capacity=1;while(capacity<Math.max(64,(numU-1)*(numV-1)*6)*2)capacity*=2;
   reserve(capacity*3);
   let keys=new BigUint64Array(capacity),occupied=new Uint8Array(capacity),size=0;
   const put=(key:bigint)=>{
    if(size+1>Math.trunc(F(capacity*F(.65)))){
     const oldKeys=keys,oldUsed=occupied;capacity*=2;reserve(capacity*3);keys=new BigUint64Array(capacity);occupied=new Uint8Array(capacity);size=0;
     for(let i=0;i<oldKeys.length;i++)if(oldUsed[i])put(oldKeys[i]);
    }
    let slot=hash(key)&(capacity-1);
    while(occupied[slot]){if(keys[slot]===key)return;slot=(slot+1)&(capacity-1);}
    occupied[slot]=1;keys[slot]=key;size++;
   };
   const point=(i:number):SourceMeshVector=>[frame.positions[i*3],frame.positions[i*3+1],frame.positions[i*3+2]];
   const edge=(a:number,b:number)=>{
    if(a===b||!finite(point(a))||!finite(point(b)))return;
    put((BigInt(Math.min(a,b))<<32n)|BigInt(Math.max(a,b)));
   };
   for(let i=0;i<indices.length;i+=3){reserve(1);const a=indices[i],b=indices[i+1],c=indices[i+2];edge(a,b);edge(b,c);edge(c,a);}
   for(let slot=0;slot<capacity;slot++)if(occupied[slot]){const key=keys[slot];emit(point(Number(key>>32n)),point(Number(key&0xffffffffn)));}
   for(let i=0;i<quads.length;i+=12){
    const p=(k:number):SourceMeshVector=>[quads[i+k*3],quads[i+k*3+1],quads[i+k*3+2]];
    const a=p(0),b=p(1),c=p(2),d=p(3);if(![a,b,c,d].every(finite))continue;
    emit(a,b);emit(b,c);emit(c,d);emit(d,a);if(distance(a,c)<=distance(b,d))emit(a,c);else emit(b,d);
   }
  }
  return{positions:positions.slice(0,used),packedColor:config.packedColor,lineWidth,mode};
 }
 return{render,resolveLineWidth};
}
