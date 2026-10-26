import {domainExpressions} from './domainExpressions';
import {domainNativeComplexFunctions} from './domainNativeArithmetic';
import type {DomainModel,SourceDomainModel} from './domainModel';
import type {SourceDrawingSnapshot,SourceDrawingUniform} from './sourceDrawingSnapshot';
import {SOURCE_FRAME_BUDGET} from './sourceDrawingFrame';
import {sourceProcessingCameraMatrix,sourceProcessingDefaultCameraZ,sourceProcessingOrthographic,translateSourceProcessingMatrix,packSourceProcessingMatrix} from './sourceProcessingMatrix';
import {writeSourceEyePosition} from './sourceProcessingGeometry';

export interface DomainNativeDrawingDimensions {width:number;height:number;logicalWidth:number;logicalHeight:number;}
export class SourceDomainNativeDrawingError extends Error {
 constructor(readonly kind:'input'|'unsupported'|'capacity',message:string){super(message);this.name='SourceDomainNativeDrawingError';}
}
/** Eligibility describes selected source rules, not availability of a native service. */
export function supportsDomainNativeModel(model:DomainModel):model is SourceDomainModel {
 return model.iterationVersion==='mathart-1.7.8-gpu'&&model.execution.arithmetic==='native-gpu'
  &&model.colorVersion==='mathart-1.7.8-gpu'&&model.view.version==='mathart-1.7.8-gpu'
  &&model.backend!=='cpu'&&model.supersampling===1;
}
const F=Math.fround;
const input=(yes:unknown,message:string)=>{if(!yes)throw new SourceDomainNativeDrawingError('input',message);};
const scalar=(value:number,name:string)=>{input(Number.isFinite(F(value)),`原生域着色 ${name} 需要有限 float32`);return F(value);};

/** Pure mathematical layer. Dimensions distinguish physical framebuffer pixels
 * from the original PGraphics logical quad and u_resolution. Formula/watermark
 * composition and native service ownership belong to the caller. No raster is
 * allocated here; the frame codec admits transport, targets, readback and any
 * retained caller pixels before allocating its packet or asking native GL.
 *
 * Template provenance: MathArt 1.7.8 resources/data/shader/domain_coloring/.
 * Fragment SHA256 23aba61177f1534df6b9f6523ce854e3528e1ff13f40e13c7d1a34dfd98b4fbc.
 * Only #version is supplied by the native host; shared AST output replaces the
 * original dynamic macros. The complete iteration/color body stays unchanged.
 */
