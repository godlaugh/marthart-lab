import {prepareSourceSamilaExpressions} from './sourceSamilaExpression';
import {SOURCE_SAMILA_MATH_MODEL,resolveSourceSamilaSelection,sourceSamilaUniform,sourceSamilaMathGlsl} from './sourceSamilaMath';
import type {IteratedField} from '../scenes/iteratedDensity';
import {SAMILA_MODES,SAMILA_PROJECTIONS} from '../scenes/samila';
import {existingParameterNameError} from './expression';
import {compileGlslExpression} from './gpuSampler';

type SamilaField=Extract<IteratedField,{kind:'samila'}>;
export interface SamilaGpuField {source:string;uniforms:Record<string,number>;key:string;}
const finite32=(value:number)=>Number.isFinite(value)&&Number.isFinite(Math.fround(value));
const pairs:Record<string,readonly [string,string]>={
 f1_f2:['v1','v2'],f2_f1:['v2','v1'],f1_x:['v1','samplePosition.x'],f2_x:['v2','samplePosition.x'],f1_y:['v1','samplePosition.y'],f2_y:['v2','samplePosition.y'],
 x_f1:['samplePosition.x','v1'],x_f2:['samplePosition.x','v2'],y_f1:['samplePosition.y','v1'],y_f2:['samplePosition.y','v2'],
 product_f1:['v1*v2','v1'],product_f2:['v1*v2','v2'],f1_product:['v1','v1*v2'],f2_product:['v2','v1*v2'],
};
function mappingSource(mode:string):string {
 const pair=pairs[mode];if(pair)return `vec2 mapped=vec2(${pair.join(',')});`;
 const vertical=mode.startsWith('x_'),family=vertical?mode.slice(2):mode.slice(0,-2),select=(value:string)=>`vec2 mapped=vec2(${vertical?`samplePosition.x,${value}`:`${value},samplePosition.x`});`;
 if(family==='kaleidoscope')return `float period=SAM_TAU/max(2.,floor(mappingA+0.5));float angle=abs(samModulo(samAngle(v1,v2)+period/2.,period)-period/2.);${select(`samRadius(v1,v2,0.)*${vertical?'sin':'cos'}(angle)`)}`;
 if(family==='swirl')return `float radius=samRadius(v1,v2,0.);float angle=samAngle(v1,v2)+mappingA*radius;${select(`radius*${vertical?'sin':'cos'}(angle)`)}`;
 if(family==='warp')return select(vertical?'v1+mappingC*sin(mappingD*v2)':'v1+mappingA*sin(mappingB*v2)');
 if(family==='cosmod')return select('sin(mappingA*v1+mappingB)*cos(mappingC*v2+mappingD)');
 // sqrt(v1²+v2²+1e-10)^a is the same mathematical radius power, without
 // overflowing the squared intermediate for finite float32 input radii.
 if(family==='radial')return select('realPow(samRadius(v1,v2,1e-5),mappingA)');
 if(family==='fold')return `float halfPeriod=abs(mappingA)/2.+.001;${select('abs(samModulo(v1+halfPeriod,2.*halfPeriod)-halfPeriod)')}`;
 throw new Error('Samila GPU 映射尚未解析或不支持');
}
function projectionSource(projection:string):string {
 if(projection==='cartesian')return 'vec2 projected=mapped;';
 if(projection==='polar')return 'vec2 projected=mapped.y*vec2(cos(mapped.x),sin(mapped.x));';
 const coordinates='float lon=samModulo(mapped.x+SAM_PI,SAM_TAU)-SAM_PI;float lat=asin(sin(mapped.y));';
 if(projection==='aitoff')return coordinates+'float alpha=acos(clamp(cos(lat)*cos(lon/2.),-1.,1.));float sinc=alpha==0.?1.:sin(alpha)/alpha;vec2 projected=vec2(2.*cos(lat)*sin(lon/2.),sin(lat))/sinc;';
 if(projection==='hammer')return coordinates+'float denominator=sqrt(1.+cos(lat)*cos(lon/2.));vec2 projected=vec2(2.*SAM_SQRT2*cos(lat)*sin(lon/2.),SAM_SQRT2*sin(lat))/denominator;';
 if(projection==='lambert')return coordinates+'float denominator=1.+cos(lat)*cos(lon);if(denominator<1e-12)return vec3(realNaN());float k=sqrt(2./denominator);vec2 projected=k*vec2(cos(lat)*sin(lon),sin(lat));';
 if(projection==='mollweide')return coordinates+`float theta=lat;if(abs(abs(lat)-SAM_PI/2.)<1e-10)theta=sign(lat)*SAM_PI/2.;else for(int i=0;i<16;i++){float step=(2.*theta+sin(2.*theta)-SAM_PI*sin(lat))/(2.+2.*cos(2.*theta));theta-=step;if(abs(step)<1e-12)break;}vec2 projected=vec2(2.*SAM_SQRT2/SAM_PI*lon*cos(theta),SAM_SQRT2*sin(theta));`;
 throw new Error('Samila GPU 投影尚未解析或不支持');
}

