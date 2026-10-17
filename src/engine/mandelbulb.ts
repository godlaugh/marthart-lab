import type {SceneDocument,Settings,RGB} from '../types';
import {numberSetting} from './expression';
import {hexRGB,paletteColor,validatePalette} from './palette';
import {initialBulbCamera,validateEvaluatedCamera} from './sceneCamera';
export {parseBulbCameraSettings} from './sceneCamera';
import {MAX_RASTER_PIXELS} from './rasterDimensions';
export type Vec3=[number,number,number];
export interface BulbConfig {
 power:number;iterations:number;bailout:number;phase:number;rotation:number[];
 camera:Vec3;forward:Vec3;right:Vec3;up:Vec3;rayScale:number;
 epsilon:number;steps:number;shadowSteps:number;shadowStrength:number;
 ambient:number;diffuse:number;specular:number;shininess:number;fog:number;exposure:number;
 background:RGB;transparent:boolean;
}
export interface BulbJob {width:number;height:number;config:BulbConfig;palette:Float32Array;}
export const BULB_PALETTE_SIZE=1024;
const clamp=(v:number,a=0,b=1)=>Math.max(a,Math.min(b,v));
const dot=(a:Vec3,b:Vec3)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const add=(a:Vec3,b:Vec3,t=1):Vec3=>[a[0]+b[0]*t,a[1]+b[1]*t,a[2]+b[2]*t];
export function normalize3(a:Vec3):Vec3{const r=Math.hypot(...a);return r>1e-20?[a[0]/r,a[1]/r,a[2]/r]:[0,1,0];}
function cross(a:Vec3,b:Vec3):Vec3{return[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];}
function angle(v:number){return v%(2*Math.PI);}
function integer(s:Settings,k:string,d:number,min:number,max:number){const v=numberSetting(s,k,d,min,max);if(!Number.isInteger(v))throw new Error(k+' 必须为整数');return v;}
function rotated(p:Vec3,axis:number,t:number):Vec3{const q:[number,number,number]=[...p],a=(axis+1)%3,b=(axis+2)%3,c=Math.cos(t),s=Math.sin(t);q[a]=c*p[a]-s*p[b];q[b]=s*p[a]+c*p[b];return q;}
export function bulbTransform(p:Vec3,m:number[]):Vec3{return[m[0]*p[0]+m[3]*p[1]+m[6]*p[2],m[1]*p[0]+m[4]*p[1]+m[7]*p[2],m[2]*p[0]+m[5]*p[1]+m[8]*p[2]];}
/** One owning boundary for CPU, GPU, voxel mode and camera UI. Angles are radians.
 * The native latitude map swaps world y/z before iteration. Rotation is a
 * column-major world-to-fractal matrix, resolved once at the requested time. */
