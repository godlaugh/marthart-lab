import {parseSourcePerlinCpuDocument,type SourcePerlinCpuDocumentPayload} from './sourcePerlinCpuDocument';
import {SourcePerlinParticleMotion} from './sourcePerlinParticleMotion';
import {SourcePerlinParticleColors} from './sourcePerlinParticleColors';
import {SourcePerlinParticleTrails} from './sourcePerlinParticleTrails';
import {SourcePerlinColorRuntime} from './sourcePerlinColorRuntime';
import {SourcePerlinParameterRuntime,type SourcePerlinParameterValues,type SourcePerlinFieldEffect} from './sourcePerlinParameterRuntime';
import type {SourcePerlinParameterAction} from './sourcePerlinParameterConfig';
import type {SourceGradientAction} from './sourceGradientRuntime';
import {SourceProcessingNoise} from './sourceProcessingNoise';
import {sourcePerlinSeed} from './sourcePerlinSeed';
import {SourcePerlinAngleField} from './sourcePerlinAngleField';
import {SourcePerlinCurveGeometry,sourcePerlinCurveDimensions} from './sourcePerlinCurveGeometry';
import {SourcePerlinCurveColors} from './sourcePerlinCurveColors';
import {SourcePerlinCurveDisplay} from './sourcePerlinCurveDisplay';
import {SourcePerlinCpuTarget,type SourcePerlinCpuPrimitive} from './sourcePerlinCpuTarget';
import {prepareSourcePerlinCpuDisplay} from './sourcePerlinDisplay';
import {sourceProcessingRoundPointBuffers} from './sourceProcessingPoints';
import {sourceProcessingOpenStrokeBuffers} from './sourceProcessingStroke';
import {sourcePerlinPointRgba} from './sourcePerlinPointColors';
import {sourcePerlinBackgroundRgba} from './sourcePerlinBackground';
const F=Math.fround;
export class SourcePerlinCpuModelError extends Error{
 constructor(readonly code:'input'|'capacity'|'cancelled'|'failed'|'disposed',message:string){super(message);this.name=code==='cancelled'?'AbortError':'SourcePerlinCpuModelError';}
}
export interface SourcePerlinCpuModelOptions{
 readonly config:SourcePerlinCpuDocumentPayload;
 /** Actual primary PApplet dimensions, independent of export/preview size. */
 readonly sourceWidth:number;readonly sourceHeight:number;
 /** Actual selected local sample count; not a claim about native smooth(4). */
 readonly curveCacheSamples:0|2|4|8;
 readonly isCancelled?:()=>boolean;
 /** Caller-owned cumulative replay budget; throws before admitted work. */
 readonly reserve?:(units:number)=>void;
}
export interface SourcePerlinCpuModelDraw{
 readonly target:SourcePerlinCpuTarget;readonly kind:'primary'|'offscreen';readonly sourcePixelDensity:number;
}
/** PerlinNoiseField's CPU lifecycle. Queue interpolation precedes update;
 * update advances colors before parameter drifts, then motion/history or dirty
 * fixed-seed geometry. draw handles Scene background on every invocation, even
 * without update. The caller owns output targets and their initial contents. */
