import {decodeFractalSourceTerminal} from './fractalNativeNewtonRaster';

export interface FractalSourceRasterOutput {
 values:Float32Array;residual:Float32Array;source:Float32Array;
 traps?:Float32Array;distance?:Float32Array;sourceRGBA?:Uint8Array;
}
/** One interpretation of same-fragment MRT facts for WebGL and desktop CGL.
 * Array offsets may differ from the caller's destination order. Numeric NaN,
 * infinities and signed zero are copied without finite-prefix repair. */
export function scatterFractalSourceRasterSample(out:FractalSourceRasterOutput,index:number,isJulia:boolean,maxIterations:number,z:Float32Array,terminal:Float32Array,offset:number,inside?:Float32Array,outside?:Float32Array,rgba?:Uint8Array,rgbaOffset=offset){
 const facts=decodeFractalSourceTerminal(terminal[offset],terminal[offset+1],maxIterations);
 const derivative=isJulia?1:0,measured=facts.converged?Math.fround(Math.sqrt(terminal[offset+2])):0;
 out.values.set([z[offset],z[offset+2],facts.steps,facts.converged?4:facts.escaped?2:1,derivative,0,terminal[offset+3],0],index*8);
 out.residual.set([z[offset+1],z[offset+3],measured,0,measured,0,facts.converged?1:0,facts.iteration],index*8);
 if(out.traps){out.traps.set(inside!.subarray(offset,offset+4),index*8);out.traps.set(outside!.subarray(offset,offset+4),index*8+4);}
 out.distance?.set([derivative,0,0,0,z[offset],z[offset+2],facts.iteration,facts.converged?2:facts.escaped?1:0,terminal[offset+2],facts.startedPerturb?1:0,0,0],index*12);
 out.source.set([facts.startedPerturb?1:0,facts.glitches,facts.ordinarySteps,facts.perturbSteps],index*4);
 if(rgba)out.sourceRGBA!.set(rgba.subarray(rgbaOffset,rgbaOffset+4),index*4);
 return facts;
}
