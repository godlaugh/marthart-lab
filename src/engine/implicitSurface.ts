import {compileReal,compileRealWithFacts,numberSetting,type Scope} from './expression';
import {geometryColorModel,paletteDomainColor} from './geometryColor';
import {vertexColors} from './palette';
import {gpuFormulaSampler} from './gpuSampler';
import {compileImplicitContinuity} from './implicitContinuity';
import {parseMeshAppearance} from './meshAppearance';
import {buildMeshEdges,checkedMeshBytes,IMPLICIT_WORK_BYTES,IMPLICIT_OUTPUT_BYTES} from './meshEdges';
import type {SceneDocument,GenerateContext,SceneOutput,GeometryOutput,Settings} from '../types';

type Vec3=[number,number,number];
type Transform={apply(point:Vec3):Vec3};
type Facts=NonNullable<GeometryOutput['implicit']>;
export const IMPLICIT_MAX_SEGMENTS=200;
const WORK_BYTES=IMPLICIT_WORK_BYTES,OUTPUT_BYTES=IMPLICIT_OUTPUT_BYTES;
// At most 49 probes per candidate edge (linear candidate plus 48 safeguarded
// steps), plus two CPU endpoint probes when sampling with GPU and at most six
// probes per visited corner for representable-zero certification. This work
// admission policy is separate from requested grid and validation samples.
const ROOT_EVALUATION_LIMIT=50_000_000;
const CHUNK=16384;
const CORNERS:Vec3[]=[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];
const TETRA=[[0,5,1,6],[0,1,2,6],[0,2,3,6],[0,3,7,6],[0,7,4,6],[0,4,5,6]];
const float32View=new DataView(new ArrayBuffer(4));
function adjacentFloat32(value:number,up:boolean){
 float32View.setFloat32(0,value);const bits=float32View.getUint32(0);
 float32View.setUint32(0,value===0?(up?1:0x80000001):bits+((value>0)===up?1:-1));
 return float32View.getFloat32(0);
}
function integer(s:Settings,key:string,fallback:number,min:number,max:number){const v=numberSetting(s,key,fallback,min,max);if(!Number.isInteger(v))throw Error(`${key} 必须是整数`);return v;}
function option(s:Settings,key:string,fallback:string,allowed:string[]){const v=String(s[key]??fallback);if(!allowed.includes(v))throw Error(`${key} 不支持 ${v}`);return v;}
export interface ImplicitJob {
 readonly scene:SceneDocument;readonly transform:Transform;readonly dimensions:Vec3;readonly min:Vec3;readonly max:Vec3;readonly spacing:Vec3;
 readonly planeSize:number;readonly latticeSamples:number;readonly cells:number;readonly source:string;readonly scope:Scope;
 readonly iso:number;readonly sign:number;readonly mode:'mesh'|'wireframe'|'points';readonly overlay:boolean;readonly requestedBackend:'cpu'|'webgl2'|'auto';readonly domainColors:boolean;
 readonly evaluate:(scope:Scope)=>number;readonly continuity:ReturnType<typeof compileImplicitContinuity>;
}
/** Single owning interpretation. Segment counts are cells, not lattice points. */
export function prepareImplicitJob(scene:SceneDocument,context:GenerateContext,transform:Transform):ImplicitJob {
 const s=scene.settings;if(!Number.isFinite(context.time))throw Error('时间必须是有限数值');
 for(const [name,value]of Object.entries(scene.parameters))if(!Number.isFinite(value))throw Error(`参数 ${name} 必须为有限数值`);
 const scope={...scene.parameters,t:context.time,time:context.time},n=integer(s,'resolution',36,4,IMPLICIT_MAX_SEGMENTS);
 const dimensions=['X','Y','Z'].map(axis=>{const nAxis=integer(s,`resolution${axis}`,0,0,IMPLICIT_MAX_SEGMENTS);if(nAxis>0&&nAxis<4)throw Error(`resolution${axis} 必须为 0 或至少 4`);return nAxis||n;}) as Vec3;
 const setting=(key:string,fallback:number)=>{const raw=s[key]??fallback,value=typeof raw==='string'?compileReal(raw)(scope):Number(raw);if(!Number.isFinite(value))throw Error(`${key} 必须计算为有限数值`);return value;};
 const min=['X','Y','Z'].map(a=>setting(`min${a}`,-1.5)) as Vec3,max=['X','Y','Z'].map(a=>setting(`max${a}`,1.5)) as Vec3;
 if(max.some((v,i)=>v<=min[i]))throw Error('各坐标域上限必须大于下限');
 const spacing=max.map((v,i)=>(v-min[i])/dimensions[i]) as Vec3;if(!spacing.every(v=>Number.isFinite(v)&&v>0))throw Error('坐标域跨度不可表示');
 for(let axis=0;axis<3;axis++){let previous=min[axis];for(let i=1;i<=dimensions[axis];i++){const value=min[axis]+i*spacing[axis];if(!Number.isFinite(value)||value<=previous)throw Error('请求网格的相邻坐标在双精度中不可区分；请增大坐标跨度或降低分辨率');previous=value;}}
 const planeSize=(dimensions[0]+1)*(dimensions[1]+1),latticeSamples=planeSize*(dimensions[2]+1),cells=dimensions[0]*dimensions[1]*dimensions[2];
 const source=scene.equations.f??'x^2+y^2+z^2-1',compiled=compileRealWithFacts(source),mode=option(s,'renderMode','mesh',['mesh','wireframe','points']) as ImplicitJob['mode'];
 return {scene,transform,dimensions,min,max,spacing,planeSize,latticeSamples,cells,source,scope,iso:numberSetting(s,'isoLevel',0),sign:option(s,'inside','below',['below','above'])==='below'?1:-1,mode,overlay:mode==='mesh'&&parseMeshAppearance(s).wireframe,requestedBackend:option(s,'computeBackend','cpu',['cpu','webgl2','auto']) as ImplicitJob['requestedBackend'],domainColors:geometryColorModel(scene).implicit==='z-domain',evaluate:compiled.evaluate,continuity:compileImplicitContinuity(compiled.facts)};
}
/** Checked upper bound for final deliverable arrays and its compaction map.
 * It excludes extraction chunks/frontier (accounted dynamically) and renderer/
 * worker copies, JavaScript object overhead, and driver-owned storage. */