/** Shared source AST binding and scalar uniform ABI for staged and direct GPU consumers. */
export function prepareSourceSamilaGpuMath(field:SamilaField){
 if(field.mathModel!==SOURCE_SAMILA_MATH_MODEL)throw Error('源 Samila GPU 数学版本无效');
  const selection=resolveSourceSamilaSelection(field.mapping,field.projection),expressions=prepareSourceSamilaExpressions(field.equations,Object.keys(field.parameters)),bound=expressions.bind(field.parameters);
  if(!finite32(field.rotation))throw Error('源 Samila 旋转超出 Float32');
  const uniforms:Record<string,number>={...bound.uniforms,mappingA:sourceSamilaUniform(field.parameters.a),mappingB:sourceSamilaUniform(field.parameters.b),mappingC:sourceSamilaUniform(field.parameters.c),mappingD:sourceSamilaUniform(field.parameters.d),sourceSamilaRotation:field.rotation};
  return{selection,expressions,uniforms};
}

/** Safe GLSL adapter for the producer's resolved Samila field. Seed coordinates
 * are supplied by the caller; this helper does not sample Settings or RNG.
 * Caller supplies glslRealPrelude and bit-based finiteFloat/finiteVector. */
export function compileSamilaGpuField(field:SamilaField):SamilaGpuField {
 if(field.mathModel!==undefined){
  if(field.mathModel!==SOURCE_SAMILA_MATH_MODEL)throw Error('源 Samila GPU 数学版本无效');
  const {selection,expressions,uniforms}=prepareSourceSamilaGpuMath(field);
  const math=sourceSamilaMathGlsl.replace('uniform int sourceSamilaMode,sourceSamilaProjection;',`const int sourceSamilaMode=${selection.modeIndex},sourceSamilaProjection=${selection.projectionIndex};`);
  const source=`${Object.keys(uniforms).map(name=>`uniform float ${name};`).join('\n')}
${math}
vec3 nextPoint(vec3 samplePosition){
 float v1=${expressions.glsl[0]},v2=${expressions.glsl[1]};
 if(!finiteFloat(v1)||!finiteFloat(v2))return vec3(realNaN());
 float plotX,plotY;sourceSamilaApplyGenerateMode(v1,v2,samplePosition.x,samplePosition.y,0.,plotX,plotY);
 float finalX,finalY;sourceSamilaApplyProjection(plotX,plotY,finalX,finalY);
 vec2 result=vec2(finalX,finalY);
 if(abs(sourceSamilaRotation)>1e-9){float co=cos(sourceSamilaRotation),si=sin(sourceSamilaRotation);result=vec2(finalX*co-finalY*si,finalX*si+finalY*co);}
 return finiteVector(vec3(result,0.))?vec3(result,0.):vec3(realNaN());
}`;
  return{source,uniforms,key:source};
 }

 if(field.mapping==='random'||!(SAMILA_MODES as readonly string[]).includes(field.mapping))throw new Error('Samila GPU 映射尚未解析或不支持');
 if(field.projection==='random'||!(SAMILA_PROJECTIONS as readonly string[]).includes(field.projection))throw new Error('Samila GPU 投影尚未解析或不支持');
 const names=Object.keys(field.parameters).sort();
 for(const name of names){const error=existingParameterNameError(name,'samila');if(error)throw new Error(error);}
 const symbols=[...names,'t','time'],values=[...names.map(name=>field.parameters[name]),field.time,field.time];
 if(!values.every(finite32)||!Number.isFinite(field.rotation))throw new Error('Samila 参数超出 GPU float32 范围');
 const uniforms:Record<string,number>=Object.fromEntries(values.map((v,i)=>['parameter'+i,v]));
 for(const name of ['a','b','c','d'])uniforms['mapping'+name.toUpperCase()]=field.parameters[name]??1;
 // Rotation is already evaluated by the frame owner. Trigonometry before the
 // float32 upload retains a useful phase for large, but finite, angles.
 uniforms.rotationCos=Math.cos(field.rotation);uniforms.rotationSin=Math.sin(field.rotation);
 const f1=compileGlslExpression(field.equations.f1,['x','y'],symbols),f2=compileGlslExpression(field.equations.f2,['x','y'],symbols);
 const source=`${Object.keys(uniforms).map(name=>`uniform float ${name};`).join('\n')}
const float SAM_PI=3.141592653589793,SAM_TAU=6.283185307179586,SAM_SQRT2=1.4142135623730951;
float samModulo(float x,float period){return x-period*floor(x/period);}
float samAngle(float x,float y){return x==0.&&y==0.?0.:atan(y,x);}
float samRadius(float x,float y,float z){float m=max(max(abs(x),abs(y)),abs(z));return m==0.?0.:m*length(vec3(x,y,z)/m);}
vec3 nextPoint(vec3 samplePosition){
 if(!finiteVector(samplePosition))return vec3(realNaN());
 float v1=${f1},v2=${f2};
 ${mappingSource(field.mapping)}
 if(!finiteFloat(mapped.x)||!finiteFloat(mapped.y))return vec3(realNaN());
 ${projectionSource(field.projection)}
 if(!finiteFloat(projected.x)||!finiteFloat(projected.y))return vec3(realNaN());
 vec3 result=vec3(projected.x*rotationCos-projected.y*rotationSin,projected.x*rotationSin+projected.y*rotationCos,0.);
 return finiteVector(result)?result:vec3(realNaN());
}`;
 return {source,uniforms,key:source};
}
