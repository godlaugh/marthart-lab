import {javaEqualsIgnoreCaseAscii} from './sourceJavaText';
import type {SceneDocument} from '../types';
export const SOURCE_SAMILA_MATH_MODEL='mathart-1.7.8' as const;
export type SourceSamilaMathModel=typeof SOURCE_SAMILA_MATH_MODEL;
export function usesSourceSamilaMath(scene:Pick<SceneDocument,'kind'|'settings'>):boolean {
 const model=scene.settings.samilaMathModel;if(model===undefined)return false;
 if(model!==SOURCE_SAMILA_MATH_MODEL||scene.kind!=='samila'||scene.settings.iteratedMode!=='continuous')throw Error('源 Samila 数学版本需要持续批次 Samila');
 return true;
}
/** Native shader ordinal order, with local X_Y labels at the owning boundary. */
export const SOURCE_SAMILA_MAPPINGS=['f2_f1','f1_f2','x_f1','x_f2','y_f1','y_f2','f1_x','f2_x','f1_y','f2_y','f1_product','f2_product','product_f1','product_f2','kaleidoscope_x','x_kaleidoscope','swirl_x','x_swirl','warp_x','x_warp','cosmod_x','x_cosmod','radial_x','x_radial','fold_x','x_fold'] as const;
export const SOURCE_SAMILA_PROJECTIONS=['cartesian','polar','aitoff','hammer','lambert','mollweide'] as const;
const nativeModes=['f1_vs_f2','f2_vs_f1','f1_vs_x1','f2_vs_x1','f1_vs_x2','f2_vs_x2','x1_vs_f1','x1_vs_f2','x2_vs_f1','x2_vs_f2','f1f2_vs_f1','f1f2_vs_f2','f1_vs_f1f2','f2_vs_f1f2','kaleidoscope_vs_x','x_vs_kaleidoscope','swirl_vs_x','x_vs_swirl','warp_vs_x','x_vs_warp','cos_mod_vs_x','x_vs_cos_mod','radial_vs_x','x_vs_radial','fold_vs_x','x_vs_fold'];
export function sourceSamilaModeFromConfig(raw:string|null):string {return typeof raw==='string'&&javaEqualsIgnoreCaseAscii(raw,'random')?'random':SOURCE_SAMILA_MAPPINGS[nativeModes.findIndex(name=>typeof raw==='string'&&javaEqualsIgnoreCaseAscii(raw,name))]??'f2_f1';}
export function sourceSamilaProjectionFromConfig(raw:string|null):string {if(typeof raw!=='string')return 'cartesian';if(javaEqualsIgnoreCaseAscii(raw,'random'))return 'random';return SOURCE_SAMILA_PROJECTIONS.find(name=>javaEqualsIgnoreCaseAscii(raw,name==='cartesian'?'rectilinear':name))??'cartesian';}
export function resolveSourceSamilaSelection(mapping:string,projection:string){
 const m=mapping==='random'?'f2_f1':mapping,p=projection==='random'?'cartesian':projection;
 const modeIndex=(SOURCE_SAMILA_MAPPINGS as readonly string[]).indexOf(m),projectionIndex=(SOURCE_SAMILA_PROJECTIONS as readonly string[]).indexOf(p);
 if(modeIndex<0||projectionIndex<0)throw Error('源 Samila 数学模式或投影无效');
 return{mapping:m,projection:p,modeIndex,projectionIndex};
}
const F=Math.fround,PI=F(Math.PI),add=(x:number,y:number)=>F(x+y),sub=(x:number,y:number)=>F(x-y),mul=(x:number,y:number)=>F(x*y),div=(x:number,y:number)=>F(x/y),sin=(x:number)=>F(Math.sin(x)),cos=(x:number)=>F(Math.cos(x)),sqrt=(x:number)=>F(Math.sqrt(x)),pow=(x:number,y:number)=>F(Math.pow(x,y)),mod=(x:number,y:number)=>sub(x,mul(y,Math.floor(div(x,y))));
/** The GL uniform upload substitutes zero for nonfinite narrowed values. */
export function sourceSamilaUniform(value:number|undefined):number {const f=F(value??0);return Number.isFinite(f)?f:0;}
export function prepareSourceSamilaRange(start:number,stop:number,samplingPolicy:'legacy-finite-span'|'source-pcg'='legacy-finite-span'):{lo:number;hi:number} {
 if(samplingPolicy!=='legacy-finite-span'&&samplingPolicy!=='source-pcg')throw Error('源 Samila 采样范围策略无效');
 if(!Number.isFinite(start)||!Number.isFinite(stop))throw Error('源 Samila 采样范围需要有限 double');
 const lo=F(Math.min(start,stop)),hi=F(Math.max(start,stop));
 if(!Number.isFinite(lo)||!Number.isFinite(hi)||samplingPolicy==='legacy-finite-span'&&!Number.isFinite(F(hi-lo)))throw Error('源 Samila 采样范围超出有限 Float32');
 // The source PCG evaluates the range expression in GLSL. An overflowing
 // span may be ignored by constant formulas, so only actual results reject it.
 return{lo,hi};
}
export interface SourceSamilaMathInput {modeIndex:number;projectionIndex:number;parameters:Readonly<Record<string,number>>;}
type Point=[number,number];
/** Float32 arithmetic translation of the retained shader. CPU transcendental
 * functions use JS libm, so driver-level bit equality is not promised. No
 * geographic normalization or stable-radius rewrite is introduced. */
