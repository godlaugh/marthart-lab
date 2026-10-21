import type {SourceSymmetryPaletteFrame} from './sourceSymmetryGradient';
import type {Palette} from '../types';
import {importSourceConfigPalette} from './sourceConfigPalette';
import {sourcePaletteRuntimeLut} from './sourcePaletteRuntime';
import {DEFAULT_COSINE} from './palette';

/** ProjectState reset palette, observed through original fromJson/toJson.
 * It differs from the generic visual config and Samila defaults. */
export const SOURCE_SYMMETRY_PROJECT_COLORS=['#FC6255','#FF862F','#FFFF00','#59743E','#83C167','#1D4A81','#9A72AC'] as const;
export function importSourceSymmetryProjectPalette(raw:unknown){return importSourceConfigPalette(raw,SOURCE_SYMMETRY_PROJECT_COLORS,'Symmetry');}
export type SourceSymmetryPaletteFacts = {model:'source-rgb1024';entries:1024;filter:'linear-repeat';frame?:SourceSymmetryPaletteFrame}|{model:'local-rgba4097';entries:4097;filter:'manual'};
/** Rich local palettes remain explicit extensions; do not silently discard
 * cycles, HSV, curves, or authored stop positions to force a native claim. */
export function prepareSourceSymmetryPalette(palette:Palette,frame?:SourceSymmetryPaletteFrame):SourceSymmetryPaletteFacts {
 const native=palette.cycles===1&&(palette.mode==='cosine'||palette.mode==='linear'&&palette.positions===undefined&&palette.interpolation!=='hsv');
 if(!native&&frame?.runtime)throw Error('源 Symmetry 渐变需要原版线性或余弦色板（单循环、均匀色标、非 HSV）');
 return native?{model:'source-rgb1024',entries:1024,filter:'linear-repeat',...(frame?{frame}:{})}:{model:'local-rgba4097',entries:4097,filter:'manual'};
}
/** SymmetryChaosMobject.buildPaletteConfig/uploadPaletteLUT, with no Samila
 * tail smoothing. Static palettes have no gradient runtime interpolation. */
export function sourceSymmetryPaletteLut(palette:Palette,frame?:SourceSymmetryPaletteFrame):Float32Array {
 if(prepareSourceSymmetryPalette(palette).model!=='source-rgb1024')throw Error('Symmetry 本地扩展色板不能冒充原版 1024 格色板');
 // A local document's omitted coefficients mean the same defaults as its
 // editor/swatches. Native runtime defaults are passed explicitly by callers.
 return sourcePaletteRuntimeLut({colors:palette.stops,offset:frame?.offset??palette.offset,gamma:1,space:'rgb',useCosine:palette.mode==='cosine',cosine:palette.cosine??DEFAULT_COSINE},frame?.runtime,[]);
}
