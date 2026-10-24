import {parseFractalSourceColorConfiguration,FractalSourceColorError,type FractalSourceColorConfiguration,type FractalSourcePaletteConfiguration} from './fractalSourceColor';
import type {SourceGradientPaletteCommit,SourceGradientPaletteMode,SourcePaletteGenerationResult} from './sourceGradientPaletteGeneration';

/** ProjectState's display mode is not the renderer's independent Cosine flag. */
export function fractalSourcePaletteMode(palette:FractalSourcePaletteConfiguration):SourceGradientPaletteMode {
 return palette.useCurve?'curve':palette.useCosine?'cosine':'manual';
}
function edit(configuration:FractalSourceColorConfiguration,change:(palette:FractalSourcePaletteConfiguration)=>void):SourcePaletteGenerationResult<FractalSourceColorConfiguration>{
 try{const next=structuredClone(configuration);change(next.palette);return{ok:true,value:parseFractalSourceColorConfiguration(next)};}
 catch(error){if(!(error instanceof FractalSourceColorError))throw error;return{ok:false,error:{kind:error.kind,path:error.field,reason:error.message}};}
}
/** One generated result, one authoring transaction, one caller Apply event.
 * Parameter/count changes preserve imported flags, including both true. */
export function commitFractalSourcePalette(configuration:FractalSourceColorConfiguration,commit:SourceGradientPaletteCommit):SourcePaletteGenerationResult<FractalSourceColorConfiguration>{
 return edit(configuration,p=>{
  p.colors=[...commit.colors];
  if(commit.mode==='cosine'){const {a,b,c,d}=commit.state;p.cosine=structuredClone({a,b,c,d});}
  else{const {red,green,blue}=commit.state;p.curves=structuredClone({red,green,blue});}
  if(commit.kind==='mode'){p.useCosine=commit.mode==='cosine';p.useCurve=commit.mode==='curve';}
  else if(commit.kind==='bake'){p.useCosine=false;p.useCurve=false;}
 });
}
/** The Manual snapshot contains colors only. Coefficients, curves, offsets,
 * interpolation and inside/outside settings remain the current author values. */
export function restoreFractalSourceManualPalette(configuration:FractalSourceColorConfiguration,colors:readonly string[]):SourcePaletteGenerationResult<FractalSourceColorConfiguration>{
 return edit(configuration,p=>{p.colors=[...colors];p.useCosine=false;p.useCurve=false;});
}