export function prepareDomainNativeDrawing(model:SourceDomainModel,dimensions:DomainNativeDrawingDimensions):SourceDrawingSnapshot {
 if(!supportsDomainNativeModel(model))throw new SourceDomainNativeDrawingError('unsupported','原生域着色需要完整原版 GPU 公式、颜色和视口规则及单次采样');
 const {width,height,logicalWidth:lw,logicalHeight:lh}=dimensions;
 input([width,height].every(n=>Number.isInteger(n)&&n>0&&n<=16384)&&width*height<=16_000_000,'原生域着色物理尺寸超过帧协议容量');
 input([lw,lh].every(n=>Number.isInteger(n)&&n>0&&n<=2147483647),'原生域着色逻辑尺寸需要正 int32');
 input(Number.isInteger(model.steps)&&model.steps>=1&&model.steps<=256,'原生域着色迭代次数需要 1–256');
 const seed=['PIXEL_Z','ZERO','CONSTANT_C'].indexOf(model.seed),color=model.sourceColor.facts,palette=color.palette.entries;
 input(seed>=0&&color.version==='mathart-1.7.8-gpu'&&color.palette.sampling==='gpu-n-minus-one'&&palette.length<=16,'原生域着色来源事实不一致');
 const curve=['PHASE','MODULUS','PHASE_MODULUS','NONE'].indexOf(color.curveMode);input(curve>=0,'原生域着色曲线模式无效');
 const gpu=domainExpressions.get(model).gpuSource();
 const macros=`#define USE_DYNAMIC_FORMULA 1
#define DYNAMIC_EVAL_FORMULA (${gpu.formulaSource})
${gpu.iterationSource===undefined?'':`#define USE_DYNAMIC_ITERATION_FORMULA 1
#define DYNAMIC_ITERATION_EVAL_FORMULA (${gpu.iterationSource})
`}`;
 const parameterDeclarations=gpu.referencedParameterIndices.map(index=>`uniform float parameter${index};
`).join('');
 const fragmentShader=macros+parameterDeclarations+fragmentTemplate;
 // The source resets camera/ortho and then translates by logical half extents.
 // Immediate tessellation bakes that modelview into vec4 CPU vertices; the GL
 // transform is projection alone. Keep camera normalization even at odd sizes.
 const cameraZ=sourceProcessingDefaultCameraZ(F(lh)),modelview=sourceProcessingCameraMatrix(F(lw),F(lh),cameraZ);
 const projection=sourceProcessingOrthographic(F(lw),F(lh));
 const halfWidth=F(F(lw)*F(.5)),halfHeight=F(F(lh)*F(.5));
 translateSourceProcessingMatrix(modelview,halfWidth,halfHeight,0);
 type Numeric={name:string;kind:Exclude<SourceDrawingUniform['kind'],'sampler2d'>;values:readonly number[];count:number};
 const pending:Numeric[]=[];
 const uniform=(name:string,kind:Numeric['kind'],values:readonly number[],count=1)=>{for(const v of values)scalar(v,name);pending.push({name,kind,values,count});};
 uniform('transform','mat4',projection.values);
 uniform('u_resolution','vec2',[lw,lh]);uniform('u_center','vec2',[model.view.centerX,model.view.centerY]);
 uniform('u_scale','float',[model.view.inverseScale]);uniform('u_rotation','float',[model.view.angle]);
 uniform('u_constant','vec2',model.constant);uniform('u_curve_mode','int',[curve]);
 uniform('u_phase_density','float',[color.phaseDensity]);uniform('u_mod_density','float',[color.modDensity]);
 uniform('u_phase_sharpness','float',[color.phaseSharpness]);uniform('u_mod_sharpness','float',[color.modSharpness]);
 uniform('u_curve_bias','float',[color.bias]);uniform('u_curve_mix','float',[color.mix]);
 uniform('u_palette_size','int',[palette.length]);uniform('u_palette_offset','float',[color.paletteOffset]);
 uniform('u_iter_steps','int',[model.steps]);uniform('u_iter_seed_mode','int',[seed]);uniform('u_iter_escape_radius','float',[model.bailout]);
 const paletteValues=Array<number>(48).fill(0);palette.forEach((entry,i)=>{input(entry.length===3,'原生域着色色板分量无效');for(let c=0;c<3;c++)paletteValues[i*3+c]=scalar(entry[c],'palette');});
 uniform('u_palette','vec3-array',paletteValues,16);
 for(const index of gpu.referencedParameterIndices)uniform(`parameter${index}`,'float',[model.parameters[gpu.parameters[index]]]);
 const copiedBufferBytes=16*4+8*4+6*2+pending.reduce((n,u)=>n+u.values.length*4,0);
 const metadata=3*(vertexShader.length+fragmentShader.length)+4096+pending.reduce((n,u)=>n+96+u.name.length*3,0);
 const admittedBytes=copiedBufferBytes+metadata;
 if(!Number.isSafeInteger(admittedBytes)||admittedBytes>SOURCE_FRAME_BUDGET)throw new SourceDomainNativeDrawingError('capacity','原生域着色绘制快照超过 256 MiB 预算');
 const vertices=new Float32Array(16),corners=[[-halfWidth,-halfHeight],[halfWidth,-halfHeight],[halfWidth,halfHeight],[-halfWidth,halfHeight]];
 corners.forEach(([x,y],i)=>writeSourceEyePosition(modelview,x,y,0,vertices,i*4));
 const uniforms:SourceDrawingUniform[]=pending.map(u=>({name:u.name,kind:u.kind,count:u.count,values:u.kind==='int'?new Int32Array(u.values):u.kind==='mat4'?packSourceProcessingMatrix([...u.values]).columnMajor:new Float32Array(u.values)}));
 return{model:'source-drawing-v1',textures:[],copiedBufferBytes,retainedBufferBytes:0,admittedBytes,commands:[{
  primitive:'triangles',vertexShader,fragmentShader,
  attributes:[{name:'vertex',size:4,divisor:0,values:vertices},{name:'texCoord',size:2,divisor:0,values:new Float32Array([0,0,1,0,1,1,0,1])}],
  index:new Uint16Array([0,1,2,2,3,0]),first:0,count:6,instances:1,uniforms,
  depthTest:false,depthWrite:false,depthFunction:'less-equal',frontFace:'counter-clockwise',passes:['both'],blend:'source-alpha-over',
 }]};
}

const vertexShader=`
uniform mat4 transform;

in vec4 vertex;
in vec2 texCoord;

out vec2 vUv;

void main() {
    vUv = texCoord;
    gl_Position = transform * vertex;
}
`;

