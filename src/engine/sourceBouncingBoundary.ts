import type {SourceBouncingUpdate} from './sourceBouncingGpu';
import type {SourceBouncingDisplay} from './sourceBouncingVisualConfig';
import type {SourceBouncingResult,SourceBouncingError} from './sourceBouncingConfig';
import {SOURCE_CAMERA_MODEL,type SourceCameraPlan} from './sourceCamera';
import {writeSourceEyePosition} from './sourceProcessingGeometry';

export interface SourceBouncingBoundaryPath {
 readonly positions:Float32Array;readonly closed:true;readonly lineWidth:number;readonly packedColor:number;
 /** Native ellipse detail; null for an authored polygon. No repeated endpoint. */
 readonly detail:number|null;readonly diagnostics:readonly string[];
}
export const SOURCE_BOUNCING_BOUNDARY_LIMITS=Object.freeze({polygonVertices:64,ellipseVertices:200,pathBytes:200*3*4});
const F=Math.fround,EPS=2**-23;
// Processing PGraphics.<clinit> PC25–64. This retains the float angle and
// host-libm sin/cos boundary; native JVM last-bit equivalence is not established.
const sin=new Float32Array(720),cos=new Float32Array(720);
for(let i=0;i<720;i++){const angle=F(F(F(i)*F(Math.PI/180))*.5);sin[i]=F(Math.sin(angle));cos[i]=F(Math.cos(angle));}
class Failure extends Error {constructor(readonly detail:SourceBouncingError){super(detail.reason);}}
function fail(kind:SourceBouncingError['kind'],path:readonly string[],reason:string):never{throw new Failure({kind,path,reason});}
function finite(raw:unknown,path:readonly string[]):number{if(typeof raw!=='number')fail('input',path,'必须为数值');const value=F(raw);if(!Number.isFinite(value))fail('nonfinite',path,'边界坐标或样式不能表示为有限 Float32');return value;}
function pair(raw:unknown,path:readonly string[]):[number,number]{if(!Array.isArray(raw)||raw.length!==2)fail('input',path,'必须为二维坐标');return[finite(raw[0],[...path,'0']),finite(raw[1],[...path,'1'])];}
function matrix(raw:readonly number[]|undefined,path:readonly string[]):number[]{if(!raw||raw.length!==16)fail('input',path,'缺少已解析的16项相机矩阵');return Array.from(raw,(v,i)=>finite(v,[...path,String(i)]));}
function projectionFacts(plan:SourceCameraPlan){
 if(plan?.model!==SOURCE_CAMERA_MODEL||!plan.viewport||!['perspective','scene-fade-orthographic'].includes(plan.viewport.projectionPass))fail('input',['cameraPlan'],'边界投影未知，不能推测椭圆细分');
 const width=plan.viewport.logicalWidth,height=plan.viewport.logicalHeight;
 for(const [key,value] of [['logicalWidth',width],['logicalHeight',height]] as const)if(!Number.isInteger(value)||value<1||value>2147483647)fail('input',['cameraPlan','viewport',key],'逻辑尺寸必须为正 Java int');
 return{width:F(width),height:F(height),modelview:matrix(plan.modelView?.rowMajor,['cameraPlan','modelView']),projection:matrix(plan.projection?.rowMajor,['cameraPlan','projection'])};
}
/** PGraphicsOpenGL screenX/Y: modelview is evaluated first with implicit w=1,
 * then projection with the resulting w. Its combined transform is NOT used. */
function screen(x:number,y:number,p:ReturnType<typeof projectionFacts>):[number,number]{
 const eye=new Float32Array(4);writeSourceEyePosition(p.modelview,x,y,0,eye,0);
 const dot=(row:number)=>{const k=row*4,m=p.projection;return F(F(F(F(m[k]*eye[0])+F(m[k+1]*eye[1]))+F(m[k+2]*eye[2]))+F(m[k+3]*eye[3]));};
 let px=dot(0),py=dot(1);const w=dot(3);
 // Native nonZero ignores |w| below FLOAT_EPS; equality DOES divide.
 if(Math.abs(w)>=EPS){px=F(px/w);py=F(py/w);}
 return[F(F(p.width*F(1+px))/2),F(p.height-F(F(p.height*F(1+py))/2))];
}
/** BouncingBoundaryMobject.display -> PGraphics CENTER ellipse -> InGeometry.
 * Boundary centers have already been added by the source motion owner. This
 * function applies only visual scale/offset, never a second center translation.
 * Finite input is required. Nonfinite projection arithmetic follows native
 * float-to-int detail recovery; nonfinite final geometry/style is rejected.
 * The bounded path owns coordinates only, not joins, GPU buffers or pixels. */
