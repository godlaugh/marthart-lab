import {sourcePaletteRuntimeLut} from './sourcePaletteRuntime';
import type {Palette,SceneDocument,SceneOutput,Settings} from '../types';

export const SAMILA_SOURCE_SPLAT_MODEL='samila-splat-1.7.8' as const;
export type SourceSamilaSplatFacts=NonNullable<Extract<SceneOutput,{type:'raster'}>['samilaSplat']>;
const F=Math.fround,clamp=(v:number)=>Math.max(0,Math.min(1,v));
export function usesSourceSamilaSplat(scene:Pick<SceneDocument,'kind'|'settings'>):boolean{return scene.kind==='samila'&&scene.settings.samilaSplatModel===SAMILA_SOURCE_SPLAT_MODEL;}
export function sourceSamilaFloat(settings:Settings,key:string,fallback:number):number {
 const value=settings[key]??fallback;if(typeof value!=='number'||!Number.isFinite(value)||!Number.isFinite(F(value)))throw Error(`源 Samila ${key} 必须为有限 float32`);return F(value);
}
export function sourceSamilaUsesPaletteLut(settings:Settings,palette:Pick<Palette,'mode'>):boolean {const value=settings.samilaUsePaletteLut??true;if(typeof value!=='boolean')throw Error('源 Samila samilaUsePaletteLut 必须为布尔值');return value||palette.mode==='cosine';}
export function validateSourceSamilaSplat(scene:Pick<SceneDocument,'kind'|'settings'|'palette'>):void {
 const model=scene.settings.samilaSplatModel;if(model===undefined)return;
 if(!usesSourceSamilaSplat(scene))throw Error('源 Samila splat 版本或场景类型无效');
 if(scene.settings.samilaHistoryModel!=='bounded-v2'||scene.settings.densityToneModel!=='samila-normalized-v2')throw Error('源 Samila splat 需要 bounded-v2 历史和源归一调色');
 for(const key of ['normalizedBrightness','normalizedContrast','normalizedGamma','normalizedDynamicRange','normalizedSaturation'])if(scene.settings[key]!==undefined)sourceSamilaFloat(scene.settings,key,0);
 prepareSourceSamilaSplat(scene,{width:1,height:1,path:'points'});sourceSamilaDecay(scene.settings);sourceSamilaFloat(scene.settings,'alpha',.1);sourceSamilaFloat(scene.settings,'colorPhase',180);sourceSamilaUsesPaletteLut(scene.settings,scene.palette);sourceSamilaPaletteLut(scene.palette);
}
export function sourceSamilaDecay(settings:Settings):number {
 const accumulation=clamp(sourceSamilaFloat(settings,'accumulationDecay',1)),lifetime=sourceSamilaFloat(settings,'trailLifetime',4),show=settings.showTrails??true;
 if(typeof show!=='boolean')throw Error('源 Samila showTrails 必须为布尔值');
 const trail=!show||lifetime<=0?1:F(Math.max(.01,Math.min(1,Math.pow(.01,1/F(lifetime*60)))));
 return clamp(F(trail*accumulation));
}
export function prepareSourceSamilaSplat(scene:Pick<SceneDocument,'kind'|'settings'>,context:{width:number;height:number;primaryPixelHeight?:number;path:'points'|'quad'}):SourceSamilaSplatFacts|undefined {
 if(!usesSourceSamilaSplat(scene))return;
 if(scene.settings.iteratedMode!=='continuous'||scene.settings.samilaProjectionModel!=='source-ndc-v1')throw Error('源 Samila splat 需要持续批次与源 NDC');
 const primary=context.primaryPixelHeight??context.height;
 if(![context.width,context.height,primary].every(n=>Number.isInteger(n)&&n>0&&n<=16384))throw Error('源 Samila splat 尺寸或主画布高度无效');
 if(context.path!=='points'&&context.path!=='quad')throw Error('源 Samila splat 路径无效');
 const nominalRadius=F(sourceSamilaFloat(scene.settings,'samilaSpotSize',.01)*100),radius=F(nominalRadius*F(primary/1080));
 if(!Number.isFinite(radius)||!Number.isFinite(nominalRadius))throw Error('源 Samila splat 半径超出 float32');
 return{model:SAMILA_SOURCE_SPLAT_MODEL,referenceKind:context.primaryPixelHeight===undefined?'local-output':'primary',primaryPixelHeight:primary,nominalRadius,radius,path:context.path,encoding:'rgb-mass',noiseModel:'source-simplex-lut-256'};
}
/** Original SimplexNoise2D.noise PC0–563. Every Java float instruction rounds;
 * this CPU LUT is deliberately not computed by a GPU snoise approximation. */
