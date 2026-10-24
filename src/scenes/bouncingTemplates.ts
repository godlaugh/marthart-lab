import type {Preset} from '../types';
import {importSourceBouncingDocument} from '../engine/sourceBouncingDocument';
import {PALETTES} from '../engine/palette';

/** Authored numerical recipes matching the retained 1.7.8 inputs. The app
 * ships no original executable/resource dependency. Import owns Float32 and
 * omitted-field interpretation; tests bind these recipes to retained evidence.
 * Guide choices inherit bouncing2, as recorded in the guide acceptance. */
const polygon=[[-4.021447708169035e-8,.9200000166893005],[-.7967432737350464,-.4600001871585846],[.7967435121536255,-.45999979972839355]];
const spiralPalette=['#FC6255','#FF862F','#FFCD62','#83C167','#58C4DD','#9A72AC'];
const starPalette=['#CF7677','#CE7B70','#CD8069','#CC8562','#CB8959','#CB9054','#D2A25E','#D9B368','#DEC572','#E4D67C','#DEDF85','#C9DB8C','#B2D693','#9AD198','#80CC9D','#72CDA8','#6DD2B7','#67D6C6','#60DBD4','#59DFE3','#53D0DF','#4EBDD5','#49AACC','#4498C3','#3F85B9'];
const formulaPalette=['#FF4040','#F82067','#E40991','#C500B9','#9F05DB','#7517F3','#4C34FE','#2959FC','#0F83EC','#02ACD0','#02D0AC','#0FEC83','#29FC59','#4CFE34','#75F317','#9FDB05','#C5B900','#E49109','#F86720','#FF4040'];
const common={sub_steps:1,circle_radius:.55,container_shape:'CIRCLE',initial_speed:.2,initial_angle:Math.PI/2,x0_min:0,x0_max:0,y0_min:0,y0_max:0};
const spiral={...common,particle_count:2_000_000,initial_position_mode:'SPIRAL',initial_circle_radius:0,shape_fill_mode:'OUTLINE',shape_line_width:.011,shape_formula:''};
const star={...common,particle_count:5_000_000,seed:2,time_step:.01,particle_radius:.001,dot_size:.1,initial_position_mode:'STAR',initial_circle_radius:.26,initial_velocity_mode:'RADIAL_OUT',velocity_noise:.4,record_duration:60};
const formula={...spiral,particle_count:1_000_000,initial_position_mode:'FORMULA',initial_circle_radius:.75,x0_min:-.05,x0_max:.05,y0_min:-.05,y0_max:.05};
function preset(id:string,name:string,description:string,settings:Record<string,unknown>,palette:string[],vertices=polygon):Preset {
 const parsed=importSourceBouncingDocument({settings,palette,polygon:vertices});
 if(!parsed.ok)throw Error(`Invalid Bouncing creation recipe ${id}: ${parsed.error.path.join('.')}: ${parsed.error.reason}`);
 return{id,name,description,document:{
  version:1,bouncingSource:parsed.value.payload,equations:{},parameters:{},settings:{},
  palette:structuredClone(PALETTES[0]),camera:{position:[7,5,8],target:[0,0,0],orthographic:false,zoom:1,autoFit:true},
  timeline:{duration:10,fps:30,loop:false,tracks:[]},
 }};
}
export const bouncingCreationPresets:Preset[]=[
 preset('source-spiral','螺旋弹跳','200 万粒子 · 螺旋轮廓 · 圆形容器',spiral,spiralPalette),
 preset('source-star','星形弹跳','500 万粒子 · 星形填充 · 径向速度',star,starPalette),
 preset('source-formula-grid','正弦格点弹跳','100 万粒子 · 正弦公式采样',{...formula,shape_formula:'sin(150 x) * sin(150 y) > 0.5'},formulaPalette),
 preset('source-formula-rings','余弦环纹弹跳','100 万粒子 · 余弦公式采样',{...formula,shape_formula:'cos(150 x*x) * cos(150 y*y) > 0.5'},formulaPalette),
 preset('source-rose','玫瑰弹跳','200 万粒子 · 七瓣玫瑰 · 径向速度',{...star,particle_count:2_000_000,initial_position_mode:'ROSE',shape_rose_k:7},starPalette),
 preset('source-hexagon','六边形弹跳','50 万粒子 · 圆形初始分布 · 六边形容器',{...star,particle_count:500_000,container_shape:'POLYGON',initial_position_mode:'CIRCLE',initial_circle_radius:.16,initial_velocity_mode:'UNIFORM',velocity_noise:0},starPalette,[[.5369357466697693,.3100000023841858],[-2.7101060950940337e-8,.6200000047683716],[-.5369357466697693,.3100000321865082],[-.5369356870651245,-.31000012159347534],[7.393425871526915e-9,-.6200000047683716],[.5369358658790588,-.30999985337257385]]),
 preset('source-ellipse','椭圆弹跳','200 万粒子 · 圆环初始分布 · 椭圆容器',{...star,particle_count:2_000_000,container_shape:'ELLIPSE',ellipse_semi_major_axis:.6,ellipse_semi_minor_axis:.55,initial_position_mode:'RING',shape_inner_ratio:.57,initial_velocity_mode:'UNIFORM',velocity_noise:0,dot_size:1.25},starPalette),
];
export const bouncingDefaultPresetId='source-spiral';
