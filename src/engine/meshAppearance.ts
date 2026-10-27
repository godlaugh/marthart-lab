import {sourceImplicitMeshRoute} from './sourceImplicitIdentity';
import type {ControlSpec,SceneDocument,Settings} from '../types';
import {numberSetting} from './expression';
export interface SurfaceWireOptions {decoupled:boolean;uLines:number;vLines:number;curveSamples:number;}
export const PROCEDURAL_TEXTURES=['none','checker','metal','ceramic','carbon'] as const;
export type ProceduralTexture=typeof PROCEDURAL_TEXTURES[number];
export interface MeshAppearance {shininess:number;ambient:string;specular:string;texture:ProceduralTexture;textureScale:number;fill:boolean;wireframe:boolean;wireColor:string;wireWidth:number;surfaceWire:SurfaceWireOptions;}
const color=(s:Settings,key:string,fallback:string)=>{const value=String(s[key]??fallback);if(!/^#[0-9a-f]{6}$/i.test(value))throw new Error(`${key} 必须为 #RRGGBB`);return value;};
const flag=(s:Settings,key:string,fallback:boolean)=>{const value=s[key]??fallback;if(typeof value!=='boolean')throw new Error(`${key} 必须为布尔值`);return value;};
export const meshAppearanceDefaults:Settings={shininess:32,ambient:'#4d4d4d',specular:'#ffffff',proceduralTexture:'none',textureScale:8,meshFill:true,meshWireframe:false,meshWireframeColor:'#ffffff',meshWireframeWidth:1,meshWireframeDecoupled:false,meshWireframeCurveSamples:128};
/** Resolve display and rendering defaults at the same owning boundary. */
export function meshAppearanceControlSettings(settings:Settings):Settings {
 return {...settings,meshWireframeULines:settings.meshWireframeULines??settings.uSegments??96,meshWireframeVLines:settings.meshWireframeVLines??settings.vSegments??48};
}
function surfaceWireOptions(settings:Settings):SurfaceWireOptions {
 const resolved=meshAppearanceControlSettings(settings),uLines=numberSetting(resolved,'meshWireframeULines',96,0,512),vLines=numberSetting(resolved,'meshWireframeVLines',48,0,512);
 if(!Number.isInteger(uLines)||!Number.isInteger(vLines))throw new Error('线框数量必须为整数');
 const curveSamples=numberSetting(settings,'meshWireframeCurveSamples',128,2,2048);if(!Number.isInteger(curveSamples))throw new Error('曲线采样数必须为整数');
 return{decoupled:flag(settings,'meshWireframeDecoupled',false),uLines,vLines,curveSamples};
}
/** One owner for material defaults and validation; CPU sampling still renders through WebGL. */
export function parseMeshAppearance(settings:Settings):MeshAppearance {
 const texture=String(settings.proceduralTexture??'none') as ProceduralTexture;
 if(!PROCEDURAL_TEXTURES.includes(texture))throw new Error(`未知程序纹理 ${texture}`);
 return{shininess:numberSetting(settings,'shininess',32,0,100),ambient:color(settings,'ambient','#4d4d4d'),specular:color(settings,'specular','#ffffff'),texture,textureScale:numberSetting(settings,'textureScale',8,.01,256),fill:flag(settings,'meshFill',true),wireframe:flag(settings,'meshWireframe',false),wireColor:color(settings,'meshWireframeColor','#ffffff'),wireWidth:numberSetting(settings,'meshWireframeWidth',1,.1,32),surfaceWire:surfaceWireOptions(settings)};
}
export const meshMaterialControls:ControlSpec[]=[
 {key:'meshFill',label:'网格填充',group:'网格材质',type:'toggle'},
 {key:'meshWireframe',label:'叠加线框',group:'网格材质',type:'toggle'},
 {key:'meshWireframeColor',label:'线框颜色',group:'网格材质',type:'text'},
 {key:'meshWireframeWidth',label:'线框宽度（像素）',group:'网格材质',type:'number',min:.1,max:32,step:.1,help:'屏幕空间宽度；与缩放和设备像素比无关。'},
 {key:'meshWireframeDecoupled',label:'独立线框密度',group:'网格材质',type:'toggle',help:'保持曲面三角网格不变，独立设置两个参数方向的线数。'},
 {key:'meshWireframeCurveSamples',label:'每条曲线采样点',group:'网格材质',type:'number',min:2,max:2048,step:1,help:'直接评估方程，独立于曲面三角网格分辨率；最多合计 100 万个曲线采样点。'},
 {key:'meshWireframeULines',label:'常 U 线数',group:'网格材质',type:'number',min:0,max:512,step:1,help:'固定 U、沿 V 延伸。0 隐藏；独立曲线包含参数域两端；一条线位于中间。'},
 {key:'meshWireframeVLines',label:'常 V 线数',group:'网格材质',type:'number',min:0,max:512,step:1,help:'固定 V、沿 U 延伸。直接采样参数方程；网格很粗时曲线仍可保持平滑。'},
 {key:'shininess',label:'Phong 光泽度',group:'网格材质',type:'number',min:0,max:100,step:1},
 {key:'ambient',label:'环境光颜色',group:'网格材质',type:'text'},
 {key:'specular',label:'镜面反射颜色',group:'网格材质',type:'text'},
 {key:'proceduralTexture',label:'程序纹理',group:'网格材质',type:'select',options:[['none','无纹理'],['checker','棋盘格'],['metal','拉丝金属'],['ceramic','陶瓷'],['carbon','碳纤维']].map(([value,label])=>({value,label})),help:'独立实现的 GPU 物体坐标纹理；不依赖几何采样使用 CPU 或 WebGL2。'},
 {key:'textureScale',label:'纹理重复频率',group:'网格材质',type:'number',min:.01,max:256,step:.1},
];
const materialKeys=new Set(meshMaterialControls.map(c=>c.key));
export function isMeshMaterialControlVisible(scene:SceneDocument,key:string):boolean {
 if(!materialKeys.has(key))return true;
 const implicit=sourceImplicitMeshRoute(scene);
 if(implicit){
  if(key==='meshFill'||key==='meshWireframe')return true;
  if(key==='meshWireframeWidth')return scene.settings.meshWireframe===true;
  return implicit.presentation==='gpu-material'&&scene.settings.meshFill!==false&&['shininess','ambient','specular','proceduralTexture'].includes(key);
 }
 const surface=scene.kind==='surface',wireOnly=surface&&scene.settings.renderMode==='wireframe';
 if(!['surface','implicit'].includes(scene.kind)||!wireOnly&&scene.settings.renderMode!=='mesh')return false;
 const wire=wireOnly||scene.settings.meshWireframe===true;
 if(['meshWireframeWidth','meshWireframeDecoupled','meshWireframeULines','meshWireframeVLines','meshWireframeCurveSamples'].includes(key)){
  if(!surface||!wire)return false;
  return !['meshWireframeULines','meshWireframeVLines','meshWireframeCurveSamples'].includes(key)||scene.settings.meshWireframeDecoupled===true;
 }
 if(key==='meshWireframeColor')return wire;
 if(wireOnly)return false;
 if(key==='meshFill'||key==='meshWireframe')return true;
 if(scene.settings.meshFill===false)return false;
 return key!=='textureScale'||scene.settings.proceduralTexture!=='none';
}