export function sourceSamilaSimplexNoise(x:number,y:number):number {
 x=F(x);y=F(y);const skew=F(F(x+y)*F(.366025403784439)),i=F(Math.floor(F(x+skew))),j=F(Math.floor(F(y+skew))),unskew=F(F(i+j)*F(.211324865405187));
 const x0=F(F(x-i)+unskew),y0=F(F(y-j)+unskew),ix=x0>y0?1:0,iy=1-ix;
 const points=[[x0,y0],[F(F(x0+F(.211324865405187))-ix),F(F(y0+F(.211324865405187))-iy)],[F(x0+F(-.577350269189626)),F(y0+F(-.577350269189626))]];
 const mod=(v:number)=>F(v-F(F(Math.floor(F(v*F(1/289))))*289)),perm=(v:number)=>mod(F(F(F(v*34)+10)*v));
 const a=mod(i),b=mod(j),p=[perm(F(perm(b)+a)),perm(F(F(perm(F(b+iy))+a)+ix)),perm(F(F(perm(F(b+1))+a)+1))];
 const contributions=points.map(([px,py],index)=>{
  let m=Math.max(F(.5-F(F(px*px)+F(py*py))),0);m=F(m*m);m=F(m*m);
  const q=F(p[index]*F(1/41)),fraction=F(q-F(Math.floor(q))),gx=F(F(2*fraction)-1),h=F(Math.abs(gx)-.5),g=F(gx-F(Math.floor(F(gx+.5))));
  const norm=F(F(1.79284291400159)-F(F(.85373472095314)*F(F(g*g)+F(h*h))));m=F(m*norm);
  return F(m*F(F(g*px)+F(h*py)));
 });
 return F(130*F(F(contributions[0]+contributions[1])+contributions[2]));
}
let noise:Float32Array|undefined;
/** Shared immutable borrowed table: callers must not mutate or transfer it. */
export function sourceSamilaNoiseLut():Float32Array {
 if(!noise){const values=new Float32Array(256*256);for(let y=0;y<256;y++)for(let x=0;x<256;x++)values[y*256+x]=sourceSamilaSimplexNoise(F(F((x+.5)/256*2-1)*.5),F(F((y+.5)/256*2-1)*.5));noise=values;}return noise;
}
/** GL normalized LINEAR/CLAMP sampling, before amplitude and palette mapping. */
export function sourceSamilaPaletteCoordinate(ndcX:number,ndcY:number):number {
 const lut=sourceSamilaNoiseLut(),x=F(F(F(ndcX)*F(.1))+.5)*256-.5,y=F(F(F(ndcY)*F(.1))+.5)*256-.5;
 const ix=Math.floor(x),iy=Math.floor(y),tx=x-ix,ty=y-iy,at=(a:number,b:number)=>lut[Math.max(0,Math.min(255,b))*256+Math.max(0,Math.min(255,a))];
 const n=(at(ix,iy)*(1-tx)+at(ix+1,iy)*tx)*(1-ty)+(at(ix,iy+1)*(1-tx)+at(ix+1,iy+1)*tx)*ty;
 return clamp(F(F(F(n*.5)+F(.5*F(.85)))/F(.5*F(1.7))));
}
export function sourceSamilaPointDiameter(facts:SourceSamilaSplatFacts):number{return facts.path==='quad'?Math.max(F(facts.radius*F(.6)),F(.8)):Math.max(facts.radius,1);}
const smooth=(lo:number,hi:number,x:number)=>{const t=clamp((x-lo)/(hi-lo));return t*t*(3-2*t);};
/** Coordinates local to the unit source point/quad, not pixel distances. */
export function sourceSamilaSplatMass(facts:SourceSamilaSplatFacts,x:number,y:number,alpha:number):number {
 const dist=Math.hypot(x,y),r=facts.path==='quad'?1:Math.max(Math.min(facts.radius,1),F(.01));
 if(dist>(facts.path==='quad'?1.35:r))return 0;
 return facts.path==='quad'?(1-smooth(-.75,.75,(dist-1)*Math.max(sourceSamilaPointDiameter(facts)*.5,.4)))*Math.exp(-.45*(x*x+y*y))*alpha:(1-smooth(r*.75,r,dist))*alpha;
}

/** PaletteRuntime static/cosine branch, then Samila's literal 85-entry seam.
 * Local curve/HSV/nonuniform stops have no source counterpart in this profile. */
export function sourceSamilaPaletteLut(palette:Palette):Float32Array {
 if(!['linear','cosine'].includes(palette.mode)||palette.cycles!==1||palette.mode==='linear'&&(palette.positions!==undefined||palette.interpolation==='hsv'))throw Error('源 Samila 色板仅支持均匀 RGB 色标或余弦，cycles 必须为 1');
 const values=sourcePaletteRuntimeLut({colors:palette.stops,offset:palette.offset,gamma:1,space:'rgb',useCosine:palette.mode==='cosine',cosine:palette.cosine??{a:[.5,.5,.5],b:[.5,.5,.5],c:[1,1,1],d:[0,F(.333),F(.667)]}},undefined,[]);
 const delta=F(F(Math.abs(F(values[0]-values[3069]))+Math.abs(F(values[1]-values[3070])))+Math.abs(F(values[2]-values[3071])));
 if(delta>=F(.02)){for(let i=0;i<85;i++){const at=(1023-i)*3,t=F((i+1)/86),e=F(F(t*t)*F(3-F(2*t)));for(let c=0;c<3;c++)values[at+c]=F(F(values[at+c]*F(1-e))+F(values[c]*e));}values.set(values.subarray(0,3),3069);}
 return values;
}
/** GL LINEAR + REPEAT-S texel-center interpolation. */
export function sampleSourceSamilaPalette(lut:Float32Array,u:number):[number,number,number] {
 const x=u*1024-.5,i=Math.floor(x),t=x-i,a=((i%1024)+1024)%1024,b=(a+1)%1024;
 return[0,1,2].map(c=>lut[a*3+c]*(1-t)+lut[b*3+c]*t) as [number,number,number];
}

export function sourceSamilaFallbackColor(u:number,phase:number):[number,number,number] {return[0,1/3,2/3].map(offset=>.5+.5*Math.cos(2*Math.PI*(u-offset)-phase)) as [number,number,number];}