export function implicitOutputAllocation(vertices:number,triangleIndices:number,mode:ImplicitJob['mode'],overlay=false) {
 if(!Number.isSafeInteger(vertices)||vertices<0||!Number.isSafeInteger(triangleIndices)||triangleIndices<0||triangleIndices%3||!['mesh','wireframe','points'].includes(mode))throw Error('等值面输出计数无效');
 // Conservative E<=I admission while extraction is incomplete. Exact edge
 // storage and dedup scratch are charged separately before their allocations.
 const outputBytes=vertices*24+triangleIndices*(mode==='wireframe'?8:mode==='points'?0:overlay?12:4);
 if(!Number.isSafeInteger(outputBytes)||outputBytes>OUTPUT_BYTES)throw Error('等值面输出超过 128 MiB 预算；请降低分辨率或缩小采样域');
 return{outputBytes,futureBytes:outputBytes+vertices*4};
}
class Budget {
 retained=0;future=0;peak=0;
 check(extra=0){const required=this.retained+this.future+extra;if(!Number.isSafeInteger(required)||required>WORK_BYTES)throw Error('等值面工作缓冲超过 256 MiB 预算；请降低分辨率或缩小采样域');this.peak=Math.max(this.peak,required);}
 add(bytes:number){this.check(bytes);this.retained+=bytes;}
 release(bytes:number){this.retained-=bytes;}
}
/** Fixed typed chunks avoid unbounded boxed output arrays and double-capacity growth. */
class Chunks {
 chunks:(Float32Array|Uint32Array)[]=[];length=0;
 constructor(private budget:Budget,private uint=false){}
 push(value:number){if(this.length%CHUNK===0){this.budget.add(CHUNK*4);this.chunks.push(this.uint?new Uint32Array(CHUNK):new Float32Array(CHUNK));}this.chunks[this.length>>14][this.length%CHUNK]=value;this.length++;}
 get(index:number){return this.chunks[index>>14][index%CHUNK];}
 clear(){this.budget.release(this.chunks.length*CHUNK*4);this.chunks=[];this.length=0;}
}
/** Exact safe-integer numeric keys, typed storage. Only the current slab and its
 * incoming frontier survive; old slabs never remain as a full-mesh edge map. */
