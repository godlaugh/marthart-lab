import {FRACTAL_SOURCE_RASTER_VERTEX} from './fractalNativeNewtonKernel';
import {FRACTAL_SOURCE_COLOR_RASTER_FRAGMENT} from './fractalNativeNewtonRaster';

/** Native host supplies its desktop version directive. Numerical expressions,
 * four MRT outputs and their order are shared with the production WebGL path. */
function desktopBody(source:string):string {
 if(!source.startsWith('#version 300 es\n'))throw Error('Unexpected source fractal shader dialect');
 return source.slice('#version 300 es\n'.length).replace(/precision highp (?:float|int|sampler2D);/g,'');
}
export const FRACTAL_SOURCE_NATIVE_SHADERS=Object.freeze({vertex:desktopBody(FRACTAL_SOURCE_RASTER_VERTEX),fragment:desktopBody(FRACTAL_SOURCE_COLOR_RASTER_FRAGMENT)});