export function parseBulbConfig(scene:SceneDocument,time:number,base:{power:[number,number];iterations:number;bailout:number}):BulbConfig{
 if(!Number.isFinite(time))throw new Error('Mandelbulb 时间必须有限');const s=scene.settings;
 const v=(k:string,d:number,min=-1e6,max=1e6)=>numberSetting(s,k,d,min,max);
 const speed=v('bulbRotationSpeed',.05,-100,100),turn=time*speed+v('rotation',0),phase=v('bulbPhaseShift',0)+time*v('bulbPhaseSpeed',.05,-100,100);
 if(!Number.isFinite(turn)||!Number.isFinite(phase))throw new Error('Mandelbulb 时间相位溢出');
 const frame=validateEvaluatedCamera(scene.evaluatedCamera??initialBulbCamera(s,time)),target=frame.camera.target,delta=frame.camera.position.map((v,i)=>v-target[i]) as Vec3,rawRadius=Math.hypot(...delta),radius=Math.max(rawRadius/clamp(frame.camera.zoom,.05,12),.28),camera=target.map((v,i)=>v+delta[i]/rawRadius*radius) as Vec3,forward=normalize3(target.map((v,i)=>v-camera[i]) as Vec3);
 const axis=Math.abs(forward[1])>.999999?[0,0,1] as Vec3:[0,1,0] as Vec3,baseRight=normalize3(cross(forward,axis)),baseUp=cross(baseRight,forward),co=Math.cos(frame.roll),si=Math.sin(frame.roll),right=baseRight.map((v,i)=>v*co+baseUp[i]*si) as Vec3,up=baseUp.map((v,i)=>v*co-baseRight[i]*si) as Vec3;
 const cycle=Math.abs(turn)%(6*Math.PI),t=angle(turn);
 const rotate=(p:Vec3)=>{let q=p;if(cycle<2*Math.PI)q=rotated(q,1,t);else if(cycle<4*Math.PI){q=rotated(q,0,t);q=rotated(q,2,angle(turn*.7));}else{q=rotated(q,1,t);q=rotated(q,0,angle(turn*.5));q=rotated(q,2,angle(turn*.35));}return q;};
 const rotation=[...rotate([1,0,0]),...rotate([0,1,0]),...rotate([0,0,1])];
 const transparent=s.transparentBackground??false;if(typeof transparent!=='boolean')throw new Error('transparentBackground 必须为布尔值');
 if(base.power[0]<2||base.power[0]>32)throw new Error('Mandelbulb 幂次必须在 2–32');
 return{power:base.power[0],iterations:Math.min(base.iterations,128),bailout:base.bailout,phase:angle(phase),rotation,camera,forward,right,up,rayScale:frame.rayScale*frame.focalLength/35,epsilon:v('bulbSurfaceEpsilon',.001,.00001,.1),steps:integer(s,'bulbMarchSteps',96,1,256),shadowSteps:integer(s,'bulbShadowSteps',48,0,96),shadowStrength:v('bulbShadowStrength',10,0,100),ambient:v('bulbAmbient',.45,0,5),diffuse:v('bulbDiffuse',2.2,0,10),specular:v('bulbSpecular',1.8,0,10),shininess:v('bulbShininess',20,1,256),fog:v('bulbFog',.018,0,1),exposure:v('bulbExposure',1,0,10),background:hexRGB(String(s.background??'#0a0c14')),transparent};
}
export function bulbPalette(scene:SceneDocument):Float32Array{const palette=validatePalette(scene.palette),offset=numberSetting(scene.settings,'gradientOffset',0,-1e6,1e6),out=new Float32Array(BULB_PALETTE_SIZE*3);for(let i=0;i<BULB_PALETTE_SIZE;i++)out.set(paletteColor(palette,i/(BULB_PALETTE_SIZE-1)+offset),i*3);return out;}
export function validateBulbJob(job:BulbJob){
 if(!job||!Number.isInteger(job.width)||!Number.isInteger(job.height)||job.width<1||job.height<1||job.width>16384||job.height>16384||job.width*job.height>MAX_RASTER_PIXELS)throw new Error('Mandelbulb 图像超过 128 MiB RGBA 或 16384 单边预算');
 const c=job.config;if(!c||Object.values(c).some(v=>typeof v==='number'&&!Number.isFinite(v)))throw new Error('Mandelbulb 参数必须有限');
 const range=(v:number,a:number,b:number)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<a||v>b)throw new Error('Mandelbulb 参数超出有效范围');};
 for(const [value,min,max]of [[c.power,2,32],[c.iterations,1,128],[c.bailout,.5,1e12],[c.phase,-2*Math.PI,2*Math.PI],[c.epsilon,.00001,.1],[c.steps,1,256],[c.shadowSteps,0,96],[c.rayScale,.000000001,1e6],[c.shadowStrength,0,100],[c.ambient,0,5],[c.diffuse,0,10],[c.specular,0,10],[c.shininess,1,256],[c.fog,0,1],[c.exposure,0,10]])range(value,min,max);
 for(const v of [c.iterations,c.steps,c.shadowSteps])if(!Number.isInteger(v))throw new Error('Mandelbulb 迭代次数必须为整数');
 for(const [v,n]of [[c.rotation,9],[c.camera,3],[c.forward,3],[c.right,3],[c.up,3],[c.background,3]] as const)if(!Array.isArray(v)||v.length!==n||!v.every(Number.isFinite))throw new Error('Mandelbulb 向量格式无效');
 c.background.forEach(v=>range(v,0,1));if(Math.hypot(...c.camera)>20000.001)throw new Error('Mandelbulb 相机超过解析器半径范围');
 const axes=[0,1,2].map(i=>c.rotation.slice(i*3,i*3+3) as Vec3);for(const axis of axes)if(Math.abs(dot(axis,axis)-1)>1e-6)throw new Error('Mandelbulb 对象变换必须为单位旋转');for(let a=0;a<3;a++)for(let b=a+1;b<3;b++)if(Math.abs(dot(axes[a],axes[b]))>1e-6)throw new Error('Mandelbulb 对象旋转必须正交');
 if(typeof c.transparent!=='boolean')throw new Error('Mandelbulb 透明格式无效');
 for(const v of [c.forward,c.right,c.up])if(Math.abs(dot(v,v)-1)>1e-6)throw new Error('Mandelbulb 相机基向量必须归一化');
 if(Math.max(Math.abs(dot(c.forward,c.right)),Math.abs(dot(c.forward,c.up)),Math.abs(dot(c.right,c.up)))>1e-6)throw new Error('Mandelbulb 相机基向量必须正交');
 if(!(job.palette instanceof Float32Array)||job.palette.length!==BULB_PALETTE_SIZE*3||!job.palette.every(v=>Number.isFinite(v)&&v>=0&&v<=1))throw new Error('Mandelbulb 调色板格式无效');
}
export interface BulbDistance {distance:number;trap:number;radius:number;escaped:boolean;}
/** Log derivative prevents overflow of dr. When r^p dwarfs both c and bailout,
 * the next DE has the same limit .5 log(r) r/dr; omitted c/r^p < 1e-12.
 * Both backends use this guard, rather than arbitrary nonfinite replacement. */