class EdgeCache {
 keys:Float64Array;values:Int32Array;size=0;
 constructor(private budget:Budget,capacity=64){this.budget.add(capacity*12);this.keys=new Float64Array(capacity);this.values=new Int32Array(capacity);}
 slot(key:number){let h=(key>>>0)^Math.imul(Math.floor(key/4294967296),0x9e3779b1);h=Math.imul(h^(h>>>16),0x85ebca6b);let i=(h^(h>>>13))&(this.keys.length-1);while(this.keys[i]&&this.keys[i]!==key)i=(i+1)&(this.keys.length-1);return i;}
 get(key:number){const i=this.slot(key);return this.keys[i]?this.values[i]:undefined;}
 set(key:number,value:number){let i=this.slot(key);if(this.keys[i]){this.values[i]=value;return;}if((this.size+1)*10>this.keys.length*7){const oldK=this.keys,oldV=this.values;this.budget.add(oldK.length*24);this.keys=new Float64Array(oldK.length*2);this.values=new Int32Array(oldK.length*2);this.size=0;for(let n=0;n<oldK.length;n++)if(oldK[n])this.set(oldK[n],oldV[n]);this.budget.release(oldK.length*12);i=this.slot(key);}this.keys[i]=key;this.values[i]=value;this.size++;}
 frontier(total:number,firstTopId:number){const next=new EdgeCache(this.budget);for(let i=0;i<this.keys.length;i++){const key=this.keys[i];if(!key)continue;const code=key-1;if(code<total){if(code>=firstTopId)next.set(key,this.values[i]);}else{const a=Math.floor((code-total)/total),b=code-total-a*total;if(a>=firstTopId&&b>=firstTopId)next.set(key,this.values[i]);}}return next;}
 dispose(){this.budget.release(this.keys.byteLength+this.values.byteLength);this.keys=new Float64Array(0);this.values=new Int32Array(0);}
}
class GpuRetry extends Error {
 constructor(message:string,readonly work:Pick<Facts,'latticeSamples'|'latticeValidationSamples'|'rootEvaluations'|'examinedCells'>,readonly peak:number,readonly invalid:number){super(message);this.work={...work};}
}
const cancelled=(context:GenerateContext)=>{if(context.isCancelled?.())throw Error('等值面计算已取消');};
const emptyFacts=(job:ImplicitJob):Facts=>({requestedCells:job.cells,examinedCells:0,requestedLatticeSamples:job.latticeSamples,latticeSamples:0,latticeValidationSamples:0,rootEvaluations:0,refinedEdges:0,representedZeroCorners:0,rejectedEdges:0,unresolvedCells:0,degenerateTriangles:0,estimatedPeakWorkingBytes:0});
function extract(job:ImplicitJob,context:GenerateContext,useGpu:boolean,initialWarnings:string[],previous?:GpuRetry):SceneOutput {
 const started=performance.now(),facts=emptyFacts(job),budget=new Budget(),warnings=[...initialWarnings],scope={...job.scope};
 const [nx,ny,nz]=job.dimensions,sx=nx+1,N=job.latticeSamples,planeSize=job.planeSize;
 if(previous)for(const key of ['latticeSamples','latticeValidationSamples','rootEvaluations','examinedCells'] as const)facts[key]=previous.work[key];
 let invalid=previous?.invalid??0,zeroSamples=0,cache=new EdgeCache(budget);
 const retry=(message:string)=>new GpuRetry(message,facts,budget.peak,invalid);const positions=new Chunks(budget),color=new Chunks(budget),triangles=new Chunks(budget,true);
 let lower=new Float64Array(0),upper=new Float64Array(0),lowerCorners=new Uint8Array(0),upperCorners=new Uint8Array(0);
 budget.add(planeSize*18);lower=new Float64Array(planeSize);upper=new Float64Array(planeSize);lowerCorners=new Uint8Array(planeSize);upperCorners=new Uint8Array(planeSize);
 function future(){budget.future=implicitOutputAllocation(positions.length/3,triangles.length,job.mode,job.overlay).futureBytes;budget.check();}
 const evaluate=(p:Vec3)=>{scope.x=p[0];scope.y=p[1];scope.z=p[2];return(job.evaluate(scope)-job.iso)*job.sign;};
 function rootProbe(p:Vec3){if(++facts.rootEvaluations>ROOT_EVALUATION_LIMIT)throw Error('等值面根细化超过 50,000,000 次求值预算；请降低分辨率或简化方程');if((facts.rootEvaluations&1023)===0)cancelled(context);return evaluate(p);}
 function samplePlane(z:number,destination:Float64Array){
  cancelled(context);let gpu:Float32Array|undefined;
  if(useGpu){const bytes=planeSize*12;budget.add(bytes*4);const coordinates=new Float32Array(planeSize*3);let at=0;for(let y=0;y<=ny;y++){cancelled(context);for(let x=0;x<=nx;x++){coordinates[at++]=job.min[0]+x*job.spacing[0];coordinates[at++]=job.min[1]+y*job.spacing[1];coordinates[at++]=job.min[2]+z*job.spacing[2];}}
   const sampled=gpuFormulaSampler.sample([job.source],coordinates,['x','y','z'],job.scope);if(sampled.backend!=='webgl2'||!sampled.values)throw retry(sampled.warnings.join('；'));gpu=sampled.values;facts.latticeSamples+=planeSize;budget.release(bytes*2);
  }
  const p:Vec3=[0,0,job.min[2]+z*job.spacing[2]];for(let y=0;y<=ny;y++){cancelled(context);p[1]=job.min[1]+y*job.spacing[1];for(let x=0;x<=nx;x++){p[0]=job.min[0]+x*job.spacing[0];const i=x+sx*y,v=gpu?(gpu[i*3]-job.iso)*job.sign:evaluate(p);if(gpu){const cpu=evaluate(p);facts.latticeValidationSamples++;if(Number.isFinite(cpu)!==Number.isFinite(v)||Number.isFinite(cpu)&&((cpu<0)!==(v<0)||(cpu===0)!==(v===0)))throw retry('GPU 格点符号、零值或非有限分类与 CPU 双精度不同；整次等值面使用 CPU 重放');}else facts.latticeSamples++;destination[i]=v;if(!Number.isFinite(v))invalid++;else if(v===0)zeroSamples++;}}
  if(gpu)budget.release(planeSize*24);
 }
 /** A corner is shared before any incident tetrahedron chooses a root. Only
  * a certified zero with the SAME delivered Float32 coordinates may use that
  * corner identity. This removes CPU zero plateaus at tangencies without an
  * epsilon weld, an unproved zero classification, or discarded mesh cracks.
  * 0=unexamined, 1=no certificate, 2=represented zero; two slabs own the cache. */
 function cornerValue(p:Vec3,value:number,states:Uint8Array,index:number):number {
  if(states[index])return states[index]===2?0:value;
  states[index]=1;if(!Number.isFinite(value))return value;
  const delivered=job.transform.apply(p),rounded=delivered.map(Math.fround);
  if(!rounded.every(Number.isFinite))return value;
  for(let axis=0;axis<3;axis++){
   const moved=[...p] as Vec3;moved[axis]+=job.spacing[axis];
   const shifted=job.transform.apply(moved),direction=shifted.map((v,i)=>(v-delivered[i])/job.spacing[axis]);
   let step=job.spacing[axis]/4;
   // A conservative candidate within the represented cell; transformed
   // endpoints are checked again below, including rotations and translations.
   for(let k=0;k<3;k++)if(direction[k]!==0){
    const margin=Math.min(Math.abs(adjacentFloat32(rounded[k],true)-rounded[k]),Math.abs(adjacentFloat32(rounded[k],false)-rounded[k]))/4;
    step=Math.min(step,margin/Math.abs(direction[k]));
   }
   if(!Number.isFinite(step)||step<=0)continue;
   const a=[...p] as Vec3,b=[...p] as Vec3;a[axis]-=step;b[axis]+=step;
   if(a[axis]===p[axis]||b[axis]===p[axis]||a[axis]<job.min[axis]||b[axis]>job.max[axis])continue;
   if(![a,b].every(point=>job.transform.apply(point).every((v,i)=>Math.fround(v)===rounded[i])))continue;
   const va=rootProbe(a),vb=rootProbe(b);
   if(va!==0&&vb!==0&&Math.sign(va)!==Math.sign(vb)&&job.continuity.crossing(a,b,job.scope,job.iso,job.sign,va,vb)){
    states[index]=2;facts.representedZeroCorners++;return 0;
   }
  }
  return value;
 }
 function vertex(raw:Vec3){const p=job.transform.apply(raw);if(!p.every(v=>Number.isFinite(Math.fround(v))))return-1;const id=positions.length/3;for(const v of p)positions.push(v);if(job.domainColors)for(const v of paletteDomainColor(job.scene.palette,Math.max(0,Math.min(1,(raw[2]-job.min[2])/(job.max[2]-job.min[2])))))color.push(v);future();return id;}
 function crossing(a:number,b:number,pa:Vec3,pb:Vec3,va:number,vb:number,representedA:boolean,representedB:boolean):number {
  const low=Math.min(a,b),high=Math.max(a,b),edgeKey=1+N+low*N+high,old=cache.get(edgeKey);if(old!==undefined)return old;
  // Root decisions use CPU64 input coordinates, before the output's Float32
  // representation. A GPU sign disagreement requires a coherent CPU replay.
  if(useGpu){const ca=rootProbe(pa),cb=rootProbe(pb);if(!Number.isFinite(ca)||!Number.isFinite(cb)||!representedA&&((ca<0)!==(va<0)||(ca===0)!==(va===0))||!representedB&&((cb<0)!==(vb<0)||(cb===0)!==(vb===0)))throw retry('GPU 格点符号或零值与双精度根验证不同；整次等值面使用 CPU 重放');va=representedA?0:ca;vb=representedB?0:cb;}
  let raw:Vec3|undefined;
  if(va===0)raw=pa;else if(vb===0)raw=pb;else{
   const scale=Math.max(Math.abs(va),Math.abs(vb)),av=va/scale,bv=vb/scale;let lo=0,hi=1,fl=va,fh=vb,t=av/(av-bv),loPoint=pa,hiPoint=pb,midResidual=scale;
   for(let iteration=0;iteration<=48;iteration++){
    const point=pa.map((v,i)=>v+(pb[i]-v)*t) as Vec3,f=rootProbe(point);
    if(!Number.isFinite(f))break;
    if(f===0){raw=point;break;}
    if(iteration===0)facts.refinedEdges++;
    if((f<0)===(fl<0)){lo=t;fl=f;loPoint=point;}else{hi=t;fh=f;hiPoint=point;}
    if(iteration===24)midResidual=Math.max(Math.abs(fl),Math.abs(fh));
    const width=hi-lo;
    let sameDeliveredPoint=false;if(iteration>12){const left=job.transform.apply(loPoint),right=job.transform.apply(hiPoint);sameDeliveredPoint=left.every((v,i)=>Math.fround(v)===Math.fround(right[i]));}
    // A tiny initial endpoint is not by itself evidence of a root: an
    // asymmetric jump can have arbitrarily small nonzero residual. Require
    // position convergence plus residual convergence from both sides. A
    // separate fail-closed interval certificate can instead establish local
    // continuity: the opposite-sign bracket then contains a root by IVT.
    // Both the certificate and delivered point belong to the final bracket.
    // A historical small residual can be a nonzero local minimum elsewhere.
    // Unknown continuity retains a bounded numerical heuristic, not a proof:
    // the second half of the 49-probe schedule must reduce the maximum of
    // BOTH residuals by at least eightfold. If position converges before the
    // midpoint, compare against the initial pair instead. This preserves a
    // root already at one endpoint's rounding floor, while rejecting observed
    // nonzero plateaus. Arbitrary discontinuities remain undecidable.
    const contracting=Math.max(Math.abs(fl),Math.abs(fh))<=midResidual/8;
    if((width<=128*Number.EPSILON&&contracting&&Math.max(Math.abs(fl),Math.abs(fh))/scale<=256*Number.EPSILON)||((sameDeliveredPoint||width<=128*Number.EPSILON)&&job.continuity.crossing(loPoint,hiPoint,job.scope,job.iso,job.sign,fl,fh))){raw=Math.abs(fl)<=Math.abs(fh)?loPoint:hiPoint;break;}
    if(width<=Number.EPSILON*8)break;
    // Bisection after the first linear candidate gives a guaranteed position
    // contraction within the finite 49-probe budget. A tiny residual alone
    // must not stop at a narrow, but still nonzero, jump.
    t=lo+width/2;
   }
  }
  if(!raw){facts.rejectedEdges++;cache.set(edgeKey,-1);return-1;}
  const rendered=job.transform.apply(raw),same=(p:Vec3)=>{const q=job.transform.apply(p);return rendered.every((v,i)=>Math.fround(v)===Math.fround(q[i]));};
  // Endpoint construction and expression evaluation can put the same corner
  // a few double ulps away on different incident edges. At zero, Float32
  // equality alone cannot identify this (0 and 1e-16 remain distinct).
  // Normalize only to this edge's endpoint within its input-scale rounding
  // neighborhood; never globally weld nearby unrelated intersections.
  const near=(p:Vec3)=>raw!.every((v,i)=>Math.abs(v-p[i])<=128*Number.EPSILON*Math.max(Math.abs(pb[i]-pa[i]),job.spacing[i]));
  let key=edgeKey;if(same(pa)||near(pa)){key=1+a;raw=pa;}else if(same(pb)||near(pb)){key=1+b;raw=pb;}
  let id=cache.get(key);if(id===undefined){id=vertex(raw);cache.set(key,id);}cache.set(edgeKey,id);return id;
 }
 const point=(id:number):Vec3=>[positions.get(id*3),positions.get(id*3+1),positions.get(id*3+2)];
 function emit(a:number,b:number,c:number,direction:Vec3){if(a<0||b<0||c<0||a===b||b===c||a===c){facts.degenerateTriangles++;return;}const p=point(a),q=point(b),r=point(c),u=q.map((v,i)=>v-p[i]),v=r.map((x,i)=>x-p[i]),normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];if(!normal.every(Number.isFinite)||normal.every(x=>x===0)){facts.degenerateTriangles++;return;}const flip=normal.reduce((sum,v,i)=>sum+v*direction[i],0)<0;triangles.push(a);triangles.push(flip?c:b);triangles.push(flip?b:c);future();}
 samplePlane(0,lower);
 for(let z=0;z<nz;z++){
  samplePlane(z+1,upper);
  for(let y=0;y<ny;y++){cancelled(context);for(let x=0;x<nx;x++){
   facts.examinedCells++;let unresolved=false;
   const values=CORNERS.map(([dx,dy,dz])=>{const i=x+dx+sx*(y+dy);return(dz?upperCorners:lowerCorners)[i]===2?0:(dz?upper:lower)[i];});
   // Same-sign finite cells cannot emit a tetrahedral crossing. Avoid building
   // six transient tetrahedra in the large empty interior/exterior volume.
   if(values.every(Number.isFinite)){const negatives=values.reduce((n,v)=>n+(v<0?1:0),0);if(negatives===0||negatives===8)continue;}
   const ids=CORNERS.map(([dx,dy,dz])=>x+dx+sx*(y+dy)+(z+dz)*planeSize),points=CORNERS.map(([dx,dy,dz])=>[job.min[0]+(x+dx)*job.spacing[0],job.min[1]+(y+dy)*job.spacing[1],job.min[2]+(z+dz)*job.spacing[2]] as Vec3);
   for(let i=0;i<8;i++){const[dx,dy,dz]=CORNERS[i];values[i]=cornerValue(points[i],values[i],dz?upperCorners:lowerCorners,x+dx+sx*(y+dy));}
   for(const tet of TETRA){if(tet.some(i=>!Number.isFinite(values[i]))){unresolved=true;continue;}const inside=tet.filter(i=>values[i]<0),outside=tet.filter(i=>values[i]>=0);if(!inside.length||!outside.length)continue;
    const midpoint=(set:number[])=>[0,1,2].map(axis=>set.reduce((s,i)=>s+points[i][axis],0)/set.length) as Vec3,inner=job.transform.apply(midpoint(inside)),outer=job.transform.apply(midpoint(outside)),direction=outer.map((v,i)=>v-inner[i]) as Vec3;
    const represented=(i:number)=>{const[dx,dy,dz]=CORNERS[i];return(dz?upperCorners:lowerCorners)[x+dx+sx*(y+dy)]===2;};
    const edge=(a:number,b:number)=>{const id=crossing(ids[a],ids[b],points[a],points[b],values[a],values[b],represented(a),represented(b));if(id<0)unresolved=true;return id;};
    if(inside.length===1){const a=inside[0];emit(edge(a,outside[0]),edge(a,outside[1]),edge(a,outside[2]),direction);}
    else if(inside.length===3){const a=outside[0];emit(edge(a,inside[0]),edge(a,inside[1]),edge(a,inside[2]),direction);}
    else{const[a,b]=inside,[c,d]=outside,ac=edge(a,c),ad=edge(a,d),bc=edge(b,c),bd=edge(b,d);emit(ac,ad,bd,direction);emit(ac,bd,bc,direction);}
   }
   if(unresolved)facts.unresolvedCells++;
  }}
  const next=cache.frontier(N,(z+1)*planeSize);cache.dispose();cache=next;[lower,upper]=[upper,lower];[lowerCorners,upperCorners]=[upperCorners,lowerCorners];upperCorners.fill(0);
 }
 cache.dispose();budget.release(planeSize*18);lower=new Float64Array(0);upper=new Float64Array(0);lowerCorners=new Uint8Array(0);upperCorners=new Uint8Array(0);budget.future=0;
 // Compact only vertices referenced by accepted triangles, preserving manifold
 // identity after endpoint Float32 canonicalization and rejected root edges.
 const vertices=positions.length/3;budget.add(vertices*4);let remap=new Int32Array(vertices).fill(-1);let used=0;
 for(let i=0;i<triangles.length;i++){if((i&4095)===0)cancelled(context);const id=triangles.get(i);if(remap[id]<0)remap[id]=used++;}
 budget.add(used*24);const outPositions=new Float32Array(used*3),outColors=job.domainColors?new Float32Array(used*3):undefined;
 for(let i=0;i<vertices;i++){if((i&4095)===0)cancelled(context);const id=remap[i];if(id<0)continue;for(let k=0;k<3;k++){outPositions[id*3+k]=positions.get(i*3+k);if(outColors)outColors[id*3+k]=color.get(i*3+k);}}
 positions.clear();color.clear();let outIndices:Uint32Array|undefined;
 if(job.mode!=='points'){budget.add(triangles.length*4);outIndices=new Uint32Array(triangles.length);for(let i=0;i<triangles.length;i++){if((i&4095)===0)cancelled(context);outIndices[i]=remap[triangles.get(i)];}}
 triangles.clear();budget.release(remap.byteLength);remap=new Int32Array(0);
 let meshEdges:Uint32Array|undefined;
 if((job.mode==='wireframe'||job.overlay)&&outIndices){
  const original=outIndices,edges=buildMeshEdges(original,used,budget,()=>cancelled(context),count=>{
   if(job.overlay)checkedMeshBytes(used,original.length,count);
   else if(used*24+count*8>OUTPUT_BYTES)throw Error('等值面输出超过 128 MiB 预算；请降低分辨率或缩小采样域');
  });
  if(job.overlay)meshEdges=edges;else{outIndices=edges;budget.release(original.byteLength);}
 }

 const colors=outColors??vertexColors(outPositions,job.scene.palette,option(job.scene.settings,'colorMetric','height',['height','radius','angle','index']));
 if(invalid)warnings.push(`${invalid} 个场采样不是有限数值；相邻四面体不会跨越已采样的未定义区域。`);
 if(facts.rejectedEdges)warnings.push(`${facts.rejectedEdges} 条候选边在有界根细化中未取得可信零值；相关面片已跳过，可能是不连续区域或未解析的高条件数根。`);
 if(facts.degenerateTriangles)warnings.push(`${facts.degenerateTriangles} 个零面积、未解析或超出表示范围的三角形已排除。`);
 if(!used){warnings.push('当前采样域内没有可提取的等值面；检查公式、阈值与坐标域。');if(zeroSamples)warnings.push('采样包含零值但没有可用符号跨越；偶重根或整片零场不由当前均匀网格保证提取。');}
 facts.estimatedPeakWorkingBytes=Math.max(budget.peak,previous?.peak??0);
 return{type:'geometry',dimension:3,topology:job.mode==='points'?'points':job.mode==='wireframe'?'segments':'mesh',positions:outPositions,colors,...(outIndices?{indices:outIndices}:{}),...(meshEdges?{meshEdges}:{}),backend:useGpu?'webgl2':'cpu',implicit:facts,stats:{samples:facts.latticeSamples,generated:used,invalid,elapsedMs:performance.now()-started},...(warnings.length?{warnings}:{})};
}
export function generateImplicitSurface(scene:SceneDocument,context:GenerateContext,transform:Transform):SceneOutput {
 const started=performance.now(),job=prepareImplicitJob(scene,context,transform);
 if(context.isCancelled?.())return{type:'geometry',dimension:3,topology:job.mode==='points'?'points':job.mode==='wireframe'?'segments':'mesh',positions:new Float32Array(0),colors:new Float32Array(0),...(job.mode!=='points'?{indices:new Uint32Array(0)}:{}),...(job.overlay?{meshEdges:new Uint32Array(0)}:{}),backend:'cpu',implicit:emptyFacts(job),stats:{samples:0,generated:0,invalid:0},warnings:['场采样已取消，未进行等值面剖分。']};
 const gpu=job.requestedBackend==='webgl2'||job.requestedBackend==='auto'&&job.latticeSamples>=4096;
 let output:SceneOutput;try{output=extract(job,context,gpu,gpu?['GPU 格点逐点以 CPU 双精度核验分类，根细化和网格提取使用 CPU；此质量路径不保证加速。']:[]);}catch(error){if(!(error instanceof GpuRetry))throw error;cancelled(context);output=extract(job,context,false,[`GPU 等值面回退 CPU：${error.message}`,`工作统计包括已完成的 GPU 尝试（${error.work.latticeSamples} 个格点、${error.work.latticeValidationSamples} 次 CPU 分类核验、${error.work.rootEvaluations} 次根求值）和 CPU 重放；实际工作可超过请求网格。`],error);}output.stats.elapsedMs=performance.now()-started;return output;
}
