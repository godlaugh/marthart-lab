import type {ControlSpec,GenerateContext,SceneDocument,SceneOutput,Settings} from '../types';
import type {FractalConfig} from './complex';
import {numberSetting} from '../engine/expression';
import {paletteColor} from '../engine/palette';
import {bulbDistance,bulbPalette,parseBulbConfig,renderBulbCpu,type BulbConfig} from '../engine/mandelbulb';
import {mandelbulbGpu} from '../engine/mandelbulbGpu';
import {rasterDimensions} from '../engine/rasterDimensions';
export function bulbPresentation(settings:Settings):'raymarch'|'points'{const v=settings.bulbPresentation??'raymarch';if(v!=='raymarch'&&v!=='points')throw new Error('bulbPresentation 不支持选项 '+v);return v;}
function voxel(scene:SceneDocument,ctx:GenerateContext,c:BulbConfig,warnings:string[]):SceneOutput{
 const started=performance.now(),s=scene.settings,n=numberSetting(s,'bulbResolution',44,8,96),range=numberSetting(s,'bulbRange',1.3,.1,4);if(!Number.isInteger(n))throw new Error('bulbResolution 必须为整数');const mask=new Uint8Array(n**3),coord=(i:number)=>(i/(n-1)*2-1)*range;let samples=0,cancelled=false;
 for(let z=0;z<n;z++){if(ctx.isCancelled?.()){cancelled=true;break;}for(let y=0;y<n;y++)for(let x=0;x<n;x++){const d=bulbDistance([coord(x),coord(y),coord(z)],c);samples++;if(!d.escaped&&d.radius<=c.bailout)mask[(z*n+y)*n+x]=1;}}
 const positions:number[]=[],colors:number[]=[];if(!cancelled)for(let z=0;z<n;z++)for(let y=0;y<n;y++)for(let x=0;x<n;x++){const i=(z*n+y)*n+x;if(mask[i]&&(x===0||x===n-1||y===0||y===n-1||z===0||z===n-1||!mask[i-1]||!mask[i+1]||!mask[i-n]||!mask[i+n]||!mask[i-n*n]||!mask[i+n*n])){positions.push(coord(x),coord(y),coord(z));colors.push(...paletteColor(scene.palette,z/(n-1)));}}
 warnings.push('Mandelbulb 点云为共享纬度幂迭代的 CPU 体素边界采样；分辨率有限，不是等值面网格。');if(cancelled)warnings.push('计算已取消；不输出未完成体素域的伪边界。');return{type:'geometry',dimension:3,backend:'cpu',positions:new Float32Array(positions),colors:new Float32Array(colors),topology:'points',stats:{samples,generated:positions.length/3,invalid:0,elapsedMs:performance.now()-started},warnings};
}
export function generateMandelbulb(scene:SceneDocument,ctx:GenerateContext,base:FractalConfig):SceneOutput{
 const start=performance.now(),c=parseBulbConfig(scene,ctx.time,base),warnings:string[]=[];if(base.iterations>128)warnings.push('Mandelbulb 采用最多 128 次球幂迭代（与包内迭代上限一致）。');if(base.power[1]!==0)warnings.push('Mandelbulb 三维实幂仅使用指数实部，复指数虚部不适用。');
 if(bulbPresentation(scene.settings)==='points')return voxel(scene,ctx,c,warnings);
 const requested=scene.settings.fractalBackend??'auto';if(!['cpu','auto','webgl2'].includes(String(requested)))throw new Error('fractalBackend 不支持选项 '+requested);
 // GPU work is bounded by the pixel cap, loop limits and <=64-row strips.
 // A worst-case orbit estimate is not a measured preview cost; CPU retains
 // conservative work-based reduction because it executes every sample serially.
 const dimensionWarnings:string[]=[];const palette=bulbPalette(scene),cost=c.iterations*(c.steps+6+c.shadowSteps),make=(backend:'cpu'|'webgl2')=>{dimensionWarnings.length=0;const[width,height]=rasterDimensions(ctx,backend==='webgl2'?1:cost,backend,dimensionWarnings);return{width,height,config:c,palette};};
 let backend:'cpu'|'webgl2'='cpu',job=make(requested==='cpu'?'cpu':'webgl2'),result:ReturnType<typeof renderBulbCpu>;
 if(requested!=='cpu'){
  const gpu=mandelbulbGpu.render(job,ctx.isCancelled);
  if(gpu.pixels){backend='webgl2';result={pixels:gpu.pixels,samples:gpu.samples??0,cancelled:gpu.cancelled??false};}
  else{warnings.push(gpu.warning!);job=make('cpu');result=renderBulbCpu(job,ctx.isCancelled);}
 }else result=renderBulbCpu(job,ctx.isCancelled);
 warnings.push(...dimensionWarnings);
 if(result.cancelled)warnings.push('计算已取消；尚未计算的像素保持透明。');
 warnings.push(backend==='webgl2'?'真实 WebGL2 fragment 距离估计光线步进；float32 边界、法线和阴影可能与 CPU 双精度不同。':'CPU 双精度距离估计光线步进；高分辨率导出可能耗时较长，可取消。');
 warnings.push('独立光照与色带着色；未与原应用进行像素级外观比对。');
 return{type:'raster',cameraResolved:true,dimension:2,backend,width:job.width,height:job.height,pixels:result.pixels,stats:{samples:result.samples,generated:result.samples,invalid:0,elapsedMs:performance.now()-start},warnings};
}
const number=(key:string,label:string,min:number,max:number,step=.01):ControlSpec=>({key,label,group:'Mandelbulb 3D',type:'number',min,max,step});
export const bulbControls:ControlSpec[]=[
 {key:'bulbPresentation',label:'三维分形呈现',group:'Mandelbulb 3D',type:'select',options:[{value:'raymarch',label:'距离估计光线步进'},{value:'points',label:'体素边界点云'}]},
 number('bulbCameraRadius','摄影机半径',.01,1000),number('bulbCameraPitch','摄影机俯仰',-1.55,1.55),number('bulbCameraYaw','摄影机方位',-1e6,1e6),number('bulbRayScale','摄影机焦距比例',.1,10),
 number('bulbPhaseShift','幂映射相位',-1e6,1e6),number('bulbPhaseSpeed','相位速度',-100,100),number('bulbRotationSpeed','对象与摄影机旋转速度',-100,100),
 number('bulbSurfaceEpsilon','表面与法线精度',.00001,.1,.0001),number('bulbMarchSteps','光线最大步数',1,256,1),number('bulbShadowSteps','软阴影最大步数',0,96,1),number('bulbShadowStrength','软阴影强度',0,100,.1),
 number('bulbAmbient','环境光',0,5,.05),number('bulbDiffuse','漫反射',0,10,.05),number('bulbSpecular','高光强度',0,10,.05),number('bulbShininess','高光指数',1,256,1),number('bulbFog','距离雾',0,1,.001),number('bulbExposure','曝光',0,10,.05),
 number('bulbResolution','体素分辨率',8,96,1),number('bulbRange','体素采样半径',.1,4,.1),
];
export const bulbDefaults:Settings={bulbPresentation:'raymarch',bulbCameraRadius:3.2,bulbCameraPitch:.78,bulbCameraYaw:0,bulbRayScale:3,bulbPhaseShift:0,bulbPhaseSpeed:.05,bulbRotationSpeed:.05,bulbSurfaceEpsilon:.001,bulbMarchSteps:96,bulbShadowSteps:48,bulbShadowStrength:10,bulbAmbient:.45,bulbDiffuse:2.2,bulbSpecular:1.8,bulbShininess:20,bulbFog:.018,bulbExposure:1,bulbResolution:44,bulbRange:1.3};
export function visibleFractalControls(controls:ControlSpec[],settings:Settings):ControlSpec[]{
 if(settings.formula!=='mandelbulb_3d')return controls.filter(c=>!c.key.startsWith('bulb'));
 const common=new Set(['formula','power','iterations','bailout','rotation','gradientOffset','bulbPresentation','bulbPhaseShift','bulbPhaseSpeed','bulbRotationSpeed']);
 if(bulbPresentation(settings)==='points'){common.add('bulbResolution');common.add('bulbRange');return controls.filter(c=>common.has(c.key)).map(c=>c.key==='bailout'?{...c,min:.5}:c.key==='power'?{...c,min:2}:c);}
 for(const key of ['fractalBackend','zoom'])common.add(key);
 return controls.filter(c=>common.has(c.key)||(c.key.startsWith('bulb')&&!['bulbResolution','bulbRange'].includes(c.key))).map(c=>c.key==='bailout'?{...c,min:.5}:c.key==='power'?{...c,min:2}:c.key==='zoom'?{...c,min:.05,max:12}:c.key==='iterations'?{...c,max:128}:c);
}