export function bulbDistance(point:Vec3,c:BulbConfig):BulbDistance{
 const q=bulbTransform(point,c.rotation),constant:Vec3=[q[0],q[2],q[1]];let z:Vec3=[...constant],logDr=0,r=0,trap=Infinity,escaped=false;
 for(let n=0;n<c.iterations;n++){
  r=Math.hypot(...z);trap=Math.min(trap,r);if(r>c.bailout){escaped=true;break;}
  const safe=Math.max(r,1e-6),lr=Math.log(safe),lp=lr*c.power;
  if(lp>32&&lp>Math.log(c.bailout)*1.01){escaped=true;break;}
  const a=(c.power-1)*lr+Math.log(c.power)+logDr;logDr=Math.max(a,0)+Math.log1p(Math.exp(-Math.abs(a)));
  const azimuth=Math.atan2(z[1],z[0])*c.power,latitude=Math.asin(clamp(z[2]/safe,-1,1))*c.power+c.phase,rp=Math.exp(lp);
  z=[rp*Math.cos(azimuth)*Math.cos(latitude)+constant[0],rp*Math.sin(azimuth)*Math.cos(latitude)+constant[1],rp*Math.sin(latitude)+constant[2]];
 }
 return{distance:Math.abs(.5*Math.log(Math.max(r,1e-6))*r*Math.exp(-logDr)),trap:clamp(trap/c.bailout),radius:r,escaped};
}
export function bulbNormal(point:Vec3,c:BulbConfig):Vec3{const e=c.epsilon;return normalize3([0,1,2].map(axis=>{const a:Vec3=[...point],b:Vec3=[...point];a[axis]+=e;b[axis]-=e;return bulbDistance(a,c).distance-bulbDistance(b,c).distance;}) as Vec3);}
export function bulbRay(job:BulbJob,x:number,y:number):Vec3{const u=(2*(x+.5)-job.width)/job.height,v=(job.height-2*(y+.5))/job.height,c=job.config;return normalize3(add(add(c.forward.map(a=>a*c.rayScale) as Vec3,c.right,u),c.up,v));}
export interface BulbHit {point:Vec3;distance:number;trap:number;steps:number;}
/** Radius two bounds the p>=2 set: |z|>2 and |c|<=2 implies
 * |z^p+c| >= |z|^p-|c| > |z|. Clip rays to this bounding sphere. */
