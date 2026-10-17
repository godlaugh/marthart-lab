import type {ControlSpec,GenerateContext,Palette,SceneDocument,SceneOutput,Settings} from '../types';
import {finite,numberSetting,random} from '../engine/expression';
import {hexRGB,paletteColor,validatePalette} from '../engine/palette';
import {createNoise} from './noise';
import {perlinParticleControls} from './perlinParticles';
import {perlinGpu,type PerlinTextureJob} from '../engine/perlinGpu';

type Point=[number,number];
const TAU=Math.PI*2,clamp=(x:number,lo=0,hi=1)=>Math.max(lo,Math.min(hi,x)),wrap=(x:number)=>x-Math.floor(x);
const integer=(s:Settings,k:string,f:number,lo:number,hi:number)=>{const n=numberSetting(s,k,f,lo,hi);if(!Number.isInteger(n))throw new Error(`${k} 必须是整数`);return n;};
function choice(s:Settings,k:string,f:string,choices:readonly string[]){const value=String(s[k]??f);if(!choices.includes(value))throw new Error(`${k} 不支持 ${value}`);return value;}
function checkedSeed(seed:number){if(!Number.isInteger(seed)||seed<0||seed>0xffffffff)throw new Error('噪声种子须为 32 位非负整数');return seed;}
const seedOf=(s:Settings)=>integer(s,'seed',42,0,0xffffffff);
export const PERLIN_TEXTURES=['fiber','streak','silk','water','flame','mist'] as const;
export type PerlinTexture=typeof PERLIN_TEXTURES[number];
const number=(key:string,label:string,min:number,max:number,step:number,group='噪声模式'):ControlSpec=>({key,label,type:'number',min,max,step,group});
const select=(key:string,label:string,values:[string,string][],group='噪声模式'):ControlSpec=>({key,label,type:'select',options:values.map(([value,label])=>({value,label})),group});
export const perlinAdvancedControls:ControlSpec[]=[
 select('angleMap','角度映射',[['linear','线性'],['soft-power','柔和幂']]),number('noiseOffset','噪声相位偏移',-10000,10000,.01),
 number('curveCount','曲线数',1,20000,10,'曲线'),number('curveLength','每条点数',2,2000,1,'曲线'),number('curveStepSize','曲线步长',.001,100,.1,'曲线'),number('curveAlpha','曲线透明度',0,1,.01,'曲线'),number('curveLineWidth','曲线宽度 · 像素',.1,32,.1,'曲线'),number('curveDomainWidth','空间宽度',1,10000,10,'曲线'),number('curveDomainHeight','空间高度',1,10000,10,'曲线'),number('fieldCellSize','角度网格边长',1,500,1,'曲线'),number('curveNoiseScale','曲线噪声频率',0,100,.01,'曲线'),number('curveNoiseOctaves','曲线噪声层数',1,8,1,'曲线'),number('curveNoiseOffset','曲线噪声相位',-10000,10000,.01,'曲线'),number('curveAngleScale','曲线角度范围',0,100,.1,'曲线'),select('curveSampling','起点采样',[['jittered-grid','抖动网格'],['random','均匀随机']],'曲线'),select('curveColor','曲线颜色',[['index','曲线顺序'],['position','起点位置'],['noise','起点噪声'],['seed-space','空间色圆']],'曲线'),number('seedSpaceCircleCount','空间色圆数量',0,500,1,'空间配色'),number('seedSpaceMinRadius','色圆最小半径',0,10000,1,'空间配色'),number('seedSpaceMaxRadius','色圆最大半径',0,10000,1,'空间配色'),
 select('perlinBackend','纹理计算后端',[['cpu','CPU'],['auto','自动 · GPU 不可用时回退'],['webgl2','WebGL2 · 显式回退提示']],'纹理'),select('textureStyle','纹理风格',PERLIN_TEXTURES.map((value,i)=>[value,['纤维','条纹','丝绸','水波','火焰','迷雾'][i]]),'纹理'),number('textureFrequency','纹理流场频率',.01,100,.05,'纹理'),number('warpAmplitude','域扭曲幅度',0,10,.01,'纹理'),number('warpFrequency','域扭曲频率',0,100,.05,'纹理'),number('directionOffset','方向角偏移',-10000,10000,.05,'纹理'),number('textureTimeSpeed','纹理演化速度',-10,10,.05,'纹理'),number('marchSteps','沿场采样步数',1,128,1,'纹理'),number('marchStepSize','沿场步长',.0001,.5,.001,'纹理'),number('textureBrightness','纹理亮度',0,10,.05,'纹理'),number('vignettePower','暗角强度',0,5,.01,'纹理'),number('fiberStrength','细节混合',0,1,.01,'纹理')
];
export const perlinAdvancedDefaults:Settings={angleMap:'linear',noiseOffset:0,curveCount:1200,curveLength:70,curveStepSize:2,curveAlpha:.35,curveLineWidth:.7,curveDomainWidth:800,curveDomainHeight:800,fieldCellSize:20,curveNoiseScale:1.2,curveNoiseOctaves:2,curveNoiseOffset:0,curveAngleScale:4,curveSampling:'jittered-grid',curveColor:'seed-space',seedSpaceCircleCount:50,seedSpaceMinRadius:30,seedSpaceMaxRadius:40,perlinBackend:'cpu',textureStyle:'fiber',textureFrequency:1.5,warpAmplitude:.1,warpFrequency:2,directionOffset:0,textureTimeSpeed:1,marchSteps:32,marchStepSize:.008,textureBrightness:1.7,vignettePower:.1,fiberStrength:.7};
const streamKeys=new Set(['flow','count','steps','span','noiseScale','octaves','persistence','stepSize','timeSpeed','colorMetric','angleMap','noiseOffset']);
const curveKeys=new Set(perlinAdvancedControls.filter(c=>c.group==='曲线'||c.group==='空间配色').map(c=>c.key));
const textureKeys=new Set(perlinAdvancedControls.filter(c=>c.group==='纹理').map(c=>c.key));
/** The owning mode boundary is shared by the generic editor; no unsupported controls are shown. */
export function visiblePerlinControls(controls:ControlSpec[],settings:Settings):ControlSpec[]{
 const style=choice(settings,'style','streams',['streams','particles','continuous','field-curves','filament','water']);
 if(style==='continuous'){const keys=new Set([...perlinParticleControls.map(c=>c.key),'style','seed','flow','angleMap','noiseScale','octaves','persistence','timeSpeed','noiseOffset']);const display=String(settings.particleDisplay??'accumulation');return controls.filter(c=>keys.has(c.key)&&!(c.key==='angleMap'&&settings.flow==='curl')&&!(c.key==='respawnRate'&&settings.respawnEveryStep===true)&&!(['accumulationFade','particleRadius','particleExposure'].includes(c.key)&&display!=='accumulation')&&!(['trailLifetime','trailStride','fadeTrails'].includes(c.key)&&display!=='trails')&&!(c.key==='recordTrails'&&display==='heads')).map(c=>c.key==='noiseScale'?{...c,min:0}:c);}
 const active=style==='field-curves'?curveKeys:style==='filament'||style==='water'?textureKeys:streamKeys;
 return controls.filter(c=>c.key==='style'||c.key==='seed'||active.has(c.key)&&(!(c.group==='空间配色')||settings.curveColor==='seed-space')&&!(c.key==='angleMap'&&settings.flow==='curl'));
}

