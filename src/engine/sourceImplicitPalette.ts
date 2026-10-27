import {sourceConfigPackedColor,sourceHotPalettePackedColor,SourceConfigColorError,SOURCE_COLOR_TEXT_BUDGET} from './sourceConfigColor';

export class ImplicitPaletteControlError extends Error {
 constructor(message:string,readonly kind:'input'|'capacity'='input'){super(message);this.name='ImplicitPaletteControlError';}
}
export interface ImplicitPaletteFacts {readonly packed:readonly number[];readonly diagnostics:readonly string[];}
export function validateImplicitPaletteColors(raw:unknown):asserts raw is string[] {
 if(!Array.isArray(raw))throw new ImplicitPaletteControlError('Implicit palette colors must be an array');
 if(raw.length>65536)throw new ImplicitPaletteControlError('Implicit palette exceeds the 65536-color preparation budget','capacity');
 let bytes=0;for(const value of raw){if(typeof value!=='string')throw new ImplicitPaletteControlError('Implicit palette colors must be strings');bytes+=value.length*2;if(bytes>SOURCE_COLOR_TEXT_BUDGET)throw new ImplicitPaletteControlError('Implicit palette exceeds the 1 MiB UTF-16 text budget','capacity');}
}
/** Validate shape without replacing raw authored text by display colors. */
export function validateImplicitSourcePalette(raw:unknown):{colors:string[]} {
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(key=>key!=='colors'))throw new ImplicitPaletteControlError('Implicit source palette must contain only colors');
 const colors=(raw as {colors?:unknown}).colors;validateImplicitPaletteColors(colors);return raw as {colors:string[]};
}
/** Preserve the actual source palette cardinality. The retained runtime owner
 * owns hot-empty keep-current; CPU color consumers own the cold white fallback.
 * GPU presentation must still observe an empty array as paletteSize zero. */
export function prepareImplicitPalette(raw:unknown,mode:'cold'|'hot'):ImplicitPaletteFacts {
 validateImplicitPaletteColors(raw);if(mode!=='cold'&&mode!=='hot')throw new ImplicitPaletteControlError('Unknown Implicit palette parser mode');
 const diagnostics:string[]=[],values=raw.map((text,index)=>{
  if(mode==='hot')return sourceHotPalettePackedColor(text);
  try{return sourceConfigPackedColor(text);}catch(error){if(!(error instanceof SourceConfigColorError))throw error;diagnostics.push(`Implicit palette color ${index+1} is invalid; source white is used and raw text is retained.`);return 0xffffffff;}
 });
 return Object.freeze({packed:Object.freeze(values),diagnostics:Object.freeze(diagnostics)});
}