export function sourceSamilaMapProject(input:SourceSamilaMathInput,x:number,y:number,v1:number,v2:number):Point {
 x=F(x);y=F(y);v1=F(v1);v2=F(v2);if(![v1,v2].every(Number.isFinite))return[NaN,NaN];
 const a=sourceSamilaUniform(input.parameters.a),b=sourceSamilaUniform(input.parameters.b),c=sourceSamilaUniform(input.parameters.c),d=sourceSamilaUniform(input.parameters.d),product=mul(v1,v2);
 let px:number,py:number;
 if(input.modeIndex>=0&&input.modeIndex<14){switch(input.modeIndex){
  case 0:px=v2;py=v1;break;case 1:px=v1;py=v2;break;case 2:px=x;py=v1;break;case 3:px=x;py=v2;break;case 4:px=y;py=v1;break;case 5:px=y;py=v2;break;
  case 6:px=v1;py=x;break;case 7:px=v2;py=x;break;case 8:px=v1;py=y;break;case 9:px=v2;py=y;break;case 10:px=v1;py=product;break;case 11:px=v2;py=product;break;case 12:px=product;py=v1;break;default:px=product;py=v2;
 }}
 else if(input.modeIndex>=14&&input.modeIndex<=25){
  const vertical=input.modeIndex%2===1;let value:number;
  if(input.modeIndex<18){const radius=sqrt(add(mul(v1,v1),mul(v2,v2)));let theta=F(Math.atan2(v2,v1));
   if(input.modeIndex<16){const n=Math.max(2,Math.round(a)),segment=div(mul(2,PI),n),half=mul(segment,.5);theta=Math.abs(sub(mod(add(theta,half),segment),half));}
   else theta=add(theta,mul(a,radius));
   value=mul(radius,vertical?sin(theta):cos(theta));
  }else if(input.modeIndex<20)value=add(v1,mul(vertical?c:a,sin(mul(vertical?d:b,v2))));
  else if(input.modeIndex<22)value=mul(sin(add(mul(a,v1),b)),cos(add(mul(c,v2),d)));
  else if(input.modeIndex<24)value=pow(add(add(mul(v1,v1),mul(v2,v2)),F(1e-10)),mul(a,.5));
  else{const half=add(mul(Math.abs(a),.5),F(.001));value=Math.abs(sub(mod(add(v1,half),mul(half,2)),half));}
  [px,py]=vertical?[x,value]:[value,x];
 }else{px=v2;py=v1;}
 const lon=px,lat=py,halfLon=mul(lon,.5),cosLat=cos(lat),sqrt2=F(Math.SQRT2);
 switch(input.projectionIndex){
  case 1:return[mul(lat,cos(lon)),mul(lat,sin(lon))];
  case 2:{const alpha=F(Math.acos(mul(cosLat,cos(halfLon)))),sinc=alpha<F(.0001)?1:div(sin(alpha),alpha);return[div(mul(cosLat,sin(halfLon)),sinc),div(sin(lat),sinc)];}
  case 3:{const alpha=sqrt(add(1,mul(cosLat,cos(halfLon))));return[div(mul(mul(2,sqrt2),mul(cosLat,sin(halfLon))),alpha),div(mul(sqrt2,sin(lat)),alpha)];}
  case 4:{const inner=add(1,mul(cosLat,cos(lon))),k=sqrt(div(2,Math.max(inner,F(1e-15))));return[mul(mul(k,cosLat),sin(lon)),mul(k,sin(lat))];}
  case 5:{const clat=sub(div(PI,2),Math.abs(lat));let aux:number;
   if(clat<F(.087)){const d=mul(.5,pow(mul(mul(mul(3,PI),clat),clat),div(1,3)));aux=mul(sub(div(PI,2),d),Math.sign(lat));}
   else{const piSinLat=mul(PI,sin(lat));let theta=mul(2,lat);for(let i=0;i<5;i++)theta=sub(theta,div(sub(add(theta,sin(theta)),piSinLat),add(1,cos(theta))));aux=mul(theta,.5);}
   return[mul(mul(div(mul(2,sqrt2),PI),lon),cos(aux)),mul(sqrt2,sin(aux))];}
  default:return[px,py];
 }
}