function fbm(noise:(x:number,y:number,z?:number)=>number,x:number,y:number,z:number,octaves:number){let v=0,a=1,weight=0;for(let i=0;i<octaves;i++){v+=a*noise(x,y,z);weight+=a;a*=.5;x*=2;y*=2;}return v/weight;}
/** Independent procedural textures; named families follow documented morphology, not proprietary shader pixel values. */
export function createPerlinTexture(style:PerlinTexture,seed:number):(x:number,y:number)=>number {
 if(!PERLIN_TEXTURES.includes(style))throw new Error('未知噪声纹理');const n=createNoise(checkedSeed(seed)),unit=(x:number,y:number,z=0)=>clamp(.5+.5*n(x,y,z));
 return(x,y)=>{finite(x,'纹理 x');finite(y,'纹理 y');let value:number;
  switch(style){
   case 'fiber':value=.42*unit(3*x,3*y)+.28*unit(9*x,9*y,.4)+.22*(1-Math.abs(2*unit(2*x,35*y,.7)-1))+.08*unit(45*x,45*y,1.1);break;
   case 'streak':{const warp=unit(4*x,3*y);value=.35*warp+.3*unit(2*x,14*y,.5)+.35*(.5+.5*Math.sin(TAU*(18*y+warp)))**3;break;}
   case 'silk':{const fold=unit(2*x+.5*Math.sin(TAU*y),9*y,.2),sheen=.5+.5*Math.cos(TAU*(5*x+fold));value=.65*fold+.35*sheen**2;break;}
   case 'water':{const radius=Math.hypot(x-.5,y-.5),ripple=.5+.5*Math.sin(36*radius+5*n(5*x,5*y,.1));value=.6*ripple+.4*unit(10*x,10*y,.8);break;}
   case 'flame':{const turbulence=fbm(n,5*x,9*y,.7,3),plume=.5+.5*Math.sin(TAU*(3*x+1.2*turbulence-y));value=clamp(.5*unit(3*x,8*y)+.2*unit(12*x,12*y,.9)+.3*plume**2);break;}
   case 'mist':value=.55*unit(2*x,2*y,.1)+.3*unit(7*x,7*y,.5)+.15*unit(18*x,18*y,1);break;
  }return clamp(value);
 };
}