export function marchBulb(ray:Vec3,c:BulbConfig,pixelEpsilon:number):BulbHit|null{
 const b=dot(c.camera,ray),d=b*b-dot(c.camera,c.camera)+4;if(d<0)return null;const root=Math.sqrt(d),end=-b+root+.01;if(end<0)return null;
 // Begin just outside the bound: sampling exactly r=2 at bailout=2 makes
 // a float rounding bit choose different escape branches and marching paths.
 let t=Math.max(0,-b-root-.01);for(let i=0;i<c.steps&&t<=end;i++){const point=add(c.camera,ray,t),value=bulbDistance(point,c);if(value.distance<Math.max(c.epsilon,pixelEpsilon))return{point,distance:t,trap:value.trap,steps:i+1};t+=clamp(value.distance*.85,.0005,.75);}return null;
}
function shadow(point:Vec3,normal:Vec3,c:BulbConfig,sun:Vec3){if(!c.shadowSteps||!c.shadowStrength)return 1;const origin=add(point,normal,c.epsilon*3);let t=.02,result=1;for(let i=0;i<c.shadowSteps&&t<12;i++){const d=bulbDistance(add(origin,sun,t),c).distance;if(d<c.epsilon*.8)return .04;result=Math.min(result,c.shadowStrength*d/t);t+=clamp(d,.01,.5);}return clamp(result,.04,1);}
export function shadeBulbPixel(job:BulbJob,x:number,y:number):[number,number,number,number]{
 const c=job.config,ray=bulbRay(job,x,y),hit=marchBulb(ray,c,.5/job.width);if(!hit)return[...c.background,c.transparent?0:1];
 const normal=bulbNormal(hit.point,c),sun=normalize3([.2,.75,.55]),occlusion=shadow(hit.point,normal,c,sun),diffuse=Math.max(dot(normal,sun),0),sky=.45+.55*Math.max(normal[1],0),back=Math.max(dot(normal,normalize3([-sun[0],-.35,-sun[2]])),0),reflected=add(ray,normal,-2*dot(ray,normal)),spec=Math.max(dot(reflected,sun),0)**c.shininess;
 const index=clamp(hit.trap)*(BULB_PALETTE_SIZE-1),lo=Math.floor(index),hi=Math.min(lo+1,BULB_PALETTE_SIZE-1),fraction=index-lo,sunColor=[1.45,1.18,.92],skyColor=[.58,.82,1],fog=1-Math.exp(-c.fog*hit.distance*hit.distance);
 const color=[0,1,2].map(k=>{const base=job.palette[lo*3+k]*(1-fraction)+job.palette[hi*3+k]*fraction,light=sunColor[k]*(diffuse*occlusion*c.diffuse+back*.32)+skyColor[k]*sky*c.ambient;return clamp(((base*light+spec*occlusion*c.specular)*(1-fog)+c.background[k]*fog)*c.exposure)**(1/2.2);});return[color[0],color[1],color[2],1];
}
export function renderBulbCpu(job:BulbJob,cancel?:()=>boolean):{pixels:Uint8ClampedArray;samples:number;cancelled:boolean}{validateBulbJob(job);const pixels=new Uint8ClampedArray(job.width*job.height*4);let samples=0;for(let y=0;y<job.height;y++){if(cancel?.())return{pixels,samples,cancelled:true};for(let x=0;x<job.width;x++){const color=shadeBulbPixel(job,x,y),i=(y*job.width+x)*4;for(let k=0;k<4;k++)pixels[i+k]=Math.round(clamp(color[k])*255);samples++;}}return{pixels,samples,cancelled:false};}