export class SourcePerlinCpuModel{
 private readonly config:SourcePerlinCpuDocumentPayload;
 private readonly sourceWidth:number;private readonly sourceHeight:number;
 private readonly isCancelled?:()=>boolean;private readonly reserve?:(units:number)=>void;
 private readonly colors:SourcePerlinColorRuntime;
 private readonly parameters:SourcePerlinParameterRuntime;
 private readonly noise:SourceProcessingNoise;
 private readonly textureSeed:number;
 private readonly motion?:SourcePerlinParticleMotion;
 private readonly particleColors?:SourcePerlinParticleColors;
 private readonly trails?:SourcePerlinParticleTrails;
 private readonly geometry?:SourcePerlinCurveGeometry;
 private readonly curveColors?:SourcePerlinCurveColors;
 private readonly curveDisplay?:SourcePerlinCurveDisplay;
 private angleField?:SourcePerlinAngleField;
 private seedXs?:Float32Array;private seedYs?:Float32Array;private curvePacked?:Uint32Array;
 private geometryDirty=false;private geometryBuilds=0;private colorRefreshes=0;private drawingSnapshots=0;
 private showTrails:boolean;private time=0;private updates=0;private draws=0;
 private failed=false;private disposed=false;
 constructor(options:SourcePerlinCpuModelOptions){
  if(!options||typeof options!=='object')throw new SourcePerlinCpuModelError('input','Missing Perlin CPU model configuration.');
  for(const n of [options.sourceWidth,options.sourceHeight])if(!Number.isInteger(n)||n<0||n>2147483647)throw new SourcePerlinCpuModelError('input','Perlin primary dimensions require nonnegative Java integers.');
  if(options.reserve!==undefined&&typeof options.reserve!=='function')throw new SourcePerlinCpuModelError('input','Perlin work reserve must be a function.');
  if(options.isCancelled!==undefined&&typeof options.isCancelled!=='function')throw new SourcePerlinCpuModelError('input','Perlin cancellation must be a function.');
  if(![0,2,4,8].includes(options.curveCacheSamples))throw new SourcePerlinCpuModelError('input','Perlin curve-cache samples must be an actual supported count.');
  const parsed=parseSourcePerlinCpuDocument(options.config);if(!parsed.ok)throw new SourcePerlinCpuModelError(parsed.error.kind==='capacity'?'capacity':'input',`Perlin ${parsed.error.path.join('.')}: ${parsed.error.reason}`);
  this.config=parsed.value;for(const value of Object.values(this.config))if(value&&typeof value==='object')Object.freeze(value);Object.freeze(this.config);
  this.sourceWidth=options.sourceWidth;this.sourceHeight=options.sourceHeight;this.isCancelled=options.isCancelled;this.reserve=options.reserve;this.check();
  const c=this.config;this.showTrails=c.display.showTrails;this.textureSeed=sourcePerlinSeed(c.seed).textureSeed;this.noise=new SourceProcessingNoise(BigInt(this.textureSeed));
  if(c.cpuStyle==='particles'){
   this.spend(c.particles.count);this.particleColors=new SourcePerlinParticleColors({count:c.particles.count,palette:c.palette,isCancelled:this.isCancelled});this.colors=this.particleColors.runtime;
   this.motion=new SourcePerlinParticleMotion({seed:c.seed,count:c.particles.count,width:this.sourceWidth,height:this.sourceHeight,noise:this.noise,isCancelled:this.isCancelled});
   this.trails=new SourcePerlinParticleTrails({motion:this.motion,packedColors:this.particleColors.packed,lifetime:c.display.trailLifetime,fade:c.display.fadeTrails,accumulation:c.display.accumulation,isCancelled:this.isCancelled});
  }else{
   this.colors=new SourcePerlinColorRuntime({palette:c.palette,isCancelled:this.isCancelled,onRefresh:sample=>this.refreshCurveColors(sample)});
   const dimensions=sourcePerlinCurveDimensions(this.sourceWidth,this.sourceHeight);this.angleField=this.buildAngle(c.parameters);
   this.curveColors=new SourcePerlinCurveColors({seed:c.seed,...dimensions,seedSpaceCircleCount:c.curves.seedCircleCount,minRadius:c.curves.seedMinRadius,maxRadius:c.curves.seedMaxRadius,colors:this.colors,noise:this.noise,isCancelled:this.isCancelled});
   this.spend(c.curves.count*c.curves.length);this.geometry=new SourcePerlinCurveGeometry({seed:c.seed,count:c.curves.count,length:c.curves.length,...dimensions,sampling:c.curves.sampling,stepSize:c.curves.stepSize,angleField:this.angleField,noiseOffset:c.parameters.noise_offset,isCancelled:this.isCancelled});
   // Only initialization needs detached seeds. Static display never snapshots
   // geometry unless its own cache owner requests a rebuild.
   const seeds=this.geometry.snapshot();this.seedXs=seeds.seedXs;this.seedYs=seeds.seedYs;this.curvePacked=new Uint32Array(this.geometry.count);
   this.resolveCurveColors(c.parameters);this.geometryBuilds=1;this.curveDisplay=new SourcePerlinCurveDisplay(options.curveCacheSamples);
  }
  this.parameters=new SourcePerlinParameterRuntime({initial:c.parameters,backend:'cpu',style:c.cpuStyle,...(this.geometry?{fieldDimensions:[this.geometry.width,this.geometry.height] as const}:{}),isCancelled:this.isCancelled,onFieldEffect:(effect,values)=>this.fieldEffect(effect,values)});
 }
 private spend(units:number){this.check();this.reserve?.(Math.max(1,units));this.check();}
 private check(){if(this.disposed)throw new SourcePerlinCpuModelError('disposed','Perlin CPU model is disposed.');if(this.failed)throw new SourcePerlinCpuModelError('failed','Perlin CPU model failed; recreate it before use.');if(this.isCancelled?.())throw new SourcePerlinCpuModelError('cancelled','Perlin CPU model cancelled.');}
 private run<T>(action:()=>T):T{try{this.check();const value=action();this.check();return value;}catch(error){this.failed=true;this.curveDisplay?.dispose();throw error;}}
 private buildAngle(values:SourcePerlinParameterValues){
  const c=this.config.curves,dimensions=sourcePerlinCurveDimensions(this.sourceWidth,this.sourceHeight);
  return new SourcePerlinAngleField({...dimensions,fieldCellSize:c.cellSize,textureSeed:this.textureSeed,curveNoiseScale:values.curve_noise_scale,curveNoiseOctaves:c.noiseOctaves,curveNoiseOffset:c.noiseOffset,curveAngleScale:values.curve_angle_scale,noise:this.noise,isCancelled:this.isCancelled});
 }
 private fieldEffect(effect:SourcePerlinFieldEffect,values:SourcePerlinParameterValues){
  if(effect==='rebuild-angle')this.angleField=this.buildAngle(values);
  else if(effect==='dirty')this.geometryDirty=true;
  else this.rebuildCurves(values);
 }
 private rebuildCurves(values=this.parameters.snapshot().values):boolean{
  if(!this.geometryDirty||!this.geometry)return false;
  this.spend(this.geometry.count*this.geometry.diagnostics().length);this.geometry.rebuild({noiseOffset:values.noise_offset,angleField:this.angleField});this.geometryDirty=false;this.geometryBuilds++;this.curveDisplay?.invalidate();return true;
 }
 private resolveCurveColors(values:SourcePerlinParameterValues,sample?:(coordinate:number)=>number){
  const g=this.geometry!,c=this.config.curves;this.spend(g.count*(c.colorMode==='seed-space'?1+c.seedCircleCount:1));const next=new Uint32Array(g.count);
  for(let i=0;i<g.count;i++){if((i&255)===0)this.check();next[i]=this.curveColors!.resolve({mode:c.colorMode,index:i,count:g.count,x:this.seedXs![i],y:this.seedYs![i],curveNoiseScale:values.curve_noise_scale,curveNoiseOctaves:c.noiseOctaves},sample);}
  this.check();this.curvePacked!.set(next);
 }
 private refreshCurveColors(sample:(coordinate:number)=>number){this.resolveCurveColors(this.parameters.snapshot().values,sample);this.colorRefreshes++;this.curveDisplay?.invalidate();}
 beginPerlinParameterActions(actions:readonly SourcePerlinParameterAction[]){this.run(()=>this.parameters.begin(actions));}
 interpolatePerlinParameterActions(eased:number,finished:boolean,dt:number){this.run(()=>this.parameters.interpolate(eased,finished,dt));}
 beginGradientActions(actions:readonly SourceGradientAction[]){this.run(()=>this.colors.beginGradientActions(actions));}
 interpolateGradientActions(eased:number,finished:boolean){this.run(()=>this.colors.interpolateGradientActions(eased,finished));}
 replacePalette(palette:readonly number[]){this.run(()=>{this.spend(this.motion?.count??1);this.colors.replacePalette(palette);});}
 setShowTrails(enabled:boolean){this.run(()=>{if(typeof enabled!=='boolean')throw new SourcePerlinCpuModelError('input','Perlin showTrails requires a boolean.');this.showTrails=enabled;});}
 update(time:number,deltaTime:number){this.run(()=>{
  if(typeof time!=='number'||!Number.isFinite(F(time))||typeof deltaTime!=='number'||!Number.isFinite(F(deltaTime))||deltaTime<0)throw new SourcePerlinCpuModelError('input','Perlin update requires finite time and nonnegative delta time.');
  this.spend(this.motion?.count??1);this.time=F(time);const dt=F(deltaTime);this.colors.update(dt);this.parameters.update(dt);
  if(this.motion){const p=this.config.particles,v=this.parameters.snapshot().values;this.motion.update({time:this.time,deltaTime:dt,noiseScale:v.noise_scale,noiseOffset:v.noise_offset,...p});this.trails!.afterMotion(this.time,this.showTrails);}
  this.updates++;
 });}
 draw(frame:SourcePerlinCpuModelDraw):void{this.run(()=>{
  this.spend(1);if(!frame||!(frame.target instanceof SourcePerlinCpuTarget)||!['primary','offscreen'].includes(frame.kind)||!Number.isInteger(frame.sourcePixelDensity)||frame.sourcePixelDensity<1)throw new SourcePerlinCpuModelError('input','Invalid Perlin CPU display target or primary density.');
  const dimensions=frame.target.diagnostics(),d=this.config.display,display={width:dimensions.width,height:dimensions.height,sourceWidth:this.sourceWidth,sourceHeight:this.sourceHeight,target:frame.kind,sourcePixelDensity:frame.sourcePixelDensity,lineWeight:d.lineWeight,dotSize:d.dotSize};
  const background=sourcePerlinBackgroundRgba(d.backgroundColor,d.accumulation,d.accumulationFadeAlpha);
  if(this.geometry){
   this.curveDisplay!.draw({target:frame.target,display,curves:{count:this.geometry.count,rebuildIfNeeded:()=>this.rebuildCurves(),snapshot:()=>{this.spend(this.geometry!.count*this.geometry!.diagnostics().length);this.drawingSnapshots++;const g=this.geometry!.snapshot();return{count:g.count,length:g.length,xs:g.xs,ys:g.ys,colors:this.curvePacked!.slice()};}},animating:this.parameters.fieldCurvesAnimating,curveAlpha:this.config.curves.alpha,background,accumulation:d.accumulation},this.isCancelled);
  }else{
   const prepared=prepareSourcePerlinCpuDisplay(display),primitives:SourcePerlinCpuPrimitive[]=[];
   // PerlinNoiseField.display PC202–233: accumulation draws points;
   // otherwise showTrails draws trails; false jumps directly to hint/pop.
   if(d.accumulation){
    this.spend(this.motion!.count);const positions=new Float32Array(this.motion!.count*3);this.motion!.visitParticles((i,x,y)=>{positions[i*3]=x;positions[i*3+1]=y;});
    primitives.push({kind:'points',buffers:sourceProcessingRoundPointBuffers({positions,colors:sourcePerlinPointRgba(this.particleColors!.packed,this.isCancelled),width:prepared.pointWidth,rowMajor:prepared.modelView.rowMajor,isCancelled:this.isCancelled})});
   }else if(this.showTrails){
    this.spend(this.trails!.diagnostics().records);const trails=this.trails!.snapshotPolygons(this.sourceWidth,this.sourceHeight);this.spend(trails.alphas.length);const rgba=new Float32Array(trails.alphas.length*4);
    for(let i=0;i<trails.alphas.length;i++){if((i&255)===0)this.check();rgba.set(trails.colors.subarray(i*3,i*3+3),i*4);rgba[i*4+3]=trails.alphas[i];}
    primitives.push({kind:'lines',buffers:sourceProcessingOpenStrokeBuffers({positions:trails.positions,colors:rgba,polygonOffsets:trails.polygonOffsets,rowMajor:prepared.modelView.rowMajor,lineWidth:prepared.lineWidth,isCancelled:this.isCancelled})});
   }
   frame.target.draw({projection:prepared.projection.columnMajor,background,accumulation:d.accumulation,primitives},this.isCancelled);
  }
  this.draws++;
 });}
 diagnostics(){return this.run(()=>({style:this.config.cpuStyle,time:this.time,updates:this.updates,draws:this.draws,showTrails:this.showTrails,geometryBuilds:this.geometryBuilds,colorRefreshes:this.colorRefreshes,drawingSnapshots:this.drawingSnapshots,geometryDirty:this.geometryDirty,motion:this.motion?.diagnostics(),trails:this.trails?.diagnostics(),geometry:this.geometry?.diagnostics(),curveDisplay:this.curveDisplay?.diagnostics()}));}
 /** Explicit detached diagnostics; never used by the render/update hot path. */
 diagnosticSnapshot(){return this.run(()=>({motion:this.motion?.snapshot(),particleColors:this.particleColors?.snapshot(),trails:this.trails?.snapshotPolygons(this.sourceWidth,this.sourceHeight),geometry:this.geometry?.snapshot(),curveColors:this.curvePacked?.slice(),colors:this.colors.snapshot(),parameters:this.parameters.snapshot()}));}
 dispose(){if(this.disposed)return;this.curveDisplay?.dispose();this.disposed=true;}
}