export interface PerlinCurve {points:Float64Array;color:[number,number,number];seed:Point;}
export interface PerlinCurveSet {curves:PerlinCurve[];width:number;height:number;alpha:number;lineWidth:number;samples:number;cancelled:boolean;}
/** Curves integrate both directions from one seed; direction interpolation follows the shortest angular arc. */
export function buildPerlinFieldCurves(settings:Settings,palette:Palette,time=0,isCancelled?:()=>boolean):PerlinCurveSet {
 finite(time,'曲线时间');validatePalette(palette);const seed=seedOf(settings),r=random(seed),noise=createNoise(seed),width=numberSetting(settings,'curveDomainWidth',800,1,10000),height=numberSetting(settings,'curveDomainHeight',800,1,10000),count=integer(settings,'curveCount',1200,1,20000),length=integer(settings,'curveLength',70,2,2000),step=numberSetting(settings,'curveStepSize',2,.001,100),alpha=numberSetting(settings,'curveAlpha',.35,0,1),lineWidth=numberSetting(settings,'curveLineWidth',.7,.1,32),cell=integer(settings,'fieldCellSize',20,1,500),frequency=numberSetting(settings,'curveNoiseScale',1.2,0,100),octaves=integer(settings,'curveNoiseOctaves',2,1,8),offset=numberSetting(settings,'curveNoiseOffset',0,-10000,10000)+numberSetting(settings,'noiseOffset',0,-10000,10000),angleScale=numberSetting(settings,'curveAngleScale',4,0,100),sampling=choice(settings,'curveSampling','jittered-grid',['random','jittered-grid']),colorMode=choice(settings,'curveColor','seed-space',['index','position','noise','seed-space']);
 if(count*length>2000000)throw new Error('曲线工作量超过 200 万点；请减少曲线数或长度');
 const nx=Math.max(2,Math.round(width/cell)+1),ny=Math.max(2,Math.round(height/cell)+1);if(nx*ny>2000000)throw new Error('角度网格超过 200 万格；请增大网格边长');
 const angles=new Float64Array(nx*ny);for(let j=0;j<ny;j++){if(isCancelled?.())return{curves:[],width,height,alpha,lineWidth,samples:0,cancelled:true};for(let i=0;i<nx;i++)angles[j*nx+i]=(fbm(noise,i/(nx-1)*frequency,j/(ny-1)*frequency,0,octaves)+offset)*Math.PI*.7*angleScale;}
 const angleLerp=(a:number,b:number,t:number)=>a+(wrap((b-a)/TAU+.5)-.5)*TAU*t;
 const angle=(x:number,y:number)=>{const xx=clamp(x/width)*(nx-1),yy=clamp(y/height)*(ny-1),i=Math.min(nx-2,Math.floor(xx)),j=Math.min(ny-2,Math.floor(yy)),tx=xx-i,ty=yy-j;return angleLerp(angleLerp(angles[j*nx+i],angles[j*nx+i+1],tx),angleLerp(angles[(j+1)*nx+i],angles[(j+1)*nx+i+1],tx),ty);};
 const blobs:{x:number;y:number;radius:number;color:[number,number,number]}[]=[];
 if(colorMode==='seed-space'){const n=integer(settings,'seedSpaceCircleCount',50,0,500),lo=numberSetting(settings,'seedSpaceMinRadius',30,0,10000),hi=numberSetting(settings,'seedSpaceMaxRadius',40,0,10000);if(hi<lo)throw new Error('空间色圆最大半径小于最小半径');const colors=random(seed^0x9e3779b9);for(let i=0;i<n;i++)blobs.push({x:colors()*width,y:colors()*height,radius:lo+colors()*(hi-lo),color:paletteColor(palette,colors())});}
 const curves:PerlinCurve[]=[],cols=Math.max(1,Math.ceil(Math.sqrt(count*width/height))),rows=Math.ceil(count/cols);let samples=0,cancelled=false;
 for(let i=0;i<count;i++){
  if(isCancelled?.()){cancelled=true;break;}
  const x=sampling==='random'?r()*width:(i%cols+.18+.64*r())*width/cols,y=sampling==='random'?r()*height:(Math.floor(i/cols)+.18+.64*r())*height/rows;
  let color=paletteColor(palette,colorMode==='index'?i/count:colorMode==='noise'?clamp(.5+.5*fbm(noise,x/width*frequency,y/height*frequency,0,octaves)):.65*x/width+.35*y/height);
  if(colorMode==='seed-space'){for(const b of blobs){const distance=Math.hypot(x-b.x,y-b.y);if(b.radius>0&&distance<b.radius){const f=(1-distance/b.radius)**3;color=color.map((v,k)=>v+(b.color[k]-v)*f) as [number,number,number];}}}
  const points=new Float64Array(length*2),mid=Math.floor(length/2);points[mid*2]=x-width/2;points[mid*2+1]=y-height/2;samples++;
  for(const direction of [-1,1]){let px=x,py=y;for(let j=mid+direction;j>=0&&j<length;j+=direction){const a=angle(px,py);px+=direction*step*Math.cos(a);py+=direction*step*Math.sin(a);points[j*2]=px-width/2;points[j*2+1]=py-height/2;samples++;}}
  curves.push({points,color,seed:[x,y]});
 }
 return{curves,width,height,alpha,lineWidth,samples,cancelled};
}

