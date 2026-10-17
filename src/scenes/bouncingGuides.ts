import type {ControlSpec,GeometryOutput,SceneDocument,Settings} from '../types';
import {numberSetting} from '../engine/expression';
import {boundaryFromSettings,insetBouncingBoundary,type Boundary} from './bouncing';
import {createBouncingShapeSampler,type BouncingShapeSampler} from './bouncingShapes';
import {parseParticleTransform,type ParticleTransform} from './particleTransform';
type Overlay=NonNullable<GeometryOutput['lineOverlays']>[number];
function toggle(s:Settings,key:string,fallback:boolean){const value=s[key]??fallback;if(typeof value!=='boolean')throw new Error(`${key} 必须为布尔值`);return value;}
function color(s:Settings,key:string,fallback:string){const value=String(s[key]??fallback);if(!/^#[0-9a-fA-F]{6}$/.test(value))throw new Error(`${key} 需要 #RRGGBB 颜色`);return value;}
/** Boundary coordinates are local to the container center, never secretly collision-inset. */
export function bouncingBoundarySegments(boundary:Boundary,segments=512):Float64Array {
 if(!Number.isInteger(segments)||segments<16||segments>16384)throw new Error('边界轮廓需要 16 至 16384 段');
 const b=insetBouncingBoundary(boundary,0),count=b.kind==='polygon'?b.vertices.length:segments,vertices:Float64Array=new Float64Array(count*4);
 for(let i=0;i<count;i++){
  const point=(j:number):[number,number]=>b.kind==='polygon'?b.vertices[j%count]:[(b.kind==='circle'?b.radius:b.a)*Math.cos(j/count*2*Math.PI),(b.kind==='circle'?b.radius:b.b)*Math.sin(j/count*2*Math.PI)];
  vertices.set([...point(i),...point((i+1)%count)],i*4);
 }
 return vertices;
}
export function createBouncingGuides(scene:SceneDocument,time:number,options:{boundary?:Boundary;collisionBoundary?:Boundary;shape?:BouncingShapeSampler;transform?:ParticleTransform;isCancelled?:()=>boolean}={}):{overlays:Overlay[];warnings:string[]} {
 if(!Number.isFinite(time))throw new Error('轮廓时间必须有限');
 const s=scene.settings,overlays:Overlay[]=[],warnings:string[]=[],boundary=options.boundary??boundaryFromSettings(s),transform=options.transform??parseParticleTransform(s),resolution=numberSetting(s,'guideResolution',512,16,16384);
 if(!Number.isInteger(resolution))throw new Error('轮廓细分必须为整数');
 const append=(id:string,xy:Float64Array,cx:number,cy:number)=>{
  if(xy.length%4||xy.length>262144*4)throw new Error('轮廓段超出格式或资源预算');
  const positions=new Float32Array(xy.length/2*3);let cursor=0,invalid=0;
  for(let i=0;i<xy.length;i+=4){if(i%4096===0&&options.isCancelled?.())throw new Error('轮廓生成已取消');const p=transform.point(xy[i]+cx,xy[i+1]+cy),q=transform.point(xy[i+2]+cx,xy[i+3]+cy);if(!p||!q){invalid++;continue;}positions.set([...p,...q],cursor);cursor+=6;}
  if(invalid)warnings.push(`${id} 轮廓省略 ${invalid} 个超出有限几何范围的线段。`);
  const prefix=id==='container'?'boundary':id==='collision'?'collisionBoundary':'initialShape';
  if(cursor)overlays.push({id,positions:positions.slice(0,cursor),color:color(s,prefix+'Color',id==='container'?'#ffffff':id==='collision'?'#ff9650':'#71d5ff'),width:numberSetting(s,prefix+'Width',1,.1,32),opacity:numberSetting(s,prefix+'Opacity',.6,0,1)});
  else warnings.push(`${id} 轮廓退化或没有可显示的线段。`);
 };
 const bx=numberSetting(s,'boundaryCenterX',0,-1e6,1e6),by=numberSetting(s,'boundaryCenterY',0,-1e6,1e6);
 if(toggle(s,'showBoundary',true))append('container',bouncingBoundarySegments(boundary,resolution),bx,by);
 if(toggle(s,'showCollisionBoundary',false))append('collision',bouncingBoundarySegments(options.collisionBoundary??insetBouncingBoundary(boundary,numberSetting(s,'collisionRadius',0,0,1000)),resolution),bx,by);
 if(toggle(s,'showInitialShape',false)){
  const shape=options.shape??createBouncingShapeSampler(String(s.shape??'ring'),s,scene.equations.mask,{isCancelled:options.isCancelled});
  append('initial-shape',shape.outline({...scene.parameters,t:time},resolution),0,0);warnings.push(...(shape.diagnostics?.().warnings??[]));
 }
 return{overlays,warnings};
}
const toggleControl=(key:string,label:string):ControlSpec=>({key,label,type:'toggle',group:'轮廓'});
export const bouncingGuideControls:ControlSpec[]=[toggleControl('showBoundary','显示外容器边界'),toggleControl('showCollisionBoundary','显示内缩碰撞路径'),toggleControl('showInitialShape','显示初始形状轮廓'),{key:'guideResolution',label:'轮廓细分',type:'number',min:16,max:16384,step:16,group:'轮廓'},...(['boundary','collisionBoundary','initialShape'] as const).flatMap((key,i):ControlSpec[]=>{const label=['外边界','碰撞路径','初始形状'][i];return[{key:key+'Color',label:label+'颜色',type:'text',help:'#RRGGBB',group:'轮廓'},{key:key+'Width',label:label+'线宽（像素）',type:'number',min:.1,max:32,step:.1,group:'轮廓'},{key:key+'Opacity',label:label+'透明度',type:'number',min:0,max:1,step:.01,group:'轮廓'}];})];
export const bouncingGuideDefaults:Settings={showBoundary:true,showCollisionBoundary:false,showInitialShape:false,guideResolution:512,boundaryColor:'#ffffff',boundaryWidth:1,boundaryOpacity:.6,collisionBoundaryColor:'#ff9650',collisionBoundaryWidth:1,collisionBoundaryOpacity:.6,initialShapeColor:'#71d5ff',initialShapeWidth:1,initialShapeOpacity:.6};
