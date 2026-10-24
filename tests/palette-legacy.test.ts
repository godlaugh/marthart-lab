import {describe,it,expect} from 'vitest';
import {parseLegacyScene} from '../src/engine/legacyImport';
import {paletteBaseColor,serializePalette,parsePalette} from '../src/engine/palette';
// Mandelbrot now owns a source palette; Phoenix still exercises the independent
// local-palette fallback whose preservation and rejection rules this suite owns.
const fixture=(color:unknown,palette=['#000000','#ffffff'])=>({config_version:'1.0.0',type:'FRACTAL',name:'Palette fixture',palette,color,fractal:{formula_id:'phoenix',parameters:{exponent:3},iterations:20}});
const params={cosine_a:[.3,.4,.5],cosine_b:[.2,.3,.4],cosine_c:[1,2,3],cosine_d:[0,.25,.5]};
const points={curve_red:[{x:.1,y:.2},{x:.9,y:.8}],curve_green:[{x:0,y:0},{x:1,y:1}],curve_blue:[{x:0,y:1},{x:1,y:0}]};
const parse=(input:unknown)=>{const result=parseLegacyScene(JSON.stringify(input));expect(result.scene.fractalSourceColor).toBeUndefined();return result;};
describe('legacy palette import for formulas without source color through the production Reader boundary',()=>{
 it('maps all cosine coefficients into real color evaluation and retains inactive curve data',()=>{const raw=fixture({...params,...points,use_cosine_palette:true,use_curve_palette:false}),result=parse(raw);expect(result.scene.palette.mode).toBe('cosine');expect(paletteBaseColor(result.scene.palette,0)).toEqual([.5,.4,.09999999999999998]);expect(result.scene.palette.curves?.red).toEqual(points.curve_red);expect(result.warnings.join()).not.toContain('color.cosine_a');result.scene.palette.cosine!.a[0]=0;expect((result.source as typeof raw).color).toEqual(raw.color);});
 it('preserves irregular curve endpoints and reports the independent interpolation scope',()=>{const result=parse(fixture({...points,use_curve_palette:true}));expect(result.scene.palette.mode).toBe('curve');expect(paletteBaseColor(result.scene.palette,0)).toEqual([.2,0,1]);expect(result.warnings.join()).toContain('逐点颜色未对照');expect(parsePalette(serializePalette(result.scene.palette))).toEqual(result.scene.palette);});
 it('keeps all 512 original stops rather than resampling at 32',()=>{const stops=Array.from({length:512},(_,i)=>'#'+i.toString(16).padStart(6,'0')),result=parse(fixture({},stops));expect(result.scene.palette.stops).toEqual(stops);expect(result.warnings.join()).not.toContain('32 个');});
 it('rejects ambiguous enabled modes and partial coefficients rather than inventing missing values',()=>{expect(()=>parse(fixture({...params,...points,use_cosine_palette:true,use_curve_palette:true}))).toThrow('优先级未知');expect(()=>parse(fixture({use_cosine_palette:true,cosine_a:[1,1,1]}))).toThrow('cosine');expect(()=>parse(fixture({...points,curve_red:[{x:1,y:0},{x:0,y:1}]}))).toThrow('curve');});
 it('supports alias spelling without losing source values',()=>{const result=parse(fixture({useCosinePalette:true,cosineA:params.cosine_a,cosineB:params.cosine_b,cosineC:params.cosine_c,cosineD:params.cosine_d}));expect(result.scene.palette.cosine?.c).toEqual([1,2,3]);expect(result.warnings.join()).not.toContain('cosineA');});
});
