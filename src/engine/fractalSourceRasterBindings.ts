import type {FractalConfig} from '../scenes/complex';
import type {SourceDrawingUniform} from './sourceDrawingSnapshot';
import {validateFractalSourcePlan,type FractalSourcePlan,type FractalSourceReferenceReady} from './fractalSourcePrecision';
import {validatePreparedFractalSourceColor,type PreparedFractalSourceColor} from './fractalSourceColor';
import {validateSourceFractalDisplayFacts,type SourceFractalDisplayFacts} from './sourceFractalDisplay';
import {fractalSourceRequire as require} from './fractalSourceGpuFailure';

// Maximum owned 32-bit value storage: 69 numerical slots, plus either two
// algorithm selectors or 108 color slots (including all 16 palette entries).
// This excludes JavaScript object overhead and the caller-owned source arrays.
export const FRACTAL_SOURCE_RASTER_BINDING_BYTES=Object.freeze({numeric:(69+2)*4,color:(69+108)*4});

/** Sole producer of the source raster's numerical, delayed-display and color
 * bindings. Values are owned binary32/int32 snapshots, never borrowed plan
 * arrays. Both WebGL and native transport consume this explicit upload order. */
export function createFractalSourceRasterBindings(
 plan:FractalSourcePlan,c:Pick<FractalConfig,'trapCenter'|'trapRadius'|'trapAspect'|'trapRotation'|'trapShape'>,
 reference:FractalSourceReferenceReady|undefined,color?:PreparedFractalSourceColor,display?:SourceFractalDisplayFacts,
):readonly SourceDrawingUniform[]{
 validateFractalSourcePlan(plan);if(color)validatePreparedFractalSourceColor(color);if(display)validateSourceFractalDisplayFacts(display);
 require(!display||!!color,'Source display requires a prepared source color plan');
 require(!reference||reference.kind==='ready'&&reference.key===plan.key&&reference.profile===plan.profile&&reference.length>0&&reference.length<=2048&&reference.values.length===reference.length*4,'Source raster reference belongs to another plan');
 const uniforms:SourceDrawingUniform[]=[];
 const f=(name:string,kind:'float'|'vec2'|'vec3'|'vec4'|'float-array'|'vec3-array',values:readonly number[],count=1)=>{
  const copied=new Float32Array(values);require(copied.every(Number.isFinite),'Source raster uniform exceeds finite binary32: '+name);
  uniforms.push(Object.freeze({name,kind,count,values:copied}));
 };
 const i=(name:string,value:number)=>{require(Number.isInteger(value)&&value>=-0x80000000&&value<=0x7fffffff,'Source raster integer uniform exceeds int32: '+name);uniforms.push(Object.freeze({name,kind:'int',count:1,values:new Int32Array([value])}));};
 const sampler=(name:string,texture:number)=>uniforms.push(Object.freeze({name,kind:'sampler2d',texture}));
 f('u_resolution','vec2',plan.logicalSize);f('u_centerHigh','vec2',[plan.shaderCenter[0],plan.shaderCenter[2]]);f('u_centerLow','vec2',[plan.shaderCenter[1],plan.shaderCenter[3]]);f('u_zoomDS','vec2',plan.zoom);
 f('u_juliaConstantHigh','vec2',[plan.shaderJuliaConstant[0],plan.shaderJuliaConstant[2]]);f('u_juliaConstantLow','vec2',[plan.shaderJuliaConstant[1],plan.shaderJuliaConstant[3]]);
 f('u_rotation','float',[plan.rotation]);f('u_previewScale','float',[display?.previewScale??1]);f('u_bailout','float',[plan.bailout]);f('u_perturbationThreshold','float',[plan.perturbation.threshold]);f('u_perturbationAbsFactor','float',[plan.perturbation.absFactor]);f('u_perturbationRelLimit','float',[plan.perturbation.relLimit]);
 i('u_formulaId',plan.formula==='newton'?2:plan.formula==='nova'?3:plan.formula==='julia'?1:0);i('u_type',plan.isJulia?1:0);i('u_formulaType',0);i('u_power',plan.uniformPower);i('u_formulaSupportsPerturbation',1);i('u_iterations',plan.iterations);i('u_usePerturbation',reference?1:0);i('u_refOrbitLen',reference?.length??0);sampler('u_refOrbitTex',2);
 f('u_formulaParams','vec4',plan.formulaParams);f('u_dynamicParams','float-array',plan.dynamicParams,plan.dynamicParams.length);
 f('legacyTrap','vec4',[...c.trapCenter,c.trapRadius,c.trapAspect]);f('legacyTrapShape','vec3',[Math.cos(c.trapRotation),Math.sin(c.trapRotation),['point','ring','cross'].indexOf(c.trapShape)]);
 if(color){
  sampler('u_gradientTex',1);i('u_gradientSize',display?.gradientSize??color.lutSize);
  const p=color.fallback;i('u_paletteSize',p.size);if(p.size)f('u_palette','vec3-array',Array.from(p.colors),p.size);
  f('u_paletteOffset','float',[p.offset]);f('u_paletteGamma','float',[p.gamma]);i('u_paletteSpace',p.space);i('u_useCosinePalette',p.useCosine?1:0);
  for(const k of ['a','b','c','d'] as const)f('u_cos'+k.toUpperCase(),'vec3',p.cosine[k]);
  for(const side of ['inside','outside'] as const){const p=color[side],prefix='u_'+side;
   i(prefix+'ColoringAlgorithm',p.algorithmId);f(prefix+'ColoringParams0','vec4',p.p0);f(prefix+'ColoringParams1','vec4',p.p1);f(prefix+'ColoringParams2','vec4',p.p2);
   f(prefix+'SolidColor','vec4',[...p.solid,1]);i(prefix+'TransferFunction',p.transferId);f(prefix+'ColorDensity','float',[p.density]);f(prefix+'GradientOffset','float',[p.offset]);i(prefix+'RepeatGradient',p.repeat?1:0);
  }
 }else{i('u_insideColoringAlgorithm',1);i('u_outsideColoringAlgorithm',1);}
 require(uniforms.reduce((n,u)=>n+('values' in u?u.values.byteLength:0),0)<=(color?FRACTAL_SOURCE_RASTER_BINDING_BYTES.color:FRACTAL_SOURCE_RASTER_BINDING_BYTES.numeric),'Source raster bindings exceed preflight value storage','capacity');
 return Object.freeze(uniforms);
}

/** Synchronous adapter; the binding producer owns all interpretation. */
export function uploadFractalSourceRasterBindings(gl:WebGL2RenderingContext,program:WebGLProgram,uniforms:readonly SourceDrawingUniform[]):void {
 for(const u of uniforms){const loc=gl.getUniformLocation(program,u.name);
  switch(u.kind){
   case'sampler2d':gl.uniform1i(loc,u.texture);break;
   case'int':gl.uniform1iv(loc,u.values as Int32Array<ArrayBuffer>);break;
   case'float':case'float-array':gl.uniform1fv(loc,u.values as Float32Array<ArrayBuffer>);break;
   case'vec2':gl.uniform2fv(loc,u.values as Float32Array<ArrayBuffer>);break;
   case'vec3':case'vec3-array':gl.uniform3fv(loc,u.values as Float32Array<ArrayBuffer>);break;
   case'vec4':gl.uniform4fv(loc,u.values as Float32Array<ArrayBuffer>);break;
   default:throw Error('Unsupported source raster binding: '+u.kind);
  }
 }
}