const fragmentTemplate=`
uniform vec2 u_resolution;
uniform vec2 u_center;
uniform float u_scale;
uniform float u_rotation;
uniform int u_formula_mode;
uniform int u_power;
uniform vec2 u_constant;
uniform int u_curve_mode;
uniform float u_phase_density;
uniform float u_mod_density;
uniform float u_phase_sharpness;
uniform float u_mod_sharpness;
uniform float u_curve_bias;
uniform float u_curve_mix;
uniform int u_palette_size;
uniform vec3 u_palette[16];
uniform float u_palette_offset;
uniform int u_iter_steps;
uniform int u_iter_seed_mode;
uniform float u_iter_escape_radius;

out vec4 fragColor;
in vec2 vUv;

const float TWO_PI = 6.28318530718;

${domainNativeComplexFunctions}vec2 c_pow_int(vec2 z, int p) {
    vec2 result = z;
    for (int i = 1; i < p; i++) {
        result = c_mul(result, z);
    }
    return result;
}

vec2 eval_formula(vec2 z) {
    vec2 c = u_constant;
#ifdef USE_DYNAMIC_FORMULA
    return DYNAMIC_EVAL_FORMULA;
#else
    if (u_formula_mode == 0) {
        return z;
    }
    if (u_formula_mode == 1) {
        return c_mul(z, z);
    }
    if (u_formula_mode == 3) {
        return c_div(vec2(1.0, 0.0), z);
    }
    if (u_formula_mode == 4) {
        return c_exp(z);
    }
    if (u_formula_mode == 5) {
        return c_sin(z);
    }
    vec2 zn = c_pow_int(z, max(u_power, 1));
    return zn - u_constant;
#endif
}

vec2 eval_formula_iterated(vec2 z, int steps) {
    vec2 current = z;
    if (u_iter_seed_mode == 1) {
        current = vec2(0.0, 0.0);
    } else if (u_iter_seed_mode == 2) {
        current = u_constant;
    }
    vec2 z0 = z;
    float escapeRadius = max(u_iter_escape_radius, 1.0);
    float escapeRadiusSq = escapeRadius * escapeRadius;
    for (int i = 0; i < 256; i++) {
        if (i >= steps) {
            break;
        }
#ifdef USE_DYNAMIC_ITERATION_FORMULA
        vec2 w = current;
        vec2 z = z0;
        vec2 c = u_constant;
        if (u_iter_seed_mode == 1 || u_iter_seed_mode == 2) {
            c = z0;
        }
        current = DYNAMIC_ITERATION_EVAL_FORMULA;
#else
        current = eval_formula(current);
#endif
        float magSq = dot(current, current);
        if (!(magSq <= escapeRadiusSq)) {
            break;
        }
    }
    return current;
}

float stripe(float value, float density, float sharpness) {
    float base = 0.5 + 0.5 * cos(value * max(0.0001, density));
    return pow(base, max(0.0001, sharpness));
}

vec3 sample_palette(float t) {
    if (u_palette_size <= 0) {
        return vec3(0.0);
    }
    if (u_palette_size == 1) {
        return u_palette[0];
    }
    float wrapped = fract(t);
    float p = wrapped * float(u_palette_size - 1);
    int idx = int(floor(p));
    float f = p - float(idx);
    int nextIdx = min(idx + 1, u_palette_size - 1);
    return mix(u_palette[idx], u_palette[nextIdx], f);
}

void main() {
    vec2 uv = vUv;
    vec2 plane = uv * 2.0 - 1.0;
    float aspect = u_resolution.x / max(u_resolution.y, 1.0);
    plane.x *= aspect;
${'    '}
    float cosRot = cos(u_rotation);
    float sinRot = sin(u_rotation);
    vec2 rotatedPlane = vec2(
        plane.x * cosRot - plane.y * sinRot,
        plane.x * sinRot + plane.y * cosRot
    );
${'    '}
    vec2 z = u_center + rotatedPlane * u_scale;
    vec2 fz = eval_formula_iterated(z, max(u_iter_steps, 1));
    float fzMagSq = dot(fz, fz);
    if (!(fzMagSq <= 1.0e24)) {
        fz = vec2(1000000.0, 0.0);
    }
    float mag = min(length(fz), 1000000.0);
    float phase = atan(fz.y, fz.x);
    float modulus = log(mag + 1e-12);

    float phaseStripe = stripe(phase, u_phase_density, u_phase_sharpness);
    float modStripe = stripe(modulus, u_mod_density, u_mod_sharpness);
    float curve = phaseStripe * modStripe;
    if (u_curve_mode == 0) {
        curve = phaseStripe;
    } else if (u_curve_mode == 1) {
        curve = modStripe;
    } else if (u_curve_mode == 3) {
        curve = 1.0;
    }

    float t = fract(phase / TWO_PI + u_palette_offset);
    vec3 base = sample_palette(t);
    float mixed = mix(1.0, curve, clamp(u_curve_mix, 0.0, 1.0));
    vec3 finalColor = base * mixed + vec3(u_curve_bias);
    fragColor = vec4(clamp(finalColor, 0.0, 1.0), 1.0);
}
`;