export function prepareSourceBouncingBoundary(boundary:SourceBouncingUpdate['boundary'],display:SourceBouncingDisplay,plan:SourceCameraPlan):SourceBouncingResult<SourceBouncingBoundaryPath>{try{
 const t=display?.transform;if(!t)fail('input',['display','transform'],'缺少已解析显示变换');
 const sx=finite(t.scaleX,['transform','scaleX']),sy=finite(t.scaleY,['transform','scaleY']),ox=finite(t.offsetX,['transform','offsetX']),oy=finite(t.offsetY,['transform','offsetY']),oz=finite(t.offsetZ,['transform','offsetZ']);
 const lineWidth=finite(display.boundaryStrokeWeight,['lineWidth']);if(lineWidth<1)fail('input',['lineWidth'],'源边界描边最小为1');
 const packedColor=display.boundaryPackedColor;if(!Number.isInteger(packedColor)||packedColor<0||packedColor>0xffffffff)fail('input',['packedColor'],'边界颜色必须为已解析 uint32');
 const worldX=(x:number)=>F(F(x*sx)+ox),worldY=(y:number)=>F(F(y*sy)+oy);
 const finish=(positions:Float32Array,detail:number|null):SourceBouncingResult<SourceBouncingBoundaryPath>=>{
  for(let i=0;i<positions.length;i++)if(!Number.isFinite(positions[i]))fail('nonfinite',['positions',String(i)],'源边界世界坐标溢出；未替换或裁剪几何');
  return{ok:true,value:{positions,closed:true,lineWidth,packedColor,detail,diagnostics:detail===null?[]:['椭圆采用源 Float32/LUT 运算次序；Java 与 JavaScript 三角函数末位及原版像素尚未验证。']}};
 };
 if(boundary?.kind==='polygon'){
  if(!Array.isArray(boundary.vertices))fail('input',['boundary','vertices'],'多边形顶点必须为数组');
  if(boundary.vertices.length>SOURCE_BOUNCING_BOUNDARY_LIMITS.polygonVertices)fail('capacity',['boundary','vertices'],'源边界最多64个多边形顶点');
  // display PC290–294 skips beginShape entirely below three vertices.
  if(boundary.vertices.length<3)return finish(new Float32Array(0),null);
  const positions=new Float32Array(boundary.vertices.length*3);
  boundary.vertices.forEach((point,i)=>{const [x,y]=pair(point,['boundary','vertices',String(i)]);positions[i*3]=worldX(x);positions[i*3+1]=worldY(y);positions[i*3+2]=oz;});
  return finish(positions,null);
 }
 if(boundary?.kind!=='circle'&&boundary?.kind!=='ellipse')fail('input',['boundary','kind'],'未知源边界类型');
 const p=projectionFacts(plan),[cx,cy]=pair(boundary.center,['boundary','center']);
 const a=finite(boundary.kind==='circle'?boundary.radius:boundary.a,['boundary',boundary.kind==='circle'?'radius':'a']),b=boundary.kind==='circle'?a:finite(boundary.b,['boundary','b']);
 const width=Math.abs(F(F(a*sx)*2)),height=Math.abs(F(F(b*sy)*2));
 // ellipseMode=CENTER subtracts half size; addEllipse rebuilds the center.
 const rx=F(width/2),ry=F(height/2),left=F(worldX(cx)-rx),top=F(worldY(cy)-ry),centerX=F(left+rx),centerY=F(top+ry);
 const first=screen(left,top,p),last=screen(F(left+width),F(top+height),p),dx=F(last[0]-first[0]),dy=F(last[1]-first[1]);
 const distance=F(Math.sqrt(F(F(dx*dx)+F(dy*dy)))),requested=F(F(F(2*Math.PI)*distance)/10);
 // Native f2i saturates infinities and maps NaN to0; the outer20..200 clamp
 // makes larger finite int saturation immaterial to this bounded result.
 const detail=Math.min(200,Math.max(20,Number.isNaN(requested)?0:Math.trunc(requested))),step=F(720/detail),positions=new Float32Array(detail*3);
 let angle=0;
 for(let i=0;i<detail;i++){const index=Math.trunc(angle);positions[i*3]=F(centerX+F(cos[index]*rx));positions[i*3+1]=F(centerY+F(sin[index]*ry));positions[i*3+2]=0;angle=F(F(angle+step)%720);}
 return finish(positions,detail);
 }catch(error){if(error instanceof Failure)return{ok:false,error:error.detail};throw error;}}