/** Retained source functions, renamed only to isolate shader globals.
 * samila_splat.vert SHA256 29eaf8274e35c582d6425d1b6be901cfb0e57d9a5b11277eba9f006eaa098093. */
export const sourceSamilaMathGlsl=`
uniform int sourceSamilaMode,sourceSamilaProjection;
const float SOURCE_SAMILA_PI=3.14159265358979323846;
void sourceSamilaApplyGenerateMode(float v1, float v2, float origX, float origY, float normIdx,
                       out float plotX, out float plotY) {
    float product = v1 * v2;
    switch (sourceSamilaMode) {
        case 0:  plotX = v2; plotY = v1; break;           // F1_VS_F2
        case 1:  plotX = v1; plotY = v2; break;           // F2_VS_F1
        case 2:  plotX = origX; plotY = v1; break;         // F1_VS_X1
        case 3:  plotX = origX; plotY = v2; break;         // F2_VS_X1
        case 4:  plotX = origY; plotY = v1; break;         // F1_VS_X2
        case 5:  plotX = origY; plotY = v2; break;         // F2_VS_X2
        case 6:  plotX = v1; plotY = origX; break;         // X1_VS_F1
        case 7:  plotX = v2; plotY = origX; break;         // X1_VS_F2
        case 8:  plotX = v1; plotY = origY; break;         // X2_VS_F1
        case 9:  plotX = v2; plotY = origY; break;         // X2_VS_F2
        case 10: plotX = v1; plotY = product; break;       // F1F2_VS_F1
        case 11: plotX = v2; plotY = product; break;       // F1F2_VS_F2
        case 12: plotX = product; plotY = v1; break;       // F1_VS_F1F2
        case 13: plotX = product; plotY = v2; break;       // F2_VS_F1F2

        // ---- 万花筒（对称）mappingA = 折叠次数 (2-12) ----
        case 14: { // KALEIDOSCOPE_VS_X
            float n = max(2.0, round(mappingA));
            float r = sqrt(v1 * v1 + v2 * v2);
            float theta = atan(v2, v1);
            float seg = 2.0 * SOURCE_SAMILA_PI / n;
            theta = abs(mod(theta + seg * 0.5, seg) - seg * 0.5);
            plotX = r * cos(theta); plotY = origX; break;
        }
        case 15: { // X_VS_KALEIDOSCOPE
            float n = max(2.0, round(mappingA));
            float r = sqrt(v1 * v1 + v2 * v2);
            float theta = atan(v2, v1);
            float seg = 2.0 * SOURCE_SAMILA_PI / n;
            theta = abs(mod(theta + seg * 0.5, seg) - seg * 0.5);
            plotX = origX; plotY = r * sin(theta); break;
        }

        // ---- 漩涡（流动）mappingA = 扭曲强度 ----
        case 16: { // SWIRL_VS_X
            float r = sqrt(v1 * v1 + v2 * v2);
            float theta = atan(v2, v1) + mappingA * r;
            plotX = r * cos(theta); plotY = origX; break;
        }
        case 17: { // X_VS_SWIRL
            float r = sqrt(v1 * v1 + v2 * v2);
            float theta = atan(v2, v1) + mappingA * r;
            plotX = origX; plotY = r * sin(theta); break;
        }

        // ---- 域扭曲（有机）mappingA=振幅, mappingB=频率 | mappingC=振幅, mappingD=频率 ----
        case 18: { // WARP_VS_X
            plotX = v1 + mappingA * sin(mappingB * v2); plotY = origX; break;
        }
        case 19: { // X_VS_WARP
            plotX = origX; plotY = v1 + mappingC * sin(mappingD * v2); break;
        }

        // ---- 余弦调制（几何）mappingA,mappingB=频率/相位1, mappingC,mappingD=频率/相位2 ----
        case 20: { // COS_MOD_VS_X
            plotX = sin(mappingA * v1 + mappingB) * cos(mappingC * v2 + mappingD); plotY = origX; break;
        }
        case 21: { // X_VS_COS_MOD
            plotX = origX; plotY = sin(mappingA * v1 + mappingB) * cos(mappingC * v2 + mappingD); break;
        }

        // ---- 径向距离（几何）mappingA = 指数 ----
        case 22: { // RADIAL_VS_X
            float r = pow(v1 * v1 + v2 * v2 + 1e-10, mappingA * 0.5);
            plotX = r; plotY = origX; break;
        }
        case 23: { // X_VS_RADIAL
            float r = pow(v1 * v1 + v2 * v2 + 1e-10, mappingA * 0.5);
            plotX = origX; plotY = r; break;
        }

        // ---- 折叠平铺（几何）mappingA = 折叠范围 ----
        case 24: { // FOLD_VS_X
            float halfRange = abs(mappingA) * 0.5 + 0.001;
            plotX = abs(mod(v1 + halfRange, halfRange * 2.0) - halfRange); plotY = origX; break;
        }
        case 25: { // X_VS_FOLD
            float halfRange = abs(mappingA) * 0.5 + 0.001;
            plotX = origX; plotY = abs(mod(v1 + halfRange, halfRange * 2.0) - halfRange); break;
        }

        default: plotX = v2; plotY = v1; break;            // 默认 F1_VS_F2
    }
}

/**
 * 应用投影变换。
 * 所有投影遵循 matplotlib 的约定：inX=longitude/theta，inY=latitude/r。
 * 
 * Matplotlib 中各投影的精确公式来源于 matplotlib/projections/geo.py：
 *   - POLAR: theta=x, r=y → cartesian (y*cos(x), y*sin(x))
 *   - AITOFF, HAMMER, LAMBERT, MOLLWEIDE: 地球制图投影
 * 各投影的数学推导参见对应代码注释。
 */
void sourceSamilaApplyProjection(float inX, float inY, out float outX, out float outY) {
    float lon, lat, halfLon, cosLat, alpha, k;

    switch (sourceSamilaProjection) {
        case 1: // POLAR - matplotlib polar: scatter(x,y) → (theta=x, r=y)
            outX = inY * cos(inX);
            outY = inY * sin(inX);
            break;

        case 2: { // AITOFF - 等面积投影
            // 参考 matplotlib AitoffTransform.transform_non_affine()
            // alpha = arccos(cos(φ) * cos(λ/2))
            // x = cos(φ) * sin(λ/2) / sinc(α)   其中 sinc(α)=sin(α)/α
            // y = sin(φ) / sinc(α)
            lon = inX;
            lat = inY;
            halfLon = lon * 0.5;
            cosLat = cos(lat);
            alpha = acos(cosLat * cos(halfLon));
            float sincAlpha = (alpha < 0.0001) ? 1.0 : sin(alpha) / alpha;
            outX = cosLat * sin(halfLon) / sincAlpha;
            outY = sin(lat) / sincAlpha;
            break;
        }

        case 3: { // HAMMER - Hammer-Aitoff 等面积投影
            // 参考 matplotlib HammerTransform.transform_non_affine()
            // alpha = sqrt(1 + cos(φ) * cos(λ/2))
            // x = 2√2 * cos(φ) * sin(λ/2) / alpha
            // y = √2 * sin(φ) / alpha
            lon = inX;
            lat = inY;
            halfLon = lon * 0.5;
            cosLat = cos(lat);
            float sqrt2 = 1.4142135623730951;
            alpha = sqrt(1.0 + cosLat * cos(halfLon));
            outX = (2.0 * sqrt2) * (cosLat * sin(halfLon)) / alpha;
            outY = (sqrt2 * sin(lat)) / alpha;
            break;
        }

        case 4: { // LAMBERT - 方位等面积投影（中心: 赤道与本初子午线交点）
            // 参考 matplotlib LambertTransform.transform_non_affine()，clong=0, clat=0
            // inner_k = 1 + cos(lat)*cos(lon)
            // k = sqrt(2 / inner_k)
            // x = k * cos(lat) * sin(lon)
            // y = k * sin(lat)
            lon = inX;
            lat = inY;
            cosLat = cos(lat);
            float innerK = 1.0 + cosLat * cos(lon);
            k = sqrt(2.0 / max(innerK, 1e-15));
            outX = k * cosLat * sin(lon);
            outY = k * sin(lat);
            break;
        }

        case 5: { // MOLLWEIDE - 等面积伪圆柱投影，使用 Newton-Raphson 迭代
            // 参考 matplotlib MollweideTransform.transform_non_affine()
            // 辅助角 θ 满足: 2θ + sin(2θ) = π * sin(φ)
            // 然后用 Newton 法求解 θ
            // 最终: x = (2√2/π) * λ * cos(θ),  y = √2 * sin(θ)
            lon = inX;
            lat = inY;
            float sqrt2 = 1.4142135623730951;
            float clat = SOURCE_SAMILA_PI / 2.0 - abs(lat);
            float aux;

            if (clat < 0.087) {
                // 靠近极点时使用 Taylor 级数近似，避免 Newton 法不收敛
                float mappingD = 0.5 * pow(3.0 * SOURCE_SAMILA_PI * clat * clat, 1.0 / 3.0);
                aux = (SOURCE_SAMILA_PI / 2.0 - mappingD) * sign(lat);
            } else {
                // Newton-Raphson 迭代求解 θ（5 次迭代对 float 精度足够）
                float piSinLat = SOURCE_SAMILA_PI * sin(lat);
                float theta = 2.0 * lat;
                for (int i = 0; i < 5; i++) {
                    theta -= (theta + sin(theta) - piSinLat) / (1.0 + cos(theta));
                }
                aux = theta * 0.5;
            }

            outX = (2.0 * sqrt2 / SOURCE_SAMILA_PI) * lon * cos(aux);
            outY = sqrt2 * sin(aux);
            break;
        }

        default: // RECTILINEAR (sourceSamilaProjection == 0 或其他未知值)
            outX = inX;
            outY = inY;
            break;
    }
}
`;