function rasterDimensions(c:GenerateContext):[number,number]{if(!Number.isInteger(c.width)||!Number.isInteger(c.height)||c.width<1||c.height<1||c.width*c.height>16777216)throw new Error('噪声图像尺寸须为正整数且不超过 16777216 像素');finite(c.time,'噪声时间');return[c.width,c.height];}
function background(s:Settings):[number,number,number]{const color=String(s.background??'#080b12');if(!/^#[\da-f]{6}$/i.test(color))throw new Error('背景颜色必须为 #RRGGBB');return hexRGB(color);}
function transforms(s:Settings){const scale=numberSetting(s,'scale',1),sx=scale*numberSetting(s,'scaleX',1),sy=scale*numberSetting(s,'scaleY',1),angle=numberSetting(s,'rotateZ',0),co=Math.cos(angle),si=Math.sin(angle),ox=numberSetting(s,'offsetX',0),oy=numberSetting(s,'offsetY',0);finite(sx,'派生 X 缩放');finite(sy,'派生 Y 缩放');return{sx,sy,co,si,ox,oy};}
function renderFieldCurves(scene:SceneDocument,c:GenerateContext):SceneOutput {
 const start=performance.now(),[width,height]=rasterDimensions(c),data=buildPerlinFieldCurves(scene.settings,scene.palette,c.time,c.isCancelled),pixels=new Uint8ClampedArray(width*height*4),bg=background(scene.settings),transparent=scene.settings.transparentBackground===true;
 if(!transparent)for(let i=0;i<pixels.length;i+=4){for(let k=0;k<3;k++)pixels[i+k]=Math.round(bg[k]*255);pixels[i+3]=255;}
 const transform=transforms(scene.settings),unit=Math.min(width/data.width,height/data.height),project=(x:number,y:number):Point=>[width/2+(x*transform.sx*transform.co-y*transform.sy*transform.si+transform.ox)*unit,height/2-(x*transform.sx*transform.si+y*transform.sy*transform.co+transform.oy)*unit];let visits=0,segments=0,cancelled=data.cancelled;
 outer:for(const curve of data.curves){if(c.isCancelled?.()){cancelled=true;break;}for(let j=1;j<curve.points.length/2;j++){
  const a=project(curve.points[(j-1)*2],curve.points[(j-1)*2+1]),b=project(curve.points[j*2],curve.points[j*2+1]),radius=data.lineWidth/2,dx=b[0]-a[0],dy=b[1]-a[1],length2=dx*dx+dy*dy;
  if(![...a,...b,length2].every(Number.isFinite))throw new Error('噪声曲线空间变换超出有限范围');
  const x0=Math.max(0,Math.floor(Math.min(a[0],b[0])-radius-.5)),x1=Math.min(width-1,Math.ceil(Math.max(a[0],b[0])+radius+.5)),y0=Math.max(0,Math.floor(Math.min(a[1],b[1])-radius-.5)),y1=Math.min(height-1,Math.ceil(Math.max(a[1],b[1])+radius+.5));
  visits+=Math.max(0,x1-x0+1)*Math.max(0,y1-y0+1);if(visits>120000000)throw new Error('曲线栅格工作超过 1.2 亿像素测试；请减少曲线、线宽或图像尺寸');
  if((segments&1023)===0&&c.isCancelled?.()){cancelled=true;break outer;}
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const f=length2===0?0:clamp(((x+.5-a[0])*dx+(y+.5-a[1])*dy)/length2),distance=Math.hypot(x+.5-a[0]-f*dx,y+.5-a[1]-f*dy),alpha=clamp(radius+.5-distance,0,Math.min(1,data.lineWidth))*data.alpha;if(alpha<=0)continue;const i=(y*width+x)*4,old=pixels[i+3]/255,total=alpha+old*(1-alpha);for(let k=0;k<3;k++)pixels[i+k]=Math.round((curve.color[k]*alpha+pixels[i+k]/255*old*(1-alpha))/total*255);pixels[i+3]=Math.round(total*255);}segments++;
 }}
 return{type:'raster',backend:'cpu',dimension:2,width,height,pixels,stats:{samples:data.samples,generated:segments,invalid:0,elapsedMs:performance.now()-start},...(cancelled?{warnings:['曲线生成已取消；保留已完成的部分。']}:{})};
}

// Immutable bounded caches: texture data depends only on seed/style; flow grids include every field/time input.
// At most four texture grids and two vector fields are retained per worker/module lifetime.
const textureCache=new Map<string,Float32Array>(),flowCache=new Map<string,{x:Float32Array;y:Float32Array}>();
function retain<T>(cache:Map<string,T>,key:string,value:T,limit:number):void {cache.delete(key);cache.set(key,value);while(cache.size>limit)cache.delete(cache.keys().next().value!);}
/** Shared parsed field grids feed independent CPU or WebGL2 streamline integration. */
export function generateAdvancedPerlin(scene:SceneDocument,c:GenerateContext):SceneOutput {
 const style=choice(scene.settings,'style','filament',['field-curves','filament','water']);if(style==='field-curves')return renderFieldCurves(scene,c);
 const start=performance.now(),[width,height]=rasterDimensions(c),s=scene.settings,seed=seedOf(s),textureStyle=choice(s,'textureStyle','fiber',PERLIN_TEXTURES) as PerlinTexture,steps=integer(s,'marchSteps',32,1,128),step=numberSetting(s,'marchStepSize',.008,.0001,.5),frequency=numberSetting(s,'textureFrequency',1.5,.01,100),warpAmplitude=numberSetting(s,'warpAmplitude',.1,0,10),warpFrequency=numberSetting(s,'warpFrequency',2,0,100),direction=numberSetting(s,'directionOffset',0,-10000,10000),t=c.time*numberSetting(s,'textureTimeSpeed',1,-10,10),brightness=numberSetting(s,'textureBrightness',1.7,0,10),vignette=numberSetting(s,'vignettePower',.1,0,5),fiber=numberSetting(s,'fiberStrength',.7,0,1),palette=validatePalette(scene.palette),bg=background(s),transparent=s.transparentBackground===true;
 finite(t,'派生噪声时间');const backend=choice(s,'perlinBackend','cpu',['cpu','auto','webgl2']);
 const transform=transforms(s);if(Math.abs(transform.sx)<1e-12||Math.abs(transform.sy)<1e-12)throw new Error('纹理空间缩放不能为零');
 for(const px of [0,width-1])for(const py of [0,height-1]){const x=(2*(px+.5)-width)/height-transform.ox,y=(height-2*(py+.5))/height-transform.oy;finite((x*transform.co+y*transform.si)/transform.sx,'纹理视口 X');finite((-x*transform.si+y*transform.co)/transform.sy,'纹理视口 Y');}
 const noise=createNoise(seed),N=128,extent=8,textureKey=seed+':'+textureStyle,flowKey=JSON.stringify([style,seed,frequency,warpAmplitude,warpFrequency,direction,t]);
 let values=textureCache.get(textureKey),field=flowCache.get(flowKey),cancelled=false;
 if(!values){const table=new Float32Array(N*N),texture=createPerlinTexture(textureStyle,seed);for(let j=0;j<N;j++){if(c.isCancelled?.()){cancelled=true;break;}for(let i=0;i<N;i++)table[j*N+i]=texture(i/N,j/N);}values=table;if(!cancelled)retain(textureCache,textureKey,table,4);}
 if(!field){const flowX=new Float32Array(N*N),flowY=new Float32Array(N*N),potential=(x:number,y:number)=>fbm(noise,x,y,t*.15,3),h=.002,co=Math.cos(direction),si=Math.sin(direction);
  if(!cancelled)for(let j=0;j<N;j++){if(c.isCancelled?.()){cancelled=true;break;}for(let i=0;i<N;i++){
   let x=(i/N-.5)*extent,y=(j/N-.5)*extent;const qx=x*co-y*si,qy=x*si+y*co;x=(qx+warpAmplitude*Math.sin(warpFrequency*qy+t))*frequency;y=(qy+warpAmplitude*Math.sin(warpFrequency*qx-t))*frequency;
   let dx:number,dy:number;if(style==='water'){dx=(potential(x,y+h)-potential(x,y-h))/(2*h);dy=-(potential(x+h,y)-potential(x-h,y))/(2*h);const norm=Math.hypot(dx,dy)||1;dx/=norm;dy/=norm;}else{const angle=TAU*noise(x,y,t*.1)+direction+t*.1;dx=Math.cos(angle);dy=Math.sin(angle);}flowX[j*N+i]=dx;flowY[j*N+i]=dy;
  }}field={x:flowX,y:flowY};if(!cancelled)retain(flowCache,flowKey,field,2);
 }
 const flowX=field.x,flowY=field.y;
 const bilinear=(v:Float32Array,x:number,y:number)=>{const px=wrap(x)*N,py=wrap(y)*N,ix=Math.floor(px),iy=Math.floor(py),i=ix%N,j=iy%N,a=px-ix,b=py-iy,i1=(i+1)%N,j1=(j+1)%N;return(v[j*N+i]*(1-a)+v[j*N+i1]*a)*(1-b)+(v[j1*N+i]*(1-a)+v[j1*N+i1]*a)*b;};
 const paletteLut=new Float32Array(1024*3);for(let i=0;i<1024;i++)paletteLut.set(paletteColor(palette,i/1024),i*3);
 const job:PerlinTextureJob={width,height,style:style as 'filament'|'water',steps,step,time:t,brightness,vignette,fiber,transform,values,flowX,flowY,palette:paletteLut,background:bg,transparent};
 const warnings:string[]=[];
 if(backend!=='cpu'&&!cancelled&&!c.isCancelled?.()){
  const result=perlinGpu.render(job,c.isCancelled);
  if(result.pixels)return{type:'raster',backend:'webgl2',dimension:2,width,height,pixels:result.pixels,stats:{samples:width*height*steps,generated:width*height,invalid:0,elapsedMs:performance.now()-start},warnings:['WebGL2 沿场纹理积分；共享 CPU 生成的噪声/流场网格及色板，GPU 使用 float32，未声称原版着色器逐像素等效。']};
  if(result.warning)warnings.push(result.warning);
 }
 const pixels=new Uint8ClampedArray(width*height*4);
 let samples=0,generated=0;
 if(!cancelled)outer:for(let py=0;py<height;py++){if(c.isCancelled?.()){cancelled=true;break;}for(let px=0;px<width;px++){
  const worldX=(2*(px+.5)-width)/height-transform.ox,worldY=(height-2*(py+.5))/height-transform.oy;let x=(worldX*transform.co+worldY*transform.si)/transform.sx,y=(-worldX*transform.si+worldY*transform.co)/transform.sy;let total=0,weights=0;
  for(let j=0;j<steps;j++){const dx=bilinear(flowX,x/extent+.5,y/extent+.5),dy=bilinear(flowY,x/extent+.5,y/extent+.5),normal=Math.hypot(dx,dy)||1;x+=step*dx/normal;y+=step*dy/normal;const u=x*.5+.5+t*(style==='water'?.025:.008),v=y*.5+.5,weight=style==='water'?1:Math.sin(Math.PI*(j+.5)/steps);total+=bilinear(values,u,v)*weight;weights+=weight;samples++;}
  const tone=clamp(total/weights),coord=clamp((1-fiber)*(.5+.25*Math.sin(x))+fiber*tone),index=Math.min(1023,Math.floor(coord*1024))*3,edge=Math.max(0,16*(px+.5)/width*(1-(px+.5)/width)*(py+.5)/height*(1-(py+.5)/height)),light=brightness*Math.pow(edge,vignette)*(.35+.65*tone),alpha=clamp(light),i=(py*width+px)*4;
  for(let k=0;k<3;k++){const rgb=clamp(paletteLut[index+k]*Math.min(light,1));pixels[i+k]=Math.round((transparent?rgb:rgb*alpha+bg[k]*(1-alpha))*255);}pixels[i+3]=transparent?Math.round(alpha*255):255;generated++;
  if((generated&4095)===0&&c.isCancelled?.()){cancelled=true;break outer;}
 }}
 warnings.push('CPU 沿场纹理积分；噪声、曲线卷积和水流平流为独立实现，未声称原版 GPU 像素等效。');if(cancelled)warnings.push('纹理生成已取消；保留已完成的像素。');
 return{type:'raster',backend:'cpu',dimension:2,width,height,pixels,stats:{samples,generated,invalid:0,elapsedMs:performance.now()-start},warnings};
}
